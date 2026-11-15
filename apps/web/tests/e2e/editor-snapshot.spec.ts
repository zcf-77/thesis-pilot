import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "./app-url.ts";

const storageKey = "thesispilot.workspace.v1";
function savedWorkspace(html: string, structure?: unknown) {
  return {
    format: "ThesisPilot-workspace",
    schema: 1,
    savedAt: "2026-11-17T06:00:00Z",
    activeId: "snapshot-project",
    userName: "自制验收",
    notifications: true,
    quietStart: "22:00",
    quietEnd: "08:00",
    projects: [
      {
        id: "snapshot-project",
        title: "结构恢复样例",
        short: "结构恢复",
        stage: "论文撰写",
        deadline: "2026-12-25",
        workflowVersion: 1,
        templateVersion: 0,
        requirementVersion: 0,
        planning: "",
        archived: false,
        sample: false,
        document: {
          html,
          version: 1,
          savedAt: "原始版本",
          ...(structure ? { structure } : {}),
          history: [{ version: 1, html, at: "原始版本", cause: "自制输入", ...(structure ? { structure } : {}) }],
        },
        modules: {},
        events: [],
        priorWork: [],
      },
    ],
  };
}
async function seed(page: Page, value: ReturnType<typeof savedWorkspace>) {
  const raw = JSON.stringify(value);
  await page.addInitScript(
    ({ key, raw }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
    },
    { key: storageKey, raw },
  );
  await page.goto(appUrl("/screens/write"));
  return raw;
}
async function readDocument(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).projects[0].document, storageKey);
}

test("旧HTML显式附加结构不增加版本，刷新与返回保留章节身份和锁定", async ({ page }) => {
  const html = '<h1>旧稿🙂与𠮷字</h1><p><span data-ai-lock="true">锁定原句</span>，保留 1200 条记录 [1]。</p>';
  await seed(page, savedWorkspace(html));
  const editor = page.getByLabel("论文正文编辑区", { exact: true });
  await expect(editor).toContainText("旧稿🙂与𠮷字");
  await expect(editor.locator('[data-ai-lock="true"]')).toHaveText("锁定原句");
  await expect.poll(async () => (await readDocument(page)).structure?.json?.content?.[0]?.attrs?.chapterId).toBeTruthy();
  const migrated = await readDocument(page);
  expect(migrated.version).toBe(1);
  expect(migrated.history).toHaveLength(1);
  expect(migrated.html).toBe(html);
  expect(migrated.history[0].html).toBe(html);
  await page.reload();
  await expect(editor).toContainText("锁定原句");
  await page.getByRole("link", { name: "资料", exact: true }).click();
  await page.getByRole("link", { name: "写作", exact: true }).click();
  await expect(editor).toContainText("旧稿🙂与𠮷字");
  expect((await readDocument(page)).structure).toEqual(migrated.structure);
  expect((await readDocument(page)).version).toBe(1);
});

test("正式写作优先结构快照，编辑后刷新仍保留格式和章节身份", async ({ page }) => {
  const structure = {
    schemaVersion: 1,
    json: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, chapterId: "stable-chapter", templateAlign: "center", templateWeight: "700" },
          content: [{ type: "text", text: "结构标题🙂" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "结构正文𠮷", marks: [{ type: "aiLock" }] }] },
      ],
    },
    chapters: [],
  };
  const html = "<h2>保留的原HTML</h2><p>原始副本</p>";
  await seed(page, savedWorkspace(html, structure));
  const editor = page.getByLabel("论文正文编辑区", { exact: true });
  await expect(editor).toContainText("结构正文𠮷");
  await expect(editor).not.toContainText("原始副本");
  await expect(editor.locator("h2")).toHaveAttribute("data-chapter-id", "stable-chapter");
  await expect(editor.locator("h2")).toHaveCSS("text-align", "center");
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText("新增中文");
  await expect.poll(async () => (await readDocument(page)).version).toBeGreaterThan(1);
  const saved = await readDocument(page);
  expect(saved.history[0].html).toBe(html);
  await page.reload();
  await expect(editor).toContainText("新增中文");
  await expect(editor.locator("h2")).toHaveAttribute("data-chapter-id", "stable-chapter");
  await expect(editor.locator("h2")).toHaveCSS("font-weight", "700");
  expect((await readDocument(page)).version).toBe(saved.version);
});

test("未知结构拒绝工作区恢复并保持原存储字节", async ({ page }) => {
  const structure = {
    schemaVersion: 1,
    json: { type: "doc", content: [{ type: "paragraph", attrs: { preservedSourceId: "unsupported" }, content: [{ type: "text", text: "不可丢失的原稿" }] }] },
    chapters: [],
  };
  const raw = await seed(page, savedWorkspace("<p>不可丢失的原稿</p>", structure));
  await expect(page.getByText(/本地项目数据校验失败/)).toBeVisible();
  await page.waitForTimeout(350);
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(raw);
});

test("不能完整转换的旧HTML保留原稿，写作区不降级为可编辑正文", async ({ page }) => {
  const html = '<p title="不能无损表达的属性">保留这份旧稿</p>';
  await seed(page, savedWorkspace(html));
  await expect(page.getByRole("alert").filter({ hasText: "旧稿含不能完整转换" })).toBeVisible();
  await expect(page.getByLabel("论文正文编辑区", { exact: true })).toHaveAttribute("contenteditable", "false");
  await expect(page.getByRole("button", { name: "插入表格", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "1 级标题", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "更多对象", exact: true }).click();
  await expect(page.getByRole("button", { name: "插入图注文字", exact: true })).toBeDisabled();
  const saved = await readDocument(page);
  expect(saved.html).toBe(html);
  expect(saved.structure).toBeUndefined();
  expect(saved.version).toBe(1);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "旧稿含不能完整转换" })).toBeVisible();
  expect((await readDocument(page)).html).toBe(html);
});

test("超出结构范围的粘贴保存失败后，离开返回及重试保留草稿，修正后可以保存", async ({ page }) => {
  await seed(page, savedWorkspace("<p>原始正文</p>"));
  const editor = page.getByLabel("论文正文编辑区", { exact: true });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.press("ControlOrMeta+End");
  await editor.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/html", '<ol start="10001"><li><p>未保存的草稿</p></li><li><p>第二个条目</p></li></ol>');
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });
  const error = page.getByRole("alert").filter({ hasText: "文档结构版本" });
  await expect(error).toBeVisible();
  await expect(editor).toContainText("未保存的草稿");
  expect((await readDocument(page)).version).toBe(1);
  await page.getByRole("link", { name: "资料", exact: true }).click();
  await page.getByRole("link", { name: "写作", exact: true }).click();
  await expect(error).toBeVisible();
  await expect(editor).toContainText("未保存的草稿");
  await error.getByRole("button", { name: "重试", exact: true }).click();
  await expect(editor).toContainText("未保存的草稿");
  expect((await readDocument(page)).version).toBe(1);
  await editor.fill("修正后的草稿");
  await expect(error).toHaveCount(0);
  await expect.poll(async () => (await readDocument(page)).version).toBeGreaterThan(1);
  await page.reload();
  await expect(editor).toContainText("修正后的草稿");
});
