import type { Tone } from "../../design/tone.ts";
import type { FormatContext, FormatRead, FormatRule } from "../../services/contracts/api.generated.ts";
import type { PreviewHighlight } from "@muffin-office/vue/docs-anchors";
import { compatibleFormatTargets, formatCandidateCurrent } from "../formatting/formatPresentation.ts";

/** 格式候选在纸面上的叠加组。 */
export const FORMAT_GROUP = "format-candidate";

/**
 * 纸面标出受影响段落（整块标记）：查看候选时标出候选涉及的段落（已拒绝的不标）；
 * 未查看候选而正在挑选范围时标出已选目标。仅 v2 目标（带节点 ID）可画。
 */
export function formatHighlights(input: {
  context?: FormatContext;
  rule?: FormatRule;
  selected: readonly string[];
  candidate?: FormatRead;
  version: number;
}): PreviewHighlight[] {
  const { context, rule, selected, candidate, version } = input;
  const nodeOf = new Map((context?.targets ?? []).flatMap((target) => (target.node_id ? [[target.anchor_id, target.node_id] as const] : [])));
  const highlights = new Map<string, PreviewHighlight>();
  if (rule && selected.length)
    for (const target of compatibleFormatTargets(context?.targets ?? [], rule))
      if (target.node_id && selected.includes(target.anchor_id))
        highlights.set(target.node_id, { id: `target:${target.node_id}`, group: FORMAT_GROUP, anchor: { node: target.node_id }, tone: "format" });
  if (candidate && candidate.status === "ready" && candidate.base_version === version && !highlights.size) {
    const decisions = new Map(candidate.decisions.map((item) => [item.patch_id, item.decision]));
    for (const patch of candidate.patches) {
      const node = patch.node_id ?? nodeOf.get(patch.anchor_id);
      if (!node || decisions.get(patch.id) === "reject") continue;
      highlights.set(node, { id: `patch:${node}`, group: FORMAT_GROUP, anchor: { node }, tone: decisions.get(patch.id) === "accept" ? "insert" : "format" });
    }
  }
  return [...highlights.values()];
}

export function formatStatusView(candidate: FormatRead, version: number): { label: string; tone: Tone } {
  if (candidate.status === "applied") return { label: "已采纳", tone: "seal" };
  if (candidate.status === "undone") return { label: "已撤销", tone: "stale" };
  return formatCandidateCurrent(candidate, version, true) ? { label: "待审阅", tone: "pencil" } : { label: "已过期", tone: "stale" };
}
