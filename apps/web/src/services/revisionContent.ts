import type { ApiTypes, SchemaName } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import { parseDto } from "./validation.ts";

export const REVISION_TRANSPORT_BYTES = 256 * 1024;
export type RevisionSchema = Extract<SchemaName, `Revision${string}`>;
export const revisionResponses = new Set<string>(["RevisionRead", "RevisionPage", "RevisionCommandRead"]);

function wellFormedStrings(value: unknown): boolean {
  if (typeof value === "string")
    return !Array.from(value).some((character) => {
      const code = character.codePointAt(0)!;
      return code >= 0xd800 && code <= 0xdfff;
    });
  if (Array.isArray(value)) return value.every(wellFormedStrings);
  if (value !== null && typeof value === "object") return Object.values(value).every(wellFormedStrings);
  return true;
}

export function parseRevisionDto<Name extends RevisionSchema>(name: Name, value: unknown, input = false): ApiTypes[Name] {
  const dto = parseDto(name, value, input);
  if (!wellFormedStrings(dto)) throw new ApiError(input ? "VALIDATION_ERROR" : "INVALID_RESPONSE", input ? { status: 422 } : {});
  if (new TextEncoder().encode(JSON.stringify(dto)).byteLength > REVISION_TRANSPORT_BYTES)
    throw new ApiError(input ? "REVISION_TOO_LARGE" : "INVALID_RESPONSE", input ? { status: 413 } : {});
  return dto;
}
