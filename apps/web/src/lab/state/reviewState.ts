import type { IssueView, ScoreDimView } from "../../domain/types.ts";
import { usePreviewModule, usePreviewWorkspaceStore } from "./previewWorkspace.ts";
import { validateConfigSnapshot, type ConfigSnapshot } from "./settingsState.ts";
import { libraryPlainText } from "../services/libraryService.ts";

export interface ReviewInput {
  projectId: string;
  title: string;
  docVersion: number;
  templateVersion: number;
  requirementVersion: number;
  rubricVersion: number;
  scope: string;
  html: string;
  text: string;
  headings: string[];
  sectionId?: string;
  configSnapshot?: ConfigSnapshot[];
  requirementSnapshot?: {
    version: number;
    items: { id: string; text: string; param: string; kind: string; sourceMaterialId: string; sourceVersion: number; verdict?: string; note?: string }[];
  };
  templateSnapshot?: { materialId: string; version: number; title: string; items: { name: string; value: string; support: string }[] } | null;
}
export interface ReviewReport {
  id: string;
  at: string;
  input: ReviewInput;
  words: number;
  dims: ScoreDimView[];
  issues: IssueView[];
  unchecked: string[];
  partial: boolean;
}
export interface ReviewRun {
  id: string;
  input: ReviewInput;
  status: "queued" | "running" | "done" | "partial" | "failed" | "cancelled";
  scenario: "normal" | "partial" | "timeout";
  attempt: number;
  diagnosis: string;
  sourceId?: string;
}
export interface ReviewState {
  reports: ReviewReport[];
  selectedId: string;
  run: ReviewRun | null;
  runs?: ReviewRun[];
}

export interface ReviewSection {
  id: string;
  title: string;
  label: string;
  index: number;
}
/** Tiptap序列化标题的纯结构扫描；固定输入中保留偏移，不依赖浏览器DOM。 */
function reviewHeadingNodes(html: string) {
  return [...html.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi)].map((match) => {
    const attrs = match[2] ?? "";
    const attribute = (name: string) => {
      const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
      const value = pattern.exec(attrs);
      return value ? libraryPlainText(value[1] ?? value[2] ?? value[3] ?? "") : "";
    };
    return {
      level: Number(match[1]),
      title: libraryPlainText(match[3] ?? "").trim(),
      start: match.index!,
      storedId: attribute("data-chapter-id") || attribute("data-section-id") || attribute("id"),
    };
  });
}
export function reviewSectionOptions(html: string): ReviewSection[] {
  const headings = reviewHeadingNodes(html).filter((heading) => heading.level === 2 || heading.level === 3);
  const occurrences = new Map<string, number>();
  const usedIds = new Set<string>();
  return headings
    .map((heading, index) => {
      const occurrence = (occurrences.get(heading.title) ?? 0) + 1;
      occurrences.set(heading.title, occurrence);
      const storedId = heading.storedId || `section-${index}`;
      const id = usedIds.has(storedId) ? `${storedId}-${index}` : storedId;
      usedIds.add(id);
      return {
        id,
        title: heading.title,
        index,
        label: headings.filter((item) => item.title === heading.title).length > 1 ? `${heading.title}（第${occurrence}处）` : heading.title,
      };
    })
    .filter((heading) => heading.title);
}
export function reviewSections(html: string): string[] {
  return reviewSectionOptions(html).map((heading) => heading.label);
}
export function extractReviewScope(html: string, chapter: string): { html: string; text: string; headings: string[] } {
  if (chapter === "整篇论文") return { html, text: libraryPlainText(html), headings: reviewSections(html) };
  const option = reviewSectionOptions(html).find((item) => item.id === chapter || item.label === chapter);
  const all = reviewHeadingNodes(html);
  const heading = option ? all.filter((item) => item.level === 2 || item.level === 3)[option.index] : undefined;
  if (!heading) return { html: "", text: "", headings: [] };
  const next = all.find((item) => item.start > heading.start && item.level <= heading.level);
  const fragment = html.slice(heading.start, next?.start ?? html.length);
  return { html: fragment, text: libraryPlainText(fragment), headings: reviewSections(fragment) };
}

export function buildPreviewReport(input: ReviewInput, partial = false, at = new Date().toLocaleString("zh-CN")): ReviewReport {
  const words = input.text.replace(/\s/g, "").length;
  const hasCitation = /\[\d+(?:[,-]\d+)*\]/.test(input.text);
  const location = input.headings[0] ?? input.scope;
  const issues: IssueView[] = [];
  if (!input.headings.length)
    issues.push({
      id: "structure",
      severity: "major",
      title: "当前输入没有识别到章节标题",
      location: input.scope,
      basis: "输入中未找到二级或三级标题；这是结构扫描结果",
      suggestion: "在写作页设置章节标题，再按适用模板核对结构。",
    });
  if (!words)
    issues.push({
      id: "empty",
      severity: "major",
      title: "当前范围没有可评审文字",
      location: input.scope,
      basis: "本次固定输入为空",
      suggestion: "先撰写正文，或重新选择包含内容的范围。",
    });
  else
    issues.push({
      id: "argument",
      severity: "advice",
      title: "论证充分性仍需人工审阅",
      location,
      basis: `本次取得 ${words} 字，未调用语义评审模型`,
      suggestion: "结合项目要求核对研究问题、方法和结论之间的关系。字数本身不代表论文质量。",
    });
  if (!partial)
    issues.push({
      id: "citation",
      severity: "minor",
      title: hasCitation ? "已识别引文标记，来源尚未核验" : "当前范围未识别到数字式引文标记",
      location,
      basis: hasCitation ? "文字扫描识别到 [数字] 格式；未读取其对应全文" : "只检查了 [数字] 格式，不代表其他引用样式缺失",
      suggestion: "在资料空间核对文献来源和实际取得范围，再决定是否请求引用候选。",
    });
  return {
    id: crypto.randomUUID(),
    at,
    input: JSON.parse(JSON.stringify(input)) as ReviewInput,
    words,
    partial,
    dims: [
      { id: "structure", name: "结构可读性", score: input.headings.length ? 20 : 10, full: 25, note: "预览计分：有章节标题 20 分，无标题 10 分；仅演示量表" },
      { id: "argument", name: "论证与内容", score: null, full: 35, note: "未进行语义评审" },
      { id: "citation", name: "文献与依据", score: null, full: 25, note: "来源未核验" },
      { id: "format", name: "格式与表达", score: null, full: 15, note: "未验证完整排版" },
    ],
    issues,
    unchecked: [
      ...(!input.templateVersion ? ["项目尚未绑定模板，无法核对模板格式"] : []),
      ...(!input.requirementVersion ? ["项目尚未绑定论文要求，无法判定规范符合性"] : []),
      ...(partial ? ["本次模拟来源不可用，引用扫描未完成"] : []),
      ...(input.requirementSnapshot?.items
        .filter((item) => ["unknown", "nosource", "conflict"].includes(item.verdict ?? "unknown"))
        .map((item) => `${item.text}：${item.note ?? "不能判定"}`) ?? []),
      "论证严谨性与研究创新性",
      "实验数据、公式及研究结论真实性",
      "文献全文与页码对应关系",
      "DOCX 页边距、页眉页脚和最终排版",
    ],
  };
}

export function useReviewState() {
  const workspace = usePreviewWorkspaceStore();
  return usePreviewModule<ReviewState>("review", () => {
    if (!workspace.current.sample) return { reports: [], selectedId: "", run: null };
    const scope = extractReviewScope(workspace.current.document.html, "整篇论文");
    const initial = buildPreviewReport(
      {
        projectId: workspace.current.id,
        title: workspace.current.title,
        docVersion: workspace.current.document.version,
        templateVersion: workspace.current.templateVersion,
        requirementVersion: workspace.current.requirementVersion,
        rubricVersion: 1,
        scope: "整篇论文",
        ...scope,
      },
      false,
      "当前自制样例 · 初始预览",
    );
    return { reports: [initial], selectedId: initial.id, run: null };
  });
}

export function validateReviewState(value: unknown): value is ReviewState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<ReviewState>;
  const validInput = (input: unknown): input is ReviewInput => {
    if (!input || typeof input !== "object") return false;
    const v = input as ReviewInput;
    return (
      [v.projectId, v.title, v.scope, v.html, v.text].every((x) => typeof x === "string") &&
      [v.docVersion, v.rubricVersion].every((x) => Number.isInteger(x) && x > 0) &&
      [v.templateVersion, v.requirementVersion].every((x) => Number.isInteger(x) && x >= 0) &&
      Array.isArray(v.headings) &&
      v.headings.every((x) => typeof x === "string") &&
      (v.sectionId === undefined || typeof v.sectionId === "string") &&
      (v.configSnapshot === undefined || validateConfigSnapshot(v.configSnapshot)) &&
      (v.requirementSnapshot === undefined ||
        (v.requirementSnapshot &&
          Number.isInteger(v.requirementSnapshot.version) &&
          v.requirementSnapshot.version >= 0 &&
          Array.isArray(v.requirementSnapshot.items) &&
          v.requirementSnapshot.items.every(
            (item) =>
              item &&
              [item.id, item.text, item.param, item.kind, item.sourceMaterialId].every((field) => typeof field === "string") &&
              Number.isInteger(item.sourceVersion) &&
              item.sourceVersion >= 0,
          ))) &&
      (v.templateSnapshot === undefined ||
        v.templateSnapshot === null ||
        (typeof v.templateSnapshot.materialId === "string" &&
          typeof v.templateSnapshot.title === "string" &&
          Number.isInteger(v.templateSnapshot.version) &&
          v.templateSnapshot.version > 0 &&
          Array.isArray(v.templateSnapshot.items) &&
          v.templateSnapshot.items.every((item) => item && [item.name, item.value, item.support].every((field) => typeof field === "string"))))
    );
  };
  const validReport = (report: unknown): report is ReviewReport => {
    if (!report || typeof report !== "object") return false;
    const r = report as ReviewReport;
    return (
      typeof r.id === "string" &&
      typeof r.at === "string" &&
      validInput(r.input) &&
      Number.isInteger(r.words) &&
      r.words >= 0 &&
      typeof r.partial === "boolean" &&
      Array.isArray(r.dims) &&
      r.dims.every(
        (d) =>
          d &&
          typeof d.id === "string" &&
          typeof d.name === "string" &&
          typeof d.full === "number" &&
          d.full > 0 &&
          (d.score === null || (typeof d.score === "number" && d.score >= 0 && d.score <= d.full)) &&
          (d.note === undefined || typeof d.note === "string"),
      ) &&
      Array.isArray(r.issues) &&
      r.issues.every(
        (i) => i && [i.id, i.title, i.location, i.basis, i.suggestion].every((x) => typeof x === "string") && ["major", "minor", "advice"].includes(i.severity),
      ) &&
      Array.isArray(r.unchecked) &&
      r.unchecked.every((x) => typeof x === "string")
    );
  };
  if (!Array.isArray(state.reports) || !state.reports.every(validReport) || typeof state.selectedId !== "string") return false;
  if (state.selectedId && !state.reports.some((r) => r.id === state.selectedId)) return false;
  const validRun = (run: ReviewRun | undefined | null): boolean =>
    !!run &&
    typeof run.id === "string" &&
    validInput(run.input) &&
    ["queued", "running", "done", "partial", "failed", "cancelled"].includes(run.status) &&
    ["normal", "partial", "timeout"].includes(run.scenario) &&
    Number.isInteger(run.attempt) &&
    run.attempt > 0 &&
    typeof run.diagnosis === "string" &&
    (run.sourceId === undefined || typeof run.sourceId === "string");
  return (state.run === null || validRun(state.run)) && (state.runs === undefined || (Array.isArray(state.runs) && state.runs.every(validRun)));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
export function reviewReportHtml(report: ReviewReport): string {
  const e = escapeHtml;
  const config = report.input.configSnapshot?.map((node) => `${node.name} v${node.version}`).join(" → ") || "此历史报告未记录配置快照";
  const rules = (report.input.requirementSnapshot?.items ?? [])
    .map(
      (item) =>
        `<li>${e(item.text)} · ${e(item.param)}<br>${e(item.note ?? "未判定")} · 来源 ${e(item.sourceMaterialId || "缺失")} v${item.sourceVersion}</li>`,
    )
    .join("");
  const source = `<section><h2>执行配置与固定依据</h2><p>${e(config)}</p><p>${e(report.input.templateSnapshot?.title ?? "未记录模板来源")} · ${report.input.templateSnapshot ? "v" + report.input.templateSnapshot.version : ""}</p><ul>${rules}</ul></section>`;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>论文评审预览报告</title><style>body{font:16px/1.8 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;color:#242424}h1,h2{line-height:1.4}section{border-top:1px solid #ddd;margin-top:24px}small{color:#666}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px;border-bottom:1px solid #ddd}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><body><small>ThesisPilot · 自制规则预览 · 模拟评分，非教师成绩</small><h1>${e(report.input.title)}</h1><p>范围：${e(report.input.scope)} · 正文 v${report.input.docVersion} · ${report.input.templateVersion ? "模板 v" + report.input.templateVersion : "模板未绑定"} · ${report.input.requirementVersion ? "要求 v" + report.input.requirementVersion : "要求未绑定"} · 量表 v${report.input.rubricVersion}</p><p>生成时间：${e(report.at)} · ${report.partial ? "部分完成" : "预览检查完成"} · ${report.words} 字</p><section><h2>分项参考评分</h2><table><tr><th>维度</th><th>参考分</th><th>依据</th></tr>${report.dims.map((d) => `<tr><td>${e(d.name)}</td><td>${d.score === null ? "不能判定" : d.score + "/" + d.full}</td><td>${e(d.note ?? "")}</td></tr>`).join("")}</table></section><section><h2>问题与建议</h2>${report.issues.map((i) => `<h3>${e(i.title)}</h3><p>位置：${e(i.location)}<br>依据：${e(i.basis)}<br>建议：${e(i.suggestion)}</p>`).join("")}</section><section><h2>未检查项</h2><ul>${report.unchecked.map((u) => `<li>${e(u)}</li>`).join("")}</ul></section>${source}<section><h2>固定输入文字</h2><pre>${e(report.input.text)}</pre></section><p>仅评审不会改变正文、正式计划、任务完成或导师认可状态。上述检查只用于交互预览，不代表学术质量评定。</p></body></html>`;
}
