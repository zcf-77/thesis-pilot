import { describe, expect, it } from "vite-plus/test";
import { validateEditorSnapshot } from "../../src/lab/state/editorAdapter.ts";
import {
  archiveWritingCandidate,
  emptyWritingContext,
  validateWritingState,
  type WritingRequest,
  type WritingState,
} from "../../src/lab/state/writingState.ts";
import { assistantPreview, prepareTextPatches, captureFormatIntent, reconcileWritingContext } from "../../src/lab/services/writingAssistant.ts";
import { createLibraryState } from "../../src/lab/state/libraryState.ts";
import { captureWritingConstraints } from "../../src/lab/services/writingConstraints.ts";
const request: WritingRequest = {
  id: "r1",
  projectId: "p1",
  agent: "general",
  prompt: "更学术",
  version: 13,
  requirementVersion: 2,
  templateVersion: 3,
  chapter: "系统设计",
  selection: { from: 1, to: 5, text: "采用方案", valid: true },
  sources: [],
  config: [],
  at: "自制测试",
};
function state(): WritingState {
  return {
    sessions: (["general", "lit", "content", "format", "progress", "review"] as const).map((kind) => ({
      kind,
      draft: "",
      messages: [],
      status: "idle",
      error: "",
      lastPrompt: "",
      context: emptyWritingContext(),
    })),
    selectedAgent: "content",
    companion: "lit",
    multi: false,
    materialIds: [],
    decisions: [],
    candidate: {
      id: "c1",
      agent: "content",
      goal: "修改",
      scope: "选区",
      baseVersion: 13,
      currentVersion: 13,
      status: "pending",
      checks: [],
      basis: ["来源 v1"],
      hunks: [],
    },
    patches: [],
    beforeHtml: "<p>原文</p>",
    selection: request.selection,
    goal: "修改",
    replacement: "",
    history: [],
    request,
    revisionKind: "text",
  };
}
describe("写作结构与完整请求", () => {
  it("备份接受固定规范快照，拒绝伪造判定和混用正文版本", () => {
    const writing = state();
    writing.request = {
      ...request,
      constraints: captureWritingConstraints(createLibraryState(true), { requirementVersion: 2, templateVersion: 3, documentVersion: 13, html: "<p>正文</p>" }),
    };
    archiveWritingCandidate(writing);
    expect(validateWritingState(writing)).toBe(true);
    const invalid = JSON.parse(JSON.stringify(writing));
    invalid.request.constraints.requirements.rules[0].verdict = "fully-compliant";
    expect(validateWritingState(invalid)).toBe(false);
    writing.request.constraints!.documentVersion = 14;
    expect(validateWritingState(writing)).toBe(false);
    expect(writing.history![0]!.request!.constraints!.documentVersion).toBe(13);
  });
  it("A助手的旧选区被B修改后拒绝冒充当前版本，原范围保留", () => {
    const context = {
      ...emptyWritingContext(),
      selection: { from: 4, to: 8, text: "原来段落", valid: true },
      selectionVersion: 13,
      chapter: { id: "chapter-a", title: "甲章" },
    };
    expect(() =>
      reconcileWritingContext(
        context,
        14,
        () => "已经修改",
        () => ({ id: "chapter-a", title: "甲章" }),
      ),
    ).toThrow("重新选择文字");
    expect(context.selectionVersion).toBe(13);
    expect(context.selection.text).toBe("原来段落");
  });
  it("A范围仍一致时可承接新版本，但章节取A范围而非B光标", () => {
    const context = {
      ...emptyWritingContext(),
      selection: { from: 4, to: 8, text: "原来段落", valid: true },
      selectionVersion: 13,
      chapter: { id: "chapter-a", title: "甲章" },
    };
    const result = reconcileWritingContext(
      context,
      14,
      () => "原来段落",
      (position) => (position === 4 ? { id: "chapter-a", title: "甲章已改名" } : { id: "chapter-b", title: "乙章" }),
    );
    expect(result.selectionVersion).toBe(14);
    expect(result.chapter?.title).toBe("甲章已改名");
    expect(() =>
      reconcileWritingContext(
        context,
        14,
        () => "原来段落",
        () => ({ id: "chapter-b", title: "乙章" }),
      ),
    ).toThrow("章节已变化");
  });
  it("切到综合助手后重新准备格式候选仍固定格式身份和配置", () => {
    const writing = state();
    writing.selectedAgent = "general";
    const captured = captureFormatIntent(writing.sessions, (session) => ({
      ...request,
      agent: session.kind,
      config: [{ id: `agent-${session.kind}`, version: 2, name: "测试配置" }],
    }));
    expect(captured.agent).toBe("format");
    expect(captured.config[0]?.id).toBe("agent-format");
  });
  it("格式配置停用的错误不能借综合配置绕过，原候选保持", () => {
    const writing = state();
    writing.selectedAgent = "general";
    const before = JSON.stringify(writing.candidate);
    expect(() =>
      captureFormatIntent(writing.sessions, (session) => {
        if (session.kind === "format") throw new Error("格式助手已停用");
        return request;
      }),
    ).toThrow("格式助手已停用");
    expect(JSON.stringify(writing.candidate)).toBe(before);
  });
  it("结构拒绝未知schema、未知对象和危险链接", () => {
    const good = { schemaVersion: 1, json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "测试" }] }] }, chapters: [] };
    expect(validateEditorSnapshot(good)).toBe(true);
    expect(validateEditorSnapshot({ ...good, schemaVersion: 2 })).toBe(false);
    expect(validateEditorSnapshot({ ...good, json: { type: "doc", content: [{ type: "execute" }] } })).toBe(false);
    for (const href of ["javascript:alert(1)", "data:text/html,x", "java\nscript:x", "javascript&colon;x"])
      expect(
        validateEditorSnapshot({ ...good, json: { type: "doc", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href } }] }] } }),
      ).toBe(false);
  });
  it("归档保存完整候选且不被之后的对象修改追改", () => {
    const writing = state();
    archiveWritingCandidate(writing);
    writing.candidate!.basis[0] = "新来源";
    expect(writing.history![0]!.candidate.basis[0]).toBe("来源 v1");
    writing.candidate!.status = "adopted";
    archiveWritingCandidate(writing);
    expect(writing.history).toHaveLength(1);
    writing.candidate = { ...writing.candidate!, id: "c2" };
    archiveWritingCandidate(writing);
    expect(writing.history).toHaveLength(2);
    expect(writing.history![1]!.candidate.status).toBe("adopted");
  });
  it("独立会话范围不会共享数组，并校验备份新字段", () => {
    const writing = state();
    writing.sessions[0]!.context!.materialIds.push("m1");
    expect(writing.sessions[1]!.context!.materialIds).toEqual([]);
    archiveWritingCandidate(writing);
    expect(validateWritingState(writing)).toBe(true);
    const invalid = JSON.parse(JSON.stringify(writing));
    invalid.history[0].request.version = -1;
    expect(validateWritingState(invalid)).toBe(false);
  });
  it("综合部分失败保留成功子任务，生成服务不持有文档写权限", () => {
    const result = assistantPreview(request, true);
    expect(result.steps.map((x) => x.status)).toEqual(["done", "failed", "done"]);
    expect(assistantPreview({ ...request, agent: "lit" }).text).toContain("未提供可核实文献");
    expect(prepareTextPatches(request)[0]).toMatchObject({ from: 1, to: 5, before: "采用方案", after: "使用方案" });
    expect(request.selection.text).toBe("采用方案");
  });
});
