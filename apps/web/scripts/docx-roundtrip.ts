import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import type { JSONContent } from "@tiptap/vue-3";
import { chromium } from "playwright";
import { createServer } from "vite-plus";
import type { EditorSnapshot } from "../src/lab/state/editorAdapter.ts";
import type { docxEditor } from "../tests/docx/editor.ts";

declare global {
  interface Window {
    docxEditor: typeof docxEditor;
  }
}

interface RoundtripSession {
  document: JSONContent;
  editable_paths: number[][];
  objects: { kind: string; mode: string; count: number }[];
}

const root = fileURLToPath(new URL("..", import.meta.url));
const adapter = resolve(root, "../../scripts/docx_roundtrip.py");
const suffix = "（中文小样校验）";

function convert(command: string, ...paths: string[]) {
  try {
    execFileSync(process.env.TP_DOCX_PYTHON ?? "python", ["-X", "utf8", adapter, command, ...paths], { stdio: ["ignore", "ignore", "inherit"] });
  } catch {
    throw new Error(command === "import" ? "DOCX 导入检查失败。" : "DOCX 导出检查失败。");
  }
}

function blockAt(document: JSONContent, path: number[]): JSONContent {
  return path.reduce((node, index) => node.content![index]!, document);
}

function removeChapterIds(node: JSONContent) {
  if (node.type === "heading" && node.attrs) delete node.attrs.chapterId;
  node.content?.forEach(removeChapterIds);
}

async function roundtrip(input: string, outputDir: string) {
  await mkdir(outputDir);
  const importedFile = resolve(outputDir, "imported.json");
  const savedFile = resolve(outputDir, "saved.json");
  convert("import", input, importedFile);
  const session: RoundtripSession = JSON.parse(await readFile(importedFile, "utf8"));
  const selected = new Map<string, number[]>();
  for (const path of session.editable_paths) {
    const category = path.length > 1 ? "table" : blockAt(session.document, path).type!;
    if (!selected.has(category)) selected.set(category, path);
  }

  const server = await createServer({
    configFile: false,
    root,
    cacheDir: "node_modules/.vite-docx",
    optimizeDeps: { entries: ["tests/docx/editor.html"] },
    server: { host: "127.0.0.1", port: 0, strictPort: true, fs: { allow: [root] } },
  });
  try {
    await server.listen();
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error("无法启动本机编辑器检查。");
    const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    try {
      const page = await browser.newPage();
      await page.goto(new URL("tests/docx/editor.html", base).href);
      await page.waitForFunction(() => !!window.docxEditor);
      const initial: EditorSnapshot = { schemaVersion: 1, json: session.document, chapters: [] };
      await page.evaluate((snapshot) => window.docxEditor.load(snapshot), initial);
      const crossBlock = await page.evaluate(() => window.docxEditor.checkCrossBlockPatch());
      if (crossBlock === "failed") throw new Error("跨文本块补丁未被拒绝。");
      for (const path of selected.values()) {
        await page.evaluate((position) => window.docxEditor.selectBlockEnd(position), path);
        await expect(page.locator(".tiptap")).toBeFocused();
        const readText = async () => {
          const snapshot = await page.evaluate(() => window.docxEditor.snapshot());
          return (
            blockAt(snapshot.json, path)
              .content?.map((child) => child.text)
              .join("") ?? ""
          );
        };
        const original = await readText();
        await page.keyboard.insertText(suffix);
        await expect.poll(async () => (await readText()) === original + suffix).toBe(true);
        await page.evaluate(() => window.docxEditor.undo());
        await expect.poll(async () => (await readText()) === original).toBe(true);
        await page.evaluate((position) => window.docxEditor.selectBlockEnd(position), path);
        await page.keyboard.insertText(suffix);
        await expect.poll(async () => (await readText()) === original + suffix).toBe(true);
      }
      const saved = await page.evaluate(() => window.docxEditor.snapshot());
      const snapshotFile = resolve(outputDir, "editor-snapshot.json");
      await writeFile(snapshotFile, JSON.stringify(saved), { flag: "wx" });
      await page.reload();
      await page.waitForFunction(() => !!window.docxEditor);
      const persisted = JSON.parse(await readFile(snapshotFile, "utf8")) as EditorSnapshot;
      await page.evaluate((snapshot) => window.docxEditor.load(snapshot), persisted);
      const restored = await page.evaluate(() => window.docxEditor.snapshot());
      if (JSON.stringify(restored) !== JSON.stringify(saved)) throw new Error("保存后重载的结构或章节锚点不一致。");
      removeChapterIds(restored.json);
      await writeFile(savedFile, JSON.stringify({ ...session, document: restored.json }), { flag: "wx" });
      convert("export", input, savedFile, resolve(outputDir, "roundtrip.docx"));
      console.log(JSON.stringify({ objects: session.objects, edited: [...selected.keys()], crossBlock, savedAndReloaded: true }));
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
}

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("用法：vp exec node scripts/docx-roundtrip.ts <DOCX> <新建输出目录>");
  process.exitCode = 2;
} else {
  await roundtrip(resolve(input), resolve(output));
}
