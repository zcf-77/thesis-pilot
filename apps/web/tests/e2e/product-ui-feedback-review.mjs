import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const host = "127.0.0.1";
const port = 5187;
const origin = `http://${host}:${port}`;
const output = resolve("test-results/product-ui-feedback-review");
const virtualId = "/@virtual/product-ui-feedback-review";
const resolvedVirtual = "\0product-ui-feedback-review";

// 仅用于隔离视觉/交互回归：真实反馈走同契约 Mock；成功评审使用固定报告夹具，不计真实模型验收。
const fixtureModule = String.raw`
import { createApp, defineComponent, h } from "vue";
import { createPinia, storeToRefs } from "pinia";
import { formalRouter } from "/src/workspace/formalRouter.ts";
import WorkspaceFeedback from "/src/workspace/WorkspaceFeedback.vue";
import WorkspaceReview from "/src/workspace/review/WorkspaceReview.vue";
import { createServices } from "/src/services/index.ts";
import { documentTextblocks } from "/src/workspace/tasks/taskFeedbackDraft.ts";
import { provideThemeScope } from "/src/design/theme.ts";
import { useAppearanceStore } from "/src/stores/appearance.ts";
import "/src/design/styles/index.css";
import "/src/lab/lab.css";

const services = createServices({ mode: "mock", instanceId: "product-ui-visual" });
const project = await services.projects.create({ name: "合成反馈评审视觉回归" });
const json = { type: "doc", content: [
  { type: "heading", attrs: { chapterId: "method", level: 1 }, content: [{ type: "text", text: "第二章 研究方法" }] },
  { type: "paragraph", content: [{ type: "text", text: "本研究采用自制样例核对样本选择依据，并保留修改前后的具体版本。" }] },
] };
const document = await services.documents.import(project.id, { content: { schema_version: 1, json } });
const block = documentTextblocks(document.content.json).find((item) => item.text.includes("本研究"));
const task = await services.tasks.create(project.id, {
  command_id: crypto.randomUUID(),
  expected_board_version: 0,
  content: { title: "补充样本选择依据", acceptance: "方法章节说明样本来源、数量和选择理由。" },
});
const original = [
  "第二章研究方法写得太笼统，请补充样本选择的依据和样本数量。",
  "图3-2 的坐标轴没有标注单位。",
  "结论部分有点空，再想想。这里是一段用于检查窄屏换行的长反馈：请区分结果、讨论与局限，不要只重复前文，也不要在缺少依据时补写新的实验结论。",
].join("\n\n");
const batch = await services.feedback.create(project.id, { command_id: crypto.randomUUID(), expected_version: 0, original_text: original });
const item = await services.feedback.createItem(project.id, batch.id, {
  command_id: crypto.randomUUID(),
  expected_version: 0,
  content: {
    source_range: { from: 0, to: original.indexOf("\n"), text: original.slice(0, original.indexOf("\n")) },
    interpretation: "在第二章补充样本来源、数量与选择理由，并关联已保存的方法段落作为处理证据。",
    certainty: "certain",
    correction: "导师指的是样本选择依据，不要求增加新的实验。",
    source_checked: true,
    task_id: task.id,
    new_task: null,
    evidence: [{ kind: "document", document_id: document.id, version: document.version, selection: { textblock_path: block.path, from: block.position, to: block.position + block.text.length, text: block.text } }],
  },
});
async function agent(name, role, capability) {
  const provider = await services.aiConfigs.create({ name: name + "接口", content: { kind: "api", max_retries: 1 } });
  const model = await services.aiConfigs.create({ name: name + "模型", content: { kind: "model", api_version_id: provider.current_version_id, model_code: "deepseek-flash", capabilities: [capability] } });
  const prompt = await services.aiConfigs.create({ name: name + "提示词", content: { kind: "prompt", template: "{{context}}", variables: ["context"] } });
  return services.aiConfigs.create({ name, content: { kind: "agent", role, instructions: "只处理固定输入", model_version_id: model.current_version_id, prompt_version_id: prompt.current_version_id } });
}
const contentAgent = await agent("内容助手", "content", "text");
const reviewAgent = await agent("评审助手", "review", "review");
const now = new Date().toISOString();
const split = {
  id: crypto.randomUUID(), project_id: project.id, batch_id: batch.id, job_id: crypto.randomUUID(), status: "succeeded", error_code: null,
  attempt: 1, agent_config_version_id: contentAgent.current_version_id, agent_name: "内容助手 · v1", config_version_ids: {}, source_split_id: null,
  requested_model: "deepseek-flash", response_model: "deepseek-flash", note: "", created_at: now, updated_at: now,
  suggestions: [
    {
      id: crypto.randomUUID(), position: 0, source_range: item.content.source_range, interpretation: "补充样本来源、数量与选择依据。",
      certainty: "certain", ambiguous: false, task_title: "补充样本选择依据", state: "adopted", version: 1, feedback_item_id: item.id,
      stale: false, stale_reasons: [], history: [{ action: "adopt", created_at: now, feedback_item_id: item.id, reason: "", version: 1 }],
    },
    {
      id: crypto.randomUUID(), position: 1, source_range: { from: original.indexOf("结论部分"), to: original.indexOf("结论部分") + 8, text: "结论部分有点空" },
      interpretation: "需要明确是补充讨论、局限还是新的结果分析。", certainty: "uncertain", ambiguous: true, task_title: null,
      state: "pending", version: 0, feedback_item_id: null, stale: false, stale_reasons: [], history: [],
    },
  ],
};
services.feedbackSplits.list = async () => ({ items: [split], total: 1, offset: 0, limit: 1 });
services.feedbackSplits.get = async () => split;

const rubric = {
  title: "论文质量参考量表", version: "rubric-v1", description: "依据固定正文与已绑定资料进行参考评审。",
  dimensions: [
    { id: "argument", name: "论证", full: 30, description: "论点、证据和推理是否相互支持。" },
    { id: "structure", name: "结构", full: 20, description: "章节组织与论述顺序是否清楚。" },
  ],
  limitations: ["不代替导师评审，不检查未提供的实验原始数据。"],
};
const review = {
  id: crypto.randomUUID(), project_id: project.id, document_id: document.id, document_version: document.version, chapter_id: null,
  job_id: crypto.randomUUID(), report_id: crypto.randomUUID(), scope_title: "整篇论文", status: "succeeded", error_code: null,
  attempt: 1, source_review_id: null, agent_config_version_id: reviewAgent.current_version_id, agent_name: "评审助手 · v1",
  config_version_ids: {}, rubric_version: rubric.version, source_binding_version_id: null, template_parse_version_id: null,
  requirement_parse_version_ids: [], created_at: now, updated_at: now,
};
const report = {
  id: review.report_id, review_id: review.id, project_id: project.id, document_id: document.id, document_version: document.version,
  job_id: review.job_id, requested_model: "deepseek-v4-pro", response_model: "deepseek-v4-pro", created_at: now,
  content: {
    schema_version: 1, scope: { chapter_id: null, title: "整篇论文" }, rubric,
    summary: "方法段落已有可核对的样本说明，但结论与证据之间的关系仍需进一步明确。以下意见只作为学生后续修改的参考。",
    scores: [
      { dimension_id: "argument", name: "论证", full: 30, score: 22, reason: "已有方法依据，结论衔接仍需加强。" },
      { dimension_id: "structure", name: "结构", full: 20, score: null, reason: "未绑定模板，完整结构不能判定。" },
    ],
    issues: [{
      id: crypto.randomUUID(), severity: "major", title: "结论尚未回应样本选择对结果的影响",
      explanation: "方法段落描述了样本选择，但结论没有说明这一选择对适用范围的影响。",
      direction: "在不新增实验事实的前提下，补充结果适用范围与局限。",
      basis: [{ label: "论证量表：论点、证据与推理相互支持" }], basis_status: "cited",
      location: { status: "block", chapter_id: "method", chapter_title: "第二章 研究方法", block_index: 0, quote: "本研究采用自制样例", start: null, end: null, node_id: null },
    }, {
      id: crypto.randomUUID(), severity: "advice", title: "格式一致性尚未检查",
      explanation: "当前项目没有绑定模板，无法核对标题与图表格式。",
      direction: "先绑定学校模板，再另行发起格式检查。",
      basis: [], basis_status: "missing",
      location: { status: "unlocated", chapter_id: null, chapter_title: null, block_index: null, quote: null, start: null, end: null, node_id: null },
    }],
    unchecked: [{ item: "参考文献全文", reason: "未取得全文，不评价原文观点。", origin: "system" }],
    limitations: rubric.limitations,
  },
};
const scenario = new URLSearchParams(location.search).get("scenario") || "ready";
const visibleReviews = scenario === "empty" ? [] : [{ ...review, ...(scenario === "failed" ? { status: "failed", report_id: null, error_code: "MODEL_NOT_CONFIGURED" } : {}) }];
services.reviews.list = async () => ({ items: visibleReviews, total: visibleReviews.length, offset: 0, limit: 100 });
services.reviews.get = async () => visibleReviews[0];
services.reviews.report = async () => report;
services.reviews.rubrics = async () => ({ items: [rubric] });
services.reviews.download = async (_project, _review, format) => new Blob([format], { type: "text/plain" });

await formalRouter.push("/");
await formalRouter.isReady();
const pinia = createPinia();
const Root = defineComponent({
  setup() {
    const appearance = useAppearanceStore(pinia);
    provideThemeScope(storeToRefs(appearance).theme);
    const view = new URLSearchParams(location.search).get("view") || "feedback";
    return { view };
  },
  render() {
    const component = this.view === "review" ? WorkspaceReview : WorkspaceFeedback;
    return h("main", { class: "screens-content", style: "padding:32px;max-width:1600px;margin:auto" }, [h(component, { services, project, workspaceId: "visual" })]);
  },
});
createApp(Root).use(pinia).use(formalRouter).mount("#app");
`;

const server = await createServer({
  root: resolve("."),
  mode: "mock",
  server: { host, port, strictPort: true },
  plugins: [
    {
      name: "product-ui-feedback-review-fixture",
      resolveId(id) {
        if (id === virtualId) return resolvedVirtual;
      },
      load(id) {
        if (id === resolvedVirtual) return fixtureModule;
      },
      transformIndexHtml(html) {
        return html.replace("/src/main.ts", virtualId);
      },
    },
  ],
});

let browser;
const results = [];
const errors = [];
try {
  await server.listen();
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("PAGE ERROR:", error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.error("CONSOLE:", message.text());
  });
  await page.addInitScript(() => {
    window.__tpMotionEvents = [];
    document.addEventListener(
      "transitionrun",
      (event) => {
        const element = event.target;
        if (!(element instanceof Element)) return;
        const kind = element.matches("#feedback-entry, #review-create-form")
          ? "form"
          : element.matches(".feedback-item")
            ? "feedback-list"
            : element.matches(".review-issue")
              ? "review-list"
              : undefined;
        if (!kind) return;
        const style = getComputedStyle(element);
        const durations = style.transitionDuration.split(",").map((value) => {
          const trimmed = value.trim();
          return trimmed.endsWith("ms") ? Number.parseFloat(trimmed) : Number.parseFloat(trimmed) * 1000;
        });
        window.__tpMotionEvents.push({ kind, property: event.propertyName, durations, transform: style.transform });
      },
      true,
    );
  });
  const themes = ["zhumo", "yingguang", "yehang", "chenwu"];
  for (const theme of themes) {
    await page.addInitScript((value) => localStorage.setItem("thesispilot.appearance.v1", JSON.stringify(value)), { theme, motion: "full" });
    for (const view of ["feedback", "review"]) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`${origin}/?view=${view}&theme=${theme}`);
      await page.locator(view === "review" ? ".review-screen" : ".feedback-page").waitFor();
      await page.waitForFunction(() => !document.querySelector(".workspace-loading") && !document.querySelector(".feedback-loading"));
      if (view === "review") await page.locator(".review-report").waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(800);
      const metrics = await page.evaluate(() => ({
        viewport: innerWidth,
        width: document.documentElement.scrollWidth,
        theme: document.documentElement.dataset.theme,
        motion: document.documentElement.dataset.motion,
      }));
      if (metrics.width > metrics.viewport + 1 || metrics.theme !== theme) throw new Error(`${view}/${theme} 桌面视觉回归失败：${JSON.stringify(metrics)}`);
      await page.screenshot({ path: resolve(output, `${view}-${theme}-desktop.png`), fullPage: true, animations: "disabled" });
      results.push({ view, theme, viewport: "desktop", ...metrics });
    }
  }

  await page.addInitScript(() => localStorage.setItem("thesispilot.appearance.v1", JSON.stringify({ theme: "yingguang", motion: "reduced" })));
  for (const view of ["feedback", "review"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/?view=${view}&reduced=1`);
    await page.locator(view === "review" ? ".review-screen" : ".feedback-page").waitFor();
    await page.waitForFunction(() => !document.querySelector(".workspace-loading") && !document.querySelector(".feedback-loading"));
    if (view === "review") await page.locator(".review-report").waitFor();
    const metrics = await page.evaluate(() => ({
      viewport: innerWidth,
      width: document.documentElement.scrollWidth,
      theme: document.documentElement.dataset.theme,
      motion: document.documentElement.dataset.motion,
    }));
    if (metrics.width > metrics.viewport + 1 || metrics.motion !== "reduced") throw new Error(`${view} 390px 回归失败：${JSON.stringify(metrics)}`);
    const trigger = page.getByRole("button", { name: view === "review" ? "新建评审" : "录入反馈", exact: true });
    await trigger.focus();
    await trigger.press("Enter");
    const form = page.getByRole("form", { name: view === "review" ? "新建评审" : undefined }).first();
    const target = view === "review" ? form : page.locator("#feedback-entry");
    await target.waitFor();
    await page.keyboard.press("Escape");
    await target.waitFor({ state: "detached" });
    if (!(await trigger.evaluate((element) => element === document.activeElement))) throw new Error(`${view} Esc 后焦点未返回入口`);
    if (view === "feedback") {
      await page.getByRole("radio", { name: "已处理", exact: true }).click();
      await page.locator(".feedback-item").waitFor({ state: "detached" });
      await page.getByRole("radio", { name: "全部意见", exact: true }).click();
      await page.locator(".feedback-item").waitFor();
    } else {
      await page.getByLabel("筛选问题严重程度").click();
      await page.getByRole("option", { name: /一般（0）/ }).click();
      await page.getByText("该程度下没有问题", { exact: true }).waitFor();
      await page.getByLabel("筛选问题严重程度").click();
      await page.getByRole("option", { name: /全部程度（2）/ }).click();
      await page.locator(".review-issue").first().waitFor();
    }
    await page.waitForTimeout(200);
    const motionEvents = await page.evaluate(() => window.__tpMotionEvents);
    const formEvents = motionEvents.filter((event) => event.kind === "form" && event.property === "opacity");
    const listEvents = motionEvents.filter((event) => event.kind === (view === "review" ? "review-list" : "feedback-list") && event.property === "opacity");
    for (const [label, events] of [
      ["表单", formEvents],
      ["列表", listEvents],
    ]) {
      if (!events.length) throw new Error(`${view} ${label}没有实际透明度过渡`);
      const durations = events.flatMap((event) => event.durations);
      if (durations.some((duration) => duration > 120)) throw new Error(`${view} ${label}减弱动效超过 120ms：${durations}`);
      if (events.some((event) => event.transform !== "none")) throw new Error(`${view} ${label}减弱动效仍含位移或缩放`);
    }
    await page.screenshot({ path: resolve(output, `${view}-390-reduced.png`), fullPage: true, animations: "disabled" });
    results.push({
      view,
      viewport: 390,
      ...metrics,
      formMotionDurations: formEvents.flatMap((event) => event.durations),
      listMotionDurations: listEvents.flatMap((event) => event.durations),
      focusReturned: true,
    });
  }

  await page.goto(`${origin}/?view=review&scenario=empty`);
  await page.getByText("从第一份评审开始", { exact: true }).waitFor();
  const emptyTrigger = page.getByRole("button", { name: "选择评审范围", exact: true });
  await emptyTrigger.focus();
  await emptyTrigger.press("Enter");
  const emptyForm = page.getByRole("form", { name: "新建评审", exact: true });
  await emptyForm.waitFor();
  await page.keyboard.press("Escape");
  await emptyForm.waitFor({ state: "detached" });
  if (!(await emptyTrigger.evaluate((element) => element === document.activeElement))) throw new Error("空态评审表单 Esc 后未返回原触发按钮");
  await page.goto(`${origin}/?view=review&scenario=failed`);
  await page.getByRole("region", { name: "评审执行状态" }).waitFor();
  const failedStates = await page.getByText("评审失败，未生成报告", { exact: true }).count();
  if (failedStates !== 1) throw new Error(`失败状态重复：${failedStates}`);
  results.push({ emptyReview: true, singleFailedState: true });
  await writeFile(resolve(output, "results.json"), JSON.stringify({ results, errors }, null, 2) + "\n");
  if (errors.length) throw new Error(`浏览器异常：${errors.join("；")}`);
  console.log(`PASS: ${results.length} 组反馈/评审视觉与交互检查；四主题、390px、减弱动效、Esc 焦点、空态与单一失败状态。`);
  console.log(output);
} finally {
  await browser?.close();
  await server.close();
}
