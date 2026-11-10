/**
 * 展示层用到的领域类型（设计阶段子集）。
 * 命名与《交付与验收要求》§3.3 的建议对象对齐；全量实现时这些类型迁入 services/contracts 并补全 ID / 版本关联。
 */

export type AgentKind = "general" | "lit" | "content" | "format" | "progress" | "review";

/* —— 流程阶段 —— */
export type StageState = "done" | "current" | "upcoming";
export interface StageView {
  id: string;
  name: string;
  state: StageState;
  date?: string;
  note?: string;
}

/* —— 任务 —— */
export type TaskStatus = "todo" | "doing" | "verify" | "confirmed";
export interface EvidenceView {
  id: string;
  kind: "document" | "file" | "revision";
  label: string;
  version?: number;
  /** 证据已被替换或对应正文版本已变化 */
  stale?: boolean;
}
export interface TaskView {
  id: string;
  title: string;
  status: TaskStatus;
  acceptance?: string;
  due?: string;
  dueState?: "normal" | "soon" | "overdue";
  hardDeadline?: boolean;
  chapter?: string;
  dependsOn?: { title: string; done: boolean }[];
  evidence?: EvidenceView[];
  confirmedAt?: string;
}

/* —— 修订候选 —— */
export type CandidateStatus = "generating" | "pending" | "invalid" | "adopted" | "rejected" | "cancelled" | "expired";
export type ProtectKind = "number" | "citation" | "formula" | "lock";
export interface DiffSegment {
  t: "eq" | "del" | "ins" | "protect";
  text: string;
  kind?: ProtectKind;
  /** 保护对象被候选改动 */
  violated?: boolean;
}
export type HunkDecision = "pending" | "accepted" | "rejected";
export interface HunkView {
  id: string;
  segments: DiffSegment[];
  reason: string;
  decision: HunkDecision;
  /** 程序校验未通过的原因；存在时该片段不可采纳 */
  blocked?: string;
}
export interface CheckView {
  id: "number" | "citation" | "formula" | "lock" | "range" | "version" | "overlap";
  label: string;
  result: "pass" | "fail" | "unsupported";
  detail?: string;
}
export interface CandidateView {
  id: string;
  agent: AgentKind;
  goal: string;
  scope: string;
  baseVersion: number;
  currentVersion: number;
  status: CandidateStatus;
  hunks: HunkView[];
  checks: CheckView[];
  basis: string[];
  resultVersion?: number;
}

/* —— 助手运行 —— */
export type RunStepStatus = "waiting" | "running" | "done" | "failed" | "cancelled";
export interface RunStepView {
  id: string;
  agent: AgentKind;
  title: string;
  status: RunStepStatus;
  detail?: string;
}

/* —— 主动建议 —— */
export interface SuggestionView {
  id: string;
  title: string;
  body: string;
  event: string;
  at: string;
  level: "important" | "normal";
  related: string[];
  basis: string[];
  uncertainty?: string;
  state: "unread" | "read" | "snoozed" | "dismissed";
  snoozedUntil?: string;
}

/* —— 导师反馈 —— */
export interface FeedbackItemView {
  id: string;
  text: string;
  locate?: string;
  flag?: "ambiguous" | "unlocated" | "needs-material";
  taskTitle?: string;
  handled: boolean;
  correctedByStudent?: boolean;
}
export interface FeedbackView {
  id: string;
  original: string;
  source: string;
  at: string;
  docVersion: number;
  items: FeedbackItemView[];
}

/* —— 资料 —— */
export type ParseStatus = "waiting" | "processing" | "parsed" | "partial" | "failed";
export interface MaterialView {
  id: string;
  name: string;
  ext: string;
  category: string;
  version: number;
  status: ParseStatus;
  progress?: number;
  size: string;
  at: string;
  recognized?: number;
  unrecognized?: number;
  diagnosis?: string;
  duplicateOf?: number;
}

/* —— 论文要求 —— */
export type Verdict = "pass" | "fail" | "advice" | "unknown" | "conflict" | "nosource";
export interface RequirementView {
  id: string;
  text: string;
  kind: "hard" | "semantic";
  category: string;
  param?: string;
  source?: string;
  version: number;
  verdict: Verdict;
  verdictNote?: string;
}

/* —— 文献 —— */
export interface LiteratureView {
  id: string;
  title: string;
  meta: string;
  coverage: { biblio: boolean; abstract: boolean; fulltext: boolean };
  verify: "verified" | "unverified" | "conflict";
  note?: string;
  saved?: boolean;
}

/* —— 评审 —— */
export interface ScoreDimView {
  id: string;
  name: string;
  score: number | null;
  full: number;
  note?: string;
}
export interface IssueView {
  id: string;
  severity: "major" | "minor" | "advice";
  title: string;
  location: string;
  basis: string;
  suggestion: string;
}

/* —— 后台任务 —— */
export type JobStatus = "queued" | "running" | "done" | "partial" | "failed" | "cancelled";
export interface JobView {
  id: string;
  kind: "parse" | "generate" | "search" | "review" | "export";
  title: string;
  status: JobStatus;
  progress?: number;
  scope: string;
  snapshot: string;
  attempt: number;
  diagnosis?: string;
}

/* —— 四库 —— */
export interface ConfigNodeView {
  lib: "api" | "model" | "prompt" | "agent";
  name: string;
  version: number;
  state: "active" | "disabled" | "invalid";
  problem?: string;
}

/* —— 版本 —— */
export interface VersionView {
  v: number;
  at: string;
  cause: "manual" | "adopt" | "restore" | "import";
  summary: string;
  words: number;
  current?: boolean;
}

/* —— 计划调整 —— */
export interface PlanBarView {
  id: string;
  title: string;
  /** 以天为单位，相对计划窗口起点 */
  start: number;
  end: number;
  newStart?: number;
  newEnd?: number;
  hard?: boolean;
}
