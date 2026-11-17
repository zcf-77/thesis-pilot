import type { ApiTypes, DocumentRead } from "./contracts/api.generated.ts";
import { prepareEditorSnapshot, type EditorSnapshot } from "../lab/state/editorAdapter.ts";
import { ApiError } from "./errors.ts";
import { parseDocumentEnvelope } from "./validation.ts";
import { readBoundedResponse } from "./responseBody.ts";

export const DOCUMENT_CONTENT_BYTES = 16 * 1024 * 1024;
export const DOCUMENT_TRANSPORT_BYTES = DOCUMENT_CONTENT_BYTES + 64 * 1024;
export type DocumentContent = DocumentRead["content"];
/** schemaVersion 1：Tiptap JSON（旧版编辑器）。 */
export type LegacyDocumentContent = Extract<DocumentContent, { schema_version: 1 }>;
/** schemaVersion 2：DocsModel + 保护 + 派生章节。 */
export type DocsDocumentContent = Extract<DocumentContent, { schema_version: 2 }>;
export type DocumentSchema = "DocumentImport" | "DocumentSave" | "DocumentRead" | "DocumentVersionRead" | "DocumentSchemaUpgradeRead";
export const documentSchemas = new Set<string>(["DocumentImport", "DocumentSave", "DocumentRead", "DocumentVersionRead", "DocumentSchemaUpgradeRead"]);

export function isDocsContent(content: DocumentContent): content is DocsDocumentContent {
  return content.schema_version === 2;
}

/** 仍只认识 v1 的调用方用它取 Tiptap 内容；v2 明确拒绝，不猜测。 */
export function requireLegacyContent(content: DocumentContent): LegacyDocumentContent {
  if (isDocsContent(content)) throw new ApiError("DOCMODEL_SCHEMA_UNSUPPORTED", { status: 409 });
  return content;
}

export function snapshotFromContent(content: DocumentContent): EditorSnapshot {
  const legacy = requireLegacyContent(content);
  return prepareEditorSnapshot({ schemaVersion: legacy.schema_version, json: legacy.json, chapters: [] });
}

export function contentFromSnapshot(snapshot: EditorSnapshot): LegacyDocumentContent {
  const prepared = prepareEditorSnapshot(snapshot);
  const pending = [prepared.json];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "heading" && !node.attrs?.chapterId) throw new ApiError("DOCUMENT_STRUCTURE_INVALID", { status: 422 });
    pending.push(...(node.content ?? []));
  }
  return { schema_version: 1, json: prepared.json as LegacyDocumentContent["json"] };
}

function checkedContent(content: DocumentContent, input: boolean): DocumentContent {
  if (isDocsContent(content)) {
    // 结构已由生成契约校验；这里补字节上限与快照版本，章节由服务端重算。
    if (content.json.schemaVersion !== 2) throw new ApiError(input ? "DOCMODEL_INVALID" : "INVALID_RESPONSE", input ? { status: 422 } : {});
    if (new TextEncoder().encode(JSON.stringify(content.json)).byteLength > DOCUMENT_CONTENT_BYTES)
      throw new ApiError(input ? "DOCMODEL_TOO_LARGE" : "INVALID_RESPONSE", input ? { status: 413 } : {});
    return content;
  }
  let legacy: LegacyDocumentContent;
  try {
    legacy = contentFromSnapshot(snapshotFromContent(content));
  } catch {
    throw new ApiError(input ? "DOCUMENT_STRUCTURE_INVALID" : "INVALID_RESPONSE", input ? { status: 422 } : {});
  }
  if (new TextEncoder().encode(JSON.stringify(legacy.json)).byteLength > DOCUMENT_CONTENT_BYTES)
    throw new ApiError(input ? "DOCUMENT_TOO_LARGE" : "INVALID_RESPONSE", input ? { status: 413 } : {});
  return legacy;
}

export function parseDocumentDto<Name extends DocumentSchema>(name: Name, value: unknown, input = false): ApiTypes[Name] {
  const dto = parseDocumentEnvelope(name, value, input);
  if ("document" in dto) return { ...dto, document: { ...dto.document, content: checkedContent(dto.document.content, input) } } as ApiTypes[Name];
  return { ...dto, content: checkedContent(dto.content, input) } as ApiTypes[Name];
}

export async function readDocumentResponse(response: Response): Promise<string> {
  return readBoundedResponse(response, DOCUMENT_TRANSPORT_BYTES);
}
