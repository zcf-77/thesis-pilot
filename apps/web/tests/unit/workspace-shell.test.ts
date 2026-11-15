import { describe, expect, test, vi } from "vite-plus/test";
import { effectScope, nextTick, ref } from "vue";
import type { ProjectRead, ProjectService } from "../../src/services/index.ts";
import { ApiError } from "../../src/services/errors.ts";
import { findWorkspaceProjects, useWorkspaceProject } from "../../src/workspace/useWorkspaceProject.ts";
import { mergeProfileDraft, profileDraft } from "../../src/workspace/workspaceProfile.ts";
import { resolveWorkspaceRoute } from "../../src/workspace/workspaceRoutes.ts";

const first = "e5f51398-1895-45f0-96d5-035c589d59de";
const second = "50c591e9-e435-4399-a767-b20c350d9dc4";
const documentId = "70bd328c-0fcf-4b52-8d19-13c6f9ac230e";
const source = "http:workspace";

function project(id: string, name: string): ProjectRead {
  return { id, name, version: 1, created_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:00Z" };
}

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
