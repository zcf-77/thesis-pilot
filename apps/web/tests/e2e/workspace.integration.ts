import { expect, test, type Page } from "@playwright/test";

const accessKey = process.env.TP_WORKSPACE_TEST_ACCESS_KEY!;
const editor = (page: Page) => page.locator('[aria-label="论文正文编辑区"][contenteditable="true"]');

async function unlock(page: Page) {
  await page.getByLabel("工作区访问口令").fill(accessKey);
  await page.getByRole("button", { name: "解锁工作区" }).click();
  await expect(page.getByRole("button", { name: "解锁工作区" })).toHaveCount(0);
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
