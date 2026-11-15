import type {
  DocumentSourcePreviewRequest,
  DocumentSourcePreview,
  DocumentSourceImport,
  DocumentSourceImportReceipt,
  DocumentSourceRead,
  MaterialUpload,
  MaterialUploadReceipt,
  MaterialRead,
  MaterialUpdate,
  MaterialPage,
  MaterialOriginalCreate,
  MaterialOriginalPage,
  MaterialParseSummaryPage,
  MaterialOriginalRead,
  MaterialParseRead,
  MaterialReparse,
  ProjectSourceBindingRead,
  ProjectSourceBindingUpdate,
  ProjectSourceBindingVersionRead,
  ProjectSourceBindingVersionPage,
  AIConfigCreate,
  AIConfigUpdate,
  AIConfigRead,
  AIConfigPage,
  AIConfigVersionRead,
  AIConfigVersionPage,
  AIConfigCopy,
  AIConfigReferences,
  AIConfigAvailability,
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
  FlowCreate,
  FlowRead,
  FlowUpdate,
  FlowPage,
  FlowVersionRead,
  FlowVersionPage,
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
export interface MaterialQuery extends PageQuery {
  kind?: MaterialRead["kind"];
  include_removed?: boolean;
}
export interface MaterialService {
  list(projectId: string, query?: MaterialQuery, signal?: AbortSignal): Promise<MaterialPage>;
  upload(projectId: string, input: MaterialUpload, idempotencyKey: string, signal?: AbortSignal): Promise<MaterialUploadReceipt>;
  get(projectId: string, materialId: string, signal?: AbortSignal): Promise<MaterialRead>;
  update(projectId: string, materialId: string, input: MaterialUpdate, signal?: AbortSignal): Promise<MaterialRead>;
  appendOriginal(
    projectId: string,
    materialId: string,
    input: MaterialOriginalCreate,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<MaterialUploadReceipt>;
  originals(projectId: string, materialId: string, query?: PageQuery, signal?: AbortSignal): Promise<MaterialOriginalPage>;
  original(projectId: string, materialId: string, originalId: string, signal?: AbortSignal): Promise<MaterialOriginalRead>;
  download(projectId: string, materialId: string, originalId: string, signal?: AbortSignal): Promise<Blob>;
  parses(projectId: string, materialId: string, originalId: string, query?: PageQuery, signal?: AbortSignal): Promise<MaterialParseSummaryPage>;
  parse(projectId: string, materialId: string, originalId: string, parseId: string, signal?: AbortSignal): Promise<MaterialParseRead>;
  reparse(projectId: string, materialId: string, originalId: string, input: MaterialReparse, idempotencyKey: string, signal?: AbortSignal): Promise<JobRead>;
  sourceBinding(projectId: string, signal?: AbortSignal): Promise<ProjectSourceBindingRead>;
  updateSourceBinding(projectId: string, input: ProjectSourceBindingUpdate, signal?: AbortSignal): Promise<ProjectSourceBindingRead>;
  sourceBindingVersions(projectId: string, query?: PageQuery, signal?: AbortSignal): Promise<ProjectSourceBindingVersionPage>;
  sourceBindingVersion(projectId: string, version: number, signal?: AbortSignal): Promise<ProjectSourceBindingVersionRead>;
}
export interface AIConfigQuery extends PageQuery {
  kind?: AIConfigRead["kind"];
}
export interface AIConfigService {
  availability(signal?: AbortSignal): Promise<AIConfigAvailability>;
  list(query?: AIConfigQuery, signal?: AbortSignal): Promise<AIConfigPage>;
  create(input: AIConfigCreate, signal?: AbortSignal): Promise<AIConfigRead>;
  get(id: string, signal?: AbortSignal): Promise<AIConfigRead>;
  update(id: string, input: AIConfigUpdate, signal?: AbortSignal): Promise<AIConfigRead>;
  copy(id: string, input: AIConfigCopy, signal?: AbortSignal): Promise<AIConfigRead>;
  versions(id: string, query?: PageQuery, signal?: AbortSignal): Promise<AIConfigVersionPage>;
  version(id: string, version: number, signal?: AbortSignal): Promise<AIConfigVersionRead>;
  references(id: string, signal?: AbortSignal): Promise<AIConfigReferences>;
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
export interface ProjectFlowService {
  list(query?: PageQuery, signal?: AbortSignal): Promise<FlowPage>;
  create(input: FlowCreate, signal?: AbortSignal): Promise<FlowRead>;
  get(id: string, signal?: AbortSignal): Promise<FlowRead>;
  update(id: string, input: FlowUpdate, signal?: AbortSignal): Promise<FlowRead>;
  versions(id: string, query?: PageQuery, signal?: AbortSignal): Promise<FlowVersionPage>;
  version(id: string, version: number, signal?: AbortSignal): Promise<FlowVersionRead>;
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
  projectFlows: ProjectFlowService;
  aiConfigs: AIConfigService;
  materials: MaterialService;
  jobs: JobService;
  documents: DocumentService;
  documentSources: DocumentSourceService;
  revisions: RevisionService;
}
export interface DocumentSourceService {
  preview(projectId: string, input: DocumentSourcePreviewRequest, signal?: AbortSignal): Promise<DocumentSourcePreview>;
  import(projectId: string, input: DocumentSourceImport, signal?: AbortSignal): Promise<DocumentSourceImportReceipt>;
  current(projectId: string, documentId: string, expectedDocumentVersion: number, signal?: AbortSignal): Promise<DocumentSourceRead>;
  version(projectId: string, documentId: string, version: number, signal?: AbortSignal): Promise<DocumentSourceRead>;
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
