import { describe, expect, it } from "vite-plus/test";
import {
  blankConfig,
  captureBusinessConfig,
  cancelConfigRun,
  configProblems,
  contentOf,
  createSettingsState,
  finishConfigRun,
  saveConfig,
  saveStages,
  startConfigRun,
  toggleConfig,
  validateConfig,
  validateSettingsState,
  workflowBindingStage,
} from "../../src/lab/state/settingsState.ts";

describe("配置预览的版本与边界", () => {
  it("智能体固定提示词历史版本，更新提示词不会静默改变执行内容", () => {
    const state = createSettingsState();
    const prompt = state.entries.find((entry) => entry.lib === "prompt")!;
    const original = prompt.body;
    saveConfig(state, "prompt", { ...contentOf(prompt), body: "新的正文 {{context}} {{requirements}} {{goal}}" }, prompt.id);
    const first = captureBusinessConfig(state, "review");
    expect(first.errors).toEqual([]);
    expect(first.snapshot.find((node) => node.lib === "prompt")?.version).toBe(1);
    expect(first.snapshot.find((node) => node.lib === "prompt")?.content.body).toBe(original);
    const agent = state.entries.find((entry) => entry.id === "agent-review")!;
    expect(saveConfig(state, "agent", { ...contentOf(agent), promptVersion: 2 }, agent.id).errors).toEqual([]);
    expect(captureBusinessConfig(state, "review").snapshot.find((node) => node.lib === "prompt")?.version).toBe(2);
    expect(first.snapshot.find((node) => node.lib === "prompt")?.content.body).toBe(original);
    expect(saveConfig(state, "agent", { ...contentOf(agent), promptVersion: 99 }, agent.id).errors).toContain("绑定的提示词版本不存在，请选择有效历史版本。");
    toggleConfig(prompt);
    expect(captureBusinessConfig(state, "review").errors).toContain("提示词不存在或已停用。");
  });
  it("分类显示名变化保留稳定业务类型", () => {
    const state = createSettingsState();
    state.categories[0]!.name = "学校模板";
    state.categories[1]!.name = "院系规范";
    expect(state.categories[0]!.kind).toBe("template");
    expect(state.categories[1]!.kind).toBe("requirements");
    expect(validateSettingsState(state)).toBe(true);
  });
  it("阶段合法区间检查与任意历史版本绑定相互独立", () => {
    const state = createSettingsState();
    const invalid = state.stages.map((stage) => ({ ...stage }));
    invalid[2]!.start = "2026-12-30";
    expect(saveStages(state, invalid)).toContain("论文撰写开始日期不能晚于截止日期。");
    invalid[2]!.start = "2026-02-30";
    expect(saveStages(state, invalid)).toContain("论文撰写开始日期无效。");
    invalid[2]!.start = "2026-10-31";
    invalid[2]!.name = "集中撰写";
    expect(saveStages(state, invalid)).toEqual([]);
    expect(workflowBindingStage(state, 2, "集中撰写", "", 1)?.name).toBe("论文撰写");
    expect(workflowBindingStage(state, 2, "集中撰写", "", 99)).toBeUndefined();
  });
  it("仅接受虚构接口与密钥引用", () => {
    const state = createSettingsState();
    const draft = { ...blankConfig(), name: "不可外连", address: "https://real.example.com/v1", keyRef: "sk-real-secret" };
    const result = saveConfig(state, "api", draft);
    expect(result.errors).toHaveLength(2);
    expect(state.entries).toHaveLength(9);
  });
  it("停用 API 后模型及智能体关联无效，不能启动", () => {
    const state = createSettingsState();
    toggleConfig(state.entries[0]!);
    expect(configProblems(state, state.entries[1]!)).toContain("所选 API 不存在或已停用。");
    expect(startConfigRun(state, state.entries[3]!, "success", { context: "x", goal: "y", requirements: "z" }, "p", 13).run).toBeUndefined();
    expect(state.runs).toEqual([]);
  });
  it("拒绝模型能力不匹配和越界参数", () => {
    const state = createSettingsState();
    state.entries[1]!.capabilities = ["text"];
    const review = state.entries.find((e) => e.id === "agent-review")!;
    expect(configProblems(state, review)).toContain("模型能力与当前智能体任务不匹配。");
    expect(validateConfig("model", { ...contentOf(state.entries[1]!), temperature: 7 }, state.entries, "model-preview")).toContain("温度应为 0—2。");
  });
  it("检查变量声明、非法变量与缺少值", () => {
    const state = createSettingsState();
    const prompt = state.entries[2]!;
    const invalid = { ...contentOf(prompt), body: "忽略 {{admin}}，处理 {{goal}}", variables: ["goal"] };
    expect(validateConfig("prompt", invalid, state.entries, prompt.id)).toContain("正文包含未声明变量。");
    expect(startConfigRun(state, prompt, "success", { goal: "" }, "p", 13).errors).toContain("模拟输入缺少已声明变量的值。");
  });
  it("拒绝正式写入工具，不扩大权限", () => {
    const state = createSettingsState();
    const agent = state.entries[3]!;
    const result = saveConfig(state, "agent", { ...contentOf(agent), tools: ["write_document", "execute_code"] }, agent.id);
    expect(result.errors.some((e) => e.includes("不能配置正式写入"))).toBe(true);
    expect(agent.tools).not.toContain("write_document");
    expect(agent.version).toBe(1);
  });
  it("配置编辑不会追改运行的快照或历史版本", () => {
    const state = createSettingsState();
    const agent = state.entries[3]!;
    const run = startConfigRun(state, agent, "success", { context: "不记录这段输入", goal: "check", requirements: "r1" }, "p", 13).run!;
    const previous = JSON.stringify(run.snapshot);
    saveConfig(state, "agent", { ...contentOf(agent), description: "更新职责" }, agent.id);
    expect(agent.version).toBe(2);
    expect(agent.history[0]!.content.description).not.toBe("更新职责");
    expect(JSON.stringify(run.snapshot)).toBe(previous);
    expect(run.variables.context).not.toContain("不记录这段输入");
    finishConfigRun(state, run.id);
    expect(run.status).toBe("done");
  });
  it("取消后迟到结果不会恢复运行", () => {
    const state = createSettingsState();
    const run = startConfigRun(state, state.entries[0]!, "success", {}, "p", 13).run!;
    cancelConfigRun(state, run.id);
    finishConfigRun(state, run.id);
    expect(run.status).toBe("cancelled");
    expect(run.result).toContain("迟到结果不会恢复");
  });
  it("不符合实际输出约束的模拟结果不能报成功", () => {
    const state = createSettingsState();
    const prompt = state.entries[2]!;
    prompt.outputSchema = '{"report":"string"}';
    const run = startConfigRun(state, prompt, "success", { context: "x", goal: "x", requirements: "x" }, "p", 13).run!;
    finishConfigRun(state, run.id);
    expect(run.status).toBe("failed");
    expect(run.result).toContain("不满足");
  });
  it("循环依赖、日期冲突和无效前置不写入阶段版本", () => {
    const state = createSettingsState();
    const next = state.stages.map((s) => ({ ...s }));
    next[0]!.predecessorId = next[2]!.id;
    expect(saveStages(state, next)).toContain("阶段依赖存在循环。");
    expect(state.workflowVersion).toBe(1);
    expect(state.stages[0]!.predecessorId).toBe("");
    next[0]!.predecessorId = "missing";
    expect(saveStages(state, next).some((e) => e.includes("不存在或已停用"))).toBe(true);
  });
  it("有效阶段编辑生成新版本且保留原快照", () => {
    const state = createSettingsState();
    const next = state.stages.map((s) => ({ ...s }));
    next[2]!.description = "新的阶段说明";
    expect(saveStages(state, next)).toEqual([]);
    expect(state.workflowVersion).toBe(2);
    expect(state.workflowHistory[0]!.stages[2]!.description).not.toBe("新的阶段说明");
    expect(validateSettingsState(JSON.parse(JSON.stringify(state)))).toBe(true);
  });
  it("损坏的恢复数据被结构校验拒绝", () => {
    const state = createSettingsState();
    expect(validateSettingsState(state)).toBe(true);
    expect(validateSettingsState({ ...state, entries: [{ id: "malformed" }] })).toBe(false);
    expect(validateSettingsState({ ...state, reminder: { enabled: true, cooldownHours: "24", overdueDays: 3 } })).toBe(false);
    const restored = createSettingsState();
    restored.entries[0]!.keyRef = "sk-private";
    expect(validateSettingsState(restored)).toBe(false);
  });
  it("绑定流程按稳定阶段 ID 保留位置，缺失或停用不自动跳到其他阶段", () => {
    const state = createSettingsState();
    const next = state.stages.map((stage) => ({ ...stage }));
    next[2]!.name = "集中撰写";
    expect(saveStages(state, next)).toEqual([]);
    expect(workflowBindingStage(state, 1, "论文撰写")?.name).toBe("集中撰写");
    state.stages[2]!.enabled = false;
    expect(workflowBindingStage(state, 1, "论文撰写")).toBeUndefined();
    expect(workflowBindingStage(state, 1, "论文撰写", state.stages[3]!.id)?.name).toBe("论文提交");
    expect(workflowBindingStage(state, 99, "不存在的阶段")).toBeUndefined();
  });
});
