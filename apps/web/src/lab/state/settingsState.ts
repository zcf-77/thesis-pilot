import { usePreviewModule } from "./previewWorkspace.ts";

export type ConfigLibrary = "api" | "model" | "prompt" | "agent";
export const libraryNames: Record<ConfigLibrary, string> = { api: "AI 接口", model: "模型", prompt: "提示词", agent: "智能体" };
export const capabilities = ["text", "search", "format", "plan", "review"];
export const allowedTools = ["read_documents", "search_materials", "propose_revision", "propose_plan", "review_only"];
export const allowedVariables = ["context", "goal", "requirements", "materials"];

export interface ConfigContent {
  name: string;
  enabled: boolean;
  description: string;
  protocol: string;
  address: string;
  timeout: number;
  retries: number;
  rateLimit: number;
  keyRef: string;
  apiId: string;
  modelCode: string;
  capabilities: string[];
  contextLimit: number;
  temperature: number;
  body: string;
  variables: string[];
  inputSchema: string;
  outputSchema: string;
  modelId: string;
  promptId: string;
  promptVersion?: number;
  capability: string;
  tools: string[];
}
export interface ConfigRevision {
  version: number;
  at: string;
  summary: string;
  content: ConfigContent;
}
export interface ConfigEntry extends ConfigContent {
  id: string;
  lib: ConfigLibrary;
  version: number;
  history: ConfigRevision[];
}
export type RunScenario = "success" | "auth" | "timeout" | "rate" | "incompatible";
export interface ConfigSnapshot {
  id: string;
  lib: ConfigLibrary;
  name: string;
  version: number;
  content: ConfigContent;
}
export interface ConfigRun {
  id: string;
  entryId: string;
  title: string;
  status: "running" | "done" | "failed" | "cancelled";
  scenario: RunScenario;
  at: string;
  finishedAt: string;
  attempt: number;
  snapshot: ConfigSnapshot[];
  projectId: string;
  docVersion: number;
  requirementVersion: number;
  result: string;
  variables: Record<string, string>;
}
export interface WorkflowStage {
  id: string;
  name: string;
  description: string;
  deliverables: string;
  condition: string;
  deadline: string;
  start?: string;
  predecessorId: string;
  enabled: boolean;
}
export interface WorkflowRevision {
  version: number;
  at: string;
  stages: WorkflowStage[];
}
export interface DictionaryItem {
  id: string;
  name: string;
  enabled: boolean;
  kind?: "template" | "requirements" | "literature" | "other";
}
export interface SettingsState {
  entries: ConfigEntry[];
  runs: ConfigRun[];
  stages: WorkflowStage[];
  workflowVersion: number;
  workflowHistory: WorkflowRevision[];
  categories: DictionaryItem[];
  reminder: { enabled: boolean; cooldownHours: number; overdueDays: number };
  systemVersion: number;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const now = () => new Date().toLocaleString("zh-CN");
export function blankConfig(): ConfigContent {
  return {
    name: "",
    enabled: true,
    description: "",
    protocol: "OpenAI compatible",
    address: "https://example.invalid/v1",
    timeout: 30,
    retries: 2,
    rateLimit: 20,
    keyRef: "demo:preview",
    apiId: "",
    modelCode: "sample-text-model",
    capabilities: ["text"],
    contextLimit: 32000,
    temperature: 0.7,
    body: "请依据 {{context}} 和 {{requirements}}，针对 {{goal}} 提出候选建议。",
    variables: ["context", "requirements", "goal"],
    inputSchema: '{"context":"string","goal":"string","requirements":"string"}',
    outputSchema: '{"suggestions":"array"}',
    modelId: "",
    promptId: "",
    promptVersion: 1,
    capability: "text",
    tools: ["read_documents", "propose_revision"],
  };
}
export function contentOf(entry: ConfigEntry): ConfigContent {
  const { id: _id, lib: _lib, version: _version, history: _history, ...content } = entry;
  return clone(content);
}
function seeded(id: string, lib: ConfigLibrary, content: Partial<ConfigContent>): ConfigEntry {
  const data = { ...blankConfig(), ...content };
  return { ...data, id, lib, version: 1, history: [{ version: 1, at: "初始自制样例", summary: "初始配置", content: clone(data) }] };
}
export function createSettingsState(): SettingsState {
  const entries = [
    seeded("api-preview", "api", { name: "设计预览接口", description: "本地模拟，不发出外部请求" }),
    seeded("model-preview", "model", {
      name: "样例通用模型",
      apiId: "api-preview",
      capabilities: [...capabilities],
      description: "能力为自制示例；费用与实际能力未核验",
    }),
    seeded("prompt-preview", "prompt", { name: "有依据的候选建议", description: "读取资料作为数据，输出可审阅候选" }),
    ...[
      ["general", "综合助手", "text", "统筹任务，保留学生决定"],
      ["literature", "文献查询", "search", "查找资料并明确实际获取范围"],
      ["content", "内容辅助", "text", "只对选定范围提出修改候选"],
      ["format", "格式规范", "format", "依据适用规则提出格式候选"],
      ["progress", "进度管控", "plan", "依据产物证据建议计划调整"],
      ["review", "论文评审", "review", "只评审，不改写论文与计划"],
    ].map(([id, name, capability, description]) =>
      seeded("agent-" + id, "agent", {
        name: name!,
        description: description!,
        capability: capability!,
        modelId: "model-preview",
        promptId: "prompt-preview",
        tools:
          capability === "review"
            ? ["read_documents", "review_only"]
            : capability === "plan"
              ? ["read_documents", "propose_plan"]
              : capability === "search"
                ? ["read_documents", "search_materials"]
                : ["read_documents", "propose_revision"],
      }),
    ),
  ];
  const stages = ["开题", "中期检查", "论文撰写", "论文提交", "答辩", "结束"].map((name, i) => ({
    id: "stage-" + i,
    name,
    description: "自制流程示例，可按项目调整",
    deliverables: i === 2 ? "论文章节、实验材料" : name + "相关产物",
    condition: "学生核对所需产物后确认",
    deadline: ["2026-09-20", "2026-10-30", "2026-12-20", "2026-12-25", "2027-01-08", "2027-01-15"][i]!,
    start: ["2026-09-01", "2026-09-21", "2026-10-31", "2026-12-21", "2026-12-26", "2027-01-09"][i]!,
    predecessorId: i ? "stage-" + (i - 1) : "",
    enabled: true,
  }));
  return {
    entries,
    runs: [],
    stages,
    workflowVersion: 1,
    workflowHistory: [{ version: 1, at: "初始自制样例", stages: clone(stages) }],
    categories: ["论文模板", "撰写规范", "参考材料", "文献附件"].map((name, i) => ({
      id: "category-" + i,
      name,
      enabled: true,
      kind: (["template", "requirements", "other", "literature"] as const)[i]!,
    })),
    reminder: { enabled: true, cooldownHours: 24, overdueDays: 3 },
    systemVersion: 1,
  };
}
export function useSettingsState() {
  const state = usePreviewModule("settings", createSettingsState);
  for (const category of state.value.categories) {
    if (!category.kind)
      category.kind = ({ "category-0": "template", "category-1": "requirements", "category-3": "literature" } as const)[category.id as "category-0"] ?? "other";
  }
  for (const entry of state.value.entries) {
    if (entry.lib === "agent" && entry.promptVersion === undefined)
      entry.promptVersion = state.value.entries.find((item) => item.id === entry.promptId)?.version ?? 1;
  }
  return state;
}

export function validateConfig(lib: ConfigLibrary, content: ConfigContent, entries: ConfigEntry[], ownId = ""): string[] {
  const errors: string[] = [];
  if (!content.name.trim()) errors.push("请填写名称。");
  if (entries.some((e) => e.lib === lib && e.id !== ownId && e.name === content.name.trim())) errors.push("同一库中已有同名配置。");
  if (lib === "api") {
    try {
      const url = new URL(content.address);
      if (url.hostname !== "example.invalid" || url.protocol !== "https:") errors.push("设计预览只接受 https://example.invalid 下的虚构地址。");
    } catch {
      errors.push("请填写有效的示例地址。");
    }
    if (!/^demo:[a-z0-9-]+$/i.test(content.keyRef)) errors.push("密钥仅可填写 demo: 开头的虚构引用，不能输入真实密钥。");
    if (!Number.isInteger(content.timeout) || content.timeout < 1 || content.timeout > 300) errors.push("超时应为 1—300 秒。");
    if (!Number.isInteger(content.retries) || content.retries < 0 || content.retries > 5) errors.push("重试应为 0—5 次。");
    if (!Number.isInteger(content.rateLimit) || content.rateLimit < 1 || content.rateLimit > 1000) errors.push("每分钟限流应为 1—1000 次。");
  }
  if (lib === "model") {
    const api = entries.find((e) => e.id === content.apiId && e.lib === "api");
    if (!api?.enabled) errors.push("所选 API 不存在或已停用。");
    if (!content.modelCode.trim()) errors.push("请填写服务商模型标识。");
    if (!content.capabilities.length || content.capabilities.some((c) => !capabilities.includes(c))) errors.push("请选择至少一个受支持的能力。");
    if (!Number.isInteger(content.contextLimit) || content.contextLimit < 256 || content.contextLimit > 1000000) errors.push("上下文限制应为 256—1000000。");
    if (!Number.isFinite(content.temperature) || content.temperature < 0 || content.temperature > 2) errors.push("温度应为 0—2。");
  }
  if (lib === "prompt") {
    if (!content.body.trim()) errors.push("提示词正文不能为空。");
    const used = [...new Set([...content.body.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]!.trim()))];
    if (content.variables.some((v) => !allowedVariables.includes(v)) || used.some((v) => !allowedVariables.includes(v)))
      errors.push("变量只允许 context、goal、requirements、materials。");
    if (used.some((v) => !content.variables.includes(v))) errors.push("正文包含未声明变量。");
    if (content.variables.some((v) => !used.includes(v))) errors.push("声明了正文未使用的变量。");
    for (const [label, value] of [
      ["输入结构", content.inputSchema],
      ["输出约束", content.outputSchema],
    ]) {
      try {
        const parsed: unknown = JSON.parse(value!);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) errors.push(label + "必须为 JSON 对象。");
        else if (Object.values(parsed).some((type) => !["string", "number", "boolean", "array", "object"].includes(String(type))))
          errors.push(label + "仅支持字段名到 string/number/boolean/array/object 的映射。");
      } catch {
        errors.push(label + "不是有效 JSON。");
      }
    }
  }
  if (lib === "agent") {
    const model = entries.find((e) => e.lib === "model" && e.id === content.modelId);
    const prompt = entries.find((e) => e.lib === "prompt" && e.id === content.promptId);
    if (!model?.enabled) errors.push("模型不存在或已停用。");
    else {
      if (!model.capabilities.includes(content.capability)) errors.push("模型能力与当前智能体任务不匹配。");
      if (!entries.find((e) => e.id === model.apiId && e.lib === "api")?.enabled) errors.push("模型关联的 API 不可用。");
    }
    if (!prompt?.enabled) errors.push("提示词不存在或已停用。");
    else if (
      content.promptVersion !== undefined &&
      (!Number.isInteger(content.promptVersion) || !prompt.history.some((revision) => revision.version === content.promptVersion))
    )
      errors.push("绑定的提示词版本不存在，请选择有效历史版本。");
    if (!content.description.trim()) errors.push("请说明智能体职责。");
    if (content.tools.some((t) => !allowedTools.includes(t))) errors.push("工具不在允许列表中；不能配置正式写入或执行代码权限。");
    if (!content.tools.length) errors.push("至少选择一项允许工具。");
    for (const [label, value] of [
      ["输入结构", content.inputSchema],
      ["输出结构", content.outputSchema],
    ]) {
      try {
        const parsed: unknown = JSON.parse(value!);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) errors.push(label + "必须为 JSON 对象。");
        else if (Object.values(parsed).some((type) => !["string", "number", "boolean", "array", "object"].includes(String(type))))
          errors.push(label + "仅支持字段名到 string/number/boolean/array/object 的映射。");
      } catch {
        errors.push(label + "不是有效 JSON。");
      }
    }
  }
  return errors;
}
export function saveConfig(state: SettingsState, lib: ConfigLibrary, content: ConfigContent, id = ""): { entry?: ConfigEntry; errors: string[] } {
  const errors = validateConfig(lib, content, state.entries, id);
  if (errors.length) return { errors };
  const clean = clone({ ...content, name: content.name.trim() });
  const entry = state.entries.find((e) => e.id === id);
  if (entry) {
    Object.assign(entry, clean);
    entry.version += 1;
    entry.history.push({ version: entry.version, at: now(), summary: "编辑配置", content: clone(clean) });
    return { entry, errors: [] };
  }
  const added = seeded(crypto.randomUUID(), lib, clean);
  added.history[0]!.at = now();
  added.history[0]!.summary = "创建配置";
  state.entries.push(added);
  return { entry: added, errors: [] };
}
export function toggleConfig(entry: ConfigEntry) {
  entry.enabled = !entry.enabled;
  entry.version += 1;
  entry.history.push({ version: entry.version, at: now(), summary: entry.enabled ? "重新启用" : "停用", content: contentOf(entry) });
}
export function referencedBy(state: SettingsState, id: string): ConfigEntry[] {
  return state.entries.filter((e) => e.apiId === id || e.modelId === id || e.promptId === id);
}
export function configChain(state: SettingsState, entry: ConfigEntry): ConfigEntry[] {
  const model = entry.lib === "model" ? entry : entry.lib === "agent" ? state.entries.find((e) => e.id === entry.modelId) : undefined;
  const api = entry.lib === "api" ? entry : model ? state.entries.find((e) => e.id === model.apiId) : undefined;
  let prompt = entry.lib === "prompt" ? entry : entry.lib === "agent" ? state.entries.find((e) => e.id === entry.promptId) : undefined;
  if (prompt && entry.lib === "agent" && entry.promptVersion !== undefined) {
    const revision = prompt.history.find((item) => item.version === entry.promptVersion);
    if (revision)
      prompt = {
        ...prompt,
        ...clone(revision.content),
        id: prompt.id,
        lib: "prompt",
        version: revision.version,
        enabled: prompt.enabled,
        history: prompt.history,
      };
  }
  return [api, model, prompt, entry.lib === "agent" ? entry : undefined].filter((e): e is ConfigEntry => !!e);
}
export function captureConfigSnapshot(state: SettingsState, entry: ConfigEntry): { snapshot: ConfigSnapshot[]; errors: string[] } {
  const chain = configChain(state, entry);
  const errors = [...new Set(chain.flatMap((node) => configProblems(state, node)))];
  return { snapshot: chain.map((node) => ({ id: node.id, lib: node.lib, name: node.name, version: node.version, content: contentOf(node) })), errors };
}
export function captureBusinessConfig(state: SettingsState, kind: string): { snapshot: ConfigSnapshot[]; errors: string[] } {
  const id = "agent-" + (kind === "lit" ? "literature" : kind);
  const entry = state.entries.find((node) => node.lib === "agent" && node.id === id);
  return entry ? captureConfigSnapshot(state, entry) : { snapshot: [], errors: ["该助手尚未绑定有效配置，请到配置页补充。"] };
}
export function configProblems(state: SettingsState, entry: ConfigEntry): string[] {
  return [...(!entry.enabled ? ["当前配置已停用。"] : []), ...validateConfig(entry.lib, entry, state.entries, entry.id)];
}
export function startConfigRun(
  state: SettingsState,
  entry: ConfigEntry,
  scenario: RunScenario,
  variables: Record<string, string>,
  projectId: string,
  docVersion: number,
  attempt = 1,
  requirementVersion = 1,
): { run?: ConfigRun; errors: string[] } {
  const chain = configChain(state, entry);
  const errors = [...new Set(chain.flatMap((node) => configProblems(state, node)))];
  const prompt = chain.find((e) => e.lib === "prompt");
  if (prompt) {
    if (prompt.variables.some((v) => !variables[v]?.trim())) errors.push("模拟输入缺少已声明变量的值。");
    if (Object.keys(variables).some((v) => !prompt.variables.includes(v))) errors.push("模拟输入包含未声明变量。");
  }
  if (errors.length) return { errors };
  const run: ConfigRun = {
    id: crypto.randomUUID(),
    entryId: entry.id,
    title: entry.name + " · 模拟运行",
    status: "running",
    scenario,
    at: now(),
    finishedAt: "",
    attempt,
    snapshot: chain.map((e) => ({ id: e.id, lib: e.lib, name: e.name, version: e.version, content: contentOf(e) })),
    projectId,
    docVersion,
    requirementVersion,
    result: "正在使用固定样例检查配置链，不发送网络请求。",
    variables: Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, `已提供 ${value.length} 字；原始输入不进入运行记录`])),
  };
  state.runs.unshift(run);
  return { run, errors: [] };
}
export function finishConfigRun(state: SettingsState, id: string) {
  const run = state.runs.find((r) => r.id === id);
  if (!run || run.status !== "running") return;
  run.finishedAt = now();
  run.status = run.scenario === "success" ? "done" : "failed";
  run.result = {
    success: '模拟成功：输出 {"suggestions": []}，结构检查通过；不代表真实模型已接通。',
    auth: "模拟认证失败：请检查密钥引用配置；本预览不接受真实密钥。",
    timeout: "模拟超时：原始内容未改变，可以重试。",
    rate: "模拟限流：请降低请求频率后重试。",
    incompatible: "模拟返回结构不兼容：预期 JSON 对象与 suggestions 数组，收到无效文本；结果未进入正式内容。",
  }[run.scenario];
  if (run.scenario === "success") {
    const output: Record<string, unknown> = { suggestions: [] };
    for (const item of run.snapshot.filter((s) => s.lib === "prompt" || s.lib === "agent")) {
      const schema = JSON.parse(item.content.outputSchema) as Record<string, string>;
      if (Object.entries(schema).some(([key, type]) => !(key in output) || (type === "array" ? !Array.isArray(output[key]) : typeof output[key] !== type))) {
        run.status = "failed";
        run.result = `模拟结果不满足 ${item.name} v${item.version} 的输出约束；未将结果用于正式内容。`;
        break;
      }
    }
  }
}
export function cancelConfigRun(state: SettingsState, id: string) {
  const run = state.runs.find((r) => r.id === id);
  if (!run || run.status !== "running") return;
  run.status = "cancelled";
  run.finishedAt = now();
  run.result = "已取消。迟到结果不会恢复本次运行。";
}
export function validateStages(stages: WorkflowStage[]): string[] {
  const errors: string[] = [];
  const names = new Set<string>();
  const map = new Map(stages.map((s) => [s.id, s]));
  for (const stage of stages) {
    if (!stage.name.trim()) errors.push("阶段名称不能为空。");
    if (names.has(stage.name.trim())) errors.push("阶段名称不能重复。");
    names.add(stage.name.trim());
    if (!stage.enabled) continue;
    if (!stage.deliverables.trim() || !stage.condition.trim()) errors.push(stage.name + "缺少产物或完成条件。");
    const validDate = (value: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (stage.deadline && !validDate(stage.deadline)) errors.push(stage.name + "截止日期无效。");
    if (stage.start && !validDate(stage.start)) errors.push(stage.name + "开始日期无效。");
    if (stage.start && stage.deadline && stage.start > stage.deadline) errors.push(stage.name + "开始日期不能晚于截止日期。");
    const previous = map.get(stage.predecessorId);
    if (stage.predecessorId && !previous?.enabled) errors.push(stage.name + "的前置阶段不存在或已停用。");
    if (previous?.deadline && stage.deadline && previous.deadline > stage.deadline) errors.push(stage.name + "早于前置阶段截止时间。");
    const seen = new Set([stage.id]);
    let next = previous;
    while (next) {
      if (seen.has(next.id)) {
        errors.push("阶段依赖存在循环。");
        break;
      }
      seen.add(next.id);
      next = map.get(next.predecessorId);
    }
  }
  return [...new Set(errors)];
}
export function saveStages(state: SettingsState, stages: WorkflowStage[]): string[] {
  const errors = validateStages(stages);
  if (errors.length) return errors;
  state.stages = clone(stages);
  state.workflowVersion += 1;
  state.workflowHistory.push({ version: state.workflowVersion, at: now(), stages: clone(stages) });
  return [];
}

/** 使用稳定阶段 ID 迁移名称；不存在或停用时要求学生选择，不擅自前进阶段。 */
export function workflowBindingStage(
  state: SettingsState,
  currentVersion: number,
  currentName: string,
  chosenId = "",
  targetVersion = state.workflowVersion,
): WorkflowStage | undefined {
  const previous = state.workflowHistory.find((item) => item.version === currentVersion)?.stages.find((stage) => stage.name === currentName);
  const target = targetVersion === state.workflowVersion ? state.stages : state.workflowHistory.find((item) => item.version === targetVersion)?.stages;
  return target?.find((stage) => stage.enabled && stage.id === (chosenId || previous?.id));
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function validContent(value: unknown): value is ConfigContent {
  if (!record(value)) return false;
  if (typeof value.keyRef !== "string" || !/^demo:[a-z0-9-]+$/i.test(value.keyRef)) return false;
  try {
    const url = new URL(String(value.address));
    if (url.protocol !== "https:" || url.hostname !== "example.invalid") return false;
  } catch {
    return false;
  }
  return Object.entries(blankConfig()).every(([key, initial]) => {
    const item = value[key];
    if (key === "promptVersion" && item === undefined) return true;
    if (key === "promptVersion") return typeof item === "number" && Number.isInteger(item) && item > 0;
    return Array.isArray(initial)
      ? Array.isArray(item) && item.every((v) => typeof v === "string")
      : typeof initial === "number"
        ? typeof item === "number" && Number.isFinite(item)
        : typeof item === typeof initial;
  });
}
export function validateConfigSnapshot(value: unknown): value is ConfigSnapshot[] {
  return (
    Array.isArray(value) &&
    value.length <= 4 &&
    value.every(
      (node) =>
        record(node) &&
        typeof node.id === "string" &&
        typeof node.name === "string" &&
        ["api", "model", "prompt", "agent"].includes(String(node.lib)) &&
        typeof node.version === "number" &&
        Number.isInteger(node.version) &&
        node.version > 0 &&
        validContent(node.content),
    )
  );
}
function validStage(value: unknown): value is WorkflowStage {
  return (
    record(value) &&
    ["id", "name", "description", "deliverables", "condition", "deadline", "predecessorId"].every((k) => typeof value[k] === "string") &&
    (value.start === undefined || typeof value.start === "string") &&
    typeof value.enabled === "boolean"
  );
}
export function validateSettingsState(value: unknown): value is SettingsState {
  if (
    !record(value) ||
    !Array.isArray(value.entries) ||
    !Array.isArray(value.runs) ||
    !Array.isArray(value.stages) ||
    !Array.isArray(value.workflowHistory) ||
    !Array.isArray(value.categories) ||
    !record(value.reminder)
  )
    return false;
  const validVersion = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0;
  return (
    validVersion(value.workflowVersion) &&
    validVersion(value.systemVersion) &&
    value.entries.every(
      (e) =>
        record(e) &&
        validContent(e) &&
        typeof e.id === "string" &&
        typeof e.lib === "string" &&
        ["api", "model", "prompt", "agent"].includes(e.lib) &&
        validVersion(e.version) &&
        Array.isArray(e.history) &&
        e.history.every((h) => record(h) && validVersion(h.version) && typeof h.at === "string" && typeof h.summary === "string" && validContent(h.content)),
    ) &&
    value.runs.every(
      (r) =>
        record(r) &&
        ["id", "entryId", "title", "at", "finishedAt", "projectId", "result"].every((k) => typeof r[k] === "string") &&
        typeof r.status === "string" &&
        ["running", "done", "failed", "cancelled"].includes(r.status) &&
        typeof r.scenario === "string" &&
        ["success", "auth", "timeout", "rate", "incompatible"].includes(r.scenario) &&
        validVersion(r.attempt) &&
        validVersion(r.docVersion) &&
        Number.isInteger(r.requirementVersion) &&
        Number(r.requirementVersion) >= 0 &&
        record(r.variables) &&
        Object.values(r.variables).every((v) => typeof v === "string") &&
        Array.isArray(r.snapshot) &&
        r.snapshot.every(
          (s) => record(s) && ["id", "name", "lib"].every((k) => typeof s[k] === "string") && validVersion(s.version) && validContent(s.content),
        ),
    ) &&
    value.stages.every(validStage) &&
    value.workflowHistory.every(
      (h) => record(h) && validVersion(h.version) && typeof h.at === "string" && Array.isArray(h.stages) && h.stages.every(validStage),
    ) &&
    value.categories.every(
      (c) =>
        record(c) &&
        typeof c.id === "string" &&
        typeof c.name === "string" &&
        typeof c.enabled === "boolean" &&
        (c.kind === undefined || (typeof c.kind === "string" && ["template", "requirements", "literature", "other"].includes(c.kind))),
    ) &&
    typeof value.reminder.enabled === "boolean" &&
    typeof value.reminder.cooldownHours === "number" &&
    Number.isFinite(value.reminder.cooldownHours) &&
    typeof value.reminder.overdueDays === "number" &&
    Number.isFinite(value.reminder.overdueDays)
  );
}
