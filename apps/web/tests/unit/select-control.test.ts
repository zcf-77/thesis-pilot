import { describe, expect, it } from "vite-plus/test";
import {
  filterSelectOptions,
  nextSelectIndex,
  selectPopoverPosition,
  typeaheadSelectIndex,
  selectPresenceTransition,
  selectMotionPlan,
  type SelectOption,
  type SelectPresence,
} from "../../src/components/ui/selectControl.ts";

const options: SelectOption[] = [
  { value: "all", label: "全部资料" },
  { value: "archived", label: "历史版本", disabled: true },
  { value: 2, label: "要求 v2", description: "当前绑定", group: "论文要求" },
  { value: "3", label: "要求 v3", description: "尚未绑定", group: "论文要求" },
];

describe("自定义选择框的导航与浮层约束", () => {
  it("关闭期间保留可绘制层，动画完成才隐藏；快速重开拒绝旧离场完成", () => {
    let state: SelectPresence = { run: 0, phase: "hidden" };
    state = selectPresenceTransition(state, "open");
    state = selectPresenceTransition(state, { complete: state.run });
    expect(state.phase).toBe("shown");
    state = selectPresenceTransition(state, "close");
    const exitingRun = state.run;
    expect(state.phase).toBe("leaving");
    state = selectPresenceTransition(state, "open");
    state = selectPresenceTransition(state, { complete: exitingRun });
    expect(state.phase).toBe("entering");
    state = selectPresenceTransition(state, { complete: state.run });
    expect(state.phase).toBe("shown");
    state = selectPresenceTransition(state, "close");
    state = selectPresenceTransition(state, { complete: state.run });
    expect(state.phase).toBe("hidden");
  });
  it("组件销毁后到达的入场完成不能恢复浮层", () => {
    const entering = selectPresenceTransition({ run: 0, phase: "hidden" }, "open");
    const destroyed = selectPresenceTransition(entering, "destroy");
    expect(selectPresenceTransition(destroyed, { complete: entering.run }).phase).toBe("hidden");
  });
  it("完整动效使用主题时长/曲线/形态，打断时承接当前视觉", () => {
    const style = { duration: "0.18s", easing: "cubic-bezier(0.2, 0, 0, 1)", enterTransform: "translateY(8px) scale(0.98)", enterFilter: "blur(2px)" };
    const enter = selectMotionPlan("enter", style, false);
    expect(enter.timing.duration).toBe(180);
    expect(enter.timing.easing).toBe(style.easing);
    expect(enter.frames[0]).toMatchObject({ opacity: "0", transform: style.enterTransform, filter: "blur(2px)" });
    const leave = selectMotionPlan("leave", { ...style, duration: "120ms" }, false, { opacity: "0.6", transform: "matrix(1,0,0,1,0,2)", filter: "none" });
    expect(leave.frames[0]?.opacity).toBe("0.6");
    expect(leave.frames[1]?.opacity).toBe("0");
    expect(leave.timing.duration).toBe(120);
  });
  it("减弱动效严格限定120ms内且只改变透明度", () => {
    const plan = selectMotionPlan("leave", { duration: "360ms", easing: "ease", enterTransform: "scale(0.9)", enterFilter: "blur(6px)" }, true);
    expect(plan.timing.duration).toBe(120);
    expect(plan.timing.easing).toBe("linear");
    for (const frame of plan.frames) {
      expect(frame).not.toHaveProperty("transform");
      expect(frame).not.toHaveProperty("filter");
    }
  });
  it("上下方向跳过禁用项，边界循环，全部禁用时不产生可提交项", () => {
    expect(nextSelectIndex(options, 0, 1)).toBe(2);
    expect(nextSelectIndex(options, 2, -1)).toBe(0);
    expect(nextSelectIndex(options, 3, 1)).toBe(0);
    expect(nextSelectIndex(options, 0, -1)).toBe(3);
    expect(nextSelectIndex([], -1, 1)).toBe(-1);
    expect(nextSelectIndex([{ value: "x", label: "不可用", disabled: true }], -1, 1)).toBe(-1);
  });
  it("搜索可匹配描述和分组，保留数字版本和禁用状态且不修改输入", () => {
    const before = JSON.stringify(options);
    expect(filterSelectOptions(options, "论文要求 当前绑定")).toEqual([options[2]]);
    expect(filterSelectOptions(options, "V3")[0]?.value).toBe("3");
    expect(filterSelectOptions(options, "v2")[0]?.value).toBe(2);
    expect(filterSelectOptions(options, "不存在")).toEqual([]);
    expect(filterSelectOptions(options, "历史")[0]?.disabled).toBe(true);
    expect(JSON.stringify(options)).toBe(before);
  });
  it("文字定位按当前选项之后寻找并跳过不可选项", () => {
    expect(typeaheadSelectIndex(options, "要求", 0)).toBe(2);
    expect(typeaheadSelectIndex(options, "要求", 2)).toBe(3);
    expect(typeaheadSelectIndex(options, "要求", 3)).toBe(2);
    expect(typeaheadSelectIndex(options, "历史", 0)).toBe(-1);
  });
  it("窄屏右侧控件不会把面板推离可视区域", () => {
    const position = selectPopoverPosition({ left: 310, top: 140, bottom: 178, width: 100 }, { width: 390, height: 844 }, 320);
    expect(position.left).toBeGreaterThanOrEqual(12);
    expect(position.left + position.width).toBeLessThanOrEqual(378);
    expect(position.top).toBe(185);
    expect(position.side).toBe("bottom");
  });
  it("页底弹层向上展开并限制高度，保持在视口内", () => {
    const position = selectPopoverPosition({ left: 20, top: 760, bottom: 798, width: 350 }, { width: 390, height: 844 }, 900);
    expect(position.side).toBe("top");
    expect(position.maxHeight).toBeLessThanOrEqual(392);
    expect(position.top).toBeGreaterThanOrEqual(12);
    expect(position.top + position.maxHeight).toBeLessThan(760);
  });
  it("短视口优先较大一侧，小列表无需占满整屏", () => {
    const position = selectPopoverPosition({ left: 10, top: 70, bottom: 108, width: 500 }, { width: 320, height: 240 }, 76);
    expect(position.width).toBe(296);
    expect(position.side).toBe("bottom");
    expect(position.top + 76).toBeLessThanOrEqual(228);
  });
});
