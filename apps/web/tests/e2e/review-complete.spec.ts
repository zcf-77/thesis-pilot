import { chooseOption } from "./select-option.ts";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { appUrl } from "./app-url.ts";

test("仅评审固定章节输入，报告可筛选、追溯并下载", async ({ page }) => {
  await page.goto(appUrl("/screens/plan"));
  const beforePlan = await page.locator(".plan-version").innerText();
  const beforeTasks = await page.locator(".plan-task").allTextContents();
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "评审", exact: true }).click();
  await expect(page.getByRole("heading", { name: "论文评审", exact: true })).toBeVisible();
  await expect(page.locator(".review-history__item")).toHaveCount(1);
  const documentVersion = page.locator(".screens-topbar .project-progress__meta .tp-ver");
  const beforeVersion = await documentVersion.innerText();
  await page.getByRole("button", { name: "新建评审", exact: true }).click();
  await chooseOption(page.getByRole("combobox", { name: "评审范围", exact: true }), { label: "3.1 总体架构" });
  await page.getByRole("button", { name: "开始预览评审", exact: true }).click();
  await expect(page.getByRole("region", { name: "评审执行状态" })).toContainText("预览检查完成");
  await expect(page.locator(".review-history__item")).toHaveCount(2);
  await expect(documentVersion).toHaveText(beforeVersion);
  await page.getByText(/查看固定输入文字/).click();
  await expect(page.locator(".review-input")).toContainText("系统划分为数据层");
  await expect(page.locator(".review-input")).not.toContainText("3.2 对比实验");
  await chooseOption(page.getByLabel("筛选问题严重程度"), "major");
  await expect(page.getByText("该程度下没有检查项")).toBeVisible();
  await page.getByRole("button", { name: "查看全部问题" }).click();
  await expect(page.locator(".review-issues .tp-issue")).toHaveCount(2);
  await page.getByRole("button", { name: "对比上一份" }).click();
  await expect(page.locator(".review-comparison")).toContainText("整篇论文");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载报告", exact: true }).click();
  const download = await downloading;
  const path = await download.path();
  expect(path).not.toBeNull();
  const html = await readFile(path!, "utf8");
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("3.1 总体架构");
  expect(html).toContain("未检查项");
  expect(html).toContain("非教师成绩");
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "计划", exact: true }).click();
  expect(await page.locator(".plan-version").innerText()).toBe(beforePlan);
  expect(await page.locator(".plan-task").allTextContents()).toEqual(beforeTasks);
});

test("评审取消抑制迟到结果，失败保留原输入并可重试", async ({ page }) => {
  await page.goto(appUrl("/screens/review"));
  await page.getByRole("button", { name: "新建评审", exact: true }).click();
  await page.getByRole("button", { name: "开始预览评审", exact: true }).click();
  await page.getByRole("button", { name: "取消评审", exact: true }).click();
  await expect(page.getByRole("region", { name: "评审执行状态" })).toContainText("已取消");
  await page.waitForTimeout(1300);
  await expect(page.locator(".review-history__item")).toHaveCount(1);
  await page.getByRole("button", { name: "新建评审", exact: true }).click();
  await page.getByText("状态预览", { exact: true }).click();
  await chooseOption(page.getByLabel("本次预览场景"), "timeout");
  await page.getByRole("button", { name: "开始预览评审", exact: true }).click();
  await expect(page.getByRole("region", { name: "评审执行状态" })).toContainText("模拟请求超时");
  await expect(page.locator(".review-history__item")).toHaveCount(1);
  await page.getByRole("button", { name: "按原输入重试", exact: true }).click();
  await expect(page.getByRole("region", { name: "评审执行状态" })).toContainText("第 2 次执行");
  await expect(page.locator(".review-history__item")).toHaveCount(2);
  await expect(page.locator(".review-bindings")).toContainText("正文 v13");
});

test("部分完成保留报告与未知项，窄屏没有页面溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto(appUrl("/screens/review"));
  await page.getByRole("button", { name: "新建评审", exact: true }).click();
  await page.getByText("状态预览", { exact: true }).click();
  await chooseOption(page.getByLabel("本次预览场景"), "partial");
  await page.getByRole("button", { name: "开始预览评审", exact: true }).click();
  await expect(page.getByRole("region", { name: "评审执行状态" })).toContainText("部分完成");
  await expect(page.getByText("本次模拟来源不可用，引用扫描未完成", { exact: false })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("正文更新后历史报告明确标注旧稿", async ({ page }) => {
  await page.goto(appUrl("/screens/review"));
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "写作", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "论文正文编辑区", exact: true });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" added review test");
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "评审", exact: true }).click();
  await expect(page.getByText(/基于旧稿 · 当前 v/)).toBeVisible();
  await expect(page.locator(".review-bindings")).toContainText("正文 v13");
});

test("定位查看报告固定原文且下载失败可以恢复", async ({ page }) => {
  await page.goto(appUrl("/screens/review"));
  await page.getByRole("button", { name: "新建评审", exact: true }).click();
  await page.getByRole("button", { name: "开始预览评审", exact: true }).click();
  await expect(page.getByRole("region", { name: "评审执行状态" })).toContainText("预览检查完成");
  await page.getByRole("button", { name: "定位到正文", exact: true }).first().click();
  const drawer = page.getByRole("dialog", { name: "报告原文 · 只读定位" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel("报告版本只读原文")).toContainText("协同过滤");
  await expect(drawer.locator('[contenteditable="true"]')).toHaveCount(0);
  expect(page.url()).toContain("/screens/review");
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByText("查看本次配置与适用依据", { exact: true }).click();
  await expect(page.locator(".review-report__cover")).toContainText("论文评审 · v1");
  await page.getByText("下载状态预览", { exact: true }).click();
  await page.getByLabel("模拟下载准备失败", { exact: true }).check();
  await page.getByRole("button", { name: "下载报告", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "模拟下载准备失败" })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "重试下载", exact: true }).click();
  const download = await downloading;
  expect(await readFile((await download.path())!, "utf8")).toContain("执行配置与固定依据");
});

test("同名章节可分别评审而不混入其他章节", async ({ page }) => {
  await page.goto(appUrl("/screens/write"));
  const editor = page.getByRole("textbox", { name: "论文正文编辑区", exact: true });
  await editor.click();
  await editor.press("Control+A");
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/html", "<h3>重复章节</h3><p>第一处专属内容</p><h3>重复章节</h3><p>第二处专属内容</p>");
    clipboardData.setData("text/plain", "重复章节\n第一处专属内容\n重复章节\n第二处专属内容");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(editor.getByRole("heading", { name: "重复章节", exact: true })).toHaveCount(2);
  await expect(editor.locator("p")).toHaveText(["第一处专属内容", "第二处专属内容"]);
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "评审", exact: true }).click();
  await page.getByRole("button", { name: "新建评审", exact: true }).click();
  await chooseOption(page.getByRole("combobox", { name: "评审范围", exact: true }), { label: "重复章节（第2处）" });
  await page.getByRole("button", { name: "开始预览评审", exact: true }).click();
  await expect(page.getByRole("region", { name: "评审执行状态" })).toContainText("预览检查完成");
  await page.getByText(/查看固定输入文字/).click();
  await expect(page.locator(".review-input")).toContainText("第二处专属内容");
  await expect(page.locator(".review-input")).not.toContainText("第一处专属内容");
});
