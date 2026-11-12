import type { AgentKind, CandidateView, RequirementView } from "../../domain/types.ts";
import type { LibraryRuleType } from "../services/libraryService.ts";
export interface WritingRuleSnapshot {
  id: string;
  version: number;
  text: string;
  param: string;
  kind: "hard" | "semantic";
  ruleType: LibraryRuleType;
  scope: string;
  strictness: string;
  enabled: boolean;
  verdict: RequirementView["verdict"];
  verdictNote: string;
  source: { materialId: string; version: number; title: string; position: string; original: string };
}
export interface WritingConstraints {
  documentVersion: number;
  requirements: { version: number; state: "bound" | "unbound" | "missing"; note: string; rules: WritingRuleSnapshot[] };
  template: {
    version: number;
    state: "bound" | "unbound" | "missing";
    note: string;
    materialId: string;
    title: string;
    original: string;
    items: { name: string; value: string; support: string; state: "identified" | "unknown" | "conflict"; source: string }[];
  };
}
export interface WritingSource {
  id: string;
  version: number;
  title: string;
  text: string;
  verify: string;
  coverage: string;
}
export interface WritingContext {
  materialIds: string[];
  selection: { from: number; to: number; text: string; valid: boolean };
  goal: string;
  replacement: string;
  includeChapter: boolean;
  selectionVersion?: number;
  chapter?: { id: string; title: string };
}
export interface WritingRequest {
  id: string;
  projectId: string;
  agent: AgentKind;
  prompt: string;
  version: number;
  requirementVersion: number;
  templateVersion: number;
  constraints?: WritingConstraints;
  chapter: string;
  chapterId?: string;
  selection: WritingContext["selection"];
  sources: WritingSource[];
  config: { id: string; version: number; name: string }[];
  at: string;
}
export interface WritingStep {
  id: string;
  agent: AgentKind;
  title: string;
  status: "waiting" | "running" | "done" | "failed" | "cancelled";
  result: string;
}
export interface WritingRevision {
  candidate: CandidateView;
  patches: { id: string; from: number; to: number; before: string; after: string }[];
  beforeHtml: string;
  request?: WritingRequest;
  kind: "text" | "citation" | "format";
  at: string;
}
export interface WritingMessage {
  id: string;
  role: "student" | "assistant";
  text: string;
  at: string;
  version: number;
}
export interface WritingSession {
  kind: AgentKind;
  draft: string;
  messages: WritingMessage[];
  status: "idle" | "running" | "failed" | "cancelled";
  error: string;
  lastPrompt: string;
  context?: WritingContext;
  lastRequest?: WritingRequest;
  steps?: WritingStep[];
}
export interface WritingState {
  sessions: WritingSession[];
  selectedAgent: AgentKind;
  companion: AgentKind;
  multi: boolean;
  materialIds: string[];
  decisions: { at: string; action: string; version: number }[];
  candidate: CandidateView | null;
  patches: { id: string; from: number; to: number; before: string; after: string }[];
  beforeHtml: string;
  selection: { from: number; to: number; text: string; valid: boolean };
  goal: string;
  replacement: string;
  history?: WritingRevision[];
  request?: WritingRequest;
  revisionKind?: "text" | "citation" | "format";
  citationText?: string;
  formatChanges?: { position: number; title: string; level: number; nextLevel: number; align: string; nextAlign: string; weight: string; nextWeight: string }[];
}
export function emptyWritingContext(): WritingContext {
  return { materialIds: [], selection: { from: 0, to: 0, text: "", valid: false }, goal: "表达更清楚，保留事实与引用", replacement: "", includeChapter: true };
}
export function copyWritingValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
export function archiveWritingCandidate(state: WritingState) {
  if (!state.candidate) return;
  state.history ??= [];
  const item: WritingRevision = copyWritingValue({
    candidate: state.candidate,
    patches: state.patches,
    beforeHtml: state.beforeHtml,
    request: state.request,
    kind: state.revisionKind ?? "text",
    at: new Date().toLocaleString("zh-CN"),
  });
  const index = state.history.findIndex((h) => h.candidate.id === state.candidate!.id);
  if (index < 0) state.history.unshift(item);
  else state.history[index] = item;
}
const kinds = ["general", "lit", "content", "format", "progress", "review"];
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 2_000_000;
const number = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const list = (v: unknown): v is unknown[] => Array.isArray(v) && v.length <= 10_000;
function validSelection(v: unknown): boolean {
  return record(v) && number(v.from) && number(v.to) && v.to >= v.from && text(v.text) && typeof v.valid === "boolean";
}
function validContext(v: unknown): boolean {
  return (
    record(v) &&
    list(v.materialIds) &&
    v.materialIds.every(text) &&
    validSelection(v.selection) &&
    text(v.goal) &&
    text(v.replacement) &&
    typeof v.includeChapter === "boolean" &&
    (v.selectionVersion === undefined || number(v.selectionVersion)) &&
    (v.chapter === undefined || (record(v.chapter) && text(v.chapter.id) && text(v.chapter.title)))
  );
}
function validConstraints(v: unknown): boolean {
  if (!record(v) || !number(v.documentVersion) || !record(v.requirements) || !record(v.template)) return false;
  const binding = (item: Record<string, unknown>) =>
    number(item.version) && typeof item.state === "string" && ["bound", "unbound", "missing"].includes(item.state) && text(item.note);
  const requirements = v.requirements;
  const template = v.template;
  return (
    binding(requirements) &&
    list(requirements.rules) &&
    requirements.rules.every(
      (rule) =>
        record(rule) &&
        text(rule.id) &&
        number(rule.version) &&
        text(rule.text) &&
        text(rule.param) &&
        (rule.kind === "hard" || rule.kind === "semantic") &&
        typeof rule.ruleType === "string" &&
        ["characters", "references", "recentReferences", "chapters", "headings", "format", "semantic"].includes(rule.ruleType) &&
        text(rule.scope) &&
        text(rule.strictness) &&
        typeof rule.enabled === "boolean" &&
        typeof rule.verdict === "string" &&
        ["pass", "fail", "advice", "unknown", "conflict", "nosource"].includes(rule.verdict) &&
        text(rule.verdictNote) &&
        record(rule.source) &&
        text(rule.source.materialId) &&
        number(rule.source.version) &&
        text(rule.source.title) &&
        text(rule.source.position) &&
        text(rule.source.original),
    ) &&
    binding(template) &&
    text(template.materialId) &&
    text(template.title) &&
    text(template.original) &&
    list(template.items) &&
    template.items.every(
      (item) =>
        record(item) &&
        text(item.name) &&
        text(item.value) &&
        text(item.support) &&
        text(item.source) &&
        typeof item.state === "string" &&
        ["identified", "unknown", "conflict"].includes(item.state),
    )
  );
}
function validRequest(v: unknown): boolean {
  return (
    record(v) &&
    text(v.id) &&
    text(v.projectId) &&
    kinds.includes(String(v.agent)) &&
    text(v.prompt) &&
    number(v.version) &&
    number(v.requirementVersion) &&
    number(v.templateVersion) &&
    (v.constraints === undefined ||
      (validConstraints(v.constraints) &&
        record(v.constraints) &&
        v.constraints.documentVersion === v.version &&
        record(v.constraints.requirements) &&
        v.constraints.requirements.version === v.requirementVersion &&
        record(v.constraints.template) &&
        v.constraints.template.version === v.templateVersion)) &&
    text(v.chapter) &&
    (v.chapterId === undefined || text(v.chapterId)) &&
    text(v.at) &&
    validSelection(v.selection) &&
    list(v.sources) &&
    v.sources.every(
      (source) =>
        record(source) &&
        text(source.id) &&
        number(source.version) &&
        text(source.title) &&
        text(source.text) &&
        ["verified", "provided"].includes(String(source.verify)) &&
        text(source.coverage),
    ) &&
    list(v.config) &&
    v.config.every((config) => record(config) && text(config.id) && number(config.version) && text(config.name))
  );
}
export function validateWritingState(v: unknown): v is WritingState {
  if (
    !record(v) ||
    !list(v.sessions) ||
    v.sessions.length !== 6 ||
    !kinds.includes(String(v.selectedAgent)) ||
    !kinds.includes(String(v.companion)) ||
    typeof v.multi !== "boolean"
  )
    return false;
  if (new Set(v.sessions.map((s) => (record(s) ? s.kind : ""))).size !== 6) return false;
  if (
    !v.sessions.every(
      (s) =>
        record(s) &&
        kinds.includes(String(s.kind)) &&
        text(s.draft) &&
        text(s.error) &&
        text(s.lastPrompt) &&
        (s.context === undefined || validContext(s.context)) &&
        (s.lastRequest === undefined || validRequest(s.lastRequest)) &&
        (s.steps === undefined ||
          (list(s.steps) &&
            s.steps.every(
              (step) =>
                record(step) &&
                text(step.id) &&
                kinds.includes(String(step.agent)) &&
                text(step.title) &&
                text(step.result) &&
                ["waiting", "running", "done", "failed", "cancelled"].includes(String(step.status)),
            ))) &&
        ["idle", "running", "failed", "cancelled"].includes(String(s.status)) &&
        list(s.messages) &&
        s.messages.every(
          (m) => record(m) && text(m.id) && ["student", "assistant"].includes(String(m.role)) && text(m.text) && text(m.at) && number(m.version),
        ),
    )
  )
    return false;
  if (
    !list(v.materialIds) ||
    !v.materialIds.every(text) ||
    !list(v.decisions) ||
    !v.decisions.every((d) => record(d) && text(d.at) && text(d.action) && number(d.version))
  )
    return false;
  if (
    !text(v.beforeHtml) ||
    !text(v.goal) ||
    !text(v.replacement) ||
    !record(v.selection) ||
    !number(v.selection.from) ||
    !number(v.selection.to) ||
    !text(v.selection.text) ||
    typeof v.selection.valid !== "boolean"
  )
    return false;
  if (!list(v.patches) || !v.patches.every((p) => record(p) && text(p.id) && number(p.from) && number(p.to) && text(p.before) && text(p.after))) return false;
  if (v.request !== undefined && !validRequest(v.request)) return false;
  if (v.revisionKind !== undefined && (typeof v.revisionKind !== "string" || !["text", "citation", "format"].includes(v.revisionKind))) return false;
  if (v.citationText !== undefined && !text(v.citationText)) return false;
  if (
    v.formatChanges !== undefined &&
    (!list(v.formatChanges) ||
      !v.formatChanges.every(
        (change) =>
          record(change) &&
          number(change.position) &&
          text(change.title) &&
          number(change.level) &&
          change.level >= 1 &&
          change.level <= 6 &&
          number(change.nextLevel) &&
          change.nextLevel >= 1 &&
          change.nextLevel <= 6 &&
          text(change.align) &&
          ["left", "center"].includes(String(change.nextAlign)) &&
          text(change.weight) &&
          ["600", "700"].includes(String(change.nextWeight)),
      ))
  )
    return false;
  if (
    v.history !== undefined &&
    (!list(v.history) ||
      !v.history.every(
        (item) =>
          record(item) &&
          validCandidate(item.candidate) &&
          text(item.beforeHtml) &&
          text(item.at) &&
          ["text", "citation", "format"].includes(String(item.kind)) &&
          (item.request === undefined || validRequest(item.request)) &&
          list(item.patches) &&
          item.patches.every((patch) => record(patch) && text(patch.id) && number(patch.from) && number(patch.to) && text(patch.before) && text(patch.after)),
      ))
  )
    return false;
  return v.candidate === null || validCandidate(v.candidate);
}
function validCandidate(c: unknown): boolean {
  return (
    record(c) &&
    text(c.id) &&
    kinds.includes(String(c.agent)) &&
    text(c.goal) &&
    text(c.scope) &&
    number(c.baseVersion) &&
    number(c.currentVersion) &&
    ["generating", "pending", "invalid", "adopted", "rejected", "cancelled", "expired"].includes(String(c.status)) &&
    (c.resultVersion === undefined || number(c.resultVersion)) &&
    list(c.basis) &&
    c.basis.every(text) &&
    list(c.checks) &&
    c.checks.every(
      (x) =>
        record(x) &&
        ["number", "citation", "formula", "lock", "range", "version", "overlap"].includes(String(x.id)) &&
        text(x.label) &&
        ["pass", "fail", "unsupported"].includes(String(x.result)) &&
        (x.detail === undefined || text(x.detail)),
    ) &&
    list(c.hunks) &&
    c.hunks.every(
      (h) =>
        record(h) &&
        text(h.id) &&
        text(h.reason) &&
        ["pending", "accepted", "rejected"].includes(String(h.decision)) &&
        (h.blocked === undefined || text(h.blocked)) &&
        list(h.segments) &&
        h.segments.every((s) => record(s) && ["eq", "del", "ins", "protect"].includes(String(s.t)) && text(s.text)),
    )
  );
}
