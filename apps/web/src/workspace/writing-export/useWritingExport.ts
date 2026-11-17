import { computed, onScopeDispose, ref, shallowRef } from "vue";
import type { BackendServices, DocumentOfficeSourceRead, ExportRead } from "../../services/index.ts";
import { asApiError } from "../../services/errors.ts";
import { officeModes, type OfficeMode, type OfficeSourceState } from "../export/useExports.ts";

export type QuickFormat = "docx" | "pdf";
export const quickFormats: { value: QuickFormat; label: string }[] = [
  { value: "docx", label: "Word" },
  { value: "pdf", label: "PDF" },
];
const UNKNOWN_OUTCOME = new Set(["REQUEST_TIMEOUT", "NETWORK_ERROR", "INVALID_RESPONSE"]);

/**
 * 写作页快捷导出：固定当前已保存版本，Word/PDF 二选一；有导入原件时默认保留原件。
 * 文件生成、下载和导出说明都在导出页查看。
 */
export function useWritingExport(services: Pick<BackendServices, "officeImports" | "exports">, projectId: string) {
  const format = ref<QuickFormat>("docx");
  const mode = ref<OfficeMode>("preserve");
  const trackChanges = ref(false);
  const source = shallowRef<OfficeSourceState>({ status: "loading" });
  const busy = ref(false);
  const error = ref("");
  const controllers = new Set<AbortController>();
  const keys = new Map<string, string>();
  let sequence = 0;
  let disposed = false;
  let target: { id: string; version: number } | undefined;

  const canPreserve = computed(() => source.value.status === "ready");
  const effectiveMode = computed<OfficeMode>(() => (canPreserve.value ? mode.value : "regenerate"));
  const hint = computed(() => officeModes.find((item) => item.value === effectiveMode.value)!.hint);
  const tracked = computed(() => format.value === "docx" && effectiveMode.value === "preserve" && trackChanges.value);

  function controller() {
    const value = new AbortController();
    controllers.add(value);
    return value;
  }

  /** Look up the Word original kept for this version; only the latest document wins. */
  async function load(document: { id: string; version: number } | null) {
    const current = ++sequence;
    target = document ?? undefined;
    error.value = "";
    if (!document) {
      source.value = { status: "none" };
      return;
    }
    source.value = { status: "loading" };
    const request = controller();
    try {
      const found: DocumentOfficeSourceRead = await services.officeImports.source(projectId, document.id, document.version, request.signal);
      if (!disposed && current === sequence) source.value = { status: "ready", source: found };
    } catch (cause) {
      if (disposed || current !== sequence || request.signal.aborted) return;
      const issue = asApiError(cause);
      source.value = issue.code === "OFFICE_IMPORT_SOURCE_NOT_FOUND" ? { status: "none" } : { status: "failed", message: issue.message };
    } finally {
      controllers.delete(request);
    }
  }

  async function submit(): Promise<ExportRead | undefined> {
    const document = target;
    if (!document || busy.value || disposed || source.value.status === "loading") return undefined;
    busy.value = true;
    error.value = "";
    const input = {
      document_id: document.id,
      document_version: document.version,
      format: format.value,
      office_mode: effectiveMode.value,
      track_changes: tracked.value,
    };
    const fingerprint = JSON.stringify(input);
    // An unknown transport outcome keeps its key, so pressing again replays instead of starting a second export.
    const key = keys.get(fingerprint) ?? crypto.randomUUID();
    keys.set(fingerprint, key);
    const request = controller();
    try {
      const created = await services.exports.exportDocument(projectId, input, key, request.signal);
      keys.delete(fingerprint);
      return disposed ? undefined : created;
    } catch (cause) {
      const issue = asApiError(cause);
      if (!UNKNOWN_OUTCOME.has(issue.code)) keys.delete(fingerprint);
      if (!disposed && !request.signal.aborted) error.value = issue.message;
      return undefined;
    } finally {
      controllers.delete(request);
      busy.value = false;
    }
  }

  onScopeDispose(() => {
    disposed = true;
    for (const request of controllers) request.abort();
    controllers.clear();
  });

  return { format, mode, trackChanges, source, busy, error, canPreserve, effectiveMode, hint, tracked, load, submit };
}
