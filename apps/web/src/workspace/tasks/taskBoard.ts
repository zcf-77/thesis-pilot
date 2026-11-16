import type { EvidenceSnapshot, FeedbackItemSummary, TaskRead, TaskSummary, TaskVersionRead } from "../../services/index.ts";
import type { FlowStage } from "../../services/contracts/api.generated.ts";
import type { StageView } from "../../domain/types.ts";
import type { Tone } from "../../design/tone.ts";
import type { EvidenceDraft } from "./taskFeedbackDraft.ts";

export type TaskFilter = "open" | "all";
export type TaskState = TaskSummary["status"];

export const statusWord: Record<TaskState, { label: string; tone: Tone }> = {
  todo: { label: "待开始", tone: "neutral" },
  doing: { label: "进行中", tone: "info" },
  verify: { label: "待核验", tone: "warning" },
  confirmed: { label: "学生已确认", tone: "seal" },
  rework: { label: "返工", tone: "danger" },
};
export const actionWord: Record<string, string> = {
  create: "人工新增",
  edit: "人工编辑",
  update: "人工编辑",
  confirm: "学生确认完成",
  rework: "记录返工",
  reopen: "重新打开",
};

export function statusFor(task: Pick<TaskSummary, "status" | "needs_review">) {
  return task.status === "confirmed" && task.needs_review ? { label: "已确认 · 需复核", tone: "warning" as Tone } : statusWord[task.status];
}

export function localToday(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
export const shortDate = (date: string) => date.slice(5).replace("-", ".");

export function isOverdue(task: Pick<TaskSummary, "due_date" | "status" | "archived">, today: string) {
  return !!task.due_date && task.due_date < today && task.status !== "confirmed" && !task.archived;
}

/** 进度只计未归档任务；学生已确认且服务端判定证据仍有效才计入完成。 */
export function boardProgress(items: readonly TaskSummary[]) {
  const active = items.filter((item) => !item.archived);
  return {
    valid: active.filter((item) => item.status === "confirmed" && !item.needs_review).length,
    review: active.filter((item) => item.status === "confirmed" && item.needs_review).length,
    total: active.length,
  };
}

/** 未完成包含尚未确认的任务，以及确认后证据失效、需要重新复核的任务。 */
export function filterTasks(items: readonly TaskSummary[], filter: TaskFilter) {
  return filter === "all" ? [...items] : items.filter((item) => !item.archived && (item.status !== "confirmed" || item.needs_review));
}

/** 只合并不旧于缓存的读取结果，迟到的旧版本不能覆盖新版本。 */
export function mergeDetail(cache: ReadonlyMap<string, TaskRead>, task: TaskRead) {
  const current = cache.get(task.id);
  if (current && current.version > task.version) return cache;
  const next = new Map(cache);
  next.set(task.id, task);
  return next;
}

export function staleIds(items: readonly TaskSummary[], cache: ReadonlyMap<string, TaskRead>) {
  return items.filter((item) => cache.get(item.id)?.version !== item.version).map((item) => item.id);
}

/** 限流并发读取；任一失败不影响其他条目，调用方按结果逐条合并。 */
export async function readAll<T>(ids: readonly string[], read: (id: string) => Promise<T>, signal: AbortSignal, concurrency = 4) {
  const queue = [...ids];
  const results: T[] = [];
  const failures: string[] = [];
  async function worker() {
    while (queue.length && !signal.aborted) {
      const id = queue.shift()!;
      try {
        results.push(await read(id));
      } catch {
        failures.push(id);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return { results, failures };
}

export function successorsOf(taskId: string, items: readonly TaskSummary[], cache: ReadonlyMap<string, TaskRead>) {
  const id = taskId.toLowerCase();
  return {
    tasks: items.filter((item) => item.id !== taskId && (cache.get(item.id)?.content.depends_on ?? []).some((value) => value.toLowerCase() === id)),
    complete: items.every((item) => item.id === taskId || cache.get(item.id)?.version === item.version),
  };
}

export function evidenceKey(evidence: EvidenceDraft) {
  return evidence.kind === "document"
    ? JSON.stringify([
        "document",
        evidence.document_id.toLowerCase(),
        evidence.version,
        evidence.selection.textblock_path,
        evidence.selection.from,
        evidence.selection.to,
      ])
    : JSON.stringify([
        "material",
        evidence.material_id.toLowerCase(),
        evidence.original_id.toLowerCase(),
        evidence.parse_version_id.toLowerCase(),
        [...evidence.anchor_ids].map((id) => id.toLowerCase()).sort(),
      ]);
}

export interface EvidenceItem {
  key: string;
  reference: EvidenceDraft;
  label: string;
  stale: boolean;
}
/** 当前证据以任务内容为准，标签与是否过期取自服务端解析的快照。 */
export function activeEvidence(task: TaskRead): EvidenceItem[] {
  const snapshots = new Map(task.evidence_snapshots.map((item) => [evidenceKey(item.reference), item]));
  return (task.content.evidence ?? []).map((reference) => {
    const key = evidenceKey(reference);
    const snapshot = snapshots.get(key);
    return { key, reference, label: snapshot?.label ?? "未解析的证据", stale: snapshot?.stale ?? true };
  });
}
/** 曾经关联、当前已解除的证据，按最近一次出现排序。 */
export function archivedEvidence(task: TaskRead, versions: readonly TaskVersionRead[]): EvidenceItem[] {
  const active = new Set((task.content.evidence ?? []).map(evidenceKey));
  const seen = new Set<string>();
  const output: EvidenceItem[] = [];
  for (const entry of [...versions].sort((a, b) => b.version - a.version)) {
    for (const snapshot of entry.snapshot.evidence_snapshots as EvidenceSnapshot[]) {
      const key = evidenceKey(snapshot.reference);
      if (active.has(key) || seen.has(key)) continue;
      seen.add(key);
      output.push({ key, reference: snapshot.reference, label: snapshot.label, stale: true });
    }
  }
  return output;
}

export function feedbackFor(taskId: string, items: readonly FeedbackItemSummary[]) {
  const id = taskId.toLowerCase();
  return items.filter((item) => item.task_id?.toLowerCase() === id);
}

/** 阶段按绑定流程版本的顺序展示；当前阶段之前视为已走过，未定位当前阶段时全部为待走。 */
export function stageViews(stages: readonly FlowStage[], currentId: string | null): StageView[] {
  const enabled = stages.filter((stage) => stage.enabled !== false);
  const current = enabled.findIndex((stage) => stage.id === currentId);
  return enabled.map((stage, index) => ({
    id: stage.id,
    name: stage.name,
    state: current < 0 || index > current ? "upcoming" : index === current ? "current" : "done",
    date: stage.deadline ?? undefined,
  }));
}
