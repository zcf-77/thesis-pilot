import type { ConfigNodeView } from "../../domain/types.ts";

export type ConfigLike = { name: string; enabled: boolean; version: number; content: { kind: string } & Record<string, unknown> };
export type KnownVersion = {
  config: { kind: ConfigNodeView["lib"]; name: string; enabled: boolean };
  version: { id: string; version: number; name: string; content: ConfigLike["content"] };
};
export type ConfigHealth = "active" | "disabled" | "invalid";

const libraryLabel: Record<ConfigNodeView["lib"], string> = { api: "接口", model: "模型", prompt: "提示词", agent: "智能体" };

function reference(content: ConfigLike["content"], key: string) {
  const value = content[key];
  return typeof value === "string" && value ? value : "";
}

/**
 * 由已读取的版本得出关联链：接口 → 模型 → 提示词 → 智能体。
 * 引用固定到具体版本；上游停用或缺失时下游标为关联无效，不会静默换用其他配置。
 * known 尚未读全时（complete=false），找不到的引用不判为缺失。
 */
export function configChain(entry: ConfigLike, known: readonly KnownVersion[], complete = true): ConfigNodeView[] {
  const find = (id: string) => known.find((item) => item.version.id === id);
  const nodes: ConfigNodeView[] = [];

  function upstream(lib: ConfigNodeView["lib"], versionId: string): ConfigNodeView | undefined {
    if (!versionId) return missing(lib, "尚未选择关联版本。");
    const found = find(versionId);
    if (!found) return complete ? missing(lib, "关联版本不存在或无权读取。") : undefined;
    return {
      lib,
      name: found.version.name,
      version: found.version.version,
      state: found.config.enabled ? "active" : "disabled",
      problem: found.config.enabled ? undefined : `「${found.version.name}」已停用`,
    };
  }
  function missing(lib: ConfigNodeView["lib"], problem: string): ConfigNodeView {
    return { lib, name: `${libraryLabel[lib]}缺失`, version: 0, state: "invalid", problem };
  }
  function resolve(lib: ConfigNodeView["lib"], versionId: string, parents: ConfigNodeView[]) {
    const own = upstream(lib, versionId);
    if (!own) return undefined;
    return inherit(own, parents);
  }
  function inherit(node: ConfigNodeView, parents: ConfigNodeView[]): ConfigNodeView {
    const bad = parents.find((item) => item.state !== "active");
    if (!bad || node.state === "disabled") return node;
    return { ...node, state: "invalid", problem: `上游${libraryLabel[bad.lib]}${bad.state === "disabled" ? "已停用" : "关联无效"}` };
  }

  const { content } = entry;
  const self = (parents: ConfigNodeView[]): ConfigNodeView =>
    inherit({ lib: content.kind as ConfigNodeView["lib"], name: entry.name, version: entry.version, state: entry.enabled ? "active" : "disabled" }, parents);

  if (content.kind === "api") return [self([])];
  if (content.kind === "prompt") return [self([])];
  if (content.kind === "model") {
    const api = resolve("api", reference(content, "api_version_id"), []);
    if (api) nodes.push(api);
    nodes.push(self(api ? [api] : []));
    return nodes;
  }
  const modelEntry = find(reference(content, "model_version_id"));
  const api = modelEntry ? resolve("api", reference(modelEntry.version.content, "api_version_id"), []) : undefined;
  const model = resolve("model", reference(content, "model_version_id"), api ? [api] : []);
  const prompt = resolve("prompt", reference(content, "prompt_version_id"), []);
  const upstreamNodes = [api, model, prompt].filter((node): node is ConfigNodeView => !!node);
  return [...upstreamNodes, self(upstreamNodes)];
}

export function configHealth(entry: ConfigLike, known: readonly KnownVersion[], complete = true): ConfigHealth {
  if (!entry.enabled) return "disabled";
  const nodes = configChain(entry, known, complete);
  return nodes.some((node) => node.state !== "active") ? "invalid" : "active";
}

export const healthStatus = {
  active: { tone: "success", label: "启用" },
  disabled: { tone: "neutral", label: "停用" },
  invalid: { tone: "danger", label: "关联无效" },
} as const;
