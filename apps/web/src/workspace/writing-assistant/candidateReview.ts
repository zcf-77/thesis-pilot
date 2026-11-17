import type { Tone } from "../../design/tone.ts";
import type { RevisionRead } from "../../services/index.ts";
import type { RevisionCheck } from "../../services/contracts/api.generated.ts";
import { isNodePatch, isNodeSelection } from "../../services/revisionProtectionV2.ts";
import type { PreviewHighlight } from "@muffin-office/vue/docs-anchors";

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
