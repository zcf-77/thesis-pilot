import { expect, test, type Page } from "@playwright/test";

/**
 * 正式评审页真实 HTTP/数据库/队列回归。本机无模型凭据时评审必须明确失败、不生成报告；
 * 本用例不证明真实模型调用成功。
 */
const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { chapterId: "intro", level: 1 }, content: [{ type: "text", text: "第一章 引言" }] },
    { type: "paragraph", content: [{ type: "text", text: "合成背景：本研究采用方法甲，样本量 42。" }] },
    { type: "heading", attrs: { chapterId: "method", level: 1 }, content: [{ type: "text", text: "第二章 方法" }] },
    { type: "paragraph", content: [{ type: "text", text: "合成方法段落，仅用于回归。" }] },
  ],
};

async function api(page: Page, method: "GET" | "POST", path: string, data?: unknown) {
  const origin = new URL(page.url()).origin;
  const response = await page.request.fetch(`/api/v1${path}`, { method, data, headers: { Origin: origin } });
  expect(response.ok(), `${method} ${path} ${response.status()}`).toBe(true);
  return response.json();
}

async function reviewAgent(page: Page, suffix: string) {
  const provider = await api(page, "POST", "/ai-configs", { name: `合成评审接口 ${suffix}`, content: { kind: "api", max_retries: 1 } });
  const model = await api(page, "POST", "/ai-configs", {
    name: `合成评审模型 ${suffix}`,
    content: { kind: "model", api_version_id: provider.current_version_id, model_code: "deepseek-flash", capabilities: ["review"] },
  });
  const prompt = await api(page, "POST", "/ai-configs", {
    name: `合成评审提示词 ${suffix}`,
    content: { kind: "prompt", template: "请评审：{{context}}", variables: ["context"] },
  });
  return api(page, "POST", "/ai-configs", {
    name: `合成评审智能体 ${suffix}`,
    content: {
      kind: "agent",
      role: "review",
      instructions: "只评审，不改稿。",
      model_version_id: model.current_version_id,
      prompt_version_id: prompt.current_version_id,
    },
  });
}

test("评审页：无智能体入口、固定版本发起、无凭据明确失败与按原输入重试", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const suffix = crypto.randomUUID().slice(0, 8);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/projects");
  await page.getByLabel("工作区访问口令").fill(process.env.TP_WORKSPACE_TEST_ACCESS_KEY!);
  await page.getByRole("button", { name: "解锁工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
  const project = await api(page, "POST", "/projects", { name: `合成评审 ${suffix}` });
  const document = await api(page, "POST", `/projects/${project.id}/documents`, { content: { schema_version: 1, json: doc } });
  await page.goto(`/#/projects/${project.id}/review`);
  await expect(page.getByRole("heading", { name: "论文评审", exact: true })).toBeVisible();
  await expect(page.getByText("从第一份评审开始")).toBeVisible();

  const form = page.getByRole("form", { name: "新建评审" });
  const existingAgents = (await api(page, "GET", "/ai-configs?kind=agent&limit=100&offset=0")).items.filter(
    (item: { enabled: boolean; content: { role?: string } }) => item.enabled && item.content.role === "review",
  );
  if (!existingAgents.length) {
    await page.getByRole("button", { name: "新建评审", exact: true }).click();
    await expect(form.getByRole("link", { name: "去配置台添加" })).toBeVisible();
    await expect(form.getByRole("button", { name: "开始评审" })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("review-no-agent.png"), fullPage: true });
  }
  const agent = await reviewAgent(page, suffix);
  await page.reload();
  await expect(page.getByRole("heading", { name: "论文评审", exact: true })).toBeVisible();
  if (!(await form.isVisible())) await page.getByRole("button", { name: "新建评审", exact: true }).click();
  await form.getByRole("combobox", { name: "评审范围" }).click();
  await page.getByRole("option", { name: "第二章 方法", exact: true }).click();
  await form.getByRole("combobox", { name: "评审智能体" }).click();
  await page.getByRole("option", { name: new RegExp(`合成评审智能体 ${suffix}`) }).click();
  await expect(form).toContainText(`正文 v${document.version}`);
  const created = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/v1/projects/${project.id}/reviews`);
  await form.getByRole("button", { name: "开始评审" }).click();
  const receipt = await (await created).json();
  expect(receipt.review).toMatchObject({ chapter_id: "method", document_version: 1, agent_config_version_id: agent.current_version_id });
  await expect(form).toBeHidden();

  const banner = page.getByRole("region", { name: "评审执行状态" });
  await expect(banner).toContainText("评审失败", { timeout: 30000 });
  await expect(banner).toContainText("模型服务尚未配置可用凭据");
  await expect(page.getByText("评审失败，未生成报告", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("review-failed.png"), fullPage: true });
  const failed = await api(page, "GET", `/projects/${project.id}/reviews/${receipt.review.id}`);
  expect(failed).toMatchObject({ status: "failed", error_code: "MODEL_NOT_CONFIGURED", report_id: null });
  const report = await page.request.get(`/api/v1/projects/${project.id}/reviews/${receipt.review.id}/report`);
  expect(report.status()).toBe(404);
  expect((await api(page, "GET", `/projects/${project.id}/documents/current`)).version).toBe(1);

  const retried = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith(`/reviews/${receipt.review.id}/retry`));
  await banner.getByRole("button", { name: "按原输入重试" }).click();
  const retry = await (await retried).json();
  expect(retry.review).toMatchObject({ source_review_id: receipt.review.id, chapter_id: "method", document_version: 1 });
  await expect(page.getByRole("button", { name: /第二章 方法/ })).toHaveCount(2);
  await expect(banner).toContainText("评审失败", { timeout: 30000 });
  await page.getByLabel("搜索评审历史").fill("不存在的范围");
  await expect(page.getByText("没有匹配的记录")).toBeVisible();
  await page.getByRole("button", { name: "清除搜索" }).click();
  await expect(page.getByRole("button", { name: /第二章 方法/ })).toHaveCount(2);
  const page2 = await api(page, "GET", `/projects/${project.id}/reviews?limit=20&offset=0`);
  expect(page2.total).toBe(2);
  expect((await api(page, "GET", `/projects/${project.id}/documents/current`)).version).toBe(1);
});
