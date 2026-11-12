import { describe, expect, it } from "vite-plus/test";
import { createSettingsState } from "../../src/lab/state/settingsState.ts";
import { projectDeadlineSummary, projectStageProgress, savedClock, stageElapsed, availableNextStages } from "../../src/lab/state/projectProgress.ts";

describe("顶栏项目阶段与日历截止", () => {
  it("使用上海日历日，在本地午夜更新倒计时", () => {
    const before = projectDeadlineSummary("2026-11-15", new Date("2026-11-14T15:59:59Z"));
    const after = projectDeadlineSummary("2026-11-15", new Date("2026-11-14T16:00:00Z"));
    expect(before).toEqual({ kind: "future", days: 1, label: "距论文提交 1 天" });
    expect(after).toEqual({ kind: "today", days: 0, label: "今天是论文提交截止日" });
  });

  it("过期天数、跨年和闰日按有效日期计算", () => {
    expect(projectDeadlineSummary("2026-11-13", new Date("2026-11-14T08:00:00Z"))).toEqual({ kind: "overdue", days: -1, label: "论文提交已逾期 1 天" });
    expect(projectDeadlineSummary("2027-01-01", new Date("2026-12-31T08:00:00Z")).days).toBe(1);
    expect(projectDeadlineSummary("2028-03-01", new Date("2028-02-28T08:00:00Z")).days).toBe(2);
    expect(projectDeadlineSummary("2028-02-29", new Date("2028-02-28T08:00:00Z")).days).toBe(1);
  });

  it("日期缺失、非法和时钟不可用都明确未知，不写死倒计时", () => {
    expect(projectDeadlineSummary("").label).toBe("提交日期未设置");
    for (const value of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-1-1", "0000-01-01", "44"])
      expect(projectDeadlineSummary(value)).toEqual({ kind: "unknown", days: null, label: "提交日期待核对" });
    expect(projectDeadlineSummary("2026-11-14", new Date("bad"))).toEqual({ kind: "unknown", days: null, label: "当前日期不可用" });
  });

  it("仅使用绑定流程的快照，不随配置草稿或更新版跳阶段", () => {
    const state = createSettingsState();
    const original = structuredClone(state.workflowHistory);
    state.stages[2]!.name = "修改后的未绑定名称";
    state.workflowHistory.push({ version: 2, at: "新版本", stages: structuredClone(state.stages) });
    const progress = projectStageProgress(state.workflowHistory, 1, "论文撰写");
    expect(progress.known).toBe(true);
    expect(progress.currentIndex).toBe(2);
    expect(progress.stages.map((stage) => stage.state)).toEqual(["upcoming", "upcoming", "current", "upcoming", "upcoming", "upcoming"]);
    const confirmed = projectStageProgress(state.workflowHistory, 1, "论文撰写", [original[0]!.stages[0]!.id]);
    expect(confirmed.stages[0]!.state).toBe("done");
    expect(confirmed.stages[1]!.state).toBe("upcoming");
    expect(progress.stages[2]!.name).toBe("论文撰写");
    expect(state.workflowHistory[0]).toEqual(original[0]);
  });

  it("未知或停用当前阶段不误显示第一个阶段为当前", () => {
    const state = createSettingsState();
    const missing = projectStageProgress(state.workflowHistory, 1, "不存在的阶段");
    expect(missing.known).toBe(false);
    expect(missing.currentIndex).toBe(-1);
    expect(missing.stages.every((stage) => stage.state === "upcoming")).toBe(true);
    state.workflowHistory[0]!.stages[2]!.enabled = false;
    const disabled = projectStageProgress(state.workflowHistory, 1, "论文撰写");
    expect(disabled.known).toBe(false);
    expect(disabled.stages).toHaveLength(5);
    expect(disabled.stages.some((stage) => stage.state === "current" || stage.state === "done")).toBe(false);
  });

  it("未绑定、丢失快照及空流程都不能视作全部完成", () => {
    const state = createSettingsState();
    expect(projectStageProgress(state.workflowHistory, 0, "开题").issue).toBe("尚未绑定毕设流程");
    expect(projectStageProgress(state.workflowHistory, 99, "开题")).toMatchObject({ known: false, currentIndex: -1, stages: [] });
    for (const stage of state.workflowHistory[0]!.stages) stage.enabled = false;
    expect(projectStageProgress(state.workflowHistory, 1, "结束")).toMatchObject({
      known: false,
      currentIndex: -1,
      stages: [],
      issue: "绑定流程没有启用的阶段",
    });
  });

  it("真实最后阶段保持当前，查看不会修改项目状态或伪造确认", () => {
    const state = createSettingsState();
    const before = JSON.stringify(state);
    const progress = projectStageProgress(state.workflowHistory, 1, "结束");
    expect(progress.stages.at(-1)?.state).toBe("current");
    expect(progress.known).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("保存时间只来自实际记录，初始预览标记不伪装成时钟", () => {
    expect(savedClock("当前预览")).toBeUndefined();
    expect(savedClock("初始样例")).toBeUndefined();
    expect(savedClock("2026/11/14 18:32:05")).toBe("18:32");
    expect(savedClock("2026-11-14T09:05:00Z")).toBe("09:05");
    expect(savedClock("2026/11/14 25:65:00")).toBeUndefined();
  });

  it("时间比例来自起止日期，不借用任务完成比例", () => {
    expect(stageElapsed("2026-11-01", "2026-11-21", new Date("2026-11-11T08:00:00Z"))).toMatchObject({ known: true, percent: 50, elapsed: 10, total: 20 });
    expect(stageElapsed("2026-11-01", "2026-11-21", new Date("2026-11-23T08:00:00Z"))).toMatchObject({ known: true, percent: 100, label: "阶段已逾期 2 天" });
    expect(stageElapsed(undefined, "2026-11-21").known).toBe(false);
    expect(stageElapsed("2026-11-21", "2026-11-01").known).toBe(false);
  });

  it("按前置关系选择后续，不因显示重排跳到无关阶段或回退开题", () => {
    const stages = createSettingsState().stages;
    const current = stages[2]!;
    const reordered = [...stages].reverse();
    expect(availableNextStages(reordered, current.id, [stages[0]!.id, stages[1]!.id])[0]?.id).toBe(stages[3]!.id);
    expect(availableNextStages(stages, stages.at(-1)!.id, []).some((item) => item.id === stages[0]!.id)).toBe(false);
    const pending = stages[4]!;
    expect(availableNextStages(reordered, current.id, []).some((item) => item.id === pending.id)).toBe(false);
  });
});
