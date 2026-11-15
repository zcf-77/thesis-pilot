import type { DocumentRead, DocumentVersionRead } from "./contracts/api.generated.ts";
import { parseDocumentDto } from "./documentContent.ts";
import { ApiError, throwIfAborted } from "./errors.ts";
import type { DocumentService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

export function createMockDocuments(requireProject: (id: string) => unknown): DocumentService {
  const documents = new Map<string, DocumentRead>();
  const history = new Map<string, DocumentVersionRead[]>();
  const clone = <T>(value: T): T => structuredClone(value);
  async function before(signal?: AbortSignal) {
    throwIfAborted(signal);
    await Promise.resolve();
    throwIfAborted(signal);
  }
  function get(projectId: string, documentId?: string): DocumentRead {
    requireProject(requireUuid(projectId));
    if (documentId !== undefined) requireUuid(documentId);
    const current = documents.get(projectId);
    if (!current || (documentId !== undefined && documentId !== current.id)) throw new ApiError("DOCUMENT_NOT_FOUND", { status: 404 });
    return current;
  }
  function append(document: DocumentRead, source: DocumentVersionRead["source"]) {
    const entry: DocumentVersionRead = {
      document_id: document.id,
      project_id: document.project_id,
      version: document.version,
      content: clone(document.content),
      source,
      created_at: document.updated_at,
    };
    const versions = history.get(document.id) ?? [];
    versions.push(entry);
    history.set(document.id, versions);
  }
  return {
    async import(projectId, input, signal) {
      const data = parseDocumentDto("DocumentImport", input, true);
      await before(signal);
      requireProject(requireUuid(projectId));
      if (documents.has(projectId)) throw new ApiError("DOCUMENT_ALREADY_EXISTS", { status: 409 });
      const now = new Date().toISOString();
      const document: DocumentRead = {
        id: crypto.randomUUID(),
        project_id: projectId,
        version: 1,
        content: clone(data.content),
        created_at: now,
        updated_at: now,
      };
      documents.set(projectId, document);
      append(document, "local_import");
      return clone(document);
    },
    async current(projectId, signal) {
      await before(signal);
      return clone(get(projectId));
    },
    async save(projectId, documentId, input, signal) {
      const data = parseDocumentDto("DocumentSave", input, true);
      await before(signal);
      const current = get(projectId, documentId);
      if (current.version !== data.expected_version || current.version >= Number.MAX_SAFE_INTEGER)
        throw new ApiError("DOCUMENT_VERSION_CONFLICT", { status: 409 });
      const saved: DocumentRead = { ...current, content: clone(data.content), version: current.version + 1, updated_at: new Date().toISOString() };
      documents.set(projectId, saved);
      append(saved, "manual_edit");
      return clone(saved);
    },
    async versions(projectId, documentId, query, signal) {
      await before(signal);
      get(projectId, documentId);
      const { limit, offset } = pageQuery(query);
      const all = [...history.get(documentId)!].reverse();
      const items = all.slice(offset, offset + limit).map(({ content: _content, ...summary }) => summary);
      return clone(parseDto("DocumentVersionPage", { items, total: all.length, limit, offset }));
    },
    async version(projectId, documentId, version, signal) {
      if (!Number.isSafeInteger(version) || version < 1) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      await before(signal);
      get(projectId, documentId);
      const result = history.get(documentId)!.find((item) => item.version === version);
      if (!result) throw new ApiError("DOCUMENT_VERSION_NOT_FOUND", { status: 404 });
      return clone(result);
    },
  };
}
