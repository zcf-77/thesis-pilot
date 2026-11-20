import { expect, test } from "@playwright/test";
import { runTaskFeedbackScenario } from "./scenarios/taskFeedbackScenario.ts";

test("真实任务版本证据复核、人工反馈关联及学生处理撤销", async ({ page }, testInfo) => {
  // SG-22：写作步骤已换成纸面交互；任务页“正文证据段落”选择器尚未支持正文快照 v2（任务模块切片），接入后去掉此标记。
  test.fixme(true, "依赖任务证据选择器支持正文快照 v2");
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/#/projects");
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
