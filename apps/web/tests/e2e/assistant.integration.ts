import { expect, test, type Locator, type Page } from "@playwright/test";
import { manuscript, replaceManuscript } from "./writing-helpers.ts";

async function choose(page: Page, scope: Locator, label: string, option: string) {
  const control = scope.getByRole("combobox", { name: label, exact: true });
  await expect(control).toBeEnabled();
  await control.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("真实内容会话保留独立草稿、固定输入及缺凭据失败重试", async ({ page }, testInfo) => {
  test.skip(process.env.TP_WORKSPACE_TEST_MODEL_STAGE !== "missing", "需要明确选择专用无模型凭据验收阶段。");
  // SG-22：写作步骤已换成纸面交互；“内容助手”改由写作副驾面板（切片 C）提供，协调者登记面板后按副驾标签更新入口并去掉此标记。
  test.fixme(true, "依赖切片 C 的写作副驾内容助手面板");
  test.setTimeout(150000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.getByLabel("工作区访问口令").fill(process.env.TP_WORKSPACE_TEST_ACCESS_KEY!);
  await page.getByRole("button", { name: "解锁工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
  const suffix = crypto.randomUUID();
  const origin = process.env.TP_WORKSPACE_TEST_ORIGIN!;
  // Real configuration records with synthetic text; no provider credential enters the browser.
  async function config(name: string, content: Record<string, unknown>) {
    const response = await page.request.post("/api/v1/ai-configs", { headers: { Origin: origin }, data: { name: `${name} ${suffix}`, content } });
    expect(response.status()).toBe(201);
    return (await response.json()) as { id: string; current_version_id: string; name: string };
  }
  const api = await config("合成助手接口", { kind: "api", max_retries: 2 });
  const model = await config("合成内容模型", { kind: "model", api_version_id: api.current_version_id, model_code: "deepseek-flash", capabilities: ["text"] });
  const prompt = await config("合成内容提示", {
    kind: "prompt",
    template: "按明确目标处理合成选区。目标：{{goal}}；背景：{{context}}",
    variables: ["goal", "context"],
  });
  const agent = await config("合成内容助手", {
    kind: "agent",
    role: "content",
    instructions: "只返回指定合成选区的建议，不改数字、引用或锁定内容。",
    model_version_id: model.current_version_id,
    prompt_version_id: prompt.current_version_id,
  });
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill(`合成内容会话 ${suffix}`);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page).toHaveURL(/\/write$/);
  const projectId = page.url().match(/projects\/([^/]+)\/write/)![1]!;
  const root = `/api/v1/projects/${projectId}`;
  await page.getByRole("button", { name: "创建空白正式稿", exact: true }).click();
  const editor = manuscript(page);
  const text = "本研究采用方法甲。这是自制内容助手验收文本。";
  await replaceManuscript(page, text);
  const saving = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.startsWith(`${root}/documents/`),
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect((await saving).status()).toBe(200);
  const original = await (await page.request.get(`${root}/documents/current`)).json();
  // 空白稿 v1 → 显式升级 v2 → 首次保存 v3。
  expect(original.version).toBe(3);
  await page.getByRole("button", { name: "内容助手", exact: true }).click();
  const workspace = page.getByRole("region", { name: "内容助手工作区", exact: true });
  async function session(title: string) {
    await workspace.getByLabel("会话名称").fill(title);
    const created = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `${root}/assistant-sessions`,
    );
    await workspace.getByRole("button", { name: "创建内容助手会话", exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    return (await response.json()) as { id: string };
  }
  const titleA = `合成会话甲 ${suffix}`;
  const titleB = `合成会话乙 ${suffix}`;
  const firstSession = await session(titleA);
  const paneA = page.getByRole("region", { name: `内容助手会话：${titleA}`, exact: true });
  await paneA.getByLabel("内容修订目标（本机草稿）").fill("仅润色当前合成选区，保留原意。");
  await session(titleB);
  const paneB = page.getByRole("region", { name: `内容助手会话：${titleB}`, exact: true });
  await paneB.getByLabel("内容修订目标（本机草稿）").fill("另一会话独立草稿，暂不发送。");
  await expect(paneA.getByLabel("内容修订目标（本机草稿）")).toHaveValue("仅润色当前合成选区，保留原意。");
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await paneA.getByRole("button", { name: "使用当前已保存选区", exact: true }).click();
  await paneA.getByRole("button", { name: "选择配置与资料上下文", exact: true }).click();
  await choose(page, paneA, "内容助手配置版本", `${agent.name} · v1`);
  await paneA.getByRole("checkbox", { name: "我已确认本次固定上下文", exact: true }).check();
  const started = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `${root}/assistant-sessions/${firstSession.id}/runs`,
  );
  await paneA.getByRole("button", { name: "发送选区修订", exact: true }).click();
  const startResponse = await started;
  expect(startResponse.status()).toBe(202);
  const receipt = await startResponse.json();
  async function run(id: string) {
    const response = await page.request.get(`${root}/assistant-runs/${id}`);
    expect(response.status()).toBe(200);
    return await response.json();
  }
  await expect.poll(async () => (await run(receipt.run.id)).status, { timeout: 45000 }).toBe("failed");
  expect(await run(receipt.run.id)).toMatchObject({ error_code: "MODEL_NOT_CONFIGURED", result_message_id: null, document_version: 2 });
  await paneA.getByRole("button", { name: "刷新运行状态", exact: true }).click();
  await expect(paneA).toContainText("MODEL_NOT_CONFIGURED");
  const fixedContext = await (await page.request.get(`${root}/assistant-runs/${receipt.run.id}/context`)).json();
  expect(fixedContext.input).toMatchObject({
    document_id: original.id,
    document_version: 2,
    agent_config_version_id: agent.current_version_id,
    source_binding_version_id: null,
    material_sources: [],
    selection: { text },
  });
  expect((await (await page.request.get(`${root}/assistant-sessions/${firstSession.id}/messages`)).json()).total).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("assistant-fixed-context-failure.png"), fullPage: true });
  await page.goto(`/#/projects/${projectId}/write?assistantSessionId=${firstSession.id}&assistantRunId=${receipt.run.id}`);
  await page.reload();
  await expect(paneA).toBeVisible();
  await expect(paneA).toContainText("MODEL_NOT_CONFIGURED");
  const retried = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `${root}/assistant-runs/${receipt.run.id}/retry`,
  );
  await paneA.getByRole("button", { name: "重试固定输入", exact: true }).click();
  const retryResponse = await retried;
  expect(retryResponse.status()).toBe(202);
  const retry = await retryResponse.json();
  expect(retry.run.id).not.toBe(receipt.run.id);
  expect(retry.run.source_run_id).toBe(receipt.run.id);
  await expect.poll(async () => (await run(retry.run.id)).status, { timeout: 45000 }).toBe("failed");
  expect(await run(retry.run.id)).toMatchObject({ error_code: "MODEL_NOT_CONFIGURED", result_message_id: null });
  expect((await (await page.request.get(`${root}/assistant-runs/${retry.run.id}/context`)).json()).input).toEqual(fixedContext.input);
  expect((await (await page.request.get(`${root}/assistant-sessions/${firstSession.id}/messages`)).json()).total).toBe(1);
  expect(await (await page.request.get(`${root}/documents/current`)).json()).toEqual(original);
  await paneA.getByRole("button", { name: "刷新运行状态", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("assistant-fixed-retry-preserves-manuscript.png"), fullPage: true });
});
