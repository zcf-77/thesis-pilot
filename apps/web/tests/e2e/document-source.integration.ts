import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

interface EditorNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string }[];
  content?: EditorNode[];
}

async function select(page: Page, scope: Locator, label: string, option: string) {
  const trigger = scope.getByRole("combobox", { name: label, exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("合成DOCX固定来源导入、章节校正、受保护文字编辑与原件历史可恢复", async ({ page }, testInfo) => {
  // SG-22：资料导入改由写作副驾导入面板（切片 D）提供，原件正文以快照 v2 呈现（标题与段落不再是 h2/p 元素）。
  // 协调者登记导入面板后，按 tests/e2e/writing-helpers.ts 的纸面交互更新导入与编辑步骤并去掉此标记。
  test.fixme(true, "依赖切片 D 的写作副驾导入面板");
  test.setTimeout(150000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  // Generate the reusable synthetic fixture with apps/api/scripts/create_material_demo.py.
  const bytes = await readFile(resolve("../../work/competition-evidence/material-fixtures/synthetic-manuscript.docx"));
  const originalSha = createHash("sha256").update(bytes).digest("hex");
  await page.goto("/#/projects");
  await page.getByLabel("工作区访问口令").fill(process.env.TP_WORKSPACE_TEST_ACCESS_KEY!);
  await page.getByRole("button", { name: "解锁工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
  const suffix = crypto.randomUUID();
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill(`合成原件导入 ${suffix}`);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/write$/);
  const projectId = page.url().match(/projects\/([^/]+)\/write/)![1]!;
  const materialsRoot = `/api/v1/projects/${projectId}/materials`;
  const materialName = `合成固定DOCX ${suffix}`;
  await page.getByRole("link", { name: "资料", exact: true }).click();
  await page.getByRole("button", { name: "上传资料", exact: true }).click();
  const form = page.getByRole("region", { name: "上传资料", exact: true });
  await form.getByLabel("资料文件").setInputFiles({
    name: "synthetic-manuscript.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: bytes,
  });
  // TpField's label text includes the required marker; its role name excludes it.
  // Match the label without exact so the required/optional decorations stay harmless.
  await expect(form.getByLabel("资料名称")).toBeVisible();
  await form.getByLabel("资料名称").fill(materialName);
  await select(page, form, "资料分类", "其他资料");
  await form.getByLabel("资料来源").fill("程序生成的合成校园图书检索示例，无真实论文或凭据。");
  const uploaded = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === materialsRoot);
  await form.getByRole("button", { name: "上传并解析", exact: true }).click();
  const uploadedResponse = await uploaded;
  expect(uploadedResponse.status()).toBe(201);
  const receipt = await uploadedResponse.json();
  expect(receipt.original.sha256).toBe(originalSha);
  await expect
    .poll(async () => (await (await page.request.get(`/api/v1/jobs/${receipt.job.id}?project_id=${projectId}`)).json()).status, { timeout: 45000 })
    .toBe("succeeded");
  const completed = await (await page.request.get(`/api/v1/jobs/${receipt.job.id}?project_id=${projectId}`)).json();
  const parseId = completed.artifacts[0].result.parse_version_id as string;
  const parsedReply = await page.request.get(`${materialsRoot}/${receipt.material.id}/originals/${receipt.original.id}/parses/${parseId}`);
  expect(parsedReply.status()).toBe(200);
  const parsed = await parsedReply.json();
  expect(parsed.result.status).toBe("partial");
  expect(parsed.result.anchors.some((anchor: { kind: string }) => anchor.kind === "formula")).toBe(true);
  expect((await page.request.get(`/api/v1/projects/${projectId}/documents/current`)).status()).toBe(404);

  await page.getByRole("link", { name: "写作", exact: true }).click();
  await page.getByRole("button", { name: "从资料导入", exact: true }).click();
  const importer = page.getByRole("region", { name: "从资料导入", exact: true });
  await select(page, importer, "导入资料", materialName);
  await select(page, importer, "导入原件版本", "原件 v1 · synthetic-manuscript.docx");
  await select(page, importer, "导入解析版本", "解析 v1 · 部分");
  const previewed = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v1/projects/${projectId}/document-import/preview`,
  );
  await importer.getByRole("button", { name: "预览导入范围", exact: true }).click();
  const previewedResponse = await previewed;
  expect(previewedResponse.status()).toBe(200);
  const preview = await previewedResponse.json();
  expect(preview).toMatchObject({ material_id: receipt.material.id, original_version_id: receipt.original.id, parse_version_id: parseId, can_import: true });
  const chapters = page.getByRole("region", { name: "原始章节预览", exact: true });
  const firstChapter = chapters.getByRole("article", { name: "导入章节 1", exact: true });
  const secondChapter = chapters.getByRole("article", { name: "导入章节 2", exact: true });
  await select(page, firstChapter, "导入后标题级别", "2级标题");
  await select(page, secondChapter, "导入后类型", "标题");
  await select(page, secondChapter, "导入后标题级别", "3级标题");
  await page.screenshot({ path: testInfo.outputPath("source-import-explicit-chapters.png"), fullPage: true });
  const imported = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v1/projects/${projectId}/document-import`,
  );
  await chapters.getByRole("button", { name: "确认导入正式稿", exact: true }).click();
  const importedResponse = await imported;
  expect(importedResponse.status()).toBe(201);
  const importedReceipt = await importedResponse.json();
  const documentId = importedReceipt.document_id as string;
  const documentRoot = `/api/v1/projects/${projectId}/documents/${documentId}`;
  const editor = page.locator('[aria-label="论文正文编辑区"][contenteditable="true"]');
  await expect(editor).toBeVisible();
  await expect(editor.locator("h2")).toHaveText("第一章 绪论");
  await expect(editor.locator("h3")).toContainText("本文件为自制校园图书检索系统演示稿");
  const sourcePanel = page.getByRole("region", { name: "正式稿来源", exact: true });
  await expect(sourcePanel).toContainText("synthetic-manuscript.docx");
  await expect(sourcePanel).toContainText("已应用 2 项章节校正");
  const initialSourceReply = await page.request.get(`${documentRoot}/source?expected_document_version=1`);
  expect(initialSourceReply.status()).toBe(200);
  const initialSource = await initialSourceReply.json();
  expect(initialSource).toMatchObject({ original_version_id: receipt.original.id, parse_version_id: parseId, original_sha256: originalSha });
  expect(initialSource.guard_contract.chapter_overrides).toHaveLength(2);
  await expect(page.getByRole("button", { name: "加粗", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "1 级标题", exact: true })).toBeDisabled();

  const paragraph = editor.locator("p").filter({ hasText: "论文正文不少于8000字。" });
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("合成保存验证。");
  await expect(paragraph).toHaveText("论文正文不少于8000字。合成保存验证。");
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === documentRoot);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const savedResponse = await saved;
  expect(savedResponse.status()).toBe(200);
  expect((await savedResponse.json()).version).toBe(2);
  await page.reload();
  await expect(editor).toBeVisible();
  await expect(editor.locator("p").filter({ hasText: "论文正文不少于8000字。" })).toHaveText("论文正文不少于8000字。合成保存验证。");
  await expect(editor.locator("h2")).toHaveText("第一章 绪论");
  const latestSource = await (await page.request.get(`${documentRoot}/source?expected_document_version=2`)).json();
  expect(latestSource.guard_contract).toEqual(initialSource.guard_contract);
  expect(latestSource.source_id).toBe(initialSource.source_id);

  const beforeBlockedEnter = await editor.innerText();
  await editor.locator("p").filter({ hasText: "合成保存验证。" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect.poll(() => editor.innerText()).toBe(beforeBlockedEnter);
  await expect(page.getByRole("alert").filter({ hasText: "来源保护已阻止这次修改" })).toBeVisible();

  // Also prove the server rejects a valid-JSON request that bypasses the client guard.
  const current = (await (await page.request.get(`/api/v1/projects/${projectId}/documents/current`)).json()) as {
    version: number;
    content: { schema_version: 1; json: EditorNode };
  };
  const forged = structuredClone(current.content);
  const locked = forged.json.content!.find((node) => node.content?.some((part) => part.marks?.some((mark) => mark.type === "aiLock")));
  expect(locked).toBeDefined();
  locked!.content![0]!.text = "试图替换受保护公式";
  const rejected = await page.request.patch(documentRoot, {
    headers: { Origin: process.env.TP_WORKSPACE_TEST_ORIGIN! },
    data: { expected_version: 2, content: forged },
  });
  expect(rejected.status()).toBe(409);
  expect((await rejected.json()).error.code).toBe("DOCUMENT_SOURCE_PROTECTED");
  expect(await (await page.request.get(`/api/v1/projects/${projectId}/documents/current`)).json()).toMatchObject(current);
  expect((await (await page.request.get(`${documentRoot}/versions`)).json()).total).toBe(2);

  async function checkDownload(scope: Locator) {
    const downloaded = page.waitForEvent("download");
    await scope.getByRole("button", { name: "下载来源原件", exact: true }).click();
    const file = await downloaded;
    const downloadedBytes = await readFile((await file.path())!);
    expect(downloadedBytes).toEqual(bytes);
    expect(createHash("sha256").update(downloadedBytes).digest("hex")).toBe(originalSha);
  }
  await checkDownload(sourcePanel);
  await page.screenshot({ path: testInfo.outputPath("source-v2-and-guard.png"), fullPage: true });
  await page.goto(`/#/projects/${projectId}/documents/${documentId}/versions/1?source=http%3Aworkspace`);
  await expect(page.getByRole("region", { name: "正式稿版本对比", exact: true })).toBeVisible();
  const historical = page.getByRole("region", { name: "历史正式稿来源", exact: true });
  await expect(historical).toContainText("synthetic-manuscript.docx");
  await expect(historical).toContainText("正式稿 v1");
  const historicalSource = await (await page.request.get(`${documentRoot}/versions/1/source`)).json();
  expect(historicalSource.guard_contract).toEqual(initialSource.guard_contract);
  await checkDownload(historical);
  await page.screenshot({ path: testInfo.outputPath("source-immutable-history.png"), fullPage: true });
});
