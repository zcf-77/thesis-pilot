import type { ApiTypes, DocumentRead } from "./contracts/api.generated.ts";
import { prepareEditorSnapshot, type EditorSnapshot } from "../lab/state/editorAdapter.ts";
import { ApiError } from "./errors.ts";
import { parseDocumentEnvelope } from "./validation.ts";

export const DOCUMENT_CONTENT_BYTES = 16 * 1024 * 1024;
export const DOCUMENT_TRANSPORT_BYTES = DOCUMENT_CONTENT_BYTES + 64 * 1024;
export type DocumentContent = DocumentRead["content"];
export type DocumentSchema = "DocumentImport" | "DocumentSave" | "DocumentRead" | "DocumentVersionRead";
export const documentSchemas = new Set<string>(["DocumentImport", "DocumentSave", "DocumentRead", "DocumentVersionRead"]);

export function snapshotFromContent(content: DocumentContent): EditorSnapshot {
  return prepareEditorSnapshot({ schemaVersion: content.schema_version, json: content.json, chapters: [] });
}

export function contentFromSnapshot(snapshot: EditorSnapshot): DocumentContent {
  const prepared = prepareEditorSnapshot(snapshot);
  const pending = [prepared.json];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "heading" && !node.attrs?.chapterId) throw new ApiError("DOCUMENT_STRUCTURE_INVALID", { status: 422 });
    pending.push(...(node.content ?? []));
  }
  return { schema_version: 1, json: prepared.json as DocumentContent["json"] };
}

export function parseDocumentDto<Name extends DocumentSchema>(name: Name, value: unknown, input = false): ApiTypes[Name] {
  const dto = parseDocumentEnvelope(name, value, input);
  let content: DocumentContent;
  try {
    content = contentFromSnapshot(snapshotFromContent(dto.content));
  } catch {
    throw new ApiError(input ? "DOCUMENT_STRUCTURE_INVALID" : "INVALID_RESPONSE", input ? { status: 422 } : {});
  }
  if (new TextEncoder().encode(JSON.stringify(content.json)).byteLength > DOCUMENT_CONTENT_BYTES)
    throw new ApiError(input ? "DOCUMENT_TOO_LARGE" : "INVALID_RESPONSE", input ? { status: 413 } : {});
  return { ...dto, content };
}

export async function readDocumentResponse(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > DOCUMENT_TRANSPORT_BYTES)
    throw new ApiError("INVALID_RESPONSE", { status: response.status });
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > DOCUMENT_TRANSPORT_BYTES) {
        await reader.cancel();
        throw new ApiError("INVALID_RESPONSE", { status: response.status });
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_RESPONSE", { status: response.status });
  } finally {
    reader.releaseLock();
  }
}
