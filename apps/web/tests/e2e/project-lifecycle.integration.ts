import { expect, test, type Locator, type Page } from "@playwright/test";

// Requires the same real, disposable same-origin service as workspace.integration.ts.
// No route interception, mock adapters or browser storage seeding is used.
const accessKey = process.env.TP_WORKSPACE_TEST_ACCESS_KEY!;
const editor = (page: Page) => page.locator('[aria-label="论文正文编辑区"][contenteditable="true"]');
const settings = (page: Page) => page.getByRole("region", { name: "项目设置", exact: true });
const flowEditor = (page: Page) => page.getByRole("region", { name: "流程编辑", exact: true });

async function choose(page: Page, scope: Locator, label: string, option: string) {
  await scope.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function openSettings(page: Page, name: string) {
  await page.goto("/#/projects");
  await page.getByRole("button", { name: `项目设置：${name}`, exact: true }).click();
  await expect(settings(page).getByRole("button", { name: "保存项目设置" })).toBeEnabled();
}

function projectResponse(page: Page, projectId: string) {
  return page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/v1/projects/${projectId}`);
}

test("桌面项目与流程闭环保留旧绑定、冲突输入及归档正文", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("工作区访问口令").fill(accessKey);
  await page.getByRole("button", { name: "解锁工作区" }).click();
  await expect(page.getByRole("heading", { name: "论文项目" })).toBeVisible();

  const suffix = crypto.randomUUID();
  const flowName = `合成比赛流程 ${suffix}`;
  const projectName = `合成生命周期 ${suffix}`;
  await page.goto("/#/flows");
  await page.getByRole("button", { name: "新建流程", exact: true }).first().click();
  const flow = flowEditor(page);
  await flow.getByLabel("流程名称").fill(flowName);
  const first = flow.getByRole("article", { name: "阶段 1", exact: true });
  await first.getByLabel("阶段名称").fill("开题");
  await first.getByLabel("交付物").fill("合成开题报告");
  await first.getByLabel("阶段条件").fill("学生核对要求");
  await flow.getByRole("button", { name: "添加阶段", exact: true }).click();
  const second = flow.getByRole("article", { name: "阶段 2", exact: true });
  await second.getByLabel("阶段名称").fill("写作");
  await second.getByLabel("交付物").fill("合成论文草稿");
  await second.getByLabel("阶段条件").fill("学生核对内容");
  await second.getByRole("checkbox", { name: "开题", exact: true }).check();
  const creatingFlow = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/project-flows",
  );
  await flow.getByRole("button", { name: "创建流程", exact: true }).click();
  const createdFlow = await creatingFlow;
  expect(createdFlow.status()).toBe(201);
  const initialFlow = (await createdFlow.json()) as { id: string; current_version_id: string; stages: { id: string }[] };
  await expect(flow.getByRole("status")).toContainText("不可变版本 v1");

  await page.goto("/#/projects");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill(projectName);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page).toHaveURL(/#\/projects\/[a-f0-9-]+\/write$/);
  const writingUrl = page.url();
  const projectId = writingUrl.match(/\/projects\/([a-f0-9-]+)\/write$/)![1]!;
  await openSettings(page, projectName);
  const project = settings(page);
  await project.getByLabel("论文题目").fill("合成论文：版本保护研究");
  await project.getByLabel("项目截止日期").fill("2027-06-01");
  await choose(page, project, "规划方式", "个人规划");
  await project.getByLabel("规划说明").fill("合成规划：先完成开题，再编写论文。");
  await project.getByLabel("已有产物").fill("已有合成开题报告");
  await choose(page, project, "项目流程", flowName);
  await choose(page, project, "绑定流程版本", `${flowName} · v1`);
  await choose(page, project, "当前阶段", "开题");
  const metadataSaved = projectResponse(page, projectId);
  await project.getByRole("button", { name: "保存项目设置" }).click();
  expect((await metadataSaved).status()).toBe(200);
  const persisted = await page.request.get(`/api/v1/projects/${projectId}`);
  expect(await persisted.json()).toMatchObject({
    title: "合成论文：版本保护研究",
    deadline: "2027-06-01",
    planning_mode: "personal",
    flow_version_id: initialFlow.current_version_id,
    stage_id: initialFlow.stages[0]!.id,
  });

  await page.goto(writingUrl);
  await page.getByRole("button", { name: "创建空白正式稿" }).click();
  await editor(page).fill("合成论文：样本 42；项目与流程设置不得改变这段正文。");
  const bodySaved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes(`/projects/${projectId}/documents/`));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect((await bodySaved).status()).toBe(200);

  await page.goto("/#/flows");
  await page.getByRole("listitem").filter({ hasText: flowName }).getByRole("button", { name: "管理流程" }).click();
  await second.getByLabel("阶段名称").fill("新版写作");
  // A real UI cycle is rejected before any version is appended.
  await first.getByRole("checkbox", { name: "新版写作", exact: true }).check();
  await flow.getByRole("button", { name: "保存新版本" }).click();
  await expect(flow.getByRole("alert")).toContainText("循环");
  expect((await (await page.request.get(`/api/v1/project-flows/${initialFlow.id}`)).json()).version).toBe(1);
  await first.getByRole("checkbox", { name: "新版写作", exact: true }).uncheck();
  const versionSaved = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/v1/project-flows/${initialFlow.id}`,
  );
  await flow.getByRole("button", { name: "保存新版本" }).click();
  expect((await versionSaved).status()).toBe(200);
  await expect(flow.getByRole("status")).toContainText("不可变版本 v2");
  await flow.getByRole("button", { name: "查看历史版本" }).click();
  await choose(page, flow, "历史版本（只读）", `v1 · ${flowName}`);
  const history = flow.getByRole("region", { name: "历史版本（只读）" });
  await expect(history).toContainText("写作 · 启用");
  await expect(history).not.toContainText("新版写作");
  const disabling = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/v1/project-flows/${initialFlow.id}`,
  );
  await flow.getByRole("button", { name: "停用流程" }).click();
  expect((await disabling).status()).toBe(200);
  const rejected = await page.request.post("/api/v1/projects", {
    headers: { Origin: new URL(page.url()).origin },
    data: { name: `不得创建 ${suffix}`, flow_version_id: initialFlow.current_version_id, stage_id: initialFlow.stages[0]!.id },
  });
  expect(rejected.status()).toBe(409);

  await openSettings(page, projectName);
  await expect(project.getByRole("combobox", { name: "绑定流程版本", exact: true })).toHaveText(`${flowName} · v1`);
  const current = (await (await page.request.get(`/api/v1/projects/${projectId}`)).json()) as { version: number };
  const competing = await page.request.patch(`/api/v1/projects/${projectId}`, {
    headers: { Origin: new URL(page.url()).origin },
    data: { expected_version: current.version, title: "另一会话已保存的合成题目" },
  });
  expect(competing.status()).toBe(200);
  await project.getByLabel("论文题目").fill("当前窗口未保存的合成题目");
  const conflict = projectResponse(page, projectId);
  await project.getByRole("button", { name: "保存项目设置" }).click();
  expect((await conflict).status()).toBe(409);
  await expect(project.getByRole("alert")).toContainText("输入已保留");
  await expect(project.getByLabel("论文题目")).toHaveValue("当前窗口未保存的合成题目");
  await project.getByRole("button", { name: "载入最新项目" }).click();
  await expect(project.getByLabel("论文题目")).toHaveValue("另一会话已保存的合成题目");
  await expect(project.getByRole("button", { name: "归档项目" })).toBeEnabled();
  const archiving = projectResponse(page, projectId);
  await project.getByRole("button", { name: "归档项目" }).click();
  expect((await archiving).status()).toBe(200);
  await expect(project.getByRole("button", { name: "恢复项目" })).toBeVisible();
  const restoring = projectResponse(page, projectId);
  await project.getByRole("button", { name: "恢复项目" }).click();
  expect((await restoring).status()).toBe(200);
  await page.reload();
  await page.getByRole("button", { name: `项目设置：${projectName}`, exact: true }).click();
  await expect(project.getByLabel("项目截止日期")).toHaveValue("2027-06-01");
  await expect(project.getByRole("combobox", { name: "规划方式", exact: true })).toHaveText("个人规划");
  await expect(project.getByRole("combobox", { name: "绑定流程版本", exact: true })).toHaveText(`${flowName} · v1`);
  await page.goto(writingUrl);
  await expect(editor(page)).toHaveText("合成论文：样本 42；项目与流程设置不得改变这段正文。");
  const body = await page.request.get(`/api/v1/projects/${projectId}/documents/current`);
  expect((await body.json()).version).toBe(2);
  await page.screenshot({ path: testInfo.outputPath("lifecycle-restored-writing.png"), animations: "disabled" });
});
