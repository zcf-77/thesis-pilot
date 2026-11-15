import { describe, expect, it } from "vite-plus/test";
import { cloneStages, flowDraftError, lines, newStage, projectBindingError, removeStage } from "../../src/workspace/projectLifecycle.ts";

const stage = () => ({ ...newStage(), deliverables: ["阶段文档"], conditions: ["学生确认"] });

describe("正式项目流程的依赖与版本绑定保护", () => {
  it("拒绝循环、自引用、悬空引用和重复标识", () => {
    const first = { ...stage(), name: "开题" };
    const second = { ...stage(), name: "初稿", dependencies: [first.id] };
    expect(flowDraftError("毕业设计", [first, second])).toBe("");
    expect(flowDraftError("毕业设计", [{ ...first, dependencies: [second.id] }, second])).toContain("循环");
    expect(flowDraftError("毕业设计", [{ ...first, dependencies: [first.id] }])).toContain("无效");
    expect(flowDraftError("毕业设计", [{ ...first, dependencies: ["missing"] }])).toContain("无效");
    expect(flowDraftError("毕业设计", [first, { ...second, id: first.id }])).toContain("重复");
  });

  it("移除阶段清理所有依赖且不改写原版本对象", () => {
    const first = { ...stage(), name: "开题" };
    const second = { ...stage(), name: "初稿", dependencies: [first.id], deliverables: ["初稿文档"] };
    const previous = [first, second];
    const next = removeStage(previous, first.id);
    expect(next).toHaveLength(1);
    expect(next[0]!.dependencies).toEqual([]);
    next[0]!.deliverables.push("实验记录");
    expect(previous[1]!.dependencies).toEqual([first.id]);
    expect(previous[1]!.deliverables).toEqual(["初稿文档"]);
  });

  it("项目只能绑定所选版本中的有效阶段", () => {
    const first = { ...stage(), name: "开题" };
    expect(projectBindingError("", "", [])).toBe("");
    expect(projectBindingError("", first.id, [first])).toContain("版本");
    expect(projectBindingError("immutable-v1", first.id, [first])).toBe("");
    expect(projectBindingError("immutable-v2", first.id, [])).toContain("有效阶段");
    expect(projectBindingError("immutable-v1", first.id, [{ ...first, enabled: false }])).toContain("有效阶段");
  });

  it("保留分支依赖图并拒绝倒置日期与空名称", () => {
    const first = { ...stage(), name: "开题", start: "2026-11-17", deadline: "2026-11-18" };
    const second = { ...stage(), name: "初稿", dependencies: [first.id] };
    const third = { ...stage(), name: "实验", dependencies: [first.id] };
    const fourth = { ...stage(), name: "评审", dependencies: [second.id, third.id] };
    expect(flowDraftError("毕业设计", cloneStages([first, second, third, fourth]))).toBe("");
    expect(flowDraftError("毕业设计", [{ ...first, deadline: "2026-11-16" }])).toContain("截止日期");
    expect(flowDraftError("", [first])).toContain("流程名称");
    expect(flowDraftError("毕业设计", [{ ...first, name: " " }])).toContain("阶段");
    expect(flowDraftError("毕业设计", [])).toContain("至少");
  });

  it("多行交付物删除空行、保留实际条目", () => {
    expect(lines("  初稿\r\n\r\n 实验报告 \n")).toEqual(["初稿", "实验报告"]);
  });

  it("补全接口可选阶段字段，不把省略的启用状态误判为停用", () => {
    const input = { id: "stage-1", name: "开题", deliverables: ["报告"], conditions: ["学生确认"] };
    const normalized = cloneStages([input]);
    expect(normalized[0]).toMatchObject({ enabled: true, dependencies: [], description: "", start: null, deadline: null });
    expect(projectBindingError("version-1", input.id, [input])).toBe("");
    expect(flowDraftError("毕业设计", normalized)).toBe("");
  });

  it("启用阶段必须具有交付要求且不能依赖停用或更晚截止的阶段", () => {
    const first = { ...stage(), name: "开题", deadline: "2026-11-19" };
    const second = { ...stage(), name: "初稿", dependencies: [first.id], deadline: "2026-11-18" };
    expect(flowDraftError("毕业设计", [{ ...first, deliverables: [] }])).toContain("交付物");
    expect(flowDraftError("毕业设计", [{ ...first, enabled: false }])).toContain("至少保留");
    expect(flowDraftError("毕业设计", [first, { ...second, name: first.name }])).toContain("名称不能重复");
    expect(flowDraftError("毕业设计", [{ ...first, enabled: false }, second])).toContain("依赖已停用");
    expect(flowDraftError("毕业设计", [first, second])).toContain("早于前置阶段");
  });
});
