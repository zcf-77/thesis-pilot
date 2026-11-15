import { expect, test } from "@playwright/test";
import { appUrl } from "./app-url.ts";

test("任务新增、证据确认与返工保留真实历史", async ({ page }) => {
  await page.goto(appUrl("/screens/plan"));
  await expect(page.locator(".plan-summary .tp-num")).toHaveText("1 / 6");
  await expect(page.locator(".plan-summary")).toContainText("另有 1 项已确认任务需复核");
  await page.getByRole("button", { name: "新增任务", exact: true }).click();
  const form = page.getByRole("form", { name: "任务编辑" });
  await form.getByLabel("任务目标").fill("完成实验复核");
  await form.getByLabel("验收条件").fill("结果表与正文版本一致");
  await form.getByRole("button", { name: "保存任务" }).click();
  const detail = page.getByRole("complementary", { name: "任务详情" });
  await expect(detail.getByRole("heading", { name: "完成实验复核" })).toBeVisible();
  await detail.getByRole("button", { name: "关联当前正文 v13" }).click();
  await detail.getByRole("checkbox", { name: "我已核对任务标准与关联证据" }).check();
  await detail.getByRole("button", { name: "确认任务完成" }).click();
  await expect(detail.locator(".tp-seal")).toHaveText("学生已确认");
  await expect(page.locator(".plan-summary .tp-num")).toHaveText("2 / 7");
  await detail.getByLabel("返工原因").fill("补做一组对照实验");
  await detail.getByRole("button", { name: "记录返工" }).click();
  await detail.getByText(/任务处理记录/).click();
  await expect(detail.getByText("返工：补做一组对照实验")).toBeVisible();
  await expect(detail.getByText("学生核对证据并确认完成")).toBeVisible();
  await expect(page.locator(".plan-summary .tp-num")).toHaveText("1 / 7");
});

test("候选过期不能覆盖任务编辑，重新生成后可采纳并撤销", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-14T12:00:00+08:00"));
  await page.goto(appUrl("/screens/plan"));
  await page.getByRole("button", { name: "查看调整" }).click();
  await expect(page.getByRole("button", { name: "采纳这份调整" })).toBeEnabled();
  await page.getByRole("button", { name: "编辑任务", exact: true }).click();
  const form = page.getByRole("form", { name: "任务编辑" });
  await form.getByLabel("任务目标").fill("第三章新目标");
  await form.getByRole("button", { name: "保存任务" }).click();
  await expect(page.getByText("计划已变化，当前候选已过期。请重新生成再审阅。")).toBeVisible();
  await expect(page.getByRole("button", { name: "采纳这份调整" })).toHaveCount(0);
  await page.getByRole("button", { name: "重新生成调整" }).click();
  await page.getByRole("button", { name: "采纳这份调整" }).click();
  await expect(page.locator(".plan-version")).toHaveText("计划 v6");
  await page.getByRole("button", { name: "撤销本次采纳" }).click();
  await expect(page.locator(".plan-version")).toHaveText("计划 v7");
  await expect(page.getByRole("complementary", { name: "任务详情" }).getByRole("heading", { name: "第三章新目标" })).toBeVisible();
});

test("循环依赖保留表单，个人规划可取消或保存", async ({ page }) => {
  await page.goto(appUrl("/screens/plan"));
  await page.locator(".plan-task").filter({ hasText: "补充协同过滤对比实验" }).click();
  await page.getByRole("button", { name: "编辑任务", exact: true }).click();
  const form = page.getByRole("form", { name: "任务编辑" });
  await form.getByRole("checkbox", { name: "完成第 3 章「系统设计」初稿" }).check();
  await form.getByRole("button", { name: "保存任务" }).click();
  await expect(page.getByText("存在循环依赖，请调整前置任务。")).toBeVisible();
  await expect(form).toBeVisible();
  await form.press("Escape");
  await expect(form).toHaveCount(0);
  await page.getByRole("button", { name: "设置个人规划" }).click();
  await page.getByRole("radio", { name: "填写规划", exact: true }).click();
  await page.getByLabel("可用时间与安排").fill("周六做实验，周日写作");
  await page.getByRole("button", { name: "保存规划" }).click();
  await expect(page.getByText("周六做实验，周日写作", { exact: true })).toBeVisible();
});

test("时间线显示第四项新任务，跨月可定位，取消生成不改计划", async ({ page }) => {
  await page.goto(appUrl("/screens/plan"));
  for (let i = 1; i <= 4; i += 1) {
    await page.getByRole("button", { name: "新增任务", exact: true }).click();
    const form = page.getByRole("form", { name: "任务编辑" });
    await form.getByLabel("任务目标").fill(`独立安排 ${i}`);
    await form.getByLabel("验收条件").fill("关联真实修改证据");
    await form.getByLabel("开始日期").fill("2026-12-01");
    await form.getByLabel(/^截止日期/).fill("2026-12-03");
    await form.getByRole("button", { name: "保存任务" }).click();
  }
  await page.getByRole("button", { name: "定位到时间线" }).click();
  await expect(page.getByLabel("时间线开始日期")).toHaveValue("2026-12-01");
  await expect(page.locator(".plan-grid__label").filter({ hasText: "独立安排" })).toHaveCount(4);
  const version = await page.locator(".plan-version").textContent();
  await page.getByRole("button", { name: "查看调整" }).click();
  await page.getByRole("button", { name: "取消生成", exact: true }).click();
  await page.waitForTimeout(700);
  await expect(page.locator(".plan-version")).toHaveText(version!);
  await expect(page.locator(".plan-proposal")).toContainText("已取消生成，原计划保留");
  await expect(page.getByRole("button", { name: "采纳这份调整" })).toHaveCount(0);
});
