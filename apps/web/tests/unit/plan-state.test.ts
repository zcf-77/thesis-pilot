import { describe, expect, it } from "vite-plus/test";
import { createPinia, setActivePinia } from "pinia";
import { usePreviewWorkspaceStore } from "../../src/lab/state/previewWorkspace.ts";
import {
  addFeedbackTask,
  applyPlan,
  associateDocument,
  associateMaterial,
  changeTaskStatus,
  confirmTask,
  createPlanState,
  proposePlan,
  saveTask,
  setEvidenceArchived,
  undoPlanChange,
  validatePlan,
  validatePlanState,
  usePlanState,
  linkFeedbackToTask,
} from "../../src/lab/state/planState.ts";

const deadline = "2026-12-25";
describe("计划与证据约束", () => {
  it("项目切换隔离任务，导入新文稿不会复制原项目样例", () => {
    setActivePinia(createPinia());
    const workspace = usePreviewWorkspaceStore();
    const plan = usePlanState();
    const original = workspace.current.id;
    expect(plan.value.tasks).toHaveLength(6);
    workspace.createProject("独立项目");
    workspace.current.planning = "每周六写作";
    workspace.saveDocument("<p>导入后的正文</p>", "导入");
    expect(workspace.current.document.version).toBe(2);
    expect(plan.value.tasks).toHaveLength(0);
    expect(plan.value.planningMode).toBe("personal");
    expect(plan.value.planning).toBe("每周六写作");
    workspace.switchProject(original);
    expect(plan.value.tasks).toHaveLength(6);
  });
  it("初始计划可行，空项目不创建虚构任务", () => {
    expect(validatePlan(createPlanState().tasks, deadline)).toEqual([]);
    expect(createPlanState(true).tasks).toEqual([]);
  });
  it("创建循环依赖被拒绝且不改变原任务", () => {
    const state = createPlanState();
    const before = JSON.stringify(state);
    const draft = { ...state.tasks.find((task) => task.id === "t2")!, dependencies: ["t1"] };
    expect(saveTask(state, draft, deadline).join(" ")).toContain("循环依赖");
    expect(JSON.stringify(state)).toBe(before);
  });
  it("无效日期、前置日期冲突和硬截止不能偷偷保存", () => {
    const state = createPlanState();
    const draft = { ...state.tasks[0]!, start: "2026-02-31", deadline: "2026-12-30" };
    expect(saveTask(state, draft, deadline).join(" ")).toContain("有效起止日期");
    expect(saveTask(state, draft, deadline).join(" ")).toContain("硬截止");
    expect(state.version).toBe(4);
  });
  it("生成候选不改计划，学生采纳才改变，撤销生成新版本并保留历史", () => {
    const state = createPlanState();
    const originalTasks = JSON.stringify(state.tasks);
    proposePlan(state, deadline, "2026-11-14");
    expect(JSON.stringify(state.tasks)).toBe(originalTasks);
    expect(applyPlan(state, deadline)).toEqual([]);
    expect(state.version).toBe(5);
    expect(state.tasks.find((task) => task.id === "t2")!.deadline).toBe("2026-11-16");
    expect(undoPlanChange(state, deadline)).toEqual([]);
    expect(state.version).toBe(6);
    expect(JSON.stringify(state.tasks)).toBe(originalTasks);
    expect(state.history.map((item) => item.version)).toEqual([6, 5]);
  });
  it("计划发生变化后旧候选不覆盖新内容", () => {
    const state = createPlanState();
    proposePlan(state, deadline, "2026-11-14");
    const task = state.tasks[0]!;
    expect(saveTask(state, { ...task, title: "学生新编辑的目标" }, deadline)).toEqual([]);
    expect(applyPlan(state, deadline).join(" ")).toContain("计划版本已变化");
    expect(state.tasks[0]!.title).toBe("学生新编辑的目标");
    expect(state.candidate!.status).toBe("expired");
  });
  it("硬截止导致无解时采纳失败，原计划与候选保留", () => {
    const state = createPlanState();
    proposePlan(state, deadline, "2026-11-14");
    const before = JSON.stringify(state.tasks);
    expect(applyPlan(state, "2026-11-15").join(" ")).toContain("无可行安排");
    expect(JSON.stringify(state.tasks)).toBe(before);
    expect(state.version).toBe(4);
  });
  it("固定任务截止不能被普通编辑或伪造候选移动", () => {
    const state = createPlanState();
    const task = state.tasks[0]!;
    task.hardDeadline = true;
    expect(saveTask(state, { ...task, deadline: "2026-11-20" }, deadline).join(" ")).toContain("固定截止");
    state.candidate = {
      baseVersion: 4,
      status: "pending",
      changes: [{ id: task.id, start: task.start, deadline: "2026-11-20", previousStart: task.start, previousDeadline: task.deadline }],
    };
    expect(applyPlan(state, deadline).join(" ")).toContain("固定截止");
    expect(task.deadline).toBe("2026-11-14");
  });
  it("缺证据、旧证据和未核对均不能确认，重新关联保留旧证据", () => {
    const state = createPlanState();
    const task = state.tasks.find((item) => item.id === "t2")!;
    expect(confirmTask(state, task.id, 13, true)).toContain("实际产物");
    associateDocument(state, task, 12);
    expect(confirmTask(state, task.id, 13, true)).toContain("旧版本");
    associateDocument(state, task, 13);
    expect(task.evidence[0]!.archived).toBe(true);
    expect(confirmTask(state, task.id, 13, false)).toContain("核对");
    expect(confirmTask(state, task.id, 13, true)).toBeNull();
    expect(task.status).toBe("confirmed");
    expect(task.history[0]!.summary).toContain("学生");
    const version = state.version;
    expect(confirmTask(state, task.id, 13, true)).toContain("无需重复提交");
    expect(state.version).toBe(version);
  });
  it("资料版本替换后待复核，返工保留确认记录", () => {
    const state = createPlanState();
    const task = state.tasks.find((item) => item.id === "t2")!;
    associateMaterial(state, task, { id: "source", name: "结果表", version: 2 });
    expect(confirmTask(state, task.id, 13, true, { source: 3 })).toContain("旧版本");
    associateMaterial(state, task, { id: "source", name: "结果表", version: 3 });
    expect(confirmTask(state, task.id, 13, true, { source: 3 })).toBeNull();
    associateMaterial(state, task, { id: "source", name: "结果表", version: 4 });
    expect(task.status).toBe("verify");
    expect(confirmTask(state, task.id, 13, true, { source: 4 })).toBeNull();
    expect(changeTaskStatus(state, task, "doing", "")).toContain("返工原因");
    expect(changeTaskStatus(state, task, "doing", "补做实验")).toBeNull();
    expect(task.history.some((item) => item.summary.includes("学生核对"))).toBe(true);
    expect(task.history[0]!.summary).toContain("补做实验");
  });
  it("前置未确认阻止完成；反馈创建按来源去重", () => {
    const state = createPlanState();
    expect(confirmTask(state, "t1", 13, true)).toContain("前置任务");
    const result = addFeedbackTask(state, { title: "补充分析", feedbackId: "f1", start: "2026-11-14" }, deadline);
    const duplicate = addFeedbackTask(state, { title: "重复请求", feedbackId: "f1", start: "2026-11-14" }, deadline);
    expect(result.ok && duplicate.ok && duplicate.task.id === result.task.id).toBe(true);
    expect(state.tasks.filter((item) => item.feedbackId === "f1")).toHaveLength(1);
  });
  it("解除证据关联保留原件与记录，恢复后仍需学生核验", () => {
    const state = createPlanState();
    const task = state.tasks.find((item) => item.id === "t2")!;
    associateDocument(state, task, 13);
    expect(confirmTask(state, task.id, 13, true)).toBeNull();
    const evidence = task.evidence[0]!;
    setEvidenceArchived(state, task, evidence.id, true);
    expect(task.status).toBe("verify");
    expect(task.evidence).toHaveLength(1);
    expect(confirmTask(state, task.id, 13, true)).toContain("实际产物");
    setEvidenceArchived(state, task, evidence.id, false);
    expect(task.status).toBe("verify");
    expect(confirmTask(state, task.id, 13, true)).toBeNull();
    expect(task.history.some((item) => item.summary.includes("解除证据"))).toBe(true);
  });
  it("反馈创建任务服从项目短截止，无法安排时原状态不变", () => {
    const state = createPlanState(true);
    const result = addFeedbackTask(state, { title: "核对反馈", feedbackId: "short-deadline", start: "2026-11-14" }, "2026-12-01");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("预期有效任务");
    expect(result.task.deadline).toBe("2026-12-01");
    expect(validatePlan(state.tasks, "2026-12-01")).toEqual([]);
    const before = JSON.stringify(state);
    const failed = addFeedbackTask(state, { title: "不能超期", feedbackId: "past-deadline", start: "2026-12-02" }, "2026-12-01");
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
    const invalid = addFeedbackTask(state, { title: "", feedbackId: "blank-title", start: "2026-11-14" }, "2026-12-01");
    expect(invalid.ok).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });
  it("损坏的备份模块不能通过结构检查", () => {
    expect(validatePlanState(createPlanState())).toBe(true);
    expect(validatePlanState({ version: 4, tasks: [], history: [] })).toBe(false);
    const state = createPlanState();
    state.tasks[0]!.dependencies = [123 as unknown as string];
    expect(validatePlanState(state)).toBe(false);
  });
  it("任意任务ID可跨月安排，生成不写任务，约束满足才采纳", () => {
    const state = createPlanState(true);
    const make = (id: string, start: string, deadline: string, dependencies: string[]) => ({
      id,
      title: id,
      acceptance: "核对真实产物",
      start,
      deadline,
      dependencies,
      status: "todo" as const,
      evidence: [],
      history: [],
    });
    state.tasks = [
      make("new-alpha", "2026-12-01", "2026-12-03", []),
      make("new-beta", "2026-12-04", "2026-12-08", ["new-alpha"]),
      make("new-gamma", "2026-12-09", "2026-12-10", ["new-beta"]),
      make("new-fourth", "2026-12-11", "2026-12-12", ["new-gamma"]),
    ];
    const before = JSON.stringify(state.tasks);
    const candidate = proposePlan(state, "2027-02-01", "2026-12-29");
    expect(candidate.changes).toHaveLength(4);
    expect(candidate.changes.some((change) => change.start.startsWith("2027-01"))).toBe(true);
    expect(JSON.stringify(state.tasks)).toBe(before);
    expect(applyPlan(state, "2027-02-01")).toEqual([]);
    expect(validatePlan(state.tasks, "2027-02-01")).toEqual([]);
  });
  it("无解与旧编辑稿都保留正式计划", () => {
    const state = createPlanState();
    const draft = { ...state.tasks[0]!, title: "旧编辑", baseVersion: state.version };
    state.version += 1;
    expect(saveTask(state, draft, deadline).join()).toContain("旧编辑稿");
    const before = JSON.stringify(state.tasks);
    const candidate = proposePlan(state, "2026-11-15", "2026-11-14");
    expect(candidate.errors?.length).toBeGreaterThan(0);
    expect(candidate.changes).toEqual([]);
    expect(applyPlan(state, "2026-11-15").join()).toContain("无可行安排");
    expect(JSON.stringify(state.tasks)).toBe(before);
  });
  it("多条反馈关联同一任务，解除一条保留另一条和历史", () => {
    const state = createPlanState();
    const task = state.tasks[0]!;
    const status = task.status;
    expect(linkFeedbackToTask(state, "f-a", task.id)).toBeNull();
    expect(linkFeedbackToTask(state, "f-b", task.id)).toBeNull();
    expect(task.feedbackIds).toEqual(["f-a", "f-b"]);
    linkFeedbackToTask(state, "f-a");
    expect(task.feedbackIds).toEqual(["f-b"]);
    expect(task.feedbackId).toBe("f-b");
    expect(task.status).toBe(status);
    expect(task.history[0]!.summary).toContain("解除反馈");
    expect(linkFeedbackToTask(state, "f-c", "missing")).toContain("不存在");
  });
});
