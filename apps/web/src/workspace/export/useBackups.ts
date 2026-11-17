import { computed, onScopeDispose, ref, shallowRef } from "vue";
import { ApiError, asApiError, type BackendServices, type BackupRead, type RestoreRead } from "../../services/index.ts";

const POLL_MS = 1200;
const RETRYABLE_TRANSPORT = new Set(["REQUEST_TIMEOUT", "NETWORK_ERROR"]);
export const BACKUP_MAX_BYTES = 256 * 1024 * 1024;

export const isActive = (item: { status: string }) => item.status === "queued" || item.status === "running";

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Objects in a package, summed over every registered table. */
export const objectTotal = (counts: Record<string, number>) => Object.values(counts).reduce((sum, value) => sum + value, 0);

/** What happened, in one sentence; the caller adds the impact and the next step. */
export function backupFailure(item: BackupRead): string {
  if (item.status === "cancelled") return "备份已取消，未生成文件。";
  switch (item.error_code) {
    case "BACKUP_PACKAGE_TOO_LARGE":
      return "项目备份超过 256MiB 上限，未生成文件。";
    case "JOB_EXECUTION_TIMEOUT":
      return "备份执行超时，未生成文件。";
    case "JOB_ATTEMPTS_EXHAUSTED":
      return "备份多次执行未完成，未生成文件。";
    default:
      return "备份未能完成，未生成文件。";
  }
}

export function restoreFailure(item: RestoreRead): string {
  if (item.status === "cancelled") return "恢复已取消，没有创建新项目，现有项目不受影响。";
  return item.error_code ? new ApiError(item.error_code).message : "恢复未能完成，已整体回滚，没有生成半成品项目。";
}

export function useBackups(services: Pick<BackendServices, "backups">, projectId: string, onRestored: (restore: RestoreRead) => void) {
  const backups = ref<BackupRead[]>([]);
  const total = ref(0);
  const listError = ref("");
  const restore = shallowRef<RestoreRead>();
  const pending = ref<string>();
  const actionError = ref<{ scope: string; message: string }>();
  const controllers = new Set<AbortController>();
  const keys = new Map<string, string>();
  // Restores started from this page; only these navigate to the new copy when they finish.
  const followed = new Set<string>();
  let disposed = false;
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function controller() {
    const value = new AbortController();
    controllers.add(value);
    return value;
  }

  function schedule() {
    clearTimeout(timer);
    timer = undefined;
    if (!disposed && (backups.value.some(isActive) || (restore.value && isActive(restore.value)))) timer = setTimeout(() => void refresh(), POLL_MS);
  }

  function settleRestore(value: RestoreRead) {
    const known = restore.value;
    // A slower response must not regress a terminal state already shown.
    if (known && known.job_id === value.job_id && !isActive(known) && isActive(value)) return;
    restore.value = value;
    if (value.status === "succeeded" && value.result_project_id && followed.delete(value.job_id)) onRestored(value);
  }

  let firstLoad = true;
  async function latestActiveRestore(signal: AbortSignal) {
    // After a reload, keep showing a restore that is still in progress (never navigate for it).
    const page = await services.backups.restores({ limit: 1, offset: 0 }, signal);
    const latest = page.items[0];
    return latest && isActive(latest) ? latest : undefined;
  }

  async function refresh() {
    const current = ++sequence;
    const request = controller();
    try {
      const [page, restores] = await Promise.all([
        services.backups.list(projectId, { limit: 5, offset: 0 }, request.signal),
        restore.value && isActive(restore.value)
          ? services.backups.restore(restore.value.job_id, request.signal)
          : firstLoad && !restore.value
            ? latestActiveRestore(request.signal)
            : Promise.resolve(undefined),
      ]);
      if (disposed || current !== sequence) return;
      firstLoad = false;
      backups.value = page.items;
      total.value = page.total;
      listError.value = "";
      if (restores) settleRestore(restores);
    } catch (cause) {
      if (disposed || current !== sequence || request.signal.aborted) return;
      listError.value = asApiError(cause).message;
    } finally {
      controllers.delete(request);
      if (current === sequence) schedule();
    }
  }

  async function run<T>(scope: string, fingerprint: string, call: (key: string, signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
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
      return disposed ? undefined : value;
    } catch (cause) {
      const error = asApiError(cause);
      if (!RETRYABLE_TRANSPORT.has(error.code)) keys.delete(fingerprint);
      if (!disposed && !request.signal.aborted) actionError.value = { scope, message: error.message };
      return undefined;
    } finally {
      controllers.delete(request);
      if (pending.value === scope) pending.value = undefined;
    }
  }

  function upsert(value: BackupRead) {
    const index = backups.value.findIndex((item) => item.job_id === value.job_id);
    if (index >= 0) {
      const known = backups.value[index]!;
      if (!isActive(known) && isActive(value)) return;
      backups.value.splice(index, 1, value);
    } else {
      backups.value.unshift(value);
      total.value += 1;
    }
    schedule();
  }

  const create = async () => {
    const value = await run("create", "create", (key, signal) => services.backups.create(projectId, key, signal));
    if (value) upsert(value);
  };
  const cancel = async (item: BackupRead) => {
    const value = await run(`cancel:${item.job_id}`, `cancel:${item.job_id}`, (_key, signal) => services.backups.cancel(projectId, item.job_id, signal));
    if (value) upsert(value);
  };
  const retry = async (item: BackupRead) => {
    const value = await run(`retry:${item.job_id}`, `retry:${item.job_id}`, (key, signal) => services.backups.retry(projectId, item.job_id, key, signal));
    if (value) upsert(value);
  };
  async function download(item: BackupRead) {
    const result = await run(`download:${item.job_id}`, `download:${item.job_id}:${crypto.randomUUID()}`, (_key, signal) =>
      services.backups.download(projectId, item.job_id, signal),
    );
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = result.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Upload validates the whole package first; a rejected file stores nothing. */
  async function restoreFrom(file: File) {
    if (file.size > BACKUP_MAX_BYTES) {
      actionError.value = { scope: "restore", message: new ApiError("BACKUP_PACKAGE_TOO_LARGE").message };
      return false;
    }
    const fingerprint = `upload:${file.name}:${file.size}:${file.lastModified}`;
    const value = await run("restore", fingerprint, (key, signal) => services.backups.upload(file, file.name, key, signal));
    if (!value) return false;
    followed.add(value.job_id);
    settleRestore(value);
    schedule();
    return true;
  }
  const cancelRestore = async () => {
    const current = restore.value;
    if (!current) return;
    const value = await run(`cancel-restore:${current.job_id}`, `cancel-restore:${current.job_id}`, (_key, signal) =>
      services.backups.cancelRestore(current.job_id, signal),
    );
    if (value) {
      followed.delete(value.job_id);
      settleRestore(value);
    }
  };
  const dismissRestore = () => {
    if (restore.value && !isActive(restore.value)) restore.value = undefined;
  };

  onScopeDispose(() => {
    disposed = true;
    clearTimeout(timer);
    for (const request of controllers) request.abort();
    controllers.clear();
  });

  return {
    backups,
    total,
    listError,
    restore,
    pending,
    actionError,
    latest: computed(() => backups.value[0]),
    retried: computed(() => new Set(backups.value.flatMap((item) => (item.source_job_id ? [item.source_job_id] : [])))),
    refresh,
    create,
    cancel,
    retry,
    download,
    restoreFrom,
    cancelRestore,
    dismissRestore,
  };
}
