import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Capture real interactions from the delivered Vue bundle; no DOM or state fixtures are injected.
const file = resolve(process.argv[2] ?? "dist/thesispilot-design-lab.html");
const out = resolve("docs/design/screens");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const origin = pathToFileURL(file).href;
const captures: string[] = [];
async function capture(name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const filename = `2026-11-14-repaired-${name}.png`;
  await page.screenshot({ path: resolve(out, filename), animations: "disabled" });
  captures.push(filename);
}
try {
  await page.goto(origin + "#/screens/write");
  const editor = page.getByLabel("论文正文编辑区", { exact: true });
  await editor.locator("p").first().click();
  await page.getByRole("button", { name: "选中当前段落", exact: true }).click();
  await page.getByRole("tab", { name: "审阅", exact: true }).click();
  const selected = await page.locator(".write-selection-text").innerText();
  if (!selected.includes("本系统采用")) throw new Error("示例段落变化，请人工核对后再截图。");
  await page.getByLabel("候选文字", { exact: true }).fill(selected.replace("本系统采用", "本研究采用"));
  await page.getByRole("button", { name: "生成修订预览", exact: true }).click();
  await page.getByRole("button", { name: "接受第 1 处修改" }).waitFor();
  await capture("writing");
  for (const route of ["today", "plan", "library", "feedback", "review"]) {
    await page.goto(origin + "#/screens/" + route);
    await capture(route);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "#/screens/write");
  await capture("writing-mobile");
  await writeFile(resolve(out, "2026-11-14-repaired-capture.json"), JSON.stringify({ file, captures, errors }, null, 2));
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(JSON.stringify({ captures, errors }));
} finally {
  await browser.close();
}
