import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createPinia, setActivePinia } from "pinia";
import { makeProject, usePreviewWorkspaceStore } from "../../src/lab/state/previewWorkspace.ts";
import { parsePreviewBackup, safeDocumentHtml, serializePreviewBackup, stopRestoredRuns, normalizeRestoredModules } from "../../src/lab/state/previewBackup.ts";
import { createLibraryState, validateLibraryState } from "../../src/lab/state/libraryState.ts";
import { cancelPreviewJob, finishPreviewJob, type PreviewJob } from "../../src/lab/state/jobState.ts";

beforeEach(() => setActivePinia(createPinia()));
describe("预览项目与备份保护", () => {
  it("恢复处理中资料追加合法版本并保留历史，再次备份仍可读", () => {
    const project = makeProject();
    const library = createLibraryState();
    project.modules.library = library;
    const material = library.materials.find((m) => m.status === "processing")!;
    const originalVersion = material.version;
    normalizeRestoredModules(project.modules);
    expect(material.status).toBe("failed");
    expect(material.cancelled).toBe(true);
    expect(material.version).toBe(originalVersion + 1);
    expect(material.versions.find((v) => v.version === originalVersion)!.status).toBe("processing");
    expect(validateLibraryState(library)).toBe(true);
    expect(parsePreviewBackup(serializePreviewBackup(project)).modules.library).toBeDefined();
  });
  it("空白项目标准未绑定仍能备份，正常编辑器链接可恢复", () => {
    const project = makeProject("空项目", true);
    expect(project.templateVersion).toBe(0);
    expect(project.requirementVersion).toBe(0);
    const html = '<p><a href="https://example.invalid/source" target="_blank" rel="noopener noreferrer">自制来源</a></p>';
    project.document.html = html;
    project.document.history[0]!.html = html;
    expect(parsePreviewBackup(serializePreviewBackup(project)).document.html).toBe(html);
    expect(safeDocumentHtml('<a href="javascript:alert(1)">x</a>')).toBe(false);
    expect(safeDocumentHtml('<a href="&#106;avascript:alert(1)">x</a>')).toBe(false);
  });
  it("项目切换隔离正文和模块状态，版本追加而不覆盖历史", () => {
    const workspace = usePreviewWorkspaceStore();
    const first = workspace.activeId;
    workspace.moduleState("temporary", () => ({ value: "A" }));
    const original = workspace.current.document.html;
    workspace.createProject("自制项目B");
    expect(workspace.current.document.html).toBe("<p></p>");
    expect(workspace.moduleState("temporary", () => ({ value: "B" })).value).toBe("B");
    workspace.saveDocument("<p>独立正文</p>");
    expect(workspace.current.document.history).toHaveLength(2);
    workspace.switchProject(first);
    expect(workspace.current.document.html).toBe(original);
    expect(workspace.moduleState("temporary", () => ({ value: "" })).value).toBe("A");
  });
  it("合法项目备份能往返，损坏结构拒绝且不接触当前项目", () => {
    const project = makeProject();
    const raw = serializePreviewBackup(project);
    expect(parsePreviewBackup(raw)).toEqual(project);
    expect(() => parsePreviewBackup("{broken")).toThrow();
    const bad = JSON.parse(raw);
    bad.project.document.version = 999;
    expect(() => parsePreviewBackup(JSON.stringify(bad))).toThrow();
    expect(project.document.version).toBe(13);
  });
  it("拒绝执行内容和未知模块，保留正常锁定文字与表格", () => {
    expect(safeDocumentHtml('<p><span data-ai-lock="true">1200 [1]</span></p><table><tbody><tr><td>1</td></tr></tbody></table>')).toBe(true);
    for (const html of ["<script>alert(1)</script>", '<p onclick="alert(1)">x</p>', '<img src="https://example.invalid/a">'])
      expect(safeDocumentHtml(html)).toBe(false);
    const p = makeProject();
    p.modules.unknown = {};
    expect(() => parsePreviewBackup(serializePreviewBackup(p))).toThrow();
  });
  it("恢复的运行标为取消，不恢复计时器", () => {
    const module = { run: { status: "running", diagnosis: "" }, feedback: { splitStatus: "queued" }, history: [{ status: "done" }] };
    stopRestoredRuns(module);
    expect(module.run.status).toBe("cancelled");
    expect(module.feedback.splitStatus).toBe("cancelled");
    expect(module.history[0]!.status).toBe("done");
  });
  it("取消之后迟到结果不能完成任务，新的执行令牌才可完成", () => {
    const job: PreviewJob = { id: "j", title: "test", kind: "test", status: "running", attempt: 1, input: "", diagnosis: "", at: "", route: "", token: 1 };
    cancelPreviewJob(job);
    finishPreviewJob(job, 1, false);
    expect(job.status).toBe("cancelled");
    job.status = "running";
    job.token = 3;
    finishPreviewJob(job, 3, true);
    expect(job.status).toBe("failed");
  });
});
