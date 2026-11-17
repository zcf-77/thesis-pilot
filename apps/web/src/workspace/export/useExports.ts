import { computed, onScopeDispose, ref, shallowRef } from "vue";
import { ApiError, asApiError, type BackendServices, type DocumentRead, type ExportRead } from "../../services/index.ts";
import type { DocumentVersionSummary } from "../../services/contracts/api.generated.ts";

export type DocumentFormat = ExportRead["format"];
export type ChangeFormat = Exclude<DocumentFormat, "txt">;
export const documentFormats: { value: DocumentFormat; label: string }[] = [
  { value: "html", label: "HTML" },
  { value: "markdown", label: "Markdown" },
  { value: "txt", label: "纯文本" },
];
export const changeFormats: { value: ChangeFormat; label: string }[] = [
  { value: "html", label: "HTML" },
  { value: "markdown", label: "Markdown" },
];
export const formatLabel: Record<DocumentFormat, string> = { html: "HTML", markdown: "Markdown", txt: "纯文本" };
export const versionSource: Record<DocumentVersionSummary["source"], string> = {
  blank: "新建空白稿",
  schema_upgrade: "升级正文结构",
  local_import: "导入正文",
  manual_edit: "手动保存",
  ai_adoption: "采纳候选",
  adoption_undo: "撤销采纳",
  version_revert: "恢复历史版本",
};
const POLL_MS = 1200;
const VERSION_PAGES = 3;
const RETRYABLE_TRANSPORT = new Set(["REQUEST_TIMEOUT", "NETWORK_ERROR"]);
const timeFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
export const formatTime = (value: string) => timeFormat.format(new Date(value));

export const isActiveExport = (item: ExportRead) => item.status === "queued" || item.status === "running";
export const exportTitle = (item: ExportRead) =>
  item.kind === "document_export" ? `正文 v${item.document_version}` : `修改说明 v${item.from_version}–v${item.document_version}`;

/** What happened, in one sentence; the caller adds the impact and the next step. */
export function exportFailure(item: ExportRead): string {
  if (item.status === "cancelled") return "导出已取消，未生成文件。";
  switch (item.error_code) {
    case "EXPORT_SOURCE_CHANGED":
    case "EXPORT_TOO_LARGE":
      return new ApiError(item.error_code).message;
    case "JOB_EXECUTION_TIMEOUT":
      return "导出执行超时，未生成文件。";
    case "JOB_ATTEMPTS_EXHAUSTED":
      return "导出多次执行未完成，未生成文件。";
    case "DOCUMENT_VERSION_NOT_FOUND":
      return "所选正文版本已不可读取，未生成文件。";
    default:
      return "导出未能完成，未生成文件。";
  }
}

export function useExports(services: Pick<BackendServices, "documents" | "exports">, projectId: string) {
  const document = shallowRef<DocumentRead>();
  const versions = ref<DocumentVersionSummary[]>([]);
  const phase = ref<"loading" | "ready" | "missing" | "failed">("loading");
  const loadError = ref("");
  const records = ref<ExportRead[]>([]);
  const total = ref(0);
  const listError = ref("");
  const pending = ref<string>();
  const actionError = ref<{ scope: string; message: string }>();
  const controllers = new Set<AbortController>();
  const keys = new Map<string, string>();
  let disposed = false;
  let listSequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function controller() {
    const value = new AbortController();
    controllers.add(value);
    return value;
  }
  function release(value: AbortController) {
    controllers.delete(value);
  }

  /** A quiet load (returning to the cached page) keeps the current view until fresh versions arrive. */
  async function load(quiet = false) {
    if (!quiet || phase.value !== "ready") phase.value = "loading";
    loadError.value = "";
    const request = controller();
    try {
      const current = await services.documents.current(projectId, request.signal);
      const items: DocumentVersionSummary[] = [];
      for (let page = 0; page < VERSION_PAGES; page++) {
        const result = await services.documents.versions(projectId, current.id, { limit: 100, offset: page * 100 }, request.signal);
        items.push(...result.items);
        if (items.length >= result.total || !result.items.length) break;
      }
      if (disposed) return;
      document.value = current;
      versions.value = items.sort((a, b) => b.version - a.version);
      phase.value = "ready";
      await refresh();
    } catch (cause) {
      if (disposed || request.signal.aborted) return;
      const error = asApiError(cause);
      if (error.code === "DOCUMENT_NOT_FOUND") phase.value = "missing";
      else {
        phase.value = "failed";
        loadError.value = error.message;
      }
    } finally {
      release(request);
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = undefined;
    if (!disposed && records.value.some(isActiveExport)) timer = setTimeout(() => void refresh(), POLL_MS);
  }

  async function refresh() {
    const sequence = ++listSequence;
    const request = controller();
    try {
      const page = await services.exports.list(projectId, { limit: 20, offset: 0 }, request.signal);
      // A slower, older listing must not overwrite a newer one.
      if (disposed || sequence !== listSequence) return;
      records.value = page.items;
      total.value = page.total;
      listError.value = "";
    } catch (cause) {
      if (disposed || sequence !== listSequence || request.signal.aborted) return;
      listError.value = asApiError(cause).message;
    } finally {
      release(request);
      if (sequence === listSequence) schedule();
    }
  }

  function upsert(value: ExportRead) {
    const index = records.value.findIndex((item) => item.job_id === value.job_id);
    if (index >= 0) {
      // Never let a stale action response regress a terminal state already listed.
      const known = records.value[index]!;
      if (!isActiveExport(known) && isActiveExport(value)) return;
      records.value.splice(index, 1, value);
    } else {
      records.value.unshift(value);
      total.value += 1;
    }
  }

  async function run(scope: string, fingerprint: string, call: (key: string, signal: AbortSignal) => Promise<ExportRead>) {
    if (pending.value || disposed) return undefined;
    pending.value = scope;
    actionError.value = undefined;
    // An unknown transport outcome keeps its key, so a repeated click replays instead of duplicating.
    const key = keys.get(fingerprint) ?? crypto.randomUUID();
    keys.set(fingerprint, key);
    const request = controller();
    try {
      const value = await call(key, request.signal);
      keys.delete(fingerprint);
      if (disposed) return undefined;
      upsert(value);
      schedule();
      return value;
    } catch (cause) {
      const error = asApiError(cause);
      if (!RETRYABLE_TRANSPORT.has(error.code)) keys.delete(fingerprint);
      if (!disposed && !request.signal.aborted) actionError.value = { scope, message: error.message };
      return undefined;
    } finally {
      release(request);
      if (pending.value === scope) pending.value = undefined;
    }
  }

  const exportDocument = (version: number, format: DocumentFormat) => {
    const documentId = document.value?.id;
    if (!documentId) return Promise.resolve(undefined);
    return run("document", JSON.stringify(["document", documentId, version, format]), (key, signal) =>
      services.exports.exportDocument(projectId, { document_id: documentId, document_version: version, format }, key, signal),
    );
  };
  const exportChanges = (from: number, to: number | null, format: ChangeFormat) => {
    const documentId = document.value?.id;
    if (!documentId) return Promise.resolve(undefined);
    return run("change", JSON.stringify(["change", documentId, from, to, format]), (key, signal) =>
      services.exports.changeRecord(projectId, { document_id: documentId, from_version: from, to_version: to, format }, key, signal),
    );
  };
  const retry = (item: ExportRead) =>
    run(`retry:${item.job_id}`, `retry:${item.job_id}`, (key, signal) => services.exports.retry(projectId, item.job_id, key, signal));
  const cancel = (item: ExportRead) =>
    run(`cancel:${item.job_id}`, `cancel:${item.job_id}`, (_key, signal) => services.exports.cancel(projectId, item.job_id, signal));

  async function download(item: ExportRead) {
    const scope = `download:${item.job_id}`;
    if (pending.value || disposed) return;
    pending.value = scope;
    actionError.value = undefined;
    const request = controller();
    try {
      const { blob, filename } = await services.exports.download(projectId, item.job_id, request.signal);
      if (disposed) return;
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      if (!disposed && !request.signal.aborted) actionError.value = { scope, message: asApiError(cause).message };
    } finally {
      release(request);
      if (pending.value === scope) pending.value = undefined;
    }
  }

  onScopeDispose(() => {
    disposed = true;
    clearTimeout(timer);
    for (const request of controllers) request.abort();
    controllers.clear();
  });

  return {
    document,
    versions,
    phase,
    loadError,
    records,
    total,
    listError,
    pending,
    actionError,
    latestDocument: computed(() => records.value.find((item) => item.kind === "document_export")),
    latestChange: computed(() => records.value.find((item) => item.kind === "change_record")),
    load,
    refresh,
    exportDocument,
    exportChanges,
    retry,
    cancel,
    download,
  };
}
