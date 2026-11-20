import { expect, test, type Page } from "@playwright/test";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const sample = "合成开题报告正文，仅用于系统演示。";

async function api(page: Page, method: "GET" | "POST" | "PATCH", path: string, data?: unknown, status = method === "POST" ? 201 : 200) {
  const origin = new URL(page.url()).origin;
  const response = await page.request.fetch(`/api/v1${path}`, { method, data, headers: method === "GET" ? {} : { Origin: origin } });
  expect(response.status(), `${method} ${path}`).toBe(status);
  return response.json();
}

async function seed(page: Page, suffix: string) {
  const flow = await api(page, "POST", "/project-flows", {
    name: `合成今日流程 ${suffix}`,
    stages: [
      { id: "proposal", name: "开题", deliverables: ["开题报告", "文献综述"], conditions: ["学生核对研究范围"], start: day(-10), deadline: day(20) },
      { id: "writing", name: "写作", deliverables: ["论文初稿"], conditions: ["学生核对初稿"], dependencies: ["proposal"] },
      { id: "defense", name: "答辩", deliverables: ["答辩材料"], conditions: ["学生核对材料"], dependencies: ["writing"] },
    ],
  });
  const project = await api(page, "POST", "/projects", {
    name: `合成今日 ${suffix}`,
    title: "合成论文题目：方法甲的系统演示",
    flow_version_id: flow.current_version_id,
    stage_id: "proposal",
  });
  const root = `/projects/${project.id}`;
  const document = await api(page, "POST", `${root}/documents`, {
    content: { schema_version: 1, json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: sample }] }] } },
  });
  const evidence = [{ kind: "document", document_id: document.id, version: 1, selection: { textblock_path: [0], from: 1, to: 3, text: "合成" } }];
  const done = await api(page, "POST", `${root}/tasks`, {
    command_id: crypto.randomUUID(),
    expected_board_version: 0,
    content: { title: "完成开题报告", acceptance: "开题报告可复核", evidence },
  });
  await api(page, "POST", `${root}/tasks/${done.id}/decisions`, { command_id: crypto.randomUUID(), expected_version: 1, action: "confirm" }, 200);
  const open = await api(page, "POST", `${root}/tasks`, {
    command_id: crypto.randomUUID(),
    expected_board_version: 1,
    content: { title: "整理文献综述", acceptance: "列出核心文献", due_date: day(5) },
  });
  const batch = await api(page, "POST", `${root}/feedback`, { command_id: crypto.randomUUID(), expected_version: 0, original_text: "请补充实验数据。" });
  const item = await api(page, "POST", `${root}/feedback/${batch.id}/items`, {
    command_id: crypto.randomUUID(),
    expected_version: 0,
    content: { source_range: { from: 0, to: 4, text: "请补充实" }, interpretation: "补充实验", certainty: "certain", source_checked: true },
  });
  return { project, root, done, open, batch, item };
}

test("今日页：真实任务、待决定与阶段确认、冲突载入最新、撤销与历史", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/projects");
  await page.getByLabel("工作区访问口令").fill(process.env.TP_WORKSPACE_TEST_ACCESS_KEY!);
  await page.getByRole("button", { name: "解锁工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
  const { project, root, open, batch, item } = await seed(page, crypto.randomUUID().slice(0, 8));

  await page.goto(`/#/projects/${project.id}/today`);
  await expect(page.getByRole("heading", { name: "今日", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "今日", exact: true })).toHaveAttribute("aria-current", "page");
  const tasks = page.locator(".today-task");
  await expect(tasks).toHaveCount(1);
  await expect(tasks.first()).toContainText("整理文献综述");
  await expect(tasks.first()).toHaveAttribute("href", new RegExp(`task=${open.id}`));
  const feedbackLink = page.getByRole("link", { name: /导师反馈条目/ });
  await expect(feedbackLink).toContainText("1 条尚未处理");
  await expect(feedbackLink).toHaveAttribute("href", new RegExp(`batch=${batch.id}.*item=${item.id}`));
  await expect(page.locator(".today-hero")).toContainText(String(Array.from(sample).filter((c) => !/\s/.test(c)).length));
  await expect(page.locator(".today-hero")).toContainText("当前航程 / 开题");
  const card = page.locator(".today-stage");
  await expect(card.locator('[data-status="confirmed_task"]')).toContainText("开题报告");
  await expect(card.locator('[data-status="none"]')).toContainText("文献综述");
  await page.screenshot({ path: testInfo.outputPath("today-initial.png"), fullPage: true });

  const confirm = card.getByRole("button", { name: "我已核对，完成此阶段" });
  await expect(confirm).toBeDisabled();
  await card.getByLabel("本次完成依据").fill("已核对开题报告与线下开题记录");
  await expect(card.getByRole("checkbox", { name: /完成开题报告/ })).toBeChecked();
  await card.getByRole("checkbox", { name: "已核对本阶段及前置条件" }).check();
  const posted = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/v1${root}/stage-confirmations`);
  await confirm.click();
  const first = await (await posted).json();
  expect(first.project.stage_id).toBe("writing");
  expect(first.confirmation.evidence.map((e: { title: string }) => e.title)).toEqual(["完成开题报告"]);
  await expect(card.getByRole("status")).toContainText("进入写作");
  await expect(card.locator(".tp-seal")).toBeVisible();
  await expect(page.locator(".today-hero")).toContainText("当前航程 / 写作");
  await expect(card).toContainText("开题 · 已确认");

  // Another window renames the project; the stale command is refused and the note survives reload.
  const latest = await api(page, "GET", `${root}`);
  await api(page, "PATCH", `${root}`, { expected_version: latest.version, name: `${latest.name} 改名` });
  await card.getByLabel("本次完成依据").fill("已核对初稿 v1");
  await card.getByRole("checkbox", { name: "已核对本阶段及前置条件" }).check();
  await expect(card).toContainText("确认后进入：答辩");
  await card.getByRole("button", { name: "我已核对，完成此阶段" }).click();
  await expect(card.getByRole("alert")).toContainText("项目阶段已在其他窗口变化");
  await page.screenshot({ path: testInfo.outputPath("today-conflict.png"), fullPage: true });
  await card.getByRole("button", { name: "载入最新" }).click();
  await expect(card.getByRole("alert")).toHaveCount(0);
  await expect(card.getByLabel("本次完成依据")).toHaveValue("已核对初稿 v1");
  await card.getByRole("checkbox", { name: "已核对本阶段及前置条件" }).check();
  await card.getByRole("button", { name: "我已核对，完成此阶段" }).click();
  await expect(card.getByRole("status")).toContainText("进入答辩");
  expect((await api(page, "GET", root)).stage_id).toBe("defense");

  await card.getByRole("button", { name: "撤销“写作”的确认" }).click();
  await expect(card.getByRole("status")).toContainText("已撤销“写作”的确认，回到写作");
  expect((await api(page, "GET", root)).stage_id).toBe("writing");
  await page.reload();
  await expect(page.locator(".today-hero")).toContainText("当前航程 / 写作");
  const history = page.locator(".today-phase-history");
  await expect(history.locator("summary")).toContainText("（3）");
  await history.locator("summary").click();
  await expect(history.locator("article").first()).toContainText("撤销 写作 的确认");
  await expect(history.locator("article").nth(1)).toContainText("已撤销");
  await expect(history.locator("article").nth(2)).toContainText("完成开题报告 v2");
  await page.screenshot({ path: testInfo.outputPath("today-history.png"), fullPage: true });

  const blank = await api(page, "POST", "/projects", { name: `未绑定流程 ${crypto.randomUUID().slice(0, 8)}` });
  await page.goto(`/#/projects/${blank.id}/today`);
  await expect(page.getByText("尚未绑定毕设流程")).toBeVisible();
  await expect(page.getByRole("link", { name: "创建任务" })).toBeVisible();
  await expect(page.getByText("暂时没有待决定事项")).toBeVisible();
});
