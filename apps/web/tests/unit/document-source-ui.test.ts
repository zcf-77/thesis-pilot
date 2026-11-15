import { describe, expect, it } from "vite-plus/test";
import { EditorState } from "@tiptap/pm/state";
import { canonicalEditorJson } from "../../src/lab/state/editorAdapter.ts";
import { editorSnapshotSchema } from "../../src/lab/state/editorSchema.ts";
import { sourceDocumentEditAllowed, sourceGuardPlugin, type SourceGuardPolicy } from "../../src/workspace/document-import/sourceGuard.ts";
import { chapterCorrections, sourceEditablePaths, type ImportChapter } from "../../src/workspace/document-import/importDraft.ts";

type TestDoc = { type: string; content: { type: string; content: { type: string; text: string; marks?: { type: string }[] }[] }[] };
const base: TestDoc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "可编辑原文" }] },
    { type: "paragraph", content: [{ type: "text", text: "受保护对象", marks: [{ type: "aiLock" }] }] },
  ],
};
const copy = () => JSON.parse(JSON.stringify(base)) as typeof base;
describe("导入正式稿的即时来源保护", () => {
  it("只允许明确映射段落文字变化，锁定文字保持", () => {
    const allowed = copy();
    allowed.content[0]!.content[0]!.text = "新文字";
    expect(sourceDocumentEditAllowed(base, allowed, [[0]])).toBe(true);
    allowed.content[1]!.content[0]!.text = "试图覆盖锁";
    expect(sourceDocumentEditAllowed(base, allowed, [[0]])).toBe(false);
    expect(sourceDocumentEditAllowed(base, allowed, [[0], [1]])).toBe(false);
  });
  it("格式、章节结构、节点增删与悬空映射一律拒绝", () => {
    const bold = copy();
    bold.content[0]!.content[0]!.marks = [{ type: "bold" }];
    expect(sourceDocumentEditAllowed(base, bold, [[0]])).toBe(false);
    const structure = copy();
    structure.content.push({ type: "paragraph", content: [{ type: "text", text: "新增结构" }] });
    expect(sourceDocumentEditAllowed(base, structure, [[0]])).toBe(false);
    expect(sourceDocumentEditAllowed(base, base, [[5]])).toBe(false);
    expect(sourceDocumentEditAllowed(base, base, [[0], [0]])).toBe(false);
  });
  it("文本空行允许首次输入与清空，缺省attrs正规化不误报", () => {
    const blank = { type: "doc", content: [{ type: "paragraph" }] };
    const filled = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "首次输入" }] }] };
    expect(sourceDocumentEditAllowed(blank, filled, [[0]])).toBe(true);
    expect(sourceDocumentEditAllowed(filled, blank, [[0]])).toBe(true);
    const heading = { type: "doc", content: [{ type: "heading", attrs: { level: 2, chapterId: "chapter-1" }, content: [{ type: "text", text: "标题" }] }] };
    expect(sourceDocumentEditAllowed(heading, canonicalEditorJson(heading), [[0]])).toBe(true);
  });
  it("filterTransaction真正拒绝修改，来源加载失败只读，空稿自由编辑", () => {
    let policy: SourceGuardPolicy = { mode: "loading" };
    let rejected = 0;
    let bypass = false;
    let state = EditorState.create({
      schema: editorSnapshotSchema,
      doc: editorSnapshotSchema.nodeFromJSON(canonicalEditorJson(base)),
      plugins: [sourceGuardPlugin({ getPolicy: () => policy, bypass: () => bypass, onReject: () => rejected++ })],
    });
    const initial = state.doc.toJSON();
    state = state.apply(state.tr.insertText("测试", 1));
    expect(state.doc.toJSON()).toEqual(initial);
    policy = { mode: "source", baseline: base, editablePaths: [[0]] };
    state = state.apply(state.tr.insertText("测试", 1));
    expect(state.doc.textContent).toContain("测试");
    const before = state.doc.toJSON();
    state = state.apply(state.tr.addMark(1, 3, editorSnapshotSchema.marks.bold!.create()));
    expect(state.doc.toJSON()).toEqual(before);
    policy = { mode: "error" };
    state = state.apply(state.tr.insertText("拒绝", 1));
    expect(state.doc.toJSON()).toEqual(before);
    policy = { mode: "free" };
    state = state.apply(state.tr.insertText("空稿可改", 1));
    expect(state.doc.textContent).toContain("空稿可改");
    policy = { mode: "loading" };
    bypass = true;
    state = state.apply(state.tr.insertText("服务器快照", 1));
    expect(state.doc.textContent).toContain("服务器快照");
    expect(rejected).toBe(3);
  });
  it("来源映射缺失或路径非法不能解除只读", () => {
    expect(sourceEditablePaths(undefined)).toBeUndefined();
    expect(sourceEditablePaths({ guard_contract: { schema_version: 1, guard_version: "source-projection-v1" } })).toBeUndefined();
    expect(sourceEditablePaths({ guard_contract: { schema_version: 1, guard_version: "source-projection-v1", editable_paths: [[0], [0]] } })).toBeUndefined();
    expect(sourceEditablePaths({ guard_contract: { schema_version: 1, guard_version: "source-projection-v1", editable_paths: [[0], [1, 2]] } })).toEqual([
      [0],
      [1, 2],
    ]);
  });
  it("导入只提交实际改变且允许的章节校正，不把预览原章节冒充校正结果", () => {
    const chapters: ImportChapter[] = [{ anchor_id: "source-1", kind: "paragraph", level: null, editable: true, allowed_kinds: ["paragraph", "heading"] }];
    expect(chapterCorrections(chapters, { "source-1": { kind: "paragraph", level: 1 } })).toEqual([]);
    expect(chapterCorrections(chapters, { "source-1": { kind: "heading", level: 2 } })).toEqual([{ anchor_id: "source-1", kind: "heading", level: 2 }]);
    expect(() => chapterCorrections(chapters, { "source-1": { kind: "heading", level: 7 } })).toThrow();
    expect(() => chapterCorrections([{ ...chapters[0]!, editable: false }], { "source-1": { kind: "heading", level: 2 } })).toThrow();
  });
});
