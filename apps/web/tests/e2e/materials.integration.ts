import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { chooseOption } from "./select-option.ts";

test("资料原件、真实解析、固定来源绑定与失败重试保留正式稿边界", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.goto("/#/projects");
  await page.getByLabel("工作区访问口令").fill(process.env.TP_WORKSPACE_TEST_ACCESS_KEY!);
  await page.getByRole("button", { name: "解锁工作区" }).click();
  await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
  const suffix = crypto.randomUUID();
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill(`合成资料闭环 ${suffix}`);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page).toHaveURL(/\/write$/);
  const projectId = page.url().match(/projects\/([^/]+)\/write/)![1]!;
  await page.getByRole("link", { name: "资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "项目资料", exact: true, level: 1 })).toBeVisible();
  const root = `/api/v1/projects/${projectId}/materials`;

  async function upload(name: string, filename: string, mimeType: string, bytes: Buffer, kind: string) {
    await page.getByRole("button", { name: "上传资料", exact: true }).click();
    const form = page.getByRole("region", { name: "上传资料", exact: true });
    await form.getByLabel("资料文件", { exact: true }).setInputFiles({ name: filename, mimeType, buffer: bytes });
    await form.getByLabel("资料名称").fill(name);
    await chooseOption(form.getByRole("combobox", { name: "资料分类", exact: true }), { label: kind });
    await form.getByLabel("资料来源").fill("自动生成的合成演示数据，不含真实论文。");
    const received = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === root);
    await form.getByRole("button", { name: "上传并解析", exact: true }).click();
    const response = await received;
    expect(response.status()).toBe(201);
    const receipt = await response.json();
    expect(receipt.original.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(receipt.job.kind).toBe("material_parse");
    expect(receipt.original).not.toHaveProperty("data");
    await expect(form).toHaveCount(0);
    return receipt;
  }

  async function waitJob(jobId: string, status: string) {
    await expect
      .poll(async () => (await (await page.request.get(`/api/v1/jobs/${jobId}?project_id=${projectId}`)).json()).status, { timeout: 45000 })
      .toBe(status);
    return await (await page.request.get(`/api/v1/jobs/${jobId}?project_id=${projectId}`)).json();
  }
  async function reopen(name: string) {
    await page.reload();
    await page.getByRole("button", { name, exact: true }).click();
  }
  async function downloadOriginal(bytes: Buffer) {
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载原件", exact: true }).click();
    const artifact = await downloaded;
    expect(await readFile((await artifact.path())!)).toEqual(bytes);
  }

  const textName = `合成要求 ${suffix}`;
  const textBytes = Buffer.from("第一章 绪论\n论文正文不少于8000字。\n参考文献不少于15篇。\n", "utf8");
  const textReceipt = await upload(textName, "synthetic-requirements.txt", "text/plain", textBytes, "论文要求");
  const textJob = await waitJob(textReceipt.job.id, "succeeded");
  expect(textJob.artifacts[0].result).toMatchObject({ model_used: false, writes_performed: false, original_version_id: textReceipt.original.id });
  const textParseId = textJob.artifacts[0].result.parse_version_id;
  await reopen(textName);
  await expect(page.getByRole("region", { name: "解析结果", exact: true })).toContainText("论文正文不少于8000字。");
  await downloadOriginal(textBytes);
  await page.getByRole("tab", { name: /论文要求/ }).click();
  const binding = page.getByRole("region", { name: "要求集绑定", exact: true });
  await binding.getByRole("checkbox", { name: `绑定要求：${textName} · 原件v1 · 解析v1`, exact: true }).check();
  const bound = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/v1/projects/${projectId}/source-binding`,
  );
  await binding.getByRole("button", { name: "保存要求集绑定", exact: true }).click();
  expect((await bound).status()).toBe(200);
  expect(await (await page.request.get(`/api/v1/projects/${projectId}/source-binding`)).json()).toMatchObject({
    version: 1,
    requirement_parse_version_ids: [textParseId],
  });

  // Generate this synthetic input with apps/api/scripts/create_material_demo.py before running.
  const fixtures = process.env.TP_MATERIAL_FIXTURES ?? "../../work/competition-evidence/material-fixtures";
  const docxBytes = await readFile(resolve(fixtures, "synthetic-manuscript.docx"));
  const docxName = `合成DOCX ${suffix}`;
  const docxReceipt = await upload(
    docxName,
    "synthetic-manuscript.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    docxBytes,
    "其他资料",
  );
  const docxJob = await waitJob(docxReceipt.job.id, "succeeded");
  const docxParse = await (
    await page.request.get(`${root}/${docxReceipt.material.id}/originals/${docxReceipt.original.id}/parses/${docxJob.artifacts[0].result.parse_version_id}`)
  ).json();
  expect(docxParse.result.status).toBe("partial");
  expect(docxParse.result.anchors.some((anchor: { editable: boolean }) => !anchor.editable)).toBe(true);
  await reopen(docxName);
  await expect(page.getByRole("region", { name: "解析结果", exact: true })).toContainText("第一章 绪论");
  await downloadOriginal(docxBytes);
  await page.screenshot({ path: testInfo.outputPath("docx-source-and-protected-object.png"), fullPage: true });

  const detail = page.getByRole("complementary", { name: "所选资料详情", exact: true });
  const patched = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `${root}/${docxReceipt.material.id}`,
  );
  await chooseOption(detail.getByRole("combobox", { name: "资料分类", exact: true }), { label: "论文模板" });
  expect((await patched).status()).toBe(200);
  const templateBlock = detail.getByRole("region", { name: "模板结构与支持范围", exact: true });
  await expect(templateBlock).toBeVisible();
  const templateBound = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/v1/projects/${projectId}/source-binding`,
  );
  await templateBlock.getByRole("button", { name: "绑定此模板版本", exact: true }).click();
  expect((await templateBound).status()).toBe(200);
  expect(await (await page.request.get(`/api/v1/projects/${projectId}/source-binding`)).json()).toMatchObject({
    version: 2,
    template_parse_version_id: docxJob.artifacts[0].result.parse_version_id,
    requirement_parse_version_ids: [textParseId],
  });
  await page.getByRole("tab", { name: /模板/ }).click();
  await expect(page.getByRole("button", { name: docxName, exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "移出当前目录", exact: true }).click();
  await expect(page.getByRole("button", { name: docxName, exact: true })).toHaveCount(0);
  expect((await (await page.request.get(`${root}/${docxReceipt.material.id}`)).json()).removed).toBe(true);
  await detail.getByRole("button", { name: "撤销移出", exact: true }).click();
  await expect(page.getByRole("button", { name: docxName, exact: true })).toBeVisible();
  expect((await (await page.request.get(`${root}/${docxReceipt.material.id}`)).json()).removed).toBe(false);
  await page.getByRole("tab", { name: /项目资料/ }).click();

  const invalidName = `合成无效UTF8 ${suffix}`;
  const invalidBytes = Buffer.from([0xff, 0xfe, 0x00]);
  const invalidReceipt = await upload(invalidName, "invalid-utf8.txt", "text/plain", invalidBytes, "其他资料");
  await waitJob(invalidReceipt.job.id, "failed");
  await reopen(invalidName);
  await downloadOriginal(invalidBytes);
  const task = page.getByRole("region", { name: "解析状态", exact: true });
  const retried = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v1/jobs/${invalidReceipt.job.id}/retry`,
  );
  await task.getByRole("button", { name: "重试解析", exact: true }).click();
  const retryResponse = await retried;
  expect(retryResponse.status()).toBe(202);
  const retry = await retryResponse.json();
  expect(retry.source_job_id).toBe(invalidReceipt.job.id);
  expect(retry.input_snapshot).toEqual(invalidReceipt.job.input_snapshot);
  await waitJob(retry.id, "failed");
  expect((await page.request.get(`/api/v1/projects/${projectId}/documents/current`)).status()).toBe(404);
  expect(await (await page.request.get(`/api/v1/projects/${projectId}/source-binding`)).json()).toMatchObject({
    version: 2,
    requirement_parse_version_ids: [textParseId],
  });
  await page.screenshot({ path: testInfo.outputPath("material-failure-original-preserved.png"), fullPage: true });
});
