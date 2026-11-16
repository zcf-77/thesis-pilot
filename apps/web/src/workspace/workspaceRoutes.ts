import type { RouteLocationNormalizedLoaded, RouteLocationRaw } from "vue-router";
import { isUuid } from "../services/validation.ts";

export const projectsRoute = { name: "workspace-projects" } as const;
export const flowsRoute = { name: "workspace-flows" } as const;
export const configurationsRoute = { name: "workspace-configurations" } as const;
export const accountRoute = { name: "workspace-account" } as const;
export const jobsRoute = { name: "workspace-jobs" } as const;
export const rootRoute = { name: "workspace-root" } as const;

/** Project settings live in the project directory; the query names the project whose settings to open. */
export function projectSettingsRoute(projectId: string): RouteLocationRaw {
  return { name: projectsRoute.name, query: { settings: projectId } };
}

/** Opens the project directory with the setup wizard expanded. */
export const projectCreateRoute = { name: projectsRoute.name, query: { create: "1" } } as const;

export type ProjectsLink = { kind: "create" } | { kind: "settings"; projectId: string };

/** The project directory's one-shot links; a settings link names a project, any other value is ignored. */
export function projectsLink(query: RouteLocationNormalizedLoaded["query"]): ProjectsLink | undefined {
  const { settings, create } = query;
  if (isUuid(settings)) return { kind: "settings", projectId: settings.toLowerCase() };
  if (create === "1") return { kind: "create" };
  return undefined;
}

/** Query keys that projectsLink consumes; the directory removes them once handled so a reload does not reopen the panel. */
export const projectsLinkKeys = ["settings", "create"] as const;

export function writingRoute(projectId: string): RouteLocationRaw {
  return { name: "workspace-writing", params: { projectId } };
}

export function todayRoute(projectId: string): RouteLocationRaw {
  return { name: "workspace-today", params: { projectId } };
}

export function materialsRoute(projectId: string, materialId?: string): RouteLocationRaw {
  return materialId
    ? { name: "workspace-materials", params: { projectId }, query: { material: materialId } }
    : { name: "workspace-materials", params: { projectId } };
}

/** The material a materials link selects, or undefined when the query does not name one. */
export function materialLink(query: RouteLocationNormalizedLoaded["query"]): string | undefined {
  return isUuid(query.material) ? query.material.toLowerCase() : undefined;
}

export function tasksRoute(projectId: string, taskId?: string): RouteLocationRaw {
  return taskId ? { name: "workspace-tasks", params: { projectId }, query: { task: taskId } } : { name: "workspace-tasks", params: { projectId } };
}

export function feedbackRoute(projectId: string): RouteLocationRaw {
  return { name: "workspace-feedback", params: { projectId } };
}

export const inboxTabs = ["active", "snoozed", "dismissed", "history"] as const;
export type InboxTab = (typeof inboxTabs)[number];

export function inboxRoute(projectId: string, tab?: InboxTab): RouteLocationRaw {
  return { name: "workspace-inbox", params: { projectId }, ...(tab && tab !== "active" ? { query: { tab } } : {}) };
}

export function exportRoute(projectId: string): RouteLocationRaw {
  return { name: "workspace-export", params: { projectId } };
}

export function reviewRoute(projectId: string): RouteLocationRaw {
  return { name: "workspace-review", params: { projectId } };
}

/** 评审问题定位：只读深链到写作页对应章节，不携带任何改稿指令。 */
export function reviewLocationRoute(projectId: string, chapterId: string | null, reviewId: string): RouteLocationRaw {
  return { name: "workspace-writing", params: { projectId }, query: { ...(chapterId ? { chapterId } : {}), review: reviewId } };
}

export function projectJobsRoute(projectId?: string): RouteLocationRaw {
  return projectId ? { name: "workspace-project-jobs", params: { projectId } } : jobsRoute;
}

export function jobRoute(projectId: string, jobId: string, source: string): RouteLocationRaw {
  return { name: "workspace-job", params: { projectId, jobId }, query: { source } };
}

export function versionRoute(link: { source: string; projectId: string; documentId: string; version: number }): RouteLocationRaw {
  return {
    name: "workspace-version",
    params: { projectId: link.projectId, documentId: link.documentId, version: String(link.version) },
    query: { source: link.source },
  };
}

export function resolveWorkspaceRoute(route: Pick<RouteLocationNormalizedLoaded, "name" | "params" | "query">, sourceKey: string) {
  if (route.name === configurationsRoute.name) return { page: "configurations" } as const;
  if (route.name === flowsRoute.name) return { page: "flows" } as const;
  if (route.name === "workspace-root") return { page: "home" } as const;
  if (route.name === projectsRoute.name) return { page: "projects" } as const;
  if (route.name === accountRoute.name) return { page: "account" } as const;
  if (route.name === jobsRoute.name) return { page: "jobs" } as const;
  if (
    route.name !== "workspace-writing" &&
    route.name !== "workspace-today" &&
    route.name !== "workspace-materials" &&
    route.name !== "workspace-tasks" &&
    route.name !== "workspace-feedback" &&
    route.name !== "workspace-inbox" &&
    route.name !== "workspace-export" &&
    route.name !== "workspace-review" &&
    route.name !== "workspace-version" &&
    route.name !== "workspace-project-jobs" &&
    route.name !== "workspace-job"
  )
    return { page: "invalid" } as const;
  const { projectId, documentId, version, jobId } = route.params;
  if (!isUuid(projectId)) return { page: "invalid" } as const;
  const id = projectId.toLowerCase();
  if (route.name === "workspace-writing") return { page: "writing", projectId: id } as const;
  if (route.name === "workspace-today") return { page: "today", projectId: id } as const;
  if (route.name === "workspace-materials") return { page: "materials", projectId: id } as const;
  if (route.name === "workspace-tasks") return { page: "tasks", projectId: id } as const;
  if (route.name === "workspace-feedback") return { page: "feedback", projectId: id } as const;
  if (route.name === "workspace-inbox") return { page: "inbox", projectId: id } as const;
  if (route.name === "workspace-export") return { page: "export", projectId: id } as const;
  if (route.name === "workspace-review") return { page: "review", projectId: id } as const;
  if (route.name === "workspace-project-jobs") return { page: "jobs", projectId: id } as const;

  const { source } = route.query;
  if (route.name === "workspace-job")
    return source === sourceKey && isUuid(jobId)
      ? ({ page: "jobs", projectId: id, jobId: jobId.toLowerCase() } as const)
      : ({ page: "invalid", projectId: id } as const);
  if (source !== sourceKey || !isUuid(documentId) || typeof version !== "string" || !/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version))) {
    return { page: "invalid", projectId: id } as const;
  }
  return { page: "writing", projectId: id, historyLink: { source, projectId: id, documentId: documentId.toLowerCase(), version } } as const;
}

export type WorkspaceSpace = "today" | "write" | "plan" | "library" | "feedback" | "review" | "settings";

/** The rail highlights the space a page belongs to; flows and the four libraries are both part of 配置. */
export function workspaceSpace(page: ReturnType<typeof resolveWorkspaceRoute>["page"]): WorkspaceSpace | undefined {
  if (page === "today") return "today";
  if (page === "writing") return "write";
  if (page === "tasks") return "plan";
  if (page === "materials") return "library";
  if (page === "feedback") return "feedback";
  if (page === "review") return "review";
  if (page === "flows" || page === "configurations") return "settings";
  return undefined;
}
