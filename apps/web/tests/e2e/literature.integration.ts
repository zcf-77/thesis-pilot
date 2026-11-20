import { expect, test, type Page } from "@playwright/test";

// The real-source scenario reaches Crossref over the network; run it explicitly with
// TP_WORKSPACE_TEST_LITERATURE_STAGE=real so a default run never claims a live search.
const realStage = process.env.TP_WORKSPACE_TEST_LITERATURE_STAGE === "real";

async function unlock(page: Page) {
  await page.goto("/#/projects");
  await page.getByLabel("工作区访问口令").fill(process.env.TP_WORKSPACE_TEST_ACCESS_KEY!);
  await page.getByRole("button", { name: "解锁工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const api = async (method: string, path: string, data?: unknown) => {
    const response = await page.request.fetch(`${origin}/api/v1${path}`, { method, data, headers: { Origin: origin } });
    return { status: response.status(), body: await response.json() };
  };
  return { origin, api };
}

async function openLiterature(page: Page, projectId: string) {
  await page.goto(`/#/projects/${projectId}/materials`);
  await page.getByRole("tab", { name: /文献索引/ }).click();
  await expect(page.getByRole("searchbox", { name: "检索式" })).toBeVisible();
}

test("文献索引空态、条件校验与入口约束", async ({ page }) => {
  const { api } = await unlock(page);
  const project = (await api("POST", "/projects", { name: `合成文献回归 ${crypto.randomUUID().slice(0, 8)}` })).body;
  await openLiterature(page, project.id);
  await expect(page.getByRole("heading", { name: "从一次检索开始" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "选择一篇文献" })).toBeVisible();

  await page.getByRole("button", { name: "检索文献" }).click();
  await expect(page.getByRole("alert")).toContainText("请输入检索式");
  await page.getByRole("searchbox", { name: "检索式" }).fill("协同过滤");
  await page.getByLabel("起始年份").fill("2024");
  await page.getByLabel("结束年份").fill("2020");
  await page.getByRole("searchbox", { name: "检索式" }).press("Enter");
  await expect(page.getByRole("alert")).toContainText("起始年份不能晚于结束年份");
  expect((await api("GET", `/projects/${project.id}/literature/searches`)).body.total).toBe(0);

  await page.getByRole("radio", { name: /项目文献/ }).click();
  await expect(page.getByRole("heading", { name: "还没有保存的文献" })).toBeVisible();

  // Literature searches are created only through their own entry, never as generic jobs.
  const generic = await page.request.fetch(`${new URL(page.url()).origin}/api/v1/jobs`, {
    method: "POST",
    data: { project_id: project.id, kind: "literature_search" },
    headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": crypto.randomUUID() },
  });
  expect(generic.status()).toBe(422);
  const invalid = await api("POST", `/projects/${project.id}/literature/searches`, { command_id: crypto.randomUUID(), query: "x", rows: 50 });
  expect(invalid.status).toBe(422);
});

test("真实 Crossref 检索：取得范围如实标注，保存、DOI 回查、移出与恢复", async ({ page }, testInfo) => {
  test.skip(!realStage, "真实外部检索需显式设置 TP_WORKSPACE_TEST_LITERATURE_STAGE=real");
  test.setTimeout(120000);
  const { api } = await unlock(page);
  const project = (await api("POST", "/projects", { name: `合成文献实检 ${crypto.randomUUID().slice(0, 8)}` })).body;
  await openLiterature(page, project.id);
  await page.getByRole("searchbox", { name: "检索式" }).fill("协同过滤 推荐系统");
  await page.getByRole("button", { name: "检索文献" }).click();
  await expect(page.getByText("检索中").first()).toBeVisible();
  await expect(page.getByText("检索完成")).toBeVisible({ timeout: 60000 });
  const rows = page.locator(".library-literature-row");
  expect(await rows.count()).toBeGreaterThan(0);

  const search = (await api("GET", `/projects/${project.id}/literature/searches?limit=1&offset=0`)).body.items[0];
  expect(search).toMatchObject({ status: "succeeded", source: "crossref", query: "协同过滤 推荐系统" });
  expect(search.snapshot.response_sha256).toMatch(/^[0-9a-f]{64}$/);
  for (const item of search.snapshot.items) expect(item.coverage === "abstract").toBe(item.abstract !== null);
  const index = Math.max(
    0,
    search.snapshot.items.findIndex((item: { doi: string | null }) => item.doi),
  );

  await rows.nth(index).click();
  const detail = page.getByRole("complementary", { name: "所选文献详情" });
  await expect(detail.getByText(search.snapshot.items[index].title)).toBeVisible();
  await expect(detail.getByText(/全文未取得/)).toBeVisible();
  await detail.getByRole("button", { name: "保存到项目文献" }).click();
  await expect(detail.getByRole("button", { name: "移出项目文献" })).toBeVisible({ timeout: 30000 });
  const entries = (await api("GET", `/projects/${project.id}/literature/entries`)).body;
  expect(entries.total).toBe(1);
  expect(["verified", "conflict", "not_found", "unverified"]).toContain(entries.items[0].verification);
  expect(entries.items[0].record).toEqual(
    Object.fromEntries(Object.entries(search.snapshot.items[index]).filter(([key]) => key !== "index" && key !== "saved_entry_id")),
  );
  await page.screenshot({ path: testInfo.outputPath("literature-saved.png"), fullPage: true });

  const duplicate = await api("POST", `/projects/${project.id}/literature/entries`, {
    command_id: crypto.randomUUID(),
    search_id: search.id,
    result_index: index,
  });
  expect(duplicate.body.error.code).toBe("LITERATURE_ENTRY_DUPLICATE");

  await detail.getByRole("button", { name: "移出项目文献" }).click();
  await expect(detail.getByText("已移出项目文献")).toBeVisible();
  await detail.getByRole("button", { name: "恢复到项目文献" }).click();
  await expect(detail.getByRole("button", { name: "移出项目文献" })).toBeVisible();
  const versions = (await api("GET", `/projects/${project.id}/literature/entries/${entries.items[0].id}/versions`)).body;
  expect(versions.items.map((item: { action: string }) => item.action)).toEqual(["restored", "removed", "saved"]);

  // A cold reload restores the latest fixed search and the saved entry from the server.
  await page.reload();
  await page.getByRole("tab", { name: /文献索引/ }).click();
  await expect(page.getByText("检索完成")).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "检索式" })).toHaveValue("协同过滤 推荐系统");
  await rows.nth(index).click();
  await expect(detail.getByRole("button", { name: "查看项目文献" })).toBeVisible();
});
