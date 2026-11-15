import { describe, expect, it } from "vite-plus/test";
import { AllSelection } from "@tiptap/pm/state";
import { editorSnapshotSchema } from "../../src/lab/state/editorSchema.ts";
import { captureSavedAssistantSelection } from "../../src/workspace/assistant/assistantSelection.ts";
import {
  assistantDraftKey,
  clearAssistantDraftIfUnchanged,
  readAssistantDraft,
  selectionStillCurrent,
  writeAssistantDraft,
  runUpdateAllowed,
  type AssistantDraftScope,
} from "../../src/workspace/assistant/assistantDrafts.ts";
const scope: AssistantDraftScope = { sourceKey: "http:one", workspaceId: "workspace-one", projectId: "project-one", sessionId: "session-one" };
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
describe("正式内容助手的草稿与固定选区", () => {
  it("服务、工作区、项目和会话分别隔离草稿，刷新后仍非正式消息", () => {
    const local = storage();
    writeAssistantDraft(local, scope, "未发送的甲草稿");
    writeAssistantDraft(local, { ...scope, sessionId: "session-two" }, "未发送的乙草稿");
    expect(readAssistantDraft(local, scope)?.text).toBe("未发送的甲草稿");
    expect(readAssistantDraft(local, { ...scope, sessionId: "session-two" })?.text).toBe("未发送的乙草稿");
    for (const other of [
      { ...scope, sourceKey: "http:two" },
      { ...scope, projectId: "project-two" },
      { ...scope, workspaceId: "workspace-two" },
    ])
      expect(readAssistantDraft(local, other)).toBeUndefined();
  });
  it("发送确认后只清理同一份草稿，不覆盖随后输入", () => {
    const local = storage();
    writeAssistantDraft(local, scope, "旧输入");
    writeAssistantDraft(local, scope, "发送期间的新输入");
    expect(clearAssistantDraftIfUnchanged(local, scope, "旧输入")).toBe(false);
    expect(readAssistantDraft(local, scope)?.text).toBe("发送期间的新输入");
    expect(clearAssistantDraftIfUnchanged(local, scope, "发送期间的新输入")).toBe(true);
    expect(readAssistantDraft(local, scope)).toBeUndefined();
  });
  it("损坏草稿明确报错，不能冒充消息或自动发出", () => {
    const local = storage();
    local.setItem(assistantDraftKey(scope), "invalid");
    expect(() => readAssistantDraft(local, scope)).toThrow();
  });
  it("正文未保存、版本变化、文字或范围变化时拒绝沿用旧选区", () => {
    const selection = { textblock_path: [0], from: 1, to: 3, text: "原文" };
    const captured = { document_id: "doc-one", document_version: 1, selection };
    const current = { documentId: "doc-one", version: 1, dirty: false, selection };
    expect(selectionStillCurrent(captured, current)).toBe(true);
    expect(selectionStillCurrent(captured, { ...current, dirty: true })).toBe(false);
    expect(selectionStillCurrent(captured, { ...current, version: 2 })).toBe(false);
    expect(selectionStillCurrent(captured, { ...current, selection: { ...selection, text: "新文" } })).toBe(false);
    expect(selectionStillCurrent(captured, { ...current, documentId: "doc-two" })).toBe(false);
  });
  it("已取消的运行不被迟到running响应重新激活", () => {
    const done = { id: "run-one", status: "cancelled", updated_at: "2026-11-17T18:00:02Z" };
    expect(runUpdateAllowed(done, { ...done, status: "running", updated_at: "2026-11-17T18:00:01Z" })).toBe(false);
    expect(runUpdateAllowed(done, { ...done, status: "queued", updated_at: "2026-11-17T18:00:03Z" })).toBe(false);
  });
  it("单段落全选只归一化边界，不把跨段全文选择当作合法选区", () => {
    const doc = editorSnapshotSchema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "已保存的自制原文" }] }] });
    const all = new AllSelection(doc);
    expect(captureSavedAssistantSelection(doc, all.from, all.to, "doc-one", 2)).toMatchObject({
      document_id: "doc-one",
      document_version: 2,
      selection: { text: "已保存的自制原文", textblock_path: [0], from: 1, to: 9 },
    });
    const multi = editorSnapshotSchema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "第一段" }] },
        { type: "paragraph", content: [{ type: "text", text: "第二段" }] },
      ],
    });
    const selected = new AllSelection(multi);
    expect(() => captureSavedAssistantSelection(multi, selected.from, selected.to, "doc-one", 2)).toThrow("同一段落");
  });
});
