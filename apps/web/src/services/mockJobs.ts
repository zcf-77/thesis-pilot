import type {
  AIConfigJobReference,
  ChangeRecordInput,
  ChangeRecordResult,
  DocumentExportInput,
  DocumentExportResult,
  ExportConfiguration,
  ConfigurationProbeConfiguration,
  ConfigurationProbeResult,
  DocumentVersionRead,
  InspectionResult,
  JobCreate,
  JobDetail,
  JobRead,
  MaterialParseInput,
  MaterialParseResult,
  MaterialOriginalRead,
} from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { MockDocuments } from "./mockDocuments.ts";
import type { JobService } from "./types.ts";
import {
  isInspectionInput,
  isInspectionConfiguration,
  isProbeConfiguration,
  isProbeScope,
  isMaterialInput,
  isMaterialConfiguration,
  jobKind,
  jobStatuses,
  pageQuery,
  parseDto,
  parseJobInput,
  probeVariables,
  requireIdempotencyKey,
  requireUuid,
} from "./validation.ts";

export type FixedJobKind = "document_export" | "change_record";
export type FixedJobCompleter = (job: JobDetail, attemptId: string) => DocumentExportResult | ChangeRecordResult;
export interface FixedJobInput {
  projectId: string;
  kind: FixedJobKind;
  snapshot: DocumentExportInput | ChangeRecordInput;
  configuration: ExportConfiguration;
  sourceJobId?: string;
}

const stamp = () => new Date().toISOString();
const summary = ({ attempts: _attempts, artifacts: _artifacts, ...job }: JobDetail): JobRead => job;
const read = (job: JobDetail) => structuredClone(parseDto("JobRead", summary(job)));

function inspectionResult(job: JobDetail, document: DocumentVersionRead): InspectionResult {
  const counts = { node_count: 0, paragraph_count: 0, heading_count: 0, table_count: 0 };
  let characters = 0;
  const nodes: unknown[] = [document.content.json];
  while (nodes.length) {
    const value = nodes.pop();
    if (!value || typeof value !== "object") continue;
    const node = value as { type?: string; text?: string; content?: unknown[] };
    counts.node_count++;
    if (node.type === "paragraph") counts.paragraph_count++;
    if (node.type === "heading") counts.heading_count++;
    if (node.type === "table") counts.table_count++;
    if (node.type === "text" && typeof node.text === "string") {
      for (const _character of node.text) characters++;
    }
    if (Array.isArray(node.content)) for (const child of node.content) nodes.push(child);
  }
  return {
    ...counts,
    kind: "document_inspection",
    schema_version: 1,
    job_id: job.id,
    project_id: job.project_id,
    document_id: document.document_id,
    document_version: document.version,
    text_characters: isInspectionConfiguration(job.configuration) && job.configuration.include_text_statistics ? characters : null,
    model_used: false,
    writes_performed: false,
  };
}

export function createMockJobs(
  before: (signal?: AbortSignal) => Promise<void>,
  requireProject: (id: string) => unknown,
  documents: MockDocuments,
  freeze: (versionId: string, variables: Record<string, string>) => ConfigurationProbeConfiguration,
  parseMaterial: (projectId: string, input: MaterialParseInput, jobId: string) => MaterialParseResult,
): JobService & {
  configurationReferences(ids: string[]): AIConfigJobReference[];
  enqueueMaterial(projectId: string, input: MaterialParseInput, fileType: MaterialOriginalRead["file_type"]): JobRead;
  enqueueAssistant(projectId: string, runId: string, sourceJobId?: string): JobRead;
  enqueueFixed(input: FixedJobInput, key: string): JobRead;
  registerFixed(kind: FixedJobKind, complete: FixedJobCompleter): void;
  enqueueReview(projectId: string, reviewId: string, sourceJobId?: string): JobRead;
  enqueueLiterature(projectId: string, searchId: string, sourceJobId?: string): JobRead;
  enqueueFeedbackSplit(projectId: string, splitId: string, sourceJobId?: string): JobRead;
  enqueuePlan(projectId: string, adjustmentId: string): JobRead;
} {
  const jobs = new Map<string, JobDetail>();
  const idempotency = new Map<string, { fingerprint: string; jobId: string }>();
  // Kinds whose fixed input is frozen by their own entry (exports); never created via jobs.create.
  const fixed = new Map<FixedJobKind, FixedJobCompleter>();

  function enqueueFixed(input: FixedJobInput, key: string): JobRead {
    requireIdempotencyKey(key);
    const fingerprint = JSON.stringify([input.projectId, input.kind, input.snapshot, input.sourceJobId ?? null]);
    const existing = idempotency.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new ApiError("JOB_IDEMPOTENCY_CONFLICT", { status: 409 });
      return read(getJob(existing.jobId));
    }
    requireProject(input.projectId);
    const timestamp = stamp();
    const job = parseDto("JobDetail", {
      id: crypto.randomUUID(),
      project_id: input.projectId.toLowerCase(),
      kind: input.kind,
      input_snapshot: structuredClone(input.snapshot),
      resource_scope: structuredClone(input.snapshot),
      configuration: structuredClone(input.configuration),
      source_job_id: input.sourceJobId ?? null,
      status: "queued",
      attempt: 0,
      result: null,
      error_code: null,
      created_at: timestamp,
      updated_at: timestamp,
      attempts: [],
      artifacts: [],
    });
    jobs.set(job.id, job);
    idempotency.set(key, { fingerprint, jobId: job.id });
    return read(job);
  }

  function progress(job: JobDetail) {
    if (job.status !== "queued" && job.status !== "running") return;
    const elapsed = Date.now() - Date.parse(job.created_at);
    if (elapsed < 500) return;
    if (job.status === "queued") {
      job.status = "running";
      job.attempt = 1;
      job.updated_at = stamp();
      job.attempts.push({ id: crypto.randomUUID(), attempt: 1, status: "running", error_code: null, started_at: job.updated_at, finished_at: null });
    }
    if (elapsed < 2_000) return;
    const attempt = job.attempts[0]!;
    job.status = attempt.status = "succeeded";
    job.updated_at = attempt.finished_at = stamp();
    if (job.kind === "diagnostic") {
      job.result = {
        kind: "diagnostic",
        job_id: job.id,
        project_id: job.project_id,
        checked: true,
        model_used: false,
        writes_performed: false,
        message: "本地模拟服务诊断完成；未调用模型，未修改论文或计划。",
      };
    } else if (job.kind === "content_revision" || job.kind === "review" || job.kind === "feedback_decomposition" || job.kind === "plan_adjustment") {
      // The Mock queue never invents a model response, revision, review report, split or plan candidate.
      job.status = attempt.status = "failed";
      job.error_code = attempt.error_code = "MODEL_NOT_CONFIGURED";
    } else if (job.kind === "literature_search") {
      // The Mock queue has no network access and never invents bibliographic records.
      job.status = attempt.status = "failed";
      job.error_code = attempt.error_code = "LITERATURE_SOURCE_UNAVAILABLE";
    } else if (job.kind === "document_inspection" && isInspectionInput(job.resource_scope)) {
      const scope = job.resource_scope;
      const result = inspectionResult(job, documents.revisionVersion(job.project_id, scope.document_id, scope.document_version));
      job.result = result;
      job.artifacts.push({
        id: crypto.randomUUID(),
        job_id: job.id,
        attempt_id: attempt.id,
        kind: result.kind,
        schema_version: result.schema_version,
        created_at: job.updated_at,
        result,
      });
    } else if (job.kind === "material_parse" && isMaterialInput(job.resource_scope) && isMaterialConfiguration(job.configuration)) {
      try {
        const result = parseMaterial(job.project_id, job.resource_scope, job.id);
        job.result = result;
        job.artifacts.push({
          id: crypto.randomUUID(),
          job_id: job.id,
          attempt_id: attempt.id,
          kind: result.kind,
          schema_version: 1,
          created_at: job.updated_at,
          result,
        });
      } catch (cause) {
        job.status = attempt.status = "failed";
        job.error_code = attempt.error_code = cause instanceof ApiError ? cause.code : "MATERIAL_PARSE_INVALID";
      }
    } else if (job.kind === "configuration_probe" && isProbeConfiguration(job.configuration) && isProbeScope(job.resource_scope)) {
      const configuration = job.configuration;
      const variables = probeVariables(job.input_snapshot && "variables" in job.input_snapshot ? (job.input_snapshot.variables ?? {}) : {});
      const rendered =
        configuration.prompt?.template.replace(/{{\s*([A-Za-z_][A-Za-z0-9_]*)\s*}}/g, (_match, name: string) => variables[name] ?? "") ??
        "配置链结构检查完成。";
      const outputSchema = { ...configuration.prompt?.output_schema, ...configuration.agent?.output_schema };
      let output = `本地模拟试跑；未调用真实模型。\n${rendered}`;
      if (Object.keys(outputSchema).length) {
        let structured: unknown;
        if (configuration.config_kind === "prompt") {
          try {
            structured = JSON.parse(rendered);
          } catch {
            structured = null;
          }
          const matches = (value: unknown, type: unknown) =>
            type === "number"
              ? typeof value === "number" && Number.isFinite(value)
              : type === "array"
                ? Array.isArray(value)
                : type === "object"
                  ? !!value && typeof value === "object" && !Array.isArray(value)
                  : type === "boolean"
                    ? typeof value === "boolean"
                    : type === "string" && typeof value === "string";
          if (
            !structured ||
            typeof structured !== "object" ||
            Array.isArray(structured) ||
            Object.entries(outputSchema).some(([key, type]) => !matches((structured as Record<string, unknown>)[key], type))
          ) {
            job.status = attempt.status = "failed";
            job.error_code = attempt.error_code = "AI_CONFIG_SCHEMA_INVALID";
            return;
          }
        } else
          structured = Object.fromEntries(
            Object.entries(outputSchema).map(([key, type]) => [
              key,
              type === "number" ? 0 : type === "boolean" ? false : type === "array" ? [] : type === "object" ? {} : "合成模拟值",
            ]),
          );
        output = JSON.stringify({ 模拟说明: "本地模拟试跑；未调用真实模型。", ...(structured as Record<string, unknown>) });
      }
      if (Array.from(output).length > 50_000) {
        job.status = attempt.status = "failed";
        job.error_code = attempt.error_code = "MODEL_OUTPUT_TOO_LARGE";
        return;
      }
      const result: ConfigurationProbeResult = {
        kind: "configuration_probe",
        schema_version: 1,
        job_id: job.id,
        project_id: job.project_id,
        config_version_id: configuration.config_version_id,
        config_kind: configuration.config_kind,
        version_ids: configuration.version_ids,
        model_used: false,
        requested_model: null,
        response_model: null,
        content: output,
        writes_performed: false,
      };
      job.result = result;
      job.artifacts.push({
        id: crypto.randomUUID(),
        job_id: job.id,
        attempt_id: attempt.id,
        kind: result.kind,
        schema_version: 1,
        created_at: job.updated_at,
        result,
      });
    } else if (fixed.has(job.kind as FixedJobKind)) {
      try {
        const result = fixed.get(job.kind as FixedJobKind)!(job, attempt.id);
        job.result = result;
        job.artifacts.push({
          id: crypto.randomUUID(),
          job_id: job.id,
          attempt_id: attempt.id,
          kind: result.kind,
          schema_version: 1,
          created_at: job.updated_at,
          result,
        });
      } catch (cause) {
        job.status = attempt.status = "failed";
        job.error_code = attempt.error_code = cause instanceof ApiError ? cause.code : "JOB_EXECUTION_FAILED";
      }
    } else {
      job.status = attempt.status = "failed";
      job.error_code = attempt.error_code = "JOB_RESULT_INVALID";
    }
  }

  function getJob(id: string, projectId?: string) {
    const job = jobs.get(requireUuid(id));
    if (projectId !== undefined) requireUuid(projectId);
    if (!job || (projectId !== undefined && job.project_id !== projectId)) throw new ApiError("JOB_NOT_FOUND", { status: 404 });
    progress(job);
    return job;
  }

  function submit(input: JobCreate, key: string, source?: JobDetail) {
    requireIdempotencyKey(key);
    const kind = input.kind ?? "diagnostic";
    const inputSnapshot = input.input_snapshot ? structuredClone(input.input_snapshot) : null;
    if (inputSnapshot && "config_version_id" in inputSnapshot) {
      inputSnapshot.schema_version = 1;
      inputSnapshot.variables ??= {};
    }
    const inspection = input.configuration;
    const configuration = source
      ? structuredClone(source.configuration)
      : kind === "document_inspection"
        ? { schema_version: 1 as const, include_text_statistics: inspection?.include_text_statistics ?? true }
        : null;
    const sourceId = source?.id ?? null;
    const fingerprint = JSON.stringify([input.project_id, kind, inputSnapshot, configuration, sourceId]);
    const existing = idempotency.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new ApiError("JOB_IDEMPOTENCY_CONFLICT", { status: 409 });
      return read(getJob(existing.jobId));
    }
    if (source && (source.status === "queued" || source.status === "running")) throw new ApiError("JOB_STATE_CONFLICT", { status: 409 });
    if (source && isProbeConfiguration(source.configuration) && source.configuration.api) {
      let root = source;
      while (root.source_job_id) root = jobs.get(root.source_job_id)!;
      let retries = 0;
      let pending = [root.id];
      while (pending.length) {
        const children = [...jobs.values()].filter((job) => job.source_job_id && pending.includes(job.source_job_id));
        retries += children.length;
        pending = children.map((job) => job.id);
      }
      if (retries >= (source.configuration.api.max_retries ?? 2)) throw new ApiError("MODEL_RETRY_LIMIT_REACHED", { status: 409 });
    }
    requireProject(input.project_id);
    if (isInspectionInput(inputSnapshot)) documents.revisionVersion(input.project_id, inputSnapshot.document_id, inputSnapshot.document_version);
    const frozen = source
      ? configuration
      : kind === "configuration_probe" && inputSnapshot && "config_version_id" in inputSnapshot
        ? freeze(inputSnapshot.config_version_id, probeVariables(inputSnapshot.variables ?? {}, true))
        : configuration;
    const resourceScope = source
      ? structuredClone(source.resource_scope)
      : kind === "configuration_probe" && frozen && "config_version_id" in frozen
        ? { schema_version: 1 as const, config_version_id: frozen.config_version_id, version_ids: structuredClone(frozen.version_ids) }
        : isInspectionInput(inputSnapshot)
          ? inputSnapshot
          : isMaterialInput(inputSnapshot)
            ? inputSnapshot
            : null;
    const now = stamp();
    const job: JobDetail = {
      id: crypto.randomUUID(),
      project_id: input.project_id,
      kind,
      status: "queued",
      attempt: 0,
      result: null,
      input_snapshot: inputSnapshot,
      resource_scope: resourceScope,
      configuration: frozen,
      source_job_id: sourceId,
      error_code: null,
      created_at: now,
      updated_at: now,
      attempts: [],
      artifacts: [],
    };
    jobs.set(job.id, job);
    idempotency.set(key, { fingerprint, jobId: job.id });
    return read(job);
  }

  /** Review and feedback-split jobs are created by their own entries with a frozen run id. */
  function enqueueModelJob(projectId: string, kind: "review" | "feedback_decomposition", input: Record<string, unknown>, sourceJobId?: string) {
    requireProject(projectId);
    const timestamp = stamp();
    const job = parseDto("JobDetail", {
      id: crypto.randomUUID(),
      project_id: projectId.toLowerCase(),
      kind,
      input_snapshot: input,
      resource_scope: { ...input },
      configuration: null,
      source_job_id: sourceJobId ?? null,
      status: "queued",
      attempt: 0,
      result: null,
      error_code: null,
      created_at: timestamp,
      updated_at: timestamp,
      attempts: [],
      artifacts: [],
    });
    jobs.set(job.id, job);
    return read(job);
  }

  return {
    enqueueFixed,
    registerFixed(kind, complete) {
      fixed.set(kind, complete);
    },
    enqueuePlan(projectId, adjustmentId) {
      requireProject(projectId);
      requireUuid(adjustmentId);
      const timestamp = stamp();
      const input = { schema_version: 1, adjustment_id: adjustmentId.toLowerCase() };
      const job = parseDto("JobDetail", {
        id: crypto.randomUUID(),
        project_id: projectId.toLowerCase(),
        kind: "plan_adjustment",
        input_snapshot: input,
        resource_scope: { ...input },
        configuration: null,
        source_job_id: null,
        status: "queued",
        attempt: 0,
        result: null,
        error_code: null,
        created_at: timestamp,
        updated_at: timestamp,
        attempts: [],
        artifacts: [],
      });
      jobs.set(job.id, job);
      return read(job);
    },
    enqueueLiterature(projectId, searchId, sourceJobId) {
      requireProject(projectId);
      requireUuid(searchId);
      const timestamp = stamp();
      const input = { schema_version: 1, search_id: searchId.toLowerCase() };
      const job = parseDto("JobDetail", {
        id: crypto.randomUUID(),
        project_id: projectId.toLowerCase(),
        kind: "literature_search",
        input_snapshot: input,
        resource_scope: { ...input },
        configuration: null,
        source_job_id: sourceJobId ?? null,
        status: "queued",
        attempt: 0,
        result: null,
        error_code: null,
        created_at: timestamp,
        updated_at: timestamp,
        attempts: [],
        artifacts: [],
      });
      jobs.set(job.id, job);
      return read(job);
    },
    enqueueReview(projectId, reviewId, sourceJobId) {
      return enqueueModelJob(projectId, "review", { schema_version: 1, review_id: requireUuid(reviewId).toLowerCase() }, sourceJobId);
    },
    enqueueFeedbackSplit(projectId, splitId, sourceJobId) {
      return enqueueModelJob(projectId, "feedback_decomposition", { schema_version: 1, split_id: requireUuid(splitId).toLowerCase() }, sourceJobId);
    },
    enqueueAssistant(projectId, runId, sourceJobId) {
      requireProject(projectId);
      requireUuid(runId);
      const timestamp = stamp();
      const input = { schema_version: 1, run_id: runId };
      const job = parseDto("JobDetail", {
        id: crypto.randomUUID(),
        project_id: projectId.toLowerCase(),
        kind: "content_revision",
        input_snapshot: input,
        resource_scope: input,
        configuration: null,
        source_job_id: sourceJobId ?? null,
        status: "queued",
        attempt: 0,
        result: null,
        error_code: null,
        created_at: timestamp,
        updated_at: timestamp,
        attempts: [],
        artifacts: [],
      });
      jobs.set(job.id, job);
      return read(job);
    },
    enqueueMaterial(projectId, input, fileType) {
      requireProject(projectId);
      const timestamp = stamp();
      const job: JobDetail = parseDto("JobDetail", {
        id: crypto.randomUUID(),
        project_id: projectId.toLowerCase(),
        kind: "material_parse",
        input_snapshot: structuredClone(input),
        resource_scope: structuredClone(input),
        configuration: { schema_version: 1, parser_version: "thesispilot-material-1", file_type: fileType },
        status: "queued",
        attempt: 0,
        result: null,
        error_code: null,
        source_job_id: null,
        created_at: timestamp,
        updated_at: timestamp,
        attempts: [],
        artifacts: [],
      });
      jobs.set(job.id, job);
      return read(job);
    },
    configurationReferences(ids) {
      return [...jobs.values()].flatMap((job) => {
        if (!isProbeScope(job.resource_scope)) return [];
        const matched = Object.values(job.resource_scope.version_ids).filter((id) => ids.includes(id));
        return matched.length ? [{ job_id: job.id, project_id: job.project_id, kind: job.kind, status: job.status, matched_version_ids: matched }] : [];
      });
    },
    async list(query, signal) {
      await before(signal);
      requireProject(query.project_id);
      const { limit, offset } = pageQuery(query);
      const statuses = jobStatuses(query.status);
      const kind = jobKind(query.kind);
      const matching = [...jobs.values()].filter((job) => job.project_id === query.project_id && (!kind || job.kind === kind));
      matching.forEach(progress);
      const ordered = matching
        .filter((job) => !statuses.length || statuses.includes(job.status))
        .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
      return structuredClone(parseDto("JobPage", { items: ordered.slice(offset, offset + limit).map(summary), total: ordered.length, limit, offset }));
    },
    async create(input, key, signal) {
      await before(signal);
      return submit(parseJobInput(input), key);
    },
    async get(id, signal, projectId) {
      await before(signal);
      return structuredClone(parseDto("JobDetail", getJob(id, projectId)));
    },
    async cancel(id, signal, projectId) {
      await before(signal);
      const job = getJob(id, projectId);
      if (job.status === "succeeded" || job.status === "failed") throw new ApiError("JOB_STATE_CONFLICT", { status: 409 });
      if (job.status !== "cancelled") {
        job.status = "cancelled";
        job.updated_at = stamp();
        const attempt = job.attempts[0];
        if (attempt) {
          attempt.status = "cancelled";
          attempt.finished_at = job.updated_at;
        }
      }
      return read(job);
    },
    async retry(id, key, signal, projectId) {
      await before(signal);
      const source = getJob(id, projectId);
      if (source.kind === "content_revision") throw new ApiError("ASSISTANT_RUN_RETRY_REQUIRED", { status: 409 });
      if (source.kind === "document_export" || source.kind === "change_record") {
        if (source.status === "queued" || source.status === "running") throw new ApiError("JOB_STATE_CONFLICT", { status: 409 });
        return enqueueFixed(
          {
            projectId: source.project_id,
            kind: source.kind,
            snapshot: source.input_snapshot as FixedJobInput["snapshot"],
            configuration: source.configuration as ExportConfiguration,
            sourceJobId: source.id,
          },
          key,
        );
      }
      if (source.kind === "review") throw new ApiError("REVIEW_RETRY_REQUIRED", { status: 409 });
      if (source.kind === "literature_search") throw new ApiError("LITERATURE_RETRY_REQUIRED", { status: 409 });
      if (source.kind === "feedback_decomposition") throw new ApiError("FEEDBACK_SPLIT_RETRY_REQUIRED", { status: 409 });
      if (source.kind === "plan_adjustment") throw new ApiError("PLAN_ADJUSTMENT_RETRY_REQUIRED", { status: 409 });
      return submit(
        {
          project_id: source.project_id,
          kind: source.kind,
          input_snapshot: source.input_snapshot,
          configuration: isInspectionConfiguration(source.configuration) ? source.configuration : null,
        },
        key,
        source,
      );
    },
  };
}
