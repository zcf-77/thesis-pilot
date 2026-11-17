import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createServices } from "../../src/services/index.ts";
import { ApiError } from "../../src/services/errors.ts";
import { createHttpOfficeImports } from "../../src/services/httpOfficeImports.ts";
import { checkExport, checkExportOptions, createHttpExports } from "../../src/services/httpExports.ts";
import { serviceJobTitle } from "../../src/lab/state/serviceJobs.ts";
import type { ExportRead, OfficeImportRead } from "../../src/services/contracts/api.generated.ts";

afterEach(() => vi.useRealTimers());

// 自制的最小 DOCX 字节（只需 ZIP 头通过资料类型检查；模拟服务不解析内容）。
const DOCX = btoa("PK\u0003\u0004synthetic-thesis");
async function seeded() {
  const api = createServices({ mode: "mock", instanceId: `office-${crypto.randomUUID()}` });
  const project = await api.projects.create({ name: "合成 Word 导入项目" });
  const upload = await api.materials.upload(
    project.id,
    { name: "合成论文", filename: "合成论文.docx", file_type: "docx", kind: "other", content_base64: DOCX },
    crypto.randomUUID(),
  );
  return { api, project, materialId: upload.material.id, originalId: upload.original.id };
}

describe("Word 导入服务（同契约模拟）", () => {
  it("固定原件转换为不可变预览，确认后才建立正式稿；同一确认命令幂等，异样请求冲突", async () => {
    vi.useFakeTimers();
    const { api, project, materialId, originalId } = await seeded();
    const queued = await api.officeImports.create(project.id, { material_id: materialId, original_id: originalId }, "imp-1");
    expect(queued).toMatchObject({ status: "queued", preview: null, material_id: materialId, original_id: originalId, source_job_id: null });
    expect((await api.officeImports.create(project.id, { material_id: materialId, original_id: originalId }, "imp-1")).job_id).toBe(queued.job_id);
    await expect(api.documents.current(project.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(api.officeImports.confirm(project.id, queued.job_id, { command_id: crypto.randomUUID(), mode: "create" })).rejects.toMatchObject({
      code: "OFFICE_IMPORT_NOT_READY",
    });

    await vi.advanceTimersByTimeAsync(2500);
    const done = await api.officeImports.get(project.id, queued.job_id);
    expect(done.status).toBe("succeeded");
    expect(done.preview).toMatchObject({ filename: "合成论文.docx", can_create: true, can_append: false, existing_document_id: null });
    expect(done.preview!.chapters.map((item) => item.title)).toEqual(["合成论文"]);
    expect(done.preview!.losses[0]).toMatchObject({ action: "noted", label: expect.stringContaining("模拟") });
    const job = (await api.jobs.list({ project_id: project.id })).items.find((item) => item.id === queued.job_id)!;
    expect(serviceJobTitle(job)).toBe("Word 导入");
    await expect(api.documents.current(project.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });

    const command = crypto.randomUUID();
    const receipt = await api.officeImports.confirm(project.id, queued.job_id, { command_id: command, mode: "create" });
    expect(receipt).toMatchObject({ command_id: command, mode: "create", document_version: 1 });
    expect(await api.officeImports.confirm(project.id, queued.job_id, { command_id: command, mode: "create" })).toEqual(receipt);
    await expect(api.officeImports.confirm(project.id, queued.job_id, { command_id: command, mode: "new_version", expected_version: 1 })).rejects.toMatchObject(
      { code: "OFFICE_IMPORT_COMMAND_CONFLICT" },
    );
    const versions = await api.documents.versions(project.id, receipt.document_id);
    expect(versions.items.map((item) => item.source)).toEqual(["office_import"]);
    expect(await api.officeImports.source(project.id, receipt.document_id)).toMatchObject({ document_version: 1, filename: "合成论文.docx" });

    const after = await api.officeImports.get(project.id, queued.job_id);
    expect(after.preview).toMatchObject({ can_create: false, can_append: true, existing_version: 1 });
  });

  it("新版本 CAS、来源基线、取消与按原输入重试，跨项目与非 Word 原件被拒绝", async () => {
    vi.useFakeTimers();
    const { api, project, materialId, originalId } = await seeded();
    const first = await api.officeImports.create(project.id, { material_id: materialId, original_id: originalId }, "a");
    await vi.advanceTimersByTimeAsync(2500);
    const created = await api.officeImports.confirm(project.id, first.job_id, { command_id: crypto.randomUUID(), mode: "create" });

    const second = await api.officeImports.create(project.id, { material_id: materialId, original_id: originalId }, "b");
    const cancelled = await api.officeImports.cancel(project.id, second.job_id);
    expect(cancelled.status).toBe("cancelled");
    const retried = await api.officeImports.retry(project.id, second.job_id, "b-retry");
    expect(retried).toMatchObject({ source_job_id: second.job_id, status: "queued", original_sha256: second.original_sha256 });
    await vi.advanceTimersByTimeAsync(2500);
    await expect(
      api.officeImports.confirm(project.id, retried.job_id, { command_id: crypto.randomUUID(), mode: "new_version", expected_version: 7 }),
    ).rejects.toMatchObject({ code: "DOCUMENT_VERSION_CONFLICT" });
    await expect(api.officeImports.confirm(project.id, retried.job_id, { command_id: crypto.randomUUID(), mode: "new_version" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const appended = await api.officeImports.confirm(project.id, retried.job_id, {
      command_id: crypto.randomUUID(),
      mode: "new_version",
      expected_version: 1,
    });
    expect(appended.document_version).toBe(2);
    expect((await api.officeImports.source(project.id, created.document_id, 1)).document_version).toBe(1);
    expect((await api.officeImports.source(project.id, created.document_id, 2)).document_version).toBe(2);

    const other = await api.projects.create({ name: "另一个项目" });
    await expect(api.officeImports.get(other.id, first.job_id)).rejects.toMatchObject({ code: "OFFICE_IMPORT_NOT_FOUND" });
    const text = await api.materials.upload(
      project.id,
      { name: "文本", filename: "a.txt", file_type: "text", kind: "other", content_base64: btoa("plain") },
      "text-upload",
    );
    await expect(api.officeImports.create(project.id, { material_id: text.material.id, original_id: text.original.id }, "text-import")).rejects.toMatchObject({
      code: "OFFICE_IMPORT_UNSUPPORTED_TYPE",
    });
    await expect(api.jobs.create({ project_id: project.id, kind: "office_import" }, "generic")).rejects.toMatchObject({ code: "JOB_KIND_UNAVAILABLE" });
  });

  it("没有导入原件的正文：来源查询返回未找到，保留原件导出被拒绝，重新生成产出标明模拟的占位文件与报告", async () => {
    vi.useFakeTimers();
    const { api, project } = await seeded();
    const document = await api.documents.createBlank(project.id);
    await expect(api.officeImports.source(project.id, document.id)).rejects.toMatchObject({ code: "OFFICE_IMPORT_SOURCE_NOT_FOUND" });
    await expect(
      api.exports.exportDocument(project.id, { document_id: document.id, document_version: 1, format: "docx", office_mode: "preserve" }, "keep"),
    ).rejects.toMatchObject({ code: "EXPORT_OFFICE_SOURCE_MISSING" });
    await expect(api.exports.exportDocument(project.id, { document_id: document.id, document_version: 1, format: "pdf" }, "no-mode")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      api.exports.exportDocument(
        project.id,
        { document_id: document.id, document_version: 1, format: "pdf", office_mode: "regenerate", track_changes: true },
        "bad-track",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const queued = await api.exports.exportDocument(
      project.id,
      { document_id: document.id, document_version: 1, format: "docx", office_mode: "regenerate" },
      "regen",
    );
    expect(queued).toMatchObject({ format: "docx", office_mode: "regenerate", track_changes: false, report: null });
    await vi.advanceTimersByTimeAsync(2500);
    const done = await api.exports.get(project.id, queued.job_id);
    expect(done.report).toMatchObject({ mode: "regenerate", baseline_version: null, warnings: [{ code: "MOCK_PLACEHOLDER" }] });
    const file = await api.exports.download(project.id, queued.job_id);
    expect(file.filename).toBe("论文正文-v1.docx");
    expect(file.blob.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(await file.blob.text()).toContain("本地模拟服务占位文件");
  });

  it("导入后的版本可保留原件导出，带修订标记写入文件名与报告", async () => {
    vi.useFakeTimers();
    const { api, project, materialId, originalId } = await seeded();
    const job = await api.officeImports.create(project.id, { material_id: materialId, original_id: originalId }, "x");
    await vi.advanceTimersByTimeAsync(2500);
    const receipt = await api.officeImports.confirm(project.id, job.job_id, { command_id: crypto.randomUUID(), mode: "create" });
    const queued = await api.exports.exportDocument(
      project.id,
      { document_id: receipt.document_id, document_version: 1, format: "docx", office_mode: "preserve", track_changes: true },
      "tracked",
    );
    await vi.advanceTimersByTimeAsync(2500);
    const done = await api.exports.get(project.id, queued.job_id);
    expect(done).toMatchObject({ office_mode: "preserve", track_changes: true, report: { mode: "preserve", track_changes: true, baseline_version: 1 } });
    expect((await api.exports.download(project.id, queued.job_id)).filename).toBe("论文正文-修订版-v1.docx");
  });
});

const PROJECT = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";
const read = (changes: Partial<OfficeImportRead> = {}): OfficeImportRead => ({
  job_id: JOB,
  project_id: PROJECT,
  status: "queued",
  attempt: 0,
  material_id: "44444444-4444-4444-8444-444444444444",
  original_id: "55555555-5555-4555-8555-555555555555",
  original_sha256: "a".repeat(64),
  source_job_id: null,
  error_code: null,
  preview: null,
  created_at: "2026-11-19T00:00:00Z",
  updated_at: "2026-11-19T00:00:00Z",
  ...changes,
});
const preview = (changes: Partial<NonNullable<OfficeImportRead["preview"]>> = {}): NonNullable<OfficeImportRead["preview"]> => ({
  import_id: "66666666-6666-4666-8666-666666666666",
  filename: "合成.docx",
  original_sha256: "a".repeat(64),
  converter: "office-server",
  block_count: 1,
  paragraph_count: 1,
  table_count: 0,
  image_count: 0,
  text_characters: 4,
  chapters: [],
  chapters_truncated: false,
  objects: [],
  losses: [],
  existing_document_id: null,
  existing_version: null,
  can_create: true,
  can_append: false,
  append_blocked_reason: null,
  ...changes,
});

describe("Word 导入与导出 HTTP 响应校验", () => {
  function fake(response: unknown) {
    const calls: { path: string; method?: string; body?: unknown; headers?: Record<string, string> }[] = [];
    const request = (async (path: string, _schema: string, method?: string, body?: unknown, _signal?: AbortSignal, headers?: Record<string, string>) => {
      calls.push({ path, method, body, headers });
      return structuredClone(response);
    }) as never;
    return { calls, service: createHttpOfficeImports(request) };
  }

  it("项目、任务、预览出现时机与建立/追加可选性不一致时停止使用结果", async () => {
    await expect(fake(read({ project_id: DOC })).service.get(PROJECT, JOB)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(fake(read({ preview: preview() })).service.get(PROJECT, JOB)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(fake(read({ status: "succeeded", preview: preview({ original_sha256: "b".repeat(64) }) })).service.get(PROJECT, JOB)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(
      fake(read({ status: "succeeded", preview: preview({ existing_document_id: DOC, existing_version: 2, can_create: true }) })).service.get(PROJECT, JOB),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(
      fake(read({ status: "succeeded", preview: preview({ existing_document_id: DOC, existing_version: 2, can_create: false }) })).service.get(PROJECT, JOB),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    const ok = read({
      status: "succeeded",
      preview: preview({ existing_document_id: DOC, existing_version: 2, can_create: false, append_blocked_reason: "需先升级正文结构" }),
    });
    expect(await fake(ok).service.get(PROJECT, JOB)).toEqual(ok);
  });

  it("创建带幂等键，重试必须指向原任务，确认校验模式与版本，来源查询按版本", async () => {
    const created = fake(read());
    await created.service.create(PROJECT, { material_id: read().material_id, original_id: read().original_id }, "k-1");
    expect(created.calls[0]).toMatchObject({ path: `/projects/${PROJECT}/office-imports`, method: "POST", headers: { "Idempotency-Key": "k-1" } });
    await expect(fake(read()).service.retry(PROJECT, JOB, "k-2")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    const command = crypto.randomUUID();
    const confirm = fake({ command_id: command, import_id: preview().import_id, document_id: DOC, document_version: 4, mode: "new_version" });
    expect(await confirm.service.confirm(PROJECT, JOB, { command_id: command, mode: "new_version", expected_version: 3 })).toMatchObject({
      document_version: 4,
    });
    await expect(confirm.service.confirm(PROJECT, JOB, { command_id: command, mode: "new_version", expected_version: 2 })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(confirm.service.confirm(PROJECT, JOB, { command_id: command, mode: "create", expected_version: 2 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    const source = fake({
      document_id: DOC,
      document_version: 2,
      import_id: preview().import_id,
      material_id: read().material_id,
      original_id: read().original_id,
      original_sha256: "a".repeat(64),
      filename: "合成.docx",
      imported_at: "2026-11-19T00:00:00Z",
    });
    await source.service.source(PROJECT, DOC, 5);
    expect(source.calls[0]!.path).toBe(`/projects/${PROJECT}/documents/${DOC}/office-source?version=5`);
    await expect(source.service.source(PROJECT, DOC, 1)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  const exported = (changes: Partial<ExportRead> = {}): ExportRead => ({
    job_id: JOB,
    project_id: PROJECT,
    kind: "document_export",
    status: "succeeded",
    attempt: 1,
    format: "docx",
    office_mode: "preserve",
    track_changes: false,
    document_id: DOC,
    document_version: 3,
    from_version: null,
    source_job_id: null,
    error_code: null,
    file: null,
    report: {
      mode: "preserve",
      track_changes: false,
      baseline_version: 2,
      applied_changes: 1,
      unsupported_changes: [],
      losses: [],
      warnings: [],
      warning_total: 0,
    },
    created_at: "2026-11-19T00:00:00Z",
    updated_at: "2026-11-19T00:00:00Z",
    ...changes,
  });

  it("导出选项与服务端规则一致，响应的模式、修订标记与报告必须对应", async () => {
    expect(() => checkExportOptions({ format: "docx" })).toThrow(ApiError);
    expect(() => checkExportOptions({ format: "html", office_mode: "regenerate" })).toThrow(ApiError);
    expect(() => checkExportOptions({ format: "pdf", office_mode: "preserve", track_changes: true })).toThrow(ApiError);
    expect(() => checkExportOptions({ format: "docx", office_mode: "preserve", track_changes: true })).not.toThrow();
    expect(checkExport(exported(), PROJECT)).toBeTruthy();
    expect(() => checkExport(exported({ office_mode: null }), PROJECT)).toThrow(ApiError);
    expect(() => checkExport(exported({ status: "running" }), PROJECT)).toThrow(ApiError);
    expect(() => checkExport(exported({ report: { ...exported().report!, mode: "regenerate" } }), PROJECT)).toThrow(ApiError);
    expect(() => checkExport(exported({ report: { ...exported().report!, baseline_version: 4 } }), PROJECT)).toThrow(ApiError);
    expect(() => checkExport(exported({ format: "pdf", track_changes: true, report: null }), PROJECT)).toThrow(ApiError);

    const calls: unknown[] = [];
    const request = (async (_path: string, _schema: string, _method?: string, body?: unknown) => {
      calls.push(body);
      return exported({ status: "queued", report: null, office_mode: "regenerate" });
    }) as never;
    const service = createHttpExports(request, request);
    await expect(
      service.exportDocument(PROJECT, { document_id: DOC, document_version: 3, format: "docx", office_mode: "preserve" }, "k"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(calls[0]).toMatchObject({ format: "docx", office_mode: "preserve" });
  });
});
