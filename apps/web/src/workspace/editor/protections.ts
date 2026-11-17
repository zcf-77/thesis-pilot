import type { BlockedEvent, ProtectedRange } from "@muffin-office/vue/docs-editor/core";
import type { Tone } from "../../design/tone.ts";
import { PROTECTION_KINDS, type DocsProtection, type ProtectionKind } from "./docsSnapshot.ts";

/**
 * 快照保护 ↔ DocsEditor `protectedRanges`。编辑器在本地按事务移动受保护区间（`controller.protected`），
 * 保存时用 protectionsFromRanges 读回当前位置，种类与绑定仍以快照为准。
 */
export interface ProtectionDisplay {
  label: string;
  /** 状态胶囊、提示使用的语气。 */
  tone: Tone;
  /** 保护标记颜色（语义令牌）。 */
  color: string;
  /** 被拦下时给学生的下一步。 */
  next: string;
}

const viaCandidate = "如需改动，请通过候选审阅采纳。";
const viaSource = "该内容随原件保留，请在原文档中修改后重新导入。";
export const PROTECTION_DISPLAY: Record<ProtectionKind, ProtectionDisplay> = {
  number: { label: "数字", tone: "info", color: "var(--tp-protect-number)", next: viaCandidate },
  citation: { label: "引用", tone: "pencil", color: "var(--tp-protect-citation)", next: viaCandidate },
  formula: { label: "公式", tone: "success", color: "var(--tp-protect-formula)", next: viaCandidate },
  lock: { label: "锁定内容", tone: "neutral", color: "var(--tp-protect-lock)", next: "如需改动，请先解除锁定。" },
  object: { label: "未解析对象", tone: "stale", color: "var(--tp-stale)", next: viaSource },
  source: { label: "原件内容", tone: "ghost", color: "var(--tp-neutral)", next: viaSource },
};

export function toProtectedRanges(protections: readonly DocsProtection[]): ProtectedRange[] {
  return protections.map((protection) => ({ id: protection.id, kind: protection.kind, anchor: { ...protection.anchor } }));
}

export interface ProtectionReadback {
  protections: DocsProtection[];
  /** 无法回写为单节点锚点的保护（节点已不存在或被拆到多个节点）；宿主应拒绝保存。 */
  lost: string[];
}

/** 编辑器当前的受保护区间 → 快照保护（按 id 对应原保护，保留种类与绑定）。 */
export function protectionsFromRanges(base: readonly DocsProtection[], ranges: readonly ProtectedRange[]): ProtectionReadback {
  const current = new Map(ranges.map((range) => [range.id, range]));
  const protections: DocsProtection[] = [];
  const lost: string[] = [];
  for (const protection of base) {
    const range = current.get(protection.id);
    const anchor = range?.anchor;
    if (!anchor || anchor.segments?.length || (anchor.offsetUnit ?? "scalar") !== "scalar") {
      lost.push(protection.id);
      continue;
    }
    const whole = anchor.start === undefined || anchor.end === undefined;
    protections.push({ ...protection, anchor: whole ? { node: anchor.node } : { node: anchor.node, start: anchor.start, end: anchor.end } });
  }
  return { protections, lost };
}

const isProtectionKind = (kind: string): kind is ProtectionKind => (PROTECTION_KINDS as readonly string[]).includes(kind);

/** blocked 事件的三段式提示：什么被拦下、正文保持不变、下一步。 */
export function describeBlocked(event: BlockedEvent): string {
  if (event.kind === "readonly") return "正文当前只读，修改没有生效。正文保持不变；如需编辑，请先切换到可编辑的版本。";
  if (event.kind === "host") return "这次修改未被允许。正文保持不变；请重新载入最新版本后再编辑。";
  if (event.kind === "constraint") return "论文样式不允许这项格式修改。正文保持不变；请改用样式中的段落格式。";
  const display = isProtectionKind(event.kind) ? PROTECTION_DISPLAY[event.kind] : undefined;
  return `${display?.label ?? "受保护内容"}受保护，修改没有生效。正文保持不变；${display?.next ?? viaCandidate}`;
}
