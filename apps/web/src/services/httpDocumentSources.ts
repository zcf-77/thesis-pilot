import type { ApiTypes, SchemaName, DocumentSourceRead } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { DocumentSourceService } from "./types.ts";
import { parseDto, requireUuid } from "./validation.ts";

export const DOCUMENT_SOURCE_TRANSPORT_BYTES = 17 * 1024 * 1024;
type Request = <Name extends SchemaName>(path: string, schema: Name, method?: string, body?: unknown, signal?: AbortSignal) => Promise<ApiTypes[Name]>;
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const base = (projectId: string) => `/projects/${requireUuid(projectId)}`;
function versionNumber(version: number) {
  if (!Number.isSafeInteger(version) || version < 1) throw new ApiError("VALIDATION_ERROR", { status: 422 });
  return version;
}
export function documentSourceInput<Name extends "DocumentSourcePreviewRequest" | "DocumentSourceImport">(name: Name, input: ApiTypes[Name]): ApiTypes[Name] {
  const normalized = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      ["material_id", "original_version_id", "parse_version_id", "command_id"].includes(key) && typeof value === "string" ? value.toLowerCase() : value,
    ]),
  );
  const data = parseDto(name, normalized, true);
  if ("chapter_corrections" in data) {
    const corrections = data.chapter_corrections ?? [];
    if (
      new Set(corrections.map((correction) => correction.anchor_id)).size !== corrections.length ||
      corrections.some((correction) => (correction.kind === "heading") !== (correction.level != null))
    )
      throw new ApiError("DOCUMENT_SOURCE_CHAPTER_INVALID", { status: 422 });
  }
  if (name === "DocumentSourceImport") {
    const command = data as ApiTypes["DocumentSourceImport"];
    return parseDto(
      name,
      {
        ...command,
        chapter_corrections: (command.chapter_corrections ?? [])
          .map((correction) => ({ ...correction, level: correction.level ?? null }))
          .sort((a, b) => (a.anchor_id < b.anchor_id ? -1 : a.anchor_id > b.anchor_id ? 1 : 0)),
      },
      true,
    );
  }
  return data;
}
function sourceIdentity(value: DocumentSourceRead, documentId: string, version: number) {
  if (
    !sameId(value.document_id, documentId) ||
    value.document_version !== version ||
    !/^[0-9a-f]{64}$/.test(value.original_sha256) ||
    !/^[0-9a-f]{64}$/.test(value.manifest_sha256)
  )
    throw new ApiError("INVALID_RESPONSE");
  return value;
}
export function createHttpDocumentSources(request: Request): DocumentSourceService {
  return {
    async preview(projectId, input, signal) {
      const data = documentSourceInput("DocumentSourcePreviewRequest", input);
      const value = await request(`${base(projectId)}/document-import/preview`, "DocumentSourcePreview", "POST", data, signal);
      if (
        !sameId(value.project_id, projectId) ||
        !sameId(value.material_id, data.material_id) ||
        !sameId(value.original_version_id, data.original_version_id) ||
        !sameId(value.parse_version_id, data.parse_version_id) ||
        !/^[0-9a-f]{64}$/.test(value.original_sha256) ||
        !/^[0-9a-f]{64}$/.test(value.manifest_sha256) ||
        new Set(value.chapters.map((chapter) => chapter.anchor_id)).size !== value.chapters.length ||
        value.chapters.some(
          (chapter) => (chapter.kind === "heading") !== (chapter.level != null) || chapter.editor_path.some((part) => !Number.isSafeInteger(part) || part < 0),
        )
      )
        throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async import(projectId, input, signal) {
      const data = documentSourceInput("DocumentSourceImport", input);
      const value = await request(`${base(projectId)}/document-import`, "DocumentSourceImportReceipt", "POST", data, signal);
      if (
        !sameId(value.command_id, data.command_id) ||
        !sameId(value.material_id, data.material_id) ||
        !sameId(value.original_version_id, data.original_version_id) ||
        !sameId(value.parse_version_id, data.parse_version_id) ||
        value.document_version !== 1
      )
        throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async current(projectId, documentId, expectedVersion, signal) {
      versionNumber(expectedVersion);
      return sourceIdentity(
        await request(
          `${base(projectId)}/documents/${requireUuid(documentId)}/source?expected_document_version=${expectedVersion}`,
          "DocumentSourceRead",
          "GET",
          undefined,
          signal,
        ),
        documentId,
        expectedVersion,
      );
    },
    async version(projectId, documentId, version, signal) {
      versionNumber(version);
      return sourceIdentity(
        await request(`${base(projectId)}/documents/${requireUuid(documentId)}/versions/${version}/source`, "DocumentSourceRead", "GET", undefined, signal),
        documentId,
        version,
      );
    },
  };
}
