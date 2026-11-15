import type { ApiTypes, SchemaName, RevisionRead } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import { parseDto, isUuid } from "./validation.ts";

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
  const validateOrigin = (candidate: RevisionRead) => {
    const invalid = () => {
      throw new ApiError("INVALID_RESPONSE");
    };
    const producer = candidate.producer ?? "deterministic_preview";
    if (producer === "model_run") {
      if (
        !isUuid(candidate.run_id) ||
        candidate.applicable ||
        candidate.adoption_blocked_reason !== "REVISION_ADOPTION_NOT_APPROVED" ||
        candidate.generation_token !== null
      )
        invalid();
    } else if (candidate.run_id != null || candidate.adoption_blocked_reason != null) invalid();
    if (candidate.status === "failed") {
      if (
        typeof candidate.generation_error_code !== "string" ||
        ![
          "MODEL_NOT_CONFIGURED",
          "MODEL_AUTH_FAILED",
          "MODEL_RATE_LIMITED",
          "MODEL_TIMEOUT",
          "MODEL_UNAVAILABLE",
          "MODEL_INVALID_RESPONSE",
          "MODEL_OUTPUT_TOO_LARGE",
          "MODEL_RETRY_LIMIT_REACHED",
          "MODEL_CONTEXT_LIMIT_EXCEEDED",
          "JOB_EXECUTION_FAILED",
          "JOB_EXECUTION_TIMEOUT",
          "JOB_ATTEMPTS_EXHAUSTED",
          "JOB_INPUT_INVALID",
          "JOB_RESULT_INVALID",
        ].includes(candidate.generation_error_code)
      )
        invalid();
    } else if (candidate.generation_error_code != null) invalid();
  };
  if (!input && name === "RevisionRead") validateOrigin(dto as RevisionRead);
  return dto;
}
