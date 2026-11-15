import type { PreviewProject } from "./previewWorkspace.ts";
import { validatePlanState } from "./planState.ts";
import { validateFeedbackState } from "./feedbackState.ts";
import { validateReviewState } from "./reviewState.ts";
import { validateSettingsState } from "./settingsState.ts";
import { validateWritingState } from "./writingState.ts";
import { validateLibraryState, addLibraryVersion, type LibraryState } from "./libraryState.ts";
import { validateJobsState, normalizeRestoredJobs } from "./jobState.ts";
import { validateInboxState } from "./inboxState.ts";
import { validateEditorSnapshot } from "./editorAdapter.ts";
import { validateRemoteBinding } from "./serviceBinding.ts";

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 1;
const nonnegative = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
function validStageConfirmation(value: unknown): boolean {
  return (
    record(value) &&
    ["id", "stageId", "stageName", "at", "note"].every((k) => typeof value[k] === "string") &&
    positive(value.workflowVersion) &&
    positive(value.documentVersion) &&
    strings(value.evidenceTaskIds)
  );
}
function safeTree(value: unknown, depth = 0): boolean {
  if (depth > 45) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length < 100000 && value.every((v) => safeTree(v, depth + 1));
  return record(value) && Object.entries(value).every(([key, v]) => !["__proto__", "constructor", "prototype"].includes(key) && safeTree(v, depth + 1));
}
export function safeDocumentHtml(html: string): boolean {
  const allowed = new Set([
    "p",
    "br",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "strike",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "hr",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th",
    "colgroup",
    "col",
    "span",
    "div",
    "mark",
    "a",
  ]);
  const attributes = new Set([
    "class",
    "id",
    "title",
    "dir",
    "lang",
    "style",
    "href",
    "target",
    "rel",
    "colspan",
    "rowspan",
    "colwidth",
    "width",
    "height",
    "align",
    "start",
    "type",
    "reversed",
  ]);
  const cssProperties = new Set([
    "text-align",
    "font-weight",
    "font-size",
    "font-family",
    "line-height",
    "text-indent",
    "white-space",
    "width",
    "min-width",
    "max-width",
    "height",
    "min-height",
    "max-height",
    "vertical-align",
    "color",
    "background-color",
    "border",
    "border-collapse",
    "border-width",
    "border-style",
    "border-color",
    "margin",
    "margin-left",
    "margin-right",
    "margin-top",
    "margin-bottom",
    "padding",
    "padding-left",
    "padding-right",
    "padding-top",
    "padding-bottom",
  ]);
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", colon: ":", Tab: "\t", NewLine: "\n" };
  const decoded = (value: string) =>
    value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|colon|Tab|NewLine);?/gi, (entity, name: string) => {
      if (!name.startsWith("#")) return entities[name] ?? entity;
      const point = /^#x/i.test(name) ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "\u0000";
    });
  function validAttribute(tag: string, name: string, value: string): boolean {
    if (name.startsWith("on") || (!attributes.has(name) && !/^(?:data|aria)-[a-z\d_.:-]+$/.test(name))) return false;
    if (name === "href") {
      const url = decoded(value);
      return (
        tag === "a" && (!url || (/^(?:https?:\/\/|mailto:|#)/i.test(url) && !Array.from(url).some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)))
      );
    }
    if (name === "style") {
      // Only styles emitted by the supported editor are accepted. Text nodes are never inspected as CSS.
      return decoded(value)
        .split(";")
        .every((declaration) => {
          if (!declaration.trim()) return true;
          const part = /^\s*([a-z-]+)\s*:\s*([\w\s#.,%+-]*)\s*$/i.exec(declaration);
          return !!part && cssProperties.has(part[1]!.toLowerCase());
        });
    }
    return true;
  }
  // Scan only actual tag tokens. A quoted attribute may contain '>' or harmless technical text;
  // neither it nor ordinary text may be mistaken for a new element/event handler.
  let offset = 0;
  while ((offset = html.indexOf("<", offset)) !== -1) {
    if (html[offset + 1] === "!" || html[offset + 1] === "?") return false;
    const tag = /^<(\/?)([a-z][\w:-]*)/i.exec(html.slice(offset));
    if (!tag) {
      offset += 1;
      continue;
    }
    const name = tag[2]!.toLowerCase();
    if (!allowed.has(name)) return false;
    let cursor = offset + tag[0].length;
    if (!/[\s/>]/.test(html[cursor] ?? "")) return false;
    const seen = new Set<string>();
    while (cursor < html.length) {
      while (/\s/.test(html[cursor] ?? "")) cursor += 1;
      if (html[cursor] === ">") {
        cursor += 1;
        break;
      }
      if (!tag[1] && html[cursor] === "/" && html[cursor + 1] === ">") {
        cursor += 2;
        break;
      }
      if (tag[1]) return false;
      const attribute = /^[^\s"'<>/=]+/.exec(html.slice(cursor));
      if (!attribute) return false;
      const attributeName = attribute[0].toLowerCase();
      if (seen.has(attributeName)) return false;
      seen.add(attributeName);
      cursor += attribute[0].length;
      while (/\s/.test(html[cursor] ?? "")) cursor += 1;
      let value = "";
      if (html[cursor] === "=") {
        cursor += 1;
        while (/\s/.test(html[cursor] ?? "")) cursor += 1;
        const quote = html[cursor];
        if (quote === '"' || quote === "'") {
          const end = html.indexOf(quote, cursor + 1);
          if (end === -1) return false;
          value = html.slice(cursor + 1, end);
          cursor = end + 1;
          if (!/[\s/>]/.test(html[cursor] ?? "")) return false;
        } else {
          const unquoted = /^[^\s>]+/.exec(html.slice(cursor));
          if (!unquoted || /["'`=<]/.test(unquoted[0])) return false;
          value = unquoted[0];
          cursor += value.length;
        }
      }
      if (!validAttribute(name, attributeName, value)) return false;
    }
    if (html[cursor - 1] !== ">") return false;
    offset = cursor;
  }
  return true;
}
const validators: Record<string, (value: unknown) => boolean> = {
  plan: validatePlanState,
  feedback: validateFeedbackState,
  review: validateReviewState,
  settings: validateSettingsState,
  writing: validateWritingState,
  library: validateLibraryState,
  inbox: validateInboxState,
  jobs: validateJobsState,
  stageProgress: (value) =>
    record(value) &&
    Array.isArray(value.confirmations) &&
    value.confirmations.every(validStageConfirmation) &&
    (value.history === undefined || (Array.isArray(value.history) && value.history.every(validStageConfirmation))),
};
export function registerBackupValidator(key: string, validate: (value: unknown) => boolean) {
  validators[key] = validate;
}
export function validatePreviewProject(value: unknown): value is PreviewProject {
  if (
    !record(value) ||
    !["id", "title", "short", "stage", "deadline", "planning"].every((k) => typeof value[k] === "string") ||
    typeof value.sample !== "boolean" ||
    typeof value.archived !== "boolean"
  )
    return false;
  const { document: doc, ...projectFields } = value;
  if (!safeTree(projectFields)) return false;
  if (value.remoteBinding !== undefined && !validateRemoteBinding(value.remoteBinding)) return false;
  if (
    value.priorWork !== undefined &&
    (!Array.isArray(value.priorWork) || !value.priorWork.every((w) => record(w) && ["title", "source", "confirmedAt"].every((k) => typeof w[k] === "string")))
  )
    return false;
  if (
    value.events !== undefined &&
    (!Array.isArray(value.events) ||
      !value.events.every(
        (e) =>
          record(e) &&
          ["id", "projectId", "title", "detail", "route", "at"].every((k) => typeof e[k] === "string") &&
          e.projectId === value.id &&
          ["read", "snoozed", "dismissed"].every((k) => typeof e[k] === "boolean") &&
          (e.type === undefined || typeof e.type === "string") &&
          (e.objectId === undefined || typeof e.objectId === "string") &&
          (e.sourceVersion === undefined || nonnegative(e.sourceVersion)),
      ))
  )
    return false;
  if (
    !["workflowVersion", "templateVersion", "requirementVersion"].every(
      (k) => Number.isInteger(value[k]) && Number(value[k]) >= (k === "workflowVersion" ? 1 : 0),
    )
  )
    return false;
  if (
    !record(doc) ||
    typeof doc.html !== "string" ||
    !safeDocumentHtml(doc.html) ||
    !Number.isInteger(doc.version) ||
    Number(doc.version) < 1 ||
    typeof doc.savedAt !== "string" ||
    !Array.isArray(doc.history) ||
    !doc.history.length ||
    doc.history.length >= 100000
  )
    return false;
  const { structure, history, ...documentFields } = doc;
  // The editor validator owns the structure grammar and limits. Other backup data
  // retains the general JSON tree checks and its original depth limit.
  if (!safeTree(documentFields, 1) || (structure !== undefined && !validateEditorSnapshot(structure))) return false;
  let previous = 0;
  for (const version of history) {
    if (!record(version)) return false;
    const { structure: versionStructure, ...versionFields } = version;
    if (
      !safeTree(versionFields, 3) ||
      !positive(version.version) ||
      Number(version.version) <= previous ||
      typeof version.html !== "string" ||
      !safeDocumentHtml(version.html) ||
      typeof version.at !== "string" ||
      typeof version.cause !== "string" ||
      (versionStructure !== undefined && !validateEditorSnapshot(versionStructure))
    )
      return false;
    previous = Number(version.version);
  }
  const latest = history[history.length - 1];
  if (!record(latest) || latest.version !== doc.version || latest.html !== doc.html) return false;
  if (!record(value.modules)) return false;
  return Object.entries(value.modules).every(([key, module]) => {
    try {
      return validators[key]?.(module) === true;
    } catch {
      return false;
    }
  });
}
export function serializePreviewBackup(project: PreviewProject): string {
  return JSON.stringify({ format: "ThesisPilot-preview", schema: 1, exportedAt: new Date().toISOString(), project }, null, 2);
}
export function parsePreviewBackup(raw: string): PreviewProject {
  if (raw.length > 24 * 1024 * 1024) throw new Error("备份超过 24 MB 的预览限制。");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("文件不是有效的 JSON 备份，现有项目未改变。");
  }
  if (!record(value) || value.format !== "ThesisPilot-preview" || value.schema !== 1) throw new Error("备份格式、版本或模块数据不完整，现有项目未改变。");
  const { project, ...envelope } = value;
  if (!safeTree(envelope) || !validatePreviewProject(project)) throw new Error("备份正文结构或项目数据未通过校验。请保留原文件，现有项目未改变。");
  // This import creates an independent local copy. It must never inherit the
  // authority to rename or operate the original server project.
  delete project.remoteBinding;
  return project;
}
export function stopRestoredRuns(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(stopRestoredRuns);
    return;
  }
  const object = value as Record<string, unknown>;
  if (["running", "queued", "generating"].includes(String(object.status))) {
    object.status = "cancelled";
    if ("diagnosis" in object) object.diagnosis = "备份恢复后原执行已停止，请重新发起。";
    if ("explanation" in object) object.explanation = "恢复后原执行已停止，请重新检查；已有来源和版本保留。";
  }
  if (["running", "queued"].includes(String(object.splitStatus))) {
    object.splitStatus = "cancelled";
    object.splitError = "备份恢复后请重新整理。";
  }
  Object.values(object).forEach(stopRestoredRuns);
}
export function normalizeRestoredModules(modules: Record<string, unknown>, options: { projectCopy?: boolean } = {}) {
  normalizeRestoredJobs(modules.jobs);
  const writing = modules.writing;
  if (options.projectCopy && record(writing) && record(writing.candidate) && ["pending", "invalid", "generating"].includes(String(writing.candidate.status))) {
    writing.candidate.status = "expired";
  }
  stopRestoredRuns(modules);
  if (validateLibraryState(modules.library)) {
    for (const material of (modules.library as LibraryState).materials) {
      if (material.status === "waiting" || material.status === "processing") {
        addLibraryVersion(material, { status: "failed", diagnosis: "备份恢复后原解析已停止，可重新解析；原件及历史版本保留。" }, "恢复后停止原解析");
        material.cancelled = true;
      }
    }
  }
}
export function downloadPreviewFile(filename: string, content: string, type: string): { ok: true } | { ok: false; error: string } {
  let url = "";
  try {
    url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true };
  } catch {
    if (url) URL.revokeObjectURL(url);
    return { ok: false, error: "文件准备失败，原内容已保留。请重试，或选择其他已支持格式。" };
  }
}
export const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
