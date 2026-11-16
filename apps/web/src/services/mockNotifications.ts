import type { NotificationEventRead, NotificationRead, NotificationTransition, ProgressNoteCreate, ProjectRead } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import { notificationInput } from "./httpNotifications.ts";
import type { FeedbackService, JobService, NotificationService, TaskService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

/** 与后端 derivation.py 相同的模块常量；本地 Mock 没有工作区偏好，不模拟静默时段。 */
const DUE_SOON_DAYS = 2;
const FEEDBACK_STALE_DAYS = 7;
const PROJECT_DEADLINE_DAYS = 14;
const JOB_FAILED_LOOKBACK_DAYS = 14;
const COOLDOWN_MS = 24 * 3600_000;
const DAY = 86400_000;
const STATUS_LABELS: Record<string, string> = { todo: "待开始", doing: "进行中", verify: "待核验", rework: "返工" };
const JOB_LABELS: Record<string, string> = {
  diagnostic: "诊断",
  document_inspection: "文档检查",
  configuration_probe: "配置检测",
  material_parse: "资料解析",
  content_revision: "内容修订",
};
const ALLOWED: Record<NotificationTransition["action"], [NotificationRead["status"][], NotificationRead["status"]]> = {
  read: [["unread", "snoozed"], "read"],
  snooze: [["unread", "read", "snoozed"], "snoozed"],
  dismiss: [["unread", "read", "snoozed"], "dismissed"],
  restore: [["snoozed", "dismissed"], "unread"],
};
type Candidate = Omit<
  NotificationRead,
  "id" | "project_id" | "dedupe_key" | "status" | "delivery" | "snooze_until" | "progress_notes" | "version" | "created_at" | "updated_at"
>;

const clone = <T>(value: T): T => structuredClone(value);
const fail = (code: string, status = 409): never => {
  throw new ApiError(code, { status });
};
const localDay = (time: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);
const remaining = (days: number) => (days === 0 ? "今天到期" : `还有 ${days} 天`);
const clip = (text: string, size: number) =>
  Array.from(text).length <= size
    ? text
    : Array.from(text)
        .slice(0, size - 1)
        .join("") + "…";

export function createMockNotifications(
  before: (signal?: AbortSignal) => Promise<void>,
  requireProject: (id: string) => ProjectRead,
  sources: { tasks: TaskService; feedback: FeedbackService; jobs: JobService },
  clock: () => number = Date.now,
): NotificationService {
  const notices = new Map<string, NotificationRead>();
  const events: NotificationEventRead[] = [];
  const commands = new Map<string, { fingerprint: string; result: NotificationRead }>();
  const project = (p: string) => {
    const id = requireUuid(p).toLowerCase();
    requireProject(id);
    return id;
  };
  const owned = (p: string, id: string) => {
    const value = notices.get(requireUuid(id).toLowerCase());
    if (!value || value.project_id !== project(p)) return fail("NOTICE_NOT_FOUND", 404);
    return value;
  };
  const unread = (p: string) => [...notices.values()].filter((n) => n.project_id === p && n.status === "unread").length;
  function record(
    notice: NotificationRead,
    action: NotificationEventRead["action"],
    actor: NotificationEventRead["actor"],
    from: NotificationRead["status"] | null,
    note = "",
  ) {
    events.push({
      id: crypto.randomUUID(),
      notification_id: notice.id,
      notification_title: notice.title,
      object: clone(notice.object),
      version: notice.version,
      action,
      actor,
      from_status: from,
      to_status: notice.status,
      snooze_until: notice.snooze_until,
      note,
      created_at: new Date(clock()).toISOString(),
    });
  }
  function command(p: string, operation: string, input: NotificationTransition | ProgressNoteCreate, apply: () => NotificationRead): NotificationRead {
    const fingerprint = JSON.stringify({ p, operation, input });
    const previous = commands.get(input.command_id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return fail("NOTICE_COMMAND_CONFLICT");
      return clone(previous.result);
    }
    const result = apply();
    commands.set(input.command_id, { fingerprint, result: clone(result) });
    return clone(result);
  }
  function change(notice: NotificationRead, expected: number, allowed: NotificationRead["status"][], next: Partial<NotificationRead>) {
    if (notice.version !== expected) fail("NOTICE_VERSION_CONFLICT");
    if (!allowed.includes(notice.status)) fail("NOTICE_TRANSITION_INVALID");
    Object.assign(notice, next, { version: notice.version + 1, updated_at: new Date(clock()).toISOString() });
  }
  async function derive(p: string, now: number): Promise<Candidate[]> {
    const owner = requireProject(p);
    const today = localDay(now);
    const result: Candidate[] = [];
    const page = await sources.tasks.list(p, { limit: 100 });
    let open = 0;
    for (const summary of page.items) {
      if (summary.status === "confirmed" || summary.archived) continue;
      open += 1;
      const task = await sources.tasks.get(p, summary.id);
      const name = clip(task.content.title, 80);
      const status = `任务状态：${STATUS_LABELS[task.status] ?? task.status} · 任务 v${task.version}`;
      const dates: [string, string][] = [];
      if (task.content.due_date) dates.push(["预计完成", task.content.due_date]);
      if (task.content.hard_deadline) dates.push(["硬截止", task.content.hard_deadline]);
      const object = { type: "task" as const, id: task.id, parent_id: null, source_version: task.version };
      const overdue = dates.filter(([, day]) => day < today);
      if (overdue.length) {
        const [label, day] = overdue.at(-1)!;
        result.push({
          kind: "task_overdue",
          object,
          title: `留意「${name}」的期限`,
          trigger: `已过${label}日期 ${day}，任务尚未确认完成`,
          basis: [...overdue.map(([lb, d]) => `${lb} ${d} · 已过 ${dayDiff(today, d)} 天`), status],
          uncertainty: "期限来自任务记录；尚未确认不等于没有工作，也不代表质量不达标。",
        });
        continue;
      }
      const upcoming = dates.filter(([, day]) => dayDiff(day, today) <= DUE_SOON_DAYS).sort((a, b) => a[1].localeCompare(b[1]));
      if (upcoming.length) {
        const [label, day] = upcoming[0]!;
        result.push({
          kind: "task_due_soon",
          object,
          title: `「${name}」即将到期`,
          trigger: `${label} ${day}，${remaining(dayDiff(day, today))}`,
          basis: [`${label} ${day}`, status],
          uncertainty: "只根据任务日期和确认状态判断；线下完成的部分可能尚未登记。",
        });
      }
    }
    const batches = await sources.feedback.list(p, { limit: 100 });
    for (const batch of batches.items) {
      const items = await sources.feedback.items(p, batch.id, { limit: 100 });
      for (const item of items.items) {
        const days = Math.floor((now - Date.parse(item.updated_at)) / DAY);
        if (item.status !== "open" || days < FEEDBACK_STALE_DAYS) continue;
        result.push({
          kind: "feedback_stale",
          object: { type: "feedback_item", id: item.id, parent_id: batch.id, source_version: item.version },
          title: "导师反馈条目仍待处理",
          trigger: `反馈条目已 ${days} 天没有更新，仍未标记处理`,
          basis: [`原文摘录：${clip(item.preview, 60)}`, `条目 v${item.version} · 最近更新 ${localDay(Date.parse(item.updated_at))}`],
          uncertainty: "只根据条目处理状态判断；线下沟通或已完成的修改可能尚未登记。",
        });
      }
    }
    if (owner.deadline) {
      const days = dayDiff(owner.deadline, today);
      if (days >= 0 && days <= PROJECT_DEADLINE_DAYS)
        result.push({
          kind: "project_deadline",
          object: { type: "project", id: owner.id, parent_id: null, source_version: owner.version },
          title: "论文提交截止临近",
          trigger: `项目截止 ${owner.deadline}，${remaining(days)}`,
          basis: [`项目截止 ${owner.deadline}`, `尚未确认完成的任务 ${open} 项`],
          uncertainty: "截止日期来自项目设置；学校安排有变化时请在项目设置中更新。",
        });
    }
    const jobs = (await sources.jobs.list({ project_id: p, limit: 100 })).items;
    const retried = new Set(jobs.map((job) => job.source_job_id).filter(Boolean));
    for (const job of jobs) {
      if (job.status !== "failed" || retried.has(job.id) || now - Date.parse(job.updated_at) > JOB_FAILED_LOOKBACK_DAYS * DAY) continue;
      result.push({
        kind: "job_failed",
        object: { type: "job", id: job.id, parent_id: null, source_version: job.attempt },
        title: `${JOB_LABELS[job.kind] ?? "后台"}任务失败`,
        trigger: "后台任务执行失败，没有产生结果",
        basis: [`错误码 ${job.error_code ?? "未知"}`, `第 ${job.attempt} 次执行 · ${localDay(Date.parse(job.updated_at))}`],
        uncertainty: "失败的任务不会写入正文或计划；原因可能来自服务或配置，可在任务详情查看后重试。",
      });
    }
    return result;
  }

  return {
    async list(p, query = {}, signal) {
      await before(signal);
      const id = project(p);
      const { limit, offset } = pageQuery(query);
      const tab = query.tab ?? "active";
      const statuses = tab === "active" ? ["unread", "read"] : [tab];
      if (!["active", "snoozed", "dismissed"].includes(tab)) fail("VALIDATION_ERROR", 422);
      const rows = [...notices.values()]
        .filter((n) => n.project_id === id && statuses.includes(n.status))
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      return clone(parseDto("NotificationPage", { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset, unread_count: unread(id) }));
    },
    async unreadCount(p, signal) {
      await before(signal);
      const id = project(p);
      return { project_id: id, unread_count: unread(id) };
    },
    async refresh(p, signal) {
      await before(signal);
      const id = project(p);
      const now = clock();
      let woken = 0;
      for (const notice of notices.values()) {
        if (notice.project_id !== id || notice.status !== "snoozed" || Date.parse(notice.snooze_until!) > now) continue;
        change(notice, notice.version, ["snoozed"], { status: "unread", snooze_until: null });
        record(notice, "snooze_expired", "system", "snoozed");
        woken += 1;
      }
      let created = 0;
      if (!requireProject(id).archived)
        for (const item of await derive(id, now)) {
          const key = `${item.kind}:${item.object.id}:${item.object.source_version}`;
          const blocked = [...notices.values()].some(
            (n) =>
              n.project_id === id &&
              n.kind === item.kind &&
              n.object.id === item.object.id &&
              (n.dedupe_key === key || n.status !== "dismissed" || now - Date.parse(n.created_at) < COOLDOWN_MS),
          );
          if (blocked) continue;
          const stamp = new Date(now).toISOString();
          const notice: NotificationRead = {
            ...item,
            id: crypto.randomUUID(),
            project_id: id,
            dedupe_key: key,
            status: "unread",
            delivery: "alerted",
            snooze_until: null,
            progress_notes: [],
            version: 1,
            created_at: stamp,
            updated_at: stamp,
          };
          notices.set(notice.id, notice);
          record(notice, "created", "system", null);
          created += 1;
        }
      return { project_id: id, created, woken, unread_count: unread(id) };
    },
    async get(p, notificationId, signal) {
      await before(signal);
      return clone(owned(p, notificationId));
    },
    async transition(p, notificationId, input, signal) {
      await before(signal);
      const data = notificationInput("NotificationTransition", input);
      const notice = owned(p, notificationId);
      return command(p, `transition:${notice.id}`, data, () => {
        const until = data.snooze_until ?? null;
        const now = clock();
        if (until !== null && (Date.parse(until) <= now || Date.parse(until) > now + 365 * DAY)) fail("NOTICE_SNOOZE_INVALID", 422);
        const [allowed, target] = ALLOWED[data.action];
        const from = notice.status;
        change(notice, data.expected_version, allowed, { status: target, snooze_until: until });
        record(notice, data.action, "student", from);
        return clone(notice);
      });
    },
    async addProgressNote(p, notificationId, input, signal) {
      await before(signal);
      const data = notificationInput("ProgressNoteCreate", input);
      const notice = owned(p, notificationId);
      return command(p, `progress:${notice.id}`, data, () => {
        const from = notice.status;
        change(notice, data.expected_version, ["unread", "read"], { status: "read" });
        notice.progress_notes.push({ text: data.text, created_at: new Date(clock()).toISOString() });
        record(notice, "progress_note", "student", from, data.text);
        return clone(notice);
      });
    },
    async events(p, query = {}, signal) {
      await before(signal);
      const id = project(p);
      const { limit, offset } = pageQuery(query);
      if (query.notificationId) owned(p, query.notificationId);
      const rows = events
        .filter((e) => notices.get(e.notification_id)?.project_id === id && (!query.notificationId || e.notification_id === query.notificationId.toLowerCase()))
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.version - a.version);
      return clone(parseDto("NotificationEventPage", { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset }));
    },
  };
}
