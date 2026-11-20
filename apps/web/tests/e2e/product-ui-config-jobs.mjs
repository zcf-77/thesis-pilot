import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite-plus";

const port = 41751;
const origin = `http://127.0.0.1:${port}`;
const output = path.resolve("test-results/product-ui-config-jobs");
const projectName = "界面验收 · 自制论文项目";
const promptName = "合成内容提示词 · 固定变量与结构";
const agentName = "内容修订智能体 · 用于检查较长配置名称在列表和详情中的完整换行";
const flowName = "合成毕业论文流程";
const session = {
  workspace_id: "15e786c6-7ed2-4058-8bef-00fa087ae510",
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  profile: {
    id: "15e786c6-7ed2-4058-8bef-00fa087ae510",
    display_name: "界面验收",
    notifications_enabled: true,
    quiet_start: "22:00",
    quiet_end: "08:00",
    show_deferred: true,
    version: 1,
  },
};

/** In-memory test transforms only. Repository source and real services remain untouched. */
const harness = {
  name: "product-ui-config-jobs-harness",
  transform(code, id) {
    const file = id.replaceAll("\\", "/");
    if (file.endsWith("/src/services/runtime.ts")) {
      return code.replace('const configuredMode = workspace ? "http" : import.meta.env.VITE_SERVICE_MODE || "preview";', 'const configuredMode = "mock";');
    }
    if (file.endsWith("/src/workspace/WorkspaceApp.vue")) {
      return code.replace('const services = runtime.mode === "http" ? runtime.services : null;', "const services = runtime.services;");
    }
    if (file.endsWith("/src/services/workspace.ts")) {
      return code.replace(
        'return verifySession(await request(sessionPath, "SessionRead", "GET", undefined, signal));',
        `return verifySession(${JSON.stringify(session)});`,
      );
    }
    if (file.endsWith("/src/workspace-main.ts")) {
      const mount = 'createApp(WorkspaceRoot).use(createPinia()).use(formalRouter).mount("#app");';
      if (!code.includes(mount)) throw new Error("验收入口未匹配");
      return `${code.replace(mount, "")}
import { useBackendServices } from "./services/runtime";
async function boot() {
  const api = useBackendServices().services;
  if (!api) throw new Error("Mock 服务未初始化");
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  const flow = await api.projectFlows.create({ name: ${JSON.stringify(flowName)}, stages: [
    { id: first, name: "开题", description: "核对选题与依据", deliverables: ["开题报告"], conditions: ["学生确认材料完整"], dependencies: [], start: null, deadline: "2027-01-15", enabled: true },
    { id: second, name: "论文撰写", description: "完成正文并核对证据", deliverables: ["论文草稿"], conditions: ["学生确认当前版本"], dependencies: [first], start: "2027-01-16", deadline: "2027-04-30", enabled: true }
  ] });
  const project = await api.projects.create({ name: ${JSON.stringify(projectName)}, title: "基于固定样例的界面验收", flow_version_id: flow.current_version_id, stage_id: first });
  const provider = await api.aiConfigs.create({ name: "合成接口 · 不保存凭据", content: { kind: "api", description: "仅用于本地界面验收" } });
  const model = await api.aiConfigs.create({ name: "合成文本模型", content: { kind: "model", api_version_id: provider.current_version_id, model_code: "deepseek-flash", capabilities: ["text"], description: "固定接口版本" } });
  const prompt = await api.aiConfigs.create({ name: ${JSON.stringify(promptName)}, content: { kind: "prompt", template: "依据 {{context}} 回应 {{goal}}", variables: ["context", "goal"], description: "固定输入，不改正式稿" } });
  await api.aiConfigs.create({ name: ${JSON.stringify(agentName)}, content: { kind: "agent", role: "content", instructions: "仅依据固定输入提出候选", model_version_id: model.current_version_id, prompt_version_id: prompt.current_version_id, allowed_tools: ["read_context", "return_suggestion"], description: "候选必须由学生审阅" } });
  const invalid = await api.aiConfigs.create({ name: "合成失败结果 · 输出结构不匹配", content: { kind: "prompt", template: "{{context}}", variables: ["context"], output_schema: { summary: "string" } } });
  await api.jobs.create({ project_id: project.id, kind: "configuration_probe", input_snapshot: { schema_version: 1, config_version_id: prompt.current_version_id, variables: { context: "合成背景", goal: "给出建议" } } }, "product-ui-ready");
  await api.jobs.create({ project_id: project.id, kind: "configuration_probe", input_snapshot: { schema_version: 1, config_version_id: invalid.current_version_id, variables: { context: "合成失败输入" } } }, "product-ui-failed");
  await new Promise((resolve) => setTimeout(resolve, 2500));
  window.__productUiProject = project.id;
  createApp(WorkspaceRoot).use(createPinia()).use(formalRouter).mount("#app");
}
void boot();`;
    }
    return undefined;
  },
};

let server;
let browser;
const errors = [];
const checks = [];
try {
  server = await createServer({
    configFile: path.resolve("vite.config.ts"),
    mode: "workspace",
    plugins: [harness],
    server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: { ignored: ["**/*"] } },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/#/configurations`);
  await expect(page.getByRole("heading", { name: "配置台", exact: true })).toBeVisible({ timeout: 20_000 });
  const projectId = await page.evaluate(() => window.__productUiProject);
  if (!projectId) throw new Error("未建立隔离验收项目");

  async function go(hash, heading) {
    await page.evaluate((next) => {
      location.hash = next;
    }, hash);
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    await page.waitForFunction(() => !document.querySelector(".workspace-loading"));
    if (hash === "#/flows") await expect(page.getByRole("region", { name: "流程列表", exact: true })).toBeVisible();
    else if (hash.includes("/jobs")) await expect(page.getByRole("region", { name: "项目任务", exact: true })).toBeVisible();
    else if (hash.includes("tab=business")) await expect(page.getByRole("form", { name: "提醒参数", exact: true })).toBeVisible();
    else if (hash.includes("tab=runs")) await expect(page.getByRole("region", { name: "运行记录", exact: true })).toBeVisible();
    else if (hash.includes("/configurations")) await expect(page.getByRole("region", { name: "配置列表", exact: true })).toBeVisible();
    // Nested out-in transitions can outlive route and list readiness, especially in 晨雾.
    await page.waitForTimeout(700);
  }
  async function choose(scope, label, option) {
    await scope.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  }
  async function noOverflow(name) {
    const size = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    if (size.content > size.viewport) throw new Error(`${name} 横向溢出：${size.content}/${size.viewport}`);
  }
  async function screenshot(name) {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false, animations: "disabled" });
    await noOverflow(name);
  }

  // Immutable editing, historical comparison and copying stay available in the compact layout.
  await go("#/configurations?kind=prompt", "配置台");
  await page.getByRole("button", { name: promptName, exact: true }).click();
  await page.getByRole("button", { name: "编辑当前版本", exact: true }).click();
  const editor = page.getByRole("region", { name: "配置编辑", exact: true });
  await editor.getByLabel("配置说明").fill("第二版仍使用固定输入");
  await editor.getByRole("button", { name: "保存配置新版本", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const detail = page.getByRole("region", { name: "配置详情", exact: true });
  await expect(detail.getByRole("heading", { name: "v2 内容（只读）", exact: true })).toBeVisible();
  await choose(detail, "比较基准版本", `v1 · ${promptName}`);
  await expect(detail.getByRole("region", { name: "版本比较", exact: true })).toContainText("v1 → v2");
  await choose(detail, "查看配置版本", `v1 · ${promptName}`);
  await detail.getByRole("button", { name: "复制所选版本", exact: true }).click();
  const copy = detail.getByRole("form", { name: "复制配置", exact: true });
  await copy.getByLabel("副本名称").fill("合成提示词独立副本");
  await copy.getByRole("button", { name: "创建独立副本", exact: true }).click();
  await expect(detail.getByRole("heading", { name: "合成提示词独立副本", exact: true })).toBeVisible();
  checks.push("配置编辑、版本比较、历史复制");

  // Disabled references block new trials and never silently switch versions.
  await page.getByRole("button", { name: promptName, exact: true }).click();
  await detail.getByRole("button", { name: "停用配置", exact: true }).click();
  await page.getByRole("tab", { name: "智能体", exact: true }).click();
  await page.getByRole("button", { name: agentName, exact: true }).click();
  await expect(detail.getByRole("region", { name: "配置关联", exact: true })).toContainText("已停用");
  await expect(detail.getByRole("button", { name: "发起配置试跑", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "提示词", exact: true }).click();
  await page.getByRole("button", { name: promptName, exact: true }).click();
  await detail.getByRole("button", { name: "启用配置", exact: true }).click();
  const probe = detail.getByRole("region", { name: "配置试跑", exact: true });
  await choose(probe, "试跑项目", projectName);
  await probe.getByLabel("试跑变量 JSON").fill(JSON.stringify({ context: "合成研究背景", goal: "提出一条修改建议" }));
  await probe.getByRole("button", { name: "发起配置试跑", exact: true }).click();
  const result = probe.getByRole("region", { name: "试跑任务结果", exact: true });
  await expect(result).toBeVisible();
  await result.getByRole("button", { name: "取消试跑", exact: true }).click();
  await expect(result).toContainText("已取消");
  await result.getByRole("button", { name: "重试固定输入", exact: true }).click();
  await expect(result).toContainText("已完成", { timeout: 15_000 });
  await expect(result).toContainText("合成研究背景");
  await expect(result.getByText("deepseek-default", { exact: true })).toHaveCount(0);
  checks.push("停用关联、固定输入试跑、服务端取消与原输入重试");

  // Flow history is read-only and enable/disable is independent from stage editing.
  await go("#/flows", "配置台");
  await page.getByRole("listitem").filter({ hasText: flowName }).getByRole("button", { name: "管理流程", exact: true }).click();
  const flow = page.getByRole("region", { name: "流程编辑", exact: true });
  await flow.getByRole("article", { name: "阶段 2", exact: true }).getByLabel("阶段名称").fill("集中写作");
  await flow.getByRole("button", { name: "保存新版本", exact: true }).click();
  await expect(flow.getByRole("status")).toContainText("不可变版本 v2");
  await flow.getByText("查看流程历史", { exact: true }).click();
  await choose(flow, "历史版本（只读）", `v1 · ${flowName}`);
  const history = flow.getByRole("region", { name: "历史版本（只读）", exact: true });
  await expect(history).toContainText("论文撰写 · 启用");
  await expect(history).not.toContainText("集中写作 · 启用");
  await flow.getByRole("button", { name: "停用流程", exact: true }).click();
  await expect(flow.getByRole("status").filter({ hasText: "流程已停用" })).toBeVisible();
  checks.push("流程升版、只读历史与独立停用");

  await go("#/configurations?tab=business", "配置台");
  const reminder = page.getByRole("form", { name: "提醒参数", exact: true });
  await reminder.getByLabel("同类事件冷却时间（小时）").fill("200");
  await reminder.getByRole("button", { name: "保存提醒参数", exact: true }).click();
  await expect(reminder.getByRole("alert")).toContainText("1—168");
  await reminder.getByLabel("同类事件冷却时间（小时）").fill("12");
  await reminder.getByRole("button", { name: "保存提醒参数", exact: true }).click();
  await expect(reminder.getByRole("status")).toContainText("v1");
  await reminder.getByLabel("明显延期阈值（天）").fill("7");
  await reminder.getByRole("button", { name: "保存提醒参数", exact: true }).click();
  await expect(reminder.getByRole("status").filter({ hasText: "v2" })).toBeVisible();
  checks.push("提醒参数错误与版本化保存");

  await go(`#/projects/${projectId}/jobs`, "执行任务");
  await choose(page, "按状态筛选", "失败");
  const failedRow = page.getByTestId("workspace-job-row").filter({ hasText: "失败" });
  await expect(failedRow).toHaveCount(1);
  await failedRow.getByRole("link", { name: "配置试跑", exact: true }).click();
  const jobDetail = page.getByRole("complementary", { name: "输入与诊断", exact: true });
  await expect(jobDetail.getByRole("heading", { name: "每次尝试", exact: true })).toBeVisible();
  await expect(jobDetail).toContainText("重试原固定输入");
  await expect(jobDetail.getByRole("link", { name: "打开配置台", exact: true })).toBeVisible();
  await choose(page, "按状态筛选", "全部状态");
  await choose(page, "按类型筛选", "配置试跑");
  await expect(page.getByTestId("workspace-job-row").first()).toBeVisible();
  checks.push("任务状态／类型筛选、失败详情与恢复路径");

  await go("#/configurations?kind=agent", "配置台");
  const agentTab = page.getByRole("tab", { name: "智能体", exact: true });
  await agentTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "提示词", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(agentTab).toHaveAttribute("aria-selected", "true");
  const enabledFilter = page.getByRole("combobox", { name: "配置启停筛选", exact: true });
  await enabledFilter.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await expect(enabledFilter).toHaveAttribute("aria-expanded", "false");
  await expect(enabledFilter).toHaveAttribute("data-value", "all");
  await expect(enabledFilter).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(enabledFilter).toHaveAttribute("data-value", "disabled");
  const clear = page.getByRole("button", { name: "清除筛选", exact: true });
  await expect(clear).toBeVisible();
  await clear.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: agentName, exact: true })).toBeVisible();
  checks.push("键盘标签切换、下拉取消／选择及筛选恢复");

  // Real Vue transitions, not temporary CSS classes.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await go("#/account", "账户与偏好");
  const reduced = page.getByLabel("减少动效");
  if (!(await reduced.isChecked())) await reduced.check();
  await go("#/configurations?kind=api", "配置台");
  const tab = page.getByRole("tab", { name: "模型", exact: true });
  await tab.click();
  const durations = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.effect?.target instanceof Element && animation.effect.target.closest(".settings-page"))
      .map((animation) => Number(animation.effect?.getComputedTiming().duration ?? 0)),
  );
  if (durations.some((duration) => duration > 120)) throw new Error(`减弱动效超过 120ms：${durations.join(",")}`);
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  checks.push(`真实减弱动效（${durations.length} 项，均不超过 120ms）`);

  const themes = [
    ["zhumo", "朱墨"],
    ["yingguang", "荧光笔记"],
    ["yehang", "夜航"],
    ["chenwu", "晨雾"],
  ];
  for (const [id, label] of themes) {
    await go("#/account", "账户与偏好");
    await choose(page, "主题", label);
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    await go("#/configurations?kind=agent", "配置台");
    await expect(page.getByRole("button", { name: agentName, exact: true })).toBeVisible();
    await screenshot(`${id}-configurations-desktop`);
    await go("#/flows", "配置台");
    await screenshot(`${id}-flows-desktop`);
    await go(`#/projects/${projectId}/jobs`, "执行任务");
    await screenshot(`${id}-jobs-desktop`);
    await page.setViewportSize({ width: 390, height: 844 });
    await go("#/configurations?kind=agent", "配置台");
    await screenshot(`${id}-configurations-390`);
    await go("#/flows", "配置台");
    await screenshot(`${id}-flows-390`);
    await go(`#/projects/${projectId}/jobs`, "执行任务");
    await screenshot(`${id}-jobs-390`);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  checks.push("四主题 × 三页 × 桌面／390px 截图与横向溢出检查");

  await go("#/flows", "配置台");
  await page.getByRole("listitem").filter({ hasText: flowName }).getByRole("button", { name: "管理流程", exact: true }).click();
  await expect(page.getByRole("region", { name: "流程编辑", exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await screenshot("flow-editor-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot("flow-editor-390");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go(`#/projects/${projectId}/jobs`, "执行任务");
  await choose(page, "按状态筛选", "失败");
  await page.getByTestId("workspace-job-row").getByRole("link", { name: "配置试跑", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "输入与诊断", exact: true }).getByRole("heading", { name: "每次尝试", exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await screenshot("job-detail-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot("job-detail-390");
  checks.push("流程编辑器与任务详情专项截图");
  if (errors.length) throw new Error(`浏览器异常：${errors.join("；")}`);
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "results.json"), JSON.stringify({ checks, errors }, null, 2) + "\n");
  console.log(`PASS: ${checks.length} 组检查；截图与结果位于 ${output}`);
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}
