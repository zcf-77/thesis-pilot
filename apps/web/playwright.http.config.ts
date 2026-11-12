import { defineConfig, devices } from "@playwright/test";

const phase = process.env.TP_HTTP_TEST_PHASE;
if (phase !== "queued" && phase !== "running") throw new Error("TP_HTTP_TEST_PHASE 必须为 queued 或 running。");
if (process.env.VITE_SERVICE_MODE !== "http") throw new Error("真实 HTTP 验收必须显式设置 VITE_SERVICE_MODE=http。");
if (!process.env.TP_API_TOKEN || process.env.TP_API_TOKEN.length < 32) throw new Error("真实 HTTP 验收需要服务端 TP_API_TOKEN。");
if (!process.env.VITE_API_INSTANCE) throw new Error("真实 HTTP 验收需要显式配置 VITE_API_INSTANCE。");
if (phase === "running" && !process.env.TP_HTTP_CANCELLED_JOB_ID) throw new Error("running 阶段需提供 queued 阶段输出的 TP_HTTP_CANCELLED_JOB_ID。");

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/http-integration.http.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: `test-results/http-${phase}`,
  use: {
    baseURL: "http://127.0.0.1:18745",
    trace: "retain-on-failure",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  },
  projects: [{ name: "chromium-http", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    command: "vp dev --host 127.0.0.1 --port 18745 --strictPort",
    url: "http://127.0.0.1:18745",
    reuseExistingServer: false,
    timeout: 60_000,
    env: { VITE_API_BASE_URL: "/api/v1", TP_API_TARGET: "http://127.0.0.1:8000" },
  },
});
