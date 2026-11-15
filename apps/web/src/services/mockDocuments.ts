import type { DocumentRead, DocumentVersionRead } from "./contracts/api.generated.ts";
import { parseDocumentDto } from "./documentContent.ts";
import { ApiError, throwIfAborted } from "./errors.ts";
import type { DocumentService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

export interface MockDocuments extends DocumentService {
  createSourceImport(projectId: string, content: DocumentRead["content"]): DocumentRead;
  sourceTransaction(hook: (document: DocumentRead, previous: DocumentRead | undefined) => { commit(): void; rollback(): void }): void;
  revisionCurrent(projectId: string, documentId: string): DocumentRead;
  revisionVersion(projectId: string, documentId: string, version: number): DocumentVersionRead;
  appendRevisionVersion(
    projectId: string,
    documentId: string,
    expectedVersion: number,
    content: DocumentRead["content"],
    source: Exclude<DocumentVersionRead["source"], "local_import" | "manual_edit" | "blank">,
  ): DocumentRead;
}

export function createMockDocuments(requireProject: (id: string) => unknown): MockDocuments {
  const documents = new Map<string, DocumentRead>();
  const history = new Map<string, DocumentVersionRead[]>();
  let sourceHook: ((document: DocumentRead, previous: DocumentRead | undefined) => { commit(): void; rollback(): void }) | undefined;
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
  function commit(document: DocumentRead, source: DocumentVersionRead["source"]) {
    const previous = documents.get(document.project_id);
    const previousHistory = history.get(document.id);
    const prepared = sourceHook?.(clone(document), previous ? clone(previous) : undefined);
    const entry: DocumentVersionRead = {
      document_id: document.id,
      project_id: document.project_id,
      version: document.version,
      content: clone(document.content),
      source,
      created_at: document.updated_at,
    };
    try {
      documents.set(document.project_id, document);
      history.set(document.id, [...(previousHistory ?? []), entry]);
      prepared?.commit();
      return clone(document);
    } catch (cause) {
      if (previous) documents.set(document.project_id, previous);
      else documents.delete(document.project_id);
      if (previousHistory) history.set(document.id, previousHistory);
      else history.delete(document.id);
      prepared?.rollback();
      throw cause;
    }
  }
  function readVersion(projectId: string, documentId: string, version: number): DocumentVersionRead {
    if (!Number.isSafeInteger(version) || version < 1) throw new ApiError("VALIDATION_ERROR", { status: 422 });
    get(projectId, documentId);
    const result = history.get(documentId)!.find((item) => item.version === version);
    if (!result) throw new ApiError("DOCUMENT_VERSION_NOT_FOUND", { status: 404 });
    return clone(result);
  }
  function update(projectId: string, documentId: string, expectedVersion: number, content: DocumentRead["content"], source: DocumentVersionRead["source"]) {
    const current = get(projectId, documentId);
    if (current.version !== expectedVersion || current.version >= Number.MAX_SAFE_INTEGER) throw new ApiError("DOCUMENT_VERSION_CONFLICT", { status: 409 });
    return commit({ ...current, content: clone(content), version: current.version + 1, updated_at: new Date().toISOString() }, source);
  }
  function create(projectId: string, content: DocumentRead["content"], source: "local_import" | "blank") {
    requireProject(requireUuid(projectId));
    if (documents.has(projectId)) throw new ApiError("DOCUMENT_ALREADY_EXISTS", { status: 409 });
    const now = new Date().toISOString();
    return commit({ id: crypto.randomUUID(), project_id: projectId, version: 1, content: clone(content), created_at: now, updated_at: now }, source);
  }
  return {
    createSourceImport(projectId, content) {
      return create(projectId, parseDocumentDto("DocumentImport", { content }, true).content, "local_import");
    },
    sourceTransaction(hook) {
      if (sourceHook) throw new Error("A source transaction hook is already registered");
      sourceHook = hook;
    },
    async import(projectId, input, signal) {
      const data = parseDocumentDto("DocumentImport", input, true);
      await before(signal);
      return create(projectId, data.content, "local_import");
    },
    async createBlank(projectId, signal) {
      await before(signal);
      return create(projectId, { schema_version: 1, json: { type: "doc", content: [{ type: "paragraph" }] } }, "blank");
    },
    async current(projectId, signal) {
      await before(signal);
      return clone(get(projectId));
    },
    async save(projectId, documentId, input, signal) {
      const data = parseDocumentDto("DocumentSave", input, true);
      await before(signal);
      return update(projectId, documentId, data.expected_version, data.content, "manual_edit");
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
      await before(signal);
      return readVersion(projectId, documentId, version);
    },
    revisionCurrent(projectId, documentId) {
      return clone(get(projectId, documentId));
    },
    revisionVersion: readVersion,
    appendRevisionVersion(projectId, documentId, expectedVersion, content, source) {
      const valid = parseDocumentDto("DocumentSave", { expected_version: expectedVersion, content }, true);
      return update(projectId, documentId, valid.expected_version, valid.content, source);
    },
  };
}
