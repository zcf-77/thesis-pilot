import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";

interface EditorNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: EditorNode[];
  model?: EditorNode;
  sections?: EditorNode[];
  blocks?: EditorNode[];
  inlines?: EditorNode[];
}
interface SavedDocument {
  id: string;
  version: number;
  content: { schema_version: number; json: EditorNode };
}
interface ScenarioOptions {
  origin: string;
  suffix: string;
  screenshot?: (name: string) => Promise<void>;
  step?: (description: string) => Promise<void>;
}
function texts(node: EditorNode): string[] {
  const children = [...(node.content ?? []), ...(node.sections ?? []), ...(node.blocks ?? []), ...(node.inlines ?? []), ...(node.model ? [node.model] : [])];
  return [...(node.text === undefined ? [] : [node.text]), ...children.flatMap(texts)];
}

/** Real HTTP setup uses only synthetic inputs; all format decisions below are actual UI actions. */
export async function runFormatScenario(page: Page, options: ScenarioOptions) {
  const headers = { Origin: options.origin };
  await options.step?.("通过真实API准备独立合成项目、固定模板与受保护DOCX；格式决定仍在UI执行。");
  const created = await page.request.post("/api/v1/projects", { headers, data: { name: `安全格式合成验收 ${options.suffix}` } });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };
  const root = `/api/v1/projects/${project.id}`;
  async function upload(kind: string, filename: string, bytes: Buffer) {
    const response = await page.request.post(`${root}/materials`, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: {
        name: `合成${kind} ${options.suffix}`,
        filename,
        file_type: filename.endsWith(".docx") ? "docx" : "text",
        kind,
        source_note: "自动化生成的合成资料，无真实论文或凭据。",
        content_base64: bytes.toString("base64"),
      },
    });
    expect(response.status()).toBe(201);
    const receipt = (await response.json()) as { material: { id: string }; original: { id: string }; job: { id: string } };
    await expect
      .poll(
        async () => {
          const status = await page.request.get(`/api/v1/jobs/${receipt.job.id}?project_id=${project.id}`);
          expect(status.status()).toBe(200);
          return (await status.json()).status as string;
        },
        { timeout: 60_000 },
      )
      .toBe("succeeded");
    const done = await (await page.request.get(`/api/v1/jobs/${receipt.job.id}?project_id=${project.id}`)).json();
    return { ...receipt, parseId: done.artifacts[0].result.parse_version_id as string };
  }
  const template = await upload(
    "template",
    "synthetic-format-rules.txt",
    Buffer.from("标题层级：2\n标题对齐：居中\n标题字重：700\n段落对齐：两端对齐\n", "utf8"),
  );
  const manuscript = await upload(
    "other",
    "synthetic-manuscript.docx",
    await readFile(new URL("../../../../../work/competition-evidence/material-fixtures/synthetic-manuscript.docx", import.meta.url)),
  );
  const bound = await page.request.patch(`${root}/source-binding`, {
    headers,
    data: { expected_version: 0, template_parse_version_id: template.parseId, requirement_parse_version_ids: [] },
  });
  expect(bound.status()).toBe(200);
  const imported = await page.request.post(`${root}/document-import`, {
    headers,
    data: {
      command_id: crypto.randomUUID(),
      material_id: manuscript.material.id,
      original_version_id: manuscript.original.id,
      parse_version_id: manuscript.parseId,
      chapter_corrections: [],
    },
  });
  expect(imported.status()).toBe(201);
  const documentId = (await imported.json()).document_id as string;
  const documentRoot = `${root}/documents/${documentId}`;
  async function current(): Promise<SavedDocument> {
    const response = await page.request.get(`${root}/documents/current`);
    expect(response.status()).toBe(200);
    return (await response.json()) as SavedDocument;
  }
  await page.goto(`/#/projects/${project.id}/write?source=http%3Aworkspace`);
  const upgrading = page.waitForResponse(
    (reply) => reply.request().method() === "POST" && new URL(reply.url()).pathname === `${documentRoot}/schema-upgrade`,
  );
  await page.getByRole("button", { name: "升级为新版编辑器", exact: true }).click();
  expect((await upgrading).status()).toBe(201);
  const editor = page.locator('[aria-label="论文正文编辑区"][contenteditable="true"]');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  const initial = await current();
  expect(initial).toMatchObject({ version: 2, content: { schema_version: 2 } });
  const initialTexts = texts(initial.content.json);
  async function expectJustified(count: number) {
    await expect
      .poll(() => editor.locator("p").evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).textAlign === "justify").length))
      .toBe(count);
  }
  const panel = page.getByRole("region", { name: "安全格式", exact: true });
  async function openFormat() {
    await page.getByRole("tab", { name: "格式", exact: true }).click();
    await expect(panel).toBeVisible();
  }
  await openFormat();
  await expect(panel.getByRole("combobox")).toBeVisible();
  await expect(panel).toContainText(template.parseId);

  async function chooseRule(name: string) {
    await expect(panel.getByRole("combobox")).toBeEnabled();
    await panel.getByRole("combobox").click();
    await page.getByRole("option", { name, exact: true }).click();
  }
  async function waitCommand(buttonName: string | RegExp, operation: string) {
    const response = page.waitForResponse(
      (reply) =>
        reply.request().method() === "POST" && new URL(reply.url()).pathname.startsWith(documentRoot) && new URL(reply.url()).pathname.endsWith(operation),
    );
    await panel.getByRole("button", { name: buttonName }).click();
    const received = await response;
    expect(received.status()).toBe(operation === "/format-revisions" ? 201 : 200);
    return (await received.json()) as { result_version: number; candidate_id: string };
  }
  await options.step?.("选择真实模板段落对齐规则，明确勾选两个段落，候选逐项接受与拒绝。");
  await chooseRule("段落对齐 → 两端对齐");
  await expect(panel.getByRole("checkbox").first()).not.toBeChecked();
  await expect(panel.getByRole("button", { name: "生成格式候选", exact: true })).toBeDisabled();
  await panel.getByRole("checkbox").nth(0).check();
  await panel.getByRole("checkbox").nth(1).check();
  await waitCommand("生成格式候选", "/format-revisions");
  const patches = panel.locator(".format-patch");
  await expect(patches).toHaveCount(2);
  await patches.nth(0).getByRole("button", { name: "接受", exact: true }).click();
  await expect(patches.nth(0).getByRole("button", { name: "接受", exact: true })).toBeDisabled();
  await patches.nth(1).getByRole("button", { name: "拒绝", exact: true }).click();
  await expect(patches.nth(1).getByRole("button", { name: "拒绝", exact: true })).toBeDisabled();
  expect(texts((await current()).content.json)).toEqual(initialTexts);
  await options.screenshot?.("format-explicit-range-and-decisions.png");

  await options.step?.("只采纳接受项；核验原文、公式与来源原件未改，正式稿升级为v3。");
  const application = await waitCommand(/^采纳已接受（/, "/apply");
  expect(application.result_version).toBe(3);
  await expectJustified(1);
  const saved = await current();
  expect(saved.version).toBe(3);
  expect(texts(saved.content.json)).toEqual(initialTexts);
  const sourceReply = await page.request.get(`${documentRoot}/source?expected_document_version=3`);
  expect(sourceReply.status()).toBe(200);
  const source = await sourceReply.json();
  // SG-22 升级后来源合同 v3 / source-model-v2 直接保护 DocsModel 节点，不再使用旧投影覆盖层。
  expect(source.guard_contract).toMatchObject({ schema_version: 3, guard_version: "source-model-v2", upgraded_from_version: 1 });
  expect(source.guard_contract.editable_nodes.length).toBeGreaterThan(0);
  expect(source.guard_contract.format_overrides).toBeUndefined();
  expect(source.original_version_id).toBe(manuscript.original.id);
  expect(source.parse_version_id).toBe(manuscript.parseId);
  await editor.scrollIntoViewIfNeeded();
  await options.screenshot?.("format-adopted-source-v2.png");

  await page.reload();
  await expect(editor).toBeVisible();
  await expectJustified(1);
  await openFormat();
  await expect(panel.getByRole("button", { name: "撤销此次格式", exact: true })).toBeEnabled();
  await options.step?.("刷新仍保留格式与决定历史；撤销此次格式后恢复原始结构与文字。");
  const undone = await waitCommand("撤销此次格式", "/undo");
  expect(undone.result_version).toBe(4);
  await expectJustified(0);
  await editor.scrollIntoViewIfNeeded();
  expect((await current()).content).toEqual(initial.content);
  await options.screenshot?.("format-undone-original-restored.png");

  await options.step?.("按模板标题层级生成独立候选，采纳后标题为H2且文本不变，再撤销。");
  await chooseRule("标题层级 → 2 级标题");
  await panel.getByRole("checkbox").first().check();
  await waitCommand("生成格式候选", "/format-revisions");
  await patches.first().getByRole("button", { name: "接受", exact: true }).click();
  await expect(patches.first().getByRole("button", { name: "接受", exact: true })).toBeDisabled();
  await waitCommand(/^采纳已接受（/, "/apply");
  await expect(editor.locator("h2")).toHaveCount(1);
  await editor.scrollIntoViewIfNeeded();
  expect(texts((await current()).content.json)).toEqual(initialTexts);
  await options.screenshot?.("format-heading-adopted.png");
  await expect(panel.getByRole("button", { name: "撤销此次格式", exact: true })).toBeEnabled();
  await waitCommand("撤销此次格式", "/undo");
  await expect(editor.locator("h1")).toHaveCount(1);
  expect((await current()).content).toEqual(initial.content);

  await options.step?.("重现另一窗口保存导致候选过期：保留建议，禁止采纳旧版本。");
  await chooseRule("段落对齐 → 两端对齐");
  await panel.getByRole("checkbox").first().check();
  await waitCommand("生成格式候选", "/format-revisions");
  await patches.first().getByRole("button", { name: "接受", exact: true }).click();
  await expect(patches.first().getByRole("button", { name: "接受", exact: true })).toBeDisabled();
  const beforeConcurrent = await current();
  const concurrent = structuredClone(beforeConcurrent.content);
  const plain = concurrent.json.model?.sections
    ?.flatMap((section) => section.blocks ?? [])
    .find((node) => node.type === "paragraph" && node.inlines?.length === 1 && node.inlines[0]?.type === "run" && node.inlines[0].text);
  expect(plain).toBeDefined();
  const plainText = plain!.inlines![0]!.text!;
  plain!.inlines![0]!.text = `${plainText}（合成并发保存）`;
  const changed = await page.request.patch(documentRoot, { headers, data: { expected_version: beforeConcurrent.version, content: concurrent } });
  expect(changed.status()).toBe(200);
  await page.reload();
  await expect(editor).toBeVisible();
  await openFormat();
  await expect(panel).toContainText("此候选已过期");
  await expect(panel.getByRole("button", { name: /^采纳已接受（/ })).toBeDisabled();
  await expect(patches).toHaveCount(1);
  expect(texts((await current()).content.json)).toEqual(initialTexts.map((value) => (value === plainText ? `${plainText}（合成并发保存）` : value)));
  await options.screenshot?.("format-stale-candidate-retained.png");
  // Restore this deliberate concurrent edit through the same guarded save API; no fixture/user data is deleted.
  const latest = await current();
  const restored = await page.request.patch(documentRoot, { headers, data: { expected_version: latest.version, content: initial.content } });
  expect(restored.status()).toBe(200);
  expect((await current()).content).toEqual(initial.content);
  const versions = await page.request.get(`${documentRoot}/versions`);
  expect(versions.status()).toBe(200);
  expect((await versions.json()).total).toBeGreaterThanOrEqual(7);
  await page.reload();
  await expect(editor).toBeVisible();
  await expect(editor).not.toContainText("（合成并发保存）");
  await page.getByRole("tab", { name: "版本", exact: true }).click();
  const history = page.getByRole("region", { name: "正式稿版本", exact: true });
  await expect(history).toBeVisible();
  await history.scrollIntoViewIfNeeded();
  await options.screenshot?.("format-formal-history-preserved.png");
  return { projectId: project.id, documentId, initialVersion: 2, finalVersion: (await current()).version };
}
