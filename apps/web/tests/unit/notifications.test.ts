import { effectScope, nextTick, ref } from "vue";
import { describe, expect, it } from "vite-plus/test";
import { createServices, type NotificationService, type RefreshResult } from "../../src/services/index.ts";
import { resolveWorkspaceRoute, inboxRoute } from "../../src/workspace/workspaceRoutes.ts";
import { inboxTarget, tomorrowMorning } from "../../src/workspace/inbox/inboxModel.ts";
import { useInboxCount } from "../../src/workspace/inbox/useInboxCount.ts";

const command = () => crypto.randomUUID();
async function fixture() {
  const api = createServices({ mode: "mock", instanceId: "notifications-test" });
  const project = await api.projects.create({ name: "合成提醒项目" });
  const task = await api.tasks.create(project.id, {
    command_id: command(),
    expected_board_version: 0,
    content: { title: "整理实验记录", acceptance: "记录可复核", due_date: "2020-01-02" },
  });
  return { api, p: project.id, task };
}

describe("SG10 持久通知同契约（Mock）", () => {
  it("同一事实只生成一次，忽略后不再生成；依据与不确定性来自任务记录", async () => {
    const { api, p, task } = await fixture();
    const first = await api.notifications.refresh(p);
    expect(first).toMatchObject({ created: 1, unread_count: 1 });
    expect((await api.notifications.refresh(p)).created).toBe(0);
    const [notice] = (await api.notifications.list(p)).items;
    expect(notice).toMatchObject({ kind: "task_overdue", object: { type: "task", id: task.id, source_version: 1 }, status: "unread" });
    expect(notice!.basis.join("")).toContain("预计完成 2020-01-02");
    expect(notice!.uncertainty).toContain("不等于没有工作");
    await api.notifications.transition(p, notice!.id, { command_id: command(), expected_version: 1, action: "dismiss" });
    expect((await api.notifications.refresh(p)).created).toBe(0);
    expect((await api.notifications.list(p, { tab: "dismissed" })).total).toBe(1);
    expect((await api.notifications.unreadCount(p)).unread_count).toBe(0);
  });

  it("CAS 冲突、幂等重放、非法状态与过去的延后时间均被拒绝", async () => {
    const { api, p } = await fixture();
    await api.notifications.refresh(p);
    const [notice] = (await api.notifications.list(p)).items;
    const read = { command_id: command(), expected_version: 1, action: "read" as const };
    const [a, b] = await Promise.all([api.notifications.transition(p, notice!.id, read), api.notifications.transition(p, notice!.id, read)]);
    expect(a).toEqual(b);
    await expect(api.notifications.transition(p, notice!.id, { ...read, action: "dismiss" })).rejects.toMatchObject({ code: "NOTICE_COMMAND_CONFLICT" });
    await expect(api.notifications.transition(p, notice!.id, { command_id: command(), expected_version: 1, action: "dismiss" })).rejects.toMatchObject({
      code: "NOTICE_VERSION_CONFLICT",
    });
    await expect(api.notifications.transition(p, notice!.id, { command_id: command(), expected_version: 2, action: "restore" })).rejects.toMatchObject({
      code: "NOTICE_TRANSITION_INVALID",
    });
    await expect(
      api.notifications.transition(p, notice!.id, { command_id: command(), expected_version: 2, action: "snooze", snooze_until: "2020-01-01T00:00:00Z" }),
    ).rejects.toMatchObject({ code: "NOTICE_SNOOZE_INVALID" });
    await expect(api.notifications.transition(p, notice!.id, { command_id: command(), expected_version: 2, action: "snooze" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const until = new Date(Date.now() + 3600_000).toISOString();
    const snoozed = await api.notifications.transition(p, notice!.id, { command_id: command(), expected_version: 2, action: "snooze", snooze_until: until });
    expect(snoozed).toMatchObject({ status: "snoozed", snooze_until: until, version: 3 });
    const restored = await api.notifications.transition(p, notice!.id, { command_id: command(), expected_version: 3, action: "restore" });
    expect(restored).toMatchObject({ status: "unread", snooze_until: null });
    const history = await api.notifications.events(p);
    expect(history.items.map((e) => e.action)).toEqual(["restore", "snooze", "read", "created"]);
  });

  it("线下进展保留原话，不改变任务；跨项目读取与修改均不可见", async () => {
    const { api, p, task } = await fixture();
    await api.notifications.refresh(p);
    const [notice] = (await api.notifications.list(p)).items;
    const words = "  已在实验室完成对照\n数据待整理";
    const noted = await api.notifications.addProgressNote(p, notice!.id, { command_id: command(), expected_version: 1, text: words });
    expect(noted.progress_notes.map((n) => n.text)).toEqual([words]);
    expect(noted.status).toBe("read");
    expect((await api.tasks.get(p, task.id)).status).toBe("todo");
    await expect(api.notifications.addProgressNote(p, notice!.id, { command_id: command(), expected_version: 2, text: "   " })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const other = await api.projects.create({ name: "另一个合成项目" });
    await expect(api.notifications.get(other.id, notice!.id)).rejects.toMatchObject({ code: "NOTICE_NOT_FOUND" });
    expect((await api.notifications.refresh(other.id)).created).toBe(0);
    expect((await api.notifications.events(other.id)).total).toBe(0);
  });
});

describe("SG10 HTTP 适配", () => {
  it("刷新走 POST；拒绝跨项目响应；延后时间规范为 UTC ISO", async () => {
    const p = crypto.randomUUID();
    const id = crypto.randomUUID();
    const calls: { url: string; method: string; body?: string }[] = [];
    const notice = {
      id,
      project_id: p,
      kind: "job_failed",
      object: { type: "job", id: crypto.randomUUID(), parent_id: null, source_version: 1 },
      dedupe_key: "k",
      title: "资料解析任务失败",
      trigger: "后台任务执行失败，没有产生结果",
      basis: ["错误码 X"],
      uncertainty: "不确定",
      status: "snoozed",
      delivery: "alerted",
      snooze_until: "2030-01-01T01:00:00.000Z",
      progress_notes: [],
      version: 2,
      created_at: "2030-01-01T00:00:00Z",
      updated_at: "2030-01-01T00:00:00Z",
    };
    const respond = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
    const http = createServices({
      mode: "http",
      instanceId: "notice-http",
      baseUrl: "/api/v1",
      fetch: async (input, init) => {
        const url = input instanceof Request ? input.url : input.toString();
        calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
        if (url.endsWith("/refresh")) return respond({ project_id: p, created: 0, woken: 0, unread_count: 3 });
        if (url.endsWith("/unread-count")) return respond({ project_id: crypto.randomUUID(), unread_count: 1 });
        return respond(notice);
      },
    });
    expect((await http.notifications.refresh(p)).unread_count).toBe(3);
    expect(calls[0]).toMatchObject({ method: "POST" });
    expect(calls[0]!.url).toContain(`/projects/${p}/notifications/refresh`);
    await expect(http.notifications.unreadCount(p)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await http.notifications.transition(p, id, { command_id: command(), expected_version: 1, action: "snooze", snooze_until: "2030-01-01T09:00:00+08:00" });
    expect(JSON.parse(calls.at(-1)!.body!)).toMatchObject({ action: "snooze", snooze_until: "2030-01-01T01:00:00.000Z" });
    await expect(
      http.notifications.transition(p, id, { command_id: command(), expected_version: 1, action: "snooze", snooze_until: "2030-01-01T09:00" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(http.notifications.list(p, { tab: "history" as never })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("SG10 收件箱路由与角标", () => {
  it("深链到任务、反馈、任务详情与项目设置；路由解析项目隔离", () => {
    const p = crypto.randomUUID();
    const object = (type: "task" | "feedback_item" | "job" | "project", parent: string | null = null) => ({
      object: { type, id: "00000000-0000-4000-8000-000000000001", parent_id: parent, source_version: 1 },
    });
    expect(inboxTarget(object("task"), p, "http:x")).toMatchObject({ name: "workspace-tasks", query: { task: object("task").object.id } });
    expect(inboxTarget(object("feedback_item", "b"), p, "http:x")).toMatchObject({ name: "workspace-feedback", query: { batch: "b" } });
    expect(inboxTarget(object("job"), p, "http:x")).toMatchObject({ name: "workspace-job", query: { source: "http:x" } });
    expect(inboxTarget(object("project"), p, "http:x")).toMatchObject({ name: "workspace-projects", query: { settings: p } });
    expect(inboxRoute(p, "snoozed")).toMatchObject({ query: { tab: "snoozed" } });
    expect(resolveWorkspaceRoute({ name: "workspace-inbox", params: { projectId: p.toUpperCase() }, query: {} }, "s")).toEqual({ page: "inbox", projectId: p });
    expect(resolveWorkspaceRoute({ name: "workspace-inbox", params: { projectId: "bad" }, query: {} }, "s")).toEqual({ page: "invalid" });
    expect(tomorrowMorning(new Date(2030, 0, 31, 23, 50))).toBe("2030-02-01T09:00");
  });

  it("切换项目清零并忽略迟到结果；页面结果优先；聚焦时静默刷新", async () => {
    const pending: { id: string; resolve: (value: RefreshResult) => void }[] = [];
    const service = {
      refresh: (id: string) => new Promise<RefreshResult>((resolve) => pending.push({ id, resolve })),
    } as unknown as NotificationService;
    const project = ref<string | undefined>("a");
    const target = new EventTarget() as Window;
    const scope = effectScope();
    const inbox = scope.run(() => useInboxCount(service, project, target))!;
    project.value = "b";
    await nextTick();
    expect(pending.map((p) => p.id)).toEqual(["a", "b"]);
    pending[0]!.resolve({ project_id: "a", created: 0, woken: 0, unread_count: 7 });
    await Promise.resolve();
    expect(inbox.count.value).toBe(0);
    pending[1]!.resolve({ project_id: "b", created: 0, woken: 0, unread_count: 2 });
    await new Promise((resolve) => setTimeout(resolve));
    expect(inbox.count.value).toBe(2);
    target.dispatchEvent(new Event("focus"));
    expect(pending).toHaveLength(3);
    inbox.accept("b", 1);
    pending[2]!.resolve({ project_id: "b", created: 0, woken: 0, unread_count: 5 });
    await new Promise((resolve) => setTimeout(resolve));
    expect(inbox.count.value).toBe(1);
    inbox.accept("a", 9);
    expect(inbox.count.value).toBe(1);
    scope.stop();
    target.dispatchEvent(new Event("focus"));
    expect(pending).toHaveLength(3);
  });
});
