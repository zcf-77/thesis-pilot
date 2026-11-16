import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

async function choose(page: Page, scope: Locator, label: string, value: string) {
  await scope.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}

test("正式四库固定版本、引用与真实提示词任务可恢复", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await page.goto("/");
  await page.getByLabel("工作区访问口令").fill(process.env.TP_WORKSPACE_TEST_ACCESS_KEY!);
  await page.getByRole("button", { name: "解锁工作区" }).click();
  await expect(page.getByRole("heading", { name: "论文项目" })).toBeVisible();
  const suffix = crypto.randomUUID();
  const projectName = `合成四库试跑 ${suffix}`;
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill(projectName);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page).toHaveURL(/\/write$/);
  const projectId = page.url().match(/projects\/([^/]+)\/write/)![1]!;
  await page.goto("/#/configurations");
  const form = page.getByRole("region", { name: "配置编辑", exact: true });
  const created: Record<string, { id: string; name: string; current_version_id: string; version: number }> = {};
  async function save(kind: string, name: string) {
    await form.getByLabel("配置名称").fill(name);
    const response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/api/v1/ai-configs");
    await form.getByRole("button", { name: "创建配置", exact: true }).click();
    const received = await response;
    expect(received.status()).toBe(201);
    created[kind] = await received.json();
    await expect(form).toHaveCount(0);
  }
  await page.getByRole("tab", { name: "AI 接口", exact: true }).click();
  await page.getByRole("button", { name: "新增AI 接口", exact: true }).click();
  await save("api", `合成接口 ${suffix}`);
  await page.getByRole("tab", { name: "模型", exact: true }).click();
  await page.getByRole("button", { name: "新增模型", exact: true }).click();
  await choose(page, form, "接口版本", `${created.api!.name} · v1`);
  await save("model", `合成模型 ${suffix}`);
  await page.getByRole("tab", { name: "提示词", exact: true }).click();
  await page.getByRole("button", { name: "新增提示词", exact: true }).click();
  await form.getByLabel("提示词模板").fill("合成试跑：{{context}}");
  await form.getByRole("checkbox", { name: "context · 背景", exact: true }).check();
  await form.getByRole("checkbox", { name: "goal · 目标", exact: true }).uncheck();
  await save("prompt", `合成提示词 ${suffix}`);
  await page.getByRole("tab", { name: "智能体", exact: true }).click();
  await page.getByRole("button", { name: "新增智能体", exact: true }).click();
  await choose(page, form, "模型版本", `${created.model!.name} · v1`);
  await choose(page, form, "提示词版本", `${created.prompt!.name} · v1`);
  await form.getByLabel("智能体职责").fill("仅检查当前显式提供的合成文本，返回建议。");
  await save("agent", `合成智能体 ${suffix}`);
  await page.getByRole("tab", { name: "提示词", exact: true }).click();
  await page.getByRole("button", { name: created.prompt!.name, exact: true }).click();
  const references = await page.request.get(`/api/v1/ai-configs/${created.prompt!.id}/references`);
  expect((await references.json()).configs.some((item: { config_id: string }) => item.config_id === created.agent!.id)).toBe(true);
  const probe = page.getByRole("region", { name: "配置试跑", exact: true });
  await choose(page, probe, "试跑项目", projectName);
  await probe.getByLabel("试跑变量 JSON").fill(JSON.stringify({ context: "数字42仅为自制示例" }));
  const submitted = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/api/v1/jobs");
  await probe.getByRole("button", { name: "发起配置试跑" }).click();
  const receipt = await submitted;
  expect(receipt.status()).toBe(202);
  const jobId = (await receipt.json()).id as string;
  await expect
    .poll(async () => (await (await page.request.get(`/api/v1/jobs/${jobId}?project_id=${projectId}`)).json()).status, { timeout: 45000 })
    .toBe("succeeded");
  await probe.getByRole("button", { name: "刷新试跑状态" }).click();
  await expect(probe.getByRole("region", { name: "试跑任务结果" })).toContainText("数字42仅为自制示例");
  const result = await (await page.request.get(`/api/v1/jobs/${jobId}?project_id=${projectId}`)).json();
  expect(result.artifacts[0].result).toMatchObject({
    model_used: false,
    writes_performed: false,
    config_kind: "prompt",
    config_version_id: created.prompt!.current_version_id,
  });
  expect((await page.request.get(`/api/v1/projects/${projectId}/documents/current`)).status()).toBe(404);
  await page.screenshot({ path: testInfo.outputPath("configuration-prompt-result.png"), fullPage: true });
  await page.reload();
  await page.getByRole("tab", { name: "提示词", exact: true }).click();
  await expect(page.getByRole("button", { name: created.prompt!.name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: created.prompt!.name, exact: true }).click();
  const detail = page.getByRole("region", { name: "配置详情", exact: true });
  await expect(detail.getByRole("button", { name: "编辑当前版本", exact: true })).toBeEnabled();
  await detail.getByRole("button", { name: "编辑当前版本", exact: true }).click();
  await form.getByLabel("提示词模板").fill("合成试跑第二版：{{context}}");
  const edited = page.waitForResponse(
    (item) => item.request().method() === "PATCH" && new URL(item.url()).pathname === `/api/v1/ai-configs/${created.prompt!.id}`,
  );
  await form.getByRole("button", { name: "保存配置新版本", exact: true }).click();
  const editedResponse = await edited;
  expect(editedResponse.status()).toBe(200);
  const promptV2 = await editedResponse.json();
  expect(promptV2.version).toBe(2);
  expect(promptV2.current_version_id).not.toBe(created.prompt!.current_version_id);
  await expect(form).toHaveCount(0);
  await choose(page, detail, "比较基准版本", `v1 · ${created.prompt!.name}`);
  const comparison = detail.getByRole("region", { name: "版本比较", exact: true });
  await expect(comparison).toContainText("v1 → v2 变化");
  await expect(comparison).toContainText("合成试跑：{{context}}");
  await expect(comparison).toContainText("合成试跑第二版：{{context}}");
  const originalVersion = await (await page.request.get(`/api/v1/ai-configs/${created.prompt!.id}/versions/1`)).json();
  expect(originalVersion).toMatchObject({ id: created.prompt!.current_version_id, version: 1, content: { template: "合成试跑：{{context}}" } });
  expect((await (await page.request.get(`/api/v1/ai-configs/${created.agent!.id}`)).json()).content.prompt_version_id).toBe(created.prompt!.current_version_id);

  // Copy the selected immutable v1 rather than silently copying the latest v2.
  await choose(page, detail, "查看配置版本", `v1 · ${created.prompt!.name}`);
  await detail.getByRole("button", { name: "复制所选版本", exact: true }).click();
  const copyForm = detail.getByRole("form", { name: "复制配置", exact: true });
  const copiedName = `合成提示词副本 ${suffix}`;
  await copyForm.getByLabel("副本名称").fill(copiedName);
  const copied = page.waitForResponse(
    (item) => item.request().method() === "POST" && new URL(item.url()).pathname === `/api/v1/ai-configs/${created.prompt!.id}/copies`,
  );
  await copyForm.getByRole("button", { name: "创建独立副本", exact: true }).click();
  const copiedResponse = await copied;
  expect(copiedResponse.status()).toBe(201);
  const copy = await copiedResponse.json();
  expect(copy).toMatchObject({ name: copiedName, version: 1, content: { template: "合成试跑：{{context}}" } });
  expect(copy.id).not.toBe(created.prompt!.id);
  await expect(detail.getByRole("heading", { name: copiedName, exact: true })).toBeVisible();
  await page.getByRole("button", { name: created.prompt!.name, exact: true }).click();
  await expect(detail.getByRole("heading", { name: created.prompt!.name, exact: true })).toBeVisible();
  await expect(detail.getByRole("combobox", { name: "查看配置版本", exact: true })).toHaveText(`v2 · ${created.prompt!.name}`);
  const disabled = page.waitForResponse(
    (item) => item.request().method() === "PATCH" && new URL(item.url()).pathname === `/api/v1/ai-configs/${created.prompt!.id}`,
  );
  await detail.getByRole("button", { name: "停用配置", exact: true }).click();
  const disabledResponse = await disabled;
  expect(disabledResponse.status()).toBe(200);
  expect(await disabledResponse.json()).toMatchObject({ enabled: false, version: 3 });
  await expect(detail.getByRole("button", { name: "启用配置", exact: true })).toBeVisible();
  await expect(probe.getByRole("button", { name: "发起配置试跑", exact: true })).toBeDisabled();
  await choose(page, detail, "查看配置版本", `v1 · ${created.prompt!.name}`);
  await expect(detail.getByRole("heading", { name: "v1 内容（只读）", exact: true })).toBeVisible();
  expect(await (await page.request.get(`/api/v1/ai-configs/${created.prompt!.id}/versions/1`)).json()).toEqual(originalVersion);
  expect((await (await page.request.get(`/api/v1/ai-configs/${created.agent!.id}`)).json()).content.prompt_version_id).toBe(created.prompt!.current_version_id);
  const restored = page.waitForResponse(
    (item) => item.request().method() === "PATCH" && new URL(item.url()).pathname === `/api/v1/ai-configs/${created.prompt!.id}`,
  );
  await detail.getByRole("button", { name: "启用配置", exact: true }).click();
  const restoredResponse = await restored;
  expect(restoredResponse.status()).toBe(200);
  expect(await restoredResponse.json()).toMatchObject({ enabled: true, version: 4 });
  await expect(detail.getByRole("button", { name: "停用配置", exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/v1/ai-configs/${created.agent!.id}`)).json()).content.prompt_version_id).toBe(created.prompt!.current_version_id);
  await page.screenshot({ path: testInfo.outputPath("configuration-version-lifecycle.png"), fullPage: true });

  const availabilityResponse = await page.request.get("/api/v1/ai-configs/availability");
  expect(availabilityResponse.status()).toBe(200);
  const availability = (await availabilityResponse.json()) as { provider: string; credential_configured: boolean };
  let missingCredentialBranch = "not-run-credentials-configured";
  if (!availability.credential_configured) {
    await page.getByRole("tab", { name: "模型", exact: true }).click();
    await page.getByRole("button", { name: created.model!.name, exact: true }).click();
    await choose(page, probe, "试跑项目", projectName);
    await probe.getByLabel("试跑变量 JSON").fill(JSON.stringify({ context: "仅验证服务器缺失凭据，不读取正文。" }));
    const modelSubmitted = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/api/v1/jobs");
    await probe.getByRole("button", { name: "发起配置试跑", exact: true }).click();
    const modelResponse = await modelSubmitted;
    expect(modelResponse.status()).toBe(202);
    const modelJob = await modelResponse.json();
    await expect
      .poll(async () => (await (await page.request.get(`/api/v1/jobs/${modelJob.id}?project_id=${projectId}`)).json()).status, { timeout: 45000 })
      .toBe("failed");
    const failedModelJob = await (await page.request.get(`/api/v1/jobs/${modelJob.id}?project_id=${projectId}`)).json();
    expect(failedModelJob).toMatchObject({
      error_code: "MODEL_NOT_CONFIGURED",
      input_snapshot: { config_version_id: created.model!.current_version_id },
      result: null,
    });
    await probe.getByRole("button", { name: "刷新试跑状态", exact: true }).click();
    await expect(probe.getByRole("region", { name: "试跑任务结果", exact: true })).toContainText("MODEL_NOT_CONFIGURED");
    const retried = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === `/api/v1/jobs/${modelJob.id}/retry`);
    await probe.getByRole("button", { name: "重试固定输入", exact: true }).click();
    const retryResponse = await retried;
    expect(retryResponse.status()).toBe(202);
    const retryJob = await retryResponse.json();
    expect(retryJob.id).not.toBe(modelJob.id);
    expect(retryJob.source_job_id).toBe(modelJob.id);
    expect(retryJob.input_snapshot).toEqual(modelJob.input_snapshot);
    expect(retryJob.configuration).toEqual(modelJob.configuration);
    await expect
      .poll(async () => (await (await page.request.get(`/api/v1/jobs/${retryJob.id}?project_id=${projectId}`)).json()).status, { timeout: 45000 })
      .toBe("failed");
    expect((await (await page.request.get(`/api/v1/jobs/${retryJob.id}?project_id=${projectId}`)).json()).error_code).toBe("MODEL_NOT_CONFIGURED");
    await probe.getByRole("button", { name: "刷新试跑状态", exact: true }).click();
    await expect(probe.getByRole("region", { name: "试跑任务结果", exact: true })).toContainText("MODEL_NOT_CONFIGURED");
    missingCredentialBranch = "passed-real-missing-credential-and-explicit-retry";
    await page.screenshot({ path: testInfo.outputPath("configuration-model-missing-credential.png"), fullPage: true });
  } else {
    testInfo.annotations.push({ type: "未运行", description: "服务器已有模型凭据，未自动发起收费模型请求；缺凭据失败与重试分支未执行。" });
  }
  console.info(`模型缺凭据分支：${missingCredentialBranch}`);
  const conditionalCoverage = testInfo.outputPath("configuration-conditional-coverage.json");
  await writeFile(
    conditionalCoverage,
    JSON.stringify(
      {
        provider: availability.provider,
        credential_configured: availability.credential_configured,
        missingCredentialBranch,
        agentPromptVersionPreserved: created.prompt!.current_version_id,
      },
      null,
      2,
    ),
  );
  await testInfo.attach("configuration-conditional-coverage", { path: conditionalCoverage, contentType: "application/json" });
  expect((await page.request.get(`/api/v1/projects/${projectId}/documents/current`)).status()).toBe(404);
});
