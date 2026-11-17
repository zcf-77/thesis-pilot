import type { Block, DocsModel, Inline } from "@muffin-office/core/types";

/**
 * 两个正文版本的段落级对比（事实差异，不是候选）：按顶层块的纯文字做最长公共子序列，
 * 相邻的删除与新增配对为“修改”，再对修改段做首尾公共部分裁剪得到增删片段。
 * 旧版（v1）经 `?as=v2` 转换后的节点 ID 与当前不同，所以按文字而不按 ID 对齐。
 */
export interface DiffPart {
  kind: "same" | "ins" | "del";
  text: string;
}
export interface DiffRow {
  key: string;
  kind: "added" | "removed" | "changed";
  /** 旧版本中的块 ID（预览旧版时用于纸面标记）。 */
  before?: string;
  /** 当前版本中的块 ID（定位用）。 */
  after?: string;
  heading: boolean;
  parts: DiffPart[];
}
export interface VersionDiff {
  rows: DiffRow[];
  added: number;
  removed: number;
  changed: number;
  /** 段落过多时只做首尾裁剪，不做逐段对齐。 */
  coarse: boolean;
}

interface Line {
  id: string;
  heading: boolean;
  text: string;
}

const inlineText = (inline: Inline) =>
  inline.type === "run" ? inline.text : inline.type === "break" ? "\n" : inline.type === "tab" ? "\t" : inline.type === "image" ? "［图片］" : "";

function blockText(block: Block): string {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return block.inlines.map(inlineText).join("");
    case "list":
      return block.items.map((item) => item.blocks.map(blockText).join("\n")).join("\n");
    case "table":
      return block.rows.map((row) => row.cells.map((cell) => cell.blocks.map(blockText).join(" ")).join("\t")).join("\n");
    case "quote":
    case "container":
      return block.blocks.map(blockText).join("\n");
    case "code_block":
      return block.text;
    case "image":
      return `［图片${block.alt ? `：${block.alt}` : ""}］`;
    case "page_break":
      return "［分页符］";
    case "rule":
      return "［分隔线］";
    case "toc":
      return "［目录］";
    default:
      return "";
  }
}

function lines(model: DocsModel): Line[] {
  return model.sections.flatMap((section) => section.blocks.map((block) => ({ id: block.id, heading: block.type === "heading", text: blockText(block) })));
}

/** 首尾公共部分之外的中段记为一次删除与新增（按 Unicode 标量）。 */
export function textParts(before: string, after: string): DiffPart[] {
  const a = Array.from(before);
  const b = Array.from(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => text && parts.push({ kind, text });
  push("same", a.slice(0, head).join(""));
  push("del", a.slice(head, a.length - tail).join(""));
  push("ins", b.slice(head, b.length - tail).join(""));
  push("same", a.slice(a.length - tail).join(""));
  return parts;
}

const MAX_CELLS = 4_000_000;

export function diffVersions(before: DocsModel, after: DocsModel): VersionDiff {
  const a = lines(before);
  const b = lines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head]!.text === b[head]!.text) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail]!.text === b[b.length - 1 - tail]!.text) tail++;
  const oldMid = a.slice(head, a.length - tail);
  const newMid = b.slice(head, b.length - tail);
  const coarse = oldMid.length * newMid.length > MAX_CELLS;
  // ops：按文档顺序的 same / del / ins。
  const ops: { kind: "same" | "del" | "ins"; line: Line; other?: Line }[] = [];
  if (coarse) {
    oldMid.forEach((line) => ops.push({ kind: "del", line }));
    newMid.forEach((line) => ops.push({ kind: "ins", line }));
  } else {
    const n = oldMid.length;
    const m = newMid.length;
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        table[i * width + j] =
          oldMid[i]!.text === newMid[j]!.text ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (oldMid[i]!.text === newMid[j]!.text) {
        ops.push({ kind: "same", line: newMid[j]!, other: oldMid[i]! });
        i++;
        j++;
      } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) ops.push({ kind: "del", line: oldMid[i++]! });
      else ops.push({ kind: "ins", line: newMid[j++]! });
    }
    while (i < n) ops.push({ kind: "del", line: oldMid[i++]! });
    while (j < m) ops.push({ kind: "ins", line: newMid[j++]! });
  }
  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (let index = 0; index < ops.length;) {
    if (ops[index]!.kind === "same") {
      index++;
      continue;
    }
    const dels: Line[] = [];
    const inss: Line[] = [];
    while (index < ops.length && ops[index]!.kind !== "same") {
      const op = ops[index++]!;
      (op.kind === "del" ? dels : inss).push(op.line);
    }
    const pairs = Math.min(dels.length, inss.length);
    for (let k = 0; k < pairs; k++) {
      const old = dels[k]!;
      const now = inss[k]!;
      changed++;
      rows.push({ key: `c:${old.id}:${now.id}`, kind: "changed", before: old.id, after: now.id, heading: now.heading, parts: textParts(old.text, now.text) });
    }
    for (const old of dels.slice(pairs)) {
      removed++;
      rows.push({ key: `r:${old.id}`, kind: "removed", before: old.id, heading: old.heading, parts: [{ kind: "del", text: old.text }] });
    }
    for (const now of inss.slice(pairs)) {
      added++;
      rows.push({ key: `a:${now.id}`, kind: "added", after: now.id, heading: now.heading, parts: [{ kind: "ins", text: now.text }] });
    }
  }
  return { rows, added, removed, changed, coarse };
}
