import { expect, test, type Page } from "@playwright/test";
import { caretAtEnd, manuscript, replaceManuscript, saveManuscript, selectAtStart, syntheticThesis } from "./writing-helpers.ts";

/**
 * SG-22 正式写作页（MuffinOffice 纸面）：真实 HTTP、PostgreSQL 与浏览器内核。
 * 覆盖空白起稿、保存、冲突与草稿恢复、锁定保护、深链定位、v1 显式升级、版本对比与恢复、三档宽度与四主题。
 */
const accessKey = process.env.TP_WORKSPACE_TEST_ACCESS_KEY!;

async function unlock(page: Page) {
  await page.goto("/");
  await page.getByLabel("工作区访问口令").fill(accessKey);
  await page.getByRole("button", { name: "解锁工作区" }).click();
  await expect(page.getByLabel("工作区访问口令")).toHaveCount(0);
}

async function api<T = unknown>(page: Page, path: string, method = "GET", body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ([target, verb, data]) => {
      const response = await fetch(`/api/v1${target}`, {
        method: verb,
        headers: { "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    [path, method, body] as const,
  );
}

async function project(page: Page, name: string, content?: unknown) {
  const created = await api<{ id: string }>(page, "/projects", "POST", { name: `${name} ${crypto.randomUUID().slice(0, 8)}` });
  expect(created.status).toBe(201);
  if (content) expect((await api(page, `/projects/${created.body.id}/documents`, "POST", { content })).status).toBe(201);
  return created.body.id;
}

type Current = {
  id: string;
  version: number;
  content: { schema_version: number; json: { protections: { kind: string }[]; model: { sections: { blocks: { id: string; type: string }[] }[] } } };
};
const current = (page: Page, projectId: string) => api<Current>(page, `/projects/${projectId}/documents/current`);

test("空白起稿直接成为 v2，保存、刷新恢复草稿、双窗口冲突、载入最新与草稿恢复都不丢稿", async ({ page, browser, baseURL }) => {
  await unlock(page);
  const projectId = await project(page, "自制写作页起稿");
  await page.goto(`/#/projects/${projectId}/write`);
  await expect(page.getByText("还没有正式稿")).toBeVisible();
  await page.getByRole("button", { name: "创建空白正式稿" }).click();
  await replaceManuscript(page, "这是正式工作区的自制初稿。");
  await expect(page.getByRole("status").filter({ hasText: "有未保存的修改" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("正式稿 v3", { exact: true })).toBeVisible();
  const first = await current(page, projectId);
  // 服务端空白稿为 v1，随即显式升级为 v2；首次保存得到 v3。
  expect(first.body).toMatchObject({ version: 3, content: { schema_version: 2 } });

  await replaceManuscript(page, "本窗口尚未保存的自制草稿。");
  await expect(page.getByText("草稿已保留在本机")).toBeVisible();
  await page.reload();
  await expect(manuscript(page)).toContainText("本窗口尚未保存的自制草稿。");
  await expect(page.getByRole("status").filter({ hasText: "有未保存的修改" })).toBeVisible();

  const otherContext = await browser.newContext({ baseURL });
  try {
    const other = await otherContext.newPage();
    await unlock(other);
    await other.goto(`/#/projects/${projectId}/write`);
    await expect(manuscript(other)).toContainText("这是正式工作区的自制初稿。");
    await replaceManuscript(other, "另一窗口保存的自制修订稿。");
    expect(await saveManuscript(other, projectId)).toBe(200);
  } finally {
    await otherContext.close();
  }

  expect(await saveManuscript(page, projectId)).toBe(409);
  const dialog = page.getByRole("dialog", { name: "正式稿已在别处更新" });
  await expect(dialog).toBeVisible();
  await expect(manuscript(page)).toContainText("本窗口尚未保存的自制草稿。");
  await dialog.getByRole("button", { name: "载入最新版本" }).click();
  await expect(manuscript(page)).toContainText("另一窗口保存的自制修订稿。");

  await page.getByRole("button", { name: /^本机草稿/ }).click();
  await page.getByRole("menuitem", { name: /恢复基于 v3 的草稿/ }).click();
  await expect(manuscript(page)).toContainText("本窗口尚未保存的自制草稿。");
  await expect(page.getByText(/正式稿已有更新的 v4/)).toBeVisible();
  const saveOver = page.waitForResponse((response) => response.request().method() === "PATCH");
  await page.getByRole("button", { name: "处理冲突" }).click();
  await page.getByRole("dialog", { name: "正式稿已在别处更新" }).getByRole("button", { name: "以我的版本保存" }).click();
  expect((await saveOver).status()).toBe(200);
  const final = await current(page, projectId);
  expect(final.body.version).toBe(5);
  await expect(page.getByRole("button", { name: /^本机草稿/ })).toHaveCount(0);
});

test("锁定选区经保存生效并拦截输入，深链定位章节；原件以外的结构命令真实落到模型", async ({ page }) => {
  await unlock(page);
  const projectId = await project(page, "自制写作页锁定", { schema_version: 2, json: syntheticThesis() });
  await page.goto(`/#/projects/${projectId}/write`);
  await expect(manuscript(page)).toContainText("第1章第1段");
  await expect(page.getByRole("navigation", { name: "文章章节目录" }).getByRole("button", { name: /第3章 自制章节3/ })).toBeVisible();

  await selectAtStart(page, "p-1-2", 4);
  const bubble = page.getByRole("toolbar", { name: "选区操作" });
  await expect(bubble).toBeVisible();
  await bubble.getByRole("button", { name: "锁定" }).click();
  await selectAtStart(page, "p-1-2", 0);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.insertText("改");
  await expect(page.getByText("锁定内容受保护，修改没有生效。正文保持不变；如需改动，请先解除锁定。")).toBeVisible();

  await caretAtEnd(page, "p-2-1");
  await page.getByRole("tab", { name: "插入" }).click();
  await page.getByRole("button", { name: "表格" }).click();
  await page.keyboard.insertText("自制表头");
  expect(await saveManuscript(page, projectId)).toBe(200);
  const saved = await current(page, projectId);
  expect(saved.body.content.json.protections).toEqual([expect.objectContaining({ kind: "lock", anchor: { node: "p-1-2", start: 0, end: 4 } })]);
  expect(saved.body.content.json.model.sections[0]!.blocks.some((block) => block.type === "table")).toBe(true);

  await page.reload();
  await selectAtStart(page, "p-1-2", 2);
  await expect(page.getByRole("toolbar", { name: "选区操作" }).getByRole("button", { name: "解除锁定" })).toBeVisible();

  await page.goto(`/#/projects/${projectId}/write?chapterId=ch-4&review=${crypto.randomUUID()}`);
  await expect(page.locator('[data-node-id="ch-4"]').first()).toBeInViewport();
  await page.goto(`/#/projects/${projectId}/write?anchor=missing-node`);
  await expect(page.getByText("链接指向的位置已不在当前正文中")).toBeVisible();
});

test("v1 正文只读预览，显式升级生成新版本后进入编辑；版本对比只读并可恢复为新版本", async ({ page }) => {
  await unlock(page);
  const heading = { type: "heading", attrs: { level: 1, chapterId: crypto.randomUUID() }, content: [{ type: "text", text: "旧版自制章节" }] };
  const json = { type: "doc", content: [heading, { type: "paragraph", content: [{ type: "text", text: "旧版编辑器写下的自制段落。" }] }] };
  const projectId = await project(page, "自制写作页升级", { schema_version: 1, json });
  await page.goto(`/#/projects/${projectId}/write`);
  await expect(page.getByRole("heading", { name: "这份正式稿使用旧版编辑器结构" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "旧版结构正文只读预览" })).toContainText("旧版编辑器写下的自制段落。");
  await expect(page.getByRole("button", { name: "保存", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "升级为新版编辑器" }).click();
  await expect(manuscript(page)).toContainText("旧版编辑器写下的自制段落。");
  const upgraded = await current(page, projectId);
  expect(upgraded.body).toMatchObject({ version: 2, content: { schema_version: 2 } });

  await caretAtEnd(page, upgraded.body.content.json.model.sections[0]!.blocks[1]!.id);
  await page.keyboard.insertText("升级后补写。");
  expect(await saveManuscript(page, projectId)).toBe(200);

  await page.getByRole("button", { name: "展开副驾" }).click();
  await page.getByRole("tab", { name: "版本", exact: true }).click();
  const history = page.getByRole("region", { name: "正式稿版本" });
  await history.getByRole("button", { name: "对比" }).nth(1).click();
  const comparison = page.getByRole("region", { name: "正式稿版本对比" });
  await expect(comparison).toContainText("查看 v2");
  await expect(comparison).toContainText("1 段修改");
  await expect(page.getByRole("textbox", { name: "正式稿 v2 只读预览" })).toBeVisible();
  const revert = page.waitForResponse((response) => response.url().includes("/revert"));
  await comparison.getByRole("button", { name: "恢复为新版本" }).click();
  expect((await revert).status()).toBe(200);
  await expect(page.getByText("正式稿 v4", { exact: true })).toBeVisible();
  await expect(manuscript(page)).not.toContainText("升级后补写。");
  expect((await current(page, projectId)).body.version).toBe(4);
});

test("三档宽度与四主题：1440 三栏常驻、1024 副驾可收起、390 抽屉；减弱动效下无横向溢出", async ({ browser, baseURL }, testInfo) => {
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
  ] as const) {
    const context = await browser.newContext({ baseURL, viewport: { width, height }, reducedMotion: width === 390 ? "reduce" : "no-preference" });
    const page = await context.newPage();
    await unlock(page);
    const projectId = await project(page, `自制写作页布局 ${width}`, { schema_version: 2, json: syntheticThesis() });
    await page.goto(`/#/projects/${projectId}/write`);
    await expect(manuscript(page)).toContainText("第1章第1段");
    const outline = page.getByRole("complementary", { name: "章节目录" });
    const copilot = page.getByRole("complementary", { name: "写作副驾" });
    if (width === 1440) {
      await expect(outline).toBeVisible();
      await expect(copilot).toBeVisible();
    } else if (width === 1024) {
      await expect(outline).toBeVisible();
      await expect(copilot).toBeHidden();
      await page.getByRole("button", { name: "展开副驾" }).click();
      await expect(copilot).toBeVisible();
      await page.getByRole("button", { name: "收起副驾" }).first().click();
      await expect(copilot).toBeHidden();
    } else {
      await page.getByRole("button", { name: "打开章节目录" }).click();
      const drawer = page.getByRole("dialog", { name: "章节目录" });
      await expect(drawer.getByRole("button", { name: "关闭章节目录" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "章节目录" })).toHaveCount(0);
    }
    for (const theme of ["zhumo", "yingguang", "yehang", "chenwu"]) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      // 页面转场与栏宽过渡结束后再量（转场期间外壳本身有短暂位移）。
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`writing-${width}-${theme}.png`), animations: "disabled" });
    }
    await context.close();
  }
});
