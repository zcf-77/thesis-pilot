import { computed, inject, onScopeDispose, provide, reactive, ref, shallowRef, watch, type InjectionKey, type Ref } from "vue";
import { jobStatus } from "../../domain/vocab.ts";
import { ApiError, type BackendServices, type JobRead } from "../../services/index.ts";
import { beginDiagnosticRequest, confirmDiagnosticRequest, pendingDiagnosticKey } from "../components/integration/jobsRequests.ts";

export const diagnosticJobTitle = "执行链路诊断";
export const isActiveServiceJob = (job: JobRead) => job.status === "queued" || job.status === "running";
export const canRerunServiceJob = (job: JobRead) => job.status === "failed" || job.status === "cancelled";
export function serviceJobStatus(job: JobRead) {
  const { label, tone, live } = jobStatus[job.status === "succeeded" ? "done" : job.status];
  return { label, tone, live };
}
export function serviceJobFailure(job: JobRead) {
  if (job.status !== "failed") return "";
  switch (job.error_code) {
    case "JOB_EXECUTION_TIMEOUT":
      return "执行超时";
    case "JOB_RESULT_INVALID":
      return "结果未通过校验";
    case "JOB_ATTEMPTS_EXHAUSTED":
      return "多次执行未完成";
    default:
      return "执行失败";
  }
}

type JobAction = { type: "create"; fromId?: string } | { type: "cancel"; id: string };
const readError = (cause: unknown) => (cause instanceof ApiError ? cause.message : "任务服务暂时不可用，请稍后重试。");
const cancelledRequest = (cause: unknown) => cause instanceof ApiError && cause.code === "REQUEST_CANCELLED";
const listLimit = 12;
const trayLimit = 8;

export function createServiceJobsState(services: Pick<BackendServices, "sourceKey" | "jobs" | "projects">, projectId: Readonly<Ref<string | undefined>>) {
  const records = reactive(new Map<string, JobRead>());
  const directoryIds = shallowRef<string[]>([]);
  const recentIds = shallowRef<string[]>([]);
  const activeIds = shallowRef<string[]>([]);
  const activeCount = ref<number | null>(null);
  const offset = ref(0);
  const total = ref(0);
  const loading = ref(false);
  const loadError = ref("");
  const action = shallowRef<JobAction | null>(null);
  const actionError = ref("");
  const notice = ref("");
  const pendingCreation = ref(false);
  const detailId = ref("");
  const detailError = ref("");
  const detailLoading = ref(false);
  const detail = computed(() => records.get(detailId.value));
  const directory = computed(() => jobsFor(directoryIds.value));
  const tray = computed(() => jobsFor([...new Set([...activeIds.value, ...recentIds.value])]).slice(0, trayLimit));

  let generation = 0;
  let listRequest: AbortController | undefined;
  let actionRequest: AbortController | undefined;
  let detailRequest: AbortController | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  function jobsFor(ids: string[]) {
    return ids.flatMap((id) => {
      const job = records.get(id);
      return job ? [job] : [];
    });
  }
  function merge(job: JobRead) {
    const previous = records.get(job.id);
    // Reruns use a new ID, so a confirmed terminal task can never be active again.
    if (
      previous &&
      (previous.attempt > job.attempt ||
        Date.parse(previous.updated_at) > Date.parse(job.updated_at) ||
        (!isActiveServiceJob(previous) && isActiveServiceJob(job)) ||
        (previous.status === "running" && job.status === "queued"))
    )
      return;
    records.set(job.id, job);
  }
  function checkProject(job: JobRead, expectedProjectId: string, expectedJobId?: string) {
    if (job.project_id !== expectedProjectId || (expectedJobId && job.id !== expectedJobId)) throw new ApiError("JOB_NOT_FOUND");
  }
  function schedulePoll(delay: number) {
    clearTimeout(pollTimer);
    if (projectId.value && ((activeCount.value ?? 0) > 0 || directory.value.some(isActiveServiceJob) || tray.value.some(isActiveServiceJob))) {
      pollTimer = setTimeout(refreshInBackground, delay);
    }
  }

  async function refresh(nextOffset = offset.value, background = false) {
    const id = projectId.value;
    if (!id) return;
    const captured = generation;
    clearTimeout(pollTimer);
    listRequest?.abort();
    const request = (listRequest = new AbortController());
    const isCurrent = () => captured === generation && listRequest === request;
    const signal = request.signal;
    if (!background) loading.value = true;
    try {
      const pageRequest = services.jobs.list({ project_id: id, limit: listLimit, offset: nextOffset }, signal);
      const [page, recent, active] = await Promise.all([
        pageRequest,
        nextOffset === 0 ? pageRequest : services.jobs.list({ project_id: id, limit: trayLimit, offset: 0 }, signal),
        services.jobs.list({ project_id: id, limit: trayLimit, offset: 0, status: ["queued", "running"] }, signal),
      ]);
      if (!isCurrent()) return;
      const jobs = [...page.items, ...recent.items, ...active.items];
      for (const job of jobs) checkProject(job, id);
      for (const job of jobs) merge(job);
      directoryIds.value = page.items.map((job) => job.id);
      recentIds.value = recent.items.map((job) => job.id);
      activeIds.value = active.items.filter((job) => isActiveServiceJob(records.get(job.id)!)).map((job) => job.id);
      activeCount.value = active.total;
      total.value = page.total;
      offset.value = page.offset;
      loadError.value = "";

      const selected = detail.value;
      if (selected && isActiveServiceJob(selected) && !jobs.some((job) => job.id === selected.id)) {
        const latest = await services.jobs.get(selected.id, signal);
        if (!isCurrent()) return;
        checkProject(latest, id, selected.id);
        merge(latest);
      }
    } catch (cause) {
      if (isCurrent() && !cancelledRequest(cause)) loadError.value = readError(cause);
    } finally {
      if (isCurrent()) {
        listRequest = undefined;
        loading.value = false;
        schedulePoll(loadError.value ? 5000 : 1500);
      }
    }
  }
  function refreshInBackground() {
    if (!listRequest) void refresh(offset.value, true);
  }

  async function inspect(jobId: string) {
    detailRequest?.abort();
    detailId.value = jobId;
    detailError.value = "";
    const id = projectId.value;
    if (!id || !jobId) {
      detailLoading.value = false;
      return;
    }
    const captured = generation;
    const request = (detailRequest = new AbortController());
    const isCurrent = () => captured === generation && detailRequest === request && detailId.value === jobId;
    detailLoading.value = true;
    try {
      const job = await services.jobs.get(jobId, request.signal);
      if (!isCurrent()) return;
      checkProject(job, id, jobId);
      merge(job);
    } catch (cause) {
      if (isCurrent() && !cancelledRequest(cause)) detailError.value = readError(cause);
    } finally {
      if (isCurrent()) {
        detailRequest = undefined;
        detailLoading.value = false;
      }
    }
  }

  async function createDiagnostic(from?: JobRead) {
    const id = projectId.value;
    if (!id || action.value || (from && (from.project_id !== id || !canRerunServiceJob(from) || pendingCreation.value))) return;
    const captured = generation;
    const request = (actionRequest = new AbortController());
    const key = beginDiagnosticRequest(services.sourceKey, id);
    pendingCreation.value = true;
    action.value = { type: "create", fromId: from?.id };
    actionError.value = notice.value = "";
    try {
      const job = await services.jobs.create({ project_id: id, kind: "diagnostic" }, key, request.signal);
      if (captured !== generation) return;
      checkProject(job, id);
      confirmDiagnosticRequest(services.sourceKey, id, key);
      pendingCreation.value = false;
      merge(job);
      directoryIds.value = [job.id, ...directoryIds.value.filter((item) => item !== job.id)].slice(0, listLimit);
      recentIds.value = [job.id, ...recentIds.value.filter((item) => item !== job.id)].slice(0, trayLimit);
      notice.value = "诊断任务已受理。";
      await refresh(0, true);
    } catch (cause) {
      if (captured === generation && !cancelledRequest(cause)) actionError.value = readError(cause);
    } finally {
      if (captured === generation) {
        actionRequest = undefined;
        action.value = null;
      }
    }
  }

  async function cancel(job: JobRead) {
    const id = projectId.value;
    const current = records.get(job.id);
    if (!id || action.value || job.project_id !== id || !current || !isActiveServiceJob(current)) return;
    const captured = generation;
    const request = (actionRequest = new AbortController());
    action.value = { type: "cancel", id: job.id };
    actionError.value = notice.value = "";
    try {
      const confirmed = await services.jobs.cancel(job.id, request.signal);
      if (captured !== generation) return;
      checkProject(confirmed, id, job.id);
      if (confirmed.status !== "cancelled") throw new ApiError("INVALID_RESPONSE");
      merge(confirmed);
      notice.value = "任务已取消。";
      await refresh(offset.value, true);
    } catch (cause) {
      if (captured !== generation || cancelledRequest(cause)) return;
      actionError.value = readError(cause);
      await refresh(offset.value, true);
    } finally {
      if (captured === generation) {
        actionRequest = undefined;
        action.value = null;
      }
    }
  }

  function stop() {
    generation += 1;
    clearTimeout(pollTimer);
    listRequest?.abort();
    actionRequest?.abort();
    detailRequest?.abort();
    listRequest = actionRequest = detailRequest = undefined;
  }
  watch(
    projectId,
    (id) => {
      stop();
      records.clear();
      directoryIds.value = recentIds.value = activeIds.value = [];
      activeCount.value = null;
      total.value = offset.value = 0;
      action.value = null;
      loadError.value = actionError.value = notice.value = detailId.value = detailError.value = "";
      loading.value = detailLoading.value = false;
      pendingCreation.value = !!id && !!pendingDiagnosticKey(services.sourceKey, id);
      if (id) void refresh(0);
    },
    { immediate: true, flush: "sync" },
  );
  onScopeDispose(stop);

  if (typeof window !== "undefined") {
    window.addEventListener("focus", refreshInBackground);
    onScopeDispose(() => window.removeEventListener("focus", refreshInBackground));
  }

  return {
    projectId,
    directory,
    tray,
    activeCount,
    listLimit,
    offset,
    total,
    loading,
    loadError,
    action,
    actionError,
    notice,
    pendingCreation,
    detail,
    detailLoading,
    detailError,
    refresh,
    refreshInBackground,
    inspect,
    createDiagnostic,
    cancel,
  };
}

type ServiceJobsState = ReturnType<typeof createServiceJobsState>;
const serviceJobsKey: InjectionKey<ServiceJobsState> = Symbol("service-jobs");
export function provideServiceJobs(services: BackendServices, projectId: Readonly<Ref<string | undefined>>) {
  provide(serviceJobsKey, createServiceJobsState(services, projectId));
}
export function useServiceJobs() {
  return inject(serviceJobsKey, undefined);
}
export type { ServiceJobsState };
