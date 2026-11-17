import type { ApiTypes, BackupRead, RestoreRead, SchemaName } from "./contracts/api.generated.ts";
import { ApiError, throwIfAborted } from "./errors.ts";
import { sha256Hex } from "./httpExports.ts";
import type { BackupService, PageQuery } from "./types.ts";
import { pageQuery, requireIdempotencyKey, requireUuid } from "./validation.ts";

type Request = <Name extends SchemaName>(
  path: string,
  schema: Name,
  method?: string,
  body?: unknown,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
) => Promise<ApiTypes[Name]>;
type Download = (path: string, schema: "blob", method: "GET", body?: undefined, signal?: AbortSignal) => Promise<Blob>;

/** 与后端 MAX_PACKAGE_BYTES 一致。 */
export const BACKUP_MAX_BYTES = 256 * 1024 * 1024;
const base = (projectId: string) => `/projects/${requireUuid(projectId)}/backups`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function checkBackup(value: BackupRead, projectId: string, jobId?: string): BackupRead {
  if (!same(value.project_id, projectId) || (jobId !== undefined && !same(value.job_id, jobId)) || (value.file !== null && value.status !== "succeeded"))
    throw new ApiError("INVALID_RESPONSE");
  return value;
}

export function checkRestore(value: RestoreRead, jobId?: string): RestoreRead {
  if ((jobId !== undefined && !same(value.job_id, jobId)) || (value.result_project_id !== null && value.status !== "succeeded"))
    throw new ApiError("INVALID_RESPONSE");
  return value;
}

export function createHttpBackups(request: Request, download: Download): BackupService {
  const command = (key: string) => ({ "Idempotency-Key": requireIdempotencyKey(key) });
  const get = async (projectId: string, jobId: string, signal?: AbortSignal) =>
    checkBackup(await request(`${base(projectId)}/${requireUuid(jobId)}`, "BackupRead", "GET", undefined, signal), projectId, jobId);
  return {
    async list(projectId, query?: PageQuery, signal?) {
      const { limit, offset } = pageQuery(query);
      const page = await request(`${base(projectId)}?limit=${limit}&offset=${offset}`, "BackupPage", "GET", undefined, signal);
      if (page.limit !== limit || page.offset !== offset || page.items.length > limit || page.total < page.items.length) throw new ApiError("INVALID_RESPONSE");
      page.items.forEach((item) => checkBackup(item, projectId));
      return page;
    },
    get,
    async create(projectId, key, signal) {
      return checkBackup(await request(base(projectId), "BackupRead", "POST", undefined, signal, command(key)), projectId);
    },
    async cancel(projectId, jobId, signal) {
      return checkBackup(await request(`${base(projectId)}/${requireUuid(jobId)}/cancel`, "BackupRead", "POST", undefined, signal), projectId, jobId);
    },
    async retry(projectId, jobId, key, signal) {
      const value = checkBackup(
        await request(`${base(projectId)}/${requireUuid(jobId)}/retry`, "BackupRead", "POST", undefined, signal, command(key)),
        projectId,
      );
      if (!value.source_job_id || !same(value.source_job_id, jobId)) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async download(projectId, jobId, signal) {
      const info = await get(projectId, jobId, signal);
      if (info.status !== "succeeded" || !info.file) throw new ApiError("BACKUP_FILE_NOT_READY", { status: 409 });
      const blob = await download(`${base(projectId)}/${requireUuid(jobId)}/download`, "blob", "GET", undefined, signal);
      throwIfAborted(signal);
      if (blob.size !== info.file.byte_size || (await sha256Hex(blob)) !== info.file.sha256) throw new ApiError("BACKUP_FILE_CORRUPT");
      throwIfAborted(signal);
      return { blob, filename: info.file.filename };
    },
    async upload(file, filename, key, signal) {
      if (!file.size || file.size > BACKUP_MAX_BYTES) throw new ApiError("BACKUP_PACKAGE_TOO_LARGE", { status: 413 });
      const name = encodeURIComponent(filename.slice(0, 255) || "项目备份.zip");
      const value = await request(`/backups/restores?filename=${name}`, "RestoreRead", "POST", file, signal, command(key));
      return checkRestore(value);
    },
    async restores(query?: PageQuery, signal?) {
      const { limit, offset } = pageQuery(query);
      const page = await request(`/backups/restores?limit=${limit}&offset=${offset}`, "RestorePage", "GET", undefined, signal);
      if (page.limit !== limit || page.offset !== offset || page.items.length > limit || page.total < page.items.length) throw new ApiError("INVALID_RESPONSE");
      page.items.forEach((item) => checkRestore(item));
      return page;
    },
    async restore(jobId, signal) {
      return checkRestore(await request(`/backups/restores/${requireUuid(jobId)}`, "RestoreRead", "GET", undefined, signal), jobId);
    },
    async cancelRestore(jobId, signal) {
      return checkRestore(await request(`/backups/restores/${requireUuid(jobId)}/cancel`, "RestoreRead", "POST", undefined, signal), jobId);
    },
  };
}
