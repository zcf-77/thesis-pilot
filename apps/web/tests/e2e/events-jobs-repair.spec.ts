import { chooseOption } from "./select-option.ts";
import { expect, test } from "@playwright/test";
import { appUrl } from "./app-url.ts";

test("实际新增延期任务进入收件箱，延后截止与恢复操作可追溯", async ({ page }) => {
  await page.goto(appUrl("/screens/account"));
  await page.getByLabel("静默开始", { exact: true }).fill("00:00");
  await page.getByLabel("静默结束", { exact: true }).fill("00:00");
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "计划", exact: true }).click();
  await page.getByRole("button", { name: "新增任务", exact: true }).click();
  const form = page.getByRole("form", { name: "任务编辑" });
  await form.getByLabel("任务目标").fill("核对自制实验记录");
  await form.getByLabel("验收条件").fill("证据可追溯到具体版本");
  await form.getByLabel("开始日期").fill("2026-11-01");
  await form.getByLabel(/^截止日期/).fill("2026-11-04");
  await form.getByRole("button", { name: "保存任务" }).click();
  await page.getByRole("link", { name: "收件箱", exact: true }).click();
  const row = page.locator("article").filter({ has: page.getByRole("heading", { name: "留意「核对自制实验记录」的进度", exact: true }) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("延期");
  await row.getByRole("button", { name: "延后", exact: true }).click();
  await row.getByLabel("延后截止时间").fill("2030-01-01T12:00");
  await row.getByRole("button", { name: "保存延后时间" }).click();
  await expect(page.getByRole("tab", { name: "已延后", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(row).toContainText("2030");
  await row.getByRole("button", { name: "放回待留意" }).click();
  await page.getByRole("tab", { name: "操作记录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "延后建议", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "放回待留意", exact: true })).toBeVisible();
});

test("托盘取消真实配置运行，统一任务筛选保留诊断与尝试", async ({ page }) => {
  await page.goto(appUrl("/screens/settings"));
  await page.getByRole("button", { name: "开始模拟运行", exact: true }).click();
  await page.getByRole("button", { name: /后台任务：/ }).click();
  const tray = page.getByRole("region", { name: "后台任务托盘" });
  await expect(tray).toContainText("执行中");
  await tray.getByRole("button", { name: "取消", exact: true }).click();
  await expect(tray).toContainText("已取消");
  await expect(page.locator(".settings-run-result")).toContainText("已取消");
  await tray.getByRole("link", { name: "查看全部执行记录" }).click();
  await chooseOption(page.getByLabel("按状态筛选", { exact: true }), "cancelled");
  const row = page.locator("article").first();
  await expect(row).toContainText("已取消");
  await row.locator("button.studio-text-button").click();
  await expect(page.getByRole("heading", { name: "每次尝试", exact: true })).toBeVisible();
  await expect(page.locator(".job-attempts")).toContainText("第 1 次");
  await chooseOption(page.getByLabel("按状态筛选", { exact: true }), "done");
  await expect(page.locator("article")).toHaveCount(0);
});

test("晨雾窄屏任务托盘遮挡底层内容，关闭可触达并安全快速重开", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(appUrl("/screens/jobs"));
  await page.getByRole("button", { name: /^外观/ }).click();
  await page.getByRole("button", { name: "切换到方案：晨雾", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "chenwu");
  await page.getByRole("button", { name: /^外观/ }).click();
  await page.getByText("预览场景 · 排队、取消与失败重试", { exact: true }).click();
  await page.getByRole("button", { name: "运行预览任务", exact: true }).click();
  await expect(page.getByRole("article").filter({ hasText: "任务执行交互预览" })).toContainText("已完成");

  const trigger = page.getByRole("button", { name: /后台任务：/ });
  const tray = page.getByRole("region", { name: "后台任务托盘" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(tray).toBeFocused();
  await expect(tray.getByTestId("tray-job-row")).toContainText("已完成");
  await expect(tray).toHaveCSS("opacity", "1");
  await expect(tray).toHaveCSS("transform", "none");
  const appearanceButton = await page.getByRole("button", { name: /^外观/ }).elementHandle();
  const appearance = await tray.evaluate((element, dockButton) => {
    const bounds = element.getBoundingClientRect();
    const dock = dockButton.getBoundingClientRect();
    const left = Math.max(bounds.left, dock.left);
    const right = Math.min(bounds.right, dock.right);
    const top = Math.max(bounds.top, dock.top);
    const bottom = Math.min(bounds.bottom, dock.bottom);
    const overlap = left < right && top < bottom;
    const topElement = document.elementFromPoint(bounds.left + 12, bounds.top + 12);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const pixel = canvas.getContext("2d")!;
    pixel.fillStyle = "transparent";
    pixel.fillStyle = getComputedStyle(element).backgroundColor;
    pixel.fillRect(0, 0, 1, 1);
    return {
      alpha: pixel.getImageData(0, 0, 1, 1).data[3],
      topmost: element.contains(topElement),
      dockDoesNotCoverTray: !overlap || element.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2)),
      insideViewport: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  }, appearanceButton!);
  expect(appearance).toMatchObject({ alpha: 255, topmost: true, dockDoesNotCoverTray: true, insideViewport: true });
  expect(appearance.overflow).toBeLessThanOrEqual(1);
  const close = tray.getByRole("button", { name: "收起任务托盘", exact: true });
  const closeBox = await close.boundingBox();
  expect(closeBox).not.toBeNull();
  expect(closeBox!.width).toBeGreaterThanOrEqual(36);
  expect(closeBox!.height).toBeGreaterThanOrEqual(36);

  // Reopen during the real leave transition, while its old controls are still mounted.
  const exit = await tray.evaluateHandle((element) => {
    const opener = document.querySelector<HTMLButtonElement>(`[aria-controls="${element.id}"]`)!;
    const closingButton = element.querySelector<HTMLButtonElement>('button[aria-label="收起任务托盘"]')!;
    const observed = { mountedInert: false, focusReturned: false, focusBlocked: false };
    const observer = new MutationObserver(() => {
      if (!element.isConnected || !(element as HTMLElement).inert) return;
      observer.disconnect();
      observed.mountedInert = true;
      observed.focusReturned = document.activeElement === opener;
      closingButton.focus();
      observed.focusBlocked = document.activeElement === opener;
      opener.click();
    });
    observer.observe(element, { attributes: true, attributeFilter: ["inert"] });
    return observed;
  });
  await page.keyboard.press("Escape");
  await expect.poll(() => exit.jsonValue()).toEqual({ mountedInert: true, focusReturned: true, focusBlocked: true });
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(tray).toBeFocused();
  await expect(tray).toHaveCSS("opacity", "1");
  await expect(close).toBeEnabled();
  await expect(tray.getByTestId("tray-job-row")).toHaveCount(1);

  await close.click();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(tray).toHaveCount(0);
});
