import type { EvidenceView } from "../../domain/types.ts";
import { usePreviewModule, usePreviewWorkspaceStore } from "./previewWorkspace.ts";

export interface FeedbackHistory {
  id: string;
  at: string;
  action: string;
  detail: string;
  version?: number;
}
export interface FeedbackEvidence extends EvidenceView {
  materialId?: string;
  route?: string;
  excerpt?: string;
  sectionId?: string;
}
const sampleOriginal = "第三章的系统架构讲得太笼统，模块之间怎么交互看不出来。另外实验部分对比的基线太少，至少要有两个。还有那个图不太行。";
export interface FeedbackEntry {
  id: string;
  batchId: string;
  status: "recorded" | "interpreted";
  source: string;
  recordedAt?: string;
  title: string;
  summary: string;
  original: string;
  date: string;
  version?: number;
  locate: string;
  task: string;
  suggestion: string;
  excerpt: string;
  evidence: FeedbackEvidence[];
  ambiguous: boolean;
  studentLocated?: boolean;
  handled: boolean;
  verified: boolean;
  origin?: "sample" | "segmented" | "student" | "mock";
  uncertainty?: string;
  segment?: { start: number; end: number; text: string };
  taskId?: string;
  acceptance?: string;
  splitStatus?: "queued" | "running" | "failed" | "cancelled";
  splitError?: string;
  history?: FeedbackHistory[];
  previousEvidence?: { at: string; evidence: FeedbackEvidence[]; excerpt: string }[];
}

const initialEntries: FeedbackEntry[] = [
  {
    id: "F-07.1",
    batchId: "F-07",
    status: "interpreted",
    source: "周老师（样例导师）",
    title: "讲清模块之间如何协作",
    summary: "第 3 章 · 系统架构说明",
    original: sampleOriginal,
    date: "11-08 19:22",
    version: 11,
    locate: "3.1 总体架构",
    task: "完善模块交互说明",
    suggestion: "补充从用户请求、候选召回到结果排序的交互过程，并用一张时序图串联各模块。",
    excerpt: "用户请求首先进入推荐服务，由召回模块生成候选商品集合；排序模块对候选集计算得分，再将排序结果返回展示层。图 3-2 给出了模块间的数据传递过程。",
    evidence: [
      { id: "fe1", kind: "document", label: "3.1 架构说明", version: 13 },
      { id: "fe2", kind: "file", label: "模块交互图", version: 2 },
    ],
    ambiguous: false,
    handled: false,
    verified: false,
  },
  {
    id: "F-07.2",
    batchId: "F-07",
    status: "interpreted",
    source: "周老师（样例导师）",
    title: "增加对比实验的基线",
    summary: "第 3 章 · 协同过滤召回",
    original: sampleOriginal,
    date: "11-08 19:22",
    version: 11,
    locate: "3.2 协同过滤召回",
    task: "补充协同过滤对比实验",
    suggestion: "保留当前实验，再补充一个基线方法；在相同数据集和划分方式下，对比召回率与耗时。",
    excerpt: "尚未关联新实验结果。先补齐实验材料，再核对这条意见是否已经处理。",
    evidence: [],
    ambiguous: false,
    handled: false,
    verified: false,
  },
  {
    id: "F-07.3",
    batchId: "F-07",
    status: "interpreted",
    source: "周老师（样例导师）",
    title: "“那个图”具体指哪一张？",
    summary: "原话没有明确指向",
    original: sampleOriginal,
    date: "11-08 19:22",
    version: 11,
    locate: "",
    task: "待明确意见后建立任务",
    suggestion: "这条意见可能指系统架构图，也可能指实验结果图。仅凭原话无法确定，请先补充你掌握的上下文。",
    excerpt: "尚无修改证据。补充定位只是你的判断，仍需要核对实际修改。",
    evidence: [],
    ambiguous: true,
    handled: false,
    verified: false,
  },
  {
    id: "F-06.1",
    batchId: "F-06",
    status: "interpreted",
    source: "周老师（样例导师）",
    title: "统一参考文献著录格式",
    summary: "参考文献 · 已关联格式修改",
    original: "参考文献的作者和年份格式需要统一，按照学院模板再检查一遍。",
    date: "11-05 15:40",
    version: 9,
    locate: "参考文献",
    task: "统一参考文献格式",
    suggestion: "对照模板统一作者、年份和标点，保留文献条目的原有信息。",
    excerpt: "已对照模板整理参考文献的作者、年份及标点格式；文献编号与原有条目信息保持不变。",
    evidence: [{ id: "fe3", kind: "document", label: "参考文献", version: 10 }],
    ambiguous: false,
    handled: true,
    verified: true,
  },
];

export interface FeedbackState {
  entries: FeedbackEntry[];
  nextPastedId: number;
}

export function useFeedbackState() {
  const workspace = usePreviewWorkspaceStore();
  return usePreviewModule<FeedbackState>("feedback", () => ({
    entries: !workspace.current.sample
      ? []
      : structuredClone(initialEntries).map((entry) => ({
          ...entry,
          origin: "sample" as const,
          history: [{ id: crypto.randomUUID(), at: "自制样例", action: "样例录入", detail: "历史样例，用于呈现反馈和证据的关系。" }],
        })),
    nextPastedId: 1,
  }));
}

export function validateFeedbackState(value: unknown): value is FeedbackState {
  if (!value || typeof value !== "object") return false;
  const state = value as FeedbackState;
  if (!Number.isInteger(state.nextPastedId) || state.nextPastedId < 1 || !Array.isArray(state.entries)) return false;
  const ids = state.entries.map((entry) => entry?.id);
  if (new Set(ids).size !== ids.length) return false;
  const pastedIds = ids.map((id) => (typeof id === "string" ? Number(/^F-P(\d+)/.exec(id)?.[1] ?? 0) : 0));
  if (pastedIds.some((id) => id >= state.nextPastedId)) return false;
  const strings = ["id", "batchId", "source", "title", "summary", "original", "date", "locate", "task", "suggestion", "excerpt"] as const;
  const validEvidence = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    const item = value as FeedbackEvidence;
    return (
      typeof item.id === "string" &&
      typeof item.label === "string" &&
      ["document", "file", "revision"].includes(item.kind) &&
      (item.version === undefined || (Number.isInteger(item.version) && item.version > 0)) &&
      (item.stale === undefined || typeof item.stale === "boolean") &&
      [item.materialId, item.route, item.excerpt, item.sectionId].every((field) => field === undefined || typeof field === "string") &&
      (item.route === undefined || item.route.startsWith("/screens/"))
    );
  };
  return state.entries.every(
    (entry) =>
      entry &&
      strings.every((key) => typeof entry[key] === "string") &&
      entry.original.length <= 10_000 &&
      ["recorded", "interpreted"].includes(entry.status) &&
      (entry.origin === undefined || ["sample", "segmented", "student", "mock"].includes(entry.origin)) &&
      (entry.splitStatus === undefined || ["queued", "running", "failed", "cancelled"].includes(entry.splitStatus)) &&
      [entry.recordedAt, entry.taskId, entry.acceptance, entry.splitError, entry.uncertainty].every(
        (value) => value === undefined || typeof value === "string",
      ) &&
      (entry.studentLocated === undefined || typeof entry.studentLocated === "boolean") &&
      [entry.ambiguous, entry.handled, entry.verified].every((flag) => typeof flag === "boolean") &&
      Array.isArray(entry.evidence) &&
      entry.evidence.every(validEvidence) &&
      (entry.version === undefined || Number.isInteger(entry.version)) &&
      (entry.history === undefined ||
        (Array.isArray(entry.history) && entry.history.every((h) => h && [h.id, h.at, h.action, h.detail].every((v) => typeof v === "string")))) &&
      (entry.previousEvidence === undefined ||
        (Array.isArray(entry.previousEvidence) &&
          entry.previousEvidence.every(
            (h) => h && typeof h.at === "string" && typeof h.excerpt === "string" && Array.isArray(h.evidence) && h.evidence.every(validEvidence),
          ))) &&
      (entry.segment === undefined ||
        (entry.segment &&
          typeof entry.segment === "object" &&
          Number.isInteger(entry.segment.start) &&
          Number.isInteger(entry.segment.end) &&
          entry.segment.start >= 0 &&
          entry.segment.end >= entry.segment.start &&
          entry.original.slice(entry.segment.start, entry.segment.end) === entry.segment.text)),
  );
}

export function recordFeedback(entry: FeedbackEntry, action: string, detail: string, version?: number) {
  entry.history ??= [];
  entry.history.push({ id: crypto.randomUUID(), at: new Date().toLocaleString("zh-CN"), action, detail, version });
}

export function splitFeedbackOriginal(original: string) {
  const segments = [...original.matchAll(/[^\r\n]+/g)]
    .filter((match) => match[0].trim())
    .map((match) => ({ start: match.index, end: match.index + match[0].length, text: match[0] }));
  if (segments.length > 50) throw new Error("这段原文超过 50 个非空段落，请使用手动整理，或缩小每次整理的范围。原文保持完整。");
  return segments;
}
