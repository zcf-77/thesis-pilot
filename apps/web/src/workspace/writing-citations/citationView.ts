import type { CitationCandidateRead, CitationListRead, LiteratureEntryRead } from "../../services/contracts/api.generated.ts";
import type { DocsSnapshot } from "../editor/docsSnapshot.ts";
import type { PreviewHighlight } from "@muffin-office/vue/docs-anchors";

/** 写作页副驾面板统一契约中的正文与光标。偏移一律是 Unicode 标量。 */
export interface PanelDocument {
  id: string;
  version: number;
  snapshot: DocsSnapshot;
}
export interface PanelSelection {
  node: string;
  start: number;
  end: number;
  text: string;
}
export interface FocusAnchor {
  node: string;
  start?: number;
  end?: number;
}

export const OVERLAY_GROUP = "citations";
const CONTEXT = 18;

type Block = DocsSnapshot["model"]["sections"][number]["blocks"][number];
type Inline = Extract<Block, { type: "paragraph" }>["inlines"][number];

/** 与服务端 atom_text 相同：run 文字按原样，换行/制表各计 1，其余行内对象计 1。 */
export function atomText(inlines: readonly Inline[]): string {
  return inlines.map((inline) => (inline.type === "run" ? inline.text : inline.type === "break" ? "\n" : inline.type === "tab" ? "\t" : "￼")).join("");
}

function childBlocks(block: Block): Block[] {
  if (block.type === "quote" || block.type === "container") return block.blocks;
  if (block.type === "list") return block.items.flatMap((item) => item.blocks);
  if (block.type === "table") return block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.blocks));
  return [];
}

/** 正文段落或标题的标量文字；不在正文中或不是文字块时为 null。 */
export function nodeText(snapshot: DocsSnapshot, node: string): { type: "paragraph" | "heading"; text: string } | null {
  const stack: Block[] = snapshot.model.sections.flatMap((section) => section.blocks).reverse();
  while (stack.length) {
    const block = stack.pop()!;
    if (block.id === node) return block.type === "paragraph" || block.type === "heading" ? { type: block.type, text: atomText(block.inlines) } : null;
    stack.push(...childBlocks(block).reverse());
  }
  return null;
}

const scalars = (text: string) => Array.from(text);

/** 插入点前后的原文片段，供面板在纸面外复述位置。 */
export function insertionContext(snapshot: DocsSnapshot, node: string, offset: number): { before: string; after: string } | null {
  const found = nodeText(snapshot, node);
  if (!found) return null;
  const chars = scalars(found.text);
  if (offset < 0 || offset > chars.length) return null;
  const head = chars.slice(Math.max(0, offset - CONTEXT), offset).join("");
  const tail = chars.slice(offset, offset + CONTEXT).join("");
  return { before: (offset > CONTEXT ? "…" : "") + head, after: tail + (offset + CONTEXT < chars.length ? "…" : "") };
}

/** 光标或选区末尾作为插入点；只有正文段落可插入引用。 */
export function placementOf(snapshot: DocsSnapshot | undefined, selection: PanelSelection | null): { node_id: string; offset: number } | null {
  if (!snapshot || !selection) return null;
  const found = nodeText(snapshot, selection.node);
  if (!found || found.type !== "paragraph") return null;
  if (selection.end < 0 || selection.end > scalars(found.text).length) return null;
  return { node_id: selection.node, offset: selection.end };
}

/** 插入点本身没有宽度：以插入点前（段首则其后）一个字作铅笔标记。 */
function insertionMark(snapshot: DocsSnapshot | undefined, node: string, offset: number): { start: number; end: number } {
  const length = snapshot ? scalars(nodeText(snapshot, node)?.text ?? "").length : offset;
  if (offset > 0) return { start: offset - 1, end: offset };
  return { start: 0, end: Math.min(1, Math.max(length, 0)) };
}

/** 候选在纸面上的铅笔标记：新标记位置、被重新编号的标记与将改写的已有条目。 */
export function candidateOverlays(candidate: CitationCandidateRead, snapshot?: DocsSnapshot): PreviewHighlight[] {
  if (candidate.status !== "ready" || candidate.stale) return [];
  const highlights: PreviewHighlight[] = [];
  candidate.preview.changes.forEach((change, index) => {
    const id = `${candidate.id}:${index}`;
    if (change.kind === "marker") {
      highlights.push({ id, group: OVERLAY_GROUP, tone: "insert", anchor: { node: change.node, ...insertionMark(snapshot, change.node, change.start ?? 0) } });
    } else if (change.kind === "marker_renumber" && change.start !== null && change.end !== null && change.start !== undefined && change.end !== undefined) {
      highlights.push({ id, group: OVERLAY_GROUP, tone: "format", anchor: { node: change.node, start: change.start, end: change.end } });
    } else if (change.kind === "reference") {
      highlights.push({ id, group: OVERLAY_GROUP, tone: "format", anchor: { node: change.node } });
    }
  });
  return highlights;
}

export function markerFocus(candidate: CitationCandidateRead): FocusAnchor {
  return { node: candidate.placement.node_id, start: candidate.placement.offset, end: candidate.placement.offset };
}

/** 已引用文献：首个标记位置用于定位。 */
export function citedFocus(item: CitationListRead["items"][number]): FocusAnchor | null {
  const first = item.markers[0];
  return first ? { node: first.node, start: first.start, end: first.end } : item.reference_node ? { node: item.reference_node } : null;
}

export type CandidateFrame = "pencil" | "inked" | "erased";
export function candidateFrame(candidate: CitationCandidateRead): CandidateFrame {
  if (candidate.status === "applied") return "inked";
  if (candidate.status === "ready" && !candidate.stale) return "pencil";
  return "erased";
}
export function candidateLabel(candidate: CitationCandidateRead): { tone: "pencil" | "success" | "ghost" | "warning"; label: string } {
  if (candidate.status === "applied") return { tone: "success", label: "已采纳" };
  if (candidate.status === "rejected") return { tone: "ghost", label: "已拒绝" };
  if (candidate.status === "undone") return { tone: "ghost", label: "已撤销" };
  if (candidate.stale) return { tone: "warning", label: "已过期" };
  return { tone: "pencil", label: "待审阅" };
}

/** 可引用条目：未移出的项目文献；核实状态如实展示，不替学生推断。 */
export function citableEntries(entries: readonly LiteratureEntryRead[]): LiteratureEntryRead[] {
  return entries.filter((entry) => !entry.removed);
}

export const verificationLabel: Record<LiteratureEntryRead["verification"], { tone: "success" | "warning" | "ghost"; label: string }> = {
  verified: { tone: "success", label: "DOI 已核实" },
  conflict: { tone: "warning", label: "题录冲突" },
  not_found: { tone: "warning", label: "DOI 未登记" },
  unverified: { tone: "ghost", label: "未核实" },
};

export function entryMeta(entry: LiteratureEntryRead): string {
  const { record } = entry;
  const authors = record.authors.length > 3 ? `${record.authors.slice(0, 3).join(", ")} 等` : record.authors.join(", ");
  return [authors, record.venue, record.year].filter((part) => part !== null && part !== undefined && part !== "").join(" · ") || "来源未提供作者与出处";
}
