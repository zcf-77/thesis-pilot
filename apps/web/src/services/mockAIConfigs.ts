import type { AIConfigJobReference, AIConfigRead, AIConfigVersionRead, ConfigurationProbeConfiguration } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import { configInput, configKind, validateAIContent } from "./httpAIConfigs.ts";
import type { AIConfigService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

const clone = <T>(value: T): T => structuredClone(value);
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function createMockAIConfigs(before: (signal?: AbortSignal) => Promise<void>, jobReferences: (ids: string[]) => AIConfigJobReference[]) {
  const configs = new Map<string, AIConfigRead>();
  const history = new Map<string, AIConfigVersionRead[]>();
  function uniqueName(name: string, kind: AIConfigRead["kind"], except?: string) {
    if ([...configs.values()].some((item) => item.id !== except && item.kind === kind && item.name === name))
      throw new ApiError("AI_CONFIG_NAME_CONFLICT", { status: 409 });
  }
  function current(id: string) {
    const result = configs.get(requireUuid(id).toLowerCase());
    if (!result) throw new ApiError("AI_CONFIG_NOT_FOUND", { status: 404 });
    return result;
  }
  function versionById(id: string, kind?: AIConfigRead["kind"], active = true): AIConfigVersionRead {
    requireUuid(id);
    const result = [...history.values()].flat().find((entry) => sameId(entry.id, id));
    if (!result) throw new ApiError("AI_CONFIG_VERSION_NOT_FOUND", { status: 404 });
    const root = current(result.config_id);
    if (kind && result.content.kind !== kind) throw new ApiError("AI_CONFIG_REFERENCE_INVALID", { status: 422 });
    if (active && !root.enabled) throw new ApiError("AI_CONFIG_DISABLED", { status: 409 });
    return result;
  }
  function chain(entry: AIConfigVersionRead, visiting = new Set<string>()): ConfigurationProbeConfiguration {
    if (visiting.has(entry.id)) throw new ApiError("AI_CONFIG_REFERENCE_INVALID", { status: 422 });
    visiting.add(entry.id);
    const content = entry.content;
    const base: ConfigurationProbeConfiguration = {
      schema_version: 1,
      config_kind: content.kind,
      config_version_id: entry.id,
      version_ids: { [content.kind]: entry.id },
      [content.kind]: clone(content),
    };
    if (content.kind === "model") {
      const api = chain(versionById(content.api_version_id, "api"), visiting);
      return { ...base, api: api.api, version_ids: { ...api.version_ids, ...base.version_ids } };
    }
    if (content.kind === "agent") {
      const model = chain(versionById(content.model_version_id, "model"), visiting);
      const prompt = chain(versionById(content.prompt_version_id, "prompt"), visiting);
      const required = { general: "text", literature: "search", content: "text", format: "format", progress: "plan", review: "review" } as const;
      if (!model.model?.capabilities.includes(required[content.role])) throw new ApiError("AI_CONFIG_REFERENCE_INVALID", { status: 422 });
      if (
        Object.keys(content.input_schema ?? {}).some(
          (name) => !(prompt.prompt?.variables ?? []).includes(name as "context" | "goal" | "requirements" | "materials"),
        )
      )
        throw new ApiError("AI_CONFIG_SCHEMA_INVALID", { status: 422 });
      for (const [name, type] of Object.entries(content.output_schema ?? {}))
        if (prompt.prompt?.output_schema?.[name] && prompt.prompt.output_schema[name] !== type) throw new ApiError("AI_CONFIG_SCHEMA_INVALID", { status: 422 });
      return {
        ...base,
        api: model.api,
        model: model.model,
        prompt: prompt.prompt,
        version_ids: { ...model.version_ids, ...prompt.version_ids, ...base.version_ids },
      };
    }
    return base;
  }
  function validate(content: AIConfigRead["content"]) {
    validateAIContent(content);
    chain({ id: crypto.randomUUID(), config_id: crypto.randomUUID(), version: 1, name: "验证", content, created_at: new Date().toISOString() });
  }
  function insert(name: string, content: AIConfigRead["content"], enabled = true): AIConfigRead {
    uniqueName(name, content.kind);
    validate(content);
    const now = new Date().toISOString();
    const snapshot: AIConfigVersionRead = {
      id: crypto.randomUUID(),
      config_id: crypto.randomUUID(),
      version: 1,
      name,
      content: clone(content),
      created_at: now,
    };
    const value = parseDto("AIConfigRead", {
      id: snapshot.config_id,
      kind: content.kind,
      name,
      enabled,
      version: 1,
      current_version_id: snapshot.id,
      content: clone(content),
      created_at: now,
      updated_at: now,
    });
    configs.set(value.id, value);
    history.set(value.id, [snapshot]);
    return clone(value);
  }
  const service: AIConfigService = {
    async availability(signal) {
      await before(signal);
      return { provider: "deepseek", credential_configured: false };
    },
    async list(query = {}, signal) {
      await before(signal);
      const { limit, offset } = pageQuery(query);
      const kind = configKind(query.kind);
      const ordered = [...configs.values()]
        .filter((item) => !kind || item.kind === kind)
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      return clone(parseDto("AIConfigPage", { items: ordered.slice(offset, offset + limit), total: ordered.length, limit, offset }));
    },
    async create(input, signal) {
      await before(signal);
      const data = configInput("AIConfigCreate", input);
      return insert(data.name, data.content, data.enabled ?? true);
    },
    async get(id, signal) {
      await before(signal);
      return clone(current(id));
    },
    async update(id, input, signal) {
      await before(signal);
      const data = configInput("AIConfigUpdate", input);
      const previous = current(id);
      if (previous.version !== data.expected_version) throw new ApiError("AI_CONFIG_VERSION_CONFLICT", { status: 409 });
      uniqueName(data.name ?? previous.name, previous.kind, previous.id);
      const content = data.content ?? previous.content;
      if (content.kind !== previous.kind) throw new ApiError("AI_CONFIG_KIND_MISMATCH", { status: 422 });
      if (data.content || data.enabled === true) validate(content);
      const now = new Date().toISOString();
      const snapshot: AIConfigVersionRead = {
        id: crypto.randomUUID(),
        config_id: previous.id,
        version: previous.version + 1,
        name: data.name ?? previous.name,
        content: clone(content),
        created_at: now,
      };
      const next = parseDto("AIConfigRead", {
        ...previous,
        content: clone(content),
        name: snapshot.name,
        enabled: data.enabled ?? previous.enabled,
        version: snapshot.version,
        current_version_id: snapshot.id,
        updated_at: now,
      });
      configs.set(next.id, next);
      history.get(next.id)!.push(snapshot);
      return clone(next);
    },
    async copy(id, input, signal) {
      await before(signal);
      const data = configInput("AIConfigCopy", input);
      const root = current(id);
      const version = data.source_version ?? root.version;
      const source = history.get(root.id)!.find((item) => item.version === version);
      if (!source) throw new ApiError("AI_CONFIG_VERSION_NOT_FOUND", { status: 404 });
      return insert(data.name, source.content);
    },
    async versions(id, query, signal) {
      await before(signal);
      const root = current(id);
      const { limit, offset } = pageQuery(query);
      const ordered = [...history.get(root.id)!].sort((a, b) => b.version - a.version);
      return clone(parseDto("AIConfigVersionPage", { items: ordered.slice(offset, offset + limit), total: ordered.length, limit, offset }));
    },
    async version(id, version, signal) {
      await before(signal);
      if (!Number.isSafeInteger(version) || version < 1) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const root = current(id);
      const result = history.get(root.id)!.find((item) => item.version === version);
      if (!result) throw new ApiError("AI_CONFIG_VERSION_NOT_FOUND", { status: 404 });
      return clone(result);
    },
    async references(id, signal) {
      await before(signal);
      const root = current(id);
      const ids = history.get(root.id)!.map((entry) => entry.id);
      const references = [...history.values()].flat().flatMap((entry) => {
        const content = entry.content;
        const linked =
          content.kind === "model" ? [content.api_version_id] : content.kind === "agent" ? [content.model_version_id, content.prompt_version_id] : [];
        const owner = current(entry.config_id);
        return linked
          .filter((versionId) => ids.includes(versionId))
          .map((versionId) => ({
            config_id: owner.id,
            version_id: entry.id,
            kind: owner.kind,
            name: entry.name,
            version: entry.version,
            enabled: owner.enabled,
            current: owner.current_version_id === entry.id,
            referenced_version_id: versionId,
          }));
      });
      const jobs = jobReferences(ids);
      return clone(
        parseDto("AIConfigReferences", {
          configs: references.slice(0, 100),
          jobs: jobs.slice(0, 100),
          configs_truncated: references.length > 100,
          jobs_truncated: jobs.length > 100,
        }),
      );
    },
  };
  function freeze(versionId: string, variables: Record<string, string>): ConfigurationProbeConfiguration {
    const entry = versionById(versionId);
    const frozen = chain(entry);
    const required = frozen.prompt?.variables ?? [];
    if (
      Object.entries(variables).some(([name, value]) => !["context", "goal", "requirements", "materials"].includes(name) || !value.trim()) ||
      (frozen.prompt && (Object.keys(variables).length !== required.length || required.some((name) => !Object.hasOwn(variables, name))))
    )
      throw new ApiError("AI_CONFIG_VARIABLE_INVALID", { status: 422 });
    for (const node of [frozen.prompt, frozen.agent])
      for (const [field, type] of Object.entries(node?.input_schema ?? {})) {
        if (!Object.hasOwn(variables, field)) throw new ApiError("AI_CONFIG_SCHEMA_INVALID", { status: 422 });
        let value: unknown = variables[field];
        if (type !== "string") {
          try {
            value = JSON.parse(variables[field]!);
          } catch {
            throw new ApiError("AI_CONFIG_SCHEMA_INVALID", { status: 422 });
          }
        }
        const matches =
          type === "number"
            ? typeof value === "number" && Number.isFinite(value)
            : type === "array"
              ? Array.isArray(value)
              : type === "object"
                ? !!value && typeof value === "object" && !Array.isArray(value)
                : type === "boolean"
                  ? typeof value === "boolean"
                  : type === "string" && typeof value === "string";
        if (!matches) throw new ApiError("AI_CONFIG_SCHEMA_INVALID", { status: 422 });
      }
    return clone(frozen);
  }
  function configuration(versionId: string) {
    return clone(chain(versionById(versionId)));
  }
  return { service, freeze, configuration };
}
