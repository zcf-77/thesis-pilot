import { chooseOption } from "./select-option.ts";
import { expect, test } from "@playwright/test";
import { appUrl } from "./app-url.ts";

const screens = ["plan", "library", "feedback"];

for (const width of [390, 1024, 1440]) {
  test(`三个页面在 ${width}px 可读、可导航且无页面溢出`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    for (const screen of screens) {
      await page.goto(appUrl("/screens/" + screen));
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator('.screens-nav a[aria-current="page"]')).toHaveAttribute("href", "#/screens/" + screen);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.getByRole("button", { name: /^外观/ }).click();
      await expect(page.getByRole("toolbar", { name: "切换设计方案" })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}

test("从首页打开新设计、切换页面与主题、刷新并返回目录", async ({ page }) => {
  await page.goto(appUrl("/"));
  await page.getByRole("link", { name: /打开全套页面设计/ }).click();
  await expect(page.locator("h1")).toHaveText("今天，向前一步。");
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "资料", exact: true }).click();
  await page.getByRole("button", { name: /^外观/ }).click();
  for (const [name, id] of [
    ["夜航", "yehang"],
    ["晨雾", "chenwu"],
    ["荧光笔记", "yingguang"],
    ["朱墨", "zhumo"],
  ]) {
    await page.getByRole("button", { name: "切换到方案：" + name }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    await expect(page.locator(".library-paper")).toBeVisible();
  }
  await page.reload();
  await expect(page.locator(".library-page h1")).toBeVisible();
  await page.getByRole("link", { name: "返回设计展台", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "展台目录" })).toBeVisible();
});

test("计划候选预览不修改当前版本，采纳与撤销保持明确", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-14T12:00:00+08:00"));
  await page.goto(appUrl("/screens/plan"));
  await page.getByRole("button", { name: "查看调整" }).click();
  await expect(page.locator(".plan-version")).toHaveText("计划 v4");
  await expect(page.locator(".plan-proposal__changes > div")).toHaveCount(4);
  await page.getByRole("button", { name: "采纳这份调整" }).click();
  await expect(page.locator(".plan-version")).toHaveText("计划 v5");
  await expect(page.locator(".plan-bar.is-candidate")).toHaveCount(0);
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "资料", exact: true }).click();
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "计划", exact: true }).click();
  await expect(page.locator(".plan-version")).toHaveText("计划 v5");
  await page.getByRole("button", { name: "撤销本次采纳" }).click();
  await expect(page.locator(".plan-version")).toHaveText("计划 v6");
  await page.getByRole("radio", { name: "待核验", exact: true }).click();
  await expect(page.locator(".plan-task")).toHaveCount(1);
});

test("资料搜索空态可恢复，选中模板与要求来源对应版本", async ({ page }) => {
  await page.goto(appUrl("/screens/library"));
  await page.getByRole("searchbox", { name: "搜索项目资料" }).fill("不存在的资料xyz");
  await expect(page.getByText("没有找到相关资料")).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(page.locator(".library-file-row")).toHaveCount(5);
  await page.locator(".library-file-row").filter({ hasText: "毕业论文模板" }).click();
  await expect(page.locator(".library-paper-title")).toHaveText("毕业论文模板（理工类）");
  await expect(page.locator(".library-paper-number")).toHaveText("M2 / V03");
  await page.getByRole("tab", { name: /论文要求/ }).click();
  await expect(page.getByText(/字号、页边距.*保留为未检查/).first()).toBeVisible();
  await page.getByRole("tab", { name: /文献索引/ }).click();
  await page.locator(".library-literature-row").filter({ hasText: "校园场景下" }).click();
  await expect(page.locator(".library-detail").getByText(/只取得摘要/)).toBeVisible();
});

test("反馈需核对后由学生标记，撤销保留证据，歧义和缺证据阻止确认", async ({ page }) => {
  await page.goto(appUrl("/screens/feedback"));
  const decide = page.getByRole("button", { name: "标记已处理", exact: true });
  await expect(decide).toBeDisabled();
  await page.getByRole("checkbox", { name: "我已核对修改与这条意见一致" }).check();
  await decide.click();
  await expect(page.getByText("这是你的处理声明，不代表导师已认可。")).toBeVisible();
  await page.getByRole("button", { name: "撤销处理声明" }).click();
  await expect(decide).toBeDisabled();
  await expect(page.locator(".feedback-evidence__chips .tp-evi")).toHaveCount(2);
  await expect(page.locator(".feedback-evidence__chips")).toContainText("3.1 架构说明 v13");
  await page.locator(".feedback-item").filter({ hasText: "增加对比实验的基线" }).click();
  await expect(decide).toBeDisabled();
  await page.locator(".feedback-item").filter({ hasText: "那个图" }).click();
  await chooseOption(page.getByLabel("根据你掌握的上下文，补充位置"), { label: "3.1 总体架构" });
  await page.getByRole("button", { name: "保存定位", exact: true }).click();
  await expect(page.locator(".feedback-location")).toContainText("3.1 总体架构");
  await expect(decide).toBeDisabled();
});
