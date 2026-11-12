import { expect, test } from "@playwright/test";
import { appUrl } from "./app-url.ts";

test("粘贴反馈保留完整原文，作为新批次选中，不伪造拆解且刷新恢复完整原文", async ({ page }) => {
  await page.goto(appUrl("/screens/feedback"));
  await page.getByRole("radio", { name: "已处理", exact: true }).click();
  await page.getByRole("button", { name: "录入反馈", exact: true }).click();
  const input = page.getByRole("textbox", { name: "反馈原文" });
  await expect(input).toBeFocused();
  const original = "  请补充模块交互说明。\n\n第二段保留  两个空格。\n<img src=x onerror=\"document.body.dataset.pasteExecuted='yes'\">  \n";
  await input.fill(original);
  await page.getByRole("button", { name: "保存反馈", exact: true }).click();
  await expect(page.locator(".feedback-item")).toHaveCount(5);
  await expect.poll(() => page.locator(".feedback-original").textContent()).toBe(original);
  await expect(page.locator(".feedback-original img")).toHaveCount(0);
  expect(await page.locator("body").getAttribute("data-paste-executed")).toBeNull();
  const reading = page.locator(".feedback-reading");
  await expect(reading).toContainText("尚未拆解");
  await expect(reading).not.toContainText("周老师");
  await expect(reading).not.toContainText("针对正文 v13");
  await expect(reading.locator(".feedback-interpretation")).toHaveCount(0);
  await expect(reading.getByRole("button", { name: "标记已处理", exact: true })).toHaveCount(0);
  await expect(page.locator(".feedback-toolbar")).toContainText("3 次反馈");
  await expect.poll(() => page.evaluate(() => JSON.stringify(localStorage))).toContain("请补充模块交互说明");
  await page.reload();
  await expect(page.locator(".feedback-item")).toHaveCount(5);
  await expect(page.locator(".feedback-toolbar")).toContainText("3 次反馈");
  await page.locator(".feedback-item").filter({ hasText: "请补充模块交互说明" }).click();
  await expect.poll(() => page.locator(".feedback-original").textContent()).toBe(original);
});

test("空白不保存，Esc取消不新增，Enter换行而组合键仅保存一次", async ({ page }) => {
  await page.goto(appUrl("/screens/feedback"));
  const trigger = page.getByRole("button", { name: "录入反馈", exact: true });
  await trigger.click();
  const input = page.getByRole("textbox", { name: "反馈原文" });
  await input.fill(" \n  ");
  await page.getByRole("button", { name: "保存反馈", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("反馈");
  await expect(page.locator(".feedback-item")).toHaveCount(4);
  const tooLong = "字".repeat(10001);
  await input.fill(tooLong);
  await page.getByRole("button", { name: "保存反馈", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("10,000");
  await expect(input).toHaveValue(tooLong);
  await expect(page.locator(".feedback-item")).toHaveCount(4);
  await input.fill("这条内容先不保存");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(page.locator(".feedback-item")).toHaveCount(4);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await input.fill("第一条意见");
  await input.press("End");
  await input.press("Enter");
  await input.pressSequentially("第二条意见");
  await expect(input).toHaveValue("第一条意见\n第二条意见");
  await expect(page.locator(".feedback-item")).toHaveCount(4);
  await input.press("Control+Enter");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".feedback-item")).toHaveCount(5);
  await expect.poll(() => page.locator(".feedback-original").textContent()).toBe("第一条意见\n第二条意见");
});

test("文字表单在桌面与手机保持单一输入，取消按钮不新增反馈", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(appUrl("/screens/feedback"));
    await page.getByRole("button", { name: "录入反馈", exact: true }).click();
    await expect(page.getByRole("textbox")).toHaveCount(1);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await page.getByRole("textbox", { name: "反馈原文" }).fill("这是自制反馈样例，用于检查文字录入。".repeat(10));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "反馈原文" })).toHaveCount(0);
    await expect(page.locator(".feedback-item")).toHaveCount(4);
  }
});
