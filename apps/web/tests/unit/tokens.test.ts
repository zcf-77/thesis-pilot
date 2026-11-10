import { describe, expect, it } from "vite-plus/test";
import {
  colorTokens,
  contrast,
  contrastPairs,
  durations,
  parseColor,
  springToLinear,
  themeList,
  varTokens,
  type ColorToken,
  type VarToken,
} from "../../src/design/tokens/index.ts";

const colorKeys = Object.keys(colorTokens) as ColorToken[];
const varKeys = Object.keys(varTokens) as VarToken[];

describe("令牌契约", () => {
  it("四套方案提供完全相同的颜色与变量键，且没有空值", () => {
    expect(themeList).toHaveLength(4);
    for (const theme of themeList) {
      expect(Object.keys(theme.color).sort(), theme.name).toEqual([...colorKeys].sort());
      expect(Object.keys(theme.vars).sort(), theme.name).toEqual([...varKeys].sort());
      for (const key of colorKeys) expect(theme.color[key].trim(), theme.name + "." + key).not.toBe("");
      for (const key of varKeys) expect(theme.vars[key].trim(), theme.name + "." + key).not.toBe("");
    }
  });

  it("所有颜色取值都能被解析（十六进制或 rgba）", () => {
    for (const theme of themeList) {
      for (const key of colorKeys) {
        const c = parseColor(theme.color[key]);
        for (const channel of [c.r, c.g, c.b]) expect(channel, theme.name + "." + key).toBeGreaterThanOrEqual(0);
        expect(c.a, theme.name + "." + key).toBeGreaterThan(0);
      }
    }
  });

  it("半透明令牌必须声明等效不透明色，否则对比度无法计算", () => {
    const usedInPairs = new Set(contrastPairs.flatMap(([fg, bg]) => [fg, bg]));
    for (const theme of themeList) {
      for (const key of usedInPairs) {
        if (parseColor(theme.color[key]).a < 1) expect(theme.contrastAs?.[key], theme.name + "." + key).toBeDefined();
      }
    }
  });

  it("方案 id 唯一，且每套方案都有名称、标语与动效性格", () => {
    expect(new Set(themeList.map((t) => t.id)).size).toBe(themeList.length);
    for (const theme of themeList) {
      expect(theme.name.length).toBeGreaterThan(0);
      expect(theme.tagline.length).toBeGreaterThan(0);
      expect(theme.motionCharacter.length).toBeGreaterThan(0);
    }
  });
});

describe("对比度契约（WCAG 2.x）", () => {
  it("计算器与已知参考值一致", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrast("#767676", "#FFFFFF")).toBeCloseTo(4.54, 1);
  });

  for (const theme of themeList) {
    const solid = (key: ColorToken) => theme.contrastAs?.[key] ?? theme.color[key];
    it(theme.name + "：" + contrastPairs.length + " 组前景 / 背景全部达标", () => {
      const failures = contrastPairs
        .map(([fg, bg, min, note]) => ({ note, min, ratio: contrast(solid(fg), solid(bg), solid("canvas")) }))
        .filter((p) => p.ratio < p.min)
        .map((p) => p.note + " " + p.ratio.toFixed(2) + " < " + p.min);
      expect(failures).toEqual([]);
    });
  }

  it("印章与主行动在每套方案中都能和铅笔区分开（不是同一个颜色）", () => {
    for (const theme of themeList) {
      expect(theme.color.seal, theme.name).not.toBe(theme.color.pencil);
      expect(theme.color.action, theme.name).not.toBe(theme.color.pencil);
      expect(theme.color.seal, theme.name).not.toBe(theme.color.action);
    }
  });
});

describe("动效令牌", () => {
  it("时长阶梯严格递增", () => {
    const values = durations.map((d) => d.ms);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(new Set(values).size).toBe(values.length);
  });

  it("弹簧曲线从 0 出发、收敛到 1，时长在合理范围内", () => {
    for (const theme of themeList) {
      const spring = springToLinear(theme.spring);
      const points = spring.easing.slice("linear(".length, -1).split(",").map(Number);
      expect(points[0], theme.name).toBe(0);
      expect(points.at(-1), theme.name).toBe(1);
      expect(spring.ms, theme.name).toBeGreaterThanOrEqual(180);
      expect(spring.ms, theme.name).toBeLessThanOrEqual(1400);
      expect(Math.max(...points), theme.name).toBeLessThan(1.6);
    }
  });

  it("阻尼比决定是否回弹：荧光笔记有明显过冲，朱墨几乎没有", () => {
    const overshoot = (id: string) => {
      const theme = themeList.find((t) => t.id === id)!;
      return Math.max(...springToLinear(theme.spring).easing.slice(7, -1).split(",").map(Number)) - 1;
    };
    expect(overshoot("yingguang")).toBeGreaterThan(0.1);
    expect(overshoot("zhumo")).toBeLessThan(0.02);
  });
});
