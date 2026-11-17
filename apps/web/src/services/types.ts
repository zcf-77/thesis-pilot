import type {
  DocumentResourceRead,
  DocumentResourceUpload,
  DocumentSchemaUpgradeCreate,
  DocumentSchemaUpgradeRead,
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
/** SG-09 AI 反馈拆解：建议不可变，只有学生逐项决定才建立正式解释项。 */
export interface FeedbackSplitService {
  create(projectId: string, batchId: string, input: Api["FeedbackSplitCreate"], signal?: AbortSignal): Promise<Api["FeedbackSplitReceipt"]>;
  list(projectId: string, batchId: string, query?: PageQuery, signal?: AbortSignal): Promise<Api["FeedbackSplitPage"]>;
  get(projectId: string, splitId: string, signal?: AbortSignal): Promise<Api["FeedbackSplitRead"]>;
  cancel(projectId: string, splitId: string, signal?: AbortSignal): Promise<Api["FeedbackSplitRead"]>;
  retry(projectId: string, splitId: string, input: Api["FeedbackSplitRetry"], signal?: AbortSignal): Promise<Api["FeedbackSplitReceipt"]>;
  decide(projectId: string, splitId: string, input: Api["FeedbackSplitDecide"], signal?: AbortSignal): Promise<Api["FeedbackSplitRead"]>;
}
/** SG-12 独立评审：只读固定版本，报告不可变；不写正文、不建候选。 */
/** SG-10 plan versions, manual batch adjustment and AI adjustment candidates. */
export interface PlanService {
  get(projectId: string, signal?: AbortSignal): Promise<Api["PlanRead"]>;
  versions(projectId: string, query?: PageQuery, signal?: AbortSignal): Promise<Api["PlanVersionPage"]>;
  schedule(projectId: string, input: Api["PlanSchedule"], signal?: AbortSignal): Promise<Api["PlanVersionRead"]>;
  createAdjustment(projectId: string, input: Api["PlanAdjustmentCreate"], signal?: AbortSignal): Promise<Api["PlanAdjustmentReceipt"]>;
  adjustments(projectId: string, query?: PageQuery, signal?: AbortSignal): Promise<Api["PlanAdjustmentPage"]>;
  adjustment(projectId: string, adjustmentId: string, signal?: AbortSignal): Promise<Api["PlanAdjustmentRead"]>;
  cancel(projectId: string, adjustmentId: string, signal?: AbortSignal): Promise<Api["PlanAdjustmentRead"]>;
  decide(projectId: string, adjustmentId: string, input: Api["PlanAdjustmentDecide"], signal?: AbortSignal): Promise<Api["PlanAdjustmentRead"]>;
  revert(projectId: string, adjustmentId: string, input: Api["PlanAdjustmentRevert"], signal?: AbortSignal): Promise<Api["PlanAdjustmentRead"]>;
}
/**
 * SG-22 文献引用候选（AC-019）：从项目文献在 v2 正文光标处生成候选，学生采纳才写入正文；
 * 采纳校验基版本（CAS），撤销追加恢复版本。重复命令标识返回原结果。
 */
export interface CitationService {
  list(projectId: string, documentId: string, version?: number, signal?: AbortSignal): Promise<Api["CitationListRead"]>;
  create(projectId: string, documentId: string, input: Api["CitationCreate"], signal?: AbortSignal): Promise<Api["CitationCandidateRead"]>;
  candidates(
    projectId: string,
    documentId: string,
    query?: PageQuery & { status?: Api["CitationCandidateRead"]["status"] },
    signal?: AbortSignal,
  ): Promise<Api["CitationCandidatePage"]>;
  get(projectId: string, documentId: string, candidateId: string, signal?: AbortSignal): Promise<Api["CitationCandidateRead"]>;
  apply(projectId: string, documentId: string, candidateId: string, input: Api["CitationApply"], signal?: AbortSignal): Promise<Api["CitationCandidateRead"]>;
  reject(projectId: string, documentId: string, candidateId: string, input: Api["CitationReject"], signal?: AbortSignal): Promise<Api["CitationCandidateRead"]>;
  undo(projectId: string, documentId: string, candidateId: string, input: Api["CitationUndo"], signal?: AbortSignal): Promise<Api["CitationCandidateRead"]>;
}
/** Workspace-wide reminder rules edited in the configuration console. */
export interface ReminderSettingsService {
  get(signal?: AbortSignal): Promise<Api["ReminderSettingsRead"]>;
  update(input: Api["ReminderSettingsUpdate"], signal?: AbortSignal): Promise<Api["ReminderSettingsRead"]>;
}
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
/** SG-11 文献检索：后台任务固定检索式；条目只从来源快照保存，移除可恢复。 */
export interface LiteratureEntryQuery extends PageQuery {
  includeRemoved?: boolean;
}
export interface LiteratureService {
  search(projectId: string, input: Api["LiteratureSearchCreate"], signal?: AbortSignal): Promise<Api["LiteratureSearchReceipt"]>;
  searches(projectId: string, query?: PageQuery, signal?: AbortSignal): Promise<Api["LiteratureSearchPage"]>;
  getSearch(projectId: string, searchId: string, signal?: AbortSignal): Promise<Api["LiteratureSearchRead"]>;
  cancelSearch(projectId: string, searchId: string, signal?: AbortSignal): Promise<Api["LiteratureSearchRead"]>;
  retrySearch(projectId: string, searchId: string, input: Api["LiteratureSearchRetry"], signal?: AbortSignal): Promise<Api["LiteratureSearchReceipt"]>;
  save(projectId: string, input: Api["LiteratureEntryCreate"], signal?: AbortSignal): Promise<Api["LiteratureEntryRead"]>;
  entries(projectId: string, query?: LiteratureEntryQuery, signal?: AbortSignal): Promise<Api["LiteratureEntryPage"]>;
  getEntry(projectId: string, entryId: string, signal?: AbortSignal): Promise<Api["LiteratureEntryRead"]>;
  versions(projectId: string, entryId: string, query?: PageQuery, signal?: AbortSignal): Promise<Api["LiteratureEntryVersionPage"]>;
  remove(projectId: string, entryId: string, input: Api["LiteratureEntryCommand"], signal?: AbortSignal): Promise<Api["LiteratureEntryRead"]>;
  restore(projectId: string, entryId: string, input: Api["LiteratureEntryCommand"], signal?: AbortSignal): Promise<Api["LiteratureEntryRead"]>;
  verify(projectId: string, entryId: string, input: Api["LiteratureEntryCommand"], signal?: AbortSignal): Promise<Api["LiteratureEntryRead"]>;
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
export interface StageConfirmationService {
  progress(projectId: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").StageProgressRead>;
  history(projectId: string, query?: PageQuery, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").StageConfirmationPage>;
  confirm(
    projectId: string,
    input: import("./contracts/api.generated.ts").StageConfirm,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").StageCommandRead>;
  revoke(
    projectId: string,
    confirmationId: string,
    input: import("./contracts/api.generated.ts").StageRevoke,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").StageCommandRead>;
}
export interface NotificationQuery extends PageQuery {
  tab?: "active" | "snoozed" | "dismissed";
}
export interface NotificationEventQuery extends PageQuery {
  notificationId?: string;
}
/** SG-10 持久通知：派生只经显式 refresh；读取不改变状态。 */
export interface NotificationService {
  list(projectId: string, query?: NotificationQuery, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").NotificationPage>;
  unreadCount(projectId: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").UnreadCount>;
  refresh(projectId: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").RefreshResult>;
  get(projectId: string, notificationId: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").NotificationRead>;
  transition(
    projectId: string,
    notificationId: string,
    input: import("./contracts/api.generated.ts").NotificationTransition,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").NotificationRead>;
  addProgressNote(
    projectId: string,
    notificationId: string,
    input: import("./contracts/api.generated.ts").ProgressNoteCreate,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").NotificationRead>;
  events(projectId: string, query?: NotificationEventQuery, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").NotificationEventPage>;
}
export interface ExportDownload {
  blob: Blob;
  filename: string;
}
export interface ExportService {
  list(projectId: string, query?: PageQuery, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").ExportPage>;
  get(projectId: string, jobId: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").ExportRead>;
  exportDocument(
    projectId: string,
    input: import("./contracts/api.generated.ts").DocumentExportCreate,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").ExportRead>;
  changeRecord(
    projectId: string,
    input: import("./contracts/api.generated.ts").ChangeRecordCreate,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<import("./contracts/api.generated.ts").ExportRead>;
  cancel(projectId: string, jobId: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").ExportRead>;
  retry(projectId: string, jobId: string, idempotencyKey: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").ExportRead>;
  download(projectId: string, jobId: string, signal?: AbortSignal): Promise<ExportDownload>;
}
/** SG-14：项目备份（按项目）与从备份恢复为新项目（实例级，恢复成功前不属于任何项目）。 */
export interface BackupService {
  list(projectId: string, query?: PageQuery, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").BackupPage>;
  get(projectId: string, jobId: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").BackupRead>;
  create(projectId: string, idempotencyKey: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").BackupRead>;
  cancel(projectId: string, jobId: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").BackupRead>;
  retry(projectId: string, jobId: string, idempotencyKey: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").BackupRead>;
  download(projectId: string, jobId: string, signal?: AbortSignal): Promise<ExportDownload>;
  upload(file: Blob, filename: string, idempotencyKey: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").RestoreRead>;
  restores(query?: PageQuery, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").RestorePage>;
  restore(jobId: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").RestoreRead>;
  cancelRestore(jobId: string, signal?: AbortSignal): Promise<import("./contracts/api.generated.ts").RestoreRead>;
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
  stageConfirmations: StageConfirmationService;
  notifications: NotificationService;
  exports: ExportService;
  reviews: ReviewService;
  literature: LiteratureService;
  feedbackSplits: FeedbackSplitService;
  plans: PlanService;
  reminderSettings: ReminderSettingsService;
  citations: CitationService;
  backups: BackupService;
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
  /** 旧版（v1）历史版本在服务端内存转换为 v2 的只读预览（converted=true）；v2 版本原样返回。 */
  versionAsV2(projectId: string, documentId: string, version: number, signal?: AbortSignal): Promise<DocumentVersionRead>;
  /** 显式升级为 v2：追加新版本；同一 command_id 重放返回原结果（replayed=true）。 */
  upgradeSchema(projectId: string, documentId: string, input: DocumentSchemaUpgradeCreate, signal?: AbortSignal): Promise<DocumentSchemaUpgradeRead>;
  /** 内容寻址图片：同一项目相同字节去重；模型以 uri 引用。 */
  uploadResource(projectId: string, input: DocumentResourceUpload, signal?: AbortSignal): Promise<DocumentResourceRead>;
  resource(projectId: string, sha256: string, signal?: AbortSignal): Promise<Blob>;
}
export interface CreateServicesOptions {
  mode: "mock" | "http";
  instanceId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  onSessionRequired?: () => void;
}
