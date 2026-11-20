import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const launcher = fileURLToPath(new URL(`../../node_modules/.bin/vp${process.platform === "win32" ? ".CMD" : ""}`, import.meta.url));

export default defineConfig({
  testDir: ".",
  testMatch: "**/product-ui-plan.integration.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 12_000 },
  reporter: [["list"]],
  outputDir: "../../test-results/product-ui-plan",
  use: {
    baseURL: "http://127.0.0.1:18746",
    viewport: { width: 1440, height: 1000 },
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `"${launcher}" dev --mode workspace --host 127.0.0.1 --port 18746 --strictPort`,
    cwd: root,
    url: "http://127.0.0.1:18746",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
