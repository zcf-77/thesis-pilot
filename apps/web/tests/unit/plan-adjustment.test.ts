import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createServices } from "../../src/services/index.ts";
import type { PlanAdjustmentItem, PlanAdjustmentRead, TaskSummary } from "../../src/services/contracts/api.generated.ts";
import { canRerunServiceJob, serviceJobTitle } from "../../src/lab/state/serviceJobs.ts";
import { planViolations } from "../../src/services/mockPlans.ts";
import { actionWord } from "../../src/workspace/tasks/taskBoard.ts";
import { adjustmentSummary, dayOffset, selectableItems, shiftDate, timelineRows, windowDays } from "../../src/workspace/tasks/planView.ts";

afterEach(() => vi.useRealTimers());

const day = (offset: number) => shiftDate("2030-06-10", offset);

async function fixture(role: "progress" | "content" = "progress") {
  const api = createServices({ mode: "mock", instanceId: `plan-${crypto.randomUUID()}` });
  const project = await api.projects.create({ name: "合成计划项目", deadline: day(60) });
  const provider = await api.aiConfigs.create({ name: "合成接口", content: { kind: "api", max_retries: 1 } });
  const model = await api.aiConfigs.create({
    name: "合成模型",
    content: {
      kind: "model",
      api_version_id: provider.current_version_id,
      model_code: "deepseek-flash",
      capabilities: [role === "progress" ? "plan" : "text"],
    },
  });
  const prompt = await api.aiConfigs.create({ name: "合成提示词", content: { kind: "prompt", template: "{{context}}", variables: ["context"] } });
  const agent = await api.aiConfigs.create({
    name: "合成进度",
    content: { kind: "agent", role, instructions: "只提出建议", model_version_id: model.current_version_id, prompt_version_id: prompt.current_version_id },
  });
  const add = async (title: string, start: string, due: string, depends_on: string[] = []) => {
    const board = (await api.tasks.list(project.id)).board_version;
    return api.tasks.create(project.id, {
      command_id: crypto.randomUUID(),
      expected_board_version: board,
      content: { title, acceptance: "可核对", start_date: start, due_date: due, depends_on },
    });
  };
  const survey = await add("文献综述", day(1), day(5));
  const method = await add("实验方法", day(6), day(12), [survey.id]);
  return { api, projectId: project.id, agent: agent.current_version_id, survey, method };
}

describe("SG-10 计划版本与调整候选同契约服务", () => {
  it("手动批量调整整体校验依赖与版本，并追加不可变计划版本", async () => {
    const { api, projectId, survey } = await fixture();
    const change = (version: number, due: string) => ({
      command_id: crypto.randomUUID(),
      reason: "按导师意见调整",
      changes: [{ task_id: survey.id, expected_version: version, start_date: day(1), due_date: due }],
    });
    await expect(api.plans.schedule(projectId, change(1, day(9)))).rejects.toMatchObject({ code: "PLAN_CONSTRAINT_VIOLATION" });
    await expect(api.plans.schedule(projectId, change(7, day(4)))).rejects.toMatchObject({ code: "PLAN_TASK_STALE" });
    const input = change(1, day(4));
    const version = await api.plans.schedule(projectId, input);
    expect(version).toMatchObject({ version: 1, action: "manual" });
    expect(version.changes[0]).toMatchObject({ before: { due_date: day(5) }, after: { due_date: day(4) } });
    expect((await api.plans.schedule(projectId, input)).version).toBe(1);
    expect((await api.plans.get(projectId)).plan_version).toBe(1);
    expect((await api.plans.versions(projectId)).items.map((item) => item.version)).toEqual([1]);
    const summary = (await api.tasks.list(projectId)).items.find((item) => item.id === survey.id)!;
    expect(summary.due_date).toBe(day(4));
  });

  it("Mock 队列像无凭据服务器一样失败，不编造候选，也不改任务", async () => {
    vi.useFakeTimers();
    const { api, projectId, agent } = await fixture();
    const input = { command_id: crypto.randomUUID(), agent_config_version_id: agent };
    const receipt = await api.plans.createAdjustment(projectId, input);
    expect(receipt.adjustment).toMatchObject({ state: "queued", proposal: null, decision: null, task_count: 2 });
    expect(serviceJobTitle(receipt.job)).toBe("计划调整");
    expect((await api.plans.createAdjustment(projectId, input)).adjustment.id).toBe(receipt.adjustment.id);
    await expect(api.plans.createAdjustment(projectId, { ...input, command_id: crypto.randomUUID() })).rejects.toMatchObject({
      code: "PLAN_ADJUSTMENT_BUSY",
    });
    await vi.advanceTimersByTimeAsync(2500);
    const failed = await api.plans.adjustment(projectId, receipt.adjustment.id);
    expect(failed).toMatchObject({ state: "failed", error_code: "MODEL_NOT_CONFIGURED", proposal: null });
    await expect(api.plans.decide(projectId, failed.id, { command_id: crypto.randomUUID(), action: "adopt", accepted_item_ids: ["A1"] })).rejects.toMatchObject(
      { code: "PLAN_CANDIDATE_UNAVAILABLE" },
    );
    const job = (await api.jobs.list({ project_id: projectId, kind: "plan_adjustment" })).items[0]!;
    expect(canRerunServiceJob(job)).toBe(false);
    await expect(api.jobs.retry(job.id, "plan-generic", undefined, projectId)).rejects.toMatchObject({ code: "PLAN_ADJUSTMENT_RETRY_REQUIRED" });
    await expect(api.jobs.create({ project_id: projectId, kind: "plan_adjustment" }, "forged")).rejects.toMatchObject({ code: "JOB_KIND_UNAVAILABLE" });
    expect((await api.plans.get(projectId)).plan_version).toBe(0);
  });

  it("只接受角色为进度且模型具备计划能力的智能体", async () => {
    const { api, projectId, agent } = await fixture("content");
    await expect(api.plans.createAdjustment(projectId, { command_id: crypto.randomUUID(), agent_config_version_id: agent })).rejects.toMatchObject({
      code: "PLAN_AGENT_INVALID",
    });
  });

  it("提醒参数按版本保存，越界与旧版本被拒绝", async () => {
    const api = createServices({ mode: "mock", instanceId: `reminder-${crypto.randomUUID()}` });
    expect(await api.reminderSettings.get()).toMatchObject({ version: 0, cooldown_hours: 24, overdue_days: 1 });
    const saved = await api.reminderSettings.update({ expected_version: 0, enabled: false, cooldown_hours: 48, overdue_days: 3 });
    expect(saved).toMatchObject({ version: 1, enabled: false });
    await expect(api.reminderSettings.update({ expected_version: 0, enabled: true, cooldown_hours: 2, overdue_days: 1 })).rejects.toMatchObject({
      code: "PLAN_REMINDER_CONFLICT",
    });
    await expect(api.reminderSettings.update({ expected_version: 1, enabled: true, cooldown_hours: 169, overdue_days: 1 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("HTTP 校验：候选状态与决定、提案、任务回执必须一致", async () => {
    const projectId = crypto.randomUUID();
    const adjustmentId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const base: PlanAdjustmentRead = {
      id: adjustmentId,
      project_id: projectId,
      job_id: jobId,
      status: "succeeded",
      state: "pending",
      error_code: null,
      attempt: 1,
      base_plan_version: 0,
      agent_config_version_id: crypto.randomUUID(),
      agent_name: "进度 · v1",
      config_version_ids: {},
      deadline: null,
      planning_mode: "none",
      task_count: 1,
      requested_model: "deepseek-flash",
      response_model: "deepseek-flash",
      proposal: { schema_version: 1, summary: "合成", items: [], notes: [] },
      decision: null,
      revert: null,
      created_at: "2030-06-10T00:00:00Z",
      updated_at: "2030-06-10T00:00:00Z",
    };
    const respond = (body: unknown) =>
      createServices({
        mode: "http",
        instanceId: "plan-http",
        fetch: async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
      });
    expect((await respond(base).plans.adjustment(projectId, adjustmentId)).state).toBe("pending");
    await expect(respond({ ...base, state: "adopted" }).plans.adjustment(projectId, adjustmentId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(respond({ ...base, status: "failed", state: "failed" }).plans.adjustment(projectId, adjustmentId)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(respond({ ...base, project_id: crypto.randomUUID() }).plans.adjustment(projectId, adjustmentId)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    const job = (input: string) => ({
      id: jobId,
      project_id: projectId,
      kind: "plan_adjustment",
      status: "queued",
      attempt: 0,
      result: null,
      input_snapshot: { schema_version: 1, adjustment_id: input },
      resource_scope: { schema_version: 1, adjustment_id: input },
      configuration: null,
      source_job_id: null,
      error_code: null,
      created_at: base.created_at,
      updated_at: base.updated_at,
    });
    const queued = { ...base, status: "queued", state: "queued", proposal: null };
    const input = { command_id: crypto.randomUUID(), agent_config_version_id: base.agent_config_version_id };
    expect((await respond({ adjustment: queued, job: job(adjustmentId) }).plans.createAdjustment(projectId, input)).adjustment.id).toBe(adjustmentId);
    await expect(respond({ adjustment: queued, job: job(crypto.randomUUID()) }).plans.createAdjustment(projectId, input)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});

describe("SG-10 计划时间轴与候选视图", () => {
  const task = (id: string, start: string | null, due: string | null, extra: Partial<TaskSummary> = {}): TaskSummary => ({
    id,
    project_id: "p",
    version: 1,
    position: 0,
    title: id,
    status: "todo",
    archived: false,
    due_date: due,
    start_date: start,
    hard_deadline: null,
    depends_on: [],
    needs_review: false,
    review_reasons: [],
    updated_at: "2030-06-10T00:00:00Z",
    ...extra,
  });
  const item = (taskId: string, start: string, due: string, blocked = false): PlanAdjustmentItem => ({
    id: `A-${taskId}`,
    task_key: "T1",
    task_id: taskId,
    title: taskId,
    base_version: 1,
    before: { start_date: null, due_date: null },
    after: { start_date: start, due_date: due },
    reason: "合成",
    blocked,
    violations: blocked ? [{ code: "HARD_DEADLINE", message: "越过硬截止。" }] : [],
  });

  it("两周窗口裁剪、今天标记与硬截止旗标；候选只画未被阻止的条目", () => {
    const start = day(0);
    const days = windowDays(start, day(3));
    expect(days).toHaveLength(14);
    expect(days.filter((value) => value.today).map((value) => value.iso)).toEqual([day(3)]);
    expect(dayOffset(start, day(13))).toBe(13);
    const rows = timelineRows(
      [
        task("a", day(-3), day(2), { hard_deadline: day(4) }),
        task("b", day(20), day(25)),
        task("c", null, null),
        task("d", day(5), day(6), { archived: true }),
        task("e", day(8), day(9)),
      ],
      start,
      day(3),
      [item("b", day(10), day(12)), item("e", day(9), day(11), true)],
    );
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "e"]);
    expect(rows[0]!.current).toMatchObject({ start: 0, end: 3, visible: true });
    expect(rows[0]!.flag).toBe(4);
    expect(rows[1]!.current?.visible).toBe(false);
    expect(rows[1]!.next).toMatchObject({ start: 10, end: 13, visible: true });
    expect(rows[2]!.next).toBeUndefined();
  });

  it("候选文案说明可采纳与被阻止的数量，不把过期或取消说成成功", () => {
    const pending = {
      state: "pending",
      base_plan_version: 2,
      task_count: 3,
      proposal: { schema_version: 1, summary: "", notes: [], items: [item("a", day(1), day(2)), item("b", day(1), day(2), true)] },
      decision: null,
      revert: null,
    } as unknown as PlanAdjustmentRead;
    expect(adjustmentSummary(pending)).toContain("1 项可采纳，1 项未通过程序检查");
    expect(selectableItems(pending).map((value) => value.id)).toEqual(["A-a"]);
    expect(adjustmentSummary({ ...pending, state: "expired" })).toContain("不能再采纳");
    expect(adjustmentSummary({ ...pending, state: "cancelled" })).toContain("不会写入");
    expect(actionWord.plan_adopt).toBe("采纳计划调整");
  });

  it("Mock 约束与服务端一致：依赖倒置、硬截止与项目截止", () => {
    const tasks = [
      {
        task_id: "a",
        version: 1,
        position: 0,
        title: "前置",
        status: "todo",
        archived: false,
        start_date: day(1),
        due_date: day(5),
        hard_deadline: day(10),
        depends_on: [],
      },
      {
        task_id: "b",
        version: 1,
        position: 1,
        title: "后续",
        status: "todo",
        archived: false,
        start_date: day(6),
        due_date: day(9),
        hard_deadline: null,
        depends_on: ["a"],
      },
    ] as const;
    const check = (id: string, start: string, due: string, deadline: string | null = null) =>
      planViolations(structuredClone(tasks) as never, new Map([[id, { start_date: start, due_date: due }]]), deadline);
    expect(check("a", day(1), day(11)).join()).toContain("硬截止");
    expect(check("a", day(1), day(7)).join()).toContain("后续任务");
    expect(check("b", day(6), day(9), day(8)).join()).toContain("项目截止");
    expect(check("b", day(6), day(9))).toEqual([]);
  });
});
