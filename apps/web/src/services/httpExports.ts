import type { ApiTypes, ExportRead, SchemaName } from "./contracts/api.generated.ts";
import { ApiError, throwIfAborted } from "./errors.ts";
import type { ExportService, PageQuery } from "./types.ts";
import { pageQuery, parseDto, requireIdempotencyKey, requireUuid } from "./validation.ts";

type Request = <Name extends SchemaName>(
  path: string,
  schema: Name,
  method?: string,
  body?: unknown,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
) => Promise<ApiTypes[Name]>;
type Download = (path: string, schema: "blob", method: "GET", body?: undefined, signal?: AbortSignal) => Promise<Blob>;

const base = (projectId: string) => `/projects/${requireUuid(projectId)}/exports`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function checkExport(value: ExportRead, projectId: string, jobId?: string): ExportRead {
  if (
    !same(value.project_id, projectId) ||
    (jobId !== undefined && !same(value.job_id, jobId)) ||
    (value.kind === "change_record") !== (value.from_version !== null) ||
    (value.from_version !== null && value.from_version > value.document_version) ||
    (value.kind === "change_record" && value.format === "txt") ||
    (value.file !== null && value.status !== "succeeded")
  )
    throw new ApiError("INVALID_RESPONSE");
  return value;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createHttpExports(request: Request, download: Download): ExportService {
  const command = (key: string) => ({ "Idempotency-Key": requireIdempotencyKey(key) });
  const get = async (projectId: string, jobId: string, signal?: AbortSignal) =>
    checkExport(await request(`${base(projectId)}/${requireUuid(jobId)}`, "ExportRead", "GET", undefined, signal), projectId, jobId);
  return {
    async list(projectId, query?: PageQuery, signal?) {
      const { limit, offset } = pageQuery(query);
      const page = await request(`${base(projectId)}?limit=${limit}&offset=${offset}`, "ExportPage", "GET", undefined, signal);
      if (page.limit !== limit || page.offset !== offset || page.items.length > limit || page.total < page.items.length) throw new ApiError("INVALID_RESPONSE");
      page.items.forEach((item) => checkExport(item, projectId));
      return page;
    },
    get,
    async exportDocument(projectId, input, key, signal) {
      const data = parseDto("DocumentExportCreate", { ...input, document_id: input.document_id.toLowerCase() }, true);
      const value = await request(`${base(projectId)}/documents`, "ExportRead", "POST", data, signal, command(key));
      checkExport(value, projectId);
      if (value.kind !== "document_export" || value.document_version !== data.document_version || value.format !== data.format)
        throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async changeRecord(projectId, input, key, signal) {
      const data = parseDto("ChangeRecordCreate", { ...input, document_id: input.document_id.toLowerCase() }, true);
      const value = await request(`${base(projectId)}/change-records`, "ExportRead", "POST", data, signal, command(key));
      checkExport(value, projectId);
      if (
        value.kind !== "change_record" ||
        value.from_version !== data.from_version ||
        (data.to_version != null && value.document_version !== data.to_version) ||
        value.format !== data.format
      )
        throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async cancel(projectId, jobId, signal) {
      return checkExport(await request(`${base(projectId)}/${requireUuid(jobId)}/cancel`, "ExportRead", "POST", undefined, signal), projectId, jobId);
    },
    async retry(projectId, jobId, key, signal) {
      const value = checkExport(
        await request(`${base(projectId)}/${requireUuid(jobId)}/retry`, "ExportRead", "POST", undefined, signal, command(key)),
        projectId,
      );
      if (!value.source_job_id || !same(value.source_job_id, jobId)) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async download(projectId, jobId, signal) {
      const info = await get(projectId, jobId, signal);
      if (info.status !== "succeeded" || !info.file) throw new ApiError("EXPORT_FILE_NOT_READY", { status: 409 });
      const blob = await download(`${base(projectId)}/${requireUuid(jobId)}/download`, "blob", "GET", undefined, signal);
      throwIfAborted(signal);
      if (blob.size !== info.file.byte_size || (await sha256Hex(blob)) !== info.file.sha256) throw new ApiError("EXPORT_FILE_CORRUPT");
      throwIfAborted(signal);
      return { blob, filename: info.file.filename };
    },
  };
}
