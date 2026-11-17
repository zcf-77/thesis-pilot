import { defineConfig, devices } from "@playwright/test";

/**
 * MuffinOffice DocsEditor 冒烟检查：开发服务器提供 tests/editor/docs-editor.html 检查页与内核资源。
 * 运行：vp exec playwright test --config playwright.editor.config.ts（可设 PLAYWRIGHT_CHANNEL=chrome 使用本机 Chrome）。
 */
const port = Number(process.env.TP_EDITOR_TEST_PORT ?? 8191);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: ["**/docs-editor-smoke.editor.ts"],
  outputDir: "test-results/editor",
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `vp dev --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/tests/editor/docs-editor.html`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
