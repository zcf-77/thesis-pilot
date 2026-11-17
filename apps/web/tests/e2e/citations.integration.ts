import { expect, test, type Page } from "@playwright/test";

/**
 * SG-22 E 正式回归：文献引用候选（AC-019）、资料页“加入助手上下文”与评审 v2 定位链接。
 * 真实检索（OpenAlex/Crossref）只在 TP_WORKSPACE_TEST_LITERATURE_STAGE=real 时运行；
 * 真实模型评审定位另需 TP_WORKSPACE_TEST_MODEL_STAGE=real。默认运行不声称真实外部调用。
 */
const realLiterature = process.env.TP_WORKSPACE_TEST_LITERATURE_STAGE === "real";
const realModel = process.env.TP_WORKSPACE_TEST_MODEL_STAGE === "real";

const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { chapterId: "intro", level: 1 }, content: [{ type: "text", text: "第一章 绪论" }] },
    { type: "paragraph", content: [{ type: "text", text: "合成背景：协同过滤在校园二手交易中被广泛采用。" }] },
    { type: "paragraph", content: [{ type: "text", text: "合成方法：本研究对比基于图的推荐方法，样本量 42。" }] },
  ],
};

type Api = (method: string, path: string, data?: unknown) => Promise<{ status: number; body: any }>;

async function unlock(page: Page): Promise<Api> {
  await page.goto("/");
  await page.getByLabel("工作区访问口令").fill(process.env.TP_WORKSPACE_TEST_ACCESS_KEY!);
  await page.getByRole("button", { name: "解锁工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  return async (method, path, data) => {
    const response = await page.request.fetch(`${origin}/api/v1${path}`, { method, data, headers: { Origin: origin } });
    return { status: response.status(), body: await response.json() };
  };
}

async function v2Document(api: Api, projectId: string) {
  const created = await api("POST", `/projects/${projectId}/documents`, { content: { schema_version: 1, json: doc } });
  expect(created.status).toBe(201);
  const upgraded = await api("POST", `/projects/${projectId}/documents/${created.body.id}/schema-upgrade`, {
    command_id: crypto.randomUUID(),
    expected_version: 1,
  });
  expect(upgraded.status).toBe(201);
  return { legacy: created.body, document: upgraded.body.document };
}

const blocks = (document: any) => document.content.json.model.sections[0].blocks as any[];
const text = (block: any) => block.inlines.map((inline: any) => inline.text ?? "￼").join("");

test("引用候选的入口约束：旧版正文、缺失文献与陈旧版本都不写正文", async ({ page }) => {
  const api = await unlock(page);
  const project = (await api("POST", "/projects", { name: `合成引用约束 ${crypto.randomUUID().slice(0, 8)}` })).body;
  const created = await api("POST", `/projects/${project.id}/documents`, { content: { schema_version: 1, json: doc } });
  const base = `/projects/${project.id}/documents/${created.body.id}/citations`;
  expect((await api("GET", base)).body).toMatchObject({ schema_version: 1, items: [], references_heading: null });
  const legacy = await api("POST", `${base}/candidates`, {
    command_id: crypto.randomUUID(),
    base_version: 1,
    entry_id: crypto.randomUUID(),
    placement: { node_id: "intro", offset: 0 },
  });
  expect(legacy.body.error.code).toMatch(/^CITATION_(ENTRY_NOT_FOUND|SCHEMA_UNSUPPORTED)$/);
  const upgraded = await api("POST", `/projects/${project.id}/documents/${created.body.id}/schema-upgrade`, {
    command_id: crypto.randomUUID(),
    expected_version: 1,
  });
  const paragraph = blocks(upgraded.body.document)[1];
  const missing = await api("POST", `${base}/candidates`, {
    command_id: crypto.randomUUID(),
    base_version: 2,
    entry_id: crypto.randomUUID(),
    placement: { node_id: paragraph.id, offset: 0 },
  });
  expect(missing.body.error.code).toBe("CITATION_ENTRY_NOT_FOUND");
  const stale = await api("POST", `${base}/candidates`, {
    command_id: crypto.randomUUID(),
    base_version: 1,
    entry_id: crypto.randomUUID(),
    placement: { node_id: paragraph.id, offset: 0 },
  });
  expect(stale.body.error.code).toBe("CITATION_STALE");
  expect((await api("GET", `/projects/${project.id}/documents/current`)).body.version).toBe(2);
});

test("真实检索：OpenAlex 与 Crossref 保存文献，引用候选采纳、重新编号、撤销，资料页加入助手上下文", async ({ page }, testInfo) => {
  test.skip(!realLiterature, "真实外部检索需显式设置 TP_WORKSPACE_TEST_LITERATURE_STAGE=real");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await unlock(page);
  const project = (await api("POST", "/projects", { name: `合成引用实检 ${crypto.randomUUID().slice(0, 8)}` })).body;
  const root = `/projects/${project.id}`;

  async function searchAndSave(source: "openalex" | "crossref", query: string) {
    const receipt = await api("POST", `${root}/literature/searches`, { command_id: crypto.randomUUID(), query, source, rows: 5 });
    expect(receipt.status).toBe(202);
    await expect
      .poll(async () => (await api("GET", `${root}/literature/searches/${receipt.body.search.id}`)).body.status, { timeout: 90_000, intervals: [1000, 2000] })
      .toMatch(/^(succeeded|failed|cancelled)$/);
    const search = (await api("GET", `${root}/literature/searches/${receipt.body.search.id}`)).body;
    expect(search, `${source} 检索应成功`).toMatchObject({ status: "succeeded", error_code: null, source });
    expect(search.snapshot.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(search)).not.toContain("api_key");
    const index = Math.max(
      0,
      search.snapshot.items.findIndex((item: { doi: string | null }) => item.doi),
    );
    const saved = await api("POST", `${root}/literature/entries`, { command_id: crypto.randomUUID(), search_id: search.id, result_index: index });
    expect(saved.status).toBe(201);
    return saved.body;
  }
  const openalex = await searchAndSave("openalex", "collaborative filtering recommender system");
  const crossref = await searchAndSave("crossref", "graph neural network recommendation");
  expect(openalex.record.source).toBe("openalex");

  // 资料页：文献详情加入助手上下文。
  await page.goto(`/#/projects/${project.id}/materials`);
  await page.getByRole("tab", { name: /文献索引/ }).click();
  await page.getByRole("radio", { name: /项目文献/ }).click();
  await page.locator(".library-literature-row").first().click();
  const detail = page.getByRole("complementary", { name: "所选文献详情" });
  await detail.getByRole("button", { name: "加入助手上下文" }).click();
  await expect(detail.getByRole("button", { name: "已加入助手上下文" })).toHaveAttribute("aria-pressed", "true");
  await expect(detail.getByRole("link", { name: /去写作页使用（1 篇）/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("literature-assistant-context.png"), fullPage: true });

  // 引用候选：在第二段末尾引用 OpenAlex 文献。
  const { document } = await v2Document(api, project.id);
  const docs = `${root}/documents/${document.id}`;
  const second = blocks(document)[2];
  const first = blocks(document)[1];
  const one = await api("POST", `${docs}/citations/candidates`, {
    command_id: crypto.randomUUID(),
    base_version: document.version,
    entry_id: openalex.id,
    placement: { node_id: second.id, offset: Array.from(text(second)).length },
  });
  expect(one.status).toBe(201);
  expect(one.body.preview).toMatchObject({ number: 1, heading: { new: true }, reference: { new: true } });
  expect(one.body.preview.reference.text).toMatch(/^\[1\] .+\[(J|C|M|D|R|S|Z|DS)\]/);
  expect((await api("GET", `${docs.replace(`/${document.id}`, "")}/current`)).body.version).toBe(document.version);
  const applied = await api("POST", `${docs}/citations/candidates/${one.body.id}/apply`, {
    command_id: crypto.randomUUID(),
    expected_revision: one.body.revision,
    expected_document_version: document.version,
  });
  expect(applied.body).toMatchObject({ status: "applied", result_version: document.version + 1, undoable: true });

  // 更早的位置引用 Crossref 文献：编号重排为同一候选的一部分。
  const two = await api("POST", `${docs}/citations/candidates`, {
    command_id: crypto.randomUUID(),
    base_version: document.version + 1,
    entry_id: crossref.id,
    placement: { node_id: first.id, offset: 0 },
  });
  expect(two.body.preview.renumbered).toEqual([{ entry_id: openalex.id, before: 1, after: 2 }]);
  const command = crypto.randomUUID();
  const body = { command_id: command, expected_revision: two.body.revision, expected_document_version: document.version + 1 };
  const adopted = await api("POST", `${docs}/citations/candidates/${two.body.id}/apply`, body);
  const replay = await api("POST", `${docs}/citations/candidates/${two.body.id}/apply`, body);
  expect(replay.body.result_version).toBe(adopted.body.result_version);
  const current = (await api("GET", `${root}/documents/current`)).body;
  expect(current.version).toBe(document.version + 2);
  const body2 = blocks(current);
  expect(text(body2[1]).startsWith("[1]")).toBe(true);
  expect(text(body2[2]).endsWith("[2]")).toBe(true);
  expect(text(body2.at(-3))).toBe("参考文献");
  expect(text(body2.at(-2)).startsWith("[1] ")).toBe(true);
  expect(text(body2.at(-1)).startsWith("[2] ")).toBe(true);
  const listed = (await api("GET", `${docs}/citations`)).body;
  expect(listed).toMatchObject({ consistent: true, document_version: current.version });
  expect(listed.items.map((item: { entry_id: string; number: number }) => [item.entry_id, item.number])).toEqual([
    [crossref.id, 1],
    [openalex.id, 2],
  ]);
  await testInfo.attach("references.txt", { body: body2.slice(-2).map(text).join("\n"), contentType: "text/plain" });

  // 撤销第二次采纳：追加恢复版本；第一条已过期的命令不能再撤销。
  const undo = await api("POST", `${docs}/citations/candidates/${two.body.id}/undo`, {
    command_id: crypto.randomUUID(),
    expected_document_version: current.version,
  });
  expect(undo.body.status).toBe("undone");
  const restored = (await api("GET", `${root}/documents/current`)).body;
  expect(restored.version).toBe(current.version + 1);
  expect(text(blocks(restored)[1])).toBe(text(first));
  const stale = await api("POST", `${docs}/citations/candidates/${one.body.id}/undo`, {
    command_id: crypto.randomUUID(),
    expected_document_version: restored.version,
  });
  expect(stale.body.error.code).toBe("CITATION_UNDO_CONFLICT");
  const history = (await api("GET", `${docs}/versions?limit=5&offset=0`)).body.items.map((item: { source: string }) => item.source);
  expect(history.slice(0, 3)).toEqual(["adoption_undo", "ai_adoption", "ai_adoption"]);
});

test("真实模型评审：v2 报告问题带节点锚点，“定位到正文”深链到写作页", async ({ page }, testInfo) => {
  test.skip(!realModel, "需要明确选择真实模型验收阶段（TP_WORKSPACE_TEST_MODEL_STAGE=real）。");
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await unlock(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const project = (await api("POST", "/projects", { name: `合成评审定位 ${suffix}` })).body;
  const { document } = await v2Document(api, project.id);
  const provider = (await api("POST", "/ai-configs", { name: `合成评审接口 ${suffix}`, content: { kind: "api", timeout_seconds: 120, max_retries: 1 } })).body;
  const model = (
    await api("POST", "/ai-configs", {
      name: `合成评审模型 ${suffix}`,
      content: { kind: "model", api_version_id: provider.current_version_id, model_code: "deepseek-flash", capabilities: ["review"] },
    })
  ).body;
  const prompt = (
    await api("POST", "/ai-configs", { name: `合成评审提示词 ${suffix}`, content: { kind: "prompt", template: "请评审：{{context}}", variables: ["context"] } })
  ).body;
  const agent = (
    await api("POST", "/ai-configs", {
      name: `合成评审智能体 ${suffix}`,
      content: {
        kind: "agent",
        role: "review",
        instructions: "只评审，不改稿；问题请引用原文。",
        model_version_id: model.current_version_id,
        prompt_version_id: prompt.current_version_id,
      },
    })
  ).body;
  const receipt = await api("POST", `/projects/${project.id}/reviews`, {
    command_id: crypto.randomUUID(),
    document_id: document.id,
    document_version: document.version,
    chapter_id: null,
    rubric_version: "thesispilot-review-1",
    agent_config_version_id: agent.current_version_id,
  });
  expect(receipt.status).toBe(202);
  const reviewPath = `/projects/${project.id}/reviews/${receipt.body.review.id}`;
  await expect
    .poll(async () => (await api("GET", reviewPath)).body.status, { timeout: 300_000, intervals: [1000, 2000] })
    .toMatch(/^(succeeded|failed|cancelled)$/);
  expect((await api("GET", reviewPath)).body, "评审真实运行应成功").toMatchObject({ status: "succeeded" });
  const report = (await api("GET", `${reviewPath}/report`)).body;
  const ids = new Set(blocks(document).map((block) => block.id));
  const located = report.content.issues.filter((issue: any) => issue.location.status !== "unlocated");
  for (const issue of located) {
    expect(issue.location.node_id, "v2 定位须带节点").toBeTruthy();
    if (issue.location.status === "range") {
      const node = blocks(document).find((block) => block.id === issue.location.node_id);
      expect(Array.from(text(node)).slice(issue.location.start, issue.location.end).join("")).toBe(issue.location.quote);
    } else expect(ids.has(issue.location.node_id)).toBe(true);
  }
  await testInfo.attach("review-locations.json", {
    body: JSON.stringify(
      report.content.issues.map((issue: any) => issue.location),
      null,
      2,
    ),
    contentType: "application/json",
  });
  await page.goto(`/#/projects/${project.id}/review`);
  await expect(page.getByRole("heading", { name: "论文评审", exact: true })).toBeVisible();
  await expect(page.locator(".review-report")).toBeVisible({ timeout: 30_000 });
  if (located.length) {
    const link = page.getByRole("link", { name: "定位到正文" }).first();
    const href = (await link.getAttribute("href")) ?? "";
    expect(href).toContain(`/projects/${project.id}/write`);
    expect(decodeURIComponent(href)).toContain(`anchor=${located[0].location.node_id}`);
  }
  await page.screenshot({ path: testInfo.outputPath("review-v2-locate.png"), fullPage: true });
});
