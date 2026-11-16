import { expect, test, type Page } from "@playwright/test";
import type { JobDetail, JobRead } from "../../src/services/index.ts";

const accessKey = process.env.TP_WORKSPACE_TEST_ACCESS_KEY!;
const editor = (page: Page) => page.locator('[aria-label="论文正文编辑区"][contenteditable="true"]');

async function unlock(page: Page) {
  await page.getByLabel("工作区访问口令").fill(accessKey);
  await page.getByRole("button", { name: "解锁工作区" }).click();
  await expect(page.getByLabel("工作区访问口令")).toHaveCount(0);
}

test("本机正式入口读取真实项目、正文与历史，并撤销跨页会话", async ({ page, browser, baseURL }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "论文工作区" })).toBeVisible();
  expect((await page.request.get("/api/v1/projects")).status()).toBe(401);
  await unlock(page);
  await expect(page.getByRole("heading", { name: "论文项目" })).toBeVisible();
  await expect(page.getByRole("link", { name: "设计展台" })).toHaveCount(0);
  if (process.env.TP_WORKSPACE_TEST_EXPECT_EMPTY === "1") await expect(page.getByText("还没有论文项目")).toBeVisible();

  const projectName = `自制写作回归 ${crypto.randomUUID()}`;
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByLabel("项目名称").fill(projectName);
  await page.getByRole("button", { name: "创建项目" }).click();
  await expect(page).toHaveURL(/#\/projects\/[a-f0-9-]+\/write$/);
  const writingUrl = page.url();
  const projectId = writingUrl.match(/\/projects\/([a-f0-9-]+)\/write$/)?.[1];
  if (!projectId) throw new Error("写作入口缺少正式项目标识。");

  await page.getByRole("button", { name: "创建空白正式稿" }).click();
  await expect(editor(page)).toBeVisible();
  await editor(page).fill("这是正式工作区的自制初稿。");
  const firstSave = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes(`/projects/${projectId}/documents/`));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect((await firstSave).status()).toBe(200);

  const manuscript = await page.request.get(`/api/v1/projects/${projectId}/documents/current`);
  const manuscriptInfo = (await manuscript.json()) as { id: string; version: number };
  expect(manuscriptInfo.version).toBe(2);
  const historyUrl = `/#/projects/${projectId}/documents/${manuscriptInfo.id}/versions/1?source=http%3Aworkspace`;

  const other = await browser.newContext({ baseURL });
  try {
    const otherPage = await other.newPage();
    await otherPage.goto(historyUrl);
    await expect(otherPage.getByRole("button", { name: "解锁工作区" })).toBeVisible();
    await unlock(otherPage);
    await expect(otherPage.getByRole("region", { name: "正式稿版本对比" })).toBeVisible();
    await expect(otherPage.getByText("创建空白稿", { exact: true })).toBeVisible();
    await otherPage.goto(writingUrl);
    await expect(editor(otherPage)).toHaveText("这是正式工作区的自制初稿。");

    await page.goto("/#/account");
    const displayName = `写作验证 ${Date.now()}`;
    await page.getByLabel("显示名称").fill(displayName);
    await page.getByRole("button", { name: "保存偏好" }).click();
    await expect(page.getByText("偏好已保存", { exact: false })).toBeVisible();
    await otherPage.goto("/#/account");
    await expect(otherPage.getByLabel("显示名称")).toHaveValue(displayName);

    const tab = await page.context().newPage();
    await tab.goto(writingUrl);
    await expect(editor(tab)).toHaveText("这是正式工作区的自制初稿。");
    await editor(tab).fill("另一窗口尚未保存的自制草稿。");
    await expect(tab.getByText("草稿已保留")).toBeVisible();

    await otherPage.goto(writingUrl);
    await expect(editor(otherPage)).toHaveText("这是正式工作区的自制初稿。");
    await editor(otherPage).fill("当前服务端的自制修订稿。");
    const laterSave = otherPage.waitForResponse(
      (response) => response.request().method() === "PATCH" && response.url().includes(`/projects/${projectId}/documents/`),
    );
    await otherPage.getByRole("button", { name: "保存", exact: true }).click();
    expect((await laterSave).status()).toBe(200);
    const conflictingSave = tab.waitForResponse(
      (response) => response.request().method() === "PATCH" && response.url().includes(`/projects/${projectId}/documents/`),
    );
    await tab.getByRole("button", { name: "保存", exact: true }).click();
    expect((await conflictingSave).status()).toBe(409);
    await expect(editor(tab)).toHaveText("另一窗口尚未保存的自制草稿。");

    const cookies = await page.context().cookies();
    const cookie = cookies.find((item) => item.name === "tp_workspace_session");
    if (!cookie) throw new Error("缺少已建立的工作区会话。");
    expect(cookie.httpOnly).toBe(true);
    await page.getByRole("button", { name: "退出工作区" }).click();
    await expect(page.getByRole("button", { name: "解锁工作区" })).toBeVisible();
    await expect(tab.getByRole("button", { name: "解锁工作区" })).toBeVisible();
    await expect(editor(tab)).toHaveCount(0);
    const replay = await page.request.get(`/api/v1/projects/${projectId}/documents/current`, {
      headers: { Cookie: `${cookie.name}=${cookie.value}` },
    });
    expect(replay.status()).toBe(401);
    expect(replay.headers()["cache-control"]).toBe("no-store");
    expect((await other.request.get(`/api/v1/projects/${projectId}/documents/current`)).status()).toBe(200);

    await unlock(tab);
    await expect(editor(tab)).toHaveText("另一窗口尚未保存的自制草稿。");
    await tab.goto(`/#/projects/${projectId}/documents/${crypto.randomUUID()}/versions/1?source=http%3Aworkspace`);
    await expect(tab.getByText("无法打开版本链接", { exact: true })).toBeVisible();
    await tab.getByRole("button", { name: "返回写作" }).click();

    await tab.setViewportSize({ width: 390, height: 844 });
    await tab.goto("/#/account");
    await tab.getByLabel("减少动效").check();
    for (const theme of ["朱墨", "荧光笔记", "夜航", "晨雾"]) {
      await tab.getByRole("combobox", { name: "主题" }).click();
      await tab.getByRole("option", { name: theme, exact: true }).click();
      await expect(tab.getByRole("combobox", { name: "主题" })).toHaveText(theme);
      expect(await tab.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    }
    await tab.goto(writingUrl);
    await expect(editor(tab)).toBeVisible();
    await tab.getByRole("button", { name: "打开章节目录" }).click();
    const drawer = tab.getByRole("dialog", { name: "章节目录" });
    const drawerClose = drawer.getByRole("button", { name: "关闭章节目录" });
    await expect(drawerClose).toBeVisible();
    await expect(drawer).toHaveCSS("opacity", "1");
    await expect(drawerClose).toBeFocused();
    expect(
      await drawerClose.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        return button.contains(window.document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }),
    ).toBe(true);
    await tab.screenshot({ path: testInfo.outputPath("writing-narrow.png"), animations: "disabled" });
    await tab.keyboard.press("Escape");
    await expect(tab.getByRole("button", { name: "关闭章节目录" })).toHaveCount(0);
    await tab.goto("/");
    await expect(tab).toHaveURL(writingUrl);
  } finally {
    await other.close();
  }
});

test("外壳保留离开前的表单，会话失效后原地解锁，指令面板搜索当前项目对象", async ({ page }) => {
  await page.goto("/");
  await unlock(page);
  const projectId = await page.evaluate(async () => {
    const api = async (path: string, method: string, body: unknown) => {
      const response = await fetch(`/api/v1${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`${method} ${path} ${response.status}`);
      return response.json();
    };
    const project = await api("/projects", "POST", { name: `自制外壳回归 ${crypto.randomUUID()}` });
    await api(`/projects/${project.id}/tasks`, "POST", {
      command_id: crypto.randomUUID(),
      expected_board_version: 0,
      content: { title: "外壳检索的自制任务", acceptance: "人工确认" },
    });
    const heading = { type: "heading", attrs: { level: 2, chapterId: crypto.randomUUID() }, content: [{ type: "text", text: "外壳检索章节" }] };
    await api(`/projects/${project.id}/documents`, "POST", { content: { schema_version: 1, json: { type: "doc", content: [heading] } } });
    return project.id as string;
  });
  const spaces = page.getByRole("navigation", { name: "工作空间" });
  await page.goto(`/#/projects/${projectId}/tasks`);
  await expect(spaces.getByRole("link", { name: "计划" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "提交日期未设置，打开项目设置" })).toBeVisible();
  await expect(page.locator(".workspace-progress").getByText("v1", { exact: true })).toBeVisible();
  const switcher = page.getByRole("button", { name: /^切换论文项目，当前：自制外壳回归/ });
  await switcher.click();
  await page.getByRole("menuitem", { name: "项目目录" }).click();
  await expect(page).toHaveURL(/#\/projects$/);
  await page.getByRole("button", { name: "新建项目" }).first().click();
  await page.getByLabel("项目名称").fill("离开前未提交的项目");
  await spaces.getByRole("link", { name: "配置" }).click();
  await expect(spaces.getByRole("link", { name: "配置" })).toHaveAttribute("aria-current", "page");
  await switcher.click();
  await page.getByRole("menuitem", { name: "项目目录" }).click();
  await expect(page.getByLabel("项目名称")).toHaveValue("离开前未提交的项目");

  expect(await page.evaluate(async () => (await fetch("/api/v1/workspace/session", { method: "DELETE" })).status)).toBe(204);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const dialog = page.getByRole("dialog", { name: "会话已结束" });
  await expect(dialog).toBeVisible();
  expect(await page.locator(".workspace-shell").evaluate((shell) => (shell as HTMLElement).inert)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("工作区访问口令").fill(accessKey);
  await dialog.getByRole("button", { name: "继续工作" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.getByLabel("项目名称")).toHaveValue("离开前未提交的项目");

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "去往你的工作空间" });
  await palette.getByLabel("搜索工作空间").fill("外壳检索");
  await expect(palette.getByRole("region", { name: "任务" }).getByRole("button", { name: "外壳检索的自制任务" })).toBeVisible();
  await expect(palette.getByRole("region", { name: "章节" }).getByRole("button", { name: "外壳检索章节" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/write$`));
  await expect(spaces.getByRole("link", { name: "写作" })).toHaveAttribute("aria-current", "page");
});

const jobStage = process.env.TP_WORKSPACE_TEST_JOB_STAGE;
const tray = (page: Page) => page.getByRole("region", { name: "后台任务托盘" });
const trayTrigger = (page: Page) => page.getByRole("button", { name: /^后台任务：/ });
const jobDetail = (page: Page) => page.getByRole("complementary", { name: "任务详情" });
const jobRow = (page: Page, job: JobRead) => page.getByTestId("workspace-job-row").filter({ has: page.locator(`a[href*="${job.id}"]`) });
const matchWriteRoute = /#\/projects\/([a-f0-9-]+)\/write$/;

async function newProject(page: Page) {
  await page.goto("/#/projects");
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByLabel("项目名称").fill(`自制任务回归 ${crypto.randomUUID()}`);
  await page.getByRole("button", { name: "创建项目" }).click();
  await expect(page).toHaveURL(matchWriteRoute);
  return page.url().match(matchWriteRoute)![1]!;
}

async function prepareInspection(page: Page) {
  await page.goto("/");
  await unlock(page);
  const projectId = await newProject(page);
  await expect(page.getByRole("button", { name: "检查正文结构" })).toHaveCount(0);
  await page.getByRole("button", { name: "创建空白正式稿" }).click();
  await expect(editor(page)).toBeVisible();
  await editor(page).fill("测试😀");
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes(`/${projectId}/documents/`));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("正式稿 v2", { exact: true }).first()).toBeVisible();
  await editor(page).fill("继续编辑的未保存草稿。");
  return projectId;
}

async function submitInspection(page: Page, projectId: string) {
  const accepted = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/v1/jobs"));
  await page.getByRole("button", { name: "检查正文结构" }).click();
  const response = await accepted;
  expect(response.status()).toBe(202);
  const job = (await response.json()) as JobRead;
  expect(job).toMatchObject({ project_id: projectId, kind: "document_inspection", resource_scope: { document_version: 2 } });
  await expect(editor(page)).toHaveText("继续编辑的未保存草稿。");
  await expect(page.getByRole("link", { name: "查看正式稿 v2 的结构检查" })).toBeVisible();
  return job;
}

test("正式托盘取消排队任务并从任务中心重试，保留旧记录", async ({ page }) => {
  test.skip(jobStage !== "queued", "需要运行同源 API，暂缓任务派发。");
  const projectId = await prepareInspection(page);
  const original = await submitInspection(page, projectId);
  await expect(trayTrigger(page)).toHaveAccessibleName(/1 项运行中/);
  await trayTrigger(page).click();
  const trayRow = tray(page).getByTestId("tray-job-row");
  await expect(trayRow).toContainText("排队中");
  const cancelled = page.waitForResponse((response) => response.url().includes(`/jobs/${original.id}/cancel?project_id=${projectId}`));
  await trayRow.getByRole("button", { name: "取消", exact: true }).click();
  expect((await cancelled).status()).toBe(200);
  await expect(trayRow).toContainText("已取消");
  await trayRow.getByRole("link", { name: /查看详情/ }).click();
  await expect(page.getByRole("heading", { name: "执行任务" })).toBeVisible();
  await expect(jobDetail(page)).toContainText("已取消");
  const retried = page.waitForResponse((response) => response.url().includes(`/jobs/${original.id}/retry?project_id=${projectId}`));
  await jobRow(page, original).getByRole("button", { name: "重试任务" }).click();
  const retryResponse = await retried;
  expect(retryResponse.status()).toBe(202);
  const retry = (await retryResponse.json()) as JobRead;
  expect(retry.id).not.toBe(original.id);
  expect(retry).toMatchObject({ source_job_id: original.id, resource_scope: original.resource_scope, configuration: original.configuration });
  await expect(jobRow(page, original)).toContainText("已取消");
  await expect(jobRow(page, retry)).toContainText("排队中");
  await jobRow(page, retry).getByRole("link", { name: "查看详情" }).click();
  await jobDetail(page).getByRole("link", { name: "查看原任务" }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${original.id}\\?source=`));
  await page.getByRole("combobox", { name: "按状态筛选" }).click();
  await page.getByRole("option", { name: "已取消" }).click();
  await expect(page.getByTestId("workspace-job-row")).toHaveCount(1);
  await expect(jobRow(page, original)).toBeVisible();
  await trayTrigger(page).click();
  await expect(tray(page).getByTestId("tray-job-row")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(trayTrigger(page)).toBeFocused();
});

test("按保存版本生成结构统计，刷新和切换项目保持来源", async ({ page, browser, baseURL }, testInfo) => {
  test.skip(jobStage !== "worker", "需要同源 API、任务派发进程和真实 worker。");
  const projectId = await prepareInspection(page);
  const job = await submitInspection(page, projectId);
  const savedLater = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes(`/${projectId}/documents/`));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect((await savedLater).status()).toBe(200);
  await page.getByRole("link", { name: "查看正式稿 v2 的结构检查" }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${job.id}\\?source=`));
  const taskUrl = page.url();
  const detail = jobDetail(page);
  const result = detail.getByTestId("inspection-result");
  await expect(result.getByText("3", { exact: true })).toHaveCount(2, { timeout: 25_000 });
  await expect(detail.getByRole("link", { name: "正式稿 v2" })).toBeVisible();
  const stored = await page.request.get(`/api/v1/jobs/${job.id}?project_id=${projectId}`);
  expect(stored.status()).toBe(200);
  const record = (await stored.json()) as JobDetail;
  expect(record.status).toBe("succeeded");
  expect(record.attempts).toHaveLength(1);
  expect(record.artifacts).toHaveLength(1);
  expect(record.artifacts[0]?.result).toMatchObject({ document_version: 2, node_count: 3, paragraph_count: 1, text_characters: 3 });
  await expect(page.getByText("运行诊断")).toHaveCount(0);

  const later = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  try {
    const second = await later.newPage();
    await second.goto(taskUrl);
    await unlock(second);
    await expect(jobDetail(second).getByTestId("inspection-result")).toBeVisible();
    await second.reload();
    await expect(jobDetail(second).getByTestId("inspection-result")).toBeVisible();
    for (const theme of ["朱墨", "荧光笔记", "夜航", "晨雾"]) {
      await second.goto("/#/account");
      await second.getByRole("combobox", { name: "主题" }).click();
      await second.getByRole("option", { name: theme, exact: true }).click();
      await second.goto(taskUrl);
      const trigger = trayTrigger(second);
      await expect(jobDetail(second).getByTestId("inspection-result")).toBeVisible();
      await trigger.press("Enter");
      const panel = tray(second);
      await expect(panel).toBeFocused();
      expect(await second.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      const rect = await panel.boundingBox();
      expect(rect).not.toBeNull();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
      await expect(panel).toHaveCSS("opacity", "1");
      if (theme === "晨雾") {
        await second.screenshot({ path: testInfo.outputPath("jobs-tray-narrow.png"), animations: "disabled" });
      }
      await second.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    }
    await jobDetail(second).getByRole("link", { name: "正式稿 v2" }).click();
    await expect(second.getByRole("region", { name: "正式稿版本对比" })).toBeVisible();
    const otherProjectId = await newProject(second);
    await second.goto(taskUrl.replace(projectId, otherProjectId));
    await expect(jobDetail(second).getByText("无法读取此任务")).toBeVisible();
    await expect(jobDetail(second).getByTestId("inspection-result")).toHaveCount(0);
    await expect(second.getByText("还没有执行记录")).toBeVisible();
    expect((await second.request.get(`/api/v1/jobs/${job.id}?project_id=${otherProjectId}`)).status()).toBe(404);
  } finally {
    await later.close();
  }
});
