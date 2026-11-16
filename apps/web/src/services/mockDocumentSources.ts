import type {
  ChapterCorrection,
  DocumentRead,
  DocumentSourceImportReceipt,
  DocumentSourcePreviewRequest,
  DocumentSourceRead,
  MaterialRead,
  MaterialOriginalRead,
  MaterialParseRead,
} from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import { documentSourceInput } from "./httpDocumentSources.ts";
import { parseDocumentDto } from "./documentContent.ts";
import type { MockDocuments } from "./mockDocuments.ts";
import type { DocumentSourceService } from "./types.ts";
import { parseDto, requireUuid, validateSourceGuardContract } from "./validation.ts";

const clone = <T>(value: T): T => structuredClone(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (record(value))
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const hash = async (value: unknown) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value))))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
type Facts = { material: MaterialRead; original: MaterialOriginalRead; parse: MaterialParseRead };
type Pending = {
  projectId: string;
  info: Omit<DocumentSourceRead, "document_id" | "document_version">;
  content: DocumentRead["content"];
  paths: number[][];
  commandId?: string;
  receipt?: DocumentSourceImportReceipt;
};
export interface MockDocumentSources extends DocumentSourceService {
  mapping(projectId: string, documentId: string, version: number): DocumentSourceRead;
  appendFormat(
    projectId: string,
    documentId: string,
    expectedVersion: number,
    content: DocumentRead["content"],
    contract: DocumentSourceRead["guard_contract"],
    source: "ai_adoption" | "adoption_undo",
  ): DocumentRead;
}

function allowed(previous: unknown, candidate: unknown, paths: number[][]) {
  const before = clone(previous);
  const after = clone(candidate);
  function at(root: unknown, path: number[]) {
    let node = root;
    for (const index of path) {
      if (!record(node) || !Array.isArray(node.content)) throw new Error("invalid path");
      node = node.content[index];
    }
    if (!record(node)) throw new Error("invalid node");
    return node;
  }
  function shape(node: Record<string, unknown>) {
    if (!["paragraph", "heading"].includes(String(node.type))) throw new Error("invalid slot");
    const children = node.content ?? [];
    if (!Array.isArray(children) || children.length > 1 || children.some((child) => !record(child) || child.type !== "text"))
      throw new Error("invalid children");
    if (!children[0]) return { type: "text" };
    const { text: _text, ...rest } = children[0] as Record<string, unknown>;
    return rest;
  }
  try {
    for (const path of paths) {
      const first = at(before, path);
      const next = at(after, path);
      if (stable(shape(first)) !== stable(shape(next))) return false;
      if (first.content) next.content = clone(first.content);
      else delete next.content;
    }
    return stable(before) === stable(after);
  } catch {
    return false;
  }
}
export function createMockDocumentSources(
  before: (signal?: AbortSignal) => Promise<void>,
  requireProject: (id: string) => unknown,
  documents: MockDocuments,
  factsFor: (projectId: string, materialId: string, originalId: string, parseId: string) => Facts,
): MockDocumentSources {
  const roots = new Map<string, Pending>();
  const mappings = new Map<string, DocumentSourceRead>();
  const commands = new Map<string, { fingerprint: string; promise: Promise<DocumentSourceImportReceipt> }>();
  let pending: Pending | undefined;
  let formatTransition: { documentId: string; expectedVersion: number; descriptor: Pending } | undefined;
  documents.sourceTransaction((document, previous, source) => {
    let transition = formatTransition?.documentId === document.id && previous?.version === formatTransition.expectedVersion ? formatTransition : undefined;
    if (!transition && previous && source === "version_revert") {
      const priorRoot = roots.get(document.id);
      if (priorRoot)
        for (const mapping of [...mappings.values()].reverse()) {
          if (mapping.document_id !== document.id) continue;
          const historical = documents.revisionVersion(document.project_id, document.id, mapping.document_version);
          if (stable(historical.content) === stable(document.content)) {
            const { document_id: _id, document_version: _version, ...info } = mapping;
            transition = { documentId: document.id, expectedVersion: previous.version, descriptor: { ...priorRoot, info: clone(info) } };
            break;
          }
        }
    }
    const descriptor = transition?.descriptor ?? roots.get(document.id) ?? (pending?.projectId === document.project_id ? pending : undefined);
    if (!descriptor) return { commit() {}, rollback() {} };
    if (previous && !transition && !allowed(previous.content.json, document.content.json, descriptor.paths))
      throw new ApiError("DOCUMENT_SOURCE_PROTECTED", { status: 409 });
    const info = parseDto("DocumentSourceRead", { ...clone(descriptor.info), document_id: document.id, document_version: document.version });
    validateSourceGuardContract(info);
    const key = `${document.id}:${document.version}`;
    const oldRoot = roots.get(document.id);
    const oldMapping = mappings.get(key);
    const oldReceipt = descriptor.receipt;
    const receipt =
      !previous && descriptor.commandId
        ? parseDto("DocumentSourceImportReceipt", {
            command_id: descriptor.commandId,
            document_id: document.id,
            document_version: 1,
            source_id: info.source_id,
            material_id: info.material_id,
            original_version_id: info.original_version_id,
            parse_version_id: info.parse_version_id,
          })
        : undefined;
    return {
      commit() {
        roots.set(document.id, descriptor);
        mappings.set(key, clone(info));
        if (receipt) descriptor.receipt = receipt;
      },
      rollback() {
        if (oldRoot) roots.set(document.id, oldRoot);
        else roots.delete(document.id);
        if (oldMapping) mappings.set(key, oldMapping);
        else mappings.delete(key);
        descriptor.receipt = oldReceipt;
      },
    };
  });
  function facts(projectId: string, input: DocumentSourcePreviewRequest): Facts {
    requireProject(requireUuid(projectId));
    const data = factsFor(projectId.toLowerCase(), input.material_id, input.original_version_id, input.parse_version_id);
    if (!data.material.linked || data.material.removed || data.original.file_type !== "text") throw new ApiError("DOCUMENT_SOURCE_INVALID", { status: 422 });
    return data;
  }
  async function currentDocument(projectId: string) {
    try {
      return await documents.current(projectId.toLowerCase());
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "DOCUMENT_NOT_FOUND") return undefined;
      throw cause;
    }
  }
  async function projection(projectId: string, input: DocumentSourcePreviewRequest, corrections: ChapterCorrection[] = []): Promise<Pending> {
    const data = facts(projectId, input);
    const text = data.parse.result.plain_text;
    const plain = { type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) };
    const base = { type: "doc", content: [plain] };
    const paths = [[0]];
    const manifest = {
      simulation: "mock-text-projection",
      material_id: data.material.id,
      original_version_id: data.original.id,
      parse_version_id: data.parse.id,
      original_sha256: data.original.sha256,
      editable_paths: paths,
    };
    const manifestHash = await hash(manifest);
    const skeletonHash = await hash({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] });
    const overlays: Record<string, unknown>[] = [];
    let node: Record<string, unknown> = plain;
    for (const correction of corrections) {
      if (correction.anchor_id !== "mock-text-1") throw new ApiError("DOCUMENT_SOURCE_CHAPTER_INVALID", { status: 422 });
      const attrs =
        correction.kind === "heading"
          ? { level: correction.level, chapterId: `chapter-${(await hash(correction.anchor_id)).slice(0, 32)}`, templateAlign: null, templateWeight: null }
          : null;
      overlays.push({
        anchor_id: correction.anchor_id,
        editor_path: [0],
        original_type: "paragraph",
        original_attrs: null,
        target_type: correction.kind,
        target_attrs: attrs,
      });
      node = { ...plain, type: correction.kind, ...(attrs ? { attrs } : {}) };
    }
    const content = parseDocumentDto("DocumentImport", { content: { schema_version: 1, json: { ...base, content: [node] } } }, true).content;
    const checked = parseDto("DocumentSourceRead", {
      document_id: crypto.randomUUID(),
      document_version: 1,
      source_id: crypto.randomUUID(),
      material_id: data.material.id,
      original_version_id: data.original.id,
      parse_version_id: data.parse.id,
      original_sha256: data.original.sha256,
      manifest_sha256: manifestHash,
      filename: data.original.filename,
      file_type: "text",
      guard_version: "source-projection-v1",
      guard_contract: {
        schema_version: 1,
        guard_version: "source-projection-v1",
        parser_version: "thesispilot-material-1",
        manifest_sha256: manifestHash,
        skeleton_sha256: skeletonHash,
        editable_paths: paths,
        chapter_overrides: overlays,
      },
      imported_at: new Date().toISOString(),
    });
    validateSourceGuardContract(checked);
    const { document_id: _document, document_version: _version, ...info } = checked;
    return { projectId: projectId.toLowerCase(), content, paths, info };
  }
  function read(projectId: string, documentId: string, version: number) {
    requireProject(requireUuid(projectId));
    requireUuid(documentId);
    if (!Number.isSafeInteger(version) || version < 1) throw new ApiError("VALIDATION_ERROR", { status: 422 });
    documents.revisionVersion(projectId.toLowerCase(), documentId.toLowerCase(), version);
    if (!roots.has(documentId.toLowerCase())) throw new ApiError("DOCUMENT_SOURCE_NOT_FOUND", { status: 404 });
    const info = mappings.get(`${documentId.toLowerCase()}:${version}`);
    if (!info) throw new ApiError("DOCUMENT_SOURCE_MAPPING_MISSING", { status: 409 });
    return clone(info);
  }
  return {
    mapping: read,
    appendFormat(projectId, documentId, expectedVersion, content, contract, source) {
      const current = documents.revisionCurrent(projectId, documentId);
      if (current.version !== expectedVersion) throw new ApiError("DOCUMENT_VERSION_CONFLICT", { status: 409 });
      const previous = roots.get(documentId);
      if (!previous) throw new ApiError("FORMAT_SOURCE_REQUIRED", { status: 422 });
      function withoutFormat(value: unknown): unknown {
        if (Array.isArray(value)) return value.map(withoutFormat);
        if (!record(value)) return value;
        const result = { ...value };
        if ((value.type === "heading" || value.type === "paragraph") && record(value.attrs)) {
          const attrs = { ...value.attrs };
          for (const field of value.type === "heading" ? ["level", "templateAlign", "templateWeight"] : ["alignment"]) delete attrs[field];
          if (Object.keys(attrs).length) result.attrs = attrs;
          else delete result.attrs;
        }
        if (Array.isArray(value.content)) result.content = value.content.map(withoutFormat);
        return result;
      }
      if (stable(withoutFormat(current.content.json)) !== stable(withoutFormat(content.json))) throw new ApiError("DOCUMENT_SOURCE_PROTECTED", { status: 409 });
      const fixed = (value: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(value).filter(([key]) => !["schema_version", "guard_version", "format_overrides"].includes(key)));
      if (stable(fixed(previous.info.guard_contract)) !== stable(fixed(contract))) throw new ApiError("DOCUMENT_SOURCE_PROTECTED", { status: 409 });
      const targetInfo = { ...clone(previous.info), guard_version: contract.guard_version as string, guard_contract: clone(contract) };
      validateSourceGuardContract({ ...targetInfo, document_id: documentId, document_version: expectedVersion });
      const descriptor = { ...previous, info: targetInfo };
      formatTransition = { documentId, expectedVersion, descriptor };
      try {
        return documents.appendRevisionVersion(projectId, documentId, expectedVersion, content, source);
      } finally {
        formatTransition = undefined;
      }
    },
    async preview(projectId, input, signal) {
      await before(signal);
      const data = documentSourceInput("DocumentSourcePreviewRequest", input);
      const source = await projection(projectId, data);
      const document = await currentDocument(projectId);
      await before(signal);
      return parseDto("DocumentSourcePreview", {
        project_id: projectId.toLowerCase(),
        material_id: source.info.material_id,
        original_version_id: source.info.original_version_id,
        parse_version_id: source.info.parse_version_id,
        filename: source.info.filename,
        file_type: "text",
        original_sha256: source.info.original_sha256,
        manifest_sha256: source.info.manifest_sha256,
        parser_version: "thesispilot-material-1",
        status: "partial",
        can_import: !document,
        existing_document_id: document?.id ?? null,
        chapters: [
          {
            anchor_id: "mock-text-1",
            editor_path: [0],
            title: facts(projectId, data).parse.result.plain_text.slice(0, 120),
            kind: "paragraph",
            level: null,
            editable: true,
            allowed_kinds: ["paragraph", "heading"],
          },
        ],
        chapters_truncated: false,
        diagnostics: ["本地模拟文本导入与保护映射；未执行真实DOCX导入。"],
      });
    },
    async import(projectId, input, signal) {
      await before(signal);
      const data = documentSourceInput("DocumentSourceImport", input);
      const key = data.command_id.toLowerCase();
      const fingerprint = stable([projectId.toLowerCase(), data]);
      const previous = commands.get(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ApiError("DOCUMENT_SOURCE_COMMAND_CONFLICT", { status: 409 });
        return clone(await previous.promise);
      }
      const promise = (async () => {
        const descriptor = await projection(projectId, data, data.chapter_corrections ?? []);
        descriptor.commandId = data.command_id;
        await before(signal);
        facts(projectId, data);
        pending = descriptor;
        try {
          documents.createSourceImport(projectId.toLowerCase(), descriptor.content);
          return descriptor.receipt!;
        } finally {
          pending = undefined;
        }
      })();
      commands.set(key, { fingerprint, promise });
      try {
        return clone(await promise);
      } catch (cause) {
        commands.delete(key);
        throw cause;
      }
    },
    async current(projectId, documentId, expectedVersion, signal) {
      await before(signal);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const current = documents.revisionCurrent(projectId.toLowerCase(), documentId.toLowerCase());
      if (current.version !== expectedVersion) throw new ApiError("DOCUMENT_VERSION_CONFLICT", { status: 409 });
      return read(projectId, documentId, expectedVersion);
    },
    async version(projectId, documentId, version, signal) {
      await before(signal);
      return read(projectId, documentId, version);
    },
  };
}
