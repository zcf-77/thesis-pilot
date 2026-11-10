/**
 * 令牌生成器：src/design/tokens/*.ts（单一事实来源）→
 *   1. src/design/styles/generated/themes.css   daisyUI 主题块 + --tp-* 语义变量（应用内使用）
 *   2. tokens/tokens.css                         不依赖 Tailwind / daisyUI 的独立变量表
 *   3. tokens/thesispilot.tokens.json            W3C Design Tokens 风格 JSON（设计工具 / 其他端）
 *   4. docs/design/contrast-report.md            对比度契约的实际计算结果
 * 运行：node scripts/build-tokens.ts   （Node ≥ 23.6 原生执行 TS）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bestOn,
  breakpoints,
  colorTokens,
  contrast,
  contrastPairs,
  defaultTheme,
  durations,
  layers,
  spacing,
  springToLinear,
  themeList,
  typeScale,
  varTokens,
  type ColorToken,
  type ThemeDef,
  type VarToken,
} from "../src/design/tokens/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = (rel: string, content: string) => {
  const file = resolve(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log("  wrote", rel, "(" + content.length + " bytes)");
};

const solid = (t: ThemeDef, key: ColorToken) => t.contrastAs?.[key] ?? t.color[key];

function tpVars(t: ThemeDef): string[] {
  const lines: string[] = [];
  lines.push("color-scheme: " + t.mode + ";");
  for (const key of Object.keys(colorTokens) as ColorToken[]) lines.push("--tp-" + key + ": " + t.color[key] + ";");
  for (const key of Object.keys(varTokens) as VarToken[]) lines.push("--tp-" + key + ": " + t.vars[key] + ";");
  for (const d of durations) lines.push("--tp-dur-" + d.id + ": " + Math.round(d.ms * t.durScale) + "ms;");
  const sp = springToLinear(t.spring);
  lines.push("--tp-ease-spring: " + sp.easing + ";");
  lines.push("--tp-dur-spring: " + Math.round(sp.ms * t.durScale) + "ms;");
  return lines;
}

function daisyBlock(t: ThemeDef): string {
  const c = (k: ColorToken) => solid(t, k);
  const pairs: [string, string][] = [
    ["name", '"' + t.id + '"'],
    ["default", String(t.id === defaultTheme)],
    ["prefersdark", "false"],
    ["color-scheme", t.mode],
    ["--color-base-100", c("surface")],
    ["--color-base-200", c("canvas")],
    ["--color-base-300", c("surface-sunken")],
    ["--color-base-content", c("text")],
    ["--color-primary", c("action")],
    ["--color-primary-content", c("action-content")],
    ["--color-secondary", c("pencil")],
    ["--color-secondary-content", bestOn(c("pencil"))],
    ["--color-accent", c("accent")],
    ["--color-accent-content", bestOn(c("accent"))],
    ["--color-neutral", c("surface-inverse")],
    ["--color-neutral-content", c("text-inverse")],
    ["--color-info", c("info")],
    ["--color-info-content", bestOn(c("info"))],
    ["--color-success", c("success")],
    ["--color-success-content", bestOn(c("success"))],
    ["--color-warning", c("warning")],
    ["--color-warning-content", bestOn(c("warning"))],
    ["--color-error", c("danger")],
    ["--color-error-content", bestOn(c("danger"))],
    ["--radius-selector", t.vars["radius-s"]],
    ["--radius-field", t.vars["radius-s"]],
    ["--radius-box", t.vars["radius-m"]],
    ["--size-selector", "0.25rem"],
    ["--size-field", "0.25rem"],
    ["--border", t.vars["border-w"]],
    ["--depth", String(t.daisy.depth)],
    ["--noise", String(t.daisy.noise)],
  ];
  return '@plugin "daisyui/theme" {\n' + pairs.map(([k, v]) => "  " + k + ": " + v + ";").join("\n") + "\n}";
}

const banner = "/* 由 scripts/build-tokens.ts 生成，请勿手改；修改 src/design/tokens/themes.ts 后重新生成。 */\n";

function selector(t: ThemeDef) {
  return (t.id === defaultTheme ? ":root, " : "") + '[data-theme="' + t.id + '"]';
}

// 1. 应用内：daisyUI 主题 + tp 变量
out(
  "src/design/styles/generated/themes.css",
  banner +
    themeList
      .map(
        (t) =>
          "\n/* ═══ " +
          t.name +
          " · " +
          t.en +
          " ═══ */\n" +
          daisyBlock(t) +
          "\n\n" +
          selector(t) +
          " {\n" +
          tpVars(t)
            .map((l) => "  " + l)
            .join("\n") +
          "\n}\n",
      )
      .join(""),
);

// 2. 独立 CSS
out(
  "tokens/tokens.css",
  banner +
    "/* 毕设智途 ThesisPilot · 设计令牌（独立版，无构建依赖）。在根元素设置 data-theme 切换方案。 */\n" +
    themeList
      .map(
        (t) =>
          "\n/* " +
          t.name +
          " · " +
          t.en +
          " · " +
          t.mode +
          " */\n" +
          selector(t) +
          " {\n" +
          tpVars(t)
            .map((l) => "  " + l)
            .join("\n") +
          "\n}\n",
      )
      .join(""),
);

// 3. JSON（W3C Design Tokens 风格）
const typeOfVar = (key: VarToken): string => {
  if (key.startsWith("font-")) return "fontFamily";
  if (key.startsWith("radius-") || key === "border-w") return "dimension";
  if (key.startsWith("shadow-")) return "shadow";
  if (key.startsWith("ease-")) return "cubicBezier";
  if (key.endsWith("-weight")) return "fontWeight";
  return "string";
};
const json = {
  $description: "毕设智途 ThesisPilot 设计令牌。theme.<id> 下的键与 CSS 变量 --tp-<key> 一一对应。",
  $generated: "scripts/build-tokens.ts",
  shared: {
    typeScale: Object.fromEntries(
      typeScale.map((s) => [
        s.id,
        {
          $type: "typography",
          $value: { fontSize: s.size + "px", lineHeight: s.line, fontFamily: "{font-" + s.family + "}" },
          $description: s.label + " — " + s.use,
        },
      ]),
    ),
    spacing: Object.fromEntries(spacing.map((s) => [s.id, { $type: "dimension", $value: s.px + "px", $description: s.use }])),
    layer: Object.fromEntries(layers.map((l) => [l.id, { $type: "number", $value: l.z, $description: l.label + " — " + l.what }])),
    duration: Object.fromEntries(durations.map((d) => [d.id, { $type: "duration", $value: d.ms + "ms", $description: d.use }])),
    breakpoint: Object.fromEntries(breakpoints.map((b) => [b.id, { $type: "dimension", $value: b.min + "px", $description: b.note }])),
  },
  theme: Object.fromEntries(
    themeList.map((t) => {
      const sp = springToLinear(t.spring);
      return [
        t.id,
        {
          $description: t.name + " · " + t.en + " — " + t.tagline,
          mode: { $type: "string", $value: t.mode },
          iconWeight: { $type: "string", $value: t.icon },
          color: Object.fromEntries(
            (Object.keys(colorTokens) as ColorToken[]).map((k) => [
              k,
              { $type: "color", $value: t.color[k], $description: colorTokens[k].group + " / " + colorTokens[k].label + " — " + colorTokens[k].use },
            ]),
          ),
          var: Object.fromEntries(
            (Object.keys(varTokens) as VarToken[]).map((k) => [
              k,
              { $type: typeOfVar(k), $value: t.vars[k], $description: varTokens[k].group + " / " + varTokens[k].label + " — " + varTokens[k].use },
            ]),
          ),
          motion: {
            durScale: { $type: "number", $value: t.durScale },
            spring: { $type: "string", $value: sp.easing, $description: "阻尼比 ζ=" + sp.zeta + "，时长 " + Math.round(sp.ms * t.durScale) + "ms" },
            duration: Object.fromEntries(durations.map((d) => [d.id, { $type: "duration", $value: Math.round(d.ms * t.durScale) + "ms" }])),
          },
        },
      ];
    }),
  ),
};
out("tokens/thesispilot.tokens.json", JSON.stringify(json, null, 2) + "\n");

// 4. 对比度报告
let failures = 0;
let report = "# 对比度契约 · 实测报告\n\n由 `scripts/build-tokens.ts` 按 WCAG 2.x 相对亮度公式计算。半透明令牌按 `contrastAs` 给出的等效不透明色参与计算。\n\n";
for (const t of themeList) {
  report += "## " + t.name + " · " + t.en + "\n\n| 组合 | 前景 | 背景 | 实测 | 要求 | 结果 |\n|---|---|---|---:|---:|:---:|\n";
  for (const [fg, bg, min, note] of contrastPairs) {
    const ratio = contrast(solid(t, fg), solid(t, bg), solid(t, "canvas"));
    const ok = ratio >= min;
    if (!ok) failures++;
    report += "| " + note + " | `" + fg + "` | `" + bg + "` | " + ratio.toFixed(2) + " | " + min + " | " + (ok ? "通过" : "**未达标**") + " |\n";
  }
  report += "\n";
}
report += failures === 0 ? "全部 " + themeList.length * contrastPairs.length + " 组通过。\n" : "**未达标 " + failures + " 组**，需要调整令牌。\n";
out("docs/design/contrast-report.md", report);

for (const t of themeList) {
  const bad = contrastPairs
    .map(([fg, bg, min, note]) => ({ note, min, ratio: contrast(solid(t, fg), solid(t, bg), solid(t, "canvas")) }))
    .filter((p) => p.ratio < p.min);
  console.log(t.name.padEnd(6), bad.length === 0 ? "对比度全部通过" : bad.map((b) => b.note + " " + b.ratio.toFixed(2) + "<" + b.min).join("；"));
}
if (failures > 0) process.exitCode = 1;
