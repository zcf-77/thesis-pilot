import { usePreviewModule } from "./previewWorkspace.ts";

export type SuggestionState = "unread" | "read" | "snoozed" | "dismissed";
export interface InboxSuggestion {
  id: string;
  title: string;
  detail: string;
  basis: string;
  uncertainty: string;
  route: string;
  state: SuggestionState;
  at: string;
  offline: string[];
  eventKey?: string;
  objectId?: string;
  projectId?: string;
  sourceVersion?: number;
  level?: "L1" | "L2" | "L3";
  snoozedUntil?: string;
  occurrences?: number;
  lastMergedAt?: string;
}
export interface InboxHistory {
  id: string;
  at: string;
  title: string;
  detail: string;
  suggestionId: string;
  route: string;
}
export interface InboxState {
  suggestions: InboxSuggestion[];
  triggerKeys: string[];
  lastTriggers: Record<string, number>;
  history?: InboxHistory[];
}
export interface NotificationEvent {
  id: string;
  projectId: string;
  type: "overdue" | "task-confirmed" | "stage-completed" | "no-edit";
  objectId: string;
  title: string;
  detail: string;
  basis: string;
  route: string;
  sourceVersion: number;
  overdueDays?: number;
  uncertainty?: string;
}
export interface NotificationPolicy {
  enabled: boolean;
  notifications: boolean;
  quietStart: string;
  quietEnd: string;
  cooldownHours: number;
  overdueDays: number;
}
export function createInboxState(): InboxState {
  return { suggestions: [], triggerKeys: [], lastTriggers: {}, history: [] };
}
export function useInboxState() {
  return usePreviewModule<InboxState>("inbox", createInboxState);
}
export function appendInboxHistory(state: InboxState, title: string, detail: string, suggestionId = "", route = "/screens/inbox") {
  state.history ??= [];
  state.history.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), title, detail, suggestionId, route });
  if (state.history.length > 1000) state.history.length = 1000;
}
export function isQuietTime(policy: Pick<NotificationPolicy, "quietStart" | "quietEnd">, now: number) {
  const time = new Date(now).toLocaleTimeString("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false });
  const { quietStart: start, quietEnd: end } = policy;
  return start === end ? false : start < end ? time >= start && time < end : time >= start || time < end;
}
/** 同一事实只处理一次；不同对象不共享冷却，静默被抑制的事实留操作记录。 */
export function receiveNotification(state: InboxState, event: NotificationEvent, policy: NotificationPolicy, now = Date.now()) {
  if (state.triggerKeys.includes(event.id)) return { action: "duplicate" as const, message: "相同事件仍在冷却期或已处理，本次没有重复提醒。" };
  state.triggerKeys.push(event.id);
  const quiet = isQuietTime(policy, now);
  const suppressed =
    !policy.enabled || !policy.notifications
      ? "主动建议已关闭，本次没有新增提醒。"
      : quiet
        ? "当前处于静默时段，本次没有新增提醒。"
        : event.type === "overdue" && (event.overdueDays ?? 0) < policy.overdueDays
          ? "尚未达到配置的延期提醒阈值，本次不新增提醒。"
          : "";
  if (suppressed) {
    appendInboxHistory(state, "提醒已抑制", event.title + " · " + suppressed, "", event.route);
    return { action: "suppressed" as const, message: suppressed };
  }
  const cooldownKey = event.projectId + ":" + event.type + ":" + event.objectId;
  const inCooldown = now - (state.lastTriggers[cooldownKey] ?? 0) < policy.cooldownHours * 3600000;
  const previous = state.suggestions.find((s) => s.projectId === event.projectId && s.objectId === event.objectId && s.eventKey?.startsWith(event.type + ":"));
  if (inCooldown && previous) {
    previous.occurrences = (previous.occurrences ?? 1) + 1;
    previous.lastMergedAt = new Date(now).toISOString();
    previous.basis = event.basis;
    previous.sourceVersion = event.sourceVersion;
    appendInboxHistory(state, "同对象事件已合并", event.basis, previous.id, previous.route);
    return { action: "merged" as const, message: "相同对象仍在冷却期，已合并更新依据，没有重复提醒。" };
  }
  state.lastTriggers[cooldownKey] = now;
  const suggestion: InboxSuggestion = {
    id: crypto.randomUUID(),
    projectId: event.projectId,
    eventKey: event.type + ":" + event.id,
    objectId: event.objectId,
    sourceVersion: event.sourceVersion,
    level: ["overdue", "stage-completed"].includes(event.type) ? "L3" : "L2",
    title: event.title,
    detail: event.detail,
    basis: event.basis,
    uncertainty: event.uncertainty ?? "状态来自当前项目记录；线下进展可能尚未补充。",
    route: event.route,
    state: "unread",
    at: new Date(now).toISOString(),
    offline: [],
    occurrences: 1,
    snoozedUntil: "",
  };
  state.suggestions.unshift(suggestion);
  appendInboxHistory(state, "收到有依据的建议", event.title + " · " + event.basis, suggestion.id, event.route);
  return { action: "created" as const, message: "已生成一条建议，依据和不确定性可查看。" };
}
export function updateSuggestion(state: InboxState, suggestion: InboxSuggestion, action: SuggestionState, until = "") {
  if (action === "snoozed" && (!until || Number.isNaN(Date.parse(until)))) return "请选择有效的延后截止时间。";
  suggestion.state = action;
  if (action === "snoozed") suggestion.snoozedUntil = new Date(until).toISOString();
  if (action === "unread") suggestion.snoozedUntil = "";
  const labels = { unread: "放回待留意", read: "已查看建议", snoozed: "延后建议", dismissed: "忽略建议" };
  appendInboxHistory(
    state,
    labels[action],
    suggestion.title + (action === "snoozed" ? " · 延后至 " + suggestion.snoozedUntil : ""),
    suggestion.id,
    suggestion.route,
  );
  return "";
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 2_000_000;
const natural = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export function validateInboxState(v: unknown): v is InboxState {
  if (
    !record(v) ||
    !Array.isArray(v.suggestions) ||
    v.suggestions.length > 10000 ||
    !Array.isArray(v.triggerKeys) ||
    !v.triggerKeys.every(text) ||
    !record(v.lastTriggers) ||
    !Object.values(v.lastTriggers).every(natural)
  )
    return false;
  const ids = new Set<string>();
  if (
    !v.suggestions.every((s) => {
      if (
        !record(s) ||
        !text(s.id) ||
        ids.has(s.id) ||
        !text(s.title) ||
        !text(s.detail) ||
        !text(s.basis) ||
        !text(s.uncertainty) ||
        !text(s.route) ||
        !["unread", "read", "snoozed", "dismissed"].includes(String(s.state)) ||
        !text(s.at) ||
        !Array.isArray(s.offline) ||
        !s.offline.every(text)
      )
        return false;
      ids.add(s.id);
      if (["projectId", "eventKey", "objectId", "lastMergedAt"].some((k) => s[k] !== undefined && !text(s[k]))) return false;
      if (s.sourceVersion !== undefined && !natural(s.sourceVersion)) return false;
      if (s.occurrences !== undefined && (!natural(s.occurrences) || s.occurrences < 1)) return false;
      if (s.level !== undefined && (typeof s.level !== "string" || !["L1", "L2", "L3"].includes(s.level))) return false;
      if (s.snoozedUntil !== undefined && (!text(s.snoozedUntil) || (s.snoozedUntil !== "" && Number.isNaN(Date.parse(s.snoozedUntil))))) return false;
      return true;
    })
  )
    return false;
  return (
    v.history === undefined ||
    (Array.isArray(v.history) &&
      v.history.length <= 10000 &&
      v.history.every((h) => record(h) && ["id", "at", "title", "detail", "suggestionId", "route"].every((k) => text(h[k]))))
  );
}
