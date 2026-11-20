import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const text = (value: string) => ({ type: "text", text: value });
const manuscript = (body: string) => ({
  schema_version: 1,
  json: {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1, chapterId: "e2e-intro" }, content: [text("合成论文")] },
      { type: "paragraph", content: [text(body)] },
    ],
  },
});

async function choose(page: Page, buffer: Buffer, name: string) {
  const restore = page.getByRole("region", { name: "从备份恢复为新项目" });
  await restore.getByLabel("备份文件").setInputFiles({ name, mimeType: "application/zip", buffer });
  await restore.getByRole("button", { name: "恢复为新项目" }).click();
  return restore;
}

test("完整项目备份可下载，损坏与篡改被拒绝，恢复为新项目后原项目不变", async ({ page }, testInfo) => {
  test.setTimeout(150000);
  await page.goto("/#/projects");
  await page.getByLabel("工作区访问口令").fill(process.env.TP_WORKSPACE_TEST_ACCESS_KEY!);
  await page.getByRole("button", { name: "解锁工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const api = async (method: string, path: string, data?: unknown) => {
    const response = await page.request.fetch(`${origin}/api/v1${path}`, { method, data, headers: { Origin: origin } });
    expect(response.ok(), `${method} ${path}`).toBeTruthy();
    return response.json();
  };
  const name = `合成备份回归 ${crypto.randomUUID().slice(0, 8)}`;
  const project = await api("POST", "/projects", { name });
  const root = `/projects/${project.id}`;
  const document = await api("POST", `${root}/documents`, { content: manuscript("初稿内容。") });
  await api("PATCH", `${root}/documents/${document.id}`, { content: manuscript("第二稿内容。"), expected_version: 1 });
  const board = (await api("GET", `${root}/tasks`)).board_version;
  await api("POST", `${root}/tasks`, {
    command_id: crypto.randomUUID(),
    expected_board_version: board,
    content: { title: "核对合成章节", acceptance: "章节可复核" },
  });
  await api("POST", `${root}/feedback`, { command_id: crypto.randomUUID(), original_text: "请补充合成实验的依据。" });
  const projectsBefore = (await api("GET", "/projects?limit=100&offset=0")).total;

  await page.goto(`/#/projects/${project.id}/export`);
  const keep = page.getByRole("region", { name: "完整项目备份" });
  await keep.getByRole("button", { name: "生成项目备份" }).click();
  const item = keep.getByTestId("backup-item").first();
  await expect(item.getByText("已完成")).toBeVisible({ timeout: 30000 });
  await expect(item).toContainText("个对象");
  const [download] = await Promise.all([page.waitForEvent("download"), item.getByRole("button", { name: "下载备份" }).click()]);
  expect(download.suggestedFilename()).toMatch(/-备份-\d{8}-\d{6}\.zip$/);
  const zip = await readFile(await download.path());
  expect(zip.subarray(0, 2).toString("latin1")).toBe("PK");
  await page.screenshot({ path: testInfo.outputPath("backup-ready.png"), fullPage: true });

  // A file that is not a package is rejected before anything is stored.
  let restore = await choose(page, Buffer.from("这不是备份"), "not-a-backup.zip");
  await expect(restore.getByRole("alert")).toContainText("不是有效的项目备份");
  // A package whose bytes were altered fails the digest check.
  const tampered = Buffer.from(zip);
  tampered[Math.floor(tampered.length / 2)] ^= 0xff;
  restore = await choose(page, tampered, "tampered.zip");
  await expect(restore.getByRole("alert")).toContainText(/损坏|有效的项目备份/);
  expect((await api("GET", "/projects?limit=100&offset=0")).total).toBe(projectsBefore);
  await page.screenshot({ path: testInfo.outputPath("backup-rejected.png"), fullPage: true });

  // The intact package becomes a new project copy and the page moves to it.
  await choose(page, zip, download.suggestedFilename());
  await expect(page).not.toHaveURL(new RegExp(`/projects/${project.id}/`), { timeout: 60000 });
  const match = /\/projects\/([0-9a-f-]{36})\//.exec(page.url());
  expect(match).not.toBeNull();
  const copyId = match![1]!;
  const copy = await api("GET", `/projects/${copyId}`);
  expect(copy.name).toBe(`${name}（恢复副本）`);
  expect((await api("GET", root)).name).toBe(name);
  const copied = await api("GET", `/projects/${copyId}/documents/current`);
  expect(copied.id).not.toBe(document.id);
  expect(copied.version).toBe(2);
  expect(JSON.stringify(copied.content)).toContain("第二稿内容。");
  const versions = await api("GET", `/projects/${copyId}/documents/${copied.id}/versions?limit=10&offset=0`);
  expect(versions.items.map((row: { source: string }) => row.source).sort()).toEqual(["local_import", "manual_edit"]);
  expect((await api("GET", `/projects/${copyId}/tasks`)).items).toHaveLength(1);
  // The copy keeps working: a CAS save appends version 3.
  const saved = await api("PATCH", `/projects/${copyId}/documents/${copied.id}`, { content: manuscript("恢复后继续写作。"), expected_version: 2 });
  expect(saved.version).toBe(3);
  await page.goto(`/#/projects/${copyId}/export`);
  await expect(page.getByRole("region", { name: "完整项目备份" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("backup-copy.png"), fullPage: true });
});
