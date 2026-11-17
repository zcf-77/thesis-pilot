#!/usr/bin/env node
// DocsModel → DOCX with the vendored office-wasm (MuffinOffice cfb8352), run by the worker
// as a child process. Protocol: stdin = UTF-8 JSON {"model": DocsModel} whose resources carry
// inline bytes; stdout = one JSON line {"ok": true, "docxBase64", "report"} or
// {"ok": false, "code", "message"}. No network, no file writes; the WASM path is fixed.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(
  process.env.TP_OFFICE_WASM_DIR || resolve(here, "../../web/vendor/muffin-office/office-wasm"),
);

function reply(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

try {
  const glue = await import(resolve(pkg, "office_wasm.js"));
  glue.initSync({ module: readFileSync(resolve(pkg, "office_wasm_bg.wasm")) });
  const request = JSON.parse(await readStdin());
  if (!request || typeof request !== "object" || !request.model) {
    reply({ ok: false, code: "RUNNER_INPUT_INVALID", message: "model is required" });
    process.exit(0);
  }
  const model = JSON.stringify(request.model);
  let report;
  let bytes;
  try {
    report = JSON.parse(glue.model_to_docx_report(model, null));
    bytes = glue.model_to_docx(model, null);
  } catch (error) {
    // Kernel messages describe the model shape only; they never echo document text.
    const message = String(error && error.message ? error.message : error).slice(0, 300);
    reply({ ok: false, code: "RUNNER_MODEL_REJECTED", message });
    process.exit(0);
  }
  reply({
    ok: true,
    engine: glue.engine_version(),
    report,
    docxBase64: Buffer.from(bytes).toString("base64"),
  });
} catch (error) {
  reply({ ok: false, code: "RUNNER_FAILED", message: String(error).slice(0, 300) });
  process.exit(0);
}
