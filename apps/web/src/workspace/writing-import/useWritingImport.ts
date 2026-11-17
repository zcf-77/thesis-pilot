import { computed, onScopeDispose, ref, shallowRef } from "vue";
import type { BackendServices, OfficeImportRead, OfficeImportReceipt } from "../../services/index.ts";
import { ApiError, asApiError } from "../../services/errors.ts";
import { beginJobRequest, confirmJobRequest } from "../../lab/components/integration/jobsRequests.ts";
import { bytesToBase64, materialFileError, materialStem } from "../materials/materialPresentation.ts";

export interface ImportDocument {
  id: string;
  version: number;
}
export interface DocxOriginal {
  /** `${materialId}:${originalId}`，供 TpSelect 使用。 */
  value: string;
  materialId: string;
  originalId: string;
  label: string;
  filename: string;
}
type Busy = "" | "originals" | "upload" | "start" | "cancel" | "retry" | "confirm";

const POLL_MS = 1200;
const MATERIAL_PAGES = 3;
const UNKNOWN_OUTCOME = new Set(["REQUEST_TIMEOUT", "NETWORK_ERROR", "INVALID_RESPONSE"]);
export const isActiveImport = (job: OfficeImportRead | undefined) => job?.status === "queued" || job?.status === "running";

/** What happened to the import job, three-part (what → manuscript safe → next step). */
export function importFailure(job: OfficeImportRead): string {
  if (job.status === "cancelled") return "导入已取消，没有生成预览。正文没有改变，可按原输入重新导入。";
  switch (job.error_code) {
    case "JOB_EXECUTION_TIMEOUT":
      return "转换执行超时，没有生成预览。正文没有改变，可按原输入重试。";
    case "JOB_ATTEMPTS_EXHAUSTED":
      return "转换多次执行未完成，没有生成预览。正文没有改变，可按原输入重试。";
    default:
      return job.error_code ? new ApiError(job.error_code).message : "转换未能完成，没有生成预览。正文没有改变，可按原输入重试。";
  }
}

/**
 * Word 导入流程：选文件或已有原件 → 上传为资料 → 后台转换 → 预览 → 学生确认。
 * 离开面板只停止查询，不取消远端任务；旧任务或旧请求的迟到响应不会覆盖当前状态。
 */
export function useWritingImport(services: Pick<BackendServices, "sourceKey" | "materials" | "officeImports">, projectId: string) {
  const file = shallowRef<File>();
  const fileError = ref("");
  const originals = ref<DocxOriginal[]>([]);
  const originalChoice = ref("");
  const job = shallowRef<OfficeImportRead>();
  const receipt = shallowRef<OfficeImportReceipt>();
  const busy = ref<Busy>("");
  const error = ref("");
  const controllers = new Set<AbortController>();
  const pendingConfirm = new Map<string, string>();
  let disposed = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const preview = computed(() => (job.value?.status === "succeeded" ? job.value.preview : null));
  const ready = computed(() => !!file.value || !!originalChoice.value);

  function controller() {
    const value = new AbortController();
    controllers.add(value);
    return value;
  }
  function release(value: AbortController) {
    controllers.delete(value);
  }
  function stopPolling() {
    clearTimeout(timer);
    timer = undefined;
  }
  function schedule() {
    stopPolling();
    if (!disposed && isActiveImport(job.value)) timer = setTimeout(() => void poll(), POLL_MS);
  }
  /** Adopt a job response only for the job currently shown, and never regress a finished job to active. */
  function accept(value: OfficeImportRead, expected: number) {
    if (disposed || expected !== generation) return false;
    const known = job.value;
    if (known && known.job_id === value.job_id && !isActiveImport(known) && isActiveImport(value)) return false;
    job.value = value;
    schedule();
    return true;
  }
  function track(value: OfficeImportRead) {
    generation++;
    receipt.value = undefined;
    job.value = undefined;
    accept(value, generation);
  }

  async function poll() {
    const current = job.value;
    if (!current) return;
    const expected = generation;
    const request = controller();
    try {
      accept(await services.officeImports.get(projectId, current.job_id, request.signal), expected);
    } catch (cause) {
      if (disposed || expected !== generation || request.signal.aborted) return;
      // A failed poll keeps the last confirmed state; the next tick asks again.
      error.value = asApiError(cause).message;
      schedule();
    } finally {
      release(request);
    }
  }

  /** Docx originals already kept in the project's materials (the current original of each material). */
  async function loadOriginals() {
    if (busy.value || disposed) return;
    busy.value = "originals";
    const request = controller();
    try {
      const found: DocxOriginal[] = [];
      for (let page = 0; page < MATERIAL_PAGES; page++) {
        const result = await services.materials.list(projectId, { limit: 100, offset: page * 100 }, request.signal);
        for (const material of result.items) {
          if (material.removed) continue;
          const original = await services.materials.original(projectId, material.id, material.current_original_id, request.signal);
          if (original.file_type === "docx")
            found.push({
              value: `${material.id}:${original.id}`,
              materialId: material.id,
              originalId: original.id,
              label: `${material.name} · ${original.filename}`,
              filename: original.filename,
            });
        }
        if ((page + 1) * 100 >= result.total || !result.items.length) break;
      }
      if (disposed) return;
      originals.value = found;
      if (!found.some((item) => item.value === originalChoice.value)) originalChoice.value = "";
    } catch (cause) {
      if (!disposed && !request.signal.aborted) error.value = asApiError(cause).message;
    } finally {
      release(request);
      if (busy.value === "originals") busy.value = "";
    }
  }

  function pickFile(next: File | undefined) {
    fileError.value = "";
    if (!next) return;
    const problem = !/\.docx$/i.test(next.name) ? "只能导入 Word 原件（.docx）。" : materialFileError(next);
    if (problem) {
      file.value = undefined;
      fileError.value = problem;
      return;
    }
    file.value = next;
    originalChoice.value = "";
  }
  function chooseOriginal(value: string) {
    originalChoice.value = value;
    if (value) {
      file.value = undefined;
      fileError.value = "";
    }
  }

  async function upload(chosen: File, signal: AbortSignal) {
    const bytes = new Uint8Array(await chosen.arrayBuffer());
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
    const scope = "thesispilot.pending-office-upload:" + JSON.stringify([services.sourceKey, projectId, chosen.name, digest]);
    const key = beginJobRequest(scope);
    const result = await services.materials.upload(
      projectId,
      { name: materialStem(chosen.name), kind: "other", filename: chosen.name, file_type: "docx", content_base64: bytesToBase64(bytes) },
      key,
      signal,
    );
    confirmJobRequest(scope, key);
    return { materialId: result.material.id, originalId: result.original.id };
  }

  /** Upload (when a file was chosen) and start the conversion; an unknown outcome keeps the same keys for a replay. */
  async function start() {
    if (busy.value || disposed || !ready.value) return;
    error.value = "";
    const request = controller();
    try {
      const chosen = file.value;
      let source: { materialId: string; originalId: string } | undefined = originals.value.find((item) => item.value === originalChoice.value);
      if (chosen) {
        busy.value = "upload";
        source = await upload(chosen, request.signal);
        if (disposed) return;
        // The kept original is now a material; a failed start below can be retried from the list without uploading again.
        const value = `${source.materialId}:${source.originalId}`;
        if (!originals.value.some((item) => item.value === value))
          originals.value = [{ value, ...source, label: `${materialStem(chosen.name)} · ${chosen.name}`, filename: chosen.name }, ...originals.value];
        file.value = undefined;
        originalChoice.value = value;
      }
      if (!source) return;
      busy.value = "start";
      const scope = "thesispilot.pending-office-import:" + JSON.stringify([services.sourceKey, projectId, source.materialId, source.originalId]);
      const key = beginJobRequest(scope);
      const created = await services.officeImports.create(projectId, { material_id: source.materialId, original_id: source.originalId }, key, request.signal);
      confirmJobRequest(scope, key);
      if (disposed) return;
      track(created);
    } catch (cause) {
      if (!disposed && !request.signal.aborted) error.value = asApiError(cause).message;
    } finally {
      release(request);
      busy.value = "";
    }
  }

  async function cancel() {
    const current = job.value;
    if (!current || !isActiveImport(current) || busy.value) return;
    busy.value = "cancel";
    error.value = "";
    const expected = generation;
    const request = controller();
    try {
      accept(await services.officeImports.cancel(projectId, current.job_id, request.signal), expected);
    } catch (cause) {
      if (!disposed && !request.signal.aborted) error.value = asApiError(cause).message;
    } finally {
      release(request);
      busy.value = "";
    }
  }

  async function retry() {
    const current = job.value;
    if (!current || isActiveImport(current) || current.status === "succeeded" || busy.value) return;
    busy.value = "retry";
    error.value = "";
    const scope = "thesispilot.pending-office-retry:" + JSON.stringify([services.sourceKey, projectId, current.job_id]);
    const key = beginJobRequest(scope);
    const request = controller();
    try {
      const next = await services.officeImports.retry(projectId, current.job_id, key, request.signal);
      confirmJobRequest(scope, key);
      if (!disposed) track(next);
    } catch (cause) {
      const issue = asApiError(cause);
      if (!UNKNOWN_OUTCOME.has(issue.code)) confirmJobRequest(scope, key);
      if (!disposed && !request.signal.aborted) error.value = issue.message;
    } finally {
      release(request);
      busy.value = "";
    }
  }

  /**
   * The student's decision: create the first manuscript, or append a new version on top of `document.version`.
   * Returns the receipt when the server created a version; the caller then reloads the manuscript.
   */
  async function confirm(document: ImportDocument | null) {
    const current = job.value;
    const view = preview.value;
    if (!current || !view || busy.value || disposed) return undefined;
    const mode = document ? ("new_version" as const) : ("create" as const);
    if (mode === "create" ? !view.can_create : !view.can_append) return undefined;
    busy.value = "confirm";
    error.value = "";
    const fingerprint = JSON.stringify([services.sourceKey, projectId, current.job_id, mode, document?.version ?? null]);
    const commandId = pendingConfirm.get(fingerprint) ?? crypto.randomUUID();
    pendingConfirm.set(fingerprint, commandId);
    const expected = generation;
    const request = controller();
    try {
      const result = await services.officeImports.confirm(
        projectId,
        current.job_id,
        mode === "create" ? { command_id: commandId, mode } : { command_id: commandId, mode, expected_version: document!.version },
        request.signal,
      );
      pendingConfirm.delete(fingerprint);
      if (disposed || expected !== generation) return undefined;
      receipt.value = result;
      return result;
    } catch (cause) {
      const issue = asApiError(cause);
      if (!UNKNOWN_OUTCOME.has(issue.code)) pendingConfirm.delete(fingerprint);
      if (disposed || request.signal.aborted || expected !== generation) return undefined;
      error.value = UNKNOWN_OUTCOME.has(issue.code) ? "导入结果尚未确认，正文可能已更新。再次确认会沿用同一操作标识，不会重复导入。" : issue.message;
      // The preview's create/append availability is computed from the current manuscript; refresh it after a refusal.
      if (!UNKNOWN_OUTCOME.has(issue.code)) void poll();
      return undefined;
    } finally {
      release(request);
      busy.value = "";
    }
  }

  /** Back to choosing a file; the previous remote job keeps running and stays in the job center. */
  function reset() {
    generation++;
    stopPolling();
    job.value = undefined;
    receipt.value = undefined;
    error.value = "";
    file.value = undefined;
    fileError.value = "";
  }

  /** Resume a conversion that is still running from an earlier visit. */
  async function resume() {
    const expected = generation;
    const request = controller();
    try {
      const page = await services.officeImports.list(projectId, { limit: 1, offset: 0 }, request.signal);
      const latest = page.items[0];
      if (latest && isActiveImport(latest) && !job.value && expected === generation) track(latest);
    } catch {
      // Resuming is a convenience; the job center still lists the task.
    } finally {
      release(request);
    }
  }

  onScopeDispose(() => {
    disposed = true;
    stopPolling();
    for (const request of controllers) request.abort();
    controllers.clear();
  });

  return {
    file,
    fileError,
    originals,
    originalChoice,
    job,
    preview,
    receipt,
    busy,
    error,
    ready,
    pickFile,
    chooseOriginal,
    loadOriginals,
    start,
    cancel,
    retry,
    confirm,
    reset,
    resume,
  };
}
