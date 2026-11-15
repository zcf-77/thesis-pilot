import type { JSONContent } from "@tiptap/vue-3";
import { canonicalEditorJson } from "../lab/state/editorAdapter.ts";
import { editorSnapshotSchema } from "../lab/state/editorSchema.ts";
import type { RevisionCheck, RevisionPatch, RevisionSelection } from "./contracts/api.generated.ts";
import type { DocumentContent } from "./documentContent.ts";
import { ApiError } from "./errors.ts";

export const REVISION_POLICY = "text-protection-v1";
const maxSelectionUnits = 32768;
const units = [
  "mmol/L",
  "mol/L",
  "mg/L",
  "g/mL",
  "kg/m³",
  "g/cm³",
  "m/s²",
  "m/s",
  "km/h",
  "W/m²",
  "kPa",
  "MPa",
  "Pa",
  "kN",
  "N",
  "kJ",
  "J",
  "kW",
  "W",
  "GHz",
  "MHz",
  "kHz",
  "Hz",
  "kg",
  "mg",
  "μg",
  "µg",
  "g",
  "km",
  "cm",
  "mm",
  "μm",
  "µm",
  "nm",
  "m²",
  "m³",
  "cm²",
  "cm³",
  "mm²",
  "mm³",
  "m",
  "mL",
  "μL",
  "µL",
  "L",
  "ms",
  "min",
  "s",
  "h",
  "d",
  "°C",
  "℃",
  "K",
  "Ω",
  "年",
  "月",
  "日",
  "天",
  "周",
  "岁",
  "个",
  "次",
  "组",
  "人",
  "页",
  "章",
  "节",
  "行",
  "件",
  "项",
  "份",
  "条",
  "只",
  "台",
  "千米",
  "厘米",
  "毫米",
  "米",
  "千克",
  "毫克",
  "克",
  "毫升",
  "升",
  "小时",
  "分钟",
  "秒",
];
const unitNames = new Set(units);
const space = "[\\u0000-\\u0020\\u007f-\\u009f\\u00a0\\u061c\\u1680\\u2000-\\u200f\\u2028-\\u202f\\u205f\\u2060-\\u206f\\u3000\\ufeff\\ufff9-\\ufffb]";
const unit = new RegExp(space + "*(?:" + [...units].sort((a, b) => b.length - a.length).join("|") + ")(?![A-Za-zµμΩ²³])", "uy");
const interval = space + "*[–—~～至到−-]" + space + "*";
const range = new RegExp("^" + interval + "$", "u");
const rangeAhead = new RegExp(interval + "(?=[-+−]?\\p{Nd})", "uy");
const spaceOnly = new RegExp("^" + space + "*$", "u");
const unknownUnit = new RegExp(space + "*[\\p{L}\\p{Nl}\\p{No}°℃\\u0300-\\u036f]", "uy");
const numberPattern = new RegExp("[-+−]?\\p{Nd}+(?:[.,]\\p{Nd}+)*(?:[eE][-+−]?\\p{Nd}+)?(?:" + space + "*[%％‰‱])?", "gu");
const brackets = /\[[^[\]\r\n]+\]|【[^【】\r\n]+】/gu;
const parens = /[（(][^()（）\r\n]{0,160}[)）]/gu;
const year = /(?<!\p{Nd})\p{Nd}{4}[a-z]?(?!\p{Nd})/u;
const author = new RegExp(
  "(?:[A-Za-z][A-Za-z.'’-]*(?:[ \\t]+(?:et[ \\t]+al\\.|and[ \\t]+[A-Za-z][A-Za-z.'’-]*))?|[\\u3400-\\u9fff]{1,20})" + space + "*$",
  "u",
);
const formulaPattern = /[$=∑∫√×÷±≠≈≤≥<>]|\\(?:[()[\]]|[A-Za-z]+)|[A-Za-z][ \t]*[\^_][ \t]*[A-Za-z0-9{]|[A-Za-z][⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]/u;
const variableOperation = new RegExp(
  "(?<![A-Za-z\\u0370-\\u03ff])[A-Za-z\\u0370-\\u03ff]+" + space + "*[+*/−-]" + space + "*[A-Za-z0-9\\u0370-\\u03ff]+(?:[²³])?",
  "gu",
);
const numericOperation = new RegExp("\\p{Nd}" + space + "*[+*/^]" + space + "*[-+−]?\\p{Nd}", "u");

interface TextRun {
  index: number;
  start: number;
  end: number;
  text: string;
  locked: boolean;
}

interface ResolvedRevisionSelection {
  document: JSONContent;
  block: JSONContent;
  start: number;
  text: string;
  runs: TextRun[];
  selected: TextRun;
}

function validUnicode(text: string): boolean {
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) return false;
  }
  return true;
}

const anchorError = () => new ApiError("REVISION_ANCHOR_INVALID", { status: 422 });
const unsupported = () => new ApiError("REVISION_UNSUPPORTED", { status: 422 });

function nodeSize(node: JSONContent): number {
  if (node.type === "text") return node.text!.length;
  if (editorSnapshotSchema.nodes[node.type!]?.isLeaf) return 1;
  return 2 + (node.content ?? []).reduce((size, child) => size + nodeSize(child), 0);
}

function utf16Slice(text: string, start: number, end: number): string {
  if (start < 0 || start > end || end > text.length) throw anchorError();
  const value = text.slice(start, end);
  if (!validUnicode(value)) throw anchorError();
  return value;
}

export function resolveRevisionSelection(content: DocumentContent, selection: RevisionSelection): ResolvedRevisionSelection {
  let document: JSONContent;
  try {
    document = canonicalEditorJson(content.json);
  } catch {
    throw new ApiError("DOCUMENT_STRUCTURE_INVALID", { status: 422 });
  }
  let block = document;
  let start = 0;
  for (const index of selection.textblock_path) {
    const children = block.content ?? [];
    if (!Number.isSafeInteger(index) || index < 0 || index >= children.length) throw anchorError();
    start += 1 + children.slice(0, index).reduce((size, sibling) => size + nodeSize(sibling), 0);
    block = children[index]!;
  }
  if (block.type !== "paragraph" && block.type !== "heading") throw unsupported();
  const children = block.content ?? [];
  if (!children.length || children.some((child) => child.type !== "text")) throw unsupported();
  let cursor = start;
  const runs = children.map((child, index) => {
    const text = child.text!;
    const run = { index, start: cursor, end: cursor + text.length, text, locked: !!child.marks?.some((mark) => mark.type === "aiLock") };
    cursor = run.end;
    return run;
  });
  const text = runs.map((run) => run.text).join("");
  if (
    !Number.isSafeInteger(selection.from) ||
    !Number.isSafeInteger(selection.to) ||
    selection.from >= selection.to ||
    selection.to - selection.from > maxSelectionUnits ||
    !validUnicode(selection.text) ||
    utf16Slice(text, selection.from - start, selection.to - start) !== selection.text
  )
    throw anchorError();
  const selected = runs.find((run) => run.start <= selection.from && selection.to <= run.end);
  if (!selected) throw unsupported();
  return { document, block, start, text, runs, selected };
}

function replace(text: string, start: number, patches: RevisionPatch[]): string {
  for (const patch of [...patches].sort((a, b) => b.from - a.from)) {
    text = text.slice(0, patch.from - start) + patch.after + text.slice(patch.to - start);
  }
  return text;
}

function preserveStructure(resolved: ResolvedRevisionSelection, patches: RevisionPatch[]): DocumentContent {
  const { selected, block } = resolved;
  const content = block.content!;
  const text = replace(selected.text, selected.start, patches);
  const children = [...content.slice(0, selected.index), ...(text ? [{ ...content[selected.index]!, text }] : []), ...content.slice(selected.index + 1)];
  const merged: JSONContent[] = [];
  for (const child of children) {
    const previous = merged.at(-1);
    if (previous && JSON.stringify(previous.marks ?? []) === JSON.stringify(child.marks ?? [])) previous.text = previous.text! + child.text!;
    else merged.push({ ...child });
  }
  if (merged.length) block.content = merged;
  else delete block.content;
  return { schema_version: 1, json: canonicalEditorJson(resolved.document) as DocumentContent["json"] };
}

export interface RevisionProtectionResult {
  checks: RevisionCheck[];
  content: DocumentContent | null;
}

interface ProtectionToken {
  start: number;
  end: number;
  text: string;
  supported: boolean;
}

function supportedUnitSuffix(text: string, offset: number): boolean {
  const point = text.codePointAt(offset);
  if (point === undefined) return true;
  const next = String.fromCodePoint(point);
  return !/[\p{N}\p{M}_%％‰‱°℃]/u.test(next) && (!/\p{L}/u.test(next) || (point >= 0x3400 && point <= 0x9fff));
}

function* numberAtoms(text: string): Generator<ProtectionToken> {
  let end = 0;
  for (const match of text.matchAll(numberPattern)) {
    if (match.index < end) continue;
    end = match.index + match[0].length;
    unit.lastIndex = unknownUnit.lastIndex = rangeAhead.lastIndex = end;
    const knownUnit = unit.exec(text);
    if (knownUnit) end += knownUnit[0].length;
    yield {
      start: match.index,
      end,
      text: text.slice(match.index, end),
      supported: knownUnit ? supportedUnitSuffix(text, end) : !unknownUnit.test(text) || rangeAhead.test(text),
    };
  }
}

function* numbers(text: string): Generator<ProtectionToken> {
  const iterator = numberAtoms(text);
  let pending = iterator.next();
  while (!pending.done) {
    const following = iterator.next();
    const gap = following.done ? "" : text.slice(pending.value.end, following.value.start);
    if (!following.done && (range.test(gap) || (/^[-−]/u.test(following.value.text) && spaceOnly.test(gap)))) {
      yield {
        start: pending.value.start,
        end: following.value.end,
        text: text.slice(pending.value.start, following.value.end),
        supported: pending.value.supported && following.value.supported,
      };
      pending = iterator.next();
    } else {
      yield pending.value;
      pending = following;
    }
  }
}

function numbersSupported(text: string): boolean {
  for (const token of numbers(text)) if (!token.supported) return false;
  const iterator = numbers(text);
  let token = iterator.next();
  for (const match of text.matchAll(/\p{N}/gu)) {
    if (/\p{Nd}/u.test(match[0])) continue;
    while (!token.done && token.value.end <= match.index) token = iterator.next();
    if (token.done || token.value.start > match.index) return false;
  }
  return true;
}

function* citations(text: string): Generator<ProtectionToken> {
  const bracket = text.matchAll(brackets);
  const parentheses = text.matchAll(parens);
  let left = bracket.next();
  let right = parentheses.next();
  let covered = 0;
  while (!left.done || !right.done) {
    const isBracket = right.done || (!left.done && left.value.index <= right.value.index);
    const match = (isBracket ? left.value : right.value) as RegExpExecArray;
    if (isBracket) left = bracket.next();
    else right = parentheses.next();
    if (match.index < covered || (!isBracket && !year.test(match[0]))) continue;
    let start = match.index;
    if (!isBracket) {
      const prefix = Array.from(text.slice(Math.max(0, start - 320), start))
        .slice(-160)
        .join("");
      const citedAuthor = author.exec(prefix);
      if (citedAuthor) start -= prefix.length - citedAuthor.index;
    }
    if (start < covered) continue;
    covered = match.index + match[0].length;
    yield { start, end: covered, text: text.slice(start, covered), supported: true };
  }
}

function citationsSupported(text: string): boolean {
  const iterator = citations(text);
  let token = iterator.next();
  for (const match of text.matchAll(/[[\]【】()（）]/gu)) {
    while (!token.done && token.value.end <= match.index) token = iterator.next();
    if (!token.done && token.value.start <= match.index && match.index < token.value.end) continue;
    const left = Array.from(text.slice(Math.max(0, match.index - 320), match.index)).slice(-160);
    const right = Array.from(text.slice(match.index, match.index + 322)).slice(0, 161);
    if ("[]【】".includes(match[0]) || year.test([...left, ...right].join(""))) return false;
  }
  return true;
}

function hasFormula(text: string): boolean {
  if (formulaPattern.test(text) || numericOperation.test(text)) return true;
  for (const match of text.matchAll(variableOperation)) if (!unitNames.has(match[0])) return true;
  const iterator = numbers(text);
  let token = iterator.next();
  for (const operator of text.matchAll(/[+*/^_]/gu)) {
    while (!token.done && token.value.end <= operator.index) token = iterator.next();
    if (token.done || token.value.start > operator.index) return true;
  }
  return false;
}

function equalTokens(left: Generator<ProtectionToken>, right: Generator<ProtectionToken>): boolean {
  for (const token of left) {
    const other = right.next();
    if (other.done || token.text !== other.value.text) return false;
  }
  return !!right.next().done;
}

function boundariesIntact(tokens: Generator<ProtectionToken>, patches: RevisionPatch[], start: number): boolean {
  for (const token of tokens) {
    const from = token.start + start;
    const to = token.end + start;
    if (!patches.every((patch) => patch.before === patch.after || patch.to <= from || patch.from >= to || (patch.from <= from && patch.to >= to))) return false;
  }
  return true;
}

export function evaluateRevisionProtection(
  content: DocumentContent,
  selection: RevisionSelection,
  patches: RevisionPatch[],
  baseVersion: number,
  currentVersion: number,
): RevisionProtectionResult {
  const resolved = resolveRevisionSelection(content, selection);
  const sorted = [...patches].sort((a, b) => a.from - b.from);
  const first = sorted.find((patch) => patch.before !== patch.after);
  const rangeOk =
    !!first &&
    patches.length <= 100 &&
    new Set(patches.map((patch) => patch.id)).size === patches.length &&
    sorted.every((patch) => {
      if (
        !Number.isSafeInteger(patch.from) ||
        !Number.isSafeInteger(patch.to) ||
        patch.from < selection.from ||
        patch.from >= patch.to ||
        patch.to > selection.to ||
        !validUnicode(patch.after)
      )
        return false;
      const before = resolved.text.slice(patch.from - resolved.start, patch.to - resolved.start);
      return validUnicode(before) && before === patch.before;
    });
  const overlapping = sorted.find((patch, index) => index > 0 && sorted[index - 1]!.to > patch.from);
  const overlap = !overlapping;
  const combined = rangeOk && overlap ? replace(resolved.text, resolved.start, patches) : resolved.text;
  const numberChange = sorted.find((patch) => !equalTokens(numbers(patch.before), numbers(patch.after)));
  const citationChange = sorted.find((patch) => !equalTokens(citations(patch.before), citations(patch.after)));
  const numberOk =
    rangeOk &&
    overlap &&
    boundariesIntact(numbers(resolved.text), sorted, resolved.start) &&
    !numberChange &&
    equalTokens(numbers(resolved.text), numbers(combined));
  const citationOk =
    rangeOk &&
    overlap &&
    boundariesIntact(citations(resolved.text), sorted, resolved.start) &&
    !citationChange &&
    equalTokens(citations(resolved.text), citations(combined));
  const locked = sorted.find(
    (patch) => patch.before !== patch.after && resolved.runs.some((run) => run.locked && patch.from < run.end && patch.to > run.start),
  );

  const check = (rule: RevisionCheck["rule"], passed: boolean, unsupportedRule: boolean, detail: string, patch?: RevisionPatch): RevisionCheck => {
    const location = !passed && !unsupportedRule ? patch : undefined;
    return {
      rule,
      result: unsupportedRule ? "unsupported" : passed ? "pass" : "fail",
      detail,
      patch_id: location?.id ?? null,
      from: location?.from ?? null,
      to: location?.to ?? null,
    };
  };
  const checks = [
    check("version", baseVersion === currentVersion, false, "候选基础版本必须与当前正文一致。"),
    check("range", rangeOk, false, "补丁必须位于原选区，原文与 UTF-16 边界完全一致。"),
    check(
      "number",
      numberOk,
      !(numbersSupported(resolved.text) && numbersSupported(combined)),
      "数字、区间、单位及其完整字面和顺序必须保留；未识别计量写法拒绝。",
      numberChange,
    ),
    check(
      "citation",
      citationOk,
      !(citationsSupported(resolved.text) && citationsSupported(combined)),
      "完整引用及出现顺序必须保留；疑似而未解析的引文拒绝。",
      citationChange,
    ),
    check(
      "formula",
      true,
      hasFormula(resolved.text) || hasFormula(combined) || patches.some((patch) => hasFormula(patch.after)),
      "包含公式的整个文本块暂不支持自动修订。",
    ),
    check("lock", !locked, false, "补丁不能修改或改变 AI 锁定文字的标记。", locked),
    check("overlap", overlap, false, "接受的补丁不能重叠。", overlapping),
    check("structure", true, false, "仅替换同一文本区间，保留其余结构与格式。"),
  ];
  return { checks, content: checks.every((entry) => entry.result === "pass") ? preserveStructure(resolved, sorted) : null };
}

export function requireProtectedRevision(checks: RevisionCheck[]): void {
  if (checks.every((check) => check.result === "pass")) return;
  if (checks.some((check) => (check.rule === "range" || check.rule === "overlap") && check.result !== "pass"))
    throw new ApiError("REVISION_PATCH_INVALID", { status: 422 });
  if (checks.some((check) => check.result === "unsupported")) throw new ApiError("REVISION_UNSUPPORTED", { status: 422 });
  throw new ApiError("REVISION_PROTECTION_FAILED", { status: 422 });
}
