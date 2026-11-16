import type { ApiTypes, SchemaName, JobRead, JobDetail, JobPage, MaterialUploadReceipt } from "./contracts/api.generated.ts";
import { ApiError, throwIfAborted } from "./errors.ts";
import type { BackendServices, CreateServicesOptions } from "./types.ts";
import { DOCUMENT_TRANSPORT_BYTES, documentSchemas, parseDocumentDto, readDocumentResponse, type DocumentSchema } from "./documentContent.ts";
import {
  isInspectionInput,
  isProbeScope,
  isProbeConfiguration,
  isMaterialInput,
  isMaterialConfiguration,
  isContentRevisionInput,
  jobKind,
  jobStatuses,
  pageQuery,
  parseDto,
  parseJobInput,
  parseMaterialEnvelope,
  parseDocumentSourceEnvelope,
  requireIdempotencyKey,
  requireUuid,
} from "./validation.ts";
import { createHttpRevisions } from "./httpRevisions.ts";
import { createHttpProjectFlows, parseProjectInput } from "./httpProjectFlows.ts";
import { createHttpAIConfigs } from "./httpAIConfigs.ts";
import { createHttpMaterials, MATERIAL_UPLOAD_TRANSPORT_BYTES, MATERIAL_PARSE_TRANSPORT_BYTES } from "./httpMaterials.ts";
import { createHttpDocumentSources, DOCUMENT_SOURCE_TRANSPORT_BYTES } from "./httpDocumentSources.ts";
import { createHttpAssistantSessions } from "./httpAssistantSessions.ts";
import { createHttpTasks, createHttpFeedback } from "./httpTasksFeedback.ts";
import { createHttpFormatRevisions } from "./httpFormatRevisions.ts";
import { createHttpStageConfirmations } from "./httpStageConfirmations.ts";
import { parseRevisionDto, revisionResponses, REVISION_TRANSPORT_BYTES, type RevisionSchema } from "./revisionContent.ts";
import { readBoundedResponse } from "./responseBody.ts";

function safeRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : undefined;
}

function identityMatches(actual: string, expected: string): boolean {
  return actual.toLowerCase() === expected.toLowerCase();
}

const jobProjectQuery = (projectId?: string) => (projectId === undefined ? "" : `?project_id=${requireUuid(projectId)}`);

function documentIdentity(
  actual: { project_id: string; id?: string; document_id?: string; version: number },
  projectId: string,
  documentId?: string,
  version?: number,
) {
  if (
    !identityMatches(actual.project_id, projectId) ||
    (documentId !== undefined && !identityMatches(actual.document_id ?? actual.id ?? "", documentId)) ||
    (version !== undefined && actual.version !== version)
  )
    throw new ApiError("INVALID_RESPONSE");
  return actual;
}

function responseError(response: Response, body: unknown): ApiError {
  let code = "HTTP_ERROR";
  let requestId = safeRequestId(response.headers.get("X-Request-ID"));
  try {
    const parsed = parseDto("ErrorResponse", body);
    if (/^[A-Z][A-Z0-9_]{1,79}$/.test(parsed.error.code)) code = parsed.error.code;
    requestId ??= safeRequestId(parsed.error.request_id);
  } catch {
    // The error body is untrusted and may contain private content or an HTML proxy page.
  }
  return new ApiError(code, { status: response.status, requestId });
}

function validateHttpJob(job: JobRead | JobDetail) {
  const invalid = () => {
    throw new ApiError("INVALID_RESPONSE");
  };
  const sameVersions = (a: Record<string, string | undefined>, b: Record<string, string | undefined>) =>
    JSON.stringify(Object.entries(a).sort(([left], [right]) => left.localeCompare(right))) ===
    JSON.stringify(Object.entries(b).sort(([left], [right]) => left.localeCompare(right)));
  if (job.kind === "configuration_probe") {
    const scope = job.resource_scope;
    const configuration = job.configuration;
    if (!isProbeScope(scope) || !isProbeConfiguration(configuration) || !job.input_snapshot || !("config_version_id" in job.input_snapshot)) return invalid();
    if (
      scope.config_version_id !== configuration.config_version_id ||
      job.input_snapshot.config_version_id !== scope.config_version_id ||
      configuration.version_ids[configuration.config_kind] !== scope.config_version_id ||
      !sameVersions(scope.version_ids, configuration.version_ids)
    )
      invalid();
    const expected = { api: ["api"], model: ["api", "model"], prompt: ["prompt"], agent: ["api", "model", "prompt", "agent"] }[configuration.config_kind];
    if (
      Object.keys(configuration.version_ids).length !== expected.length ||
      expected.some((kind) => !configuration.version_ids[kind as keyof typeof configuration.version_ids])
    )
      invalid();
    for (const kind of ["api", "model", "prompt", "agent"] as const)
      if ((configuration[kind] != null) !== (configuration.version_ids[kind] !== undefined)) invalid();
  }
  if (job.kind === "material_parse") {
    if (!isMaterialInput(job.resource_scope) || !isMaterialInput(job.input_snapshot) || !isMaterialConfiguration(job.configuration)) return invalid();
    for (const field of ["material_id", "original_version_id", "original_sha256", "expected_parse_id"] as const)
      if (job.resource_scope[field] !== job.input_snapshot[field]) invalid();
    if (job.status === "succeeded" && job.result?.kind !== "material_parse") invalid();
  }
  if (
    job.kind === "content_revision" &&
    (!isContentRevisionInput(job.input_snapshot) ||
      !isContentRevisionInput(job.resource_scope) ||
      job.input_snapshot.run_id !== job.resource_scope.run_id ||
      job.configuration != null)
  )
    invalid();
  const results = [job.result, ...("artifacts" in job ? job.artifacts.map((artifact) => artifact.result) : [])].filter((result) => result != null);
  for (const result of results) {
    if (
      result.kind === "content_revision" &&
      (!isContentRevisionInput(job.resource_scope) ||
        result.run_id !== job.resource_scope.run_id ||
        !result.model_used ||
        result.writes_performed ||
        !result.requested_model ||
        !result.response_model)
    )
      invalid();
    if (result.kind !== job.kind || result.job_id !== job.id || result.project_id !== job.project_id) invalid();
    if (
      result.kind === "document_inspection" &&
      (!isInspectionInput(job.resource_scope) ||
        result.document_id !== job.resource_scope.document_id ||
        result.document_version !== job.resource_scope.document_version)
    )
      invalid();
    if (result.kind === "configuration_probe") {
      if (!isProbeScope(job.resource_scope) || !isProbeConfiguration(job.configuration)) return invalid();
      const modelUsed = result.config_kind === "model" || result.config_kind === "agent";
      if (
        result.config_kind !== job.configuration.config_kind ||
        result.config_version_id !== job.resource_scope.config_version_id ||
        !sameVersions(result.version_ids, job.resource_scope.version_ids) ||
        result.model_used !== modelUsed ||
        (modelUsed
          ? !result.requested_model || !result.response_model || result.requested_model !== job.configuration.model?.model_code
          : result.requested_model !== null || result.response_model !== null)
      )
        invalid();
    }
    if (result.kind === "material_parse") {
      if (
        !isMaterialInput(job.resource_scope) ||
        !isMaterialConfiguration(job.configuration) ||
        result.material_id !== job.resource_scope.material_id ||
        result.original_version_id !== job.resource_scope.original_version_id ||
        result.original_sha256 !== job.resource_scope.original_sha256 ||
        result.parser_version !== job.configuration.parser_version
      )
        invalid();
    }
  }
  if (
    "artifacts" in job &&
    job.artifacts.some(
      (artifact) => artifact.job_id !== job.id || !job.attempts.some((attempt) => attempt.id === artifact.attempt_id && attempt.status === "succeeded"),
    )
  )
    invalid();
}

export function createHttpRequest(options: Pick<CreateServicesOptions, "baseUrl" | "fetch" | "timeoutMs" | "onSessionRequired"> = {}) {
  const baseUrl = (options.baseUrl ?? "/api/v1").replace(/\/$/, "");
  if (!/^\/(?!\/)[A-Za-z0-9/_-]+$/.test(baseUrl)) throw new ApiError("INVALID_CONFIGURATION");
  const transport = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!transport || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new ApiError("INVALID_CONFIGURATION");

  function request(path: string, schema: null, method: string, body?: unknown, signal?: AbortSignal): Promise<void>;
  function request(path: string, schema: "blob", method: "GET", body?: undefined, signal?: AbortSignal): Promise<Blob>;
  function request<Name extends SchemaName>(
    path: string,
    schema: Name,
    method?: string,
    body?: unknown,
    signal?: AbortSignal,
    extraHeaders?: Record<string, string>,
  ): Promise<ApiTypes[Name]>;
  async function request(
    path: string,
    schema: SchemaName | null | "blob",
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
    extraHeaders: Record<string, string> = {},
  ): Promise<ApiTypes[SchemaName] | Blob | void> {
    throwIfAborted(signal);
    const controller = new AbortController();
    let timedOut = false;
    let abortListener: (() => void) | undefined;
    const cancellation = new Promise<never>((_, reject) => {
      abortListener = () => reject(new ApiError(timedOut ? "REQUEST_TIMEOUT" : "REQUEST_CANCELLED"));
      controller.signal.addEventListener("abort", abortListener, { once: true });
    });
    const forwardAbort = () => controller.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const perform = async (): Promise<ApiTypes[SchemaName] | Blob | void> => {
      const documentResponse = schema !== null && schema !== "blob" && documentSchemas.has(schema);
      const revisionResponse = schema !== null && schema !== "blob" && revisionResponses.has(schema);
      const serialized = body === undefined ? undefined : JSON.stringify(body);
      if (schema === "MaterialUploadReceipt" && serialized !== undefined && new TextEncoder().encode(serialized).byteLength > MATERIAL_UPLOAD_TRANSPORT_BYTES)
        throw new ApiError("MATERIAL_TOO_LARGE", { status: 413 });
      if (documentResponse && serialized !== undefined && new TextEncoder().encode(serialized).byteLength > DOCUMENT_TRANSPORT_BYTES)
        throw new ApiError("DOCUMENT_TOO_LARGE", { status: 413 });
      if (revisionResponse && serialized !== undefined && new TextEncoder().encode(serialized).byteLength > REVISION_TRANSPORT_BYTES)
        throw new ApiError("REVISION_TOO_LARGE", { status: 413 });
      const response = await transport!(baseUrl + path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
        headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extraHeaders },
        ...(serialized === undefined ? {} : { body: serialized }),
      });
      if (schema === "blob" && response.ok) {
        const maximum = 8 * 1024 * 1024;
        const declared = response.headers.get("content-length");
        if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) < 1 || Number(declared) > maximum)) throw new ApiError("INVALID_RESPONSE");
        const reader = response.body?.getReader();
        if (!reader) throw new ApiError("INVALID_RESPONSE");
        const parts: ArrayBuffer[] = [];
        let bytes = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > maximum) {
              await reader.cancel();
              throw new ApiError("INVALID_RESPONSE");
            }
            parts.push(new Uint8Array(chunk.value).buffer);
          }
        } finally {
          reader.releaseLock();
        }
        if (!bytes || (declared !== null && bytes !== Number(declared))) throw new ApiError("INVALID_RESPONSE");
        return new Blob(parts, { type: response.headers.get("content-type") ?? "application/octet-stream" });
      }
      if (schema === null && response.status === 204) return;
      const text = documentResponse
        ? await readDocumentResponse(response)
        : revisionResponse
          ? await readBoundedResponse(response, REVISION_TRANSPORT_BYTES)
          : await readBoundedResponse(
              response,
              schema === "MaterialParseRead" ? MATERIAL_PARSE_TRANSPORT_BYTES : schema === "DocumentSourceRead" ? DOCUMENT_SOURCE_TRANSPORT_BYTES : 1_000_000,
            );
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        if (!response.ok) throw responseError(response, null);
        throw new ApiError("INVALID_RESPONSE", { status: response.status });
      }
      if (!response.ok) {
        const error = responseError(response, parsed);
        if (error.code === "WORKSPACE_SESSION_REQUIRED" && !controller.signal.aborted) options.onSessionRequired?.();
        throw error;
      }
      if (schema === null || schema === "blob") throw new ApiError("INVALID_RESPONSE", { status: response.status });
      if (documentResponse) return parseDocumentDto(schema as DocumentSchema, parsed);
      if (revisionResponse) return parseRevisionDto(schema as RevisionSchema, parsed);
      if (schema === "MaterialParseRead") return parseMaterialEnvelope(parsed);
      if (schema === "DocumentSourceRead") return parseDocumentSourceEnvelope(parsed);
      const dto = parseDto(schema, parsed);
      if (schema === "JobRead" || schema === "JobDetail") validateHttpJob(dto as JobRead | JobDetail);
      if (schema === "JobPage") (dto as JobPage).items.forEach(validateHttpJob);
      if (schema === "MaterialUploadReceipt") validateHttpJob((dto as MaterialUploadReceipt).job);
      if (schema === "AssistantRunReceipt" || schema === "AssistantRunRetryReceipt") validateHttpJob((dto as { job: JobRead }).job);
      return dto;
    };
    try {
      return await Promise.race([perform(), cancellation]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) throw new ApiError(timedOut ? "REQUEST_TIMEOUT" : "REQUEST_CANCELLED");
      throw new ApiError("NETWORK_ERROR");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
      if (abortListener) controller.signal.removeEventListener("abort", abortListener);
    }
  }

  return request;
}

export function createHttpServices(options: CreateServicesOptions, sourceKey: string): BackendServices {
  const request = createHttpRequest(options);
  return {
    sourceKey,
    projectFlows: createHttpProjectFlows(request),
    aiConfigs: createHttpAIConfigs(request),
    materials: createHttpMaterials(request, request),
    documentSources: createHttpDocumentSources(request),
    assistantSessions: createHttpAssistantSessions(request),
    tasks: createHttpTasks(request),
    feedback: createHttpFeedback(request),
    formatRevisions: createHttpFormatRevisions(request),
    stageConfirmations: createHttpStageConfirmations(request),
    revisions: createHttpRevisions(request),
    documents: {
      async import(projectId, input, signal) {
        const data = parseDocumentDto("DocumentImport", input, true);
        const result = await request(`/projects/${requireUuid(projectId)}/documents`, "DocumentRead", "POST", data, signal);
        documentIdentity(result, projectId, undefined, 1);
        return result;
      },
      async createBlank(projectId, signal) {
        const result = await request(`/projects/${requireUuid(projectId)}/documents/blank`, "DocumentRead", "POST", undefined, signal);
        documentIdentity(result, projectId, undefined, 1);
        return result;
      },
      async current(projectId, signal) {
        const result = await request(`/projects/${requireUuid(projectId)}/documents/current`, "DocumentRead", "GET", undefined, signal);
        documentIdentity(result, projectId);
        return result;
      },
      async save(projectId, documentId, input, signal) {
        const data = parseDocumentDto("DocumentSave", input, true);
        const result = await request(`/projects/${requireUuid(projectId)}/documents/${requireUuid(documentId)}`, "DocumentRead", "PATCH", data, signal);
        documentIdentity(result, projectId, documentId, data.expected_version + 1);
        return result;
      },
      async versions(projectId, documentId, query, signal) {
        const { limit, offset } = pageQuery(query);
        const result = await request(
          `/projects/${requireUuid(projectId)}/documents/${requireUuid(documentId)}/versions?limit=${limit}&offset=${offset}`,
          "DocumentVersionPage",
          "GET",
          undefined,
          signal,
        );
        result.items.forEach((item) => documentIdentity(item, projectId, documentId));
        return result;
      },
      async version(projectId, documentId, version, signal) {
        if (!Number.isSafeInteger(version) || version < 1) throw new ApiError("VALIDATION_ERROR", { status: 422 });
        const result = await request(
          `/projects/${requireUuid(projectId)}/documents/${requireUuid(documentId)}/versions/${version}`,
          "DocumentVersionRead",
          "GET",
          undefined,
          signal,
        );
        documentIdentity(result, projectId, documentId, version);
        return result;
      },
    },
    projects: {
      async list(query, signal) {
        const { limit, offset } = pageQuery(query);
        return request(`/projects?limit=${limit}&offset=${offset}`, "ProjectPage", "GET", undefined, signal);
      },
      async create(input, signal) {
        const data = parseProjectInput("ProjectCreate", input);
        return request("/projects", "ProjectRead", "POST", data, signal);
      },
      async get(id, signal) {
        const result = await request(`/projects/${requireUuid(id)}`, "ProjectRead", "GET", undefined, signal);
        if (!identityMatches(result.id, id)) throw new ApiError("INVALID_RESPONSE");
        return result;
      },
      async update(id, input, signal) {
        const data = parseProjectInput("ProjectUpdate", input);
        const result = await request(`/projects/${requireUuid(id)}`, "ProjectRead", "PATCH", data, signal);
        if (!identityMatches(result.id, id) || result.version !== data.expected_version + 1) throw new ApiError("INVALID_RESPONSE");
        return result;
      },
    },
    jobs: {
      async list(query, signal) {
        const { limit, offset } = pageQuery(query);
        const statuses = jobStatuses(query.status);
        const statusQuery = statuses.map((status) => `&status=${status}`).join("");
        const kind = jobKind(query.kind);
        const page = await request(
          `/jobs?project_id=${requireUuid(query.project_id)}&limit=${limit}&offset=${offset}${statusQuery}${kind ? `&kind=${kind}` : ""}`,
          "JobPage",
          "GET",
          undefined,
          signal,
        );
        if (
          page.limit !== limit ||
          page.offset !== offset ||
          page.items.length > limit ||
          page.items.some(
            (job) => !identityMatches(job.project_id, query.project_id) || (kind && job.kind !== kind) || (statuses.length && !statuses.includes(job.status)),
          )
        )
          throw new ApiError("INVALID_RESPONSE");
        return page;
      },
      async create(input, idempotencyKey, signal) {
        const data = parseJobInput(input);
        return request("/jobs", "JobRead", "POST", data, signal, { "Idempotency-Key": requireIdempotencyKey(idempotencyKey) });
      },
      async get(id, signal, projectId) {
        return request(`/jobs/${requireUuid(id)}${jobProjectQuery(projectId)}`, "JobDetail", "GET", undefined, signal);
      },
      async cancel(id, signal, projectId) {
        return request(`/jobs/${requireUuid(id)}/cancel${jobProjectQuery(projectId)}`, "JobRead", "POST", undefined, signal);
      },
      async retry(id, idempotencyKey, signal, projectId) {
        return request(`/jobs/${requireUuid(id)}/retry${jobProjectQuery(projectId)}`, "JobRead", "POST", undefined, signal, {
          "Idempotency-Key": requireIdempotencyKey(idempotencyKey),
        });
      },
    },
  };
}
