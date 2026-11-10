/**
 * 截图工具（开发期自检 + 交付证据）。
 * 用法：node scripts/shot.ts --route /components --theme zhumo --out /tmp/a.png [--full] [--width 1440] [--height 900]
 *       [--clip x,y,w,h] [--wait 600] [--click "selector"] [--scale 1] [--motion full|reduced] [--file dist/thesispilot-design-lab.html]
 * 默认自带一个只读静态服务器来提供 dist/（先运行 vp build）；也可用 --base 指向已启动的服务。
 */
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    route: { type: "string", default: "/" },
    theme: { type: "string", default: "zhumo" },
    out: { type: "string", default: "test-results/shot.png" },
    full: { type: "boolean", default: false },
    width: { type: "string", default: "1440" },
    height: { type: "string", default: "900" },
    clip: { type: "string" },
    wait: { type: "string", default: "700" },
    click: { type: "string", multiple: true },
    scale: { type: "string", default: "1" },
    motion: { type: "string", default: "full" },
    file: { type: "string" },
    base: { type: "string" },
    scrollTo: { type: "string" },
    element: { type: "string" },
    hideDock: { type: "boolean", default: false },
    pdf: { type: "boolean", default: false },
  },
});

await mkdir(dirname(resolve(values.out)), { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: Number(values.width), height: Number(values.height) },
  deviceScaleFactor: Number(values.scale),
});
await context.addInitScript(
  ([theme, motion]) => {
    localStorage.setItem("thesispilot.appearance.v1", JSON.stringify({ theme, motion }));
  },
  [values.theme, values.motion],
);
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text());
});
const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".json": "application/json",
};
const server = createServer((req, res) => {
  let path: string;
  try {
    path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  } catch {
    res.writeHead(400).end("bad request");
    return;
  }
  const root = resolve("dist");
  const file = resolve(root, path === "/" ? "index.html" : "." + path);
  const local = relative(root, file);
  if (local.startsWith("..") || isAbsolute(local)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  readFile(file).then(
    (data) => res.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" }).end(data),
    () => res.writeHead(404).end("not found"),
  );
});
let base = values.base;
if (!values.file && !base) {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
}
const origin = values.file ? pathToFileURL(resolve(values.file)).href : base + "/";
await page.goto(origin + "#" + values.route, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
if (values.full) {
  // 逐屏滚动，触发滚动揭示
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += Number(values.height) * 0.8) {
    await page.evaluate((top) => scrollTo(0, top), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => scrollTo(0, 0));
}
if (values.scrollTo) {
  await page.locator(values.scrollTo).first().scrollIntoViewIfNeeded();
}
if (values.hideDock) await page.addStyleTag({ content: ".lab-dock{display:none!important}" });
for (const selector of values.click ?? []) {
  await page.locator(selector).first().click();
  await page.waitForTimeout(250);
}
await page.waitForTimeout(Number(values.wait));
if (values.pdf) {
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: values.out,
    format: "A4",
    printBackground: true,
    margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate:
      '<div style="width:100%;font-size:8px;color:#888;padding:0 14mm;display:flex;justify-content:space-between"><span>毕设智途 ThesisPilot · 设计规范 v0.1 · 待确认稿</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  });
  console.log("saved", values.out);
  await browser.close();
  server.close();
  process.exit(0);
}
if (values.element) {
  const target = page.locator(values.element).first();
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(Number(values.wait));
  const jpegEl = values.out.endsWith(".jpg");
  await target.screenshot({ path: values.out, type: jpegEl ? "jpeg" : "png", quality: jpegEl ? 88 : undefined });
  console.log("saved", values.out);
  await browser.close();
  server.close();
  process.exit(0);
}
const clip = values.clip ? values.clip.split(",").map(Number) : undefined;
const jpeg = values.out.endsWith(".jpg");
await page.screenshot({
  path: values.out,
  type: jpeg ? "jpeg" : "png",
  quality: jpeg ? Number(process.env.SHOT_QUALITY ?? 72) : undefined,
  fullPage: values.full,
  clip: clip ? { x: clip[0], y: clip[1], width: clip[2], height: clip[3] } : undefined,
  animations: "allow",
});
if (errors.length) console.log(errors.join("\n"));
console.log("saved", values.out);
await browser.close();
server.close();
