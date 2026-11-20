import { expect, test, type Page } from "@playwright/test";

/**
 * SG-09 反馈页“整理意见建议”真实 HTTP/数据库/队列回归。
 * - TP_WORKSPACE_TEST_MODEL_STAGE=missing：服务无模型凭据，整理必须明确失败、不产生建议，可按原输入重试。
 * - TP_WORKSPACE_TEST_MODEL_STAGE=real：服务持有测试密钥，对自制反馈真实拆解，逐项采纳/拒绝/撤销。
 * 其他阶段跳过；缺凭据断言不能在有密钥的服务上冒充，真实模型断言也不能在无密钥服务上冒充。
 */
const stage = process.env.TP_WORKSPACE_TEST_MODEL_STAGE;
const ORIGINAL = ["第二章研究方法写得太笼统，请补充样本选择的依据和样本数量。", "图3-2 的坐标轴没有标注单位。", "结论部分有点空，再想想。"].join("\n");

async function api(page: Page, method: "GET" | "POST", path: string, data?: unknown) {
  const origin = new URL(page.url()).origin;
  const response = await page.request.fetch(`/api/v1${path}`, { method, data, headers: { Origin: origin } });
  expect(response.ok(), `${method} ${path} ${response.status()}`).toBe(true);
  return response.json();
}

async function prepare(page: Page) {
  const suffix = crypto.randomUUID().slice(0, 8);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/projects");
  await page.getByLabel("工作区访问口令").fill(process.env.TP_WORKSPACE_TEST_ACCESS_KEY!);
  await page.getByRole("button", { name: "解锁工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "论文项目", exact: true }).first()).toBeVisible();
  const project = await api(page, "POST", "/projects", { name: `合成反馈整理 ${suffix}` });
  const batch = await api(page, "POST", `/projects/${project.id}/feedback`, { command_id: crypto.randomUUID(), expected_version: 0, original_text: ORIGINAL });
  const existing = (await api(page, "GET", "/ai-configs?kind=agent&limit=100&offset=0")).items.filter(
    (item: { enabled: boolean; content: { role?: string } }) => item.enabled && item.content.role === "content",
  );
  if (!existing.length) {
    await page.goto(`/#/projects/${project.id}/feedback`);
    const panel = page.getByRole("region", { name: "意见整理建议" });
    await expect(panel.getByRole("link", { name: /去配置台添加/ })).toBeVisible();
    await expect(panel.getByRole("button", { name: "整理意见建议" })).toHaveCount(0);
  }
  const provider = await api(page, "POST", "/ai-configs", { name: `合成整理接口 ${suffix}`, content: { kind: "api", max_retries: 1, timeout_seconds: 120 } });
  const model = await api(page, "POST", "/ai-configs", {
    name: `合成整理模型 ${suffix}`,
    content: { kind: "model", api_version_id: provider.current_version_id, model_code: "deepseek-flash", capabilities: ["text"], temperature: 0.2 },
  });
  const prompt = await api(page, "POST", "/ai-configs", {
    name: `合成整理提示词 ${suffix}`,
    content: { kind: "prompt", template: "请按固定规则拆解以下导师反馈分句数据：{{context}}", variables: ["context"] },
  });
  const agent = await api(page, "POST", "/ai-configs", {
    name: `合成整理智能体 ${suffix}`,
    content: {
      kind: "agent",
      role: "content",
      instructions: "只拆解导师反馈，不改写原文。",
      model_version_id: model.current_version_id,
      prompt_version_id: prompt.current_version_id,
    },
  });
  await page.goto(`/#/projects/${project.id}/feedback`);
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByRole("heading", { name: "导师反馈", exact: true })).toBeVisible();
  const panel = page.getByRole("region", { name: "意见整理建议" });
  const select = panel.getByRole("combobox", { name: "整理智能体" });
  if (await select.isVisible()) {
    await select.click();
    await page.getByRole("option", { name: new RegExp(`合成整理智能体 ${suffix}`) }).click();
  }
  return { project, batch, agent, panel, root: `/projects/${project.id}` };
}

test("反馈整理：无凭据明确失败、不产生建议，可按原输入重试", async ({ page }, testInfo) => {
  test.skip(stage !== "missing", "需要明确选择专用无模型凭据验收阶段。");
  test.setTimeout(120000);
  const { batch, agent, panel, root } = await prepare(page);
  const created = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/v1${root}/feedback/${batch.id}/splits`);
  await panel.getByRole("button", { name: "整理意见建议", exact: true }).click();
  const receipt = await (await created).json();
  expect(receipt.split).toMatchObject({ batch_id: batch.id, agent_config_version_id: agent.current_version_id, suggestions: [] });
  expect(receipt.job.kind).toBe("feedback_decomposition");
  const banner = page.getByRole("region", { name: "反馈整理状态" });
  await expect(banner).toContainText("整理未完成", { timeout: 30000 });
  await expect(banner).toContainText("模型服务尚未配置可用凭据");
  await expect(page.getByRole("region", { name: "文字录入状态" })).toContainText("尚未整理");
  await page.screenshot({ path: testInfo.outputPath("feedback-split-missing.png"), fullPage: true });
  const failed = await api(page, "GET", `${root}/feedback-splits/${receipt.split.id}`);
  expect(failed).toMatchObject({ status: "failed", error_code: "MODEL_NOT_CONFIGURED", suggestions: [] });
  expect((await api(page, "GET", `${root}/feedback/${batch.id}/items?limit=20&offset=0`)).total).toBe(0);

  const retried = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith(`/feedback-splits/${receipt.split.id}/retry`),
  );
  await banner.getByRole("button", { name: "按原输入重试" }).click();
  const retry = await (await retried).json();
  expect(retry.split).toMatchObject({ source_split_id: receipt.split.id, batch_id: batch.id });
  await expect(banner).toContainText("整理未完成", { timeout: 30000 });
  expect((await api(page, "GET", `${root}/feedback/${batch.id}/splits?limit=10&offset=0`)).total).toBe(2);
  expect((await api(page, "GET", `${root}/feedback/${batch.id}`)).original_text).toBe(ORIGINAL);
});

test("反馈整理：真实模型拆解为铅笔建议，逐项采纳/拒绝/撤销后才改变正式解释项", async ({ page }, testInfo) => {
  test.skip(stage !== "real", "需要明确选择持有测试密钥的真实模型验收阶段。");
  test.setTimeout(240000);
  const { batch, panel, root } = await prepare(page);
  await panel.getByRole("button", { name: "整理意见建议", exact: true }).click();
  const list = panel.getByRole("list", { name: "拆解建议" });
  await expect(list).toBeVisible({ timeout: 180000 });
  await page.screenshot({ path: testInfo.outputPath("feedback-split-real.png"), fullPage: true });
  const split = (await api(page, "GET", `${root}/feedback/${batch.id}/splits?limit=1&offset=0`)).items[0];
  expect(split).toMatchObject({ status: "succeeded", requested_model: "deepseek-flash" });
  expect(split.suggestions.length).toBeGreaterThan(0);
  for (const item of split.suggestions) {
    // 服务器已核对：区间在原文内、逐字匹配、互不重叠。
    expect(ORIGINAL.slice(item.source_range.from, item.source_range.to)).toBe(item.source_range.text);
    expect(item.state).toBe("pending");
  }
  expect((await api(page, "GET", `${root}/feedback/${batch.id}/items?limit=20&offset=0`)).total).toBe(0);

  const card = (n: number) => list.getByRole("listitem", { name: `拆解建议 ${n}`, exact: true });
  await card(1).getByRole("button", { name: "采纳", exact: true }).click();
  await expect(page.getByRole("button", { name: /查看反馈 F-01\.1/ })).toBeVisible();
  const total = split.suggestions.length;
  if (total > 1) {
    await card(total).getByRole("button", { name: "拒绝", exact: true }).click();
    await expect(card(total)).toContainText("你已拒绝");
  }
  let items = (await api(page, "GET", `${root}/feedback/${batch.id}/items?limit=20&offset=0`)).items;
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ origin: "ai_suggested", status: "open" });
  expect(items[0].review_reasons).toContain("缺少处理证据");
  await card(1).getByRole("button", { name: "撤销采纳" }).click();
  await expect(card(1).getByRole("button", { name: "采纳", exact: true })).toBeVisible();
  items = (await api(page, "GET", `${root}/feedback/${batch.id}/items?limit=20&offset=0`)).items;
  expect(items[0]).toMatchObject({ origin: "ai_suggested", status: "withdrawn", version: 2 });
  await page.screenshot({ path: testInfo.outputPath("feedback-split-real-decided.png"), fullPage: true });
  const after = (await api(page, "GET", `${root}/feedback-splits/${split.id}`)).suggestions[0];
  expect(after.history.map((value: { action: string }) => value.action)).toEqual(["adopt", "undo"]);
  expect((await api(page, "GET", `${root}/feedback/${batch.id}`)).original_text).toBe(ORIGINAL);
});
