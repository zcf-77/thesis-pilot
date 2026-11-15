import type { ApiTypes, SchemaName, JobRead } from "./contracts/api.generated.ts";
import { ApiError, throwIfAborted } from "./errors.ts";
import type { MaterialService, PageQuery } from "./types.ts";
import { isMaterialInput, isMaterialConfiguration, pageQuery, parseDto, requireIdempotencyKey, requireUuid } from "./validation.ts";

export const MATERIAL_MAX_BYTES = 8 * 1024 * 1024;
export const MATERIAL_UPLOAD_TRANSPORT_BYTES = 11_250_348;
export const MATERIAL_PARSE_TRANSPORT_BYTES = 17 * 1024 * 1024;
type Request = <Name extends SchemaName>(
  path: string,
  schema: Name,
  method?: string,
  body?: unknown,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
) => Promise<ApiTypes[Name]>;
type Download = (path: string, schema: "blob", method: "GET", body?: undefined, signal?: AbortSignal) => Promise<Blob>;
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const root = (projectId: string) => `/projects/${requireUuid(projectId)}`;
const materialPath = (projectId: string, materialId: string) => `${root(projectId)}/materials/${requireUuid(materialId)}`;
const originalPath = (projectId: string, materialId: string, originalId: string) =>
  `${materialPath(projectId, materialId)}/originals/${requireUuid(originalId)}`;
export function materialBytes(base64: string): Uint8Array<ArrayBuffer> {
  if (typeof base64 !== "string" || base64.length > 11_184_812) throw new ApiError("MATERIAL_TOO_LARGE", { status: 413 });
  if (!base64 || base64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new ApiError("MATERIAL_BASE64_INVALID", { status: 422 });
  let text: string;
  try {
    text = atob(base64);
  } catch {
    throw new ApiError("MATERIAL_BASE64_INVALID", { status: 422 });
  }
  if (btoa(text) !== base64) throw new ApiError("MATERIAL_BASE64_INVALID", { status: 422 });
  if (!text.length || text.length > MATERIAL_MAX_BYTES) throw new ApiError("MATERIAL_TOO_LARGE", { status: 413 });
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}
export function materialUploadInput<Name extends "MaterialUpload" | "MaterialOriginalCreate">(name: Name, input: ApiTypes[Name]) {
  const data = parseDto(name, { ...input, name: typeof input.name === "string" ? input.name.trim() : input.name, source_note: input.source_note ?? "" }, true);
  if (
    [".", ".."].includes(data.filename) ||
    /[/\\:]/.test(data.filename) ||
    Array.from(data.filename).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new ApiError("VALIDATION_ERROR", { status: 422 });
  const bytes = materialBytes(data.content_base64);
  const extension = data.filename.split(".").at(-1)?.toLowerCase() ?? "";
  if (
    !(data.file_type === "text" ? ["txt", "md", "text"] : [data.file_type]).includes(extension) ||
    (data.file_type === "docx" && (bytes[0] !== 80 || bytes[1] !== 75)) ||
    (data.file_type === "pdf" && new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
  )
    throw new ApiError("MATERIAL_FILE_TYPE_INVALID", { status: 422 });
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MATERIAL_UPLOAD_TRANSPORT_BYTES) throw new ApiError("MATERIAL_TOO_LARGE", { status: 413 });
  return data;
}
export function checkMaterialPage(value: { limit: number; offset: number; total: number; items: unknown[] }, query?: PageQuery) {
  const { limit, offset } = pageQuery(query);
  if (value.limit !== limit || value.offset !== offset || value.items.length > limit || value.total < value.items.length)
    throw new ApiError("INVALID_RESPONSE");
}
function materialIdentity(value: { project_id: string; id: string }, projectId: string, materialId?: string) {
  if (!sameId(value.project_id, projectId) || (materialId && !sameId(value.id, materialId))) throw new ApiError("INVALID_RESPONSE");
}
function originalIdentity(value: ApiTypes["MaterialOriginalRead"], materialId: string, originalId?: string) {
  if (
    !sameId(value.material_id, materialId) ||
    (originalId && !sameId(value.id, originalId)) ||
    !/^[0-9a-f]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.byte_size) ||
    value.byte_size < 1 ||
    value.byte_size > MATERIAL_MAX_BYTES ||
    value.version < 1
  )
    throw new ApiError("INVALID_RESPONSE");
}
export function materialJobIdentity(job: JobRead, projectId: string, materialId: string, originalId: string, expectedParseId?: string | null) {
  if (
    job.kind !== "material_parse" ||
    !sameId(job.project_id, projectId) ||
    !isMaterialInput(job.resource_scope) ||
    !sameId(job.resource_scope.material_id, materialId) ||
    !sameId(job.resource_scope.original_version_id, originalId) ||
    (expectedParseId !== undefined && job.resource_scope.expected_parse_id !== expectedParseId)
  )
    throw new ApiError("INVALID_RESPONSE");
}
export function createHttpMaterials(request: Request, download: Download): MaterialService {
  function receipt(value: ApiTypes["MaterialUploadReceipt"], projectId: string, materialId?: string) {
    materialIdentity(value.material, projectId, materialId);
    originalIdentity(value.original, value.material.id);
    if (!sameId(value.original.material_id, value.material.id)) throw new ApiError("INVALID_RESPONSE");
    materialJobIdentity(value.job, projectId, value.material.id, value.original.id);
    if (
      value.original.initial_job_id !== value.job.id ||
      !isMaterialConfiguration(value.job.configuration) ||
      value.job.configuration.file_type !== value.original.file_type ||
      !isMaterialInput(value.job.resource_scope) ||
      value.job.resource_scope.original_sha256 !== value.original.sha256
    )
      throw new ApiError("INVALID_RESPONSE");
    return value;
  }
  return {
    async list(projectId, query = {}, signal) {
      const { limit, offset } = pageQuery(query);
      if (query.kind !== undefined && !["template", "requirements", "literature", "other"].includes(query.kind))
        throw new ApiError("VALIDATION_ERROR", { status: 422 });
      if (query.include_removed !== undefined && typeof query.include_removed !== "boolean") throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const value = await request(
        `${root(projectId)}/materials?limit=${limit}&offset=${offset}${query.kind ? `&kind=${query.kind}` : ""}${query.include_removed ? "&include_removed=true" : ""}`,
        "MaterialPage",
        "GET",
        undefined,
        signal,
      );
      checkMaterialPage(value, query);
      value.items.forEach((item) => {
        materialIdentity(item, projectId);
        if (query.kind && item.kind !== query.kind) throw new ApiError("INVALID_RESPONSE");
      });
      return value;
    },
    async upload(projectId, input, key, signal) {
      return receipt(
        await request(`${root(projectId)}/materials`, "MaterialUploadReceipt", "POST", materialUploadInput("MaterialUpload", input), signal, {
          "Idempotency-Key": requireIdempotencyKey(key),
        }),
        projectId,
      );
    },
    async get(projectId, materialId, signal) {
      const value = await request(materialPath(projectId, materialId), "MaterialRead", "GET", undefined, signal);
      materialIdentity(value, projectId, materialId);
      return value;
    },
    async update(projectId, materialId, input, signal) {
      const data = parseDto("MaterialUpdate", { ...input, ...(typeof input.name === "string" ? { name: input.name.trim() } : {}) }, true);
      if (Object.keys(data).length <= 1 || Object.values(data).some((value) => value === null)) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const value = await request(materialPath(projectId, materialId), "MaterialRead", "PATCH", data, signal);
      materialIdentity(value, projectId, materialId);
      if (value.version !== data.expected_version + 1) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async appendOriginal(projectId, materialId, input, key, signal) {
      const data = materialUploadInput("MaterialOriginalCreate", input);
      const value = receipt(
        await request(`${materialPath(projectId, materialId)}/originals`, "MaterialUploadReceipt", "POST", data, signal, {
          "Idempotency-Key": requireIdempotencyKey(key),
        }),
        projectId,
        materialId,
      );
      // Replaying an upload key may return newer metadata around the same immutable original.
      if (value.material.version < data.expected_version + 1) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async originals(projectId, materialId, query, signal) {
      const { limit, offset } = pageQuery(query);
      const value = await request(
        `${materialPath(projectId, materialId)}/originals?limit=${limit}&offset=${offset}`,
        "MaterialOriginalPage",
        "GET",
        undefined,
        signal,
      );
      checkMaterialPage(value, query);
      value.items.forEach((item) => originalIdentity(item, materialId));
      return value;
    },
    async original(projectId, materialId, originalId, signal) {
      const value = await request(originalPath(projectId, materialId, originalId), "MaterialOriginalRead", "GET", undefined, signal);
      originalIdentity(value, materialId, originalId);
      return value;
    },
    async download(projectId, materialId, originalId, signal) {
      const path = originalPath(projectId, materialId, originalId);
      const info = await request(path, "MaterialOriginalRead", "GET", undefined, signal);
      originalIdentity(info, materialId, originalId);
      const value = await download(`${path}/download`, "blob", "GET", undefined, signal);
      throwIfAborted(signal);
      if (value.size !== info.byte_size) throw new ApiError("INVALID_RESPONSE");
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await value.arrayBuffer()))]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      throwIfAborted(signal);
      if (digest !== info.sha256) throw new ApiError("MATERIAL_ORIGINAL_CORRUPT");
      return value;
    },
    async parses(projectId, materialId, originalId, query, signal) {
      const { limit, offset } = pageQuery(query);
      const value = await request(
        `${originalPath(projectId, materialId, originalId)}/parses?limit=${limit}&offset=${offset}`,
        "MaterialParseSummaryPage",
        "GET",
        undefined,
        signal,
      );
      checkMaterialPage(value, query);
      if (value.items.some((item) => !sameId(item.original_version_id, originalId))) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async parse(projectId, materialId, originalId, parseId, signal) {
      const value = await request(
        `${originalPath(projectId, materialId, originalId)}/parses/${requireUuid(parseId)}`,
        "MaterialParseRead",
        "GET",
        undefined,
        signal,
      );
      if (!sameId(value.id, parseId) || !sameId(value.original_version_id, originalId)) throw new ApiError("INVALID_RESPONSE");
      const anchors = new Set(value.result.anchors.map((anchor) => anchor.id));
      if (
        anchors.size !== value.result.anchors.length ||
        value.result.anchors.some((anchor) => !sameId(anchor.original_version_id, originalId)) ||
        [...value.result.template_items, ...value.result.requirements].some((item) => item.anchor_ids.some((id) => !anchors.has(id)))
      )
        throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async reparse(projectId, materialId, originalId, input, key, signal) {
      const data = parseDto("MaterialReparse", input, true);
      const value = await request(`${originalPath(projectId, materialId, originalId)}/parse-jobs`, "JobRead", "POST", data, signal, {
        "Idempotency-Key": requireIdempotencyKey(key),
      });
      materialJobIdentity(value, projectId, materialId, originalId, data.expected_parse_id);
      return value;
    },
    async sourceBinding(projectId, signal) {
      const value = await request(`${root(projectId)}/source-binding`, "ProjectSourceBindingRead", "GET", undefined, signal);
      if (!sameId(value.project_id, projectId)) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async updateSourceBinding(projectId, input, signal) {
      const data = parseDto("ProjectSourceBindingUpdate", input, true);
      if (new Set(data.requirement_parse_version_ids).size !== data.requirement_parse_version_ids.length)
        throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const value = await request(`${root(projectId)}/source-binding`, "ProjectSourceBindingRead", "PATCH", data, signal);
      if (
        !sameId(value.project_id, projectId) ||
        value.version !== data.expected_version + 1 ||
        value.template_parse_version_id?.toLowerCase() !== data.template_parse_version_id?.toLowerCase() ||
        value.requirement_parse_version_ids.length !== data.requirement_parse_version_ids.length ||
        value.requirement_parse_version_ids.some((id, index) => !sameId(id, data.requirement_parse_version_ids[index]!))
      )
        throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async sourceBindingVersions(projectId, query, signal) {
      const { limit, offset } = pageQuery(query);
      const value = await request(
        `${root(projectId)}/source-binding/versions?limit=${limit}&offset=${offset}`,
        "ProjectSourceBindingVersionPage",
        "GET",
        undefined,
        signal,
      );
      checkMaterialPage(value, query);
      if (value.items.some((item) => !sameId(item.project_id, projectId))) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async sourceBindingVersion(projectId, version, signal) {
      if (!Number.isSafeInteger(version) || version < 1) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const value = await request(`${root(projectId)}/source-binding/versions/${version}`, "ProjectSourceBindingVersionRead", "GET", undefined, signal);
      if (!sameId(value.project_id, projectId) || value.version !== version) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
  };
}
