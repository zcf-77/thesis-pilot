import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

/**
 * 真实模型正式回归：仅当 TP_WORKSPACE_TEST_MODEL_STAGE=real 且服务器进程已配置模型凭据时运行。
 * 凭据只在服务器进程环境中，浏览器与本用例都不接触密钥。输入均为自制合成文本。
 * 断言只校验结构与边界，不断言模型措辞。
 */
const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { chapterId: "intro", level: 1 }, content: [{ type: "text", text: "第一章 引言" }] },
    {
      type: "paragraph",
      content: [{ type: "text", text: "本研究以自制合成数据考察课堂反馈频率与学习投入的关系，样本量为 42 名学生，问卷回收率 95%。" }],
    },
    { type: "heading", attrs: { chapterId: "method", level: 1 }, content: [{ type: "text", text: "第二章 研究方法" }] },
    {
      type: "paragraph",
      content: [{ type: "text", text: "研究采用方法甲进行问卷调查，并对结果做了一些分析，分析的结果表明反馈频率是比较重要的因素。" }],
    },
    { type: "heading", attrs: { chapterId: "result", level: 1 }, content: [{ type: "text", text: "第三章 结果与讨论" }] },
    { type: "paragraph", content: [{ type: "text", text: "结果显示每周反馈三次的班级投入得分更高，但本节尚未讨论样本局限与因果推断边界。" }] },
  ],
};

async function choose(page: Page, scope: Locator, label: string, option: string | RegExp) {
  const control = scope.getByRole("combobox", { name: label, exact: true });
  await expect(control).toBeEnabled();
  await control.click();
  await page.getByRole("option", typeof option === "string" ? { name: option, exact: true } : { name: option }).click();
}

test("真实模型：四库试跑、内容助手受保护候选与整篇评审报告", async ({ page }, testInfo) => {
  test.skip(process.env.TP_WORKSPACE_TEST_MODEL_STAGE !== "real", "需要明确选择真实模型验收阶段（TP_WORKSPACE_TEST_MODEL_STAGE=real）。");
  test.setTimeout(600_000);
  const timings: Record<string, number> = {};
  const modelRequests: string[] = [];
  async function timed<T>(name: string, work: () => Promise<T>) {
    const started = Date.now();
    try {
      return await work();
    } finally {
      timings[name] = Date.now() - started;
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/projects");
  await page.getByLabel("工作区访问口令").fill(process.env.TP_WORKSPACE_TEST_ACCESS_KEY!);
  await page.getByRole("button", { name: "解锁工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
  const availability = await (await page.request.get("/api/v1/ai-configs/availability")).json();
  expect(availability, "真实模型阶段要求服务器已配置模型凭据").toMatchObject({ provider: "deepseek", credential_configured: true });

  const suffix = crypto.randomUUID().slice(0, 8);
  const origin = new URL(page.url()).origin;
  async function api(method: "GET" | "POST", path: string, data?: unknown) {
    const response = await page.request.fetch(`/api/v1${path}`, { method, data, headers: { Origin: origin } });
    expect(response.ok(), `${method} ${path} ${response.status()}`).toBe(true);
    return response.json();
  }
  const project = await api("POST", "/projects", { name: `合成真实模型验收 ${suffix}` });
  const original = await api("POST", `/projects/${project.id}/documents`, { content: { schema_version: 1, json: doc } });
  const root = `/projects/${project.id}`;

  // ① 配置台：API → 模型（普通/复杂）→ 提示词 → 智能体（内容/评审），全部经正式表单创建。
  await page.goto("/#/configurations");
  const form = page.getByRole("region", { name: "配置编辑", exact: true });
  const created: Record<string, { id: string; name: string; current_version_id: string }> = {};
  async function save(key: string, name: string) {
    await form.getByLabel("配置名称").fill(name);
    const response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/api/v1/ai-configs");
    await form.getByRole("button", { name: "创建配置", exact: true }).click();
    const received = await response;
    expect(received.status()).toBe(201);
    created[key] = await received.json();
    await expect(form).toHaveCount(0);
  }
  async function capabilities(values: string[]) {
    for (const label of ["文本", "检索", "格式", "规划", "评审"]) {
      const box = form.getByRole("checkbox", { name: label, exact: true });
      if (values.includes(label)) await box.check();
      else await box.uncheck();
    }
  }
  await page.getByRole("tab", { name: "AI 接口", exact: true }).click();
  await page.getByRole("button", { name: "新增AI 接口", exact: true }).click();
  await expect(form.getByLabel("服务器凭据")).toHaveValue("deepseek-default");
  await form.getByLabel("超时秒数").fill("120");
  await save("api", `DeepSeek 官方接口 ${suffix}`);
  await page.getByRole("tab", { name: "模型", exact: true }).click();
  await page.getByRole("button", { name: "新增模型", exact: true }).click();
  await choose(page, form, "接口版本", `${created.api!.name} · v1`);
  await choose(page, form, "模型型号", "deepseek-flash");
  await form.getByLabel("温度").fill("0.3");
  await capabilities(["文本"]);
  await save("flash", `deepseek-flash 普通 ${suffix}`);
  await page.getByRole("button", { name: "新增模型", exact: true }).click();
  await choose(page, form, "接口版本", `${created.api!.name} · v1`);
  await choose(page, form, "模型型号", "deepseek-v4-pro");
  await form.getByLabel("温度").fill("0.2");
  await form.getByLabel("最大输出 token").fill("6000");
  await capabilities(["文本", "评审"]);
  await save("pro", `deepseek-v4-pro 复杂 ${suffix}`);
  await page.getByRole("tab", { name: "提示词", exact: true }).click();
  await page.getByRole("button", { name: "新增提示词", exact: true }).click();
  await form.getByLabel("提示词模板").fill("请按修订目标处理固定选区。修订目标：{{goal}}\n固定输入：{{context}}");
  await form.getByRole("checkbox", { name: "context · 背景", exact: true }).check();
  await form.getByRole("checkbox", { name: "goal · 目标", exact: true }).check();
  await save("contentPrompt", `内容修订提示词 ${suffix}`);
  await page.getByRole("button", { name: "新增提示词", exact: true }).click();
  await form.getByLabel("提示词模板").fill("请依据量表评审下列固定正文块：{{context}}");
  await form.getByRole("checkbox", { name: "context · 背景", exact: true }).check();
  await form.getByRole("checkbox", { name: "goal · 目标", exact: true }).uncheck();
  await save("reviewPrompt", `整篇评审提示词 ${suffix}`);
  await page.getByRole("tab", { name: "智能体", exact: true }).click();
  await page.getByRole("button", { name: "新增智能体", exact: true }).click();
  await choose(page, form, "智能体角色", "内容助手");
  await choose(page, form, "模型版本", `${created.flash!.name} · v1`);
  await choose(page, form, "提示词版本", `${created.contentPrompt!.name} · v1`);
  await form.getByLabel("智能体职责").fill("润色学术表达，保留原有数字、单位与引用，不扩写未提供的事实。");
  await save("contentAgent", `内容助手 ${suffix}`);
  await page.getByRole("button", { name: "新增智能体", exact: true }).click();
  await choose(page, form, "智能体角色", "评审助手");
  await choose(page, form, "模型版本", `${created.pro!.name} · v1`);
  await choose(page, form, "提示词版本", `${created.reviewPrompt!.name} · v1`);
  await form.getByLabel("智能体职责").fill("按量表指出结构、论证与表达问题，给出参考分与未检查项。");
  await save("reviewAgent", `评审助手 ${suffix}`);

  // ② 四库真实试跑：接口连通、普通模型、内容与评审智能体。
  const probe = page.getByRole("region", { name: "配置试跑", exact: true });
  async function trial(tab: string, key: string, variables: Record<string, string> | undefined) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.getByRole("button", { name: created[key]!.name, exact: true }).click();
    await choose(page, probe, "试跑项目", project.name);
    if (variables) await probe.getByLabel("试跑变量 JSON").fill(JSON.stringify(variables));
    const submitted = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/api/v1/jobs");
    await probe.getByRole("button", { name: "发起配置试跑", exact: true }).click();
    const receipt = await submitted;
    expect(receipt.status()).toBe(202);
    const job = await receipt.json();
    modelRequests.push(`configuration_probe:${tab}:${key}`);
    await timed(`trial_${key}_ms`, () =>
      expect
        .poll(async () => (await api("GET", `/jobs/${job.id}?project_id=${project.id}`)).status, { timeout: 180_000, intervals: [1000, 2000] })
        .toMatch(/^(succeeded|failed)$/),
    );
    const finished = await api("GET", `/jobs/${job.id}?project_id=${project.id}`);
    expect(finished, `${key} 试跑应成功`).toMatchObject({ status: "succeeded", error_code: null });
    expect(finished.artifacts[0].result).toMatchObject({ writes_performed: false, config_version_id: created[key]!.current_version_id });
    await probe.getByRole("button", { name: "刷新试跑状态", exact: true }).click();
    await expect(probe.getByRole("region", { name: "试跑任务结果", exact: true })).toBeVisible();
    return finished.artifacts[0].result as { model_used: boolean; requested_model: string | null; response_model: string | null; content: string };
  }
  const apiTrial = await trial("AI 接口", "api", undefined);
  expect(apiTrial.model_used).toBe(false);
  expect(apiTrial.content.split("\n")).toEqual(expect.arrayContaining(["deepseek-flash", "deepseek-v4-pro"]));
  const flashTrial = await trial("模型", "flash", { context: "合成句子：课堂反馈有助于学习投入。", goal: "用一句话改写得更正式" });
  expect(flashTrial).toMatchObject({ model_used: true, requested_model: "deepseek-flash" });
  expect(flashTrial.content.trim().length).toBeGreaterThan(0);
  const contentTrial = await trial("智能体", "contentAgent", { context: "合成句子：分析的结果表明反馈频率是比较重要的因素。", goal: "改写得更学术" });
  expect(contentTrial).toMatchObject({ model_used: true, requested_model: "deepseek-flash" });
  const reviewTrial = await trial("智能体", "reviewAgent", { context: "合成段落：本研究样本量为 42 名学生，结论尚未讨论局限。" });
  expect(reviewTrial).toMatchObject({ model_used: true, requested_model: "deepseek-v4-pro" });
  await page.screenshot({ path: testInfo.outputPath("real-config-trials.png"), fullPage: true });

  // ③ 写作页内容助手：已保存正文同一段落选区 → 真实模型 → 服务器保护检查后的候选。
  // SG-22：此段依赖切片 C 的写作副驾内容助手面板；纸面选区请改用 tests/e2e/writing-helpers.ts 的 selectAtStart（标量偏移）。
  await page.goto(`/#/projects/${project.id}/write`);
  const editor = page.locator('[aria-label="论文正文编辑区"][contenteditable="true"]');
  await expect(editor).toBeVisible();
  const target = editor.locator("p", { hasText: "研究采用方法甲进行问卷调查" });
  // 选中同一段落的全部文字（DOM 选区由编辑器同步为正文选区），避免依赖分词相关的多击行为。
  async function selectParagraph() {
    await target.click();
    await target.evaluate((paragraph) => {
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? "")).toContain("研究采用方法甲进行问卷调查");
  }
  await selectParagraph();
  await page.getByRole("button", { name: "内容助手", exact: true }).click();
  const workspace = page.getByRole("region", { name: "内容助手工作区", exact: true });
  const title = `真实内容会话 ${suffix}`;
  await workspace.getByLabel("会话名称").fill(title);
  const createdSession = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v1${root}/assistant-sessions`,
  );
  await workspace.getByRole("button", { name: "创建内容助手会话", exact: true }).click();
  const sessionResponse = await createdSession;
  expect(sessionResponse.status()).toBe(201);
  const assistantSession = await sessionResponse.json();
  const pane = page.getByRole("region", { name: `内容助手会话：${title}`, exact: true });
  await pane.getByLabel("内容修订目标（本机草稿）").fill("把这一句改得更简洁、更符合学术表达，保留方法名称。");
  await selectParagraph();
  await pane.getByRole("button", { name: "使用当前已保存选区", exact: true }).click();
  await expect(pane.locator("blockquote")).toContainText("研究采用方法甲进行问卷调查");
  await pane.getByRole("button", { name: "选择配置与资料上下文", exact: true }).click();
  await choose(page, pane, "内容助手配置版本", `${created.contentAgent!.name} · v1`);
  await pane.getByRole("checkbox", { name: "我已确认本次固定上下文", exact: true }).check();
  const started = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v1${root}/assistant-sessions/${assistantSession.id}/runs`,
  );
  await pane.getByRole("button", { name: "发送选区修订", exact: true }).click();
  const startResponse = await started;
  expect(startResponse.status()).toBe(202);
  const receipt = await startResponse.json();
  modelRequests.push("content_revision");
  await timed("content_revision_ms", () =>
    expect
      .poll(async () => (await api("GET", `${root}/assistant-runs/${receipt.run.id}`)).status, { timeout: 180_000, intervals: [1000, 2000] })
      .toMatch(/^(succeeded|failed|cancelled)$/),
  );
  const run = await api("GET", `${root}/assistant-runs/${receipt.run.id}`);
  expect(run, "内容助手真实运行应成功").toMatchObject({ status: "succeeded", error_code: null, document_version: original.version });
  expect(run.candidate_id).toBeTruthy();
  const candidate = await api("GET", `${root}/documents/${original.id}/revisions/${run.candidate_id}`);
  expect(candidate).toMatchObject({ producer: "model_run", run_id: run.id, base_version: original.version });
  expect(["ready", "invalid"]).toContain(candidate.status);
  expect(candidate.patches).toHaveLength(1);
  expect(candidate.patches[0].before).toBe(candidate.selection.text);
  expect(candidate.selection.text).toContain("研究采用方法甲进行问卷调查");
  const rules = candidate.checks.map((check: { rule: string }) => check.rule);
  expect(rules).toEqual(expect.arrayContaining(["version", "range", "number", "citation", "lock"]));
  // 真实模型候选与确定性候选同一套保护检查：只有待审阅且检查全部通过时可采纳。
  expect(candidate.applicable).toBe(candidate.status === "ready" && candidate.checks.every((check: { result: string }) => check.result === "pass"));
  await pane.getByRole("button", { name: "刷新运行状态", exact: true }).click();
  const review = page.getByRole("region", { name: "助手建议审阅", exact: true });
  await expect(review).toBeVisible();
  await expect(review).toContainText(`基于正式稿 v${original.version}`);
  await page.screenshot({ path: testInfo.outputPath("real-assistant-candidate.png"), fullPage: true });
  const adopt = await page.request.post(`/api/v1${root}/documents/${original.id}/revisions/${candidate.id}/apply`, {
    headers: { Origin: origin },
    data: { command_id: crypto.randomUUID(), expected_revision: candidate.revision, expected_document_version: original.version },
  });
  // 学生尚未接受任何片段：服务器拒绝采纳，正文版本不变。
  expect(adopt.status()).toBeGreaterThanOrEqual(400);
  expect((await adopt.json()).error.code).toBe(candidate.applicable ? "REVISION_NOTHING_ACCEPTED" : expect.any(String));
  expect((await api("GET", `${root}/documents/current`)).version).toBe(original.version);

  // ④ 独立评审：整篇论文 + 复杂模型 → 报告字段、定位映射、下载；正文版本不变。
  await page.goto(`/#/projects/${project.id}/review`);
  await expect(page.getByRole("heading", { name: "论文评审", exact: true })).toBeVisible();
  const reviewForm = page.getByRole("form", { name: "新建评审" });
  if (!(await reviewForm.isVisible())) await page.getByRole("button", { name: "新建评审", exact: true }).click();
  await choose(page, reviewForm, "评审范围", "整篇论文");
  await choose(page, reviewForm, "评审智能体", new RegExp(`评审助手 ${suffix}`));
  const reviewCreated = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/v1${root}/reviews`);
  await reviewForm.getByRole("button", { name: "开始评审" }).click();
  const reviewReceipt = await (await reviewCreated).json();
  modelRequests.push("review");
  expect(reviewReceipt.review).toMatchObject({
    chapter_id: null,
    document_version: original.version,
    agent_config_version_id: created.reviewAgent!.current_version_id,
  });
  await timed("review_ms", () =>
    expect
      .poll(async () => (await api("GET", `${root}/reviews/${reviewReceipt.review.id}`)).status, { timeout: 300_000, intervals: [1000, 2000] })
      .toMatch(/^(succeeded|failed|cancelled)$/),
  );
  const finishedReview = await api("GET", `${root}/reviews/${reviewReceipt.review.id}`);
  expect(finishedReview, "评审真实运行应成功").toMatchObject({ status: "succeeded", error_code: null });
  expect(finishedReview.report_id).toBeTruthy();
  const report = await api("GET", `${root}/reviews/${reviewReceipt.review.id}/report`);
  expect(report).toMatchObject({ document_id: original.id, document_version: original.version, requested_model: "deepseek-v4-pro" });
  const content = report.content;
  expect(content.summary.trim().length).toBeGreaterThan(0);
  expect(content.scope).toMatchObject({ chapter_id: null });
  expect(content.scores.length).toBe(content.rubric.dimensions.length);
  for (const score of content.scores) {
    if (score.score !== null) {
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(score.full);
    }
  }
  expect(Array.isArray(content.issues)).toBe(true);
  expect(Array.isArray(content.unchecked)).toBe(true);
  const chapters = new Set(["intro", "method", "result"]);
  for (const issue of content.issues) {
    expect(["major", "minor", "advice"]).toContain(issue.severity);
    expect(["range", "block", "chapter", "unlocated"]).toContain(issue.location.status);
    if (issue.location.status !== "unlocated") expect(chapters.has(issue.location.chapter_id)).toBe(true);
    if (issue.location.status === "range") expect(issue.location.end).toBeGreaterThan(issue.location.start);
    expect(["cited", "missing"]).toContain(issue.basis_status);
  }
  // 量表维度是固定依据来源：列出问题时至少应有依据可追溯，不能全部“缺依据”。
  if (content.issues.length) expect(content.issues.some((issue: { basis_status: string }) => issue.basis_status === "cited")).toBe(true);
  const reportPanel = page.locator(".review-report");
  await expect(reportPanel).toBeVisible({ timeout: 30_000 });
  await expect(reportPanel).toContainText("参考评分 · 非教师成绩");
  const htmlDownload = page.waitForEvent("download");
  await reportPanel.getByRole("button", { name: "下载 HTML" }).click();
  const html = await htmlDownload;
  expect(html.suggestedFilename()).toMatch(/\.html$/);
  const markdownDownload = page.waitForEvent("download");
  await reportPanel.getByRole("button", { name: "下载 Markdown" }).click();
  const markdown = await markdownDownload;
  expect(markdown.suggestedFilename()).toMatch(/\.md$/);
  await page.screenshot({ path: testInfo.outputPath("real-review-report.png"), fullPage: true });
  const after = await api("GET", `${root}/documents/current`);
  expect(after).toEqual(original);

  const evidence = testInfo.outputPath("real-model-evidence.json");
  await writeFile(
    evidence,
    JSON.stringify(
      {
        model_requests: modelRequests.length,
        requests: modelRequests,
        timings_ms: timings,
        candidate: { status: candidate.status, checks: candidate.checks.map((c: { rule: string; result: string }) => `${c.rule}:${c.result}`) },
        review: {
          issues: content.issues.length,
          cited: content.issues.filter((i: { basis_status: string }) => i.basis_status === "cited").length,
          located: content.issues.filter((i: { location: { status: string } }) => i.location.status !== "unlocated").length,
          unchecked: content.unchecked.length,
          scores: content.scores.map((s: { score: number | null }) => s.score),
        },
      },
      null,
      2,
    ),
  );
  await testInfo.attach("real-model-evidence", { path: evidence, contentType: "application/json" });
  console.info(`真实模型调用 ${modelRequests.length} 次；耗时 ${JSON.stringify(timings)}`);
});
