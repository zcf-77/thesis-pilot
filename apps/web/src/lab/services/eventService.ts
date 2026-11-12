import { onScopeDispose, ref, watch } from "vue";
import { usePreviewWorkspaceStore, type PreviewProject } from "../state/previewWorkspace.ts";
import { createInboxState, receiveNotification, type InboxState, type NotificationEvent, type NotificationPolicy } from "../state/inboxState.ts";

interface ObservableTask {
  id: string;
  title: string;
  deadline: string;
  status: string;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const stringValue = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);
function planFacts(project: PreviewProject) {
  const plan = project.modules.plan;
  if (!record(plan) || !Array.isArray(plan.tasks)) return { version: 0, tasks: [] as ObservableTask[] };
  return { version: typeof plan.version === "number" ? plan.version : 0, tasks: plan.tasks as ObservableTask[] };
}
export function projectNotificationPolicy(
  project: PreviewProject,
  preferences: { notifications: boolean; quietStart: string; quietEnd: string },
): NotificationPolicy {
  const settings = project.modules.settings;
  const reminder = record(settings) && record(settings.reminder) ? settings.reminder : {};
  return {
    ...preferences,
    enabled: reminder.enabled !== false,
    cooldownHours: typeof reminder.cooldownHours === "number" ? reminder.cooldownHours : 24,
    overdueDays: typeof reminder.overdueDays === "number" ? reminder.overdueDays : 3,
  };
}
export function getProjectInbox(project: PreviewProject): InboxState {
  if (!project.modules.inbox) project.modules.inbox = createInboxState();
  return project.modules.inbox as InboxState;
}
/** 可重复调用；只消费业务事实，不消费通知自身产生的操作记录。 */
export function processProjectEvents(project: PreviewProject, events: readonly unknown[], policy: NotificationPolicy, now = Date.now()) {
  const inbox = getProjectInbox(project);
  const plan = planFacts(project);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  for (const task of plan.tasks) {
    if (["confirmed", "done"].includes(task.status) || !/^\d{4}-\d{2}-\d{2}$/.test(task.deadline)) continue;
    const days = Math.floor((Date.parse(today + "T00:00:00+08:00") - Date.parse(task.deadline + "T00:00:00+08:00")) / 86400000);
    if (days <= 0) continue;
    receiveNotification(
      inbox,
      {
        id: `overdue:${project.id}:${task.id}:${task.deadline}:${today}`,
        projectId: project.id,
        type: "overdue",
        objectId: task.id,
        sourceVersion: plan.version,
        overdueDays: days,
        title: `留意「${task.title}」的进度`,
        detail: `计划截止 ${task.deadline}，目前尚未确认完成。可以检查依赖、补充线下进展，或审阅计划调整。`,
        basis: `任务 ${task.id} · 计划 v${plan.version} · 延期 ${days} 天`,
        route: "/screens/plan?task=" + encodeURIComponent(task.id),
        uncertainty: "期限来自计划记录；尚未确认不等于没有工作，也不代表质量不达标。",
      },
      policy,
      now,
    );
  }
  const lastEdit = project.document.history.at(-1);
  const lastEditAt = lastEdit ? Date.parse(lastEdit.at) : Number.NaN;
  if (Number.isFinite(lastEditAt) && now - lastEditAt >= 7 * 86400000 && plan.tasks.some((t) => !["confirmed", "done"].includes(t.status))) {
    receiveNotification(
      inbox,
      {
        id: `no-edit:${project.id}:${project.document.version}:${today}`,
        projectId: project.id,
        type: "no-edit",
        objectId: "document",
        sourceVersion: project.document.version,
        title: "补充最近的工作进展",
        detail: "当前文稿最近7天没有记录到新的编辑。若已在线下开展实验或整理资料，可以补充进展，或继续处理计划中的任务。",
        basis: `正文 v${project.document.version} · 最近一次记录 ${lastEdit!.at} · 本地7天观察窗口`,
        route: "/screens/plan",
        uncertainty: "这里仅描述文稿记录，不推断你没有工作，也不会自动延期或确认任务。",
      },
      policy,
      now,
    );
  }
  for (const source of events) {
    if (!record(source) || source.projectId !== project.id || typeof source.id !== "string") continue;
    const metadata = record(source.metadata) ? source.metadata : source;
    const title = stringValue(source.title, "事件名称未知");
    const type =
      metadata.type === "stage-completed" || /阶段.*完成|完成.*阶段/.test(title)
        ? "stage-completed"
        : metadata.type === "task-confirmed" || /确认.*任务|任务.*确认|确认.*完成/.test(title)
          ? "task-confirmed"
          : null;
    if (!type) continue;
    const sourceRoute = stringValue(source.route, "/screens/plan");
    const route = sourceRoute.startsWith("/screens/") ? sourceRoute : "/screens/plan";
    const objectId = stringValue(metadata.objectId, source.id);
    const event: NotificationEvent = {
      id: source.id,
      projectId: project.id,
      type,
      objectId,
      sourceVersion:
        typeof metadata.sourceVersion === "number" && Number.isSafeInteger(metadata.sourceVersion) && metadata.sourceVersion >= 0
          ? metadata.sourceVersion
          : plan.version,
      title: type === "stage-completed" ? "阶段已确认，看看下一步" : "产物已确认，安排一次自查",
      detail: stringValue(source.detail, "记录内容未知，请查看来源核对；是否继续由你决定。"),
      basis: `${title} · ${stringValue(source.at, "时间未知")} · ${objectId}`,
      route: type === "stage-completed" ? "/screens/plan" : route,
      uncertainty: "这里只记录学生确认，不代表导师认可或论文质量评分。",
    };
    receiveNotification(inbox, event, policy, now);
  }
}

/** 外壳setup中仅调用一次，切项目自动切换数据，卸载清理定时器和观察者。 */
export function useProjectEventBridge() {
  const workspace = usePreviewWorkspaceStore();
  const clock = ref(Date.now());
  const timer = setInterval(() => {
    clock.value = Date.now();
  }, 60000);
  const stop = watch(
    () => {
      const project = workspace.current;
      const plan = planFacts(project);
      return [
        workspace.activeId,
        clock.value,
        project.document.version,
        plan.version,
        plan.tasks.map((t) => [t.id, t.title, t.deadline, t.status]),
        workspace.events.filter((e) => e.projectId === project.id).map((e) => e.id),
      ];
    },
    () => {
      const project = workspace.current;
      processProjectEvents(project, workspace.events, projectNotificationPolicy(project, workspace), clock.value);
    },
    { immediate: true, deep: true },
  );
  onScopeDispose(() => {
    clearInterval(timer);
    stop();
  });
}
