import type { Tone } from "../../design/tone.ts";
import type { RevisionRead } from "../../services/index.ts";
import type { RevisionCheck, RevisionNodePatch, RevisionNodeSelection } from "../../services/contracts/api.generated.ts";
import type { DiffSegment } from "../../domain/types.ts";
import { isNodePatch, isNodeSelection } from "../../services/revisionProtectionV2.ts";
import type { PreviewHighlight } from "@muffin-office/vue/docs-anchors";

const CONTEXT = 12;

/** 片段差异带上选区内的前后文（各至多 12 字），便于在面板里读懂改动位置。 */
export function hunkSegments(selection: RevisionNodeSelection, patch: RevisionNodePatch): DiffSegment[] {
  const chars = Array.from(selection.expected_text);
  const from = patch.start - selection.start;
  const to = patch.end - selection.start;
  const before = chars.slice(Math.max(0, from - CONTEXT), Math.max(0, from)).join("");
  const after = chars.slice(Math.max(0, to), to + CONTEXT).join("");
  return [
    ...(before ? [{ t: "eq" as const, text: (from > CONTEXT ? "…" : "") + before }] : []),
    { t: "del" as const, text: patch.before },
    ...(patch.after ? [{ t: "ins" as const, text: patch.after }] : []),
    ...(after ? [{ t: "eq" as const, text: after + (to + CONTEXT < chars.length ? "…" : "") }] : []),
  ];
}

/** 内容候选在纸面上的叠加组；写作页按组替换。 */
export const CANDIDATE_GROUP = "assistant-candidate";

export const CHECK_LABELS: Record<RevisionCheck["rule"], string> = {
  version: "基础版本",
  range: "选区范围",
  number: "数字与单位",
  citation: "引用",
  formula: "公式",
  lock: "锁定内容",
  overlap: "片段重叠",
  structure: "正文结构",
};

export const STATUS_VIEW: Record<RevisionRead["status"], { label: string; tone: Tone }> = {
  generating: { label: "生成中", tone: "info" },
  ready: { label: "待审阅", tone: "pencil" },
  invalid: { label: "未通过保护检查", tone: "warning" },
  failed: { label: "生成失败", tone: "danger" },
  cancelled: { label: "已放弃", tone: "ghost" },
  applied: { label: "已采纳", tone: "seal" },
  undone: { label: "已撤销", tone: "stale" },
};

export type CandidateHint = "ineligible" | "moved" | null;

/**
 * 审阅区底部至多一条说明。刚采纳、正文尚未载入采纳结果（当前版本低于采纳结果版本）时不提示：
 * 采纳回执已说明正在重新载入，此时的“不是最新版本”“已有新版本”都只是载入前的过渡状态。
 */
export function candidateHint(candidate: Pick<RevisionRead, "status" | "result_version">, currentVersion: number, eligible: boolean): CandidateHint {
  if (candidate.status === "applied") {
    const result = candidate.result_version;
    if (result != null && currentVersion < result) return null;
    if (result != null && currentVersion > result) return "moved";
    return eligible ? null : "ineligible";
  }
  return !eligible && (candidate.status === "ready" || candidate.status === "invalid") ? "ineligible" : null;
}

/**
 * 候选的纸面差异：待定片段铅笔标记，已接受片段标为将写入，已拒绝片段不画；
 * 未通过的检查定位到具体片段时以批注色标出。仅 v2 候选（节点锚点）可画。
 */
export function candidateHighlights(candidate: RevisionRead): PreviewHighlight[] {
  const selection = candidate.selection;
  if (!isNodeSelection(selection) || !["ready", "invalid"].includes(candidate.status)) return [];
  const node = selection.node_id;
  const decisions = new Map(candidate.decisions.map((item) => [item.patch_id, item.decision]));
  const highlights: PreviewHighlight[] = candidate.patches.filter(isNodePatch).flatMap((patch) => {
    const decision = decisions.get(patch.id) ?? "pending";
    if (decision === "rejected") return [];
    return [
      {
        id: `${candidate.id}:${patch.id}`,
        group: CANDIDATE_GROUP,
        anchor: { node, start: patch.start, end: patch.end },
        tone: decision === "accepted" ? "insert" : "mark",
      },
    ];
  });
  for (const check of candidate.checks)
    if (check.result === "fail" && check.rule !== "version" && check.start != null && check.end != null)
      highlights.push({
        id: `${candidate.id}:check:${check.rule}`,
        group: CANDIDATE_GROUP,
        anchor: { node, start: check.start, end: check.end },
        tone: "comment",
      });
  return highlights;
}
