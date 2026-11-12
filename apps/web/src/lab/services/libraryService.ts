import type { RequirementView } from "../../domain/types.ts";
import type { LibraryMaterial, LibraryRequirement, LibraryState, TemplateItem } from "../state/libraryState.ts";

export type LibraryRuleType = "characters" | "references" | "recentReferences" | "chapters" | "headings" | "format" | "semantic";
export function libraryPlainText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(?:p|h[1-6]|li|tr|div)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const n = code[0]?.toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "�";
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, key: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[key] ?? "");
}
export function libraryBodyText(html: string) {
  return libraryPlainText(
    html
      .replace(/<(table|figure)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<h[1-6][^>]*>\s*(?:\d*[.、\s]*)?参考文献\s*<\/h[1-6]>[\s\S]*$/i, "")
      .replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, ""),
  );
}
function countTextCharacters(text: string) {
  let count = 0;
  for (const character of text) if (!/\s/.test(character)) count += 1;
  return count;
}
export function thesisWordCount(html: string) {
  return countTextCharacters(libraryBodyText(html));
}
export function wordTarget(requirements: LibraryRequirement[]): { target: number | null; reason: string } {
  const candidates = requirements.filter((x) => x.enabled && x.sourceMaterialId && inferRuleType(x) === "characters" && !x.scope.includes("摘要"));
  if (!candidates.length) return { target: null, reason: "没有已绑定的正文字数规则" };
  const ranges = candidates.map((x) => ruleBounds(x.param ?? ""));
  if (candidates.some((x) => /⟂/.test(x.param ?? "")) || ranges.some((x) => !x)) return { target: null, reason: "字数参数未知或冲突" };
  const min = Math.max(...ranges.map((x) => x!.min));
  const max = Math.min(...ranges.map((x) => x!.max));
  if (min > max) return { target: null, reason: "字数规则相互冲突" };
  return { target: min > 0 ? min : Number.isFinite(max) ? max : null, reason: "不含标题、表格、图示与参考文献章节；按非空白字符计数" };
}
export function inferRuleType(item: Pick<LibraryRequirement, "kind" | "category" | "text" | "scope" | "ruleType">): LibraryRuleType {
  if (item.kind === "semantic") return "semantic";
  if (item.ruleType && item.ruleType !== "semantic") return item.ruleType;
  if (/近.{0,3}年|年份|占比/.test(item.text)) return "recentReferences";
  if (/参考文献|引用数量|文献数量/.test(item.text)) return "references";
  if (/字数|字符/.test(item.text) || item.category === "字数") return "characters";
  if (/章节数量|至少.{0,4}章|不少于.{0,4}章/.test(item.text)) return "chapters";
  if (/标题层级|标题结构/.test(item.text)) return "headings";
  return item.category === "格式" ? "format" : "semantic";
}
export function ruleBounds(param: string): { min: number; max: number } | null {
  const normalized = param.replace(/,/g, "").trim();
  const range = /(\d+(?:\.\d+)?)\s*[–—~至-]\s*(\d+(?:\.\d+)?)/.exec(normalized);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const min = /(?:≥|>=|不少于|不低于|至少)\s*(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)(%?)/.exec(normalized);
  const max = /(?:≤|<=|不超过|不多于|至多)\s*(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)(%?)/.exec(normalized);
  const numeric = (m: RegExpExecArray) => {
    const [a, b] = m[1]!.split("/").map(Number);
    return (b ? a! / b : a!) / (m[2] ? 100 : 1);
  };
  if (min || max) return { min: min ? numeric(min) : 0, max: max ? numeric(max) : Infinity };
  return null;
}
export function parseLibraryText(text: string, template = false) {
  const lines = text
    .split(/\r?\n/)
    .map((value, index) => ({ line: index + 1, text: value.trim() }))
    .filter((x) => x.text);
  const fragments = lines.map((x) => ({ ...x, id: `line-${x.line}` }));
  const fields: [string, RegExp][] = [
    ["标题层级", /标题层级|一级标题.*二级标题/],
    ["一级标题", /一级标题[：:]/],
    ["字体字号", /字体|字号/],
    ["段落", /段落|首行缩进/],
    ["页边距", /页边距/],
    ["页眉页脚", /页眉|页脚/],
    ["目录域", /目录域/],
  ];
  const templateItems: TemplateItem[] = template
    ? fields.map(([name, regex]) => {
        const found = lines.filter((x) => regex.test(x.text) && !/未识别|未知|无法/.test(x.text));
        const values = [...new Set(found.map((x) => x.text.replace(/^.*?[：:]/, "").trim()))];
        return {
          name,
          value: values.join(" / ") || "未知",
          source: found.map((x) => `第${x.line}行`).join("、"),
          state: values.length > 1 ? "conflict" : values.length ? "identified" : "unknown",
          support:
            values.length > 1
              ? "来源多值冲突，需纠正"
              : values.length
                ? name === "标题层级"
                  ? "支持标题结构规范化候选"
                  : "已提取；此格式尚不支持自动应用"
                : "未识别，可按原件补充",
        };
      })
    : [];
  return { fragments, templateItems, recognized: fragments.length, unknown: templateItems.filter((x) => x.state !== "identified").length };
}
export function extractLibraryRequirements(material: LibraryMaterial, version: number, text: string): LibraryRequirement[] {
  const entries = text
    .split(/\r?\n/)
    .flatMap((line, index) => line.split(/[；;。]|，(?=近|引用|参考文献|摘要|正文)/).map((t) => ({ text: t.trim(), line: index + 1 })))
    .filter((x) => /不少于|不超过|不低于|至少|必须|应|须|字数|标题.*[：:]|页边距|[≥≤]/.test(x.text));
  return entries.map((entry) => {
    const text = entry.text;
    const semantic = !/\d|[≥≤]|标题层级|三分之一|百分之/.test(text);
    const scope = /摘要/.test(text) ? "摘要" : /一级标题/.test(text) ? "一级标题" : "整篇论文";
    const category = /字数|字符/.test(text) ? "字数" : /文献|引用|近.{0,3}年/.test(text) ? "引用" : /标题|页边距|字号|段落/.test(text) ? "格式" : "内容";
    const param = text
      .replace(/三分之一/g, "1/3")
      .replace(/不少于|不低于|至少/g, "≥ ")
      .replace(/不超过|不多于|至多/g, "≤ ");
    const item: LibraryRequirement = {
      id: `R-${crypto.randomUUID().slice(0, 8)}`,
      text,
      original: text,
      kind: semantic ? "semantic" : "hard",
      category,
      param,
      source: `${material.name} · 第${entry.line}行`,
      sourceMaterialId: material.id,
      sourceVersion: version,
      position: `第${entry.line}行`,
      scope,
      strictness: semantic ? "建议" : "硬性",
      enabled: false,
      version: 1,
      verdict: "unknown",
      verdictNote: "文本规则提取预览，核对并启用后参与检查。",
      history: [{ version: 1, at: new Date().toLocaleString("zh-CN"), text, param, enabled: false, reason: "从原文逐条提取" }],
    };
    item.ruleType = inferRuleType(item);
    return item;
  });
}
function requirementConflict(item: LibraryRequirement, state?: LibraryState) {
  if (/⟂|互相矛盾/.test(item.param ?? "")) return "同一参数包含相互矛盾的标准，请明确适用值。";
  const range = ruleBounds(item.param ?? "");
  if (!range) return "";
  if (range.min > range.max) return "参数下限大于上限。";
  const type = inferRuleType(item);
  const peer = state?.requirements.find((x) => {
    if (x.id === item.id || !x.enabled || x.scope !== item.scope || inferRuleType(x) !== type) return false;
    const other = ruleBounds(x.param ?? "");
    return other && Math.max(other.min, range.min) > Math.min(other.max, range.max);
  });
  return peer ? `与 ${peer.id} 的适用范围/参数冲突：${peer.param}。请纠正或明确停用其中一条。` : "";
}
export function evaluateLibraryRequirement(item: LibraryRequirement, html: string, state?: LibraryState, documentVersion?: number): RequirementView {
  const result = (verdict: RequirementView["verdict"], verdictNote: string): RequirementView => ({ ...item, verdict, verdictNote });
  if (!item.enabled) return result("unknown", "已停用；保留历史依据，不参与当前检查。");
  const material = state?.materials.find((x) => x.id === item.sourceMaterialId);
  if (!item.sourceMaterialId || (state && !material?.versions.some((v) => v.version === item.sourceVersion)))
    return result("nosource", "来源资料或指定版本不存在，暂不执行；请编辑要求补充正确来源。");
  const conflict = requirementConflict(item, state);
  if (conflict) return result("conflict", conflict);
  const type = inferRuleType(item);
  if (type === "semantic") {
    const run = state?.semanticChecks?.[item.id];
    if (!run) return result("unknown", "尚未进行语义预览；可运行带正文依据的本地模拟判断。");
    if (run.requirementVersion !== item.version || (documentVersion !== undefined && run.inputVersion !== documentVersion))
      return result("unknown", `预览基于旧正文 v${run.inputVersion} / 要求 v${run.requirementVersion}，请重新执行。`);
    return result(run.status === "done" && run.evidence.length ? "advice" : "unknown", run.explanation);
  }
  if (type === "format") return result("unknown", "支持范围之外的字号、页边距等格式无法由当前编辑结构确认；保留为未检查。");
  if (type === "headings") {
    const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
    const valid = levels.length > 0 && levels.every((n, i) => i === 0 || n <= levels[i - 1]! + 1);
    return result(valid ? "pass" : "fail", `${levels.length}个标题；${valid ? "没有跨级" : "存在标题跨级或没有标题"}，只检查结构，不检查字号。`);
  }
  const bound = ruleBounds(type === "recentReferences" ? (item.param ?? "").split(/近.{0,3}年/).at(-1)! : (item.param ?? ""));
  if (!bound) return result("unknown", "尚无可执行数值参数；请填写 ≥ 数字、≤ 数字或最小值–最大值。");
  let count = 0;
  let unit = "";
  if (type === "characters") {
    let text = libraryBodyText(html);
    if (item.scope.includes("摘要")) {
      const match = /<h[1-6][^>]*>\s*摘要\s*<\/h[1-6]>([\s\S]*?)(?=<h[1-6]\b|$)/i.exec(html);
      if (!match) return result("unknown", "没有可定位的摘要章节，不能用全文字数替代。");
      text = libraryPlainText(match[1]!);
    }
    count = countTextCharacters(text);
    unit = "字符（剔除标题/表格/图示及参考文献章节）";
  } else if (type === "chapters") {
    count = [...html.matchAll(/<h2\b/gi)].length;
    unit = "个二级章节";
  } else {
    const section = /<h[1-6][^>]*>\s*(?:\d*[.、\s]*)?参考文献\s*<\/h[1-6]>([\s\S]*)$/i.exec(html)?.[1];
    if (!section) return result("unknown", "未找到参考文献章节，引用标记数量不能冒充文献篇数。");
    const entries = [...section.matchAll(/<(?:li|p)\b[^>]*>([\s\S]*?)<\/(?:li|p)>/gi)].map((m) => libraryPlainText(m[1]!).trim()).filter(Boolean);
    if (type === "references") {
      count = entries.length;
      unit = "条参考文献";
    } else {
      const years = entries.map((x) => /\b(19\d{2}|20\d{2})\b/.exec(x)?.[1]);
      if (!entries.length || years.some((y) => !y)) return result("unknown", "部分文献缺出版年份，不能计算近年占比。");
      const recentYears = Number(/近\s*(\d+)\s*年/.exec(item.text)?.[1] ?? 5);
      const year = new Date().getFullYear();
      const minimumReferences = /(?:≥|不少于|至少)\s*(\d+)\s*篇/.exec(item.param ?? "");
      if (minimumReferences && entries.length < Number(minimumReferences[1]))
        return result("fail", `当前 ${entries.length} 条参考文献，少于要求 ${minimumReferences[1]} 篇；近年占比需同时达标。`);
      count = years.filter((y) => Number(y) >= year - recentYears + 1 && Number(y) <= year).length / entries.length;
      unit = "近年文献占比";
    }
  }
  return result(
    count >= bound.min && count <= bound.max ? "pass" : "fail",
    `当前 ${type === "recentReferences" ? (count * 100).toFixed(1) + "%" : count} ${unit}；要求 ${item.param}。结果只覆盖此程序规则。`,
  );
}
export function semanticLibraryPreview(requirement: LibraryRequirement, html: string) {
  const paragraphs = libraryPlainText(html)
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
  const words = [...new Set(requirement.text.match(/[\u4e00-\u9fff]{2,4}/g) ?? [])];
  const relevant = paragraphs.filter((s) => words.some((w) => s.includes(w)) || /数据|实验|结果|来源|文献|结论/.test(s)).slice(0, 3);
  const evidence = relevant.length ? relevant : paragraphs.slice(0, 1);
  const supported = evidence.some((s) => /\d|\[\d+\]|来源/.test(s));
  return {
    evidence,
    explanation: !evidence.length
      ? "本地语义预览：正文内容不足，没有可引用片段，不能判定。"
      : `本地语义预览依据 ${evidence.length} 个正文片段：${supported ? "发现数字/引用或来源标记，建议核对其是否真正支撑结论。" : "未在这些片段发现数字、引用或来源标记，建议补充依据。"} 这是可审阅建议，不是学术合规结论。`,
  };
}
