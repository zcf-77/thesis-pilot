import type { DocumentRead, DocumentResourceRead, DocumentSchemaUpgradeRead, DocumentVersionRead } from "./contracts/api.generated.ts";
import { isDocsContent, parseDocumentDto, type DocumentContent } from "./documentContent.ts";
import { checkProtections, convertLegacyContent, normalizeSnapshot, sniffImage } from "./docsContent.ts";
import { ApiError, throwIfAborted } from "./errors.ts";
import type { DocumentService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

export interface MockDocuments extends DocumentService {
  createSourceImport(projectId: string, content: DocumentRead["content"]): DocumentRead;
  sourceTransaction(
    hook: (document: DocumentRead, previous: DocumentRead | undefined, source: DocumentVersionRead["source"]) => { commit(): void; rollback(): void },
  ): void;
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
  const upgrades = new Map<string, { documentId: string; expected: number; record: DocumentSchemaUpgradeRead["upgrade"] }>();
  const resources = new Map<string, { read: DocumentResourceRead; bytes: Uint8Array<ArrayBuffer> }>();
  let sourceHook:
    | ((document: DocumentRead, previous: DocumentRead | undefined, source: DocumentVersionRead["source"]) => { commit(): void; rollback(): void })
    | undefined;
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
    const prepared = sourceHook?.(clone(document), previous ? clone(previous) : undefined, source);
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
  /** 服务端 _reconcile_schema 的同契约规则：升级前只能按 v1 保存，升级后只能按 v2 保存。 */
  function reconcile(projectId: string, current: DocumentRead, content: DocumentContent, source: DocumentVersionRead["source"]): DocumentContent {
    const base = current.content;
    if (!isDocsContent(base) && isDocsContent(content)) {
      if (source !== "schema_upgrade") throw new ApiError("DOCMODEL_SCHEMA_MISMATCH", { status: 409 });
      return content;
    }
    if (isDocsContent(base) && !isDocsContent(content)) {
      if (source !== "version_revert") throw new ApiError("DOCMODEL_SCHEMA_MISMATCH", { status: 409 });
      return { schema_version: 2, json: convertLegacyContent(content.json, `${current.id}-v${current.version + 1}`) };
    }
    if (isDocsContent(base) && isDocsContent(content)) {
      const json = normalizeSnapshot(content.json);
      if (source === "manual_edit" || source === "ai_adoption") checkProtections(base.json, json, source === "manual_edit");
      requireResources(projectId, json);
      return { schema_version: 2, json };
    }
    return content;
  }
  function requireResources(projectId: string, json: Extract<DocumentContent, { schema_version: 2 }>["json"]) {
    for (const item of json.model.resources ?? []) {
      const digest = String(item.data.value).slice("tp-resource:".length);
      if (!resources.has(`${projectId}:${digest}`)) throw new ApiError("DOCMODEL_RESOURCE_MISSING", { status: 422 });
    }
  }
  function update(projectId: string, documentId: string, expectedVersion: number, content: DocumentRead["content"], source: DocumentVersionRead["source"]) {
    const current = get(projectId, documentId);
    if (current.version !== expectedVersion || current.version >= Number.MAX_SAFE_INTEGER) throw new ApiError("DOCUMENT_VERSION_CONFLICT", { status: 409 });
    const next = reconcile(projectId, current, content, source);
    return commit({ ...current, content: clone(next), version: current.version + 1, updated_at: new Date().toISOString() }, source);
  }
  function create(projectId: string, content: DocumentRead["content"], source: "local_import" | "blank") {
    requireProject(requireUuid(projectId));
    if (documents.has(projectId)) throw new ApiError("DOCUMENT_ALREADY_EXISTS", { status: 409 });
    if (isDocsContent(content)) {
      const json = normalizeSnapshot(content.json);
      checkProtections(null, json, true);
      requireResources(projectId, json);
      content = { schema_version: 2, json };
    }
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
    async versionAsV2(projectId, documentId, version, signal) {
      await before(signal);
      const stored = readVersion(projectId, documentId, version);
      if (isDocsContent(stored.content)) return { ...stored, converted: false };
      return { ...stored, content: { schema_version: 2, json: convertLegacyContent(stored.content.json, `${documentId}-v${version}`) }, converted: true };
    },
    async upgradeSchema(projectId, documentId, input, signal) {
      const data = parseDto("DocumentSchemaUpgradeCreate", input);
      await before(signal);
      const existing = upgrades.get(data.command_id);
      if (existing) {
        if (existing.documentId !== documentId || existing.expected !== data.expected_version) throw new ApiError("DOCUPGRADE_COMMAND_REUSED", { status: 409 });
        return { document: clone(get(projectId, documentId)), upgrade: clone(existing.record), replayed: true };
      }
      const current = get(projectId, documentId);
      if ([...upgrades.values()].some((item) => item.documentId === documentId) || isDocsContent(current.content))
        throw new ApiError("DOCUPGRADE_ALREADY_UPGRADED", { status: 409 });
      if (current.version !== data.expected_version) throw new ApiError("DOCUMENT_VERSION_CONFLICT", { status: 409 });
      const json = convertLegacyContent(current.content.json, `${documentId}-v${current.version + 1}`);
      const document = update(projectId, documentId, data.expected_version, { schema_version: 2, json }, "schema_upgrade");
      const record: DocumentSchemaUpgradeRead["upgrade"] = {
        id: crypto.randomUUID(),
        document_id: documentId,
        command_id: data.command_id,
        from_version: data.expected_version,
        to_version: document.version,
        from_schema_version: 1,
        to_schema_version: 2,
        converter_version: "mock-legacy-v1-to-docs-v2/1",
        converter_sha256: "0".repeat(64),
        loss_report: [],
        created_at: document.updated_at,
      };
      upgrades.set(data.command_id, { documentId, expected: data.expected_version, record });
      return { document, upgrade: clone(record), replayed: false };
    },
    async uploadResource(projectId, input, signal) {
      const data = parseDto("DocumentResourceUpload", input);
      await before(signal);
      requireProject(requireUuid(projectId));
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        bytes = Uint8Array.from(atob(data.content_base64), (character) => character.charCodeAt(0));
      } catch {
        throw new ApiError("DOCMODEL_RESOURCE_INVALID", { status: 422 });
      }
      if (bytes.byteLength > 10 * 1024 * 1024) throw new ApiError("DOCMODEL_RESOURCE_TOO_LARGE", { status: 413 });
      if (!bytes.byteLength || !sniffImage(bytes, data.mime)) throw new ApiError("DOCMODEL_RESOURCE_INVALID", { status: 422 });
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const key = `${projectId}:${digest}`;
      const existing = resources.get(key);
      if (existing) {
        if (existing.read.mime !== data.mime) throw new ApiError("DOCMODEL_RESOURCE_INVALID", { status: 422 });
        return clone(existing.read);
      }
      const read: DocumentResourceRead = {
        sha256: digest,
        uri: `tp-resource:${digest}`,
        mime: data.mime,
        byte_size: bytes.byteLength,
        width_px: null,
        height_px: null,
        created_at: new Date().toISOString(),
      };
      resources.set(key, { read, bytes });
      return clone(read);
    },
    async resource(projectId, sha256, signal) {
      await before(signal);
      requireProject(requireUuid(projectId));
      const stored = resources.get(`${projectId}:${sha256}`);
      if (!stored) throw new ApiError("DOCMODEL_RESOURCE_NOT_FOUND", { status: 404 });
      return new Blob([stored.bytes.slice()], { type: stored.read.mime });
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
