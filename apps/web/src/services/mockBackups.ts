import type { BackupFileRead, BackupRead, JobDetail, ProjectBackupInput, ProjectBackupResult, ProjectRead, RestoreRead } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import { sha256Sync } from "./mockExports.ts";
import type { createMockJobs } from "./mockJobs.ts";
import type { BackupService } from "./types.ts";
import { pageQuery, parseDto, requireIdempotencyKey, requireUuid } from "./validation.ts";

type MockJobs = ReturnType<typeof createMockJobs>;
const FORMAT = "thesispilot-backup/1" as const;
const MAX_BYTES = 256 * 1024 * 1024;
const stamp = () => new Date().toISOString();

/**
 * Same contract as HTTP. The in-memory package is a JSON manifest only (no ZIP and no business
 * rows); restoring it creates an empty project copy, which is what the Mock store can represent.
 */
export function createMockBackups(
  before: (signal?: AbortSignal) => Promise<void>,
  project: (id: string) => ProjectRead,
  jobs: MockJobs,
  copyProject: (name: string, title: string) => ProjectRead,
): BackupService {
  const files = new Map<string, { file: BackupFileRead; text: string }>();
  const restores = new Map<string, RestoreRead & { upload_key: string; text: string }>();

  jobs.registerFixed("project_backup", (job: JobDetail, _attempt): ProjectBackupResult => {
    const source = project(job.project_id);
    const manifest = {
      format: FORMAT,
      schema_head: "mock",
      exported_at: stamp(),
      project: { id: source.id, name: source.name, title: source.title },
      tables: { "data/projects": { columns: ["id", "name"], rows: 1 } },
    };
    const text = JSON.stringify(manifest);
    const bytes = new TextEncoder().encode(text);
    const digest = sha256Sync(bytes);
    const file: BackupFileRead = {
      id: crypto.randomUUID(),
      filename: `${source.name}-备份.zip`,
      sha256: digest,
      package_sha256: sha256Sync(new TextEncoder().encode(JSON.stringify(manifest.tables))),
      byte_size: bytes.byteLength,
      schema_head: "mock",
      object_counts: { projects: 1 },
      created_at: stamp(),
    };
    files.set(job.id, { file, text });
    return {
      schema_version: 1,
      kind: "project_backup",
      job_id: job.id,
      project_id: job.project_id,
      archive_id: file.id,
      filename: file.filename,
      sha256: file.sha256,
      byte_size: file.byte_size,
      package_sha256: file.package_sha256,
      format: FORMAT,
      object_counts: file.object_counts,
      model_used: false,
      writes_performed: false,
    };
  });

  function view(job: Pick<JobDetail, "id" | "project_id" | "status" | "attempt" | "source_job_id" | "error_code" | "created_at" | "updated_at">): BackupRead {
    return parseDto("BackupRead", {
      job_id: job.id,
      project_id: job.project_id,
      status: job.status,
      attempt: job.attempt,
      source_job_id: job.source_job_id ?? null,
      error_code: job.error_code,
      file: job.status === "succeeded" ? (files.get(job.id)?.file ?? null) : null,
      created_at: job.created_at,
      updated_at: job.updated_at,
    });
  }
  async function read(projectId: string, jobId: string): Promise<BackupRead> {
    const job = await jobs.get(jobId, undefined, projectId).catch((cause: unknown) => {
      throw cause instanceof ApiError && cause.code === "JOB_NOT_FOUND" ? new ApiError("BACKUP_NOT_FOUND", { status: 404 }) : cause;
    });
    if (job.kind !== "project_backup") throw new ApiError("BACKUP_NOT_FOUND", { status: 404 });
    return view(job);
  }
  /** A queued mock restore finishes on its next read, like one queue poll. */
  function advance(record: RestoreRead & { text: string }): RestoreRead {
    if (record.status === "queued") {
      const manifest = JSON.parse(record.text) as { project: { name: string; title?: unknown } };
      const name = `${manifest.project.name.slice(0, 194)}（恢复副本）`;
      const copy = copyProject(name, typeof manifest.project.title === "string" ? manifest.project.title : "");
      record.status = "succeeded";
      record.attempt = 1;
      record.result_project_id = copy.id;
      record.updated_at = stamp();
    }
    const { text: _text, upload_key: _key, ...value } = record as RestoreRead & { text: string; upload_key: string };
    return parseDto("RestoreRead", value);
  }

  return {
    async list(projectId, query, signal) {
      await before(signal);
      project(requireUuid(projectId));
      const { limit, offset } = pageQuery(query);
      const all = (await jobs.list({ project_id: projectId, limit: 100, offset: 0 })).items.filter((job) => job.kind === "project_backup");
      return parseDto("BackupPage", { items: all.slice(offset, offset + limit).map(view), total: all.length, limit, offset });
    },
    async get(projectId, jobId, signal) {
      await before(signal);
      return read(projectId, jobId);
    },
    async create(projectId, key, signal) {
      await before(signal);
      requireIdempotencyKey(key);
      const source = project(requireUuid(projectId));
      const snapshot: ProjectBackupInput = { schema_version: 1, kind: "project_backup", project_id: source.id };
      return view(jobs.enqueueFixed({ projectId: source.id, kind: "project_backup", snapshot, configuration: { schema_version: 1, format: FORMAT } }, key));
    },
    async cancel(projectId, jobId, signal) {
      await read(projectId, jobId);
      await jobs.cancel(jobId, signal, projectId);
      return read(projectId, jobId);
    },
    async retry(projectId, jobId, key, signal) {
      await read(projectId, jobId);
      const job = await jobs.retry(jobId, key, signal, projectId);
      return read(projectId, job.id);
    },
    async download(projectId, jobId, signal) {
      await before(signal);
      const value = await read(projectId, jobId);
      const stored = files.get(jobId.toLowerCase());
      if (value.status !== "succeeded" || !stored) throw new ApiError("BACKUP_FILE_NOT_READY", { status: 409 });
      return { blob: new Blob([stored.text], { type: "application/zip" }), filename: stored.file.filename };
    },
    async upload(file, filename, key, signal) {
      await before(signal);
      requireIdempotencyKey(key);
      if (!file.size || file.size > MAX_BYTES) throw new ApiError("BACKUP_PACKAGE_TOO_LARGE", { status: 413 });
      const text = await file.text();
      const digest = sha256Sync(new TextEncoder().encode(text));
      const existing = [...restores.values()].find((item) => item.upload_key === key);
      if (existing) {
        if (existing.sha256 !== digest) throw new ApiError("JOB_IDEMPOTENCY_CONFLICT", { status: 409 });
        return advance(existing);
      }
      let manifest: { format?: unknown; project?: { id?: unknown; name?: unknown }; exported_at?: unknown; schema_head?: unknown };
      try {
        manifest = JSON.parse(text) as typeof manifest;
      } catch {
        throw new ApiError("BACKUP_PACKAGE_INVALID", { status: 422 });
      }
      if (manifest.format !== FORMAT) throw new ApiError(manifest.format ? "BACKUP_FORMAT_UNSUPPORTED" : "BACKUP_PACKAGE_INVALID", { status: 422 });
      if (typeof manifest.project?.id !== "string" || typeof manifest.project.name !== "string") throw new ApiError("BACKUP_PACKAGE_INVALID", { status: 422 });
      const created = stamp();
      const record = {
        job_id: crypto.randomUUID(),
        restore_id: crypto.randomUUID(),
        status: "queued" as RestoreRead["status"],
        attempt: 0,
        error_code: null,
        filename: filename.slice(0, 200) || "项目备份.zip",
        sha256: digest,
        byte_size: file.size,
        package_sha256: digest,
        source_project_id: manifest.project.id,
        source_project_name: manifest.project.name,
        schema_head: typeof manifest.schema_head === "string" ? manifest.schema_head : "mock",
        exported_at: typeof manifest.exported_at === "string" ? manifest.exported_at : created,
        object_counts: { projects: 1 },
        result_project_id: null,
        created_at: created,
        updated_at: created,
        upload_key: key,
        text,
      };
      restores.set(record.job_id, record);
      const { text: _text, upload_key: _key, ...value } = record;
      return parseDto("RestoreRead", value);
    },
    async restores(query, signal) {
      await before(signal);
      const { limit, offset } = pageQuery(query);
      const all = [...restores.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(advance);
      return parseDto("RestorePage", { items: all.slice(offset, offset + limit), total: all.length, limit, offset });
    },
    async restore(jobId, signal) {
      await before(signal);
      const record = restores.get(requireUuid(jobId).toLowerCase());
      if (!record) throw new ApiError("BACKUP_NOT_FOUND", { status: 404 });
      return advance(record);
    },
    async cancelRestore(jobId, signal) {
      await before(signal);
      const record = restores.get(requireUuid(jobId).toLowerCase());
      if (!record) throw new ApiError("BACKUP_NOT_FOUND", { status: 404 });
      if (record.status === "succeeded" || record.status === "failed") throw new ApiError("JOB_STATE_CONFLICT", { status: 409 });
      record.status = "cancelled";
      record.updated_at = stamp();
      return advance(record);
    },
  };
}
