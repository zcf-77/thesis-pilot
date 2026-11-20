import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const origin = process.env.TP_WORKSPACE_TEST_ORIGIN;
const accessKey = process.env.TP_WORKSPACE_TEST_ACCESS_KEY;
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("需要本机 TP_WORKSPACE_TEST_ORIGIN。");
if (!accessKey) throw new Error("需要进程内 TP_WORKSPACE_TEST_ACCESS_KEY；不要写入源码或日志。");

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const staticRoot = path.resolve(process.env.TP_WORKSPACE_TEST_STATIC_ROOT || path.join(appRoot, "dist-workspace"));
const output = path.join(appRoot, "test-results", "product-ui-writing");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const checks = [];
page.on("pageerror", (error) => errors.push(error.message));

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
    return route.fulfill({ status: 200, body, contentType: contentTypes[path.extname(filename)] || "application/octet-stream" });
  } catch {
    return route.fulfill({ status: 404, body: "Not found", contentType: "text/plain; charset=utf-8" });
  }
});

async function api(pathname, method = "GET", body) {
  const response = await page.evaluate(
    async ({ pathname, method, body }) => {
      const result = await fetch(`/api/v1${pathname}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: result.status, body: await result.json() };
    },
    { pathname, method, body },
  );
  return response;
}

function snapshot() {
  const run = (text) => ({ type: "run", text });
  return {
    schemaVersion: 2,
    model: {
      kind: "docs",
      schemaVersion: 1,
      id: "product-ui-writing",
      theme: { name: "minimal" },
      sections: [
        {
          id: "section",
          blocks: [
            { type: "heading", id: "chapter-1", level: 1, inlines: [run("第一章 合成研究")] },
            { type: "paragraph", id: "paragraph-1", inlines: [run("这是仅用于界面验收的合成正文，不包含真实论文内容。")] },
            { type: "heading", id: "chapter-2", level: 1, inlines: [run("第二章 合成方法")] },
            { type: "paragraph", id: "paragraph-2", inlines: [run("用于检查长文阅读、版本恢复与中文输入的合成段落。")] },
          ],
        },
      ],
    },
    protections: [],
    chapters: [],
  };
}

async function selectTheme(label) {
  await page.goto(`${origin}/#/account`);
  await page.getByRole("combobox", { name: "主题" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.getByRole("combobox", { name: "主题" }).filter({ hasText: label }).waitFor();
}

async function openWriting(projectId) {
  await page.goto(`${origin}/#/projects/${projectId}/write`);
  const editor = page.locator('[aria-label="论文正文编辑区"][contenteditable="true"]');
  await editor.waitFor({ state: "visible", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  return editor;
}

async function settle() {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const animations = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.allSettled(animations.map((animation) => animation.finished));
  });
}

async function sampleReducedDrawer(buttonName, dialogName) {
  await page.evaluate(() => {
    const probe = { durations: [], opacity: false, moved: false, first: undefined, active: true };
    window.__writingMotionProbe = probe;
    const sample = () => {
      if (!probe.active) return;
      const modal = document.querySelector("dialog:modal");
      const surface = modal?.querySelector(".workspace-writing__outline, .workspace-writing__copilot");
      if (modal && surface) {
        const box = surface.getBoundingClientRect();
        if (
          probe.first &&
          [box.x - probe.first.x, box.y - probe.first.y, box.width - probe.first.width, box.height - probe.first.height].some((d) => Math.abs(d) > 0.5)
        )
          probe.moved = true;
        probe.first ||= { x: box.x, y: box.y, width: box.width, height: box.height };
        for (const target of new Set([modal, surface])) {
          for (const animation of target.getAnimations()) {
            if (!(animation.effect instanceof KeyframeEffect)) continue;
            const duration = animation.effect.getComputedTiming().duration;
            if (typeof duration === "number" && duration > 0) probe.durations.push(duration);
            if (animation.effect.getKeyframes().some((frame) => "opacity" in frame)) probe.opacity = true;
          }
        }
      }
      requestAnimationFrame(sample);
    };
    sample();
  });
  const opener = page.getByRole("button", { name: buttonName, exact: true });
  await opener.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: dialogName, exact: true });
  await drawer.waitFor({ state: "visible" });
  await page.waitForFunction((name) => {
    const modal = [...document.querySelectorAll("dialog")].find((item) => item.getAttribute("aria-label") === name);
    return modal?.contains(document.activeElement);
  }, dialogName);
  await settle();
  const measured = await page.evaluate(() => {
    const probe = window.__writingMotionProbe;
    probe.active = false;
    return { durations: probe.durations, opacity: probe.opacity, moved: probe.moved };
  });
  assert.equal(measured.opacity, true);
  assert.equal(measured.moved, false);
  assert.ok(measured.durations.length > 0);
  assert.ok(measured.durations.every((duration) => duration <= 120));
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "detached" });
  assert.equal(await opener.evaluate((button) => button === document.activeElement), true);
  checks.push({ drawer: dialogName, reducedMotion: measured });
}

try {
  await page.goto(origin);
  const unlock = page.getByLabel("工作区访问口令");
  await unlock.waitFor({ state: "visible" });
  await unlock.fill(accessKey);
  await page.getByRole("button", { name: "解锁工作区" }).click();
  await unlock.waitFor({ state: "detached" });

  const suffix = crypto.randomUUID().slice(0, 8);
  const created = await api("/projects", "POST", { name: `W-E 写作界面合成验收 ${suffix}` });
  assert.equal(created.status, 201);
  const projectId = created.body.id;
  const document = await api(`/projects/${projectId}/documents`, "POST", { content: { schema_version: 2, json: snapshot() } });
  assert.equal(document.status, 201);
  const documentId = document.body.id;
  let editor = await openWriting(projectId);
  await editor.waitFor({ state: "visible" });
  const identity = await editor.elementHandle();

  // 面板切换与历史只读预览不得为了动效重建当前正文编辑器。
  await page.getByRole("tab", { name: "格式", exact: true }).click();
  await page.getByRole("region", { name: "安全格式", exact: true }).waitFor();
  await page.getByRole("tab", { name: "引用", exact: true }).click();
  await page.getByRole("region", { name: "引用文献", exact: true }).waitFor();
  await page.getByRole("tab", { name: "版本", exact: true }).click();
  assert.equal(await editor.evaluate((current, original) => current === original, identity), true);
  checks.push({ panelSwitchKeepsEditor: true });

  // 中文组合输入走 Chromium 的实际 IME 事件，而非只检查输入框绑定。
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.evaluate(() => {
    window.__writingImeEvents = [];
    const target = document.querySelector('[aria-label="论文正文编辑区"][contenteditable="true"]');
    for (const type of ["compositionstart", "compositionupdate", "compositionend"]) target.addEventListener(type, () => window.__writingImeEvents.push(type));
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "中文", selectionStart: 2, selectionEnd: 2 });
  await cdp.send("Input.insertText", { text: "中文输入。" });
  await cdp.detach();
  await expectText(editor, "中文输入。");
  const imeEvents = await page.evaluate(() => window.__writingImeEvents);
  assert.ok(imeEvents.includes("compositionstart") && imeEvents.includes("compositionend"));
  await page.getByText("草稿已保留在本机", { exact: true }).waitFor();
  checks.push({ imeEvents });

  // 明确失败：正文和本机草稿保留；恢复网络后同一编辑可保存为新版本。
  const documentPath = `/api/v1/projects/${projectId}/documents/${documentId}`;
  await page.route(`**${documentPath}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    return route.fulfill({
      status: 400,
      contentType: "application/problem+json",
      body: JSON.stringify({ error: { code: "DOCUMENT_STRUCTURE_INVALID", message: "合成保存失败，请重试。" } }),
    });
  });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: /保存失败/ }).waitFor();
  await expectText(editor, "中文输入。");
  await page.unroute(`**${documentPath}`);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.locator(".writing-docbar").getByText("正式稿 v2", { exact: true }).waitFor();
  checks.push({ failedSaveRetained: true, retryVersion: 2 });

  // 另一窗口先写入 v3；本窗口的旧基线保存必须冲突，双方内容都可恢复。
  const otherSnapshot = snapshot();
  otherSnapshot.model.sections[0].blocks[1].inlines[0].text = "另一窗口保存的合成内容。";
  const otherSave = await api(`/projects/${projectId}/documents/${documentId}`, "PATCH", {
    expected_version: 2,
    content: { schema_version: 2, json: otherSnapshot },
  });
  assert.equal(otherSave.status, 200);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("本窗口尚未保存的合成草稿。");
  await page.getByText("草稿已保留在本机", { exact: true }).waitFor();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const conflict = page.getByRole("dialog", { name: "正式稿已在别处更新", exact: true });
  await conflict.waitFor({ state: "visible" });
  await expectText(editor, "本窗口尚未保存的合成草稿。");
  await conflict.getByRole("button", { name: "载入最新版本", exact: true }).click();
  await expectText(editor, "另一窗口保存的合成内容。");
  await page.getByRole("button", { name: /^本机草稿/ }).click();
  await page.getByRole("menuitem", { name: /恢复基于 v2 的草稿/ }).click();
  await expectText(editor, "本窗口尚未保存的合成草稿。");
  await page.getByText(/正式稿已有更新的 v3/).waitFor();
  await page.getByRole("button", { name: "处理冲突", exact: true }).click();
  await conflict.getByRole("button", { name: "以我的版本保存", exact: true }).click();
  await page.locator(".writing-docbar").getByText("正式稿 v4", { exact: true }).waitFor();
  checks.push({ conflictPreservedBoth: true, recoveredBase: 2, savedOverLatest: 4 });

  // 恢复 v1 应追加 v5，历史不删除；只读预览期间当前编辑器仍保留。
  const beforePreview = await editor.elementHandle();
  const history = page.getByRole("region", { name: "正式稿版本", exact: true });
  await history.getByRole("button", { name: "对比", exact: true }).last().click();
  await page.getByRole("textbox", { name: "正式稿 v1 只读预览", exact: true }).waitFor();
  assert.equal(await editor.evaluate((current, original) => current === original, beforePreview), true);
  await page.getByRole("region", { name: "正式稿版本对比", exact: true }).getByRole("button", { name: "恢复为新版本" }).click();
  await page.locator(".writing-docbar").getByText("正式稿 v5", { exact: true }).waitFor();
  editor = await openWriting(projectId);
  const versions = await api(`/projects/${projectId}/documents/${documentId}/versions?limit=10&offset=0`);
  assert.equal(versions.body.total, 5);
  checks.push({ historyVersionsRetained: 5, restoredVersion: 5 });

  for (const [theme, label] of [
    ["zhumo", "朱墨"],
    ["yingguang", "荧光笔记"],
    ["yehang", "夜航"],
    ["chenwu", "晨雾"],
  ]) {
    await selectTheme(label);
    editor = await openWriting(projectId);
    await settle();
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 1440);
    await page.screenshot({ path: path.join(output, `desktop-${theme}.png`), animations: "disabled" });
    checks.push({ theme, viewport: 1440, overflow: false });
  }

  for (const [tab, name] of [
    ["格式", "安全格式"],
    ["引用", "引用文献"],
    ["导入", "导入为新版本"],
    ["导出", "导出当前版本"],
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.getByRole("region", { name, exact: true }).waitFor();
    await settle();
    await page.screenshot({ path: path.join(output, `panel-${tab}.png`), animations: "disabled" });
  }
  checks.push({ panelVisuals: ["格式", "引用", "导入", "导出"] });

  await selectTheme("夜航");
  const reduced = page.getByLabel("减少动效");
  if (!(await reduced.isChecked())) await reduced.check();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  editor = await openWriting(projectId);
  await page.locator('html[data-motion="reduced"]').waitFor();
  assert.equal((await page.locator(".writing-status__zoom").textContent())?.trim(), "100%");
  await sampleReducedDrawer("打开章节目录", "章节目录");
  await sampleReducedDrawer("展开副驾", "写作副驾");
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  await page.screenshot({ path: path.join(output, "mobile-yehang-reduced.png"), animations: "disabled" });
  checks.push({ viewport: 390, overflow: false, keyboardFocusReturned: true, defaultZoom: "100%" });

  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "results.json"), JSON.stringify({ projectId, checks, errors }, null, 2) + "\n");
  console.log(`PASS: ${checks.length} 项写作界面检查；保存失败恢复、历史恢复、四主题、IME 与 390px 减弱抽屉均已实测。`);
  console.log(output);
} finally {
  await browser.close();
}

async function expectText(locator, text) {
  await locator.waitFor({ state: "visible" });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await locator.textContent())?.includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`正文未出现预期文字：${text}`);
}
