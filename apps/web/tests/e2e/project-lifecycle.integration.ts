import { expect, test, type Locator, type Page } from "@playwright/test";
import { replaceManuscript } from "./writing-helpers.ts";

// Requires the same real, disposable same-origin service as workspace.integration.ts.
// No route interception, mock adapters or browser storage seeding is used.
const accessKey = process.env.TP_WORKSPACE_TEST_ACCESS_KEY!;
const editor = (page: Page) => page.locator('[aria-label="论文正文编辑区"][contenteditable="true"]');
const settings = (page: Page) => page.getByRole("region", { name: "项目设置", exact: true });
const setup = (page: Page) => page.getByRole("form", { name: "新建项目", exact: true });
const card = (page: Page, name: string) => page.getByRole("article", { name, exact: true });
const flowEditor = (page: Page) => page.getByRole("region", { name: "流程编辑", exact: true });

async function choose(page: Page, scope: Locator, label: string, option: string) {
  await scope.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function openSettings(page: Page, name: string) {
  await page.goto("/#/projects");
  await page.getByRole("button", { name: `编辑项目：${name}`, exact: true }).click();
  await expect(settings(page).getByRole("button", { name: "保存项目" })).toBeEnabled();
}

function projectResponse(page: Page, projectId: string) {
  return page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/v1/projects/${projectId}`);
}

test("桌面项目与流程闭环保留旧绑定、冲突输入及归档正文", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("工作区访问口令").fill(accessKey);
  await page.getByRole("button", { name: "解锁工作区" }).click();
  await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();

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

  // First-time setup: every step can go back, the project is created once and the blank manuscript is the last step.
  await page.goto("/#/projects");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const wizard = setup(page);
  await wizard.getByLabel("项目名称").fill(projectName);
  await wizard.getByLabel("论文题目").fill("合成论文：版本保护研究");
  await wizard.getByLabel("重要截止日期").fill("2027-06-01");
  await wizard.getByRole("button", { name: "下一步", exact: true }).click();
  await choose(page, wizard, "项目流程", flowName);
  await choose(page, wizard, "绑定流程版本", `${flowName} · v1`);
  await wizard.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(wizard.getByRole("alert")).toContainText("有效阶段");
  await choose(page, wizard, "当前阶段", "开题");
  await wizard.getByRole("button", { name: "下一步", exact: true }).click();
  await wizard.getByRole("radio", { name: "个人规划", exact: true }).click();
  await wizard.getByLabel("个人规划").fill("合成规划：先完成开题，再编写论文。");
  await wizard.getByText("登记已有进度与完成产物（可选）").click();
  await wizard.getByLabel("已有产物").fill("已有合成开题报告");
  await wizard.getByRole("button", { name: "上一步", exact: true }).click();
  await expect(wizard.getByRole("combobox", { name: "当前阶段", exact: true })).toHaveText("开题");
  await wizard.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(wizard.getByLabel("已有产物")).toHaveValue("已有合成开题报告");
  const creating = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/projects");
  await wizard.getByRole("button", { name: "创建项目并继续", exact: true }).click();
  const createdProject = await creating;
  expect(createdProject.status()).toBe(201);
  const projectId = ((await createdProject.json()) as { id: string }).id;
  await expect(wizard).toContainText("还没有模板或要求资料");
  // Going back after creation patches the same project instead of creating another one.
  await wizard.getByRole("button", { name: "上一步", exact: true }).click();
  await wizard.getByRole("button", { name: "保存并继续", exact: true }).click();
  await wizard.getByRole("button", { name: "下一步", exact: true }).click();
  const blank = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith(`/projects/${projectId}/documents/blank`));
  await wizard.getByRole("button", { name: "创建空白正文", exact: true }).click();
  expect((await blank).status()).toBe(201);
  await expect(page).toHaveURL(new RegExp(`#/projects/${projectId}/write$`));
  const writingUrl = page.url();
  const persisted = await page.request.get(`/api/v1/projects/${projectId}`);
  expect(await persisted.json()).toMatchObject({
    title: "合成论文：版本保护研究",
    deadline: "2027-06-01",
    planning_mode: "personal",
    plan_note: "合成规划：先完成开题，再编写论文。",
    existing_artifacts: "已有合成开题报告",
    flow_version_id: initialFlow.current_version_id,
    stage_id: initialFlow.stages[0]!.id,
    version: 1,
  });
  const directory = (await (await page.request.get("/api/v1/projects?limit=100")).json()) as { items: { name: string }[] };
  expect(directory.items.filter((item) => item.name === projectName)).toHaveLength(1);

  await replaceManuscript(page, "合成论文：样本 42；项目与流程设置不得改变这段正文。");
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
  await flow.getByText("查看流程历史", { exact: true }).click();
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
  const project = settings(page);
  await expect(project.getByRole("combobox", { name: "绑定流程版本", exact: true })).toHaveText(`${flowName} · v1`);
  const current = (await (await page.request.get(`/api/v1/projects/${projectId}`)).json()) as { version: number };
  const competing = await page.request.patch(`/api/v1/projects/${projectId}`, {
    headers: { Origin: new URL(page.url()).origin },
    data: { expected_version: current.version, title: "另一会话已保存的合成题目" },
  });
  expect(competing.status()).toBe(200);
  await project.getByLabel("论文题目").fill("当前窗口未保存的合成题目");
  const conflict = projectResponse(page, projectId);
  await project.getByRole("button", { name: "保存项目" }).click();
  expect((await conflict).status()).toBe(409);
  await expect(project.getByRole("alert")).toContainText("输入已保留");
  await expect(project.getByLabel("论文题目")).toHaveValue("当前窗口未保存的合成题目");
  await project.getByRole("button", { name: "载入最新项目" }).click();
  await expect(project.getByLabel("论文题目")).toHaveValue("另一会话已保存的合成题目");
  await project.getByRole("button", { name: "取消", exact: true }).click();
  // Archive and restore are direct, reversible card actions; the archived view is filtered from the full directory.
  const archiving = projectResponse(page, projectId);
  await page.getByRole("button", { name: `归档项目：${projectName}`, exact: true }).click();
  expect((await archiving).status()).toBe(200);
  await expect(card(page, projectName)).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: `已归档“${projectName}”` })).toBeVisible();
  await page.getByRole("radio", { name: "归档项目", exact: true }).click();
  await expect(card(page, projectName)).toContainText("已归档");
  const restoring = projectResponse(page, projectId);
  await page.getByRole("button", { name: `恢复项目：${projectName}`, exact: true }).click();
  expect((await restoring).status()).toBe(200);
  await page.getByRole("radio", { name: "进行中的项目", exact: true }).click();
  await expect(card(page, projectName)).toContainText(flowName);
  await expect(card(page, projectName)).toContainText("开题");
  await page.reload();
  await page.getByRole("button", { name: `编辑项目：${projectName}`, exact: true }).click();
  await expect(project.getByLabel("重要截止日期")).toHaveValue("2027-06-01");
  await expect(project.getByRole("combobox", { name: "规划方式", exact: true })).toHaveText("个人规划");
  await expect(project.getByRole("combobox", { name: "绑定流程版本", exact: true })).toHaveText(`${flowName} · v1`);
  await page.goto(writingUrl);
  await expect(editor(page)).toContainText("合成论文：样本 42；项目与流程设置不得改变这段正文。");
  const body = await page.request.get(`/api/v1/projects/${projectId}/documents/current`);
  // 向导创建的空白稿（v1）进入写作页即升级为新版结构（v2），保存后为 v3。
  expect((await body.json()).version).toBe(3);
  await page.screenshot({ path: testInfo.outputPath("lifecycle-restored-writing.png"), animations: "disabled" });
});
