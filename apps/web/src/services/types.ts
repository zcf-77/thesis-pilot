import type {
  AssistantSessionCreate,
  AssistantSessionUpdate,
  AssistantSessionRead,
  AssistantSessionPage,
  AssistantMessagePage,
  AssistantRunCreate,
  AssistantRunRead,
  AssistantRunPage,
  AssistantRunReceipt,
  AssistantRunRetryReceipt,
  AssistantRunCommand,
  AssistantRunContext,
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
type Api = import("./contracts/api.generated.ts").ApiTypes;
/** SG-12 独立评审：只读固定版本，报告不可变；不写正文、不建候选。 */
export interface ReviewService {
  rubrics(signal?: AbortSignal): Promise<Api["ReviewRubricList"]>;
  create(projectId: string, input: Api["ReviewCreate"], signal?: AbortSignal): Promise<Api["ReviewReceipt"]>;
  list(projectId: string, query?: PageQuery, signal?: AbortSignal): Promise<Api["ReviewPage"]>;
  get(projectId: string, reviewId: string, signal?: AbortSignal): Promise<Api["ReviewRead"]>;
  cancel(projectId: string, reviewId: string, signal?: AbortSignal): Promise<Api["ReviewRead"]>;
  retry(projectId: string, reviewId: string, input: Api["ReviewRetry"], signal?: AbortSignal): Promise<Api["ReviewReceipt"]>;
  report(projectId: string, reviewId: string, signal?: AbortSignal): Promise<Api["ReviewReportRead"]>;
  download(projectId: string, reviewId: string, format: "html" | "markdown", signal?: AbortSignal): Promise<Blob>;
}
export interface TaskService {
  list(projectId: string, query?: PageQuery, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").TaskPage>;
  create(
    projectId: string,
    input: import("./contracts/api.generated.ts").TaskCreate,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").TaskRead>;
  get(projectId: string, taskId: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").TaskRead>;
  update(
    projectId: string,
    taskId: string,
    input: import("./contracts/api.generated.ts").TaskUpdate,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").TaskRead>;
  reorder(
    projectId: string,
    input: import("./contracts/api.generated.ts").TaskReorder,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").BoardRead>;
  decide(
    projectId: string,
    taskId: string,
    input: import("./contracts/api.generated.ts").TaskDecision,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").TaskRead>;
  versions(projectId: string, taskId: string, query?: PageQuery, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").TaskVersionPage>;
}
export interface FormatRevisionService {
  context(projectId: string, documentId: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").FormatContext>;
  create(
    projectId: string,
    documentId: string,
    input: import("./contracts/api.generated.ts").FormatCreate,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").FormatCommandRead>;
  list(projectId: string, documentId: string, query?: PageQuery, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").FormatPage>;
  get(projectId: string, documentId: string, candidateId: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").FormatRead>;
  decide(
    projectId: string,
    documentId: string,
    candidateId: string,
    input: import("./contracts/api.generated.ts").FormatDecide,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").FormatCommandRead>;
  apply(
    projectId: string,
    documentId: string,
    candidateId: string,
    input: import("./contracts/api.generated.ts").FormatApply,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").FormatCommandRead>;
  undo(
    projectId: string,
    documentId: string,
    applicationCommandId: string,
    input: import("./contracts/api.generated.ts").FormatUndo,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").FormatCommandRead>;
  command(projectId: string, documentId: string, commandId: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").FormatCommandRead>;
}
export interface FeedbackService {
  list(projectId: string, query?: PageQuery, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").FeedbackPage>;
  create(
    projectId: string,
    input: import("./contracts/api.generated.ts").FeedbackCreate,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").FeedbackRead>;
  get(projectId: string, batchId: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").FeedbackRead>;
  items(projectId: string, batchId: string, query?: PageQuery, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").FeedbackItemPage>;
  item(projectId: string, itemId: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").FeedbackItemRead>;
  createItem(
    projectId: string,
    batchId: string,
    input: import("./contracts/api.generated.ts").FeedbackItemCreate,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").FeedbackItemRead>;
  updateItem(
    projectId: string,
    itemId: string,
    input: import("./contracts/api.generated.ts").FeedbackItemUpdate,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").FeedbackItemRead>;
  decide(
    projectId: string,
    itemId: string,
    input: import("./contracts/api.generated.ts").FeedbackDecision,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").FeedbackItemRead>;
  versions(projectId: string, itemId: string, query?: PageQuery, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").FeedbackVersionPage>;
}
export interface AssistantSessionQuery extends PageQuery {
  include_archived?: boolean;
}
export interface AssistantSessionService {
  list(projectId: string, query?: AssistantSessionQuery, signal?: AbortSignal): Promise<AssistantSessionPage>;
  create(projectId: string, input: AssistantSessionCreate, signal?: AbortSignal): Promise<AssistantSessionRead>;
  get(projectId: string, sessionId: string, signal?: AbortSignal): Promise<AssistantSessionRead>;
  update(projectId: string, sessionId: string, input: AssistantSessionUpdate, signal?: AbortSignal): Promise<AssistantSessionRead>;
  messages(projectId: string, sessionId: string, query?: PageQuery, signal?: AbortSignal): Promise<AssistantMessagePage>;
  createRun(projectId: string, sessionId: string, input: AssistantRunCreate, signal?: AbortSignal): Promise<AssistantRunReceipt>;
  runs(projectId: string, sessionId: string, query?: PageQuery, signal?: AbortSignal): Promise<AssistantRunPage>;
  run(projectId: string, runId: string, signal?: AbortSignal): Promise<AssistantRunRead>;
  context(projectId: string, runId: string, signal?: AbortSignal): Promise<AssistantRunContext>;
  cancel(projectId: string, runId: string, input: AssistantRunCommand, signal?: AbortSignal): Promise<AssistantRunRead>;
  retry(projectId: string, runId: string, input: AssistantRunCommand, signal?: AbortSignal): Promise<AssistantRunRetryReceipt>;
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
  assistantSessions: AssistantSessionService;
  revisions: RevisionService;
  tasks: TaskService;
  feedback: FeedbackService;
  formatRevisions: FormatRevisionService;
  reviews: ReviewService;
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
