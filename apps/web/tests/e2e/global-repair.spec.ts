import { expect, test } from "@playwright/test";
import { appUrl } from "./app-url.ts";

test("全局航线展示绑定阶段、真实保存，指令可以定位正文与任务", async ({ page }) => {
  await page.goto(appUrl("/screens/write"));
  const route = page.getByRole("list", { name: "毕设流程阶段" });
  await expect(route.locator("li")).toHaveCount(6);
  await expect(route.locator('[aria-current="step"]')).toContainText("论文撰写");
  await expect(page.locator(".project-progress__saved")).toContainText("已保存");
  await page.getByRole("button", { name: "搜索页面（Ctrl K）" }).click();
  await page.getByLabel("搜索工作空间").fill("总体架构");
  await expect(page.locator(".studio-command")).toHaveCount(1);
  await page.getByLabel("搜索工作空间").press("Enter");
  await expect(page).toHaveURL(/chapter=/);
  await expect(page.getByLabel("论文正文编辑区", { exact: true })).toContainText("总体架构");
  await page.getByRole("button", { name: "搜索页面（Ctrl K）" }).click();
  await page.getByLabel("搜索工作空间").fill("润色当前选区");
  await page.getByLabel("搜索工作空间").press("Enter");
  await expect(page).toHaveURL(/agent=content/);
  await expect(page.locator(".project-progress .tp-ver")).toContainText("v13");
});

test("今日分别显示字数和时间进度，阶段确认有依据且不自动确认任务", async ({ page }) => {
  await page.goto(appUrl("/screens/today"));
  await expect(page.getByRole("progressbar", { name: "正文字数目标", exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "阶段已用时间", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "等你决定", exact: true })).toBeVisible();
  const button = page.getByRole("button", { name: "我已核对，完成此阶段", exact: true });
  await expect(button).toBeDisabled();
  await page.getByLabel("本次完成依据", { exact: true }).fill("已核对自制样例初稿及任务产物，进入论文提交阶段。");
  await page.getByLabel("已核对本阶段及前置条件").check();
  await button.click();
  await expect(page.locator('.project-progress [aria-current="step"]')).toContainText("论文提交");
  await page.getByText("查看阶段确认记录（1）", { exact: true }).click();
  await expect(page.locator(".today-phase-history")).toContainText("已核对自制样例初稿");
  await expect(page.locator(".project-progress .tp-ver")).toContainText("v13");
  await page.reload();
  await expect(page.locator('.project-progress [aria-current="step"]')).toContainText("论文提交");
  await expect(page.getByText("查看阶段确认记录（1）", { exact: true })).toBeVisible();
});

test("外观可展开与收起，切主题不改正文；模态初始焦点反向Tab不会离开", async ({ page }) => {
  await page.goto(appUrl("/screens/write"));
  const editor = page.getByLabel("论文正文编辑区", { exact: true });
  const before = await editor.innerHTML();
  await expect(page.getByRole("toolbar", { name: "切换设计方案" })).toBeHidden();
  await page.getByRole("button", { name: /^外观/ }).click();
  await page.getByRole("button", { name: "切换到方案：荧光笔记", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "yingguang");
  expect(await editor.innerHTML()).toBe(before);
  await page.getByRole("button", { name: /^外观/ }).click();
  await page.getByRole("button", { name: "查看毕设阶段进度", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "毕设阶段与完成条件" });
  await dialog.focus();
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "查看毕设阶段进度", exact: true })).toBeFocused();
});
