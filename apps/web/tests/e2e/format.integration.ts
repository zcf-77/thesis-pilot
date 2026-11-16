import { expect, test } from "@playwright/test";
import { runFormatScenario } from "./scenarios/formatScenario.ts";

test("SG19真实格式依据、显式范围、逐项决定、采纳撤销与过期保护", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.goto("/");
  const passphrase = page.locator('input[type="password"]');
  await expect(passphrase).toBeVisible();
  await passphrase.fill(process.env.TP_WORKSPACE_TEST_ACCESS_KEY!);
  await page.locator('button[type="submit"]').click();
  await expect(passphrase).toHaveCount(0);
  const result = await runFormatScenario(page, {
    origin: process.env.TP_WORKSPACE_TEST_ORIGIN!,
    suffix: crypto.randomUUID(),
    screenshot: (name) => page.screenshot({ path: testInfo.outputPath(name), fullPage: true }).then(() => undefined),
    step: async (description) => {
      await test.step(description, async () => {});
    },
  });
  await testInfo.attach("synthetic-scenario-identifiers", {
    body: JSON.stringify({ ...result, seed: "Real HTTP API synthetic template upload/parse/binding + synthetic DOCX import; UI format commands." }, null, 2),
    contentType: "application/json",
  });
});
