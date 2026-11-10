import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// 仅验证隔离交互原型，不代表正式产品验收或真实模型评审。
const storageKey = "thesis-pilot:workspace-prototype:v1";
const original =
  "系统可以根据学生的任务状态，对毕业论文的进度进行持续跟踪，并在必要的时候给出提醒，帮助学生完成每一个阶段的任务。";
const proposed =
  "系统根据学生的任务状态，持续跟踪毕业论文进度，并在关键节点给出提醒，帮助学生完成阶段任务。";
const screenshotDir = resolve(import.meta.dirname, "../../../work/design");
const editor = (page: Page) => page.locator('.paper-content[contenteditable="true"]');

async function selectParagraph(page: Page, crossParagraph = false) {
  await page.evaluate(
    ({ text, cross }) => {
      const root = document.querySelector<HTMLElement>('.paper-content[contenteditable="true"]')!;
      const paragraph = [...root.querySelectorAll("p")].find((p) => p.textContent === text)!;
      if (!paragraph) throw new Error("原型样例段落不存在");
      root.focus({ preventScroll: true });
      const range = document.createRange();
      range.setStart(paragraph.firstChild!, 0);
      const end = cross ? paragraph.nextElementSibling! : paragraph;
      range.setEnd(end.firstChild!, end.firstChild!.textContent!.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    },
    { text: original, cross: crossParagraph },
  );
  await expect(page.getByRole("toolbar", { name: "选区操作" })).toBeVisible();
}

async function generate(page: Page) {
  await selectParagraph(page);
  await page
    .getByRole("toolbar", { name: "选区操作" })
    .getByRole("button", { name: "润色选区", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "修订审阅" })).toBeVisible();
  await expect(page.locator(".revision-text.proposed")).toHaveText(`建议${proposed}`);
}

async function shot(page: Page, filename: string) {
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: resolve(screenshotDir, filename), fullPage: true });
}

async function expectNoOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
});

test("原型：真实 DOM 选区生成、保留、采纳和撤销", async ({ page }) => {
  const before = await editor(page).innerHTML();
  await generate(page);
  await expect(editor(page)).toHaveJSProperty("innerHTML", before);
  await shot(page, "workspace-writing.png");
  await page.getByRole("button", { name: "返回对话", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "向论文助手提问" })).toBeVisible();
  await expect(page.getByRole("region", { name: "修订审阅" })).toBeHidden();
  await page.getByRole("button", { name: "查看修订结果", exact: true }).click();
  await expect(page.getByRole("region", { name: "修订审阅" })).toBeVisible();
  await page.getByRole("button", { name: "保留原文", exact: true }).click();
  await expect(editor(page)).toHaveJSProperty("innerHTML", before);
  await generate(page);
  await page.getByRole("button", { name: "采纳修改", exact: true }).click();
  await expect(editor(page)).toContainText(proposed);
  await expect(editor(page)).not.toContainText(original);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(editor(page)).toHaveJSProperty("innerHTML", before);
});

test("原型：正文编辑后陈旧候选不能采纳", async ({ page }) => {
  await generate(page);
  await editor(page).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("补充");
  await expect(page.getByRole("button", { name: "采纳修改", exact: true })).toBeDisabled();
  await expect(page.getByText("正文已变化，请重新选择后生成", { exact: true })).toBeVisible();
  await expect(editor(page)).toContainText(original + "补充");
  await expect(editor(page)).not.toContainText(proposed);
});

test("原型：跨段选区明确拒绝且正文不变", async ({ page }) => {
  const before = await editor(page).innerHTML();
  await selectParagraph(page, true);
  await page
    .getByRole("toolbar", { name: "选区操作" })
    .getByRole("button", { name: "润色选区", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("只支持单个段落");
  await expect(editor(page)).toHaveJSProperty("innerHTML", before);
  await expect(page.getByRole("button", { name: "采纳修改", exact: true })).toHaveCount(0);
});

test("原型：综合、专业和并排切换保留正文并隔离会话", async ({ page }) => {
  const before = await editor(page).innerHTML();
  await page
    .locator(".workspace-header")
    .getByRole("button", { name: "辅助", exact: true })
    .click();
  await page.getByRole("textbox", { name: "向综合助手提问" }).fill("综合会话专用问题");
  await page.getByRole("textbox", { name: "向综合助手提问" }).press("Enter");
  await expect(page.getByRole("log", { name: "综合助手消息" })).toContainText("综合会话专用问题");
  await page.getByRole("button", { name: "专业分工", exact: true }).click();
  await page.getByLabel("选择专业助手", { exact: true }).selectOption("writing");
  await expect(page.getByRole("log", { name: "论文助手消息" })).not.toContainText(
    "综合会话专用问题",
  );
  await page.getByRole("textbox", { name: "向论文助手提问" }).fill("写作会话专用问题");
  await page.getByRole("textbox", { name: "向论文助手提问" }).press("Enter");
  await page.getByRole("button", { name: "并排面板", exact: true }).click();
  await expect(page.getByRole("log", { name: "文献助手消息" })).not.toContainText(
    "写作会话专用问题",
  );
  await page.getByRole("textbox", { name: "向文献助手提问" }).fill("文献会话专用问题");
  await page.getByRole("textbox", { name: "向文献助手提问" }).press("Enter");
  await expect(page.getByRole("log", { name: "论文助手消息" })).not.toContainText(
    "文献会话专用问题",
  );
  await page.getByRole("textbox", { name: "向文献助手提问" }).fill("待发送的文献问题");
  await page.getByRole("button", { name: "并排面板", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "向文献助手提问" })).toBeHidden();
  await page.getByRole("button", { name: "并排面板", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "向文献助手提问" })).toHaveValue(
    "待发送的文献问题",
  );
  await expectNoOverflow(page);
  await shot(page, "workspace-panels.png");
  await page.getByRole("button", { name: "并排面板", exact: true }).click();
  await page.getByRole("button", { name: "综合助手", exact: true }).click();
  await expect(page.getByRole("log", { name: "综合助手消息" })).toContainText("综合会话专用问题");
  await expect(page.getByRole("log", { name: "综合助手消息" })).not.toContainText(
    "写作会话专用问题",
  );
  await expect(editor(page)).toHaveJSProperty("innerHTML", before);
});

test("原型：仅评审保持正文与完成状态，支持下载固定样例报告", async ({ page }) => {
  await page.getByRole("button", { name: "标记本章完成", exact: true }).click();
  await page.getByRole("button", { name: "忽略本次建议" }).click();
  const before = await editor(page).innerHTML();
  const stored = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  await page
    .locator(".workspace-header")
    .getByRole("button", { name: "仅评审", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "论文评审报告" })).toBeVisible();
  await expect(editor(page)).toHaveJSProperty("innerHTML", before);
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(stored);
  await expect(page.getByRole("button", { name: "本章已完成", exact: true })).toBeDisabled();
  await expect(page.getByRole("region", { name: "论文评审报告" })).toContainText("未检查项");
  await shot(page, "workspace-review.png");
  await page.getByRole("button", { name: "返回对话", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "向评审助手提问" })).toBeVisible();
  await expect(page.getByRole("region", { name: "论文评审报告" })).toBeHidden();
  await page.getByRole("button", { name: "查看评审结果", exact: true }).click();
  await expect(page.getByRole("region", { name: "论文评审报告" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载评审报告" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("论文评审示例报告.md");
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(readFileSync(path!, "utf8")).toContain("本报告为交互原型固定样例，不是实际 AI 评审。");
});

test("原型：章节完成提醒可忽略且完成事件不重复触发", async ({ page }) => {
  await page.getByRole("button", { name: "标记本章完成", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "章节完成建议" })).toBeVisible();
  await page.getByRole("button", { name: "忽略本次建议" }).click();
  await expect(page.getByRole("complementary", { name: "章节完成建议" })).toHaveCount(0);
  const button = page.getByRole("button", { name: "本章已完成", exact: true });
  await expect(button).toBeDisabled();
  await button.dispatchEvent("click");
  await expect(page.getByRole("complementary", { name: "章节完成建议" })).toHaveCount(0);
  const completed = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).completed,
    storageKey,
  );
  expect(completed).toEqual(["1 绪论"]);
});

test("原型：刷新恢复浏览器编辑和完成状态", async ({ page }) => {
  await selectParagraph(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("恢复检查");
  await page.getByRole("button", { name: "标记本章完成", exact: true }).click();
  const before = await editor(page).innerHTML();
  await page.reload();
  await expect(editor(page)).toHaveJSProperty("innerHTML", before);
  await expect(page.getByText("已恢复浏览器样稿", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "本章已完成", exact: true })).toBeDisabled();
});

test("原型：390 窄屏与桌面无页面水平溢出", async ({ page }) => {
  await expectNoOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoOverflow(page);
  await shot(page, "workspace-mobile.png");
  await page
    .locator(".workspace-header")
    .getByRole("button", { name: "辅助", exact: true })
    .click();
  await expect(page.getByRole("complementary", { name: "辅助工作台" })).toBeVisible();
  await expectNoOverflow(page);
  await page.getByRole("button", { name: "关闭辅助面板" }).click();
  await expect(editor(page)).toBeVisible();
});
