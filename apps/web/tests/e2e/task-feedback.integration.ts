import { expect, test } from "@playwright/test";
import { runTaskFeedbackScenario } from "./scenarios/taskFeedbackScenario.ts";

test("真实任务版本证据复核、人工反馈关联及学生处理撤销", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.getByLabel("工作区访问口令").fill(process.env.TP_WORKSPACE_TEST_ACCESS_KEY!);
  await page.getByRole("button", { name: "解锁工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
  await runTaskFeedbackScenario(page, {
    suffix: crypto.randomUUID(),
    screenshot: async (name) => {
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
    },
  });
});
