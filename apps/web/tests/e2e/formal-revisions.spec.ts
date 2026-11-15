import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "./app-url.ts";

const manuscript = (page: Page) => page.getByLabel("论文正文编辑区", { exact: true });
const revisionPanel = (page: Page) => page.getByRole("region", { name: "正式稿修订", exact: true });
const topBar = (page: Page) => page.locator(".screens-topbar");

async function openOfficial(page: Page, text: string) {
  await page.goto(appUrl("/screens/projects"));
  const projects = page.getByTestId("service-projects");
  await projects.getByRole("button", { name: "新建项目", exact: true }).click();
  await projects.getByRole("textbox", { name: "项目名称" }).fill("正式稿修订自制样例");
  await projects.getByRole("button", { name: "保存名称", exact: true }).click();
  await projects.getByTestId("service-project-card").getByRole("button", { name: "打开工作区", exact: true }).click();
  await manuscript(page).fill(text);
  await page.getByRole("radio", { name: "正式稿", exact: true }).click();
  await page.getByRole("button", { name: "导入本机正文", exact: true }).click();
  await expect(topBar(page)).toContainText("正式稿 v1");
}

async function generate(page: Page) {
  await manuscript(page).press("ControlOrMeta+Home");
  await page.getByRole("button", { name: "选中当前段落", exact: true }).click();
  await page.getByRole("tab", { name: "修订", exact: true }).click();
  const panel = revisionPanel(page);
  await panel.getByRole("textbox", { name: "修改目标", exact: true }).fill("精简表达，保留记录与来源");
  await panel.getByRole("button", { name: "生成修订预览", exact: true }).click();
  return panel;
}

test.describe("正式稿受控修订", () => {
  test.skip(process.env.TP_FORMAL_REVISIONS_E2E !== "1", "需要显式 Mock 模式构建，真实 HTTP 另行验收。");

  test("实际选区审阅、采纳、撤销和恢复各使用正式版本入口", async ({ page }) => {
    const original = "本研究采用 5 kg 材料 [3]。";
    const adopted = "本研究使用 5 kg 材料 [3]。";
    await openOfficial(page, original);
    const panel = await generate(page);
    const accept = panel.getByRole("button", { name: "接受第 1 处修改", exact: true });
    await expect(accept).toBeEnabled();
    await expect(manuscript(page)).toContainText(original);
    await expect(topBar(page)).toContainText("正式稿 v1");
    await accept.click();
    const apply = panel.getByRole("button", { name: /采纳所选/ });
    await expect(apply).toBeEnabled();
    await expect(manuscript(page)).toContainText(original);
    await expect(topBar(page)).toContainText("正式稿 v1");
    await apply.click();
    await expect(manuscript(page)).toContainText(adopted);
    await expect(topBar(page)).toContainText("正式稿 v2");

    await panel.getByRole("button", { name: "撤销采纳", exact: true }).click();
    await expect(manuscript(page)).toContainText(original);
    await expect(topBar(page)).toContainText("正式稿 v3");
    await page.getByRole("tab", { name: "版本", exact: true }).click();
    const v2 = page.locator(".tp-vt__item").filter({ has: page.getByText("v2", { exact: true }) });
    await expect(v2).toContainText("采纳候选");
    await expect(page.locator(".tp-vt__item").filter({ has: page.getByText("v3", { exact: true }) })).toContainText("撤销采纳");
    await v2.getByRole("button", { name: "对比", exact: true }).click();
    const comparison = page.getByRole("region", { name: "正式稿版本对比", exact: true });
    await expect(comparison).toContainText(adopted);
    await comparison.getByRole("button", { name: "恢复为新版本", exact: true }).click();
    await expect(manuscript(page)).toContainText(adopted);
    await expect(topBar(page)).toContainText("正式稿 v4");
    await expect(page.locator(".tp-vt__item")).toHaveCount(4);

    await page.getByRole("radio", { name: "本机原稿", exact: true }).click();
    await expect(manuscript(page)).toContainText(original);
  });

  test("含公式的整块正文禁止采纳，即使候选没有改公式", async ({ page }) => {
    const original = "本研究采用 x+y 作为误差。";
    await openOfficial(page, original);
    const panel = await generate(page);
    await expect(panel.getByRole("button", { name: "接受第 1 处修改", exact: true })).toBeDisabled();
    await expect(panel.getByRole("button", { name: /采纳所选/ })).toHaveCount(0);
    await expect(panel.getByText(/公式校验未通过/)).toBeVisible();
    await expect(manuscript(page)).toContainText(original);
    await expect(topBar(page)).toContainText("正式稿 v1");
  });
});
