import { expect, test } from "@playwright/test";
import { appUrl } from "./app-url.ts";

test.describe("同契约 Mock 接入页面", () => {
  test.skip(process.env.TP_API_INTEGRATION_E2E !== "1", "需要 VITE_SERVICE_MODE=mock 的独立构建；不计作真实 HTTP 联调。");

  test("项目名称操作、工作区关联与后台任务查询取消", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(appUrl("/screens/projects"));
    const projects = page.getByTestId("service-projects");
    await expect(projects).toBeVisible();
    await expect(projects.getByText("这里还没有项目", { exact: true })).toBeVisible();
    await projects.getByRole("button", { name: "新建项目", exact: true }).click();
    await projects.getByRole("textbox", { name: "项目名称" }).fill("自制接口接入样例");
    await projects.getByRole("button", { name: "保存名称", exact: true }).click();
    const card = projects.getByTestId("service-project-card").filter({ hasText: "自制接口接入样例" });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "修改名称" }).click();
    await projects.getByRole("textbox", { name: "项目名称" }).fill("自制接口接入样例二版");
    await projects.getByRole("button", { name: "保存名称", exact: true }).click();
    await expect(card.getByRole("heading", { name: "自制接口接入样例二版", exact: true })).toBeVisible();
    await expect(card).toContainText("名称 v2");
    await card.getByRole("button", { name: "查看详情" }).click();
    await expect(projects.getByRole("heading", { name: "项目详情", exact: true })).toBeVisible();
    await card.getByRole("button", { name: "打开工作区" }).click();
    const editor = page.getByLabel("论文正文编辑区", { exact: true });
    await expect(editor).toBeVisible();
    await editor.fill("此段正文只保存在本机，打开关联不得清空。");
    await page.evaluate(() => (location.hash = "/screens/projects"));
    await projects.getByTestId("service-project-card").getByRole("button", { name: "打开工作区" }).click();
    await expect(editor).toContainText("此段正文只保存在本机，打开关联不得清空。");
    await page.evaluate(() => (location.hash = "/screens/jobs"));
    const jobs = page.getByTestId("service-jobs");
    await expect(jobs).toBeVisible();
    await jobs.getByRole("button", { name: "运行诊断", exact: true }).click();
    const first = jobs.getByTestId("service-job-row").first();
    await expect(first).toBeVisible();
    await page.getByRole("button", { name: /后台任务：1 项运行中/ }).click();
    const tray = page.getByRole("region", { name: "后台任务托盘" });
    const trayJob = tray.getByTestId("tray-job-row").filter({ hasText: "执行链路诊断" });
    await trayJob.getByRole("button", { name: "取消", exact: true }).click();
    await expect(first).toContainText("已取消");
    await expect(trayJob).toContainText("已取消");
    const cancelled = trayJob.filter({ hasText: "已取消" });
    const previousDetail = await cancelled.getByRole("link", { name: /查看详情/ }).getAttribute("href");
    await cancelled.getByRole("button", { name: "重新运行", exact: true }).click();
    await expect(jobs.getByTestId("service-job-row")).toHaveCount(2);
    await expect(jobs.getByTestId("service-job-row").filter({ hasText: "已取消" })).toHaveCount(1);
    await expect(trayJob).toHaveCount(2);
    await expect(cancelled.getByRole("link", { name: /查看详情/ })).toHaveAttribute("href", previousDetail!);
    const newDetail = await trayJob
      .filter({ hasNotText: "已取消" })
      .getByRole("link", { name: /查看详情/ })
      .getAttribute("href");
    expect(previousDetail).toMatch(/job=[0-9a-f-]{36}/i);
    expect(newDetail).toMatch(/job=[0-9a-f-]{36}/i);
    expect(newDetail).not.toBe(previousDetail);
    await tray.getByRole("button", { name: "收起任务托盘", exact: true }).click();
    await page.evaluate(() => (location.hash = "/screens/projects"));
    await expect(projects).toBeVisible();
    await page.evaluate(() => (location.hash = "/screens/jobs"));
    await expect(jobs.getByTestId("service-job-row")).toHaveCount(2);
    await expect(jobs.getByTestId("service-job-row").first()).toContainText("已完成", { timeout: 10000 });
    await jobs.getByTestId("service-job-row").first().getByRole("button", { name: "查看详情", exact: true }).click();
    await expect(jobs.getByRole("heading", { name: "任务详情", exact: true })).toBeVisible();
    const diagnostics = jobs.locator("details").filter({ has: page.getByText("运行标识与诊断", { exact: true }) });
    await expect(diagnostics.getByText("任务标识", { exact: true })).toBeHidden();
    await diagnostics.getByText("运行标识与诊断", { exact: true }).click();
    await expect(diagnostics.getByText("任务标识", { exact: true })).toBeVisible();

    await page.evaluate(() => (location.hash = "/screens/settings"));
    await page.getByRole("button", { name: "开始模拟运行", exact: true }).click();
    await page.getByRole("button", { name: /后台任务：/ }).click();
    const localJob = tray.getByTestId("tray-job-row").filter({ hasText: "本机任务" });
    await localJob.getByRole("link", { name: /查看详情/ }).click();
    await expect(page.getByRole("tab", { name: "本机任务", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "每次尝试", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  for (const width of [390, 1440]) {
    test(`接口表单与空白状态在 ${width}px 减弱动效下可操作`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(appUrl("/screens/projects"));
      const projects = page.getByTestId("service-projects");
      await expect(projects).toBeVisible();
      await projects.getByRole("button", { name: "新建项目", exact: true }).click();
      await projects.getByRole("textbox", { name: "项目名称" }).fill("取消后不产生项目");
      await projects.getByRole("textbox", { name: "项目名称" }).press("Escape");
      await expect(projects.getByRole("textbox", { name: "项目名称" })).toHaveCount(0);
      await expect(projects.getByTestId("service-project-card")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await page.evaluate(() => (location.hash = "/screens/jobs"));
      await expect(page.getByText("先打开一个已关联的项目", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "前往项目目录", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    });
  }

  test("390px 减弱动效下可用键盘开关任务托盘并查看完成记录", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(appUrl("/screens/projects"));
    const projects = page.getByTestId("service-projects");
    await projects.getByRole("button", { name: "新建项目", exact: true }).click();
    await projects.getByRole("textbox", { name: "项目名称" }).fill("窄屏自制诊断");
    await projects.getByRole("button", { name: "保存名称", exact: true }).click();
    await projects.getByRole("button", { name: "打开工作区", exact: true }).click();
    await page.evaluate(() => (location.hash = "/screens/jobs"));
    const jobs = page.getByTestId("service-jobs");
    await jobs.getByRole("button", { name: "运行诊断", exact: true }).click();
    await expect(jobs.getByTestId("service-job-row")).toContainText("已完成");

    const trigger = page.getByRole("button", { name: /后台任务：/ });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const tray = page.getByRole("region", { name: "后台任务托盘" });
    await expect(tray).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(tray.getByTestId("tray-job-row")).toContainText("已完成");
    const box = await tray.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await tray.getByRole("link", { name: /查看详情/ }).click();
    await expect(jobs.getByText("运行标识与诊断", { exact: true })).toBeVisible();
  });
});
