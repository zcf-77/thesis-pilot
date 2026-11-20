import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const origin = process.env.TP_WORKSPACE_TEST_ORIGIN;
const accessKey = process.env.TP_WORKSPACE_TEST_ACCESS_KEY;
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("需要本机 TP_WORKSPACE_TEST_ORIGIN。");
if (!accessKey) throw new Error("需要进程内 TP_WORKSPACE_TEST_ACCESS_KEY；不要写入源码或日志。");

const output = path.resolve("test-results/product-ui");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const results = [];
page.on("pageerror", (error) => errors.push(error.message));

// 可选地由当前 dist-workspace 提供静态资源，API 仍访问原有真实本机服务。
// 这样不需要重建或覆盖已有实例，也不会把旧实例的前端误当成本轮成果。
const staticRoot = process.env.TP_WORKSPACE_TEST_STATIC_ROOT ? path.resolve(process.env.TP_WORKSPACE_TEST_STATIC_ROOT) : undefined;
if (staticRoot) {
  const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".woff2": "font/woff2",
  };
  await page.route(`${origin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET" || url.pathname.startsWith("/api/")) return route.continue();
    const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const filename = path.resolve(staticRoot, relative);
    if (filename !== staticRoot && !filename.startsWith(staticRoot + path.sep)) return route.fulfill({ status: 400 });
    try {
      const body = await readFile(filename);
      return route.fulfill({ status: 200, body, contentType: contentTypes[path.extname(filename)] ?? "application/octet-stream" });
    } catch {
      return route.fulfill({ status: 404, body: "Not found", contentType: "text/plain; charset=utf-8" });
    }
  });
}

const themes = [
  { id: "zhumo", label: "朱墨" },
  { id: "yingguang", label: "荧光笔记" },
  { id: "yehang", label: "夜航" },
  { id: "chenwu", label: "晨雾" },
];

async function selectTheme(label) {
  await page.goto(`${origin}/#/account`);
  await page.getByRole("combobox", { name: "主题" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.getByRole("combobox", { name: "主题" }).filter({ hasText: label }).waitFor();
}

async function capture(route, theme, width, height, motion) {
  await page.setViewportSize({ width, height });
  await page.goto(`${origin}/${route.path}`);
  await page.locator("#workspace-content").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".workspace-loading"));
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    const deadline = performance.now() + 10_000;
    while (performance.now() < deadline) {
      const animations = document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity && animation.playState === "running");
      await Promise.allSettled(animations.map((animation) => animation.finished));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const transitioning = document.querySelectorAll(".tp-page-enter-active, .tp-page-leave-active").length;
      const running = document
        .getAnimations()
        .some((animation) => animation.effect?.getComputedTiming().iterations !== Infinity && animation.playState === "running");
      if (!transitioning && !running) return;
    }
    throw new Error("页面转场在 10 秒内未稳定");
  });
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    theme: document.documentElement.dataset.theme,
    motion: document.documentElement.dataset.motion,
    title: document.title,
    contentCharacters: document.querySelector("#workspace-content")?.textContent?.trim().length ?? 0,
    transitioning: document.querySelectorAll(".tp-page-enter-active, .tp-page-leave-active").length,
  }));
  const record = { route: route.id, theme, motion, width, ...metrics };
  results.push(record);
  await page.screenshot({ path: path.join(output, `${theme}-${route.id}-${width}-${motion}.png`), fullPage: false, animations: "disabled" });
  if (metrics.documentWidth > metrics.viewport) throw new Error(`${route.id} 在 ${width}px 横向溢出：${metrics.documentWidth}px`);
  if (metrics.theme !== theme) throw new Error(`${route.id} 主题不符：${metrics.theme}`);
  if (metrics.motion !== motion) throw new Error(`${route.id} 动效偏好不符：${metrics.motion}`);
  if (metrics.transitioning) throw new Error(`${route.id} 仍有未完成的页面转场`);
  if (!metrics.contentCharacters) throw new Error(`${route.id} 没有可验收的页面内容`);
}

try {
  await page.goto(origin);
  const unlock = page.getByLabel("工作区访问口令");
  if (await unlock.count()) {
    await unlock.fill(accessKey);
    const opened = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/workspace/session",
    );
    await page.getByRole("button", { name: "解锁工作区" }).click();
    const response = await opened;
    if (response.status() !== 200) throw new Error(`工作区解锁失败：${response.status()}`);
    await page.locator(".workspace-shell").waitFor({ state: "visible" });
  }
  const project = await page.evaluate(async () => {
    const response = await fetch("/api/v1/projects?offset=0&limit=100");
    if (!response.ok) throw new Error(`项目读取失败：${response.status}`);
    const data = await response.json();
    return data.items.find((item) => !item.archived) ?? data.items[0];
  });
  if (!project) throw new Error("视觉矩阵需要一个已有项目；请在专用实例先创建自制项目。");
  const base = `#/projects/${project.id}`;
  const routes = [
    { id: "today", path: `${base}/today` },
    { id: "writing", path: `${base}/write` },
    { id: "plan", path: `${base}/tasks` },
    { id: "materials", path: `${base}/materials` },
    { id: "feedback", path: `${base}/feedback` },
    { id: "review", path: `${base}/review` },
    { id: "inbox", path: `${base}/inbox` },
    { id: "export", path: `${base}/export` },
    { id: "jobs", path: `${base}/jobs` },
    { id: "configurations", path: "#/configurations" },
    { id: "flows", path: "#/flows" },
    { id: "projects", path: "#/projects" },
    { id: "account", path: "#/account" },
  ];

  for (const theme of themes) {
    await selectTheme(theme.label);
    const reduced = page.getByLabel("减少动效");
    if (await reduced.isChecked()) await reduced.uncheck();
    for (const route of routes) await capture(route, theme.id, 1440, 1000, "full");
  }

  await selectTheme("荧光笔记");
  await page.getByLabel("减少动效").check();
  for (const route of routes) await capture(route, "yingguang", 390, 844, "reduced");

  await writeFile(path.join(output, "results.json"), JSON.stringify({ origin, results, errors }, null, 2) + "\n");
  if (errors.length) throw new Error(`浏览器页面异常：${errors.join("；")}`);
  console.log(`PASS: ${results.length} 个页面/主题/视口组合，无横向溢出或页面异常。`);
  console.log(output);
} finally {
  await browser.close();
}
