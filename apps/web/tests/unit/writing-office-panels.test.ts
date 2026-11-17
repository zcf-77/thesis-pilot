import { effectScope, type EffectScope } from "vue";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createServices } from "../../src/services/index.ts";
import { ApiError } from "../../src/services/errors.ts";
import { useWritingImport } from "../../src/workspace/writing-import/useWritingImport.ts";
import { useWritingExport } from "../../src/workspace/writing-export/useWritingExport.ts";
import { exportFailure, exportNeedsRegenerate, reportSummary, useExports } from "../../src/workspace/export/useExports.ts";
import type { ExportRead } from "../../src/services/contracts/api.generated.ts";

const scopes: EffectScope[] = [];
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.useRealTimers();
});
function run<T>(factory: () => T): T {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(factory)!;
}
const docx = (name = "合成论文.docx") =>
  new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode("synthetic")])], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
async function seeded() {
  const api = createServices({ mode: "mock", instanceId: `panels-${crypto.randomUUID()}` });
  const project = await api.projects.create({ name: "合成写作面板项目" });
  return { api, project };
}

describe("写作页 Word 导入面板流程", () => {
  it("只接受 .docx；选文件后上传为资料并转换，预览出现前不改正文，确认后建立正式稿", async () => {
    vi.useFakeTimers();
    const { api, project } = await seeded();
    const flow = run(() => useWritingImport(api, project.id));
    flow.pickFile(new File(["plain"], "a.txt"));
    expect(flow.fileError.value).toContain(".docx");
    expect(flow.ready.value).toBe(false);
    flow.pickFile(docx());
    expect(flow.ready.value).toBe(true);
    await flow.start();
    expect(flow.job.value?.status).toBe("queued");
    expect((await api.materials.list(project.id)).items.map((item) => item.name)).toEqual(["合成论文"]);
    expect(flow.originals.value[0]?.filename).toBe("合成论文.docx");
    await vi.advanceTimersByTimeAsync(4000);
    expect(flow.job.value?.status).toBe("succeeded");
    expect(flow.preview.value?.can_create).toBe(true);
    await expect(api.documents.current(project.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    const receipt = await flow.confirm(null);
    expect(receipt).toMatchObject({ mode: "create", document_version: 1 });
    expect(flow.receipt.value?.document_version).toBe(1);
    expect((await api.documents.current(project.id)).version).toBe(1);
  });

  it("已有正式稿时作为新版本导入；确认结果未知时重按沿用同一命令标识", async () => {
    vi.useFakeTimers();
    const { api, project } = await seeded();
    const document = await api.documents.createBlank(project.id);
    await api.documents.upgradeSchema(project.id, document.id, { command_id: crypto.randomUUID(), expected_version: 1 });
    const flow = run(() => useWritingImport(api, project.id));
    flow.pickFile(docx());
    await flow.start();
    await vi.advanceTimersByTimeAsync(4000);
    expect(flow.preview.value).toMatchObject({ can_create: false, can_append: true, existing_version: 2 });
    const commands: string[] = [];
    const real = api.officeImports.confirm.bind(api.officeImports);
    let first = true;
    vi.spyOn(api.officeImports, "confirm").mockImplementation(async (projectId, jobId, input, signal) => {
      commands.push(input.command_id);
      if (first) {
        first = false;
        throw new ApiError("REQUEST_TIMEOUT");
      }
      return real(projectId, jobId, input, signal);
    });
    expect(await flow.confirm({ id: document.id, version: 2 })).toBeUndefined();
    expect(flow.error.value).toContain("同一操作标识");
    const receipt = await flow.confirm({ id: document.id, version: 2 });
    expect(receipt).toMatchObject({ mode: "new_version", document_version: 3 });
    expect(new Set(commands).size).toBe(1);
  });

  it("旧版正文不能追加，原因来自服务端预览；取消后按原输入重试", async () => {
    vi.useFakeTimers();
    const { api, project } = await seeded();
    await api.documents.createBlank(project.id);
    const flow = run(() => useWritingImport(api, project.id));
    flow.pickFile(docx());
    await flow.start();
    await flow.cancel();
    expect(flow.job.value?.status).toBe("cancelled");
    const cancelledId = flow.job.value!.job_id;
    await flow.retry();
    expect(flow.job.value).toMatchObject({ source_job_id: cancelledId, status: "queued" });
    await vi.advanceTimersByTimeAsync(4000);
    expect(flow.preview.value).toMatchObject({ can_append: false, append_blocked_reason: expect.stringContaining("升级正文结构") });
  });

  it("重新选择后旧任务的迟到响应不覆盖当前状态；再次打开面板时接续运行中的转换", async () => {
    vi.useFakeTimers();
    const { api, project } = await seeded();
    const flow = run(() => useWritingImport(api, project.id));
    flow.pickFile(docx());
    await flow.start();
    const started = flow.job.value!;
    let release!: (value: Awaited<ReturnType<typeof api.officeImports.get>>) => void;
    vi.spyOn(api.officeImports, "get").mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await vi.advanceTimersByTimeAsync(1300);
    flow.reset();
    // The old job's response arrives after the student went back to choosing a file.
    release({ ...started, status: "failed", error_code: "OFFICE_FAILED" });
    await Promise.resolve();
    expect(flow.job.value).toBeUndefined();

    const reopened = run(() => useWritingImport(api, project.id));
    await reopened.resume();
    expect(reopened.job.value?.job_id).toBe(started.job_id);
  });

  it("从资料中的 Word 原件发起，不重复上传", async () => {
    const { api, project } = await seeded();
    await api.materials.upload(
      project.id,
      { name: "已上传", filename: "已上传.docx", file_type: "docx", kind: "other", content_base64: btoa("PK\u0003\u0004x") },
      "pre",
    );
    const flow = run(() => useWritingImport(api, project.id));
    await flow.loadOriginals();
    expect(flow.originals.value.map((item) => item.filename)).toEqual(["已上传.docx"]);
    flow.chooseOriginal(flow.originals.value[0]!.value);
    const upload = vi.spyOn(api.materials, "upload");
    await flow.start();
    expect(upload).not.toHaveBeenCalled();
    expect(flow.job.value?.original_id).toBe(flow.originals.value[0]!.originalId);
  });
});

describe("写作页快捷导出与导出页 Word/PDF 选项", () => {
  async function imported() {
    vi.useFakeTimers();
    const { api, project } = await seeded();
    const flow = run(() => useWritingImport(api, project.id));
    flow.pickFile(docx());
    await flow.start();
    await vi.advanceTimersByTimeAsync(4000);
    const receipt = (await flow.confirm(null))!;
    return { api, project, receipt };
  }

  it("有导入原件时默认保留原件并可带修订标记；没有原件时只能重新生成", async () => {
    const { api, project, receipt } = await imported();
    const panel = run(() => useWritingExport(api, project.id));
    await panel.load({ id: receipt.document_id, version: 1 });
    expect(panel.source.value.status).toBe("ready");
    expect(panel.effectiveMode.value).toBe("preserve");
    panel.trackChanges.value = true;
    const created = await panel.submit();
    expect(created).toMatchObject({ format: "docx", office_mode: "preserve", track_changes: true });
    panel.format.value = "pdf";
    expect(panel.tracked.value).toBe(false);

    const blank = await seeded();
    const document = await blank.api.documents.createBlank(blank.project.id);
    const other = run(() => useWritingExport(blank.api, blank.project.id));
    await other.load({ id: document.id, version: 1 });
    expect(other.source.value.status).toBe("none");
    other.mode.value = "preserve";
    expect(other.effectiveMode.value).toBe("regenerate");
    expect(await other.submit()).toMatchObject({ office_mode: "regenerate", track_changes: false });
  });

  it("较早版本的来源查询迟到时不覆盖当前版本的结果", async () => {
    const { api, project, receipt } = await imported();
    const panel = run(() => useWritingExport(api, project.id));
    let release!: (value: never) => void;
    vi.spyOn(api.officeImports, "source").mockImplementationOnce(() => new Promise((_, reject) => (release = reject as never)));
    const stale = panel.load({ id: receipt.document_id, version: 1 });
    await panel.load({ id: receipt.document_id, version: 1 });
    release(new ApiError("OFFICE_IMPORT_SOURCE_NOT_FOUND", { status: 404 }) as never);
    await stale;
    expect(panel.source.value.status).toBe("ready");
  });

  it("导出页读取所选版本的原件、按选项导出；保留原件失败可改为重新生成", async () => {
    const { api, project } = await imported();
    const state = run(() => useExports(api, project.id));
    await state.load();
    await state.loadOfficeSource(1);
    expect(state.officeSource.value.status).toBe("ready");
    const created = await state.exportDocument(1, "docx", { office_mode: "preserve", track_changes: true });
    expect(created).toMatchObject({ office_mode: "preserve", track_changes: true });
    const pdf = await state.exportDocument(1, "pdf", { office_mode: "preserve", track_changes: true });
    expect(pdf).toMatchObject({ format: "pdf", track_changes: false });

    const failed = { ...pdf!, status: "failed", error_code: "OFFICE_PDF_UNSUPPORTED" } as ExportRead;
    expect(exportNeedsRegenerate(failed)).toBe(true);
    expect(exportFailure(failed)).toContain("未生成文件");
    const redone = await state.regenerate(failed);
    expect(redone).toMatchObject({ format: "pdf", office_mode: "regenerate", document_version: 1 });
    expect(
      reportSummary({
        mode: "preserve",
        track_changes: false,
        baseline_version: 1,
        applied_changes: 2,
        unsupported_changes: [],
        losses: [],
        warnings: [],
        warning_total: 0,
      }),
    ).toEqual(["已写入 2 处修改"]);
  });
});
