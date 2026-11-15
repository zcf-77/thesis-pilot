import { defineConfig, devices } from "@playwright/test";

const origin = process.env.TP_WORKSPACE_TEST_ORIGIN;
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("正式工作区回归需要专用本机 TP_WORKSPACE_TEST_ORIGIN。");
if (!process.env.TP_WORKSPACE_TEST_ACCESS_KEY) throw new Error("请通过进程环境提供本次专用测试服务的访问口令。");

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: ["**/workspace.integration.ts", "**/project-lifecycle.integration.ts", "**/ai-configurations.integration.ts", "**/materials.integration.ts"],
  outputDir: "test-results/workspace",
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: origin,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "off",
  },
});
