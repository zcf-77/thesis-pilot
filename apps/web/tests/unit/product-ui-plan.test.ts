import { describe, expect, it } from "vite-plus/test";
import { createServices } from "../../src/services/index.ts";
import type { TaskSummary } from "../../src/services/index.ts";
import { dependencyGap, evidenceGap, primaryTaskAction, reviewReasonLabel } from "../../src/workspace/tasks/taskBoard.ts";

function summary(patch: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    project_id: "00000000-0000-4000-8000-000000000010",
    title: "整理实验结果",
    status: "todo",
    archived: false,
    due_date: "2030-06-12",
    needs_review: false,
    review_reasons: [],
    position: 0,
    updated_at: "2030-06-10T00:00:00Z",
    version: 1,
    ...patch,
  };
}

describe("计划页产品级任务动作与缺口", () => {
  it("开始只进入进行中，核验与确认记录保持不同的学生操作入口", () => {
    expect(primaryTaskAction(summary({ needs_review: true, review_reasons: ["缺少产物证据"] }))).toEqual({ action: "start", label: "开始" });
    expect(primaryTaskAction(summary({ status: "doing", needs_review: true }))).toEqual({ action: "review", label: "处理缺口" });
    expect(primaryTaskAction(summary({ status: "verify" }))).toEqual({ action: "review", label: "去核验" });
    expect(primaryTaskAction(summary({ status: "confirmed" }))).toEqual({ action: "history", label: "确认记录" });
    expect(primaryTaskAction(summary({ status: "confirmed", needs_review: true }))).toEqual({ action: "review", label: "复核" });
    expect(primaryTaskAction(summary({ archived: true, status: "confirmed" }))).toEqual({ action: "open", label: "查看" });
  });

  it("前置和证据缺口兼容服务代码与中文原因，其他复核原因不误报成缺证据", () => {
    const task = summary({
      depends_on: ["predecessor"],
      needs_review: true,
      review_reasons: ["依赖任务待确认或已变化", "产物证据版本已变化"],
    });
    expect(dependencyGap(task)).toEqual({ blocked: true, label: "1 项前置未就绪" });
    expect(evidenceGap(task)).toBe("证据待复核");
    expect(dependencyGap(summary({ depends_on: ["predecessor"], review_reasons: ["dependency_unconfirmed"] })).blocked).toBe(true);
    expect(evidenceGap(summary({ review_reasons: ["evidence_missing"] }))).toBe("缺少证据");
    expect(evidenceGap(summary({ review_reasons: ["evidence_stale"] }))).toBe("证据待复核");
    expect(reviewReasonLabel("evidence_missing")).toBe("缺少产物证据");
    expect(reviewReasonLabel("尚未判定的其他原因")).toBe("尚未判定的其他原因");
    expect(evidenceGap(summary({ needs_review: true, review_reasons: ["关联章节版本已变化"] }))).toBe("");
    expect(dependencyGap(summary())).toEqual({ blocked: false, label: "无前置" });
  });

  it("Mock 服务中开始任务不会自动确认，缺证据仍由服务端阻止完成且不生成计划版本", async () => {
    const services = createServices({ mode: "mock", instanceId: `product-plan-${crypto.randomUUID()}` });
    const project = await services.projects.create({ name: "合成计划页回归", deadline: "2030-06-30" });
    const created = await services.tasks.create(project.id, {
      command_id: crypto.randomUUID(),
      expected_board_version: 0,
      content: { title: "核对合成结果", acceptance: "关联可核对的产物", start_date: "2030-06-10", due_date: "2030-06-12" },
    });
    expect(created.status).toBe("todo");
    expect(created.needs_review).toBe(true);

    const doing = await services.tasks.update(project.id, created.id, {
      command_id: crypto.randomUUID(),
      expected_version: created.version,
      content: { ...created.content, status: "doing" },
    });
    expect(doing.status).toBe("doing");
    expect(doing.status).not.toBe("confirmed");
    await expect(
      services.tasks.decide(project.id, created.id, { command_id: crypto.randomUUID(), expected_version: doing.version, action: "confirm" }),
    ).rejects.toMatchObject({ code: "TASK_EVIDENCE_STALE" });

    const current = await services.tasks.get(project.id, created.id);
    expect(current.status).toBe("doing");
    expect(current.review_reasons).toContain("evidence_missing");
    expect(current.review_reasons.map(reviewReasonLabel)).toContain("缺少产物证据");
    expect((await services.plans.get(project.id)).plan_version).toBe(0);
    expect((await services.tasks.versions(project.id, created.id)).items.map((entry) => entry.action)).toEqual(["edit", "create"]);
  });
});
