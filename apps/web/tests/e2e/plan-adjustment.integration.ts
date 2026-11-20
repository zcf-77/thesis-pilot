import { expect, test, type Page } from "@playwright/test";

/**
 * SG-10 计划页真实 HTTP/数据库/队列回归。数据全部自制合成。
 * 默认只验证不调用模型的部分；`TP_WORKSPACE_TEST_MODEL_STAGE=missing` 验证缺凭据明确失败，
 * `=real` 才发起一次真实模型调用并走完审阅、采纳与撤销。其余情况对应用例跳过，不计为通过。
 */
const stage = process.env.TP_WORKSPACE_TEST_MODEL_STAGE;

async function api(page: Page, method: "GET" | "POST" | "PUT", path: string, data?: unknown) {
  const origin = new URL(page.url()).origin;
  const response = await page.request.fetch(`/api/v1${path}`, { method, data, headers: { Origin: origin } });
  expect(response.ok(), `${method} ${path} ${response.status()}`).toBe(true);
  return response.json();
}
const pad = (n: number) => String(n).padStart(2, "0");
function day(offset: number) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function unlock(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/projects");
  await page.getByLabel("工作区访问口令").fill(process.env.TP_WORKSPACE_TEST_ACCESS_KEY!);
  await page.getByRole("button", { name: "解锁工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
}

async function seed(page: Page, suffix: string) {
  const project = await api(page, "POST", "/projects", { name: `合成计划 ${suffix}`, deadline: day(25) });
  const tasks: { id: string; version: number; content: { title: string } }[] = [];
  for (const [index, content] of [
    { title: `文献综述 ${suffix}`, start_date: day(-3), due_date: day(2) },
    { title: `实验方案 ${suffix}`, start_date: day(3), due_date: day(8), hard_deadline: day(10) },
    { title: `初稿第三章 ${suffix}`, start_date: day(9), due_date: day(16) },
  ].entries()) {
    tasks.push(
      await api(page, "POST", `/projects/${project.id}/tasks`, {
        command_id: crypto.randomUUID(),
        expected_board_version: index,
        content: { acceptance: "形成可核对的合成产物。", depends_on: index ? [tasks[index - 1]!.id] : [], ...content },
      }),
    );
  }
  return { project, tasks };
}

async function progressAgent(page: Page, suffix: string) {
  const provider = await api(page, "POST", "/ai-configs", { name: `合成进度接口 ${suffix}`, content: { kind: "api", max_retries: 1, timeout_seconds: 60 } });
  const model = await api(page, "POST", "/ai-configs", {
    name: `合成进度模型 ${suffix}`,
    content: { kind: "model", api_version_id: provider.current_version_id, model_code: "deepseek-flash", capabilities: ["plan"], max_output_tokens: 2048 },
  });
  const prompt = await api(page, "POST", "/ai-configs", {
    name: `合成进度提示词 ${suffix}`,
    content: { kind: "prompt", template: "请依据固定输入提出计划调整候选：{{context}}", variables: ["context"] },
  });
  return api(page, "POST", "/ai-configs", {
    name: `合成进度智能体 ${suffix}`,
    content: {
      kind: "agent",
      role: "progress",
      instructions: "只提出计划建议。",
      model_version_id: model.current_version_id,
      prompt_version_id: prompt.current_version_id,
    },
  });
}

test("计划页：个人规划原地编辑、两周时间轴、手动批量调整版本与提醒参数", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const suffix = crypto.randomUUID().slice(0, 8);
  await unlock(page);
  const { project, tasks } = await seed(page, suffix);
  await page.goto(`/#/projects/${project.id}/tasks`);
  await expect(page.getByRole("heading", { name: "计划与进度" })).toBeVisible();
  const timeline = page.getByRole("region", { name: "把时间留给重要的事" });
  await expect(timeline.getByRole("button", { name: new RegExp(`实验方案 ${suffix}`) }).first()).toBeVisible();
  await expect(timeline.getByRole("img", { name: `任务硬截止 ${day(10)}` })).toBeVisible();
  await expect(timeline).toContainText(`论文提交 ${day(25)}`);
  await expect(timeline).toContainText("计划 v0");

  const planning = page.getByRole("region", { name: "个人规划" });
  await planning.getByRole("button", { name: "设置个人规划" }).click();
  await planning.getByRole("radio", { name: "填写规划" }).click();
  await planning.getByLabel(/可用时间与安排/).fill("草稿，不保存");
  await planning.getByLabel(/可用时间与安排/).press("Escape");
  await expect(planning).toContainText("按任务与截止时间安排");
  await planning.getByRole("button", { name: "设置个人规划" }).click();
  await planning.getByRole("radio", { name: "填写规划" }).click();
  await planning.getByLabel(/可用时间与安排/).fill("每周三、周六安排实验。");
  await planning.getByRole("button", { name: "保存规划" }).click();
  await expect(planning).toContainText("每周三、周六安排实验。");
  expect(await api(page, "GET", `/projects/${project.id}`)).toMatchObject({ planning_mode: "personal", plan_note: "每周三、周六安排实验。" });

  const conflict = await page.request.fetch(`/api/v1/projects/${project.id}/plan/schedule`, {
    method: "POST",
    headers: { Origin: new URL(page.url()).origin },
    data: {
      command_id: crypto.randomUUID(),
      changes: [{ task_id: tasks[0]!.id, expected_version: 1, start_date: day(-3), due_date: day(5) }],
    },
  });
  expect(conflict.status()).toBe(422);
  expect((await conflict.json()).error.code).toBe("PLAN_CONSTRAINT_VIOLATION");
  const version = await api(page, "POST", `/projects/${project.id}/plan/schedule`, {
    command_id: crypto.randomUUID(),
    reason: "按导师意见提前完成综述",
    changes: [{ task_id: tasks[0]!.id, expected_version: 1, start_date: day(-3), due_date: day(1) }],
  });
  expect(version).toMatchObject({ version: 1, action: "manual" });
  await page.getByRole("button", { name: "刷新任务" }).click();
  await expect(timeline).toContainText("计划 v1");
  await page.getByRole("button", { name: /计划历史/ }).click();
  await page.getByRole("button", { name: /v1 · 手动调整/ }).click();
  await expect(page.getByRole("region", { name: "计划历史" })).toContainText(`文献综述 ${suffix}`);
  await page.screenshot({ path: testInfo.outputPath("plan-manual-history.png"), fullPage: true });

  const original = await api(page, "GET", "/reminder-settings");
  await page.goto("/#/configurations?tab=business");
  const form = page.getByRole("form", { name: "提醒参数" });
  await expect(form).toBeVisible();
  await form.getByLabel("同类事件冷却时间（小时）").fill("200");
  await form.getByRole("button", { name: "保存提醒参数" }).click();
  await expect(form.getByRole("alert")).toContainText("1—168");
  await form.getByLabel("同类事件冷却时间（小时）").fill("12");
  await form.getByLabel("明显延期阈值（天）").fill("3");
  await form.getByRole("button", { name: "保存提醒参数" }).click();
  await expect(form.getByRole("status")).toContainText(`v${original.version + 1}`);
  expect(await api(page, "GET", "/reminder-settings")).toMatchObject({ cooldown_hours: 12, overdue_days: 3 });
  // Restore the workspace-wide defaults this run changed so other regressions keep their assumptions.
  await api(page, "PUT", "/reminder-settings", {
    expected_version: original.version + 1,
    enabled: original.enabled,
    cooldown_hours: original.cooldown_hours,
    overdue_days: original.overdue_days,
  });
});

test("计划调整缺凭据：生成明确失败，原计划不变", async ({ page }) => {
  test.skip(stage !== "missing", "需要明确选择专用无模型凭据验收阶段。");
  const suffix = crypto.randomUUID().slice(0, 8);
  await unlock(page);
  const { project, tasks } = await seed(page, suffix);
  const agent = await progressAgent(page, suffix);
  await page.goto(`/#/projects/${project.id}/tasks`);
  const panel = page.locator("section.plan-proposal");
  if (await panel.getByRole("combobox", { name: "进度智能体" }).isVisible()) {
    await panel.getByRole("combobox", { name: "进度智能体" }).click();
    await page.getByRole("option", { name: new RegExp(`合成进度智能体 ${suffix}`) }).click();
  }
  await panel.getByRole("button", { name: "请 AI 提出调整" }).click();
  await expect(panel).toContainText("这次没有生成候选", { timeout: 30000 });
  await expect(panel).toContainText("模型服务尚未配置可用凭据");
  const latest = (await api(page, "GET", `/projects/${project.id}/plan/adjustments?limit=1&offset=0`)).items[0];
  expect(latest).toMatchObject({ state: "failed", error_code: "MODEL_NOT_CONFIGURED", proposal: null, agent_config_version_id: agent.current_version_id });
  for (const task of tasks) expect((await api(page, "GET", `/projects/${project.id}/tasks/${task.id}`)).version).toBe(1);
});

test("计划调整真实模型：候选经程序检查，逐项采纳原子写入并可撤销", async ({ page }, testInfo) => {
  test.skip(stage !== "real", "真实模型调用只在显式 MODEL_STAGE=real 的正式实例执行。");
  test.setTimeout(240000);
  const suffix = crypto.randomUUID().slice(0, 8);
  await unlock(page);
  const { project, tasks } = await seed(page, suffix);
  // 一项已过期任务给模型调整空间；硬截止与依赖由服务端程序检查。
  await api(page, "POST", `/projects/${project.id}/tasks`, {
    command_id: crypto.randomUUID(),
    expected_board_version: 3,
    content: { title: `数据整理 ${suffix}`, acceptance: "形成可核对的合成产物。", start_date: day(-6), due_date: day(-1), status: "doing" },
  });
  const agent = await progressAgent(page, suffix);
  await page.goto(`/#/projects/${project.id}/tasks`);
  const panel = page.locator("section.plan-proposal");
  if (await panel.getByRole("combobox", { name: "进度智能体" }).isVisible()) {
    await panel.getByRole("combobox", { name: "进度智能体" }).click();
    await page.getByRole("option", { name: new RegExp(`合成进度智能体 ${suffix}`) }).click();
  }
  await panel.getByRole("button", { name: "请 AI 提出调整" }).click();
  await expect(panel.getByText(/等你决定|生成失败/).first()).toBeVisible({ timeout: 150000 });
  const adjustment = (await api(page, "GET", `/projects/${project.id}/plan/adjustments?limit=1&offset=0`)).items[0];
  expect(adjustment).toMatchObject({ state: "pending", agent_config_version_id: agent.current_version_id, decision: null });
  expect(adjustment.response_model).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("plan-real-candidate.png"), fullPage: true });
  for (const task of tasks) expect((await api(page, "GET", `/projects/${project.id}/tasks/${task.id}`)).version).toBe(1);
  type Item = { id: string; task_id: string | null; blocked: boolean; after: { start_date: string | null; due_date: string | null } };
  const usable = (adjustment.proposal.items as Item[]).filter((item) => !item.blocked);
  for (const item of usable) for (const value of [item.after.start_date, item.after.due_date]) if (value) expect(value <= day(25)).toBe(true);
  if (!usable.length) {
    await panel.getByRole("button", { name: "暂时保留原计划" }).click();
    await expect(panel).toContainText("已保留原计划");
    return;
  }
  await panel.getByRole("button", { name: /采纳所选/ }).click();
  await expect(panel.getByText("已采纳").first()).toBeVisible({ timeout: 15000 });
  const plan = await api(page, "GET", `/projects/${project.id}/plan`);
  expect(plan.plan_version).toBe(1);
  for (const item of usable) {
    const task = await api(page, "GET", `/projects/${project.id}/tasks/${item.task_id}`);
    expect(task.content).toMatchObject(item.after);
  }
  await page.screenshot({ path: testInfo.outputPath("plan-real-adopted.png"), fullPage: true });
  await panel.getByRole("button", { name: "撤销本次采纳" }).click();
  await expect(panel).toContainText("已撤销这次采纳");
  expect((await api(page, "GET", `/projects/${project.id}/plan`)).plan_version).toBe(2);
  const versions = await api(page, "GET", `/projects/${project.id}/plan/versions?limit=20&offset=0`);
  expect(versions.items.map((item: { action: string }) => item.action)).toEqual(["revert", "adopt"]);
});
