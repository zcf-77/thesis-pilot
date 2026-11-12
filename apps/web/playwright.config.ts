import { defineConfig, devices } from "@playwright/test";

/**
 * 端到端测试（设计展台阶段）。通过 Vite+ 任务调用：vp run test:e2e
 * 对构建产物运行，因此先执行 vp build。
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:18744",
    trace: "retain-on-failure",
    // 可选：复用已安装的 Chrome / Edge；不设置时仍使用 Playwright Chromium。
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: process.env.PLAYWRIGHT_FILE
    ? undefined
    : {
        command: "vp preview --host 127.0.0.1 --port 18744 --strictPort",
        url: "http://127.0.0.1:18744",
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
