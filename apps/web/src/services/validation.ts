import { apiSchemas, type ApiTypes, type SchemaName } from "./contracts/api.generated.ts";
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
    if (schema.required?.some((name) => !Object.hasOwn(value, name))) return false;
    for (const [name, entry] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(name)) return false;
      const property = schema.properties?.[name];
      if (property && !matches(property, entry, depth + 1, maxDepth)) return false;
      if (!property && schema.additionalProperties === false) return false;
      if (!property && record(schema.additionalProperties) && !matches(schema.additionalProperties, entry, depth + 1, maxDepth)) return false;
    }
    return true;
  }
  return false;
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
  if (kind !== undefined && kind !== "diagnostic" && kind !== "document_inspection") throw new ApiError("VALIDATION_ERROR", { status: 422 });
  return kind;
}
