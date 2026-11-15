import { expect, test, type Page } from "@playwright/test";
import type { EditorSnapshot } from "../../src/lab/state/editorAdapter.ts";
import { appUrl } from "./app-url.ts";

const storageKey = "thesispilot.workspace.v1";
type SavedDocument = {
  html: string;
  version: number;
  structure?: EditorSnapshot;
  history: { html: string; version: number; structure?: EditorSnapshot }[];
};
async function seedLegacy(page: Page, html: string) {
  const workspace = {
    format: "ThesisPilot-workspace",
    schema: 1,
    savedAt: "2026-11-17T06:00:00Z",
    activeId: "legacy-format-project",
    userName: "自制格式验收",
    notifications: true,
    quietStart: "22:00",
    quietEnd: "08:00",
    projects: [
      {
        id: "legacy-format-project",
        title: "旧稿格式样例",
        short: "旧稿格式",
        stage: "论文撰写",
        deadline: "2026-12-25",
        workflowVersion: 1,
        templateVersion: 0,
        requirementVersion: 0,
        planning: "",
        archived: false,
        sample: false,
        document: { html, version: 1, savedAt: "原始版本", history: [{ version: 1, html, at: "原始版本", cause: "自制旧稿" }] },
        modules: {},
        events: [],
        priorWork: [],
      },
    ],
  };
  await page.addInitScript(
    ({ key, raw }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
    },
    { key: storageKey, raw: JSON.stringify(workspace) },
  );
  await page.goto(appUrl("/screens/write"));
}
async function readDocument(page: Page): Promise<SavedDocument> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).projects[0].document, storageKey);
}

test("旧HTML模板字重不派生额外粗体，锁定及文末表格在转换保存和刷新后完整", async ({ page }) => {
  const html =
    '<h2 data-chapter-id="template-heading" data-template-weight="700" data-template-align="center" style="font-weight:700; text-align:center">模板标题🙂</h2>' +
    '<p><span data-ai-lock="true">锁定原句</span>，普通正文</p>' +
    "<table><tbody><tr><th><p>表头</p></th></tr><tr><td><p>末尾表格𠮷</p></td></tr></tbody></table>";
  await seedLegacy(page, html);
  const editor = page.getByLabel("论文正文编辑区", { exact: true });
  await expect(editor.locator("h2")).toHaveCSS("font-weight", "700");
  await expect(editor.locator("h2")).toHaveCSS("text-align", "center");
  await expect(editor.locator("h2 strong")).toHaveCount(0);
  await expect(editor.locator('[data-ai-lock="true"]')).toHaveText("锁定原句");
  await expect(editor.getByRole("table")).toHaveCount(1);
  await expect(editor.getByRole("cell")).toHaveText("末尾表格𠮷");
  await expect(editor.locator(":scope > p")).toHaveCount(1);
  await expect.poll(async () => (await readDocument(page)).structure?.json.content?.map((node) => node.type)).toEqual(["heading", "paragraph", "table"]);
  const migrated = await readDocument(page);
  expect(migrated.html).toBe(html);
  expect(migrated.version).toBe(1);
  expect(migrated.structure!.json.content![0]!.content![0]!.marks).toBeUndefined();
  await page.reload();
  await expect(editor.locator("h2 strong")).toHaveCount(0);
  await expect(editor.getByRole("table")).toHaveCount(1);
  await expect(editor.locator(":scope > p")).toHaveCount(1);
  expect((await readDocument(page)).structure).toEqual(migrated.structure);

  await editor.locator(":scope > p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("续写");
  await expect.poll(async () => (await readDocument(page)).html.includes("续写")).toBe(true);
  const saved = await readDocument(page);
  expect(saved.version).toBeGreaterThan(1);
  expect(saved.structure!.json.content![0]!.content![0]!.marks).toBeUndefined();
  expect(saved.structure!.json.content![1]!.content![0]!.marks).toEqual([{ type: "aiLock" }]);
  expect(saved.structure!.json.content!.some((node) => node.type === "table")).toBe(true);
  expect(saved.history[0]!.html).toBe(html);
  await page.reload();
  await expect(editor).toContainText("普通正文续写");
  await expect(editor.locator("h2")).toHaveAttribute("data-chapter-id", "template-heading");
  await expect(editor.locator("h2")).toHaveCSS("font-weight", "700");
  await expect(editor.locator("h2 strong")).toHaveCount(0);
  await expect(editor.locator('[data-ai-lock="true"]')).toHaveText("锁定原句");
  expect((await readDocument(page)).structure).toEqual(saved.structure);
  expect((await readDocument(page)).version).toBe(saved.version);
});

for (const fixture of [
  { name: "列表", html: '<ol start="2" type="a"><li><p>列表末尾中文</p></li></ol>', selector: "ol", type: "orderedList", text: "列表末尾中文" },
  { name: "代码块", html: '<pre><code class="language-js">const 中文 = 1;\n</code></pre>', selector: "pre", type: "codeBlock", text: "const 中文 = 1;" },
]) {
  test(`旧HTML以${fixture.name}结尾时，转换及刷新不会额外写入空段落`, async ({ page }) => {
    await seedLegacy(page, fixture.html);
    const editor = page.getByLabel("论文正文编辑区", { exact: true });
    await expect(editor.locator(`:scope > ${fixture.selector}`)).toContainText(fixture.text);
    await expect(editor.locator(":scope > p")).toHaveCount(0);
    await expect.poll(async () => (await readDocument(page)).structure?.json.content?.map((node) => node.type)).toEqual([fixture.type]);
    const saved = await readDocument(page);
    expect(saved.html).toBe(fixture.html);
    expect(saved.version).toBe(1);
    expect(saved.history).toHaveLength(1);
    await page.reload();
    await expect(editor.locator(`:scope > ${fixture.selector}`)).toContainText(fixture.text);
    await expect(editor.locator(":scope > p")).toHaveCount(0);
    expect((await readDocument(page)).structure).toEqual(saved.structure);
    expect((await readDocument(page)).version).toBe(1);
  });
}
