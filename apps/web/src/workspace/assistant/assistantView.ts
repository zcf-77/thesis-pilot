import type { Tone } from "../../design/tone.ts";
import type { AssistantRunRead, RevisionSummary } from "../../services/contracts/api.generated.ts";

/** 会话切换只记忆本机阅读位置，不进入正式消息或备份。 */
export const messageScrollPositions = new Map<string, number>();

export const RUN_VIEW: Record<AssistantRunRead["status"], { label: string; tone: Tone }> = {
  queued: { label: "排队中", tone: "neutral" },
  running: { label: "正在生成", tone: "info" },
  succeeded: { label: "已完成", tone: "success" },
  failed: { label: "生成失败", tone: "danger" },
  cancelled: { label: "已取消", tone: "ghost" },
};

export function runIsActive(run: Pick<AssistantRunRead, "status"> | undefined): boolean {
  return run?.status === "queued" || run?.status === "running";
}

export function candidateNeedsReview(candidate: Pick<RevisionSummary, "status" | "base_version">, currentVersion: number): boolean {
  return candidate.base_version === currentVersion && (candidate.status === "ready" || candidate.status === "invalid");
}

/** 保留正在审阅的对象；当前对象消失时才选择最新候选，避免后台刷新打断逐项决定。 */
export function reconcileCandidateChoice(currentId: string, items: readonly Pick<RevisionSummary, "id">[]): string {
  if (items.some((item) => item.id === currentId)) return currentId;
  return items[0]?.id ?? "";
}

export function isNearMessageBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - clientHeight - scrollTop <= 32;
}

/** 在列表顶部插入更早消息时，以新增高度补偿滚动位置，保持原阅读锚点。 */
export function scrollTopAfterEarlierMessages(previousTop: number, previousHeight: number, nextHeight: number): number {
  return Math.max(0, previousTop + nextHeight - previousHeight);
}

export function formatAssistantTime(value: string): string {
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? time.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "时间未知";
}
