import { describe, expect, it } from "vite-plus/test";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { getSchema, type JSONContent } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import {
  applyTextPatches,
  canonicalEditorJson,
  captureEditor,
  loadEditor,
  prepareEditorSnapshot,
  validateEditorSnapshot,
  type EditorSnapshot,
} from "../../src/lab/state/editorAdapter.ts";
import { editorSnapshotSchema } from "../../src/lab/state/editorSchema.ts";

const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const snapshot = (content: JSONContent[]): EditorSnapshot => ({ schemaVersion: 1, json: { type: "doc", content }, chapters: [] });
const heading = (id: string | null = "chapter-a"): JSONContent => ({
  type: "heading",
  attrs: { level: 2, chapterId: id },
  content: [{ type: "text", text: "中文章节" }],
});
function editorDouble(schema = editorSnapshotSchema, content = snapshot([paragraph("原稿🙂保持")])) {
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON(content.json) });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
  let dispatches = 0;
  let updates = 0;
  const port = {
    schema,
    get state() {
      return state;
    },
    getJSON: () => state.doc.toJSON(),
    view: {
      dispatch(transaction: typeof state.tr) {
        state = state.apply(transaction);
        dispatches++;
        if (transaction.docChanged && !transaction.getMeta("preventUpdate")) updates++;
      },
    },
  } as unknown as Parameters<typeof loadEditor>[0];
  return { port, counts: () => ({ dispatches, updates }) };
}

describe("正文快照的生产结构合同", () => {
  it("补齐合法默认属性，保留模板格式、AI锁定、表格、中文及非BMP文字", () => {
    const value = snapshot([
      { ...heading(), attrs: { level: 2, chapterId: "chapter-a", templateAlign: "center", templateWeight: "700" } },
      { type: "paragraph", content: [{ type: "text", text: "中文🙂𠮷", marks: [{ type: "aiLock" }] }] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { colwidth: [120] }, content: [paragraph("表格")] }] }] },
      { type: "orderedList", content: [{ type: "listItem", content: [paragraph("条目")] }] },
      { type: "codeBlock", content: [{ type: "text", text: "const 中文 = 1;\n" }] },
    ]);
    expect(validateEditorSnapshot(value)).toBe(true);
    const prepared = prepareEditorSnapshot(value);
    expect(prepared.json.content![0]!.attrs).toEqual({ chapterId: "chapter-a", templateAlign: "center", templateWeight: "700", level: 2 });
    expect(prepared.json.content![2]!.content![0]!.content![0]!.attrs).toEqual({ colspan: 1, rowspan: 1, colwidth: [120], align: null });
    const { port } = editorDouble();
    loadEditor(port, prepared);
    expect(captureEditor(port)).toEqual(prepared);
    loadEditor(port, captureEditor(port));
    expect(captureEditor(port)).toEqual(prepared);
  });

  it("未知schema、对象、mark、属性和额外字段整次拒绝", () => {
    const good = snapshot([paragraph("原文")]);
    const invalid: unknown[] = [
      { ...good, schemaVersion: 2 },
      { ...good, future: true },
      snapshot([{ type: "futureObject" }]),
      snapshot([{ ...paragraph("文本"), attrs: { preservedSourceId: "synthetic-object" } }]),
      snapshot([{ ...heading(), attrs: { level: 2, chapterId: "chapter-a", style: "color:red" } }]),
      snapshot([{ type: "paragraph", content: [{ type: "text", text: "文本", marks: [{ type: "futureMark" }] }] }]),
      snapshot([{ type: "paragraph", content: [{ type: "text", text: "文本", marks: [{ type: "bold", attrs: { hiddenData: "不能丢弃" } }] }] }]),
      snapshot([{ type: "paragraph", content: [{ type: "text", text: "文本", attrs: {} }] }]),
      { ...good, chapters: [{ id: "a", title: "章", level: 1, position: 0, end: 1, words: 1, unknown: true }] },
      JSON.parse('{"schemaVersion":1,"json":{"type":"doc","content":[{"type":"paragraph","attrs":{"__proto__":{}}}]},"chapters":[]}'),
    ];
    for (const value of invalid) {
      expect(validateEditorSnapshot(value), JSON.stringify(value)).toBe(false);
      const editor = editorDouble();
      const before = editor.port.state;
      expect(() => loadEditor(editor.port, value as EditorSnapshot)).toThrow();
      expect(editor.port.state).toBe(before);
      expect(editor.counts()).toEqual({ dispatches: 0, updates: 0 });
    }
  });

  it("拒绝非法父子关系、会被修补的表格和不可逆文本拆分", () => {
    for (const value of [
      snapshot([{ type: "text", text: "游离文本" }]),
      snapshot([{ type: "paragraph", content: [paragraph("嵌套段落")] }]),
      snapshot([{ type: "table", content: [{ type: "tableRow", content: [] }] }]),
      snapshot([
        {
          type: "table",
          content: [
            { type: "tableRow", content: [{ type: "tableCell", content: [paragraph("甲")] }] },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [paragraph("乙")] },
                { type: "tableCell", content: [paragraph("丙")] },
              ],
            },
          ],
        },
      ]),
      snapshot([
        {
          type: "paragraph",
          content: [
            { type: "text", text: "甲" },
            { type: "text", text: "乙" },
          ],
        },
      ]),
      snapshot([{ type: "codeBlock", content: [{ type: "text", text: "代码", marks: [{ type: "bold" }] }] }]),
      snapshot([{ ...heading(), attrs: { level: 8 } }]),
    ])
      expect(validateEditorSnapshot(value), JSON.stringify(value)).toBe(false);
  });

  it("实际编辑器缺少已支持属性时在替换前拒绝", () => {
    const editor = editorDouble(getSchema([StarterKit]));
    const before = editor.port.state;
    expect(() => loadEditor(editor.port, snapshot([heading()]))).toThrow();
    expect(editor.port.state).toBe(before);
    expect(editor.counts().dispatches).toBe(0);
  });

  it("根节点非空标记在加载前拒绝，正文、选区和版本更新保持不变", () => {
    for (const mark of [{ type: "bold" }, { type: "aiLock" }, { type: "link", attrs: { href: "https://example.com" } }]) {
      const value = snapshot([{ type: "paragraph" }]);
      value.json.marks = [mark];
      const editor = editorDouble();
      const original = captureEditor(editor.port);
      const selection = editor.port.state.selection.toJSON();
      const state = editor.port.state;
      expect(validateEditorSnapshot(value)).toBe(false);
      expect(() => prepareEditorSnapshot(value)).toThrow();
      expect(() => loadEditor(editor.port, value)).toThrow();
      expect(editor.port.state).toBe(state);
      expect(captureEditor(editor.port)).toEqual(original);
      expect(editor.port.state.selection.toJSON()).toEqual(selection);
      expect(editor.counts()).toEqual({ dispatches: 0, updates: 0 });
    }
  });

  it("根节点显式空标记仍按空默认值无损加载", () => {
    const value = snapshot([paragraph("合法正文")]);
    value.json.marks = [];
    const expected = snapshot([paragraph("合法正文")]);
    const editor = editorDouble();
    expect(validateEditorSnapshot(value)).toBe(true);
    expect(prepareEditorSnapshot(value)).toEqual(expected);
    loadEditor(editor.port, value);
    expect(captureEditor(editor.port)).toEqual(expected);
    expect(value.json.marks).toEqual([]);
  });

  it("仅显式兼容分配缺失章节身份，既有身份稳定且重复身份拒绝", () => {
    const value = snapshot([heading(null), { ...heading("chapter-existing"), content: [{ type: "text", text: "已有章" }] }]);
    const original = JSON.stringify(value);
    expect(canonicalEditorJson(value.json).content![0]!.attrs!.chapterId).toBeNull();
    expect(prepareEditorSnapshot(value).json.content![0]!.attrs!.chapterId).toBeNull();
    const editor = editorDouble();
    expect(() => loadEditor(editor.port, value)).toThrow("章节身份尚未初始化");
    expect(editor.counts().dispatches).toBe(0);
    const migrated = prepareEditorSnapshot(value, { assignMissingChapterIds: true });
    expect(migrated.chapters[0]!.id).toMatch(/^[a-f\d-]{36}$/);
    expect(migrated.chapters[1]!.id).toBe("chapter-existing");
    expect(prepareEditorSnapshot(migrated, { assignMissingChapterIds: true })).toEqual(migrated);
    expect(JSON.stringify(value)).toBe(original);
    expect(validateEditorSnapshot(snapshot([heading(), heading()]))).toBe(false);
  });

  it("派生索引重算，属性数组独立复制，准备过程不改原件", () => {
    const value = snapshot([
      heading(),
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { colwidth: [120] }, content: [paragraph("单元格")] }] }] },
    ]);
    value.chapters = [{ id: "stale-index", title: "旧索引", level: 1, position: 0, end: 0, words: 0 }];
    const prepared = prepareEditorSnapshot(value);
    expect(prepared.chapters[0]!.id).toBe("chapter-a");
    expect(prepared.chapters[0]!.title).toBe("中文章节");
    const originalWidths = value.json.content![1]!.content![0]!.content![0]!.attrs!.colwidth as number[];
    originalWidths[0] = 200;
    expect(prepared.json.content![1]!.content![0]!.content![0]!.attrs!.colwidth).toEqual([120]);
    expect(value.chapters[0]!.id).toBe("stale-index");
  });

  it("明确初载不发送正文更新，正常替换只发送一次", () => {
    const editor = editorDouble();
    loadEditor(editor.port, snapshot([paragraph("载入正文")]), { emitUpdate: false });
    expect(editor.counts()).toEqual({ dispatches: 1, updates: 0 });
    loadEditor(editor.port, snapshot([paragraph("后续版本")]));
    expect(editor.counts()).toEqual({ dispatches: 2, updates: 1 });
  });

  it("使用UTF-16位置且拒绝切开代理对；完整字符替换与删除可执行", () => {
    const editor = editorDouble(editorSnapshotSchema, snapshot([paragraph("甲🙂乙")]));
    const context = { from: 1, text: "甲🙂乙" };
    const request = (from: number, to: number, after: string) => ({
      baseVersion: 1,
      currentVersion: 1,
      selectionFrom: from,
      selectionTo: to,
      context,
      patches: [{ id: "patch", from, to, before: context.text.slice(from - 1, to - 1), after }],
      textAt: (a: number, b: number) => editor.port.state.doc.textBetween(a, b, "\n"),
      locked: () => false,
    });
    const before = editor.port.state;
    expect(applyTextPatches(editor.port, request(2, 3, "中")).ok).toBe(false);
    expect(editor.port.state).toBe(before);
    expect(applyTextPatches(editor.port, request(2, 4, "")).ok).toBe(true);
    expect(editor.port.state.doc.textContent).toBe("甲乙");
    expect(validateEditorSnapshot(snapshot([paragraph("坏\ud800字")]))).toBe(false);
  });

  it("统一限制结构深度并保留合法嵌套", () => {
    const nested = (depth: number) => {
      let node = paragraph("正文");
      for (let i = 0; i < depth; i++) node = { type: "blockquote", content: [node] };
      return snapshot([node]);
    };
    expect(validateEditorSnapshot(nested(24))).toBe(true);
    expect(validateEditorSnapshot(nested(81))).toBe(false);
  });
});
