import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { effectScope, nextTick, ref } from "vue";
import type { FlowRead, FlowStage, FlowVersionRead } from "../../src/services/contracts/api.generated.ts";
import type { ProjectFlowService, ProjectRead, ProjectService } from "../../src/services/index.ts";
import { ApiError } from "../../src/services/errors.ts";
import type { WorkspaceSession, workspaceAccess } from "../../src/services/workspace.ts";
import { documentHeadings, loadSearchSource, matchRows } from "../../src/workspace/shell/commandSearch.ts";
import { findFlowVersion, shellStageProgress } from "../../src/workspace/shell/progress.ts";
import { findWorkspaceProjects, useWorkspaceProject } from "../../src/workspace/useWorkspaceProject.ts";
import { useWorkspaceSession } from "../../src/workspace/useWorkspaceSession.ts";
import { mergeProfileDraft, profileDraft } from "../../src/workspace/workspaceProfile.ts";
import {
  materialLink,
  materialsRoute,
  projectCreateRoute,
  projectSettingsRoute,
  projectsLink,
  projectsLinkKeys,
  resolveWorkspaceRoute,
  tasksRoute,
  workspaceSpace,
} from "../../src/workspace/workspaceRoutes.ts";

const first = "e5f51398-1895-45f0-96d5-035c589d59de";
const second = "50c591e9-e435-4399-a767-b20c350d9dc4";
const documentId = "70bd328c-0fcf-4b52-8d19-13c6f9ac230e";
const source = "http:workspace";

function project(id: string, name: string): ProjectRead {
  return {
    id,
    name,
    version: 1,
    created_at: "2026-11-17T00:00:00Z",
    updated_at: "2026-11-17T00:00:00Z",
    title: "",
    deadline: null,
    planning_mode: "none",
    plan_note: "",
    existing_artifacts: "",
    archived: false,
    flow_version_id: null,
    stage_id: null,
  };
}

describe("登录与恢复会话的默认项目", () => {
  const storageKey = "thesispilot.workspace.project.v1:workspace-entry";
  let scope: ReturnType<typeof effectScope>;
  let stored: Map<string, string>;
  beforeEach(() => {
    scope = effectScope();
    stored = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });
  });
  afterEach(() => {
    scope.stop();
    vi.unstubAllGlobals();
  });
  function service(items: ProjectRead[]) {
    return {
      get: vi.fn<ProjectService["get"]>(async (id) => {
        const item = items.find((row) => row.id === id);
        if (!item) throw new ApiError("PROJECT_NOT_FOUND", { status: 404 });
        return item;
      }),
      list: vi.fn<ProjectService["list"]>(async ({ offset = 0, limit = 100 } = {}) => ({
        items: items.slice(offset, offset + limit),
        total: items.length,
        offset,
        limit,
      })),
      create: vi.fn(),
      update: vi.fn(),
    } satisfies ProjectService;
  }
  function open(projects: ProjectService, route = ref<string | undefined>()) {
    return scope.run(() => useWorkspaceProject(projects, "workspace-entry", route))!;
  }

  test("首次登录只有一个空间时自动选中并保存最近记录", async () => {
    const active = open(service([project(first, "论文一")]));
    expect(active.status.value).toBe("loading");
    await vi.waitFor(() => expect(active.project.value?.id).toBe(first));
    expect(stored.get(storageKey)).toBe(first);
    expect(active.status.value).toBe("ready");
  });

  test("无历史时遍历分页，选择最近更新且未归档的空间", async () => {
    const archived = { ...project(documentId, "归档论文"), archived: true, updated_at: "2026-11-20T00:00:00Z" };
    const latest = { ...project(second, "最近论文"), updated_at: "2026-11-19T00:00:00Z" };
    const projects = service([project(first, "较早论文"), archived, latest]);
    projects.list = vi.fn<ProjectService["list"]>(async ({ offset = 0 } = {}) => ({
      items: offset === 0 ? [project(first, "较早论文"), archived] : [latest],
      total: 3,
      offset,
      limit: 100,
    }));
    const active = open(projects);
    await vi.waitFor(() => expect(active.project.value?.id).toBe(second));
    expect(projects.list).toHaveBeenNthCalledWith(2, { offset: 2, limit: 100 }, expect.any(AbortSignal));
  });

  test("恢复最近空间优先于更新时间，切换空间后更新下一次恢复记录", async () => {
    stored.set(storageKey, first.toUpperCase());
    const projects = service([project(first, "最近使用"), { ...project(second, "最近更新"), updated_at: "2026-11-20T00:00:00Z" }]);
    const route = ref<string | undefined>();
    const active = open(projects, route);
    await vi.waitFor(() => expect(active.project.value?.id).toBe(first));
    expect(projects.list).not.toHaveBeenCalled();
    route.value = second;
    await vi.waitFor(() => expect(active.project.value?.id).toBe(second));
    expect(stored.get(storageKey)).toBe(second);
    scope.stop();
    scope = effectScope();
    const restored = open(projects);
    await vi.waitFor(() => expect(restored.project.value?.id).toBe(second));
  });

  test.each(["missing", "archived"])("最近空间 %s 时自动选择另一个可用空间", async (state) => {
    stored.set(storageKey, first);
    const items = [project(second, "可用论文")];
    if (state === "archived") items.push({ ...project(first, "归档论文"), archived: true });
    const active = open(service(items));
    await vi.waitFor(() => expect(active.project.value?.id).toBe(second));
    expect(stored.get(storageKey)).toBe(second);
  });

  test.each([{ items: [] }, { items: [{ ...project(first, "归档论文"), archived: true }] }])("没有可用空间时交由根入口进入项目目录", async ({ items }) => {
    stored.set(storageKey, first);
    const active = open(service(items));
    await vi.waitFor(() => expect(active.status.value).toBe("idle"));
    expect(active.project.value).toBeUndefined();
    expect(active.requestedId.value).toBeUndefined();
    expect(stored.has(storageKey)).toBe(false);
  });

  test("显式深链优先，深链不存在时保留缺失状态，不跳到其他空间", async () => {
    stored.set(storageKey, first);
    const projects = service([project(first, "记忆论文"), project(second, "链接论文")]);
    const route = ref<string | undefined>(second);
    const active = open(projects, route);
    await vi.waitFor(() => expect(active.project.value?.id).toBe(second));
    route.value = documentId;
    await vi.waitFor(() => expect(active.status.value).toBe("missing"));
    expect(active.project.value).toBeUndefined();
    expect(projects.list).not.toHaveBeenCalled();
  });

  test("服务故障不会当成空空间或悄悄替换最近空间，重试后恢复", async () => {
    stored.set(storageKey, first);
    const projects = service([project(first, "最近论文")]);
    vi.mocked(projects.get).mockRejectedValueOnce(new ApiError("NETWORK_ERROR"));
    const active = open(projects);
    await vi.waitFor(() => expect(active.status.value).toBe("failed"));
    expect(projects.list).not.toHaveBeenCalled();
    expect(stored.get(storageKey)).toBe(first);
    active.reload();
    await vi.waitFor(() => expect(active.project.value?.id).toBe(first));
  });

  test("自动选择尚未返回时打开显式深链，迟到列表不能覆盖新空间", async () => {
    let reply!: (value: Awaited<ReturnType<ProjectService["list"]>>) => void;
    const projects = service([project(second, "链接论文")]);
    projects.list = vi.fn<ProjectService["list"]>(() => new Promise((resolve) => (reply = resolve)));
    const route = ref<string | undefined>();
    const active = open(projects, route);
    route.value = second;
    await vi.waitFor(() => expect(active.project.value?.id).toBe(second));
    reply({ items: [project(first, "迟到论文")], total: 1, offset: 0, limit: 100 });
    await nextTick();
    expect(active.project.value?.id).toBe(second);
    expect(stored.get(storageKey)).toBe(second);
  });
});

describe("正式工作区路由与项目", () => {
  test("根入口与显式项目目录为独立页面", () => {
    expect(resolveWorkspaceRoute({ name: "workspace-root", params: {}, query: {} }, source)).toEqual({ page: "home" });
    expect(resolveWorkspaceRoute({ name: "workspace-projects", params: {}, query: {} }, source)).toEqual({ page: "projects" });
  });

  test("版本链接要求项目、文档和版本合法且来源一致", () => {
    const route = { name: "workspace-version", params: { projectId: first.toUpperCase(), documentId, version: "3" }, query: { source } };
    expect(resolveWorkspaceRoute(route, source)).toEqual({
      page: "writing",
      projectId: first,
      historyLink: { source, projectId: first, documentId, version: "3" },
    });
    for (const version of ["0", "01", "9007199254740992", "3.2"]) {
      expect(resolveWorkspaceRoute({ ...route, params: { ...route.params, version } }, source)).toEqual({ page: "invalid", projectId: first });
    }
    expect(resolveWorkspaceRoute({ ...route, query: { source: [source, source] } }, source).page).toBe("invalid");
    expect(resolveWorkspaceRoute(route, "http:another").page).toBe("invalid");
    expect(resolveWorkspaceRoute({ ...route, params: { ...route.params, projectId: "unknown" } }, source)).toEqual({ page: "invalid" });
  });

  test("项目目录链接：外壳生成的设置与新建参数可被目录识别，无效值忽略", () => {
    const settings = projectSettingsRoute(first.toUpperCase()) as { name: string; query: Record<string, string> };
    expect(settings.name).toBe("workspace-projects");
    expect(projectsLink(settings.query)).toEqual({ kind: "settings", projectId: first });
    expect(projectsLink(projectCreateRoute.query)).toEqual({ kind: "create" });
    for (const key of [...Object.keys(settings.query), ...Object.keys(projectCreateRoute.query)]) expect(projectsLinkKeys).toContain(key);
    expect(projectsLink({ settings: "unknown" })).toBeUndefined();
    expect(projectsLink({ settings: [first, second] })).toBeUndefined();
    expect(projectsLink({ create: "yes" })).toBeUndefined();
    expect(projectsLink({ settings: "unknown", create: "1" })).toEqual({ kind: "create" });
    expect(projectsLink({})).toBeUndefined();
  });

  test("指令面板深链：任务与资料结果带上所选标识，资料页只接受合法资料标识", () => {
    expect(tasksRoute(first, second)).toEqual({ name: "workspace-tasks", params: { projectId: first }, query: { task: second } });
    expect(tasksRoute(first)).toEqual({ name: "workspace-tasks", params: { projectId: first } });
    const material = materialsRoute(first, second.toUpperCase()) as { query: Record<string, string> };
    expect(materialLink(material.query)).toBe(second);
    expect(materialsRoute(first)).toEqual({ name: "workspace-materials", params: { projectId: first } });
    expect(materialLink({ material: "unknown" })).toBeUndefined();
    expect(materialLink({ material: [second] })).toBeUndefined();
    expect(materialLink({})).toBeUndefined();
  });

  test("任务详情链接只接受实际项目、任务标识和同一服务来源", () => {
    const route = { name: "workspace-job", params: { projectId: first, jobId: second.toUpperCase() }, query: { source } };
    expect(resolveWorkspaceRoute(route, source)).toEqual({ page: "jobs", projectId: first, jobId: second });
    expect(resolveWorkspaceRoute({ ...route, query: {} }, source)).toEqual({ page: "invalid", projectId: first });
    expect(resolveWorkspaceRoute({ ...route, params: { ...route.params, jobId: "unknown" } }, source)).toEqual({ page: "invalid", projectId: first });
  });

  test("切换和离开项目时清除旧身份，拒绝迟到或错误身份的响应", async () => {
    const scope = effectScope();
    const id = ref<string | undefined>(first);
    const calls = new Map<string, { signal?: AbortSignal; reply: (project: ProjectRead) => void; fail: (error: Error) => void }>();
    const service: ProjectService = {
      get: (projectId, signal) => new Promise((reply, fail) => calls.set(projectId, { signal, reply, fail })),
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };
    try {
      const active = scope.run(() => useWorkspaceProject(service, "case", id))!;
      expect(active.status.value).toBe("loading");
      id.value = second;
      await nextTick();
      expect(calls.get(first)?.signal?.aborted).toBe(true);
      calls.get(second)?.reply(project(second, "第二论文"));
      await Promise.resolve();
      expect(active.project.value?.name).toBe("第二论文");
      calls.get(first)?.reply(project(first, "第一论文"));
      await Promise.resolve();
      expect(active.project.value?.id).toBe(second);

      id.value = first;
      expect(active.project.value).toBeUndefined();
      await nextTick();
      calls.get(first)?.reply(project(second, "错误身份"));
      await Promise.resolve();
      expect(active.project.value).toBeUndefined();
      expect(active.status.value).toBe("failed");

      active.reload();
      await nextTick();
      calls.get(first)?.fail(new ApiError("PROJECT_NOT_FOUND", { status: 404 }));
      await Promise.resolve();
      expect(active.status.value).toBe("missing");

      active.reload();
      await nextTick();
      scope.stop();
      expect(calls.get(first)?.signal?.aborted).toBe(true);
    } finally {
      scope.stop();
    }
  });

  test("查找实际项目时遍历分页并保留同名项目的独立身份", async () => {
    const list = vi.fn<ProjectService["list"]>(async ({ offset = 0 } = {}) => ({
      items: [project(offset === 0 ? first : second, "同名项目")],
      total: 2,
      offset,
      limit: 100,
    }));
    const service: ProjectService = {
      list,
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };
    const signal = new AbortController().signal;
    const found = await findWorkspaceProjects(service, " 同名 ", signal);
    expect(found.map((row) => row.id)).toEqual([first, second]);
    expect(list).toHaveBeenNthCalledWith(2, { offset: 1, limit: 100 }, signal);
  });
});

test("偏好冲突重读后，保留当前编辑并合并其他会话的未编辑字段", () => {
  const original = {
    id: first,
    version: 1,
    display_name: "原名称",
    notifications_enabled: true,
    quiet_start: "22:00",
    quiet_end: "08:00",
    show_deferred: false,
  };
  const draft = { ...profileDraft(original), display_name: "我的名称" };
  const latest = { ...original, version: 2, display_name: "其他窗口的名称", notifications_enabled: false, quiet_end: "09:30", show_deferred: true };
  expect(mergeProfileDraft(profileDraft(original), draft, latest)).toEqual({
    ...profileDraft(latest),
    display_name: "我的名称",
  });
});

describe("正式外壳工具", () => {
  test("导航按空间高亮，流程与四库同属配置", () => {
    const space = (name: string) => workspaceSpace(resolveWorkspaceRoute({ name, params: { projectId: first }, query: {} }, source).page);
    expect(space("workspace-writing")).toBe("write");
    expect(space("workspace-tasks")).toBe("plan");
    expect(space("workspace-materials")).toBe("library");
    expect(space("workspace-feedback")).toBe("feedback");
    expect(space("workspace-flows")).toBe("settings");
    expect(space("workspace-configurations")).toBe("settings");
    expect(space("workspace-projects")).toBeUndefined();
    expect(space("workspace-account")).toBeUndefined();
  });

  test("阶段航线只按项目绑定的版本与阶段，不推断已完成", () => {
    const stage = (id: string, name: string, enabled = true): FlowStage => ({
      id,
      name,
      conditions: [`${name}条件`],
      deliverables: [],
      deadline: null,
      enabled,
    });
    const version: FlowVersionRead = {
      id: documentId,
      flow_id: second,
      name: "流程",
      version: 2,
      created_at: "2026-11-17T00:00:00Z",
      stages: [stage("a", "开题"), stage("b", "停用", false), stage("c", "撰写"), stage("d", "答辩")],
    };
    const current = shellStageProgress(version, "c");
    expect(current.stages.map((item) => [item.name, item.state])).toEqual([
      ["开题", "upcoming"],
      ["撰写", "current"],
      ["答辩", "upcoming"],
    ]);
    expect(current).toMatchObject({ currentIndex: 1, issue: "" });
    expect(shellStageProgress(version, "b").issue).toBe("当前阶段不在绑定流程中");
    expect(shellStageProgress(version, null).currentIndex).toBe(-1);
    expect(shellStageProgress({ ...version, stages: [stage("x", "停用", false)] }, "x").issue).toBe("绑定流程没有启用的阶段");
  });

  test("按版本标识遍历流程与版本分页定位绑定，并复用不可变结果", async () => {
    const flow = (id: string) => ({ id }) as FlowRead;
    const versionRead = (id: string, flowId: string) => ({ id, flow_id: flowId, version: 1, name: "流程", created_at: "", stages: [] }) as FlowVersionRead;
    const versions = vi.fn<ProjectFlowService["versions"]>(async (flowId, query = {}) =>
      flowId === second
        ? { items: [versionRead(query.offset ? documentId : crypto.randomUUID(), second)], total: 2, offset: query.offset ?? 0, limit: 100 }
        : { items: [], total: 0, offset: 0, limit: 100 },
    );
    const flows = {
      list: vi.fn<ProjectFlowService["list"]>(async ({ offset = 0 } = {}) => ({ items: [flow(offset ? second : first)], total: 2, offset, limit: 100 })),
      versions,
    } as unknown as ProjectFlowService;
    const signal = new AbortController().signal;
    expect((await findFlowVersion(flows, documentId, signal))?.flow_id).toBe(second);
    expect(versions).toHaveBeenCalledTimes(3);
    expect((await findFlowVersion(flows, documentId, signal))?.id).toBe(documentId);
    expect(versions).toHaveBeenCalledTimes(3);
    expect(await findFlowVersion(flows, crypto.randomUUID(), signal)).toBeUndefined();
  });

  test("指令面板只读取当前项目的对象，章节取自正文标题", async () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, chapterId: "c1" },
          content: [
            { type: "text", text: "第 3 章 " },
            { type: "text", text: "系统设计" },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "正文" }] },
        { type: "heading", attrs: { level: 3, chapterId: "c2" } },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "缺少身份" }] },
      ],
    };
    expect(documentHeadings(json)).toEqual([
      { chapterId: "c1", level: 2, title: "第 3 章 系统设计" },
      { chapterId: "c2", level: 3, title: "未命名章节" },
    ]);
    const signal = new AbortController().signal;
    const services = {
      tasks: {
        list: async () => ({ items: [{ id: "t", title: "任务", project_id: second, archived: false }], total: 1, offset: 0, limit: 100, board_version: 1 }),
      },
      documents: { current: async () => Promise.reject(new ApiError("DOCUMENT_NOT_FOUND", { status: 404 })) },
    } as unknown as Parameters<typeof loadSearchSource>[0];
    await expect(loadSearchSource(services, "tasks", first, signal)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(loadSearchSource(services, "chapters", first, signal)).resolves.toEqual([]);
    await expect(loadSearchSource(services, "materials", undefined, signal)).resolves.toEqual([]);
    expect(
      matchRows(
        [
          { id: "1", label: "System 设计" },
          { id: "2", label: "实验" },
        ],
        "system",
      ),
    ).toEqual([{ id: "1", label: "System 设计" }]);
    expect(matchRows([{ id: "1", label: "实验" }], "")).toEqual([]);
  });
});

describe("工作区会话", () => {
  const session = (expiresIn: number): WorkspaceSession => ({
    workspace_id: first,
    expires_at: new Date(Date.now() + expiresIn).toISOString(),
    profile: { id: first, version: 1, display_name: "沐", notifications_enabled: true, quiet_start: "22:00", quiet_end: "08:00", show_deferred: false },
  });

  test("会话到期或失效时暂停而保留外壳，重新解锁后恢复；退出才清除", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scope = effectScope();
    const getSession = vi.fn(async () => session(1_000));
    const openSession = vi.fn(async () => session(60_000));
    const access = {
      getSession,
      openSession,
      closeSession: vi.fn(async () => {}),
      updateProfile: vi.fn(),
    } as unknown as typeof workspaceAccess;
    try {
      const state = scope.run(() => useWorkspaceSession(access))!;
      await state.verify();
      expect(state.gate.value).toBe("active");
      vi.advanceTimersByTime(1_000);
      expect(state.gate.value).toBe("suspended");
      expect(state.session.value?.workspace_id).toBe(first);
      expect(state.message.value).toBe("工作区会话已到期。");

      getSession.mockRejectedValueOnce(new ApiError("WORKSPACE_SESSION_REQUIRED", { status: 401 }));
      await state.verify();
      expect(state.gate.value).toBe("suspended");

      openSession.mockRejectedValueOnce(new ApiError("WORKSPACE_ACCESS_DENIED", { status: 403 }));
      await state.open("wrong");
      expect(state.gate.value).toBe("suspended");
      expect(state.message.value).toBe("访问口令有误，请重新输入。");
      await state.open("right");
      expect(state.gate.value).toBe("active");
      expect(state.message.value).toBe("");

      await state.close();
      expect(state.gate.value).toBe("locked");
      expect(state.session.value).toBeUndefined();
      expect(state.message.value).toBe("已退出工作区。");
    } finally {
      scope.stop();
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  test("首次检查没有会话时直接显示解锁页", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scope = effectScope();
    const access = {
      getSession: vi.fn(async () => Promise.reject(new ApiError("WORKSPACE_SESSION_REQUIRED", { status: 401 }))),
    } as unknown as typeof workspaceAccess;
    try {
      const state = scope.run(() => useWorkspaceSession(access))!;
      await state.verify();
      expect(state.gate.value).toBe("locked");
      expect(state.session.value).toBeUndefined();
    } finally {
      scope.stop();
      warn.mockRestore();
    }
  });
});
