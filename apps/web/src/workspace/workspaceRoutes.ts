import type { RouteLocationNormalizedLoaded, RouteLocationRaw } from "vue-router";
import { isUuid } from "../services/validation.ts";

export const projectsRoute = { name: "workspace-projects" } as const;
export const accountRoute = { name: "workspace-account" } as const;

export function writingRoute(projectId: string): RouteLocationRaw {
  return { name: "workspace-writing", params: { projectId } };
}

export function versionRoute(link: { source: string; projectId: string; documentId: string; version: number }): RouteLocationRaw {
  return {
    name: "workspace-version",
    params: { projectId: link.projectId, documentId: link.documentId, version: String(link.version) },
    query: { source: link.source },
  };
}

export function resolveWorkspaceRoute(route: Pick<RouteLocationNormalizedLoaded, "name" | "params" | "query">, sourceKey: string) {
  if (route.name === "workspace-root") return { page: "home" } as const;
  if (route.name === projectsRoute.name) return { page: "projects" } as const;
  if (route.name === accountRoute.name) return { page: "account" } as const;
  if (route.name !== "workspace-writing" && route.name !== "workspace-version") return { page: "invalid" } as const;
  const { projectId, documentId, version } = route.params;
  if (!isUuid(projectId)) return { page: "invalid" } as const;
  const id = projectId.toLowerCase();
  if (route.name === "workspace-writing") return { page: "writing", projectId: id } as const;

  const { source } = route.query;
  if (source !== sourceKey || !isUuid(documentId) || typeof version !== "string" || !/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version))) {
    return { page: "invalid", projectId: id } as const;
  }
  return { page: "writing", projectId: id, historyLink: { source, projectId: id, documentId: documentId.toLowerCase(), version } } as const;
}
