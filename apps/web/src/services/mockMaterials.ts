import type {
  JobRead,
  MaterialOriginalRead,
  MaterialParseInput,
  MaterialParseRead,
  MaterialParseResult,
  MaterialRead,
  MaterialUploadReceipt,
  ProjectSourceBindingRead,
  ProjectSourceBindingVersionRead,
} from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import { materialBytes, materialUploadInput } from "./httpMaterials.ts";
import type { MaterialService } from "./types.ts";
import { pageQuery, parseDto, requireIdempotencyKey, requireUuid } from "./validation.ts";

const clone = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
const sha = async (bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
export function createMockMaterials(
  before: (signal?: AbortSignal) => Promise<void>,
  requireProject: (id: string) => unknown,
  enqueue: (projectId: string, input: MaterialParseInput, fileType: MaterialOriginalRead["file_type"]) => JobRead,
) {
  const materials = new Map<string, MaterialRead>();
  const originals = new Map<string, { info: MaterialOriginalRead; bytes: Uint8Array<ArrayBuffer>; text?: string; textHash?: string }>();
  const parsed = new Map<string, MaterialParseRead>();
  const bindings = new Map<string, ProjectSourceBindingRead>();
  const bindingHistory = new Map<string, ProjectSourceBindingVersionRead[]>();
  const uploads = new Map<string, { fingerprint: string; receipt: MaterialUploadReceipt }>();
  const parseRequests = new Map<string, { fingerprint: string; job: JobRead }>();
  function material(projectId: string, id: string) {
    requireProject(requireUuid(projectId));
    const value = materials.get(requireUuid(id).toLowerCase());
    if (!value || value.project_id !== projectId.toLowerCase()) throw new ApiError("MATERIAL_NOT_FOUND", { status: 404 });
    return value;
  }
  function original(projectId: string, materialId: string, id: string) {
    const root = material(projectId, materialId);
    const value = originals.get(requireUuid(id).toLowerCase());
    if (!value || value.info.material_id !== root.id) throw new ApiError("MATERIAL_ORIGINAL_NOT_FOUND", { status: 404 });
    return value;
  }
  function source(projectId: string): ProjectSourceBindingRead {
    requireProject(requireUuid(projectId));
    return (
      bindings.get(projectId.toLowerCase()) ?? {
        project_id: projectId.toLowerCase(),
        version: 0,
        current_version_id: null,
        template_parse_version_id: null,
        requirement_parse_version_ids: [],
        updated_at: null,
      }
    );
  }
  function page<T>(items: T[], query?: { limit?: number; offset?: number }) {
    const { limit, offset } = pageQuery(query);
    return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
  }
  function parseInput(info: MaterialOriginalRead): MaterialParseInput {
    return {
      schema_version: 1,
      material_id: info.material_id,
      original_version_id: info.id,
      original_sha256: info.sha256,
      expected_parse_id: info.latest_parse_id,
    };
  }
  function replay(key: string, fingerprint: string) {
    const previous = uploads.get(key);
    if (previous && previous.fingerprint !== fingerprint) throw new ApiError("MATERIAL_UPLOAD_KEY_CONFLICT", { status: 409 });
    return (
      previous &&
      clone({
        ...previous.receipt,
        material: materials.get(previous.receipt.material.id) ?? previous.receipt.material,
        original: originals.get(previous.receipt.original.id)?.info ?? previous.receipt.original,
      })
    );
  }
  async function upload(
    projectId: string,
    materialId: string | undefined,
    input: Parameters<MaterialService["upload"]>[1] | Parameters<MaterialService["appendOriginal"]>[2],
    key: string,
    signal?: AbortSignal,
  ): Promise<MaterialUploadReceipt> {
    await before(signal);
    requireProject(requireUuid(projectId));
    requireIdempotencyKey(key);
    const data = materialId
      ? materialUploadInput("MaterialOriginalCreate", input as Parameters<MaterialService["appendOriginal"]>[2])
      : materialUploadInput("MaterialUpload", input);
    const fingerprint = JSON.stringify([projectId.toLowerCase(), materialId?.toLowerCase(), data]);
    const scope = `${projectId.toLowerCase()}:${key}`;
    const existing = replay(scope, fingerprint);
    if (existing) return existing;
    const bytes = materialBytes(data.content_base64);
    const digest = await sha(bytes);
    let text: string | undefined;
    let textHash: string | undefined;
    if (data.file_type === "text") {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        textHash = await sha(new TextEncoder().encode(text));
      } catch {
        text = undefined;
      }
    }
    await before(signal);
    const raced = replay(scope, fingerprint);
    if (raced) return raced;
    const previous = materialId ? material(projectId, materialId) : undefined;
    if (previous && (!("expected_version" in data) || previous.version !== data.expected_version))
      throw new ApiError("MATERIAL_VERSION_CONFLICT", { status: 409 });
    const timestamp = now();
    const id = previous?.id ?? crypto.randomUUID();
    const originalId = crypto.randomUUID();
    const next: MaterialRead = {
      id,
      project_id: projectId.toLowerCase(),
      name: data.name,
      kind: data.kind,
      source_note: data.source_note ?? "",
      version: (previous?.version ?? 0) + 1,
      linked: previous?.linked ?? true,
      removed: previous?.removed ?? false,
      current_original_id: originalId,
      created_at: previous?.created_at ?? timestamp,
      updated_at: timestamp,
    };
    const info: MaterialOriginalRead = {
      id: originalId,
      material_id: id,
      version: [...originals.values()].filter((value) => value.info.material_id === id).length + 1,
      filename: data.filename,
      file_type: data.file_type,
      sha256: digest,
      byte_size: bytes.byteLength,
      latest_parse_id: null,
      initial_job_id: null,
      created_at: timestamp,
    };
    parseDto("MaterialRead", next);
    parseDto("MaterialOriginalRead", info);
    const job = enqueue(projectId, parseInput(info), info.file_type);
    info.initial_job_id = job.id;
    materials.set(id, next);
    originals.set(originalId, { info, bytes, text, textHash });
    const receipt = parseDto("MaterialUploadReceipt", { material: next, original: info, job });
    uploads.set(scope, { fingerprint, receipt: clone(receipt) });
    return clone(receipt);
  }
  function validateBinding(projectId: string, id: string, kind: "template" | "requirements") {
    const entry = parsed.get(requireUuid(id).toLowerCase());
    const raw = entry && originals.get(entry.original_version_id);
    const root = raw && materials.get(raw.info.material_id);
    if (
      !entry ||
      !root ||
      root.project_id !== projectId.toLowerCase() ||
      root.removed ||
      !root.linked ||
      (kind === "template" ? root.kind !== "template" : !["template", "requirements"].includes(root.kind) || !entry.result.requirements.length)
    )
      throw new ApiError("MATERIAL_BINDING_INVALID", { status: 422 });
  }
  const service: MaterialService = {
    async list(projectId, query = {}, signal) {
      await before(signal);
      requireProject(requireUuid(projectId));
      if (query.kind && !["template", "requirements", "literature", "other"].includes(query.kind)) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const ordered = [...materials.values()]
        .filter((item) => item.project_id === projectId.toLowerCase() && (query.include_removed || !item.removed) && (!query.kind || item.kind === query.kind))
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      return clone(parseDto("MaterialPage", page(ordered, query)));
    },
    upload(projectId, input, key, signal) {
      return upload(projectId, undefined, input, key, signal);
    },
    async get(projectId, materialId, signal) {
      await before(signal);
      return clone(material(projectId, materialId));
    },
    async update(projectId, materialId, input, signal) {
      await before(signal);
      const data = parseDto("MaterialUpdate", { ...input, ...(typeof input.name === "string" ? { name: input.name.trim() } : {}) }, true);
      if (Object.keys(data).length <= 1 || Object.values(data).some((value) => value === null)) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const previous = material(projectId, materialId);
      if (previous.version !== data.expected_version) throw new ApiError("MATERIAL_VERSION_CONFLICT", { status: 409 });
      const { expected_version: _expected, ...changes } = data;
      const next = parseDto("MaterialRead", { ...previous, ...changes, version: previous.version + 1, updated_at: now() });
      materials.set(previous.id, next);
      return clone(next);
    },
    appendOriginal(projectId, materialId, input, key, signal) {
      return upload(projectId, materialId, input, key, signal);
    },
    async originals(projectId, materialId, query, signal) {
      await before(signal);
      const root = material(projectId, materialId);
      return clone(
        parseDto(
          "MaterialOriginalPage",
          page(
            [...originals.values()]
              .filter((item) => item.info.material_id === root.id)
              .map((item) => item.info)
              .sort((a, b) => b.version - a.version),
            query,
          ),
        ),
      );
    },
    async original(projectId, materialId, originalId, signal) {
      await before(signal);
      return clone(original(projectId, materialId, originalId).info);
    },
    async download(projectId, materialId, originalId, signal) {
      await before(signal);
      return new Blob([original(projectId, materialId, originalId).bytes.slice().buffer], { type: "application/octet-stream" });
    },
    async parses(projectId, materialId, originalId, query, signal) {
      await before(signal);
      const raw = original(projectId, materialId, originalId);
      const ordered = [...parsed.values()]
        .filter((item) => item.original_version_id === raw.info.id)
        .sort((a, b) => b.version - a.version)
        .map(({ result, ...item }) => ({ ...item, status: result.status }));
      return clone(parseDto("MaterialParseSummaryPage", page(ordered, query)));
    },
    async parse(projectId, materialId, originalId, parseId, signal) {
      await before(signal);
      original(projectId, materialId, originalId);
      const value = parsed.get(requireUuid(parseId).toLowerCase());
      if (!value || value.original_version_id !== originalId.toLowerCase()) throw new ApiError("MATERIAL_PARSE_NOT_FOUND", { status: 404 });
      return clone(value);
    },
    async reparse(projectId, materialId, originalId, input, key, signal) {
      await before(signal);
      requireIdempotencyKey(key);
      const data = parseDto("MaterialReparse", input, true);
      const scope = `${projectId.toLowerCase()}:${key}`;
      const fingerprint = JSON.stringify([materialId.toLowerCase(), originalId.toLowerCase(), data]);
      const previous = parseRequests.get(scope);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ApiError("MATERIAL_UPLOAD_KEY_CONFLICT", { status: 409 });
        return clone(previous.job);
      }
      const raw = original(projectId, materialId, originalId);
      if (data.expected_parse_id !== raw.info.latest_parse_id) throw new ApiError("MATERIAL_PARSE_CONFLICT", { status: 409 });
      const job = enqueue(projectId, parseInput(raw.info), raw.info.file_type);
      parseRequests.set(scope, { fingerprint, job: clone(job) });
      return clone(job);
    },
    async sourceBinding(projectId, signal) {
      await before(signal);
      return clone(source(projectId));
    },
    async updateSourceBinding(projectId, input, signal) {
      await before(signal);
      const data = parseDto("ProjectSourceBindingUpdate", input, true);
      const previous = source(projectId);
      if (previous.version !== data.expected_version) throw new ApiError("MATERIAL_BINDING_CONFLICT", { status: 409 });
      if (new Set(data.requirement_parse_version_ids).size !== data.requirement_parse_version_ids.length)
        throw new ApiError("VALIDATION_ERROR", { status: 422 });
      if (data.template_parse_version_id) validateBinding(projectId, data.template_parse_version_id, "template");
      data.requirement_parse_version_ids.forEach((id) => validateBinding(projectId, id, "requirements"));
      const timestamp = now();
      const snapshot: ProjectSourceBindingVersionRead = {
        id: crypto.randomUUID(),
        project_id: projectId.toLowerCase(),
        version: previous.version + 1,
        template_parse_version_id: data.template_parse_version_id,
        requirement_parse_version_ids: clone(data.requirement_parse_version_ids),
        created_at: timestamp,
      };
      const next = parseDto("ProjectSourceBindingRead", {
        project_id: snapshot.project_id,
        version: snapshot.version,
        current_version_id: snapshot.id,
        template_parse_version_id: snapshot.template_parse_version_id,
        requirement_parse_version_ids: snapshot.requirement_parse_version_ids,
        updated_at: timestamp,
      });
      bindings.set(snapshot.project_id, next);
      bindingHistory.set(snapshot.project_id, [...(bindingHistory.get(snapshot.project_id) ?? []), snapshot]);
      return clone(next);
    },
    async sourceBindingVersions(projectId, query, signal) {
      await before(signal);
      source(projectId);
      return clone(
        parseDto(
          "ProjectSourceBindingVersionPage",
          page(
            [...(bindingHistory.get(projectId.toLowerCase()) ?? [])].sort((a, b) => b.version - a.version),
            query,
          ),
        ),
      );
    },
    async sourceBindingVersion(projectId, version, signal) {
      await before(signal);
      source(projectId);
      if (!Number.isSafeInteger(version) || version < 1) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const value = bindingHistory.get(projectId.toLowerCase())?.find((item) => item.version === version);
      if (!value) throw new ApiError("MATERIAL_BINDING_NOT_FOUND", { status: 404 });
      return clone(value);
    },
  };
  function completeParse(projectId: string, input: MaterialParseInput, jobId: string): MaterialParseResult {
    const raw = original(projectId, input.material_id, input.original_version_id);
    if (raw.info.sha256 !== input.original_sha256) throw new ApiError("MATERIAL_ORIGINAL_CORRUPT");
    if (raw.info.latest_parse_id !== input.expected_parse_id) throw new ApiError("MATERIAL_PARSE_CONFLICT");
    if (raw.info.file_type !== "text") throw new ApiError("MATERIAL_UNSUPPORTED_TYPE");
    if (raw.text === undefined || !raw.textHash) throw new ApiError("MATERIAL_PARSE_INVALID");
    const version = [...parsed.values()].filter((item) => item.original_version_id === raw.info.id).length + 1;
    const result: MaterialParseRead = parseDto("MaterialParseRead", {
      id: crypto.randomUUID(),
      original_version_id: raw.info.id,
      version,
      source_job_id: jobId,
      created_at: now(),
      result: {
        schema_version: 1,
        parser_version: "thesispilot-material-1",
        status: "partial",
        plain_text: raw.text,
        anchors: [
          {
            id: "mock-text-1",
            original_version_id: raw.info.id,
            kind: "mock_text",
            part: "text",
            line: 1,
            original_text: raw.text,
            sha256: raw.textHash,
            editable: false,
          },
        ],
        editor_json: null,
        roundtrip_manifest: null,
        template_items: [],
        requirements: raw.text.trim()
          ? [
              {
                id: "mock-requirement-1",
                original_text: raw.text,
                anchor_ids: ["mock-text-1"],
                scope: "document",
                rule_type: "semantic",
                kind: "semantic",
                parameters: {},
                strictness: "unknown",
                enabled: true,
                checkable: false,
                uncertainty: "本地模拟，仅保留原句，未确认硬规则。",
              },
            ]
          : [],
        diagnostics: ["本地模拟文本解析；未解析DOCX/PDF，不代表真实解析器验收。"],
      },
    });
    if (new TextEncoder().encode(JSON.stringify(result.result)).byteLength > 16 * 1024 * 1024) throw new ApiError("MATERIAL_PARSE_LIMIT_EXCEEDED");
    const summary = parseDto("MaterialParseResult", {
      kind: "material_parse",
      schema_version: 1,
      job_id: jobId,
      project_id: projectId,
      material_id: input.material_id,
      original_version_id: input.original_version_id,
      original_sha256: input.original_sha256,
      parser_version: "thesispilot-material-1",
      parse_version_id: result.id,
      anchor_count: 1,
      text_characters: Array.from(raw.text).length,
      model_used: false,
      writes_performed: false,
    });
    parsed.set(result.id, result);
    raw.info.latest_parse_id = result.id;
    return summary;
  }
  function sourceData(projectId: string, materialId: string, originalId: string, parseId: string) {
    const root = material(projectId, materialId);
    const raw = original(projectId, materialId, originalId);
    const version = parsed.get(requireUuid(parseId).toLowerCase());
    if (!version || version.original_version_id !== raw.info.id) throw new ApiError("MATERIAL_PARSE_NOT_FOUND", { status: 404 });
    return clone({ material: root, original: raw.info, parse: version });
  }
  return { service, completeParse, sourceData };
}
