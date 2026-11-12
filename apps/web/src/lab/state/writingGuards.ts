export interface TextPatch {
  id: string;
  from: number;
  to: number;
  before: string;
  after: string;
}
export interface GuardInput {
  baseVersion: number;
  currentVersion: number;
  selectionFrom: number;
  selectionTo: number;
  /** 完整文本块与其在编辑器中的起点；不能只提供选区，否则会漏掉被选区切开的保护对象。 */
  context: { from: number; text: string };
  patches: TextPatch[];
  textAt: (from: number, to: number) => string;
  locked: (from: number, to: number) => boolean;
  unsupported?: boolean;
}
export interface WritingCheck {
  id: "number" | "citation" | "formula" | "lock" | "range" | "version" | "overlap";
  label: string;
  result: "pass" | "fail" | "unsupported";
  detail: string;
}
const numberPattern = () => /[-+−]?\p{N}+(?:[.,]\p{N}+)*(?:[eE][-+−]?\p{N}+)?(?:\s*[%％])?/gu;
const citationPattern = () => /\[[^\]\r\n]+\]|【[^】\r\n]+】/g;
const numbers = (s: string) => s.match(numberPattern()) ?? [];
const citations = (s: string) => s.match(citationPattern()) ?? [];
const formula = (s: string) => /\$|\\(?:frac|sum|int|sqrt)|[=∑∫√]/.test(s);
const equal = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

/** 选区是同一文本块，保护检查由程序执行；未知对象拒绝，不降级成成功。 */
export function validateTextPatches(input: GuardInput): WritingCheck[] {
  const sorted = [...input.patches].sort((a, b) => a.from - b.from);
  const rangeOk =
    sorted.some((p) => p.before !== p.after) &&
    sorted.every(
      (p) =>
        Number.isInteger(p.from) &&
        Number.isInteger(p.to) &&
        p.from >= input.selectionFrom &&
        p.to <= input.selectionTo &&
        p.from >= input.context.from &&
        p.to <= input.context.from + input.context.text.length &&
        p.from < p.to &&
        input.context.text.slice(p.from - input.context.from, p.to - input.context.from) === p.before &&
        input.textAt(p.from, p.to) === p.before,
    );
  const overlapOk = sorted.every((p, i) => i === 0 || sorted[i - 1]!.to <= p.from);
  const uncut = (pattern: RegExp) =>
    [...input.context.text.matchAll(pattern)].every((match) => {
      const from = input.context.from + (match.index ?? 0);
      const to = from + match[0].length;
      return sorted.every((p) => p.before === p.after || p.to <= from || p.from >= to || (p.from <= from && p.to >= to));
    });
  let combined = input.context.text;
  if (rangeOk && overlapOk) {
    for (const p of [...sorted].reverse()) {
      const from = p.from - input.context.from;
      const to = p.to - input.context.from;
      combined = combined.slice(0, from) + p.after + combined.slice(to);
    }
  }
  const check = (id: WritingCheck["id"], label: string, pass: boolean, detail: string): WritingCheck => ({ id, label, result: pass ? "pass" : "fail", detail });
  return [
    check("version", "基础版本", input.baseVersion === input.currentVersion, "采纳时再次核对正文版本，旧候选不能覆盖新稿。"),
    check(
      "range",
      "选区范围",
      rangeOk && !input.unsupported,
      input.unsupported ? "仅支持同一文本块的纯文本选区；表格跨格、对象或跨段选区须缩小范围。" : "补丁必须落在原选区且原文字面一致。",
    ),
    check(
      "number",
      "数字",
      rangeOk &&
        uncut(numberPattern()) &&
        sorted.every((p) => equal(numbers(p.before), numbers(p.after))) &&
        equal(numbers(input.context.text), numbers(combined)),
      "不可切开完整数字对象；接受片段组合后，再检查整个文本块的数字与出现顺序。",
    ),
    check(
      "citation",
      "引用",
      rangeOk &&
        uncut(citationPattern()) &&
        sorted.every((p) => equal(citations(p.before), citations(p.after))) &&
        equal(citations(input.context.text), citations(combined)),
      "不可切开完整引用标记；接受片段组合后，再检查整个文本块的引用与出现顺序。",
    ),
    {
      id: "formula",
      label: "公式",
      result: formula(input.context.text) || formula(combined) || sorted.some((p) => formula(p.after)) ? "unsupported" : "pass",
      detail: "文本块包含公式符号时暂不自动修订，请手动编辑；不会因选区避开等号而放行。",
    },
    check(
      "lock",
      "锁定内容",
      sorted.every((p) => !input.locked(p.from, p.to)),
      "涉及 AI 锁定文字的补丁拒绝应用；本人手动编辑不受此限制。",
    ),
    check("overlap", "重叠补丁", overlapOk, "接受片段之间不能重叠。"),
  ];
}
export function allChecksPass(checks: { result: string }[]): boolean {
  return checks.every((c) => c.result === "pass");
}
/** 引用新增是独立意图：只允许把已核实的精确引文追加在原选区末尾，绝不放宽润色规则。 */
export function validateCitationAppend(input: GuardInput, appendedText: string, verified: boolean): WritingCheck[] {
  const checks = validateTextPatches(input);
  const patch = input.patches[0];
  const exact = verified && !!appendedText.trim() && input.patches.length === 1 && !!patch && patch.after === `${patch.before}\n${appendedText}`;
  const boundarySafe = (pattern: RegExp) =>
    !!patch &&
    [...input.context.text.matchAll(pattern)].every((m) => {
      const from = input.context.from + (m.index ?? 0);
      return !(patch.to > from && patch.to < from + m[0].length);
    });
  return checks.map((c) =>
    c.id === "number" || c.id === "citation"
      ? {
          ...c,
          result: exact && boundarySafe(c.id === "number" ? numberPattern() : citationPattern()) ? "pass" : "fail",
          detail: "只追加与已核实来源快照一致的引文，原数字、引用及原段落必须完整保留；不能在受保护标记中间插入。",
        }
      : c,
  );
}
export function previewRewrite(text: string): string {
  const rewritten = text
    .replace(/采用/g, "使用")
    .replace(/能够/g, "可以")
    .replace(/进行验证/g, "验证")
    .replace(/\s{2,}/g, " ");
  return rewritten === text ? `本研究中，${text}` : rewritten;
}
export function textToHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return escaped
    .split(/\r?\n/)
    .map((line) => `<p>${line || "<br>"}</p>`)
    .join("");
}
