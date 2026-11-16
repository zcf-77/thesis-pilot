import { describe, expect, it, vi } from "vite-plus/test";
import { editorSnapshotSchema } from "../../src/lab/state/editorSchema.ts";
import { captureSavedAssistantSelection } from "../../src/workspace/assistant/assistantSelection.ts";
import {
  documentTextblocks,
  draftKey,
  emptyTask,
  exactTextRange,
  normalizeFeedback,
  normalizeTask,
  readDraft,
  taskDraftError,
  textareaTextRange,
  writeDraft,
} from "../../src/workspace/tasks/taskFeedbackDraft.ts";

describe("人工任务与反馈的精确证据", () => {
  it("重复文字与嵌套段落使用实际路径及全局PM坐标，不按首个文本搜索定位", () => {
    const json = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1, chapterId: "chapter-one" }, content: [{ type: "text", text: "标题" }] },
        { type: "paragraph", content: [{ type: "text", text: "同一句" }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "同一句" }] }] },
      ],
    };
    const document = editorSnapshotSchema.nodeFromJSON(json);
    const choices = documentTextblocks(json);
    expect(choices.map((entry) => entry.path)).toEqual([[0], [1], [2, 0]]);
    expect(choices[0]?.chapterId).toBe("chapter-one");
    for (const choice of choices) {
      const selection = captureSavedAssistantSelection(document, choice.position, choice.position + choice.text.length, "doc", 3).selection;
      expect(selection).toEqual({ from: choice.position, to: choice.position + choice.text.length, text: choice.text, textblock_path: choice.path });
    }
    expect(choices[1]!.position).not.toBe(choices[2]!.position);
  });
  it("含不可表示内联对象的段落拒绝作为textarea证据，避免偏移误定位", () => {
    expect(
      documentTextblocks({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "前" }, { type: "hardBreak" }, { type: "text", text: "后" }] }],
      }),
    ).toEqual([]);
  });
  it("UTF16范围拒绝空值、越界及截断emoji；相同句子按位置保留", () => {
    const text = "甲😀乙甲";
    expect(exactTextRange(text, 1, 3)).toEqual({ from: 1, to: 3, text: "😀" });
    expect(exactTextRange(text, 4, 5)).toEqual({ from: 4, to: 5, text: "甲" });
    for (const [from, to] of [
      [0, 0],
      [-1, 1],
      [2, 3],
      [1, 2],
      [0, 6],
      [0.5, 3],
    ])
      expect(exactTextRange(text, from!, to!)).toBeUndefined();
  });
  it("textarea换行归一化后仍回到不可变原文范围", () => {
    expect(textareaTextRange("前\r\n重复\r后", 2, 4)).toEqual({ from: 3, to: 5, text: "重复" });
    expect(textareaTextRange("前\r\n重复\r后", 1, 5)).toEqual({ from: 1, to: 6, text: "\r\n重复\r" });
  });
  it("任务与反馈表单补齐DTO缺省但不创造证据或自动确认", () => {
    expect(normalizeTask({ title: "人工任务", acceptance: "核对结果" })).toEqual({ ...emptyTask(), title: "人工任务", acceptance: "核对结果" });
    const feedback = normalizeFeedback({
      interpretation: "待澄清",
      certainty: "uncertain",
      source_range: { from: 0, to: 1, text: "原" },
      source_checked: false,
    });
    expect(feedback.evidence).toEqual([]);
    expect(feedback.new_task).toBeNull();
    expect(feedback.source_checked).toBe(false);
    expect(taskDraftError({ ...emptyTask(), title: "任务" })).toContain("验收");
    expect(taskDraftError({ ...emptyTask(), title: "任务", acceptance: "条件", depends_on: ["self"] }, "self")).toContain("自身");
  });
  it("草稿按服务、工作区、项目、条目隔离；保留未知结果的原命令而不冒充正式数据", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    try {
      const key = draftKey("http:one", "workspace", "project", "task", "new");
      const draft = { content: { ...emptyTask(), title: "未保存" }, unknown: true, pending: { input: { command_id: "fixed-command" } } };
      writeDraft(key, draft);
      expect(readDraft(key)).toEqual(draft);
      for (const other of [
        draftKey("http:two", "workspace", "project", "task", "new"),
        draftKey("http:one", "other", "project", "task", "new"),
        draftKey("http:one", "workspace", "other", "task", "new"),
        draftKey("http:one", "workspace", "project", "feedback-item", "new"),
      ])
        expect(readDraft(other)).toBeUndefined();
      values.set(key, "broken");
      expect(() => readDraft(key)).toThrow("无法读取");
      expect(values.get(key)).toBe("broken");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
