import type { ApiTypes, DocumentOfficeSourceRead, OfficeImportConfirm, OfficeImportRead, SchemaName } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { OfficeImportService, PageQuery } from "./types.ts";
import { pageQuery, parseDto, requireIdempotencyKey, requireUuid } from "./validation.ts";

type Request = <Name extends SchemaName>(
  path: string,
  schema: Name,
  method?: string,
  body?: unknown,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
) => Promise<ApiTypes[Name]>;

const base = (projectId: string) => `/projects/${requireUuid(projectId)}/office-imports`;
const same = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();
const invalid = (): never => {
  throw new ApiError("INVALID_RESPONSE");
};

/** 预览只在任务成功后出现；建立/追加的可选性与已有正式稿一致。 */
export function checkOfficeImport(value: OfficeImportRead, projectId: string, jobId?: string): OfficeImportRead {
  if (!same(value.project_id, projectId) || (jobId !== undefined && !same(value.job_id, jobId))) invalid();
  const preview = value.preview;
  if (!preview) return value;
  const existing = preview.existing_document_id !== null;
  if (
    value.status !== "succeeded" ||
    preview.original_sha256 !== value.original_sha256 ||
    existing !== (preview.existing_version !== null) ||
    preview.can_create === existing ||
    (preview.can_append && (!existing || preview.append_blocked_reason !== null)) ||
    (existing && !preview.can_append && !preview.append_blocked_reason) ||
    new Set(preview.chapters.map((item) => item.id)).size !== preview.chapters.length
  )
    invalid();
  return value;
}

/** 新版本必须指定当前正文版本；新建正式稿不得携带版本。 */
export function checkOfficeConfirm(input: OfficeImportConfirm): OfficeImportConfirm {
  const data = parseDto("OfficeImportConfirm", input, true);
  requireUuid(data.command_id);
  const expected = data.expected_version;
  if (data.mode === "new_version" ? !Number.isSafeInteger(expected) || (expected as number) < 1 : expected != null)
    throw new ApiError("VALIDATION_ERROR", { status: 422 });
  return data.mode === "create" ? { command_id: data.command_id.toLowerCase(), mode: "create" } : { ...data, command_id: data.command_id.toLowerCase() };
}

export function checkOfficeSource(value: DocumentOfficeSourceRead, documentId: string, version?: number): DocumentOfficeSourceRead {
  if (!same(value.document_id, documentId) || value.document_version < 1 || (version !== undefined && value.document_version > version)) invalid();
  return value;
}

export function createHttpOfficeImports(request: Request): OfficeImportService {
  const command = (key: string) => ({ "Idempotency-Key": requireIdempotencyKey(key) });
  return {
    async create(projectId, input, key, signal) {
      const data = parseDto("OfficeImportCreate", { material_id: requireUuid(input.material_id), original_id: requireUuid(input.original_id) }, true);
      const value = checkOfficeImport(await request(base(projectId), "OfficeImportRead", "POST", data, signal, command(key)), projectId);
      if (!same(value.material_id, data.material_id) || !same(value.original_id, data.original_id) || value.source_job_id !== null) invalid();
      return value;
    },
    async list(projectId, query?: PageQuery, signal?) {
      const { limit, offset } = pageQuery(query);
      const page = await request(`${base(projectId)}?limit=${limit}&offset=${offset}`, "OfficeImportPage", "GET", undefined, signal);
      if (page.limit !== limit || page.offset !== offset || page.items.length > limit || page.total < page.items.length) invalid();
      page.items.forEach((item) => checkOfficeImport(item, projectId));
      return page;
    },
    async get(projectId, jobId, signal) {
      return checkOfficeImport(await request(`${base(projectId)}/${requireUuid(jobId)}`, "OfficeImportRead", "GET", undefined, signal), projectId, jobId);
    },
    async cancel(projectId, jobId, signal) {
      return checkOfficeImport(
        await request(`${base(projectId)}/${requireUuid(jobId)}/cancel`, "OfficeImportRead", "POST", undefined, signal),
        projectId,
        jobId,
      );
    },
    async retry(projectId, jobId, key, signal) {
      const value = checkOfficeImport(
        await request(`${base(projectId)}/${requireUuid(jobId)}/retry`, "OfficeImportRead", "POST", undefined, signal, command(key)),
        projectId,
      );
      if (!same(value.source_job_id, jobId) || same(value.job_id, jobId)) invalid();
      return value;
    },
    async confirm(projectId, jobId, input, signal) {
      const data = checkOfficeConfirm(input);
      const value = await request(`${base(projectId)}/${requireUuid(jobId)}/confirm`, "OfficeImportReceipt", "POST", data, signal);
      if (
        !same(value.command_id, data.command_id) ||
        value.mode !== data.mode ||
        value.document_version !== (data.mode === "create" ? 1 : (data.expected_version as number) + 1)
      )
        invalid();
      return value;
    },
    async source(projectId, documentId, version, signal) {
      if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const query = version === undefined ? "" : `?version=${version}`;
      const value = await request(
        `/projects/${requireUuid(projectId)}/documents/${requireUuid(documentId)}/office-source${query}`,
        "DocumentOfficeSourceRead",
        "GET",
        undefined,
        signal,
      );
      return checkOfficeSource(value, documentId, version);
    },
  };
}
