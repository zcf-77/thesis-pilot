import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (value: string) => ({ type: "paragraph", content: [text(value)] });
const manuscript = (body: string) => ({
  schema_version: 1,
  json: {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1, chapterId: "e2e-intro" }, content: [text("合成论文")] },
      paragraph(body),
      { type: "paragraph", content: [{ type: "text", text: "［锁定对象 1］图片", marks: [{ type: "aiLock" }] }] },
    ],
  },
});

async function choose(page: Page, label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option }).first().click();
}

test("固定版本正文导出与真实修改说明可下载，重试沿用原输入", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.goto("/");
  await page.getByLabel("工作区访问口令").fill(process.env.TP_WORKSPACE_TEST_ACCESS_KEY!);
  await page.getByRole("button", { name: "解锁工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const api = async (method: string, path: string, data?: unknown) => {
    const response = await page.request.fetch(`${origin}/api/v1${path}`, { method, data, headers: { Origin: origin } });
    expect(response.ok(), `${method} ${path}`).toBeTruthy();
    return response.json();
  };
  const project = await api("POST", "/projects", { name: `合成导出回归 ${crypto.randomUUID().slice(0, 8)}` });
  const document = await api("POST", `/projects/${project.id}/documents`, { content: manuscript("初稿内容。") });
  await api("PATCH", `/projects/${project.id}/documents/${document.id}`, { content: manuscript("第二稿内容。"), expected_version: 1 });

  await page.goto(`/#/projects/${project.id}/export`);
  await expect(page.getByRole("link", { name: "导出", exact: true })).toHaveAttribute("aria-current", "page");
  const documentPanel = page.getByRole("region", { name: "论文正文" });
  await expect(documentPanel.getByRole("radio", { name: "Word" })).toHaveAttribute("aria-checked", "true");
  await expect(documentPanel.getByText("该版本没有导入的 Word 原件，将按正文重建并附损失报告。")).toBeVisible();
  await choose(page, "正文版本", "v1");
  await documentPanel.getByRole("radio", { name: "纯文本" }).click();
  await documentPanel.getByRole("button", { name: "导出正文" }).click();
  await expect(documentPanel.getByText("已完成")).toBeVisible({ timeout: 30000 });
  const [download] = await Promise.all([page.waitForEvent("download"), documentPanel.getByRole("button", { name: "下载文件" }).click()]);
  expect(download.suggestedFilename()).toBe("论文正文-v1.txt");
  const body = await readFile(await download.path());
  expect(body.toString("utf8")).toContain("初稿内容。");
  expect(body.toString("utf8")).toContain("［锁定对象 1］图片");
  expect(body.toString("utf8")).not.toContain("第二稿");

  const changePanel = page.getByRole("region", { name: "修改说明" });
  await choose(page, "起始版本", "v1");
  await changePanel.getByRole("button", { name: "生成修改说明" }).click();
  await expect(changePanel.getByText("已完成")).toBeVisible({ timeout: 30000 });
  const [record] = await Promise.all([page.waitForEvent("download"), changePanel.getByRole("button", { name: "下载文件" }).click()]);
  expect(record.suggestedFilename()).toBe("修改说明-v1-v2.md");
  const markdown = (await readFile(await record.path())).toString("utf8");
  expect(markdown).toContain("## v2 · 手动保存");
  expect(markdown).toContain("不代表导师已审阅或认可");

  const page1 = await api("GET", `/projects/${project.id}/exports?limit=20&offset=0`);
  const fixed = page1.items.find((item: { kind: string }) => item.kind === "document_export");
  const retried = await page.request.fetch(`${origin}/api/v1/projects/${project.id}/exports/${fixed.job_id}/retry`, {
    method: "POST",
    headers: { Origin: origin, "Idempotency-Key": crypto.randomUUID() },
  });
  expect(retried.status()).toBe(202);
  expect(await retried.json()).toMatchObject({ source_job_id: fixed.job_id, document_version: 1, format: "txt" });
  await page.reload();
  await expect(page.getByRole("region", { name: "导出记录" }).getByTestId("export-item")).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath("exports.png"), fullPage: true });
});
