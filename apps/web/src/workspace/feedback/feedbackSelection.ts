import { exactTextRange } from "../tasks/taskFeedbackDraft.ts";

/** Minimal DOM surface used for offset counting; real Nodes satisfy it and tests can use plain objects. */
export interface TextTreeNode {
  nodeType: number;
  data?: string;
  parentNode: TextTreeNode | null;
  previousSibling: TextTreeNode | null;
  childNodes: ArrayLike<TextTreeNode>;
}
export interface SelectionLike {
  rangeCount: number;
  anchorNode: TextTreeNode | null;
  anchorOffset: number;
  focusNode: TextTreeNode | null;
  focusOffset: number;
}
export type SourceRange = { from: number; to: number; text: string };

const TEXT = 3;
const ELEMENT = 1;
const FRAGMENT = 11;

function textLength(node: TextTreeNode): number {
  if (node.nodeType === TEXT) return node.data?.length ?? 0;
  if (node.nodeType !== ELEMENT && node.nodeType !== FRAGMENT) return 0;
  let total = 0;
  for (let index = 0; index < node.childNodes.length; index += 1) total += textLength(node.childNodes[index]!);
  return total;
}

function within(root: TextTreeNode, node: TextTreeNode) {
  for (let current: TextTreeNode | null = node; current; current = current.parentNode) if (current === root) return true;
  return false;
}

/** UTF-16 offset of a DOM boundary point, counting only text nodes (comments such as Vue v-if anchors are ignored). */
export function boundaryOffset(root: TextTreeNode, node: TextTreeNode, offset: number): number | undefined {
  if (!within(root, node) || !Number.isSafeInteger(offset) || offset < 0) return;
  let total = 0;
  for (let current: TextTreeNode = node; current !== root; current = current.parentNode!) {
    for (let sibling = current.previousSibling; sibling; sibling = sibling.previousSibling) total += textLength(sibling);
  }
  if (node.nodeType === TEXT) return offset <= (node.data?.length ?? 0) ? total + offset : undefined;
  if (offset > node.childNodes.length) return;
  for (let index = 0; index < offset; index += 1) total += textLength(node.childNodes[index]!);
  return total;
}

function splitsSurrogate(text: string, offset: number) {
  return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]!) && /[\uDC00-\uDFFF]/.test(text[offset]!);
}

/** Orders two offsets, widens any half surrogate pair to the full code point, and validates against the immutable original. */
export function rangeFromOffsets(original: string, anchor: number, focus: number): SourceRange | undefined {
  if (anchor === focus) return;
  let from = Math.min(anchor, focus);
  let to = Math.max(anchor, focus);
  if (splitsSurrogate(original, from)) from -= 1;
  if (splitsSurrogate(original, to)) to += 1;
  return exactTextRange(original, from, to);
}

/** Selection API → source_range in the original's UTF-16 coordinates; undefined unless the whole selection is inside root. */
export function selectionSourceRange(root: TextTreeNode, selection: SelectionLike | null, original: string): SourceRange | undefined {
  if (!selection || !selection.rangeCount || !selection.anchorNode || !selection.focusNode) return;
  if (textLength(root) !== original.length) return;
  const anchor = boundaryOffset(root, selection.anchorNode, selection.anchorOffset);
  const focus = boundaryOffset(root, selection.focusNode, selection.focusOffset);
  if (anchor === undefined || focus === undefined) return;
  return rangeFromOffsets(original, anchor, focus);
}

/** Splits the original into display segments with the active range highlighted; joining the segments yields the original exactly. */
export function highlightSegments(original: string, range?: { from: number; to: number }) {
  if (!range || range.from < 0 || range.to > original.length || range.to <= range.from) return { before: original, mark: "", after: "" };
  return { before: original.slice(0, range.from), mark: original.slice(range.from, range.to), after: original.slice(range.to) };
}
