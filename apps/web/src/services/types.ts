import type {
  DocumentImport,
  DocumentRead,
  DocumentSave,
  DocumentVersionPage,
  DocumentVersionRead,
  JobCreate,
  JobDetail,
  JobPage,
  JobRead,
  ProjectCreate,
  ProjectPage,
  ProjectRead,
  ProjectUpdate,
  RevisionApply,
  RevisionCancel,
  RevisionCommandRead,
  RevisionCreate,
  RevisionDecide,
  RevisionPage,
  RevisionProposal,
  RevisionRead,
  RevisionRevert,
  RevisionUndo,
} from "./contracts/api.generated.ts";

export interface PageQuery {
  limit?: number;
  offset?: number;
}
export interface JobQuery extends PageQuery {
  project_id: string;
  kind?: JobRead["kind"];
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
  get(id: string, signal?: AbortSignal, projectId?: string): Promise<JobDetail>;
  cancel(id: string, signal?: AbortSignal, projectId?: string): Promise<JobRead>;
  retry(id: string, idempotencyKey: string, signal?: AbortSignal, projectId?: string): Promise<JobRead>;
}
export interface BackendServices {
  sourceKey: string;
  projects: ProjectService;
  jobs: JobService;
  documents: DocumentService;
  revisions: RevisionService;
}

export interface RevisionService {
  create(projectId: string, documentId: string, input: RevisionCreate, signal?: AbortSignal): Promise<RevisionCommandRead>;
  propose(projectId: string, documentId: string, candidateId: string, input: RevisionProposal, signal?: AbortSignal): Promise<RevisionCommandRead>;
  get(projectId: string, documentId: string, candidateId: string, signal?: AbortSignal): Promise<RevisionRead>;
  list(projectId: string, documentId: string, query?: PageQuery, signal?: AbortSignal): Promise<RevisionPage>;
  decide(projectId: string, documentId: string, candidateId: string, input: RevisionDecide, signal?: AbortSignal): Promise<RevisionCommandRead>;
  apply(projectId: string, documentId: string, candidateId: string, input: RevisionApply, signal?: AbortSignal): Promise<RevisionCommandRead>;
  cancel(projectId: string, documentId: string, candidateId: string, input: RevisionCancel, signal?: AbortSignal): Promise<RevisionCommandRead>;
  undo(projectId: string, documentId: string, applicationCommandId: string, input: RevisionUndo, signal?: AbortSignal): Promise<RevisionCommandRead>;
  revert(projectId: string, documentId: string, input: RevisionRevert, signal?: AbortSignal): Promise<RevisionCommandRead>;
  command(projectId: string, documentId: string, commandId: string, signal?: AbortSignal): Promise<RevisionCommandRead>;
}

export interface DocumentService {
  import(projectId: string, input: DocumentImport, signal?: AbortSignal): Promise<DocumentRead>;
  createBlank(projectId: string, signal?: AbortSignal): Promise<DocumentRead>;
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
  onSessionRequired?: () => void;
}
