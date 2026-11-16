import {
  apiSchemas,
  type ApiTypes,
  type SchemaName,
  type InspectionInput,
  type InspectionConfiguration,
  type ConfigurationProbeScope,
  type ConfigurationProbeConfiguration,
  type JobRead,
  type JobCreate,
  type MaterialParseInput,
  type MaterialParseConfiguration,
  type DocumentSourceRead,
  type ContentRevisionInput,
  type DocumentExportInput,
  type ChangeRecordInput,
  type ExportConfiguration,
} from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { JobQuery, PageQuery } from "./types.ts";

interface Schema {
  readonly $ref?: string;
  readonly type?: string;
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | Schema;
  readonly items?: Schema;
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly anyOf?: readonly Schema[];
  readonly oneOf?: readonly Schema[];
  readonly format?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly exclusiveMaximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly pattern?: string;
  readonly propertyNames?: Schema;
  readonly minProperties?: number;
  readonly maxProperties?: number;
  readonly patternProperties?: Readonly<Record<string, Schema>>;
}

const schemas: Readonly<Record<string, Schema>> = apiSchemas;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function validDateParts(year: number, month: number, day: number): boolean {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
}

function isDateTime(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  return validDateParts(year, month, day);
}

function isDate(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return !!parts && validDateParts(Number(parts[1]), Number(parts[2]), Number(parts[3]));
}

function safeJson(value: unknown, depth = 0, maxDepth = 40): boolean {
  if (depth > maxDepth) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => safeJson(entry, depth + 1, maxDepth));
  return (
    record(value) &&
    Object.entries(value).every(([key, entry]) => !["__proto__", "constructor", "prototype"].includes(key) && safeJson(entry, depth + 1, maxDepth))
  );
}

function matches(schema: Schema, value: unknown, depth = 0, maxDepth = 40): boolean {
  if (depth > maxDepth) return false;
  if (schema.$ref) {
    const resolved = schemas[schema.$ref.replace("#/components/schemas/", "")];
    return !!resolved && matches(resolved, value, depth + 1, maxDepth);
  }
  if (schema.anyOf) return schema.anyOf.some((choice) => matches(choice, value, depth + 1, maxDepth));
  if (schema.oneOf) return schema.oneOf.filter((choice) => matches(choice, value, depth + 1, maxDepth)).length === 1;
  if ("const" in schema && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "null") return value === null;
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "integer" || schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isSafeInteger(value))) return false;
    return (
      (schema.minimum === undefined || value >= schema.minimum) &&
      (schema.maximum === undefined || value <= schema.maximum) &&
      (schema.exclusiveMinimum === undefined || value > schema.exclusiveMinimum) &&
      (schema.exclusiveMaximum === undefined || value < schema.exclusiveMaximum)
    );
  }
  if (schema.type === "string") {
    if (typeof value !== "string") return false;
    // JSON Schema/Pydantic count Unicode code points, not UTF-16 units or graphemes.
    const length = Array.from(value).length;
    return (
      (schema.minLength === undefined || length >= schema.minLength) &&
      (schema.maxLength === undefined || length <= schema.maxLength) &&
      (schema.pattern === undefined || new RegExp(schema.pattern).test(value)) &&
      (schema.format !== "uuid" || isUuid(value)) &&
      (schema.format !== "date-time" || isDateTime(value)) &&
      (schema.format !== "date" || isDate(value))
    );
  }
  if (schema.type === "array") {
    return (
      Array.isArray(value) &&
      !!schema.items &&
      (schema.minItems === undefined || value.length >= schema.minItems) &&
      (schema.maxItems === undefined || value.length <= schema.maxItems) &&
      value.every((item) => matches(schema.items!, item, depth + 1, maxDepth))
    );
  }
  if (schema.type === "object") {
    if (!record(value)) return false;
    const keys = Object.keys(value);
    if (
      (schema.minProperties !== undefined && keys.length < schema.minProperties) ||
      (schema.maxProperties !== undefined && keys.length > schema.maxProperties)
    )
      return false;
    if (schema.propertyNames && keys.some((key) => !matches({ type: "string", ...schema.propertyNames }, key, depth + 1, maxDepth))) return false;
    if (schema.required?.some((name) => !Object.hasOwn(value, name))) return false;
    for (const [name, entry] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(name)) return false;
      const property = schema.properties?.[name];
      if (property && !matches(property, entry, depth + 1, maxDepth)) return false;
      const patterns = Object.entries(schema.patternProperties ?? {}).filter(([pattern]) => new RegExp(pattern).test(name));
      if (patterns.some(([, constraint]) => !matches(constraint, entry, depth + 1, maxDepth))) return false;
      if (!property && !patterns.length && schema.additionalProperties === false) return false;
      if (!property && !patterns.length && record(schema.additionalProperties) && !matches(schema.additionalProperties, entry, depth + 1, maxDepth))
        return false;
    }
    return true;
  }
  return false;
}

export function isInspectionInput(value: JobRead["resource_scope"] | JobRead["input_snapshot"]): value is InspectionInput {
  return !!value && "document_id" in value && !("format" in value);
}
export function isDocumentExportInput(value: JobRead["resource_scope"] | JobRead["input_snapshot"]): value is DocumentExportInput {
  return !!value && "format" in value && "document_version" in value;
}
export function isChangeRecordInput(value: JobRead["resource_scope"] | JobRead["input_snapshot"]): value is ChangeRecordInput {
  return !!value && "format" in value && "from_version" in value;
}
export function isExportConfiguration(value: JobRead["configuration"]): value is ExportConfiguration {
  return !!value && "renderer_version" in value;
}
export function isProbeScope(value: JobRead["resource_scope"]): value is ConfigurationProbeScope {
  return !!value && "config_version_id" in value;
}
export function isProbeConfiguration(value: JobRead["configuration"]): value is ConfigurationProbeConfiguration {
  return !!value && "config_kind" in value;
}
export function isMaterialInput(value: JobRead["resource_scope"] | JobRead["input_snapshot"]): value is MaterialParseInput {
  return !!value && "material_id" in value;
}
export function isMaterialConfiguration(value: JobRead["configuration"]): value is MaterialParseConfiguration {
  return !!value && "parser_version" in value;
}
export function isInspectionConfiguration(value: JobRead["configuration"]): value is InspectionConfiguration {
  return !!value && !isProbeConfiguration(value) && !("parser_version" in value) && !("renderer_version" in value);
}
export function isContentRevisionInput(value: JobRead["resource_scope"] | JobRead["input_snapshot"]): value is ContentRevisionInput {
  return !!value && "run_id" in value;
}
export function parseJobInput(input: JobCreate): JobCreate {
  const data = parseDto("JobCreate", { kind: "diagnostic", ...input }, true);
  const invalid = () => {
    throw new ApiError("VALIDATION_ERROR", { status: 422 });
  };
  if (data.kind === "material_parse" || data.kind === "content_revision" || data.kind === "document_export" || data.kind === "change_record")
    throw new ApiError("JOB_KIND_UNAVAILABLE", { status: 422 });
  if (data.kind === "diagnostic" && (data.input_snapshot || data.configuration)) invalid();
  if (data.kind === "document_inspection" && !isInspectionInput(data.input_snapshot)) invalid();
  if (data.kind === "configuration_probe") {
    if (!data.input_snapshot || !("config_version_id" in data.input_snapshot) || data.configuration) invalid();
    probeVariables(data.input_snapshot && "variables" in data.input_snapshot ? (data.input_snapshot.variables ?? {}) : {}, true);
  }
  return data;
}
export function probeVariables(value: unknown, input = false): Record<string, string> {
  if (
    !record(value) ||
    Object.keys(value).length > 50 ||
    Object.entries(value).some(([key, item]) => !/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(key) || typeof item !== "string" || Array.from(item).length > 10000) ||
    Object.values(value).reduce<number>((sum, item) => sum + (typeof item === "string" ? Array.from(item).length : 0), 0) > 50000
  )
    throw new ApiError(input ? "VALIDATION_ERROR" : "INVALID_RESPONSE", input ? { status: 422 } : {});
  return value as Record<string, string>;
}

export function parseDto<Name extends SchemaName>(name: Name, value: unknown, input = false): ApiTypes[Name] {
  if (!safeJson(value) || !matches(schemas[name]!, value)) throw new ApiError(input ? "VALIDATION_ERROR" : "INVALID_RESPONSE", input ? { status: 422 } : {});
  return value as ApiTypes[Name];
}

/** Document transport has its own structural gate; ordinary DTO limits stay unchanged. */
export function parseDocumentEnvelope<Name extends "DocumentImport" | "DocumentSave" | "DocumentRead" | "DocumentVersionRead">(
  name: Name,
  value: unknown,
  input = false,
): ApiTypes[Name] {
  if (!safeJson(value, 0, 180) || !matches(schemas[name]!, value, 0, 1024))
    throw new ApiError(input ? "VALIDATION_ERROR" : "INVALID_RESPONSE", input ? { status: 422 } : {});
  return value as ApiTypes[Name];
}
/** Parsed material has its own byte/depth gate; small metadata DTOs remain bounded separately. */
export function parseMaterialEnvelope(value: unknown): ApiTypes["MaterialParseRead"] {
  if (!safeJson(value, 0, 180) || !matches(schemas.MaterialParseRead!, value, 0, 1024)) throw new ApiError("INVALID_RESPONSE");
  const data = value as ApiTypes["MaterialParseRead"];
  if (
    data.result.anchors.length > 20000 ||
    data.result.template_items.length > 20000 ||
    data.result.requirements.length > 20000 ||
    new TextEncoder().encode(data.result.plain_text).byteLength > 8 * 1024 * 1024 ||
    new TextEncoder().encode(JSON.stringify(data.result)).byteLength > 16 * 1024 * 1024
  )
    throw new ApiError("INVALID_RESPONSE");
  const pending: { value: unknown; depth: number }[] = data.result.editor_json ? [{ value: data.result.editor_json, depth: 0 }] : [];
  let nodes = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (++nodes > 100000 || node.depth > 80 || !record(node.value)) throw new ApiError("INVALID_RESPONSE");
    const content = node.value.content;
    if (Array.isArray(content)) for (const child of content) pending.push({ value: child, depth: node.depth + 1 });
  }
  return data;
}
export function validateSourceGuardContract(source: DocumentSourceRead) {
  const invalid = () => {
    throw new ApiError("INVALID_RESPONSE");
  };
  const contract = source.guard_contract;
  const version2 = source.guard_version === "source-projection-v2";
  if (
    !record(contract) ||
    (!version2 && source.guard_version !== "source-projection-v1") ||
    contract.schema_version !== (version2 ? 2 : 1) ||
    contract.guard_version !== source.guard_version ||
    contract.parser_version !== "thesispilot-material-1" ||
    contract.manifest_sha256 !== source.manifest_sha256 ||
    typeof contract.skeleton_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(contract.skeleton_sha256) ||
    Object.keys(contract).some(
      (key) =>
        ![
          "schema_version",
          "guard_version",
          "parser_version",
          "manifest_sha256",
          "skeleton_sha256",
          "editable_paths",
          "chapter_overrides",
          ...(version2 ? ["format_overrides"] : []),
        ].includes(key),
    )
  )
    return invalid();
  const paths = contract.editable_paths;
  const overlays = contract.chapter_overrides;
  const validPath = (path: unknown): path is number[] =>
    Array.isArray(path) && path.length >= 1 && path.length <= 80 && path.every((part) => Number.isSafeInteger(part) && part >= 0);
  if (!Array.isArray(paths) || paths.length > 20000 || paths.some((path) => !validPath(path)) || !Array.isArray(overlays) || overlays.length > 1000)
    return invalid();
  const pathIds = new Set(paths.map((path) => JSON.stringify(path)));
  if (pathIds.size !== paths.length) return invalid();
  const anchors = new Set<string>();
  const targets = new Set<string>();
  for (const overlay of overlays) {
    if (
      !record(overlay) ||
      typeof overlay.anchor_id !== "string" ||
      !overlay.anchor_id ||
      !validPath(overlay.editor_path) ||
      (overlay.original_type !== "paragraph" && overlay.original_type !== "heading") ||
      (overlay.target_type !== "paragraph" && overlay.target_type !== "heading") ||
      (overlay.original_attrs !== null && !record(overlay.original_attrs)) ||
      (overlay.target_attrs !== null && !record(overlay.target_attrs)) ||
      Object.keys(overlay).some((key) => !["anchor_id", "editor_path", "original_type", "original_attrs", "target_type", "target_attrs"].includes(key))
    )
      return invalid();
    const path = JSON.stringify(overlay.editor_path);
    if (!pathIds.has(path) || anchors.has(overlay.anchor_id) || targets.has(path)) return invalid();
    anchors.add(overlay.anchor_id);
    targets.add(path);
  }
  if (version2) {
    const formats = contract.format_overrides;
    if (!Array.isArray(formats) || formats.length > 20000) return invalid();
    const formatAnchors = new Set<string>();
    const formatPaths = new Set<string>();
    for (const overlay of formats) {
      if (
        !record(overlay) ||
        typeof overlay.anchor_id !== "string" ||
        !overlay.anchor_id ||
        !validPath(overlay.editor_path) ||
        (overlay.node_type !== "heading" && overlay.node_type !== "paragraph") ||
        (overlay.original_attrs !== null && !record(overlay.original_attrs)) ||
        (overlay.target_attrs !== null && !record(overlay.target_attrs)) ||
        Object.keys(overlay).some((key) => !["anchor_id", "editor_path", "node_type", "original_attrs", "target_attrs"].includes(key))
      )
        return invalid();
      const path = JSON.stringify(overlay.editor_path);
      if (!pathIds.has(path) || formatAnchors.has(overlay.anchor_id) || formatPaths.has(path)) return invalid();
      const original = overlay.original_attrs ?? {};
      const target = overlay.target_attrs ?? {};
      const allowed = overlay.node_type === "heading" ? ["level", "templateAlign", "templateWeight"] : ["alignment"];
      const fields = new Set([...Object.keys(original), ...Object.keys(target)]);
      for (const key of fields) if (!allowed.includes(key) && JSON.stringify(original[key]) !== JSON.stringify(target[key])) return invalid();
      if (
        overlay.node_type === "paragraph" &&
        Object.hasOwn(target, "alignment") &&
        ![null, "left", "center", "right", "justify"].includes(target.alignment as string | null)
      )
        return invalid();
      if (
        overlay.node_type === "heading" &&
        (!Number.isSafeInteger(target.level) ||
          Number(target.level) < 1 ||
          Number(target.level) > 6 ||
          ![null, "left", "center"].includes(target.templateAlign as string | null) ||
          ![null, "600", "700"].includes(target.templateWeight as string | null))
      )
        return invalid();
      formatAnchors.add(overlay.anchor_id);
      formatPaths.add(path);
    }
  }
}
/** Large source guards are isolated from the ordinary metadata schema budget. */
export function parseDocumentSourceEnvelope(value: unknown): DocumentSourceRead {
  if (!safeJson(value, 0, 180) || !matches(schemas.DocumentSourceRead!, value, 0, 1024)) throw new ApiError("INVALID_RESPONSE");
  const data = value as DocumentSourceRead;
  validateSourceGuardContract(data);
  return data;
}

export function requireUuid(value: string): string {
  if (!isUuid(value)) throw new ApiError("VALIDATION_ERROR", { status: 422 });
  return value;
}

export function pageQuery(query: PageQuery = {}): { limit: number; offset: number } {
  const { limit = 20, offset = 0 } = query;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0)
    throw new ApiError("VALIDATION_ERROR", { status: 422 });
  return { limit, offset };
}

export function requireIdempotencyKey(key: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key)) throw new ApiError("VALIDATION_ERROR", { status: 422 });
  return key;
}

export function jobStatuses(status: JobQuery["status"]): NonNullable<JobQuery["status"]> {
  if (status === undefined) return [];
  if (!Array.isArray(status) || status.some((value) => !["queued", "running", "succeeded", "failed", "cancelled"].includes(value)))
    throw new ApiError("VALIDATION_ERROR", { status: 422 });
  return [...new Set(status)];
}

export function jobKind(kind: JobQuery["kind"]): JobQuery["kind"] {
  if (
    kind !== undefined &&
    kind !== "diagnostic" &&
    kind !== "document_inspection" &&
    kind !== "configuration_probe" &&
    kind !== "material_parse" &&
    kind !== "content_revision" &&
    kind !== "document_export" &&
    kind !== "change_record"
  )
    throw new ApiError("VALIDATION_ERROR", { status: 422 });
  return kind;
}
