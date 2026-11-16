import type { RouteLocationNormalizedLoaded, RouteLocationRaw } from "vue-router";
import { isUuid } from "../services/validation.ts";

export const projectsRoute = { name: "workspace-projects" } as const;
export const flowsRoute = { name: "workspace-flows" } as const;
export const configurationsRoute = { name: "workspace-configurations" } as const;
export const accountRoute = { name: "workspace-account" } as const;
export const jobsRoute = { name: "workspace-jobs" } as const;

export function writingRoute(projectId: string): RouteLocationRaw {
  return { name: "workspace-writing", params: { projectId } };
}

export function materialsRoute(projectId: string): RouteLocationRaw {
  return { name: "workspace-materials", params: { projectId } };
}

export function tasksRoute(projectId: string): RouteLocationRaw {
  return { name: "workspace-tasks", params: { projectId } };
}

export function feedbackRoute(projectId: string): RouteLocationRaw {
  return { name: "workspace-feedback", params: { projectId } };
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
    route.name !== "workspace-materials" &&
    route.name !== "workspace-tasks" &&
    route.name !== "workspace-feedback" &&
    route.name !== "workspace-version" &&
    route.name !== "workspace-project-jobs" &&
    route.name !== "workspace-job"
  )
    return { page: "invalid" } as const;
  const { projectId, documentId, version, jobId } = route.params;
  if (!isUuid(projectId)) return { page: "invalid" } as const;
  const id = projectId.toLowerCase();
  if (route.name === "workspace-writing") return { page: "writing", projectId: id } as const;
  if (route.name === "workspace-materials") return { page: "materials", projectId: id } as const;
  if (route.name === "workspace-tasks") return { page: "tasks", projectId: id } as const;
  if (route.name === "workspace-feedback") return { page: "feedback", projectId: id } as const;
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
