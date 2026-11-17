import type { DocsProtection, RevisionCheck, RevisionNodePatch, RevisionNodeSelection, RevisionPatch, RevisionSelection } from "./contracts/api.generated.ts";
import { deriveChapters } from "./docsContent.ts";
import { isDocsContent, type DocsDocumentContent, type DocumentContent } from "./documentContent.ts";
import { ApiError } from "./errors.ts";
import {
  citations,
  citationsSupported,
  equalTokens,
  hasFormula,
  numbers,
  numbersSupported,
  resolveRevisionSelection,
  validUnicode,
  type ProtectionToken,
  type RevisionProtectionResult,
} from "./revisionProtection.ts";

/**
 * 正文快照 v2 上的内容候选保护（与服务端 text-protection-v2 同规则）。
 *
 * - 选区 `{node_id, start, end, expected_text}`：正文段落 / 标题内的 Unicode 标量偏移（行内对象各计 1），
 *   必须落在同一个文字 run 内；补丁 `{id, start, end, before, after}` 使用同一节点偏移。
 * - 词法检查（数字、引用、公式）沿用 v1 规则；另按快照保护区间做程序检查：与补丁相交即失败，
 *   lock / source → 锁定，object → 结构，number / citation / formula → 各自规则；整节点保护（含所在单元格、列表项等祖先）同理。
 * - 补丁不得写入换行、制表或对象占位符（这些在 v2 中是行内对象，不是文字）。
 */
export const REVISION_POLICY_V2 = "text-protection-v2";
export type ContentSelection = RevisionSelection | RevisionNodeSelection;
export type ContentPatch = RevisionPatch | RevisionNodePatch;

const MAX_SELECTION = 32768;
const OBJECT_ATOM = "￼";
const STRUCTURAL = /[\n\r\t￼]/u;
type Json = Record<string, unknown>;
type Block = Json & { type: string; id: string };
type Inline = Json & { type: string };

export const isNodeSelection = (selection: ContentSelection): selection is RevisionNodeSelection => "node_id" in selection;
export const isNodePatch = (patch: ContentPatch): patch is RevisionNodePatch => "start" in patch;
export const selectionText = (selection: ContentSelection): string => (isNodeSelection(selection) ? selection.expected_text : selection.text);
export const selectionSchema = (selection: ContentSelection): 1 | 2 => (isNodeSelection(selection) ? 2 : 1);

const anchorError = () => new ApiError("REVISION_ANCHOR_INVALID", { status: 422 });
const unsupported = () => new ApiError("REVISION_UNSUPPORTED", { status: 422 });
const mismatch = () => new ApiError("DOCMODEL_ANCHOR_SCHEMA_MISMATCH", { status: 409 });
const blocksOf = (value: unknown) => (Array.isArray(value) ? (value as Block[]) : []);

function atom(inline: Inline): string {
  return inline.type === "run" ? String(inline.text) : inline.type === "break" ? "\n" : inline.type === "tab" ? "\t" : OBJECT_ATOM;
}

interface Located {
  block: Block;
  /** 由外到内的祖先节点 ID（块、列表项、表格行、单元格），不含自身。 */
  ancestors: string[];
}

function locate(snapshot: DocsDocumentContent["json"], nodeId: string): Located | undefined {
  const visit = (blocks: Block[], ancestors: string[]): Located | undefined => {
    for (const block of blocks) {
      if (block.id === nodeId) return { block, ancestors };
      const inner = [...ancestors, block.id];
      let found: Located | undefined;
      if (block.type === "quote" || block.type === "container") found = visit(blocksOf(block.blocks), inner);
      else if (block.type === "list") for (const item of blocksOf(block.items)) found ??= visit(blocksOf(item.blocks), [...inner, item.id]);
      else if (block.type === "table")
        for (const row of blocksOf(block.rows)) for (const cell of blocksOf(row.cells)) found ??= visit(blocksOf(cell.blocks), [...inner, row.id, cell.id]);
      if (found) return found;
    }
    return undefined;
  };
  for (const section of snapshot.model.sections as unknown as Json[]) {
    const found = visit(blocksOf(section.blocks), []);
    if (found) return found;
  }
  return undefined;
}

export interface ResolvedNodeSelection {
  block: Block;
  /** 段内标量（每项一个码点或一个行内对象占位）。 */
  chars: string[];
  /** 选区所在 run 的序号与标量区间。 */
  run: { index: number; start: number; end: number };
  protections: { protection: DocsProtection; start: number; end: number; whole: boolean }[];
}

/** 校验 v2 选区：节点是正文段落 / 标题、偏移在界内、原文一致、落在同一 run。 */
export function resolveNodeSelection(content: DocumentContent, selection: RevisionNodeSelection): ResolvedNodeSelection {
  if (!isDocsContent(content)) throw mismatch();
  const located = locate(content.json, selection.node_id);
  if (!located || (located.block.type !== "paragraph" && located.block.type !== "heading")) throw anchorError();
  const inlines = blocksOf(located.block.inlines) as Inline[];
  const chars = inlines.flatMap((inline) => (inline.type === "run" ? Array.from(String(inline.text)) : [atom(inline)]));
  const { start, end } = selection;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= end ||
    end > chars.length ||
    end - start > MAX_SELECTION ||
    !validUnicode(selection.expected_text) ||
    chars.slice(start, end).join("") !== selection.expected_text
  )
    throw anchorError();
  let cursor = 0;
  let run: ResolvedNodeSelection["run"] | undefined;
  inlines.forEach((inline, index) => {
    const length = inline.type === "run" ? Array.from(String(inline.text)).length : 1;
    if (inline.type === "run" && cursor <= start && end <= cursor + length) run ??= { index, start: cursor, end: cursor + length };
    cursor += length;
  });
  if (!run) throw unsupported();
  const scope = new Set([...located.ancestors, located.block.id]);
  const protections = (content.json.protections ?? []).flatMap((protection) => {
    const { node, start: from, end: to } = protection.anchor;
    if (from == null || to == null) return scope.has(node) ? [{ protection, start: 0, end: chars.length, whole: true }] : [];
    return node === located.block.id ? [{ protection, start: from, end: to, whole: false }] : [];
  });
  return { block: located.block, chars, run, protections };
}

/** 选区解析按结构版本分派；结构版本不一致明确拒绝。 */
export function resolveContentSelection(content: DocumentContent, selection: ContentSelection): void {
  if (isNodeSelection(selection)) resolveNodeSelection(content, selection);
  else if (isDocsContent(content)) throw mismatch();
  else resolveRevisionSelection(content, selection);
}

const ruleOf: Record<DocsProtection["kind"], RevisionCheck["rule"]> = {
  number: "number",
  citation: "citation",
  formula: "formula",
  lock: "lock",
  source: "lock",
  object: "structure",
};

function scalarToUtf16(chars: string[], offset: number): number {
  return chars.slice(0, offset).join("").length;
}

function boundariesIntact(tokens: Generator<ProtectionToken>, ranges: { start: number; end: number; patch: RevisionNodePatch }[]): boolean {
  for (const token of tokens)
    if (
      !ranges.every(
        ({ start, end, patch }) => patch.before === patch.after || end <= token.start || start >= token.end || (start <= token.start && end >= token.end),
      )
    )
      return false;
  return true;
}

const stable = (value: unknown) =>
  JSON.stringify(value ?? {}, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item as Json).sort(([a], [b]) => (a < b ? -1 : 1))) : item,
  );

/** 服务端 replace_text 的同语义：按标量替换后合并相邻同格式 run。 */
function replaceInlines(inlines: Inline[], patches: RevisionNodePatch[]): Inline[] {
  type Atom = { char?: string; props?: Json; other?: Inline };
  const atoms: Atom[] = inlines.flatMap((inline): Atom[] =>
    inline.type === "run" ? Array.from(String(inline.text)).map((char) => ({ char, props: (inline.props as Json | undefined) ?? {} })) : [{ other: inline }],
  );
  for (const patch of [...patches].sort((a, b) => b.start - a.start)) {
    const source = atoms[patch.start] ?? atoms[patch.start - 1];
    const props = source?.char !== undefined ? source.props : {};
    atoms.splice(patch.start, patch.end - patch.start, ...Array.from(patch.after).map((char) => ({ char, props })));
  }
  const out: Inline[] = [];
  let last: Json | undefined;
  for (const item of atoms) {
    if (item.char === undefined) {
      out.push(structuredClone(item.other!));
      last = undefined;
      continue;
    }
    const previous = out.at(-1);
    if (previous && last && previous.type === "run" && stable(last) === stable(item.props)) {
      previous.text = String(previous.text) + item.char;
      continue;
    }
    out.push({ type: "run", text: item.char, ...(item.props && Object.keys(item.props).length ? { props: structuredClone(item.props) } : {}) });
    last = item.props;
  }
  return out;
}

/** v2 候选检查（八项规则）；全部通过时给出新快照（保护区间随文字位移）。 */
export function evaluateNodeProtection(
  content: DocumentContent,
  selection: RevisionNodeSelection,
  patches: RevisionNodePatch[],
  baseVersion: number,
  currentVersion: number,
): RevisionProtectionResult {
  const resolved = resolveNodeSelection(content, selection);
  const { chars } = resolved;
  const text = chars.join("");
  const sorted = [...patches].sort((a, b) => a.start - b.start);
  const rangeOk =
    sorted.some((patch) => patch.before !== patch.after) &&
    patches.length <= 100 &&
    new Set(patches.map((patch) => patch.id)).size === patches.length &&
    sorted.every(
      (patch) =>
        Number.isSafeInteger(patch.start) &&
        Number.isSafeInteger(patch.end) &&
        selection.start <= patch.start &&
        patch.start < patch.end &&
        patch.end <= selection.end &&
        validUnicode(patch.after) &&
        chars.slice(patch.start, patch.end).join("") === patch.before,
    );
  const overlapping = sorted.find((patch, index) => index > 0 && sorted[index - 1]!.end > patch.start);
  const overlap = !overlapping;
  const ranges = rangeOk ? sorted.map((patch) => ({ start: scalarToUtf16(chars, patch.start), end: scalarToUtf16(chars, patch.end), patch })) : [];
  let combined = text;
  if (rangeOk && overlap) for (const range of [...ranges].reverse()) combined = combined.slice(0, range.start) + range.patch.after + combined.slice(range.end);
  const numberChange = sorted.find((patch) => !equalTokens(numbers(patch.before), numbers(patch.after)));
  const citationChange = sorted.find((patch) => !equalTokens(citations(patch.before), citations(patch.after)));
  const touched = (rule: RevisionCheck["rule"]) =>
    sorted.find(
      (patch) =>
        patch.before !== patch.after &&
        resolved.protections.some((item) => ruleOf[item.protection.kind] === rule && patch.start < item.end && patch.end > item.start),
    );
  const structural = sorted.find((patch) => patch.before !== patch.after && STRUCTURAL.test(patch.after));
  const numberHit = touched("number");
  const citationHit = touched("citation");
  const formulaHit = touched("formula");
  const lockHit = touched("lock");
  const structureHit = touched("structure") ?? structural;
  const numberOk =
    rangeOk && overlap && !numberHit && boundariesIntact(numbers(text), ranges) && !numberChange && equalTokens(numbers(text), numbers(combined));
  const citationOk =
    rangeOk && overlap && !citationHit && boundariesIntact(citations(text), ranges) && !citationChange && equalTokens(citations(text), citations(combined));

  const check = (rule: RevisionCheck["rule"], passed: boolean, unsupportedRule: boolean, detail: string, patch?: RevisionNodePatch): RevisionCheck => {
    const location = !passed && !unsupportedRule ? patch : undefined;
    return {
      rule,
      result: unsupportedRule ? "unsupported" : passed ? "pass" : "fail",
      detail,
      patch_id: location?.id ?? null,
      from: null,
      to: null,
      start: location?.start ?? null,
      end: location?.end ?? null,
    };
  };
  const checks = [
    check("version", baseVersion === currentVersion, false, "候选基础版本必须与当前正文一致。"),
    check("range", rangeOk, false, "补丁必须位于原选区的同一文字片段内，原文与标量边界完全一致。"),
    check(
      "number",
      numberOk,
      !numberHit && !(numbersSupported(text) && numbersSupported(combined)),
      "数字、区间、单位及其完整字面和顺序必须保留；受保护数字不可改动。",
      numberHit ?? numberChange,
    ),
    check(
      "citation",
      citationOk,
      !citationHit && !(citationsSupported(text) && citationsSupported(combined)),
      "完整引用及出现顺序必须保留；受保护引用不可改动。",
      citationHit ?? citationChange,
    ),
    check(
      "formula",
      !formulaHit,
      !formulaHit && (hasFormula(text) || hasFormula(combined) || patches.some((patch) => hasFormula(patch.after))),
      "受保护公式不可改动；包含公式的段落暂不支持自动修订。",
      formulaHit,
    ),
    check("lock", !lockHit, false, "补丁不能修改锁定内容或原件保留内容。", lockHit),
    check("overlap", overlap, false, "接受的补丁不能重叠。", overlapping),
    check("structure", !structureHit, false, "仅替换同一文字片段，不能改动对象或写入换行、制表。", structureHit),
  ];
  if (!checks.every((entry) => entry.result === "pass")) return { checks, content: null };
  return { checks, content: applyNodePatches(content as DocsDocumentContent, selection.node_id, sorted) };
}

/** 生成采纳后的新快照：替换文字、同节点保护区间按位移平移、章节重算。 */
export function applyNodePatches(content: DocsDocumentContent, nodeId: string, patches: RevisionNodePatch[]): DocsDocumentContent {
  const json = structuredClone(content.json);
  const located = locate(json, nodeId);
  if (!located) throw anchorError();
  located.block.inlines = replaceInlines(blocksOf(located.block.inlines) as Inline[], patches);
  const shift = (position: number) =>
    position + patches.filter((patch) => patch.end <= position).reduce((sum, patch) => sum + Array.from(patch.after).length - (patch.end - patch.start), 0);
  json.protections = (json.protections ?? []).map((protection) =>
    protection.anchor.node === nodeId && protection.anchor.start != null && protection.anchor.end != null
      ? { ...protection, anchor: { node: nodeId, start: shift(protection.anchor.start), end: shift(protection.anchor.end) } }
      : protection,
  );
  json.chapters = deriveChapters(json.model);
  return { schema_version: 2, json };
}

/** v2 正文中段落 / 标题的标量文字（行内对象记为一个占位）；非 v2 或节点不存在时为 undefined。 */
export function nodeText(content: DocumentContent, nodeId: string): string | undefined {
  if (!isDocsContent(content)) return undefined;
  const located = locate(content.json, nodeId);
  if (!located || (located.block.type !== "paragraph" && located.block.type !== "heading")) return undefined;
  return (blocksOf(located.block.inlines) as Inline[]).map(atom).join("");
}

/** v2 正文的全部正文段落 / 标题（含表格、列表内），按文档顺序。 */
export function nodeTextblocks(content: DocsDocumentContent): { node: string; type: "paragraph" | "heading"; level?: number; text: string }[] {
  const out: { node: string; type: "paragraph" | "heading"; level?: number; text: string }[] = [];
  const visit = (blocks: Block[]) => {
    for (const block of blocks) {
      if (block.type === "paragraph" || block.type === "heading")
        out.push({
          node: block.id,
          type: block.type,
          ...(block.type === "heading" ? { level: Number(block.level) } : {}),
          text: (blocksOf(block.inlines) as Inline[]).map(atom).join(""),
        });
      else if (block.type === "quote" || block.type === "container") visit(blocksOf(block.blocks));
      else if (block.type === "list") for (const item of blocksOf(block.items)) visit(blocksOf(item.blocks));
      else if (block.type === "table") for (const row of blocksOf(block.rows)) for (const cell of blocksOf(row.cells)) visit(blocksOf(cell.blocks));
    }
  };
  for (const section of content.json.model.sections as unknown as Json[]) visit(blocksOf(section.blocks));
  return out;
}
