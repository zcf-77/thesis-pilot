import type { AIConfigRead, ApiTypes, SchemaName } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { AIConfigQuery, AIConfigService, PageQuery } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

type Request = <Name extends SchemaName>(path: string, schema: Name, method?: string, body?: unknown, signal?: AbortSignal) => Promise<ApiTypes[Name]>;
const sameId = (actual: string, expected: string) => actual.toLowerCase() === expected.toLowerCase();
export function configKind(kind: AIConfigQuery["kind"]) {
  if (kind !== undefined && !["api", "model", "prompt", "agent"].includes(kind)) throw new ApiError("VALIDATION_ERROR", { status: 422 });
  return kind;
}
export function configInput<Name extends "AIConfigCreate" | "AIConfigUpdate" | "AIConfigCopy">(name: Name, input: ApiTypes[Name]): ApiTypes[Name] {
  const content = "content" in input && input.content ? input.content : undefined;
  const defaults =
    content?.kind === "api"
      ? {
          provider: "deepseek",
          base_url: "https://api.deepseek.com",
          credential_ref: "deepseek-default",
          timeout_seconds: 30,
          max_retries: 2,
          rate_limit_per_minute: 20,
        }
      : content?.kind === "model"
        ? { context_limit: 64000, temperature: 0.7, max_output_tokens: 2048 }
        : content?.kind === "prompt"
          ? { variables: [], input_schema: {}, output_schema: {} }
          : { allowed_tools: ["read_context", "return_suggestion"], input_schema: {}, output_schema: {} };
  const value = parseDto(
    name,
    {
      ...input,
      ...(typeof input.name === "string" ? { name: input.name.trim() } : {}),
      ...(content ? { content: { description: "", ...defaults, ...content } } : {}),
    },
    true,
  );
  if (name === "AIConfigUpdate" && (Object.keys(value).length <= 1 || Object.values(value).some((item) => item === null)))
    throw new ApiError("VALIDATION_ERROR", { status: 422 });
  if ("content" in value && value.content) {
    if ("kind" in value && value.kind !== value.content.kind) throw new ApiError("AI_CONFIG_KIND_MISMATCH", { status: 422 });
    validateAIContent(value.content);
  }
  return value;
}
export function validateAIContent(content: AIConfigRead["content"], input = true) {
  const fail = (code: string) => {
    throw new ApiError(input ? code : "INVALID_RESPONSE", input ? { status: 422 } : {});
  };
  if (content.kind === "prompt" || content.kind === "agent")
    for (const schema of [content.input_schema ?? {}, content.output_schema ?? {}]) {
      if (
        Object.keys(schema).length > 50 ||
        Object.entries(schema).some(
          ([key, value]) =>
            !/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(key) || typeof value !== "string" || !["string", "number", "boolean", "array", "object"].includes(value),
        )
      )
        fail("AI_CONFIG_SCHEMA_INVALID");
    }
  if (content.kind === "prompt") {
    const matches = [...content.template.matchAll(/{{\s*([A-Za-z_][A-Za-z0-9_]*)\s*}}/g)];
    const actual = new Set(matches.map((match) => match[1]!));
    const variables = content.variables ?? [];
    if (
      !content.template.trim() ||
      /{{|}}/.test(content.template.replace(/{{\s*[A-Za-z_][A-Za-z0-9_]*\s*}}/g, "")) ||
      new Set(variables).size !== variables.length ||
      actual.size !== variables.length ||
      variables.some((name) => !actual.has(name))
    )
      fail("AI_CONFIG_VARIABLE_INVALID");
    if (Object.keys(content.input_schema ?? {}).some((name) => !variables.includes(name as (typeof variables)[number]))) fail("AI_CONFIG_SCHEMA_INVALID");
  }
  if (content.kind === "model" && new Set(content.capabilities).size !== content.capabilities.length) fail("VALIDATION_ERROR");
  if (content.kind === "agent" && new Set(content.allowed_tools ?? []).size !== (content.allowed_tools ?? []).length) fail("VALIDATION_ERROR");
}
function checkPage(page: { limit: number; offset: number; total: number; items: unknown[] }, query?: PageQuery) {
  const { limit, offset } = pageQuery(query);
  if (page.limit !== limit || page.offset !== offset || page.items.length > limit || page.total < page.items.length) throw new ApiError("INVALID_RESPONSE");
}
function checkContent(value: AIConfigRead) {
  if (value.kind !== value.content.kind) throw new ApiError("INVALID_RESPONSE");
  if (
    Object.keys(value).some((key) => !["id", "kind", "name", "enabled", "version", "current_version_id", "content", "created_at", "updated_at"].includes(key))
  )
    throw new ApiError("INVALID_RESPONSE");
  validateAIContent(value.content, false);
}
export function createHttpAIConfigs(request: Request): AIConfigService {
  return {
    async availability(signal) {
      const value = await request("/ai-configs/availability", "AIConfigAvailability", "GET", undefined, signal);
      if (Object.keys(value).some((key) => !["provider", "credential_configured"].includes(key))) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async list(query = {}, signal) {
      const { limit, offset } = pageQuery(query);
      const kind = configKind(query.kind);
      const result = await request(`/ai-configs?limit=${limit}&offset=${offset}${kind ? `&kind=${kind}` : ""}`, "AIConfigPage", "GET", undefined, signal);
      checkPage(result, query);
      for (const item of result.items) {
        checkContent(item);
        if (kind && item.kind !== kind) throw new ApiError("INVALID_RESPONSE");
      }
      return result;
    },
    async create(input, signal) {
      const data = configInput("AIConfigCreate", input);
      const result = await request("/ai-configs", "AIConfigRead", "POST", data, signal);
      checkContent(result);
      if (result.kind !== data.content.kind || result.version !== 1) throw new ApiError("INVALID_RESPONSE");
      return result;
    },
    async get(id, signal) {
      const result = await request(`/ai-configs/${requireUuid(id)}`, "AIConfigRead", "GET", undefined, signal);
      checkContent(result);
      if (!sameId(result.id, id)) throw new ApiError("INVALID_RESPONSE");
      return result;
    },
    async update(id, input, signal) {
      const data = configInput("AIConfigUpdate", input);
      const result = await request(`/ai-configs/${requireUuid(id)}`, "AIConfigRead", "PATCH", data, signal);
      checkContent(result);
      if (!sameId(result.id, id) || result.version !== data.expected_version + 1 || (data.content && result.kind !== data.content.kind))
        throw new ApiError("INVALID_RESPONSE");
      return result;
    },
    async copy(id, input, signal) {
      const data = configInput("AIConfigCopy", input);
      const result = await request(`/ai-configs/${requireUuid(id)}/copies`, "AIConfigRead", "POST", data, signal);
      checkContent(result);
      if (sameId(result.id, id) || result.version !== 1) throw new ApiError("INVALID_RESPONSE");
      return result;
    },
    async versions(id, query, signal) {
      const { limit, offset } = pageQuery(query);
      const result = await request(`/ai-configs/${requireUuid(id)}/versions?limit=${limit}&offset=${offset}`, "AIConfigVersionPage", "GET", undefined, signal);
      checkPage(result, query);
      if (result.items.some((item) => !sameId(item.config_id, id))) throw new ApiError("INVALID_RESPONSE");
      for (const item of result.items) {
        validateAIContent(item.content, false);
        if (Object.keys(item).some((key) => !["id", "config_id", "version", "name", "content", "created_at"].includes(key)))
          throw new ApiError("INVALID_RESPONSE");
      }
      return result;
    },
    async version(id, version, signal) {
      if (!Number.isSafeInteger(version) || version < 1) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const result = await request(`/ai-configs/${requireUuid(id)}/versions/${version}`, "AIConfigVersionRead", "GET", undefined, signal);
      if (!sameId(result.config_id, id) || result.version !== version) throw new ApiError("INVALID_RESPONSE");
      validateAIContent(result.content, false);
      if (Object.keys(result).some((key) => !["id", "config_id", "version", "name", "content", "created_at"].includes(key)))
        throw new ApiError("INVALID_RESPONSE");
      return result;
    },
    references(id, signal) {
      return request(`/ai-configs/${requireUuid(id)}/references`, "AIConfigReferences", "GET", undefined, signal);
    },
  };
}
