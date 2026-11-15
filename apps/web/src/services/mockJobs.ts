import type { DocumentVersionRead, InspectionResult, JobCreate, JobDetail, JobRead } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { MockDocuments } from "./mockDocuments.ts";
import type { JobService } from "./types.ts";
import { jobKind, jobStatuses, pageQuery, parseDto, requireIdempotencyKey, requireUuid } from "./validation.ts";

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
    text_characters: job.configuration?.include_text_statistics ? characters : null,
    model_used: false,
    writes_performed: false,
  };
}

export function createMockJobs(before: (signal?: AbortSignal) => Promise<void>, requireProject: (id: string) => unknown, documents: MockDocuments): JobService {
  const jobs = new Map<string, JobDetail>();
  const idempotency = new Map<string, { fingerprint: string; jobId: string }>();

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
    } else {
      const scope = job.resource_scope!;
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
    if ((kind === "diagnostic" && (input.input_snapshot || input.configuration)) || (kind === "document_inspection" && !input.input_snapshot))
      throw new ApiError("VALIDATION_ERROR", { status: 422 });
    const inputSnapshot = input.input_snapshot
      ? { schema_version: 1 as const, document_id: input.input_snapshot.document_id, document_version: input.input_snapshot.document_version }
      : null;
    const configuration =
      kind === "document_inspection" ? { schema_version: 1 as const, include_text_statistics: input.configuration?.include_text_statistics ?? true } : null;
    const sourceId = source?.id ?? null;
    const fingerprint = JSON.stringify([input.project_id, kind, inputSnapshot, configuration, sourceId]);
    const existing = idempotency.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new ApiError("JOB_IDEMPOTENCY_CONFLICT", { status: 409 });
      return read(getJob(existing.jobId));
    }
    if (source && (source.status === "queued" || source.status === "running")) throw new ApiError("JOB_STATE_CONFLICT", { status: 409 });
    requireProject(input.project_id);
    if (inputSnapshot) documents.revisionVersion(input.project_id, inputSnapshot.document_id, inputSnapshot.document_version);
    const now = stamp();
    const job: JobDetail = {
      id: crypto.randomUUID(),
      project_id: input.project_id,
      kind,
      status: "queued",
      attempt: 0,
      result: null,
      input_snapshot: inputSnapshot,
      resource_scope: inputSnapshot,
      configuration,
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

  return {
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
      return submit(parseDto("JobCreate", { kind: "diagnostic", ...input }, true), key);
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
      return submit(
        { project_id: source.project_id, kind: source.kind, input_snapshot: source.input_snapshot, configuration: source.configuration },
        key,
        source,
      );
    },
  };
}
