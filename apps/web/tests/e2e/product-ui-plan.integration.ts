import { expect, test, type Page } from "@playwright/test";
import type { PlanAdjustmentRead, PlanVersionRead, ProjectRead, TaskRead, TaskSummary, TaskVersionRead } from "../../src/services/index.ts";

const P = "00000000-0000-4000-8000-000000000100";
const DOCUMENT = "00000000-0000-4000-8000-000000000200";
const FLOW = "00000000-0000-4000-8000-000000000300";
const FLOW_VERSION = "00000000-0000-4000-8000-000000000301";
const ADJUSTMENT = "00000000-0000-4000-8000-000000000400";
const JOB = "00000000-0000-4000-8000-000000000401";
const AGENT = "00000000-0000-4000-8000-000000000402";
const T1 = "00000000-0000-4000-8000-000000000001";
const T2 = "00000000-0000-4000-8000-000000000002";
const T3 = "00000000-0000-4000-8000-000000000003";
const NOW = new Date().toISOString();
const day = (offset: number) => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return value.toISOString().slice(0, 10);
};
const pageOf = <T>(items: T[] = [], limit = 100, offset = 0) => ({ items, limit, offset, total: items.length });

function evidence() {
  return {
    kind: "document" as const,
    document_id: DOCUMENT,
    version: 3,
    selection: { textblock_path: [1], from: 1, to: 5, text: "结果数据" },
  };
}
function snapshots(task: TaskRead) {
  return (task.content.evidence ?? []).map((reference) => ({
    fingerprint: "a".repeat(64),
    label: reference.kind === "document" ? `正式稿 v${reference.version} · 结果数据` : "合成材料证据",
    reference,
    stale: false,
  }));
}
function refresh(tasks: TaskRead[], task: TaskRead) {
  task.evidence_snapshots = snapshots(task);
  const reasons: string[] = [];
  if (!task.evidence_snapshots.length) reasons.push("缺少产物证据");
  if (task.evidence_snapshots.some((item) => item.stale)) reasons.push("产物证据版本已变化");
  if (
    (task.content.depends_on ?? []).some((id) => {
      const dependency = tasks.find((item) => item.id === id);
      return !dependency || dependency.status !== "confirmed" || dependency.needs_review;
    })
  )
    reasons.push("依赖任务待确认或已变化");
  task.needs_review = reasons.length > 0;
  task.review_reasons = reasons;
}
function makeTask(
  id: string,
  title: string,
  status: TaskRead["status"],
  position: number,
  start: number,
  due: number,
  withEvidence: boolean,
  dependsOn: string[] = [],
): TaskRead {
  return {
    id,
    project_id: P,
    version: 1,
    position,
    status,
    needs_review: false,
    review_reasons: [],
    evidence_snapshots: [],
    created_at: NOW,
    updated_at: NOW,
    content: {
      title,
      description: "",
      acceptance: "产物与验收条件一致",
      start_date: day(start),
      due_date: day(due),
      hard_deadline: null,
      depends_on: dependsOn,
      chapter: null,
      evidence: withEvidence ? [evidence()] : [],
      archived: false,
      status: status === "doing" || status === "verify" ? status : "todo",
    },
  };
}
function summary(task: TaskRead): TaskSummary {
  return {
    id: task.id,
    project_id: P,
    title: task.content.title,
    status: task.status,
    archived: task.content.archived ?? false,
    due_date: task.content.due_date ?? null,
    needs_review: task.needs_review,
    review_reasons: task.review_reasons,
    position: task.position,
    updated_at: task.updated_at,
    version: task.version,
    start_date: task.content.start_date ?? null,
    hard_deadline: task.content.hard_deadline ?? null,
    depends_on: task.content.depends_on ?? [],
  };
}
function historyEntry(task: TaskRead, action: string, reason = ""): TaskVersionRead {
  return { version: task.version, action, reason, created_at: task.updated_at, snapshot: structuredClone(task) };
}

async function installFixture(page: Page) {
  const tasks = [
    makeTask(T1, "整理实验结果", "verify", 0, -1, 2, true),
    makeTask(T2, "撰写结果分析", "todo", 1, 4, 8, false, [T1]),
    makeTask(T3, "准备答辩材料", "confirmed", 2, -8, -6, true),
  ];
  tasks.forEach((task) => refresh(tasks, task));
  const histories = new Map(tasks.map((task) => [task.id, [historyEntry(task, "create")]]));
  const project: ProjectRead = {
    id: P,
    name: "合成计划页项目",
    title: "合成论文",
    archived: false,
    deadline: day(40),
    existing_artifacts: "",
    flow_version_id: FLOW_VERSION,
    stage_id: "writing",
    planning_mode: "none",
    plan_note: "",
    version: 1,
    created_at: NOW,
    updated_at: NOW,
  };
  let boardVersion = 0;
  let planVersion = 0;
  const planVersions: PlanVersionRead[] = [];
  const commands: string[] = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const stages = [
    { id: "proposal", name: "开题", conditions: ["开题报告已确认"], deliverables: ["开题报告"], deadline: day(-20), enabled: true },
    {
      id: "writing",
      name: "论文撰写",
      description: "完成结果与分析章节。",
      conditions: ["结果可复核", "正文结构完整"],
      deliverables: ["结果表", "论文草稿"],
      start: day(-5),
      deadline: day(20),
      enabled: true,
    },
    { id: "defence", name: "答辩", conditions: ["答辩材料已确认"], deliverables: ["答辩稿"], deadline: day(35), enabled: true },
  ];
  const flow = { id: FLOW, current_version_id: FLOW_VERSION, name: "合成毕设流程", version: 1, enabled: true, stages, created_at: NOW, updated_at: NOW };
  const document = {
    id: DOCUMENT,
    project_id: P,
    version: 3,
    created_at: NOW,
    updated_at: NOW,
    content: {
      schema_version: 1,
      json: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1, chapterId: "results" }, content: [{ type: "text", text: "结果与分析" }] },
          { type: "paragraph", content: [{ type: "text", text: "结果数据与结论" }] },
        ],
      },
    },
  };
  const item = {
    id: "A1",
    task_key: "T2",
    task_id: T2,
    title: "撰写结果分析",
    base_version: 1,
    before: { start_date: day(4), due_date: day(8) },
    after: { start_date: day(6), due_date: day(10) },
    reason: "为结果核验预留时间。",
    blocked: false,
    violations: [],
  };
  const adjustment: PlanAdjustmentRead = {
    id: ADJUSTMENT,
    project_id: P,
    job_id: JOB,
    status: "succeeded",
    state: "pending",
    error_code: null,
    attempt: 1,
    base_plan_version: 0,
    agent_config_version_id: AGENT,
    agent_name: "进度助手",
    config_version_ids: { agent: AGENT },
    deadline: project.deadline,
    planning_mode: "none",
    task_count: 3,
    requested_model: null,
    response_model: null,
    proposal: { schema_version: 1, summary: "依据任务期限提出一项日期调整。", items: [item], notes: [] },
    decision: null,
    revert: null,
    created_at: NOW,
    updated_at: NOW,
  };
  const appendPlan = (action: "adopt" | "revert", accepted: string[]) => {
    const selected = adjustment.proposal!.items.filter((entry) => accepted.includes(entry.id));
    planVersions.unshift({
      version: planVersion,
      project_id: P,
      action,
      adjustment_id: ADJUSTMENT,
      created_at: NOW,
      reason: action === "adopt" ? "学生审阅后采纳" : "学生撤销采纳",
      changes: selected.map((entry) => ({
        task_id: entry.task_id!,
        title: entry.title,
        before_version: 1,
        after_version: 2,
        before: action === "adopt" ? entry.before : entry.after,
        after: action === "adopt" ? entry.after : entry.before,
      })),
      tasks: tasks.map((task) => ({
        task_id: task.id,
        version: task.version,
        position: task.position,
        title: task.content.title,
        status: task.status,
        archived: false,
        start_date: task.content.start_date ?? null,
        due_date: task.content.due_date ?? null,
        hard_deadline: null,
        depends_on: task.content.depends_on ?? [],
      })),
    });
  };

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const body = request.postData() ? request.postDataJSON() : undefined;
    const send = (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    const fail = (code: string, status = 409) => send({ error: { code, message: code, request_id: "product-ui-plan" } }, status);
    if (path === "/workspace/session" && method === "GET")
      return send({
        workspace_id: "00000000-0000-4000-8000-000000000900",
        expires_at: "2035-01-01T00:00:00Z",
        profile: {
          id: "00000000-0000-4000-8000-000000000900",
          version: 1,
          display_name: "学生",
          notifications_enabled: true,
          quiet_start: "22:00",
          quiet_end: "08:00",
          show_deferred: false,
        },
      });
    if (path === "/projects" && method === "GET") return send(pageOf([project], Number(url.searchParams.get("limit")), Number(url.searchParams.get("offset"))));
    if (path === `/projects/${P}` && method === "GET") return send(project);
    if (path === `/projects/${P}` && method === "PATCH") {
      Object.assign(project, body, { version: project.version + 1, updated_at: NOW });
      return send(project);
    }
    if (path === "/project-flows" && method === "GET")
      return send(pageOf([flow], Number(url.searchParams.get("limit")), Number(url.searchParams.get("offset"))));
    if (path === `/project-flows/${FLOW}/versions` && method === "GET")
      return send(
        pageOf(
          [{ id: FLOW_VERSION, flow_id: FLOW, name: flow.name, version: 1, stages, created_at: NOW }],
          Number(url.searchParams.get("limit")),
          Number(url.searchParams.get("offset")),
        ),
      );
    if (path === `/projects/${P}/documents/current` && method === "GET") return send(document);
    if (path === `/projects/${P}/materials` && method === "GET")
      return send(pageOf([], Number(url.searchParams.get("limit")), Number(url.searchParams.get("offset"))));
    if (path === `/projects/${P}/feedback` && method === "GET")
      return send(pageOf([], Number(url.searchParams.get("limit")), Number(url.searchParams.get("offset"))));
    if (path === "/ai-configs" && method === "GET") return send(pageOf([], Number(url.searchParams.get("limit")), Number(url.searchParams.get("offset"))));
    if (path === "/jobs" && method === "GET") return send(pageOf([], Number(url.searchParams.get("limit")), Number(url.searchParams.get("offset"))));
    if (path === `/projects/${P}/notifications/refresh` && method === "POST") return send({ project_id: P, created: 0, woken: 0, unread_count: 0 });
    if (path === `/projects/${P}/notifications/unread-count` && method === "GET") return send({ project_id: P, unread_count: 0 });

    if (path === `/projects/${P}/tasks` && method === "GET") {
      const limit = Number(url.searchParams.get("limit"));
      const offset = Number(url.searchParams.get("offset"));
      const ordered = [...tasks].sort((a, b) => a.position - b.position);
      return send({ items: ordered.slice(offset, offset + limit).map(summary), limit, offset, total: tasks.length, board_version: boardVersion });
    }
    if (path === `/projects/${P}/tasks` && method === "POST") {
      commands.push("create");
      const id = crypto.randomUUID();
      const task = makeTask(id, body.content.title, body.content.status ?? "todo", tasks.length, 4, 8, false);
      task.content = { ...task.content, ...body.content };
      task.created_at = task.updated_at = NOW;
      tasks.push(task);
      refresh(tasks, task);
      histories.set(id, [historyEntry(task, "create")]);
      boardVersion++;
      return send(task);
    }
    if (path === `/projects/${P}/tasks/reorder` && method === "POST") {
      commands.push("reorder");
      body.task_ids.forEach((id: string, index: number) => {
        const task = tasks.find((entry) => entry.id === id)!;
        task.position = index;
      });
      boardVersion++;
      return send({ board_version: boardVersion, task_ids: body.task_ids });
    }
    const decision = path.match(new RegExp(`^/projects/${P}/tasks/([^/]+)/decisions$`));
    if (decision && method === "POST") {
      commands.push(`decide:${body.action}`);
      const task = tasks.find((entry) => entry.id === decision[1])!;
      refresh(tasks, task);
      if (body.action === "confirm" && task.needs_review) return fail("TASK_EVIDENCE_STALE");
      task.status = body.action === "confirm" ? "confirmed" : body.action === "rework" ? "rework" : "todo";
      task.version++;
      task.updated_at = NOW;
      tasks.forEach((entry) => refresh(tasks, entry));
      histories.get(task.id)!.unshift(historyEntry(task, body.action, body.reason ?? ""));
      return send(task);
    }
    const versions = path.match(new RegExp(`^/projects/${P}/tasks/([^/]+)/versions$`));
    if (versions && method === "GET") {
      const entries = histories.get(versions[1]!) ?? [];
      return send(pageOf(entries, Number(url.searchParams.get("limit")), Number(url.searchParams.get("offset"))));
    }
    const taskPath = path.match(new RegExp(`^/projects/${P}/tasks/([^/]+)$`));
    if (taskPath && method === "GET") return send(tasks.find((entry) => entry.id === taskPath[1]));
    if (taskPath && method === "PATCH") {
      commands.push("update");
      const task = tasks.find((entry) => entry.id === taskPath[1])!;
      task.content = structuredClone(body.content);
      task.status = body.content.status ?? "todo";
      task.version++;
      task.updated_at = NOW;
      tasks.forEach((entry) => refresh(tasks, entry));
      histories.get(task.id)!.unshift(historyEntry(task, "edit"));
      return send(task);
    }

    if (path === `/projects/${P}/plan` && method === "GET")
      return send({
        project_id: P,
        deadline: project.deadline,
        latest_adjustment_id: ADJUSTMENT,
        plan_version: planVersion,
        planning_mode: project.planning_mode,
      });
    if (path === `/projects/${P}/plan/versions` && method === "GET")
      return send(pageOf(planVersions, Number(url.searchParams.get("limit")), Number(url.searchParams.get("offset"))));
    if (path === `/projects/${P}/plan/adjustments` && method === "GET")
      return send(pageOf([adjustment], Number(url.searchParams.get("limit")), Number(url.searchParams.get("offset"))));
    if (path === `/projects/${P}/plan/adjustments/${ADJUSTMENT}` && method === "GET") return send(adjustment);
    if (path === `/projects/${P}/plan/adjustments/${ADJUSTMENT}/decisions` && method === "POST") {
      commands.push(`plan:${body.action}`);
      if (body.action === "keep") {
        adjustment.state = "kept";
        adjustment.decision = { action: "keep", accepted_item_ids: [], rejected_item_ids: [item.id], plan_version: null, created_at: NOW };
        return send(adjustment);
      }
      planVersion++;
      adjustment.state = "adopted";
      adjustment.decision = { action: "adopt", accepted_item_ids: body.accepted_item_ids, rejected_item_ids: [], plan_version: planVersion, created_at: NOW };
      for (const entry of adjustment.proposal!.items.filter((candidate) => body.accepted_item_ids.includes(candidate.id))) {
        const task = tasks.find((candidate) => candidate.id === entry.task_id)!;
        task.content.start_date = entry.after.start_date;
        task.content.due_date = entry.after.due_date;
        task.version++;
        histories.get(task.id)!.unshift(historyEntry(task, "plan_adopt"));
      }
      appendPlan("adopt", body.accepted_item_ids);
      return send(adjustment);
    }
    if (path === `/projects/${P}/plan/adjustments/${ADJUSTMENT}/revert` && method === "POST") {
      commands.push("plan:revert");
      const accepted = adjustment.decision?.accepted_item_ids ?? [];
      for (const entry of adjustment.proposal!.items.filter((candidate) => accepted.includes(candidate.id))) {
        const task = tasks.find((candidate) => candidate.id === entry.task_id)!;
        task.content.start_date = entry.before.start_date;
        task.content.due_date = entry.before.due_date;
        task.version++;
        histories.get(task.id)!.unshift(historyEntry(task, "plan_revert"));
      }
      planVersion++;
      adjustment.state = "reverted";
      adjustment.revert = { action: "revert", accepted_item_ids: accepted, rejected_item_ids: [], plan_version: planVersion, created_at: NOW };
      appendPlan("revert", accepted);
      return send(adjustment);
    }
    unexpected.push(`${method} ${path}`);
    return fail("NOT_FOUND", 404);
  });
  return { commands, unexpected, errors };
}

async function openPlan(page: Page) {
  await page.goto(`/#/projects/${P}/tasks`);
  await expect(page.getByRole("heading", { name: "计划与进度", level: 1 })).toBeVisible();
  await expect(page.locator(".plan-task-row")).toHaveCount(2);
  await expect(page.locator(".plan-detail__title")).toHaveText("整理实验结果");
  await page.evaluate(() => document.fonts.ready);
}

interface MotionRecord {
  duration: number;
  properties: string[];
}
interface MotionProbe {
  records: MotionRecord[];
  samples: number;
  moved: boolean;
  raf: number;
}
async function measureMotion(page: Page, selector: string, text: string, action: () => Promise<void>) {
  await page.evaluate(
    ({ selector, text }) => {
      const probe: MotionProbe = { records: [], samples: 0, moved: false, raf: 0 };
      (window as Window & { __tpMotionProbe?: MotionProbe }).__tpMotionProbe = probe;
      function sample() {
        for (const element of document.querySelectorAll<HTMLElement>(selector)) {
          if (text && !element.textContent?.includes(text)) continue;
          probe.samples++;
          const transform = getComputedStyle(element).transform;
          if (transform !== "none" && !new DOMMatrix(transform).isIdentity) probe.moved = true;
          for (const animation of element.getAnimations()) {
            if (!(animation.effect instanceof KeyframeEffect)) continue;
            const duration = animation.effect.getComputedTiming().duration;
            if (typeof duration !== "number") continue;
            probe.records.push({ duration, properties: [...new Set(animation.effect.getKeyframes().flatMap((frame) => Object.keys(frame)))] });
          }
        }
        probe.raf = requestAnimationFrame(sample);
      }
      sample();
    },
    { selector, text },
  );
  await action();
  const target = page.locator(selector).filter({ hasText: text }).first();
  await target.waitFor({ state: "visible" });
  await target.evaluate(async (element) => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
  });
  return page.evaluate(() => {
    const probe = (window as Window & { __tpMotionProbe?: MotionProbe }).__tpMotionProbe!;
    cancelAnimationFrame(probe.raf);
    delete (window as Window & { __tpMotionProbe?: MotionProbe }).__tpMotionProbe;
    return { records: probe.records, samples: probe.samples, moved: probe.moved };
  });
}

test("四主题桌面与390px保持正式计划页可操作且无页面横向溢出", async ({ page }, testInfo) => {
  const fixture = await installFixture(page);
  await openPlan(page);
  for (const theme of ["zhumo", "yingguang", "yehang", "chenwu"]) {
    await page.evaluate((value) => localStorage.setItem("thesispilot.workspace.appearance.v1", JSON.stringify({ theme: value, motion: "full" })), theme);
    await page.reload();
    await openPlan(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await expect(page.getByRole("button", { name: "新增任务", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "去核验：整理实验结果" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      const heights = await page.locator(".plan-task__action").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
      expect(heights.every((height) => height >= 28)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}.png`), fullPage: width === 390, animations: "disabled" });
    }
  }
  await page.getByText("阶段要求", { exact: true }).click();
  await expect(page.locator(".plan-route__definition")).toContainText("结果可复核");
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("真实新增、键盘取消、开始、学生确认和历史焦点形成完整操作链", async ({ page }) => {
  const fixture = await installFixture(page);
  await openPlan(page);
  const create = page.getByRole("button", { name: "新增任务", exact: true });
  const opening = await measureMotion(page, ".plan-editor", "新增任务", async () => {
    await create.focus();
    await page.keyboard.press("Enter");
  });
  expect(opening.samples).toBeGreaterThan(0);
  expect(opening.records.some((record) => record.properties.includes("opacity"))).toBe(true);
  expect(opening.moved).toBe(true);
  const form = page.getByRole("form", { name: "任务编辑器" });
  await expect(form.getByLabel("任务目标")).toBeFocused();
  await form.getByLabel("任务目标").fill("不保存的任务");
  await form.getByLabel("任务目标").press("Escape");
  await expect(form).toHaveCount(0);
  await expect(create).toBeFocused();
  expect(fixture.commands).toEqual([]);

  await create.click();
  const title = form.getByLabel("任务目标");
  await title.fill("浏览器新增任务");
  await form.getByLabel("验收条件").fill("关联真实产物后核验");
  const entering = await measureMotion(page, ".plan-task-row", "浏览器新增任务", async () => title.press("Enter"));
  expect(entering.samples).toBeGreaterThan(0);
  expect(fixture.commands).toEqual(["create"]);
  const detail = page.getByRole("complementary", { name: "任务详情" });
  await expect(detail.locator(".plan-detail__title")).toHaveText("浏览器新增任务");
  await expect(detail.locator(".plan-detail")).toBeFocused();
  expect(entering.moved, JSON.stringify(entering)).toBe(true);

  await page.getByRole("button", { name: "开始：撰写结果分析" }).click();
  await expect(detail.locator(".plan-detail__title")).toHaveText("撰写结果分析");
  await expect(detail.locator(".plan-detail__status")).toContainText("进行中");
  await expect(detail.locator(".tp-seal")).toHaveCount(0);
  await detail.getByRole("checkbox", { name: "我已核对验收条件与证据" }).check();
  await expect(detail.getByRole("button", { name: "确认任务完成" })).toBeDisabled();

  await page.getByRole("button", { name: "去核验：整理实验结果" }).click();
  await expect(detail.locator(".plan-detail__title")).toHaveText("整理实验结果");
  const confirmationCheck = detail.getByRole("checkbox", { name: "我已核对验收条件与证据" });
  await confirmationCheck.check();
  await expect(confirmationCheck).toBeChecked();
  const confirmation = detail.getByRole("button", { name: "确认任务完成" });
  await expect(confirmation).toBeEnabled();
  await confirmation.click();
  await expect(detail.locator(".tp-seal")).toHaveText("学生已确认");
  await expect(page.locator(".plan-summary .tp-num")).toHaveText("2 / 4");
  await page.getByRole("radio", { name: "全部", exact: true }).click();
  await page.getByRole("button", { name: "确认记录：整理实验结果" }).click();
  await expect(page.getByRole("region", { name: "任务历史" })).toContainText("学生确认完成");
  await expect(detail.locator(".plan-history__toggle")).toBeFocused();
  expect(fixture.commands).toContain("decide:confirm");
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("候选采纳撤销、个人规划和减弱动效不延迟或隐式改变正式数据", async ({ page }) => {
  const fixture = await installFixture(page);
  await openPlan(page);
  await expect(page.locator(".plan-bar.is-candidate")).toHaveCount(1);
  await expect(page.locator(".plan-version")).toHaveText("计划 v0");
  await page.getByRole("button", { name: "采纳所选（1）" }).click();
  await expect(page.locator(".plan-proposal .tp-seal")).toHaveText("已采纳");
  await expect(page.locator(".plan-version")).toHaveText("计划 v1");
  await expect(page.locator(".plan-bar.is-candidate")).toHaveCount(0);
  await page.getByRole("button", { name: "撤销本次采纳" }).click();
  await expect(page.locator(".plan-version")).toHaveText("计划 v2");
  await expect(page.locator(".plan-proposal")).toContainText("已撤销这次采纳");
  await page.getByRole("button", { name: /计划历史/ }).click();
  await expect(page.getByRole("region", { name: "计划历史" })).toContainText("撤销采纳");

  const planning = page.getByRole("region", { name: "个人规划" });
  await planning.getByRole("button", { name: "设置个人规划" }).click();
  await planning.getByRole("radio", { name: "填写规划", exact: true }).click();
  await planning.getByLabel("可用时间与安排").fill("不保存的安排");
  await planning.getByLabel("可用时间与安排").press("Escape");
  await expect(planning.getByRole("button", { name: "设置个人规划" })).toBeFocused();
  await planning.getByRole("button", { name: "设置个人规划" }).click();
  await planning.getByRole("radio", { name: "填写规划", exact: true }).click();
  await planning.getByLabel("可用时间与安排").fill("每周三整理实验。");
  await planning.getByLabel("可用时间与安排").press("Control+Enter");
  await expect(planning).toContainText("每周三整理实验。");
  await expect(planning.getByRole("button", { name: "编辑规划" })).toBeFocused();

  await page.evaluate(() => localStorage.setItem("thesispilot.workspace.appearance.v1", JSON.stringify({ theme: "yehang", motion: "reduced" })));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await expect(page.getByRole("heading", { name: "计划与进度", level: 1 })).toBeVisible();
  const reduced = await measureMotion(page, ".plan-editor", "新增任务", async () => page.getByRole("button", { name: "新增任务", exact: true }).click());
  expect(reduced.samples).toBeGreaterThan(0);
  expect(reduced.moved).toBe(false);
  expect(reduced.records.some((record) => record.properties.includes("opacity") && record.duration > 0 && record.duration <= 120)).toBe(true);
  expect(reduced.records.every((record) => record.duration <= 120)).toBe(true);
  await page.getByRole("form", { name: "任务编辑器" }).getByLabel("任务目标").press("Escape");
  await expect(page.getByRole("button", { name: "新增任务", exact: true })).toBeFocused();
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
