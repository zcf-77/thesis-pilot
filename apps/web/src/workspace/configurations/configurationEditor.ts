export type ConfigurationLibrary = "api" | "model" | "prompt" | "agent";
export const configurationLibraries = [
  { value: "api" as const, label: "AI 接口" },
  { value: "model" as const, label: "模型" },
  { value: "prompt" as const, label: "提示词" },
  { value: "agent" as const, label: "智能体" },
];

export type FieldSchema = Record<string, "string" | "number" | "boolean" | "array" | "object">;
export type Capability = "text" | "search" | "format" | "plan" | "review";
export type PromptVariable = "context" | "goal" | "requirements" | "materials";
export type AgentTool = "read_context" | "return_suggestion";
export type AgentRole = "general" | "literature" | "content" | "format" | "progress" | "review";
export type ConfigurationContent =
  | {
      kind: "api";
      provider: "deepseek";
      base_url: "https://api.deepseek.com";
      credential_ref: "deepseek-default";
      timeout_seconds: number;
      max_retries: number;
      rate_limit_per_minute: number;
      description: string;
    }
  | {
      kind: "model";
      api_version_id: string;
      model_code: "deepseek-flash" | "deepseek-v4-pro";
      capabilities: Capability[];
      context_limit: number;
      temperature: number;
      max_output_tokens: number;
      description: string;
    }
  | { kind: "prompt"; template: string; variables: PromptVariable[]; input_schema: FieldSchema; output_schema: FieldSchema; description: string }
  | {
      kind: "agent";
      role: AgentRole;
      instructions: string;
      model_version_id: string;
      prompt_version_id: string;
      allowed_tools: AgentTool[];
      input_schema: FieldSchema;
      output_schema: FieldSchema;
      description: string;
    };

export function blankContent(kind: ConfigurationLibrary): ConfigurationContent {
  if (kind === "api")
    return {
      kind,
      provider: "deepseek",
      base_url: "https://api.deepseek.com",
      credential_ref: "deepseek-default",
      timeout_seconds: 30,
      max_retries: 2,
      rate_limit_per_minute: 20,
      description: "",
    };
  if (kind === "model")
    return {
      kind,
      api_version_id: "",
      model_code: "deepseek-flash",
      capabilities: ["text"],
      context_limit: 64000,
      temperature: 0.7,
      max_output_tokens: 2048,
      description: "",
    };
  if (kind === "prompt")
    return {
      kind,
      template: "请根据 {{context}}，围绕 {{goal}} 给出建议。",
      variables: ["context", "goal"],
      input_schema: {},
      output_schema: {},
      description: "",
    };
  return {
    kind,
    role: "general",
    instructions: "仅依据明确提供的合成输入提出建议，不执行工具或修改正文。",
    model_version_id: "",
    prompt_version_id: "",
    allowed_tools: ["read_context", "return_suggestion"],
    input_schema: {},
    output_schema: {},
    description: "",
  };
}

export function schemaValue(text: string): FieldSchema {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("输入与输出结构需要有效的 JSON 对象。");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.entries(value).some(
      ([key, item]) =>
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
        ["__proto__", "constructor", "prototype"].includes(key) ||
        !["string", "number", "boolean", "array", "object"].includes(String(item)),
    )
  )
    throw new Error('结构需写为字段名到类型的映射，例如 {"suggestion":"string"}；支持 string/number/boolean/array/object。');
  return value as FieldSchema;
}

export function contentError(content: ConfigurationContent): string {
  const inRange = (value: number, min: number, max: number, integer = true) =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
  if (content.kind === "api") {
    if (!inRange(content.timeout_seconds, 1, 300) || !inRange(content.max_retries, 0, 3) || !inRange(content.rate_limit_per_minute, 1, 1000))
      return "接口超时需为 1–300 秒，重试 0–3 次，每分钟限流 1–1000 次。";
  } else if (content.kind === "model") {
    if (!content.api_version_id) return "请选择明确的接口版本。";
    if (!content.capabilities.length) return "请至少选择一种模型能力。";
    if (!inRange(content.context_limit, 256, 1000000) || !inRange(content.max_output_tokens, 1, 8192) || !inRange(content.temperature, 0, 2, false))
      return "上下文需为 256–1000000，输出上限 1–8192，温度 0–2。";
  } else if (content.kind === "prompt") {
    if (!content.template.trim()) return "请填写提示词模板。";
    const names = [...content.template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1]!.trim());
    const remainder = content.template.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, "");
    if (remainder.includes("{{") || remainder.includes("}}")) return "模板含有不完整或无效的变量占位符。";
    if (names.some((name) => !content.variables.includes(name as PromptVariable)) || content.variables.some((name) => !names.includes(name)))
      return "变量声明必须与模板占位符一一对应，请检查声明变量。";
    if (Object.keys(content.input_schema).some((key) => !content.variables.includes(key as PromptVariable))) return "输入结构只能约束已声明的变量。";
  } else {
    if (!content.instructions.trim()) return "请填写智能体职责。";
    if (!content.model_version_id || !content.prompt_version_id) return "请选择明确的模型和提示词版本。";
    if (!content.allowed_tools.length) return "请至少保留一种允许的操作。";
  }
  return "";
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function configurationChanges(first: Record<string, unknown>, second: Record<string, unknown>) {
  return [...new Set([...Object.keys(first), ...Object.keys(second)])]
    .sort()
    .filter((key) => canonical(first[key]) !== canonical(second[key]))
    .map((key) => ({ key, before: first[key], after: second[key] }));
}

export function variableValues(text: string): Record<string, string> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('试跑变量需要有效的 JSON 对象，例如 {"context":"合成研究背景"}。');
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("试跑变量需要 JSON 对象。");
  const entries = Object.entries(value);
  if (entries.some(([key, item]) => !["context", "goal", "requirements", "materials"].includes(key) || typeof item !== "string"))
    throw new Error("变量名仅支持 context、goal、requirements、materials；变量值必须是文本。");
  return Object.fromEntries(entries);
}

export function printable(value: unknown): string {
  if (value === undefined) return "未设置";
  if (typeof value === "string") return value || "（空）";
  return JSON.stringify(value, null, 2);
}

type TaskStamp = { id: string; status: string; updated_at: string };
export function shouldApplyTaskUpdate(current: TaskStamp | undefined, next: TaskStamp): boolean {
  if (!current || current.id !== next.id) return true;
  const active = (status: string) => status === "queued" || status === "running";
  return Date.parse(next.updated_at) >= Date.parse(current.updated_at) && (active(current.status) || !active(next.status));
}

export function probeResultPresentation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result = value as Record<string, unknown>;
  if (result.kind !== "configuration_probe" || typeof result.content !== "string" || typeof result.model_used !== "boolean") return undefined;
  return {
    content: result.content,
    execution: result.model_used ? "真实模型调用" : result.config_kind === "prompt" ? "提示词渲染（未调用模型）" : "接口连通性检查（未调用模型）",
    requestedModel: typeof result.requested_model === "string" ? result.requested_model : undefined,
    responseModel: typeof result.response_model === "string" ? result.response_model : undefined,
    versionShort: typeof result.config_version_id === "string" ? result.config_version_id.slice(0, 8) : "",
  };
}
