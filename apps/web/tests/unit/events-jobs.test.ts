import { describe, expect, it } from "vite-plus/test";
import { makeProject } from "../../src/lab/state/previewWorkspace.ts";
import { cancelPreviewJob, getProjectJobs, normalizeRestoredJobs, retryProjectJob, startProjectJob, validateJobsState } from "../../src/lab/state/jobState.ts";
import {
  createInboxState,
  isQuietTime,
  receiveNotification,
  updateSuggestion,
  validateInboxState,
  type NotificationEvent,
  type NotificationPolicy,
} from "../../src/lab/state/inboxState.ts";
import { getProjectInbox, processProjectEvents } from "../../src/lab/services/eventService.ts";

const policy: NotificationPolicy = { enabled: true, notifications: true, quietStart: "00:00", quietEnd: "00:00", cooldownHours: 24, overdueDays: 3 };
const noon = Date.UTC(2026, 10, 14, 4);
const event = (id: string, objectId = "task-a"): NotificationEvent => ({
  id,
  objectId,
  projectId: "p",
  type: "overdue",
  sourceVersion: 2,
  title: "任务延期",
  detail: "仍未确认",
  basis: "计划 v2",
  route: "/screens/plan?task=" + objectId,
  overdueDays: 5,
});

describe("统一任务：项目、尝试与取消边界", () => {
  it("托盘取消驱动来源取消且拒绝迟到完成，重试保留前次输入和诊断", () => {
    const project = makeProject("A", true);
    let cancelCount = 0;
    let retryCount = 0;
    const spec = { title: "解析自制文档", kind: "解析", route: "/screens/library", sourceId: "material-a", input: "资料 v1", snapshot: { materialVersion: 1 } };
    const first = startProjectJob(project, spec, {
      cancel: () => {
        cancelCount++;
        first.cancel();
      },
      retry: () => {
        retryCount++;
        startProjectJob(project, { ...spec, input: "资料 v2", snapshot: { materialVersion: 2 } });
      },
    });
    const job = getProjectJobs(project).jobs[0]!;
    cancelPreviewJob(job);
    expect(cancelCount).toBe(1);
    expect(first.finish("done", "迟到结果")).toBe(false);
    expect(job.status).toBe("cancelled");
    const previous = JSON.stringify(job.attempts![0]);
    expect(retryProjectJob(job)).toBe(true);
    expect(retryCount).toBe(1);
    expect(job.attempt).toBe(2);
    expect(JSON.stringify(job.attempts![0])).toBe(previous);
    expect(job.attempts![1]!.snapshot.materialVersion).toBe(2);
    expect(job.attempts![0]!.finishedAt).not.toBe("");
  });
  it("句柄固定项目与输入，外部配置变更不追改历史", () => {
    const first = makeProject("A", true),
      second = makeProject("B", true);
    const snapshot = { config: [{ id: "api", version: 1 }] };
    const handle = startProjectJob(first, { title: "配置测试", kind: "配置", route: "/screens/settings", input: "v1", snapshot });
    snapshot.config[0]!.version = 2;
    handle.finish("failed", "认证失败");
    expect(getProjectJobs(first).jobs[0]!.attempts![0]!.snapshot.config).toEqual([{ id: "api", version: 1 }]);
    expect(getProjectJobs(second).jobs).toHaveLength(0);
    expect(handle.finish("done", "重复结果")).toBe(false);
  });
  it("恢复只取消活动尝试，保留旧失败记录并拒绝非法枚举和计数", () => {
    const project = makeProject("A", true);
    const spec = { title: "评审", kind: "评审", route: "/screens/review", input: "正文 v1", sourceId: "review" };
    startProjectJob(project, spec).finish("failed", "第一次失败");
    startProjectJob(project, spec);
    const state = getProjectJobs(project);
    normalizeRestoredJobs(state);
    expect(state.jobs[0]!.status).toBe("cancelled");
    expect(state.jobs[0]!.attempts![0]!.diagnosis).toBe("第一次失败");
    expect(state.jobs[0]!.attempts![1]!.finishedAt).not.toBe("");
    expect(validateJobsState(state)).toBe(true);
    for (const bad of [{ status: "unknown-state" }, { kind: "unknown-kind" }, { attempt: -1 }, { token: -1 }]) {
      expect(validateJobsState({ jobs: [{ ...state.jobs[0], ...bad }] })).toBe(false);
    }
  });
});

describe("主动事件：事实、去重、静默与延后", () => {
  it("相同事件幂等、同对象冷却合并且保留历史，不吞掉另一个任务", () => {
    const state = createInboxState();
    expect(receiveNotification(state, event("e1"), policy, noon).action).toBe("created");
    expect(receiveNotification(state, event("e1"), policy, noon + 1).action).toBe("duplicate");
    expect(receiveNotification(state, { ...event("e2"), basis: "计划 v3", sourceVersion: 3 }, policy, noon + 2).action).toBe("merged");
    expect(receiveNotification(state, event("e3", "task-b"), policy, noon + 3).action).toBe("created");
    expect(state.suggestions).toHaveLength(2);
    const merged = state.suggestions.find((s) => s.objectId === "task-a")!;
    expect(merged.occurrences).toBe(2);
    expect(merged.basis).toBe("计划 v3");
    expect(state.history!.some((h) => h.title === "同对象事件已合并")).toBe(true);
  });
  it("跨午夜静默、开关及延期阈值走同一规则，抑制有记录", () => {
    const state = createInboxState();
    expect(isQuietTime({ quietStart: "22:00", quietEnd: "08:00" }, Date.UTC(2026, 10, 14, 16))).toBe(true);
    expect(isQuietTime({ quietStart: "22:00", quietEnd: "08:00" }, noon)).toBe(false);
    expect(receiveNotification(state, event("disabled"), { ...policy, notifications: false }, noon).action).toBe("suppressed");
    expect(receiveNotification(state, { ...event("threshold"), overdueDays: 1 }, policy, noon).action).toBe("suppressed");
    expect(state.suggestions).toHaveLength(0);
    expect(state.history).toHaveLength(2);
  });
  it("真实任务期限及阶段事件自动生成对应对象提醒，重复处理不新增", () => {
    const project = makeProject("A", true);
    project.modules.plan = { version: 4, tasks: [{ id: "new-task", title: "自制新任务", deadline: "2026-11-08", status: "doing" }] };
    const source = {
      id: "stage",
      projectId: project.id,
      type: "stage-completed",
      objectId: "proposal",
      sourceVersion: 2,
      title: "阶段完成",
      detail: "学生确认",
      at: new Date(noon).toISOString(),
      route: "/screens/plan",
    };
    processProjectEvents(project, [source], policy, noon);
    const state = getProjectInbox(project);
    expect(state.suggestions).toHaveLength(2);
    expect(state.suggestions.some((s) => s.route.includes("new-task") && s.sourceVersion === 4)).toBe(true);
    expect(state.suggestions.some((s) => s.objectId === "proposal" && s.level === "L3")).toBe(true);
    processProjectEvents(project, [source], policy, noon);
    expect(state.suggestions).toHaveLength(2);
    expect(state.suggestions.some((s) => (s.level as string) === "L4")).toBe(false);
  });
  it("七天无文稿记录只陈述观察范围，不确认任务或推断线下工作", () => {
    const project = makeProject("A", true);
    project.document.history[0]!.at = "2026-11-01T00:00:00.000Z";
    project.modules.plan = { version: 1, tasks: [{ id: "t", title: "任务", deadline: "2026-12-01", status: "doing" }] };
    processProjectEvents(project, [], policy, noon);
    const state = getProjectInbox(project);
    expect(state.suggestions).toHaveLength(1);
    expect(state.suggestions[0]!.uncertainty).toContain("不推断");
    expect((project.modules.plan as { tasks: { status: string }[] }).tasks[0]!.status).toBe("doing");
  });
  it("延后有截止与操作记录，恢复保留记录；非法状态备份被拒绝", () => {
    const state = createInboxState();
    receiveNotification(state, event("e1"), policy, noon);
    const suggestion = state.suggestions[0]!;
    expect(updateSuggestion(state, suggestion, "snoozed", "bad-time")).not.toBe("");
    expect(suggestion.state).toBe("unread");
    expect(updateSuggestion(state, suggestion, "snoozed", "2030-01-01T12:00:00Z")).toBe("");
    expect(suggestion.snoozedUntil).toBe("2030-01-01T12:00:00.000Z");
    updateSuggestion(state, suggestion, "unread");
    expect(state.history!.map((h) => h.title)).toContain("延后建议");
    expect(validateInboxState(state)).toBe(true);
    expect(validateInboxState({ ...state, suggestions: [{ ...suggestion, state: "unknown-state" }] })).toBe(false);
    expect(validateInboxState({ ...state, suggestions: [{ ...suggestion, occurrences: -1 }] })).toBe(false);
  });
});
