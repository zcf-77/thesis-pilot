import { createHash } from "node:crypto";
import { effectScope, type EffectScope } from "vue";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createServices } from "../../src/services/index.ts";
import { sha256Sync } from "../../src/services/mockExports.ts";
import { serviceJobTitle } from "../../src/lab/state/serviceJobs.ts";
import { resolveWorkspaceRoute } from "../../src/workspace/workspaceRoutes.ts";
import { exportFailure, exportTitle, useExports } from "../../src/workspace/export/useExports.ts";
import type { DocumentContent_Input, ExportRead } from "../../src/services/contracts/api.generated.ts";

const scopes: EffectScope[] = [];
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.useRealTimers();
});
const doc = (text: string): DocumentContent_Input => ({
  schema_version: 1 as const,
  json: {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1, chapterId: "c1" }, content: [{ type: "text", text: "合成标题" }] },
      { type: "paragraph", content: [{ type: "text", text }] },
    ],
  },
});
async function seeded() {
  const api = createServices({ mode: "mock", instanceId: `exports-${crypto.randomUUID()}` });
  const project = await api.projects.create({ name: "合成导出项目" });
  const document = await api.documents.import(project.id, { content: doc("初稿") });
  await api.documents.save(project.id, document.id, { expected_version: 1, content: doc("第二稿") });
  return { api, project, document };
}

describe("导出服务与页面状态", () => {
  it("同步 SHA-256 与 Node 实现一致", () => {
    for (const value of ["", "abc", "中文导出🙂", "x".repeat(1000)]) {
      const bytes = new TextEncoder().encode(value);
      expect(sha256Sync(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });

  it("固定版本导出完成后可下载，后续保存不改变已入队版本，且与任务托盘同源", async () => {
    vi.useFakeTimers();
    const { api, project, document } = await seeded();
    const queued = await api.exports.exportDocument(project.id, { document_id: document.id, document_version: 1, format: "html" }, "doc-1");
    expect(queued).toMatchObject({ kind: "document_export", status: "queued", document_version: 1, file: null });
    expect(await api.exports.exportDocument(project.id, { document_id: document.id, document_version: 1, format: "html" }, "doc-1")).toMatchObject({
      job_id: queued.job_id,
    });
    await expect(api.exports.exportDocument(project.id, { document_id: document.id, document_version: 1, format: "txt" }, "doc-1")).rejects.toMatchObject({
      code: "JOB_IDEMPOTENCY_CONFLICT",
    });
    await expect(api.exports.download(project.id, queued.job_id)).rejects.toMatchObject({ code: "EXPORT_FILE_NOT_READY" });
    await vi.advanceTimersByTimeAsync(2500);
    const job = (await api.jobs.list({ project_id: project.id })).items.find((item) => item.id === queued.job_id)!;
    expect(serviceJobTitle(job)).toBe("正文导出");
    const done = await api.exports.get(project.id, queued.job_id);
    expect(done.status).toBe("succeeded");
    const file = await api.exports.download(project.id, queued.job_id);
    const text = await file.blob.text();
    expect(file.filename).toBe("论文正文-v1.html");
    expect(text).toContain("初稿");
    expect(text).not.toContain("第二稿");
    expect(sha256Sync(new TextEncoder().encode(text))).toBe(done.file!.sha256);
  });

  it("修改说明默认固定到创建时的当前版本，重试沿用原范围；范围错误与跨项目访问被拒绝", async () => {
    vi.useFakeTimers();
    const { api, project, document } = await seeded();
    const other = await api.projects.create({ name: "另一个项目" });
    const record = await api.exports.changeRecord(project.id, { document_id: document.id, from_version: 1, format: "markdown" }, "change-1");
    expect([record.from_version, record.document_version]).toEqual([1, 2]);
    await api.documents.save(project.id, document.id, { expected_version: 2, content: doc("第三稿") });
    await api.exports.cancel(project.id, record.job_id);
    const retried = await api.exports.retry(project.id, record.job_id, "change-retry");
    expect(retried).toMatchObject({ source_job_id: record.job_id, from_version: 1, document_version: 2 });
    await vi.advanceTimersByTimeAsync(2500);
    const text = await (await api.exports.download(project.id, retried.job_id)).blob.text();
    expect(text).toContain("不代表导师已审阅或认可");
    expect(text).not.toContain("v3");
    await expect(
      api.exports.changeRecord(project.id, { document_id: document.id, from_version: 3, to_version: 2, format: "html" }, "bad-range"),
    ).rejects.toMatchObject({ code: "EXPORT_RANGE_INVALID" });
    await expect(api.exports.get(other.id, record.job_id)).rejects.toMatchObject({ code: "EXPORT_NOT_FOUND" });
    await expect(api.jobs.create({ project_id: project.id, kind: "document_export" }, "generic")).rejects.toMatchObject({ code: "JOB_KIND_UNAVAILABLE" });
  });

  it("页面状态：轮询到完成、迟到的旧列表不覆盖新状态、卸载后停止", async () => {
    vi.useFakeTimers();
    const { api, project } = await seeded();
    const scope = effectScope();
    scopes.push(scope);
    const state = scope.run(() => useExports(api, project.id))!;
    await state.load();
    expect(state.phase.value).toBe("ready");
    expect(state.versions.value.map((item: { version: number }) => item.version)).toEqual([2, 1]);
    const created = await state.exportDocument(2, "markdown");
    expect(created?.status).toBe("queued");
    expect(state.latestDocument.value?.job_id).toBe(created?.job_id);
    await vi.advanceTimersByTimeAsync(4000);
    expect(state.records.value[0]?.status).toBe("succeeded");
    const list = vi.spyOn(api.exports, "list");
    scope.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(list).not.toHaveBeenCalled();
  });

  it("超时后的重复点击复用同一幂等键，确定性失败后换新键", async () => {
    const { api, project } = await seeded();
    const scope = effectScope();
    scopes.push(scope);
    const state = scope.run(() => useExports(api, project.id))!;
    await state.load();
    const keys: string[] = [];
    const original = api.exports.exportDocument.bind(api.exports);
    let mode: "timeout" | "pass" = "timeout";
    vi.spyOn(api.exports, "exportDocument").mockImplementation(async (projectId, input, key, signal) => {
      keys.push(key);
      if (mode === "timeout") {
        const { ApiError } = await import("../../src/services/errors.ts");
        throw new ApiError("REQUEST_TIMEOUT");
      }
      return original(projectId, input, key, signal);
    });
    await state.exportDocument(1, "txt");
    expect(state.actionError.value?.scope).toBe("document");
    mode = "pass";
    await state.exportDocument(1, "txt");
    expect(keys[0]).toBe(keys[1]);
    await state.exportDocument(1, "txt");
    expect(keys[2]).not.toBe(keys[1]);
  });

  it("失败与取消文案说明发生了什么，不出现导师认可", () => {
    const base = { kind: "change_record", from_version: 1, document_version: 3, format: "html" } as ExportRead;
    expect(exportTitle(base)).toBe("修改说明 v1–v3");
    expect(exportFailure({ ...base, status: "failed", error_code: "EXPORT_SOURCE_CHANGED" })).toContain("不一致");
    expect(exportFailure({ ...base, status: "cancelled", error_code: null })).toBe("导出已取消，未生成文件。");
  });

  it("导出路由绑定项目", () => {
    const id = crypto.randomUUID();
    expect(resolveWorkspaceRoute({ name: "workspace-export", params: { projectId: id.toUpperCase() }, query: {} }, "http:x")).toEqual({
      page: "export",
      projectId: id,
    });
    expect(resolveWorkspaceRoute({ name: "workspace-export", params: { projectId: "bad" }, query: {} }, "http:x")).toEqual({ page: "invalid" });
  });

  it("HTTP 下载校验摘要与项目身份，不信任损坏文件", async () => {
    const projectId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const body = "正文内容";
    const bytes = new TextEncoder().encode(body);
    const read = {
      job_id: jobId,
      project_id: projectId,
      kind: "document_export",
      status: "succeeded",
      attempt: 1,
      format: "txt",
      document_id: crypto.randomUUID(),
      document_version: 1,
      from_version: null,
      source_job_id: null,
      error_code: null,
      file: {
        id: crypto.randomUUID(),
        filename: "论文正文-v1.txt",
        content_type: "text/plain; charset=utf-8",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byte_size: bytes.byteLength,
        created_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    let payload = bytes as Uint8Array<ArrayBuffer>;
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      (input instanceof Request ? input.url : input.toString()).endsWith("/download")
        ? new Response(payload, { headers: { "content-type": "text/plain; charset=utf-8", "content-length": String(payload.byteLength) } })
        : new Response(JSON.stringify(read), { headers: { "content-type": "application/json" } }),
    );
    const http = createServices({ mode: "http", instanceId: "exports-http", fetch: fetcher });
    const result = await http.exports.download(projectId, jobId);
    expect(result.filename).toBe("论文正文-v1.txt");
    expect(await result.blob.text()).toBe(body);
    payload = new TextEncoder().encode("正文内容！") as Uint8Array<ArrayBuffer>;
    read.file.byte_size = payload.byteLength;
    await expect(http.exports.download(projectId, jobId)).rejects.toMatchObject({ code: "EXPORT_FILE_CORRUPT" });
    await expect(http.exports.get(crypto.randomUUID(), jobId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
