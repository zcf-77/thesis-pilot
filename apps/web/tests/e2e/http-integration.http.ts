import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { JobRead, ProjectRead } from "../../src/services/index.ts";

async function createProject(page: Page, name: string): Promise<ProjectRead> {
  await page.goto("/#/screens/projects");
  const projects = page.getByTestId("service-projects");
  await expect(projects).toContainText("服务端项目");
  await projects.getByRole("button", { name: "新建项目", exact: true }).click();
  await projects.getByRole("textbox", { name: "项目名称" }).fill(name);
  const response = page.waitForResponse((item) => item.url().endsWith("/api/v1/projects") && item.request().method() === "POST");
  await projects.getByRole("button", { name: "保存名称", exact: true }).click();
  const created = await response;
  expect(created.status()).toBe(201);
  const project = (await created.json()) as ProjectRead;
  expect(project.name).toBe(name);
  expect(project.version).toBe(1);
  return project;
}

async function openJobs(page: Page, name: string) {
  const card = page.getByTestId("service-project-card").filter({ hasText: name });
  await card.getByRole("button", { name: "打开工作区", exact: true }).click();
  await expect(page.getByLabel("论文正文编辑区", { exact: true })).toBeVisible();
  await page.goto("/#/screens/jobs");
  await expect(page.getByTestId("service-jobs").getByRole("button", { name: "运行诊断", exact: true })).toBeEnabled();
}

async function createJob(page: Page): Promise<JobRead> {
  const response = page.waitForResponse((item) => item.url().endsWith("/api/v1/jobs") && item.request().method() === "POST");
  await page.getByTestId("service-jobs").getByRole("button", { name: "运行诊断", exact: true }).click();
  const created = await response;
  expect(created.status()).toBe(202);
  return (await created.json()) as JobRead;
}

test("ENV-005：真实排队任务取消，保留标识供派发后复核", async ({ page }, testInfo) => {
  test.skip(process.env.TP_HTTP_TEST_PHASE !== "queued", "仅在 dispatcher 尚未启动时执行。");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const name = `HTTP取消验收-${randomUUID()}`;
  const project = await createProject(page, name);
  await openJobs(page, name);
  const job = await createJob(page);
  expect(job.project_id).toBe(project.id);
  expect(job.status).toBe("queued");
  expect(job.attempt).toBe(0);
  const jobs = page.getByTestId("service-jobs");
  await page.getByRole("button", { name: /后台任务：1 项运行中/ }).click();
  const tray = page.getByRole("region", { name: "后台任务托盘" });
  const cancelledResponse = page.waitForResponse((item) => item.url().endsWith(`/api/v1/jobs/${job.id}/cancel`) && item.request().method() === "POST");
  await tray.getByTestId("tray-job-row").getByRole("button", { name: "取消", exact: true }).click();
  const cancelled = await cancelledResponse;
  expect(cancelled.status()).toBe(200);
  expect(await cancelled.json()).toMatchObject({ id: job.id, status: "cancelled", attempt: 0 });
  await expect(jobs.getByTestId("service-job-row")).toContainText("已取消");
  await expect(tray.getByTestId("tray-job-row")).toContainText("已取消");
  await tray.getByRole("link", { name: /查看详情/ }).click();
  await expect(jobs.getByText("运行标识与诊断", { exact: true })).toBeVisible();
  await page.reload();
  await expect(jobs.getByTestId("service-job-row")).toContainText("已取消");
  await testInfo.attach("cancelled-job", { body: JSON.stringify({ projectId: project.id, jobId: job.id }), contentType: "application/json" });
  console.log(`HTTP_CANCELLED_JOB_ID=${job.id}`);
  expect(errors).toEqual([]);
});

test("ENV-004/005：真实项目冲突恢复、正文保留与队列结果刷新恢复", async ({ page }, testInfo) => {
  test.skip(process.env.TP_HTTP_TEST_PHASE !== "running", "需要已启动的 dispatcher 和 Linux worker。");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const unique = randomUUID();
  const project = await createProject(page, `HTTP联调-${unique}`);
  const projects = page.getByTestId("service-projects");
  const card = projects.getByTestId("service-project-card").filter({ hasText: unique });
  const nameInput = projects.getByRole("textbox", { name: "项目名称" });
  const save = projects.getByRole("button", { name: "保存名称", exact: true });
  await card.getByRole("button", { name: "修改名称", exact: true }).click();
  await nameInput.fill(`HTTP改名-${unique}`);
  const updatedResponse = page.waitForResponse((item) => item.url().endsWith(`/api/v1/projects/${project.id}`) && item.request().method() === "PATCH");
  await save.click();
  const updated = await updatedResponse;
  expect(updated.status()).toBe(200);
  expect(await updated.json()).toMatchObject({ id: project.id, name: `HTTP改名-${unique}`, version: 2 });
  await expect(card).toContainText("名称 v2");

  await card.getByRole("button", { name: "修改名称", exact: true }).click();
  const draft = `HTTP保留输入-${unique}`;
  await nameInput.fill(draft);
  const external = await page.request.patch(`/api/v1/projects/${project.id}`, { data: { name: `HTTP并发改名-${unique}`, expected_version: 2 } });
  expect(external.status()).toBe(200);
  expect(await external.json()).toMatchObject({ version: 3 });
  const conflictResponse = page.waitForResponse((item) => item.url().endsWith(`/api/v1/projects/${project.id}`) && item.request().method() === "PATCH");
  await save.click();
  const conflict = await conflictResponse;
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toMatchObject({ error: { code: "PROJECT_VERSION_CONFLICT" } });
  await expect(nameInput).toHaveValue(draft);
  await expect(save).toBeDisabled();
  await projects.getByRole("button", { name: "读取最新版本", exact: true }).click();
  await expect(save).toBeEnabled();
  await expect(nameInput).toHaveValue(draft);
  await expect(projects).toContainText(`最新名称为「HTTP并发改名-${unique}」（v3）`);
  const resolvedResponse = page.waitForResponse((item) => item.url().endsWith(`/api/v1/projects/${project.id}`) && item.request().method() === "PATCH");
  await save.click();
  const resolved = await resolvedResponse;
  expect(resolved.status()).toBe(200);
  expect(await resolved.json()).toMatchObject({ id: project.id, name: draft, version: 4 });
  await expect(card).toContainText("名称 v4");

  await card.getByRole("button", { name: "打开工作区", exact: true }).click();
  const editor = page.getByLabel("论文正文编辑区", { exact: true });
  const body = `自制联调正文 ${unique}，保留本机文稿与远端关联。`;
  await editor.fill(body);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("thesispilot.workspace.v1"))).toContain(body);
  const bindingSnapshot = () =>
    page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("thesispilot.workspace.v1")!);
      const current = saved.projects.find((item: { id: string }) => item.id === saved.activeId);
      return { localId: saved.activeId as string, remoteId: current.remoteBinding.projectId as string };
    });
  const originalBinding = await bindingSnapshot();
  expect(originalBinding.remoteId).toBe(project.id);
  await page.goto("/#/screens/projects");
  await card.getByRole("button", { name: "打开工作区", exact: true }).click();
  await expect(editor).toContainText(body);
  await page.reload();
  await expect(editor).toContainText(body);
  expect(await bindingSnapshot()).toEqual(originalBinding);
  await page.goto("/#/screens/jobs");
  await expect(page.getByTestId("service-jobs").getByRole("button", { name: "运行诊断", exact: true })).toBeEnabled();
  const job = await createJob(page);
  expect(job.project_id).toBe(project.id);
  await page.goto("/#/screens/projects");
  await expect(projects).toBeVisible();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/v1/jobs/${job.id}`);
        expect(response.status()).toBe(200);
        return ((await response.json()) as JobRead).status;
      },
      { timeout: 60_000, intervals: [300, 750, 1500] },
    )
    .toBe("succeeded");
  const resultResponse = await page.request.get(`/api/v1/jobs/${job.id}`);
  expect(resultResponse.status()).toBe(200);
  const completed = (await resultResponse.json()) as JobRead;
  expect(completed).toMatchObject({ id: job.id, project_id: project.id, status: "succeeded", attempt: 1, error_code: null });
  expect(completed.result).toMatchObject({
    kind: "diagnostic",
    job_id: job.id,
    project_id: project.id,
    checked: true,
    model_used: false,
    writes_performed: false,
  });
  await page.goto("/#/screens/jobs");
  const jobs = page.getByTestId("service-jobs");
  await expect(jobs.getByTestId("service-job-row")).toHaveCount(1);
  await expect(jobs.getByTestId("service-job-row")).toContainText("已完成");
  await page.reload();
  await expect(jobs.getByTestId("service-job-row")).toContainText("已完成");
  await jobs.getByTestId("service-job-row").getByRole("button", { name: "查看详情", exact: true }).click();
  if (completed.result?.kind !== "diagnostic") throw new Error("诊断响应缺少诊断结果。");
  await expect(jobs).toContainText(completed.result.message);
  await expect(jobs.getByText(job.id, { exact: true })).toBeHidden();
  await jobs.getByText("运行标识与诊断", { exact: true }).click();
  await expect(jobs.getByText(job.id, { exact: true })).toBeVisible();
  const cancellation = await page.request.get(`/api/v1/jobs/${process.env.TP_HTTP_CANCELLED_JOB_ID}`);
  expect(cancellation.status()).toBe(200);
  expect(await cancellation.json()).toMatchObject({ id: process.env.TP_HTTP_CANCELLED_JOB_ID, status: "cancelled", attempt: 0, result: null });
  await testInfo.attach("completed-job", {
    body: JSON.stringify({ projectId: project.id, jobId: job.id, status: completed.status }),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});
