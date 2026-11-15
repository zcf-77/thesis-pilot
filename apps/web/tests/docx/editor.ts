import { TableKit } from "@tiptap/extension-table";
import { closeHistory } from "@tiptap/pm/history";
import StarterKit from "@tiptap/starter-kit";
import { Editor } from "@tiptap/vue-3";
import { StableChapterIds, applyTextPatches, captureEditor, loadEditor, type EditorSnapshot } from "../../src/lab/state/editorAdapter.ts";

const editor = new Editor({
  element: document.querySelector("#editor")!,
  extensions: [StarterKit, TableKit.configure({ table: { resizable: false } }), StableChapterIds],
});

function selectBlockEnd(path: number[]) {
  let node = editor.state.doc;
  let position = 0;
  for (const index of path) {
    for (let preceding = 0; preceding < index; preceding++) position += node.child(preceding).nodeSize;
    position += 1;
    node = node.child(index);
  }
  if (!node.isTextblock) throw new Error("选中的路径不是可输入的文本块。");
  editor.view.dispatch(closeHistory(editor.state.tr));
  if (!editor.commands.focus(position + node.content.size)) throw new Error("无法定位到文本块末尾。");
}

function checkCrossBlockPatch() {
  const textblocks: { from: number; text: string }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock && node.textContent && textblocks.length < 2) textblocks.push({ from: pos + 1, text: node.textContent });
  });
  if (textblocks.length < 2) return "not-applicable";
  const [first, second] = textblocks as [(typeof textblocks)[number], (typeof textblocks)[number]];
  const from = first.from;
  const to = second.from + 1;
  const textAt = (start: number, end: number) => editor.state.doc.textBetween(start, end, "\n");
  const before = editor.state.doc;
  const result = applyTextPatches(editor, {
    baseVersion: 1,
    currentVersion: 1,
    selectionFrom: from,
    selectionTo: to,
    context: first,
    patches: [{ id: "cross-block", from, to, before: textAt(from, to), after: "替换" }],
    locked: () => false,
    textAt,
  });
  return !result.ok && editor.state.doc.eq(before) && result.checks.some((check) => check.id === "range" && check.result === "fail") ? "rejected" : "failed";
}

export const docxEditor = {
  load: (snapshot: EditorSnapshot) => loadEditor(editor, snapshot),
  snapshot: () => captureEditor(editor),
  selectBlockEnd,
  undo: () => editor.commands.undo(),
  checkCrossBlockPatch,
};

Object.assign(window, { docxEditor });
