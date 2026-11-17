import type { DocumentContent } from "../../src/services/documentContent.ts";
import { describe, expect, it } from "vite-plus/test";
import {
  boundaryOffset,
  highlightSegments,
  rangeFromOffsets,
  selectionSourceRange,
  type TextTreeNode,
} from "../../src/workspace/feedback/feedbackSelection.ts";
import {
  buildInbox,
  filterInbox,
  firstLine,
  inboxCounts,
  itemState,
  rebaseSelection,
  resolveFeedbackLink,
} from "../../src/workspace/feedback/feedbackPresentation.ts";
import { documentTextblocks } from "../../src/workspace/tasks/taskFeedbackDraft.ts";

type FakeNode = TextTreeNode & { childNodes: FakeNode[] };
function text(data: string): FakeNode {
  return { nodeType: 3, data, parentNode: null, previousSibling: null, childNodes: [] };
}
function comment(data: string): FakeNode {
  return { nodeType: 8, data, parentNode: null, previousSibling: null, childNodes: [] };
}
function element(...children: FakeNode[]): FakeNode {
  const node: FakeNode = { nodeType: 1, parentNode: null, previousSibling: null, childNodes: children };
  children.forEach((child, index) => {
    child.parentNode = node;
    child.previousSibling = children[index - 1] ?? null;
  });
  return node;
}
/** Mirrors FeedbackOriginal: before-text, optional <mark>, after-text, plus Vue's v-if comment anchor when no mark is shown. */
function rendered(original: string, range?: { from: number; to: number }) {
  const parts = highlightSegments(original, range);
  const before = text(parts.before);
  const mark = parts.mark ? element(text(parts.mark)) : comment("v-if");
  const after = text(parts.after);
  return { root: element(before, mark, after), before, mark, after };
}
const select = (anchorNode: TextTreeNode, anchorOffset: number, focusNode: TextTreeNode, focusOffset: number) => ({
  rangeCount: 1,
  anchorNode,
  anchorOffset,
  focusNode,
  focusOffset,
});

describe("导师原文 Selection API 范围换算", () => {
  it("跨高亮与 v-if 注释节点仍按原文 UTF-16 偏移计数，保留空格与换行", () => {
    const original = "  第一段，保留两个空格。\n\n第二段 <b>字面 HTML</b>\r\n末尾  ";
    const view = rendered(original, { from: 2, to: 8 });
    const mark = view.mark.childNodes[0]!;
    const range = selectionSourceRange(view.root, select(view.before, 0, view.after, 6), original);
    expect(range).toEqual({ from: 0, to: 8 + 6, text: original.slice(0, 14) });
    expect(selectionSourceRange(view.root, select(mark, 1, mark, 4), original)?.text).toBe(original.slice(3, 6));
    const plain = rendered(original);
    const literal = original.indexOf("<b>");
    const crlf = original.indexOf("\r\n");
    expect(selectionSourceRange(plain.root, select(plain.before, crlf + 2, plain.before, literal), original)?.text).toBe("<b>字面 HTML</b>\r\n");
    expect(selectionSourceRange(plain.root, select(plain.before, crlf + 2, plain.before, original.length), original)?.text).toBe("末尾  ");
    expect(selectionSourceRange(plain.root, select(plain.before, literal + 14, plain.before, literal), original)?.text).toBe("<b>字面 HTML</b>");
  });
  it("元素边界点按子节点位置换算；选区越出原文容器或文本被改动时拒绝", () => {
    const original = "甲乙丙";
    const view = rendered(original, { from: 1, to: 2 });
    expect(boundaryOffset(view.root, view.root, 0)).toBe(0);
    expect(boundaryOffset(view.root, view.root, 2)).toBe(2);
    expect(boundaryOffset(view.root, view.root, 3)).toBe(3);
    expect(boundaryOffset(view.root, view.mark, 1)).toBe(2);
    expect(boundaryOffset(view.root, view.root, 4)).toBeUndefined();
    const outside = text("外部");
    expect(boundaryOffset(view.root, outside, 1)).toBeUndefined();
    expect(selectionSourceRange(view.root, select(view.before, 0, outside, 1), original)).toBeUndefined();
    expect(selectionSourceRange(view.root, select(view.before, 0, view.after, 1), "甲乙丙丁")).toBeUndefined();
    expect(selectionSourceRange(view.root, { ...select(view.before, 0, view.after, 1), rangeCount: 0 }, original)).toBeUndefined();
  });
  it("反向选择排序；截断代理对时扩展为完整字符；空选区拒绝", () => {
    const original = "A😀B😀";
    expect(rangeFromOffsets(original, 4, 1)).toEqual({ from: 1, to: 4, text: "😀B" });
    expect(rangeFromOffsets(original, 2, 3)).toEqual({ from: 1, to: 3, text: "😀" });
    expect(rangeFromOffsets(original, 5, 5)).toBeUndefined();
    expect(rangeFromOffsets(original, 4, 5)).toEqual({ from: 4, to: 6, text: "😀" });
    const view = rendered(original);
    expect(selectionSourceRange(view.root, select(view.before, 2, view.before, 2), original)).toBeUndefined();
    expect(selectionSourceRange(view.root, select(view.before, 2, view.before, 6), original)).toEqual({ from: 1, to: 6, text: "😀B😀" });
  });
  it("高亮分段拼接后与原文逐字一致，非法范围不高亮", () => {
    const original = "前\r\n中 后";
    const parts = highlightSegments(original, { from: 1, to: 4 });
    expect(parts.before + parts.mark + parts.after).toBe(original);
    expect(parts.mark).toBe("\r\n中");
    expect(highlightSegments(original, { from: 3, to: 99 })).toEqual({ before: original, mark: "", after: "" });
  });
});

const batch = (id: string, created_at: string, preview: string, item_count = 0) => ({ id, created_at, preview, item_count, project_id: "p" });
const item = (
  id: string,
  batch_id: string,
  status: "open" | "processed",
  review_reasons: string[],
  extra: Partial<{ certainty: "certain" | "uncertain"; task_id: string | null }> = {},
) => ({
  id,
  batch_id,
  status,
  review_reasons,
  needs_review: review_reasons.length > 0,
  preview: `解释 ${id}\n第二行`,
  certainty: extra.certainty ?? ("certain" as const),
  task_id: extra.task_id ?? null,
  updated_at: "2026-11-18T03:04:00Z",
  version: 1,
});

describe("跨批次反馈索引", () => {
  it("按录入顺序编号、最新批次在前；未拆解批次单列；状态短语取首要阻碍", () => {
    const batches = [batch("b2", "2026-11-18T02:00:00Z", "\n  新反馈第一行\n更多"), batch("b1", "2026-11-17T02:00:00Z", "旧反馈", 3)];
    const items = new Map([
      [
        "b1",
        [
          item("i1", "b1", "processed", []),
          item("i2", "b1", "open", ["不确定解释尚未纠正", "缺少处理证据"], { certainty: "uncertain" }),
          item("i3", "b1", "open", ["处理证据版本已变化"], { task_id: "t" }),
        ],
      ],
    ]);
    const entries = buildInbox(batches, items);
    expect(entries.map((entry) => [entry.number, entry.kind, entry.state])).toEqual([
      ["F-02", "batch", "recorded"],
      ["F-01.1", "item", "processed"],
      ["F-01.2", "item", "unclear"],
      ["F-01.3", "item", "staleEvidence"],
    ]);
    expect(entries[0]!.title).toBe("新反馈第一行");
    expect(entries[3]!.summary).toContain("已关联任务");
    expect(inboxCounts(entries)).toEqual({ pending: 3, unclear: 1, handled: 1 });
    expect(filterInbox(entries, "handled").map((entry) => entry.key)).toEqual(["item:i1"]);
    expect(filterInbox(entries, "pending")).toHaveLength(3);
  });
  it("解释项读取失败的批次如实标注，不计入待处理也不冒充未拆解", () => {
    const entries = buildInbox([batch("b1", "2026-11-17T02:00:00Z", "旧反馈", 2)], new Map(), new Set(["b1"]));
    expect(entries[0]).toMatchObject({ kind: "batch", state: "failed", stateLabel: "解释项读取失败" });
    expect(inboxCounts(entries).pending).toBe(0);
  });
  it("状态短语优先级与首行截断按字符计", () => {
    expect(itemState({ status: "open", review_reasons: ["反馈原文尚未人工核对", "缺少处理证据"] })).toBe("unchecked");
    expect(itemState({ status: "open", review_reasons: ["缺少处理证据"] })).toBe("missingEvidence");
    expect(itemState({ status: "open", review_reasons: ["关联任务已归档"] })).toBe("archivedTask");
    expect(itemState({ status: "open", review_reasons: [] })).toBe("ready");
    expect(firstLine("😀".repeat(30), 28)).toBe("😀".repeat(28) + "…");
  });
});

describe("计划页深链定位反馈", () => {
  const entries = buildInbox(
    [batch("b2", "2026-11-18T02:00:00Z", "新反馈"), batch("b1", "2026-11-17T02:00:00Z", "旧反馈", 2)],
    new Map([["b1", [item("i1", "b1", "open", []), item("i2", "b1", "processed", [])]]]),
  );
  it("条目优先，批次兜底；未拆解批次定位到原文条目", () => {
    expect(resolveFeedbackLink(entries, { batch: "b1", item: "i2" })).toBe("item:i2");
    expect(resolveFeedbackLink(entries, { item: "i1" })).toBe("item:i1");
    expect(resolveFeedbackLink(entries, { batch: "b1", item: "missing" })).toBe("item:i1");
    expect(resolveFeedbackLink(entries, { batch: "b2" })).toBe("batch:b2");
  });
  it("无效、不属于当前项目或批次不匹配的参数被忽略", () => {
    expect(resolveFeedbackLink(entries, {})).toBeUndefined();
    expect(resolveFeedbackLink(entries, { item: "missing" })).toBeUndefined();
    expect(resolveFeedbackLink(entries, { batch: "other" })).toBeUndefined();
    expect(resolveFeedbackLink(entries, { batch: "b2", item: "i1" })).toBe("batch:b2");
  });
});

describe("旧证据更新为当前正文", () => {
  const doc = (...paragraphs: string[]) =>
    ({
      schema_version: 1,
      json: { type: "doc", content: paragraphs.map((value) => ({ type: "paragraph", content: [{ type: "text", text: value }] })) },
    }) as DocumentContent;
  const blocks = (content: DocumentContent) => documentTextblocks(content.json);
  it("同一路径同一段内偏移文字未变时重新定位到当前坐标", () => {
    const before = doc("前言", "方法甲已核对");
    const after = doc("前言补充了一句", "方法甲已核对，另加说明");
    const block = blocks(before)[1]!;
    const selection = { textblock_path: block.path, from: block.position, to: block.position + 3, text: "方法甲" };
    const moved = rebaseSelection(before, after, selection)!;
    const target = blocks(after)[1]!;
    expect(moved).toEqual({ textblock_path: target.path, from: target.position, to: target.position + 3, text: "方法甲" });
    expect("from" in moved && moved.from).not.toBe(selection.from);
  });
  it("证据文字被改动、段落消失或原坐标不符时拒绝，不按文本搜索替换", () => {
    const before = doc("前言", "方法甲已核对");
    const block = blocks(before)[1]!;
    const selection = { textblock_path: block.path, from: block.position, to: block.position + 3, text: "方法甲" };
    expect(rebaseSelection(before, doc("前言", "方法乙已核对"), selection)).toBeUndefined();
    expect(rebaseSelection(before, doc("前言"), selection)).toBeUndefined();
    expect(rebaseSelection(before, doc("前言", "另起，方法甲已核对"), selection)).toBeUndefined();
    expect(rebaseSelection(before, before, { ...selection, text: "方法乙" })).toBeUndefined();
  });
  it("v2 证据按节点与标量偏移核对：同节点同位置文字未变才沿用，结构版本不一致拒绝", () => {
    const v2 = (text: string) =>
      ({
        schema_version: 2,
        json: {
          schemaVersion: 2,
          model: {
            kind: "docs",
            schemaVersion: 1,
            id: "d",
            theme: { name: "default" },
            sections: [{ id: "s", blocks: [{ type: "paragraph", id: "p1", inlines: [{ type: "run", text }] }] }],
          },
          protections: [],
          chapters: [],
        },
      }) as unknown as DocumentContent;
    const selection = { node_id: "p1", start: 1, end: 4, expected_text: "方法甲" };
    expect(rebaseSelection(v2("😀方法甲已核对"), v2("😀方法甲已核对，另加说明"), selection)).toEqual(selection);
    expect(rebaseSelection(v2("😀方法甲已核对"), v2("前😀方法甲"), selection)).toBeUndefined();
    expect(rebaseSelection(doc("方法甲"), v2("😀方法甲"), { textblock_path: [0], from: 1, to: 4, text: "方法甲" })).toBeUndefined();
  });
});
