import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createServices } from "../../src/services/index.ts";
import type { MaterialUpload, MaterialParseRead } from "../../src/services/contracts/api.generated.ts";
import { createMockMaterials } from "../../src/services/mockMaterials.ts";
import { MATERIAL_MAX_BYTES, MATERIAL_PARSE_TRANSPORT_BYTES, materialBytes } from "../../src/services/httpMaterials.ts";

const encode = (value: string) => btoa(String.fromCharCode(...new TextEncoder().encode(value)));
const upload = (changes: Partial<MaterialUpload> = {}): MaterialUpload => ({
  name: "自制资料",
  filename: "合成.txt",
  file_type: "text",
  kind: "requirements",
  source_note: "  合成来源原文  ",
  content_base64: encode("合成要求：完成论文后逐项核对。"),
  ...changes,
});
const mock = () => createServices({ mode: "mock", instanceId: "material-unit" });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.useRealTimers());
async function setup() {
  const api = mock();
  const project = await api.projects.create({ name: "合成资料项目" });
  return { api, projectId: project.id };
}
async function parsed(kind: MaterialUpload["kind"] = "requirements") {
  const context = await setup();
  const receipt = await context.api.materials.upload(context.projectId, upload({ kind }), "initial-upload");
  await vi.advanceTimersByTimeAsync(2500);
  const job = await context.api.jobs.get(receipt.job.id);
  if (job.result?.kind !== "material_parse") throw new Error("合成文本解析未产生结果");
  const parse = await context.api.materials.parse(context.projectId, receipt.material.id, receipt.original.id, job.result.parse_version_id);
  return { ...context, receipt, parse };
}

describe("SG-06A 资料同契约服务", () => {
  it("并发上传重放一个原件与任务，保留来源原文，Blob下载字节与SHA一致", async () => {
    const { api, projectId } = await setup();
    const input = upload();
    const [first, replay] = await Promise.all([api.materials.upload(projectId, input, "upload-key"), api.materials.upload(projectId, input, "upload-key")]);
    expect(first.material.id).toBe(replay.material.id);
    expect(first.job.id).toBe(replay.job.id);
    expect(first.material.source_note).toBe(input.source_note);
    expect((await api.materials.list(projectId)).total).toBe(1);
    expect((await api.jobs.list({ project_id: projectId })).total).toBe(1);
    const blob = await api.materials.download(projectId, first.material.id, first.original.id);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes).toEqual(materialBytes(input.content_base64));
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
    expect(digest).toBe(first.original.sha256);
    await expect(api.materials.upload(projectId, upload({ name: "不同请求" }), "upload-key")).rejects.toMatchObject({ code: "MATERIAL_UPLOAD_KEY_CONFLICT" });
    await expect(api.documents.current(projectId)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });

  it("元数据CAS和新原件CAS均保持完整胜者，旧原件与下载不可变", async () => {
    const { api, projectId } = await setup();
    const first = await api.materials.upload(projectId, upload(), "first");
    const updates = await Promise.allSettled([
      api.materials.update(projectId, first.material.id, { expected_version: 1, name: "胜者甲" }),
      api.materials.update(projectId, first.material.id, { expected_version: 1, name: "胜者乙" }),
    ]);
    expect(updates.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(updates.find((value) => value.status === "rejected")?.reason).toMatchObject({ code: "MATERIAL_VERSION_CONFLICT" });
    const next = await api.materials.appendOriginal(
      projectId,
      first.material.id,
      { ...upload({ content_base64: encode("第二版合成原件") }), expected_version: 2 },
      "append",
    );
    expect(next.original.version).toBe(2);
    expect(next.material.version).toBe(3);
    await expect(api.materials.appendOriginal(projectId, first.material.id, { ...upload(), expected_version: 2 }, "stale-append")).rejects.toMatchObject({
      code: "MATERIAL_VERSION_CONFLICT",
    });
    expect((await api.materials.originals(projectId, first.material.id)).total).toBe(2);
    const replayed = await api.materials.upload(projectId, upload(), "first");
    expect(replayed.original.id).toBe(first.original.id);
    expect(replayed.material.current_original_id).toBe(next.original.id);
    expect(replayed.material.version).toBe(3);
    expect(await (await api.materials.download(projectId, first.material.id, first.original.id)).text()).toBe("合成要求：完成论文后逐项核对。");
    await api.materials.update(projectId, first.material.id, { expected_version: 3, removed: true });
    expect((await api.materials.list(projectId)).total).toBe(0);
    expect((await api.materials.list(projectId, { include_removed: true })).total).toBe(1);
    expect((await api.materials.original(projectId, first.material.id, first.original.id)).sha256).toBe(first.original.sha256);
  });

  it("队列写入失败不留下半个原件或元数据", async () => {
    const projectId = crypto.randomUUID();
    const failing = createMockMaterials(
      async () => {},
      () => {},
      () => {
        throw new Error("synthetic queue failure");
      },
    );
    await expect(failing.service.upload(projectId, upload(), "failed-upload")).rejects.toThrow("synthetic queue failure");
    expect((await failing.service.list(projectId)).total).toBe(0);
  });

  it("取消后不产生解析版本；显式重试固定原件且完整文本与摘要分别读取", async () => {
    vi.useFakeTimers();
    const { api, projectId } = await setup();
    const receipt = await api.materials.upload(projectId, upload(), "cancel-upload");
    await api.jobs.cancel(receipt.job.id);
    await vi.advanceTimersByTimeAsync(2500);
    expect((await api.jobs.get(receipt.job.id)).status).toBe("cancelled");
    expect((await api.materials.parses(projectId, receipt.material.id, receipt.original.id)).total).toBe(0);
    const retried = await api.jobs.retry(receipt.job.id, "material-retry");
    expect(retried.input_snapshot).toEqual(receipt.job.input_snapshot);
    await vi.advanceTimersByTimeAsync(2500);
    const finished = await api.jobs.get(retried.id);
    expect(finished).toMatchObject({ status: "succeeded", result: { kind: "material_parse", model_used: false, writes_performed: false } });
    const history = await api.materials.parses(projectId, receipt.material.id, receipt.original.id);
    expect(history.total).toBe(1);
    expect(history.items[0]).not.toHaveProperty("result");
    const detail = await api.materials.parse(projectId, receipt.material.id, receipt.original.id, history.items[0]!.id);
    expect(detail.result.diagnostics.join(" ")).toContain("本地模拟");
    expect(detail.result.anchors[0]!.original_version_id).toBe(receipt.original.id);
    expect(detail.result.plain_text).toBe("合成要求：完成论文后逐项核对。");
  });

  it("同基础并发重解析只有一个落版本，陈旧和跨项目来源不能绑定", async () => {
    vi.useFakeTimers();
    const { api, projectId, receipt, parse } = await parsed();
    const a = await api.materials.reparse(projectId, receipt.material.id, receipt.original.id, { expected_parse_id: parse.id }, "parse-a");
    const b = await api.materials.reparse(projectId, receipt.material.id, receipt.original.id, { expected_parse_id: parse.id }, "parse-b");
    await vi.advanceTimersByTimeAsync(2500);
    expect((await api.jobs.get(a.id)).status).toBe("succeeded");
    expect(await api.jobs.get(b.id)).toMatchObject({ status: "failed", error_code: "MATERIAL_PARSE_CONFLICT" });
    expect((await api.materials.parses(projectId, receipt.material.id, receipt.original.id)).total).toBe(2);
    await expect(api.materials.reparse(projectId, receipt.material.id, receipt.original.id, { expected_parse_id: parse.id }, "stale")).rejects.toMatchObject({
      code: "MATERIAL_PARSE_CONFLICT",
    });
    const other = await api.projects.create({ name: "其他合成项目" });
    await expect(
      api.materials.updateSourceBinding(other.id, { expected_version: 0, template_parse_version_id: null, requirement_parse_version_ids: [parse.id] }),
    ).rejects.toMatchObject({ code: "MATERIAL_BINDING_INVALID" });
  });

  it("来源绑定CAS与不可变历史固定旧解析，新解析不追改绑定", async () => {
    vi.useFakeTimers();
    const { api, projectId, receipt, parse } = await parsed("template");
    expect((await api.materials.sourceBinding(projectId)).version).toBe(0);
    const input = { expected_version: 0, template_parse_version_id: parse.id, requirement_parse_version_ids: [parse.id] };
    const updates = await Promise.allSettled([api.materials.updateSourceBinding(projectId, input), api.materials.updateSourceBinding(projectId, input)]);
    expect(updates.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(updates.find((value) => value.status === "rejected")?.reason).toMatchObject({ code: "MATERIAL_BINDING_CONFLICT" });
    const reparse = await api.materials.reparse(projectId, receipt.material.id, receipt.original.id, { expected_parse_id: parse.id }, "new-parse");
    await vi.advanceTimersByTimeAsync(2500);
    await api.jobs.get(reparse.id);
    expect(await api.materials.sourceBinding(projectId)).toMatchObject({ version: 1, template_parse_version_id: parse.id });
    await api.materials.updateSourceBinding(projectId, { expected_version: 1, template_parse_version_id: null, requirement_parse_version_ids: [] });
    expect((await api.materials.sourceBindingVersion(projectId, 1)).template_parse_version_id).toBe(parse.id);
    await api.materials.update(projectId, receipt.material.id, { expected_version: 1, linked: false });
    await expect(api.materials.updateSourceBinding(projectId, { ...input, expected_version: 2 })).rejects.toMatchObject({ code: "MATERIAL_BINDING_INVALID" });
    expect((await api.materials.sourceBindingVersions(projectId)).total).toBe(2);
  });

  it("Mock的DOCX和PDF明确失败，原件仍可完整下载", async () => {
    vi.useFakeTimers();
    const { api, projectId } = await setup();
    for (const [file_type, text] of [
      ["docx", "PKsynthetic-docx"],
      ["pdf", "%PDF-synthetic"],
    ] as const) {
      const receipt = await api.materials.upload(
        projectId,
        upload({ filename: `合成.${file_type}`, file_type, content_base64: encode(text) }),
        `unsupported-${file_type}`,
      );
      await vi.advanceTimersByTimeAsync(2500);
      expect(await api.jobs.get(receipt.job.id)).toMatchObject({ status: "failed", error_code: "MATERIAL_UNSUPPORTED_TYPE", artifacts: [] });
      expect(await (await api.materials.download(projectId, receipt.material.id, receipt.original.id)).text()).toBe(text);
    }
  });

  it("上传名称路径、编码和类型检查在两适配器一致拒绝，8MiB边界有界", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { api, projectId } = await setup();
    const adapters = [api, createServices({ mode: "http", instanceId: "material-invalid", fetch: fetcher })];
    for (const adapter of adapters)
      for (const input of [
        upload({ filename: "../bad.txt" }),
        upload({ content_base64: "AB==" }),
        upload({ content_base64: "%%%=" }),
        upload({ file_type: "docx", filename: "fake.docx" }),
      ])
        await expect(adapter.materials.upload(projectId, input, crypto.randomUUID())).rejects.toBeInstanceOf(Error);
    expect(fetcher).not.toHaveBeenCalled();
    const accepted = "A".repeat(MATERIAL_MAX_BYTES - 2);
    expect(materialBytes(btoa(accepted)).byteLength).toBe(MATERIAL_MAX_BYTES - 2);
    expect(() => materialBytes(btoa("A".repeat(MATERIAL_MAX_BYTES + 1)))).toThrow();
  });

  it("HTTP二进制下载校验摘要，不将损坏或超限字节交给用户", async () => {
    const { api: simulated, projectId } = await setup();
    const receipt = await simulated.materials.upload(projectId, upload(), "download-source");
    const bytes = materialBytes(upload().content_base64);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(receipt.original))
      .mockResolvedValueOnce(new Response(bytes, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(bytes.length) } }));
    const http = createServices({ mode: "http", instanceId: "binary-http", fetch: fetcher });
    expect(new Uint8Array(await (await http.materials.download(projectId, receipt.material.id, receipt.original.id)).arrayBuffer())).toEqual(bytes);
    expect(fetcher.mock.calls[1]![1]).toMatchObject({ credentials: "same-origin", redirect: "error", cache: "no-store" });
    fetcher.mockResolvedValueOnce(json(receipt.original)).mockResolvedValueOnce(new Response(new Uint8Array(bytes.length).fill(65)));
    await expect(http.materials.download(projectId, receipt.material.id, receipt.original.id)).rejects.toMatchObject({ code: "MATERIAL_ORIGINAL_CORRUPT" });
    fetcher
      .mockResolvedValueOnce(json(receipt.original))
      .mockResolvedValueOnce(new Response("x", { headers: { "Content-Length": String(MATERIAL_MAX_BYTES + 1) } }));
    await expect(http.materials.download(projectId, receipt.material.id, receipt.original.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("独立解析通道读取合法大文本，拒绝超预算响应；错身份不能成功", async () => {
    vi.useFakeTimers();
    const { receipt, parse, projectId } = await parsed();
    const large: MaterialParseRead = { ...parse, result: { ...parse.result, plain_text: "合".repeat(400_000) } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(large));
    const http = createServices({ mode: "http", instanceId: "large-parse", fetch: fetcher });
    expect((await http.materials.parse(projectId, receipt.material.id, receipt.original.id, parse.id)).result.plain_text.length).toBe(400_000);
    fetcher.mockResolvedValueOnce(
      json({ ...parse, result: { ...parse.result, anchors: parse.result.anchors.map((anchor) => ({ ...anchor, original_version_id: crypto.randomUUID() })) } }),
    );
    await expect(http.materials.parse(projectId, receipt.material.id, receipt.original.id, parse.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    fetcher.mockResolvedValueOnce(new Response("{}", { headers: { "Content-Length": String(MATERIAL_PARSE_TRANSPORT_BYTES + 1) } }));
    await expect(http.materials.parse(projectId, receipt.material.id, receipt.original.id, parse.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    fetcher.mockResolvedValueOnce(json({ ...receipt.material, project_id: crypto.randomUUID() }));
    await expect(http.materials.get(projectId, receipt.material.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
