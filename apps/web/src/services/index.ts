import { ApiError } from "./errors.ts";
import { createHttpServices } from "./http.ts";
import { createMockServices } from "./mock.ts";
import type { BackendServices, CreateServicesOptions } from "./types.ts";

export function createServices(options: CreateServicesOptions): BackendServices {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.instanceId)) throw new ApiError("INVALID_CONFIGURATION");
  const sourceKey = `${options.mode}:${options.instanceId}`;
  if (options.mode === "http") return createHttpServices(options, sourceKey);
  if (options.mode === "mock") return createMockServices(sourceKey);
  throw new ApiError("INVALID_CONFIGURATION");
}

export { ApiError, asApiError } from "./errors.ts";
export { toProjectView, toJobView } from "./mappers.ts";
export type {
  BackendServices,
  CreateServicesOptions,
  ProjectService,
  ProjectFlowService,
  AIConfigService,
  MaterialService,
  MaterialQuery,
  JobService,
  DocumentService,
  RevisionService,
  PageQuery,
  JobQuery,
} from "./types.ts";
export type {
  MaterialRead,
  MaterialUpload,
  MaterialOriginalRead,
  MaterialParseRead,
  MaterialUploadReceipt,
  ProjectSourceBindingRead,
  AIConfigRead,
  AIConfigCreate,
  AIConfigUpdate,
  AIConfigPage,
  AIConfigVersionRead,
  AIConfigVersionPage,
  AIConfigReferences,
  AIConfigAvailability,
  ProjectRead,
  ProjectCreate,
  ProjectUpdate,
  ProjectPage,
  JobRead,
  JobDetail,
  JobCreate,
  JobPage,
  DocumentRead,
  DocumentImport,
  DocumentSave,
  DocumentVersionRead,
  DocumentVersionPage,
  RevisionCreate,
  RevisionProposal,
  RevisionDecide,
  RevisionApply,
  RevisionCancel,
  RevisionUndo,
  RevisionRevert,
  RevisionRead,
  RevisionSummary,
  RevisionPage,
  RevisionCommandRead,
  RevisionSelection,
  RevisionPatch,
  RevisionDecision,
  RevisionCheck,
} from "./contracts/api.generated.ts";
