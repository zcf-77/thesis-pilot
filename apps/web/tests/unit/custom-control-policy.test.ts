import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parse } from "vue/compiler-sfc";

// 用户长期要求：新增页面也不能重新引入浏览器默认控件外观。
const root = resolve("src");
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : entry.name.endsWith(".vue") ? [path] : [];
  });
}
const templates = files(root).map((path) => ({
  name: relative(root, path),
  text: (parse(readFileSync(path, "utf8"), { filename: path }).descriptor.template?.content ?? "").replace(/<!--[\s\S]*?-->/g, ""),
}));
const inputs = templates.flatMap(({ name, text }) => [...text.matchAll(/<input\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)].map(([tag]) => ({ name, tag })));
function classes(tag: string): string[] {
  return /\bclass="([^"]*)"/.exec(tag)?.[1]?.split(/\s+/) ?? [];
}

describe("自定义控件长期规则", () => {
  it("所有Vue页面及组件不再使用原生Select、进度和系统日期时间面板", () => {
    const violations = templates.flatMap(({ name, text }) =>
      /<(?:select|progress)\b/.test(text) || /<input\b(?:[^>"']|"[^"]*"|'[^']*')*\btype="(?:date|time|datetime-local|color)"/.test(text) ? [name] : [],
    );
    expect(violations, "请复用TpSelect、TpDatePicker或TpProgress，不允许恢复系统默认控件。").toEqual([]);
  });
  it("复选和单选保留语义同时必须有统一的自定义皮肤", () => {
    const violations = inputs.filter(({ tag }) => {
      if (/\btype="checkbox"/.test(tag)) return !classes(tag).some((name) => ["tp-checkbox", "checkbox", "toggle"].includes(name));
      if (/\btype="radio"/.test(tag)) return !classes(tag).includes("radio");
      return false;
    });
    expect(violations.map(({ name, tag }) => `${name}: ${tag}`)).toEqual([]);
  });
  it("文件选择只以统一自定义按钮呈现，数字输入采用移除系统步进器的样式", () => {
    const violations = inputs.filter(({ tag }) => {
      if (/\btype="file"/.test(tag)) return !classes(tag).some((name) => ["studio-file-input", "tp-file-control__input"].includes(name));
      if (/\btype="number"/.test(tag)) return !classes(tag).includes("tp-input");
      return false;
    });
    expect(violations.map(({ name, tag }) => `${name}: ${tag}`)).toEqual([]);
  });
});
