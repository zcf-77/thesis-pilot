import { chooseOption } from "./select-option.ts";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { appUrl } from "./app-url.ts";
const screenTitles = {
  today: "今天，向前一步。",
  write: "论文写作台",
  plan: "计划与进度",
  library: "让每一份依据，有处可寻。",
  feedback: "导师反馈",
  review: "论文评审",
  settings: "配置台",
  projects: "论文项目",
  inbox: "收件箱",
  account: "账户与偏好",
  jobs: "执行任务",
  export: "导出与备份",
} as const;
const screens = Object.keys(screenTitles) as (keyof typeof screenTitles)[];
for (const width of [390, 1024, 1440])
  test(`全套12页在${width}px无溢出与运行错误`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 1000 });
    for (const screen of screens) {
      await page.goto(appUrl("/screens/" + screen));
      await expect(page.getByRole("heading", { name: screenTitles[screen], level: 1, exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow, screen).toBeLessThanOrEqual(1);
    }
    expect(errors).toEqual([]);
  });
test("新项目正文和任务隔离，退出会话保留正文", async ({ page }) => {
  await page.goto(appUrl("/screens/projects"));
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByRole("textbox", { name: "论文题目" }).fill("自制独立项目");
  await page.getByRole("button", { name: "从空白文稿开始" }).click();
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "写作", exact: true }).click();
  const editor = page.getByLabel("论文正文编辑区", { exact: true });
  await expect(page.getByText("字数目标未绑定", { exact: true })).toBeVisible();
  await expect(editor).not.toContainText("1200");
  await editor.fill("独立项目正文。");
  await page.getByRole("link", { name: /账户：/ }).click();
  await page.getByRole("button", { name: "退出演示会话" }).click();
  await expect(page.getByRole("dialog", { name: "演示会话已结束" })).toBeVisible();
  await page.getByRole("button", { name: "重新进入演示" }).click();
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "写作", exact: true }).click();
  await expect(editor).toContainText("独立项目正文。");
  await page.getByRole("link", { name: "切换论文项目" }).click();
  await page.locator("article").filter({ hasText: "混合推荐算法" }).getByRole("link", { name: "进入项目" }).click();
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "写作", exact: true }).click();
  await expect(editor).toContainText("1200");
  await expect(editor).not.toContainText("独立项目正文");
});

test("提醒遵守规则开关、延期阈值和同类事件冷却", async ({ page }) => {
  await page.goto(appUrl("/screens/account"));
  await page.getByLabel("静默开始", { exact: true }).fill("00:00");
  await page.getByLabel("静默结束", { exact: true }).fill("00:00");
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "配置", exact: true }).click();
  await page.getByRole("tab", { name: "业务设置", exact: true }).click();
  await page.getByLabel("启用事件提醒规则").uncheck();
  await page.getByRole("button", { name: "保存提醒参数", exact: true }).click();
  await page.getByRole("link", { name: "收件箱", exact: true }).click();
  await page.getByText("预览场景 · 主动提醒的去重与静默", { exact: true }).click();
  await page.getByRole("button", { name: "触发同类事件预览" }).click();
  await expect(page.locator(".screen-page [role='status']")).toContainText("主动建议已关闭");
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "配置", exact: true }).click();
  await page.getByLabel("启用事件提醒规则").check();
  await page.getByRole("button", { name: "保存提醒参数", exact: true }).click();
  await page.getByRole("link", { name: "收件箱", exact: true }).click();
  await chooseOption(page.getByLabel("预览事件", { exact: true }), "overdue");
  await page.getByLabel("模拟延期天数", { exact: true }).fill("1");
  await page.getByRole("button", { name: "触发同类事件预览" }).click();
  await expect(page.locator(".screen-page [role='status']")).toContainText("尚未达到");
  await page.getByLabel("模拟延期天数", { exact: true }).fill("5");
  await page.getByRole("button", { name: "触发同类事件预览" }).click();
  await expect(page.getByRole("heading", { name: "留意任务的延期情况", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "触发同类事件预览" }).click();
  await expect(page.locator(".screen-page [role='status']")).toContainText("仍在冷却期");
  await expect(page.getByRole("heading", { name: "留意任务的延期情况", exact: true })).toHaveCount(1);
});
test("备份包含访问过的模块，恢复为新项目且损坏备份不覆盖", async ({ page }, info) => {
  await page.goto(appUrl("/screens/today"));
  await expect(page.getByRole("heading", { name: screenTitles.today, level: 1, exact: true })).toBeVisible();
  for (const screen of ["plan", "library", "feedback", "write", "review", "settings", "inbox", "jobs", "export"] as const) {
    await page.evaluate((s) => {
      location.hash = "/screens/" + s;
    }, screen);
    await expect(page.getByRole("heading", { name: screenTitles[screen], level: 1, exact: true })).toBeVisible();
  }
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载项目备份 JSON" }).click();
  const download = await downloadPromise;
  const path = info.outputPath("project-backup.json");
  await download.saveAs(path);
  const backup = JSON.parse(await readFile(path, "utf8"));
  expect(backup.project.modules).toHaveProperty("writing");
  await page.getByLabel("选择 JSON 备份", { exact: true }).setInputFiles(path);
  await expect(page.getByRole("button", { name: "恢复为新项目" })).toBeVisible();
  await page.getByRole("button", { name: "恢复为新项目" }).click();
  await expect(page.getByRole("link", { name: "切换论文项目" })).toContainText("恢复");
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: screenTitles.library, level: 1, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "导出备份", exact: true }).click();
  await page
    .getByLabel("选择 JSON 备份", { exact: true })
    .setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"format":"bad"}') });
  await expect(page.getByRole("alert")).toContainText("现有项目未改变");
  await page.getByRole("link", { name: "切换论文项目" }).click();
  await expect(page.locator("article")).toHaveCount(2);
});
test("任务取消抑制迟到结果、重试失败可继续", async ({ page }) => {
  await page.goto(appUrl("/screens/jobs"));
  await page.getByText("预览场景 · 排队、取消与失败重试", { exact: true }).click();
  await page.getByRole("button", { name: "运行预览任务" }).click();
  await page.getByRole("button", { name: "取消任务", exact: true }).click();
  await page.waitForTimeout(1600);
  const row = page.locator("article").filter({ hasText: "任务执行交互预览" });
  await expect(row).toContainText("已取消");
  await page.getByLabel("模拟超时").check();
  await row.getByRole("button", { name: "重试任务" }).click();
  await expect(row).toContainText("模拟请求超时");
  await expect(row).toContainText("第 2 次执行");
});

test("本地保存刷新恢复，失败保留当前草稿并允许重试", async ({ page }) => {
  await page.goto(appUrl("/screens/write"));
  const editor = page.getByLabel("论文正文编辑区", { exact: true });
  await editor.fill("自制持久化正文，刷新之后仍可继续。");
  await expect(page.locator(".screens-topbar")).toContainText("已保存");
  await page.reload();
  await expect(editor).toContainText("自制持久化正文");
  await page.getByRole("link", { name: /账户：/ }).click();
  await page.getByText("预览场景 · 本地存储失败", { exact: true }).click();
  await page.getByLabel("模拟存储写入失败").check();
  await page.getByRole("button", { name: "检查本地保存", exact: true }).click();
  await expect(page.locator(".screen-page [role='alert']")).toContainText("当前内容仍在");
  await page.getByLabel("模拟存储写入失败").uncheck();
  await page.getByRole("button", { name: "重试本地保存", exact: true }).click();
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "写作", exact: true }).click();
  await page.reload();
  await expect(editor).toContainText("自制持久化正文");
});

test("导出失败可重试，重置取消不删除已有项目", async ({ page }) => {
  await page.goto(appUrl("/screens/export"));
  await page.getByText("预览场景 · 下载准备失败", { exact: true }).click();
  await page.getByLabel("模拟文件准备失败，保留输入并允许重试").check();
  await page.getByRole("button", { name: "导出 HTML 文稿", exact: true }).click();
  await expect(page.locator(".screen-page [role='alert']")).toContainText("所选版本与内容已保留");
  await page.getByLabel("模拟文件准备失败，保留输入并允许重试").uncheck();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "重试文件准备", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^thesispilot-v\d+\.html$/);
  await page.getByRole("link", { name: /账户：/ }).click();
  await page.getByRole("button", { name: "重置为自制样例", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "重置本机项目数据", exact: true });
  await expect(dialog).toContainText("所有项目");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("link", { name: "切换论文项目", exact: true }).click();
  await expect(page.locator("article")).toHaveCount(1);
});
