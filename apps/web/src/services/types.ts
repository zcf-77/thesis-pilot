import type {
  DocumentImport,
  DocumentRead,
  DocumentSave,
  DocumentVersionPage,
  DocumentVersionRead,
  JobCreate,
  JobPage,
  JobRead,
  ProjectCreate,
  ProjectPage,
  ProjectRead,
  ProjectUpdate,
} from "./contracts/api.generated.ts";

export interface PageQuery {
  limit?: number;
  offset?: number;
}
export interface JobQuery extends PageQuery {
  project_id: string;
  status?: JobRead["status"][];
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
  documents: DocumentService;
}

export interface DocumentService {
  import(projectId: string, input: DocumentImport, signal?: AbortSignal): Promise<DocumentRead>;
  current(projectId: string, signal?: AbortSignal): Promise<DocumentRead>;
  save(projectId: string, documentId: string, input: DocumentSave, signal?: AbortSignal): Promise<DocumentRead>;
  versions(projectId: string, documentId: string, query?: PageQuery, signal?: AbortSignal): Promise<DocumentVersionPage>;
  version(projectId: string, documentId: string, version: number, signal?: AbortSignal): Promise<DocumentVersionRead>;
}
export interface CreateServicesOptions {
  mode: "mock" | "http";
  instanceId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}
