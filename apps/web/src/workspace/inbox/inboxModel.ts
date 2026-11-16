import type { RouteLocationRaw } from "vue-router";
import type { NotificationEventRead, NotificationRead } from "../../services/index.ts";
import { jobRoute, projectsRoute } from "../workspaceRoutes.ts";

export type InboxAction = { kind: "view" } | { kind: "note"; text: string } | { kind: "snooze"; until: string } | { kind: "dismiss" } | { kind: "restore" };

export const inboxKindLabel: Record<NotificationRead["kind"], string> = {
  task_due_soon: "任务即将到期",
  task_overdue: "任务已过期限",
  feedback_stale: "反馈待处理",
  project_deadline: "提交截止临近",
  job_failed: "后台任务失败",
};

export const inboxEventLabel: Record<NotificationEventRead["action"], string> = {
  created: "收到提醒",
  read: "查看提醒",
  snooze: "延后提醒",
  dismiss: "忽略提醒",
  restore: "放回待留意",
  progress_note: "补充线下进展",
  snooze_expired: "延后到期，回到待留意",
};

const timeFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
export function formatInboxTime(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : timeFormat.format(time);
}

/** 本地时区明天 09:00，格式与 TpDatePicker 的 datetime-local 一致。 */
export function tomorrowMorning(now: Date): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T09:00`;
}

/** 深链到提醒对象；对象引用来自服务端记录，不由页面拼装业务结论。 */
export function inboxTarget(notice: Pick<NotificationRead, "object">, projectId: string, source: string): RouteLocationRaw {
  const { type, id, parent_id: parent } = notice.object;
  if (type === "task") return { name: "workspace-tasks", params: { projectId }, query: { task: id } };
  if (type === "feedback_item") return { name: "workspace-feedback", params: { projectId }, query: parent ? { batch: parent, item: id } : { item: id } };
  if (type === "job") return jobRoute(projectId, id, source);
  return { ...projectsRoute, query: { settings: projectId } };
}
