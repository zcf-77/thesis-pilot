import type { JobCreate, JobPage, JobRead, ProjectCreate, ProjectPage, ProjectRead, ProjectUpdate } from "./contracts/api.generated.ts";

export interface PageQuery {
  limit?: number;
  offset?: number;
}
export interface JobQuery extends PageQuery {
  project_id: string;
}
export interface ProjectService {
  list(query?: PageQuery, signal?: AbortSignal): Promise<ProjectPage>;
  create(input: ProjectCreate, signal?: AbortSignal): Promise<ProjectRead>;
  get(id: string, signal?: AbortSignal): Promise<ProjectRead>;
  update(id: string, input: ProjectUpdate, signal?: AbortSignal): Promise<ProjectRead>;
}
export interface JobService {
  list(query: JobQuery, signal?: AbortSignal): Promise<JobPage>;
  create(input: JobCreate, idempotencyKey: string, signal?: AbortSignal): Promise<JobRead>;
  get(id: string, signal?: AbortSignal): Promise<JobRead>;
  cancel(id: string, signal?: AbortSignal): Promise<JobRead>;
}
export interface BackendServices {
  sourceKey: string;
  projects: ProjectService;
  jobs: JobService;
}
export interface CreateServicesOptions {
  mode: "mock" | "http";
  instanceId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}
