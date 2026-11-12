import { chooseOption } from "./select-option.ts";
import { expect, test } from "@playwright/test";
import { appUrl } from "./app-url.ts";

test("配置编辑保存新版本，停用 API 后下游不可运行", async ({ page }) => {
  await page.goto(appUrl("/screens/settings"));
  await expect(page.getByRole("heading", { name: "配置台", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "编辑配置", exact: true }).click();
  await page.getByRole("textbox", { name: "用途与职责", exact: true }).fill("测试职责，不改正式论文");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page.locator(".settings-notice")).toContainText("v2");
  await page.getByRole("tab", { name: "AI 接口", exact: true }).click();
  await page.getByRole("button", { name: "停用配置", exact: true }).click();
  await page.getByRole("tab", { name: "智能体", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始模拟运行", exact: true })).toBeDisabled();
  await expect(page.locator(".settings-main")).toContainText("模型关联的 API 不可用");
});

test("模拟取消保留记录，失败诊断与运行快照可查看", async ({ page }) => {
  await page.goto(appUrl("/screens/settings"));
  await page.getByRole("button", { name: "开始模拟运行", exact: true }).click();
  await page.getByRole("button", { name: "取消运行", exact: true }).click();
  await expect(page.locator(".settings-run-result")).toContainText("已取消");
  await chooseOption(page.getByLabel("模拟场景", { exact: true }), "incompatible");
  await page.getByRole("button", { name: "开始模拟运行", exact: true }).click();
  await expect(page.locator(".settings-run-result")).toContainText("模拟返回结构不兼容");
  await page.getByRole("button", { name: "查看快照与诊断", exact: true }).click();
  await expect(page.getByRole("heading", { name: "固定配置快照", exact: true })).toBeVisible();
  await expect(page.locator(".settings-snapshot")).toHaveCount(4);
});

test("阶段编辑不会自动绑定，明确绑定后保持版本", async ({ page }) => {
  await page.goto(appUrl("/screens/settings"));
  await page.getByRole("tab", { name: "阶段流程", exact: true }).click();
  await page
    .locator(".settings-stage")
    .filter({ has: page.getByRole("heading", { name: "论文撰写", exact: true }) })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page.getByLabel("阶段说明", { exact: true }).fill("完善论文并核对证据");
  await page.getByRole("button", { name: "保存阶段", exact: true }).click();
  await expect(page.locator(".settings-toolbar")).toContainText("项目绑定 v1");
  await page.getByRole("button", { name: "绑定当前流程", exact: true }).click();
  await expect(page.locator(".settings-toolbar")).toContainText("项目绑定 v2");
});

test("流程深链与重命名绑定保持今日阶段位置", async ({ page }) => {
  await page.goto(appUrl("/screens/settings?tab=workflow"));
  await expect(page.getByRole("tab", { name: "阶段流程", exact: true })).toHaveAttribute("aria-selected", "true");
  await page
    .locator(".settings-stage")
    .filter({ has: page.getByRole("heading", { name: "论文撰写", exact: true }) })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page.getByRole("textbox", { name: "阶段名称", exact: true }).fill("集中撰写");
  await page.getByRole("button", { name: "保存阶段", exact: true }).click();
  await page.getByRole("button", { name: "绑定当前流程", exact: true }).click();
  await page.getByRole("navigation", { name: "页面设计导航" }).getByRole("link", { name: "今日", exact: true }).click();
  await expect(page.locator(".today-hero")).toContainText("当前航程 / 集中撰写");
});

test("提示词升版后智能体仍使用明确绑定版本，API可反查运行", async ({ page }) => {
  await page.goto(appUrl("/screens/settings"));
  await page.getByRole("tab", { name: "提示词", exact: true }).click();
  await page.getByRole("button", { name: "编辑配置", exact: true }).click();
  await page.getByRole("textbox", { name: "提示词正文", exact: true }).fill("新版说明：依据 {{context}} 和 {{requirements}} 回应 {{goal}}。");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await page.getByRole("tab", { name: "智能体", exact: true }).click();
  await page.getByRole("button", { name: "编辑配置", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "绑定提示词版本", exact: true })).toHaveAttribute("data-value", "1");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "开始模拟运行", exact: true }).click();
  await expect(page.locator(".settings-run-result")).toContainText("模拟成功");
  await page.getByRole("button", { name: "查看快照与诊断", exact: true }).click();
  await expect(page.locator(".settings-snapshot").filter({ hasText: "提示词 · 有依据的候选建议" })).toContainText("v1");
  await page.getByRole("tab", { name: "AI 接口", exact: true }).click();
  await expect(page.locator(".settings-references").filter({ hasText: "使用此配置的任务" })).toContainText("综合助手 · 模拟运行");
});

test("流程可以明确重新绑定任意已保存历史版本", async ({ page }) => {
  await page.goto(appUrl("/screens/settings?tab=workflow"));
  const stage = page.locator(".settings-stage").filter({ has: page.getByRole("heading", { name: "论文撰写", exact: true }) });
  await stage.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("阶段说明", { exact: true }).fill("新的流程依据");
  await page.getByRole("button", { name: "保存阶段", exact: true }).click();
  await page.getByRole("button", { name: "绑定当前流程", exact: true }).click();
  await expect(page.locator(".settings-toolbar")).toContainText("项目绑定 v2");
  await chooseOption(page.getByLabel("绑定流程版本", { exact: true }), "1");
  await page.getByRole("button", { name: "绑定所选流程", exact: true }).click();
  await expect(page.locator(".settings-toolbar")).toContainText("项目绑定 v1");
});
