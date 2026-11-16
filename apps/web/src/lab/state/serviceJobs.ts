import { computed, inject, onScopeDispose, provide, reactive, ref, shallowRef, watch, type InjectionKey, type Ref } from "vue";
import { jobStatus } from "../../domain/vocab.ts";
import { ApiError, type BackendServices, type JobDetail, type JobQuery, type JobRead } from "../../services/index.ts";
import {
  isInspectionInput,
  isInspectionConfiguration,
  isProbeScope,
  isProbeConfiguration,
  isMaterialInput,
  isContentRevisionInput,
} from "../../services/validation.ts";
import {
  beginDiagnosticRequest,
  beginJobRequest,
  confirmDiagnosticRequest,
  confirmJobRequest,
  pendingDiagnosticKey,
} from "../components/integration/jobsRequests.ts";

export const diagnosticJobTitle = "执行链路诊断";
export const serviceJobTitle = (job: JobRead) =>
  ({
    diagnostic: diagnosticJobTitle,
    document_inspection: "正文结构检查",
    configuration_probe: "配置试跑",
    material_parse: "资料解析",
    content_revision: "内容修订",
    document_export: "正文导出",
    change_record: "修改说明",
  })[job.kind] ?? "未知任务类型";
export function stableJobValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJobValue).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJobValue(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const isActiveServiceJob = (job: JobRead) => job.status === "queued" || job.status === "running";
export const canRerunServiceJob = (job: JobRead) => job.kind !== "content_revision" && (job.status === "failed" || job.status === "cancelled");
export function assistantJobLink(job: JobRead) {
  if (job.kind !== "content_revision") return undefined;
  if (job.result?.kind === "content_revision") return { path: `/projects/${job.project_id}/write`, query: { assistantSessionId: job.result.session_id } };
  if (isContentRevisionInput(job.resource_scope)) return { path: `/projects/${job.project_id}/write`, query: { assistantRunId: job.resource_scope.run_id } };
  return undefined;
}
export function serviceJobStatus(job: JobRead) {
  const { label, tone, live } = jobStatus[job.status === "succeeded" ? "done" : job.status];
  return { label, tone, live };
}
export function serviceJobFailure(job: JobRead) {
  if (job.status !== "failed") return "";
  switch (job.error_code) {
    case "MATERIAL_UNSUPPORTED_TYPE":
    case "MATERIAL_PARSE_INVALID":
    case "MATERIAL_PARSE_LIMIT_EXCEEDED":
    case "MATERIAL_ORIGINAL_CORRUPT":
    case "MATERIAL_PARSER_VERSION_UNAVAILABLE":
    case "MATERIAL_PARSE_CONFLICT":
    case "EXPORT_SOURCE_CHANGED":
    case "EXPORT_TOO_LARGE":
      return new ApiError(job.error_code).message;
    case "JOB_EXECUTION_TIMEOUT":
      return "执行超时";
    case "JOB_RESULT_INVALID":
      return "结果未通过校验";
    case "JOB_ATTEMPTS_EXHAUSTED":
      return "多次执行未完成";
    case "MODEL_NOT_CONFIGURED":
    case "MODEL_AUTH_FAILED":
    case "MODEL_RATE_LIMITED":
    case "MODEL_TIMEOUT":
    case "MODEL_UNAVAILABLE":
    case "MODEL_INVALID_RESPONSE":
    case "MODEL_OUTPUT_TOO_LARGE":
      return new ApiError(job.error_code).message;
    default:
      return "执行失败";
  }
}

type JobAction = { type: "create"; fromId?: string } | { type: "cancel" | "retry"; id: string } | { type: "inspect-document" | "probe-configuration" };
const readError = (cause: unknown) => (cause instanceof ApiError ? cause.message : "任务服务暂时不可用，请稍后重试。");
const cancelledRequest = (cause: unknown) => cause instanceof ApiError && cause.code === "REQUEST_CANCELLED";
const listLimit = 12;
const trayLimit = 8;

export function createServiceJobsState(
  services: Pick<BackendServices, "sourceKey" | "jobs" | "projects">,
  projectId: Readonly<Ref<string | undefined>>,
  workspaceId?: string,
) {
  const records = reactive(new Map<string, JobRead>());
  const directoryIds = shallowRef<string[]>([]);
  const recentIds = shallowRef<string[]>([]);
  const activeIds = shallowRef<string[]>([]);
  const activeCount = ref<number | null>(null);
  const offset = ref(0);
  const total = ref(0);
  const filter = ref<JobRead["status"] | "all">("all");
  const loading = ref(false);
  const loadError = ref("");
  const action = shallowRef<JobAction | null>(null);
  const actionError = ref("");
  const notice = ref("");
  const pendingCreation = ref(false);
  const detailId = ref("");
  const detailError = ref("");
  const detailMissing = ref(false);
  const detailLoading = ref(false);
  const detailData = shallowRef<JobDetail>();
  const detail = computed(() => records.get(detailId.value));
  const detailNeedsRefresh = computed(() => {
    const selected = detail.value;
    return !!selected && (isActiveServiceJob(selected) || selected.updated_at !== detailData.value?.updated_at || selected.status !== detailData.value?.status);
  });
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
      return false;
    records.set(job.id, job);
    return true;
  }
  function checkProject(job: JobRead, expectedProjectId: string, expectedJobId?: string) {
    if (job.project_id !== expectedProjectId || (expectedJobId && job.id !== expectedJobId) || (workspaceId && job.kind === "diagnostic"))
      throw new ApiError("JOB_NOT_FOUND");
  }
  function schedulePoll(delay: number) {
    clearTimeout(pollTimer);
    pollTimer = undefined;
    if (
      projectId.value &&
      ((activeCount.value ?? 0) > 0 || directory.value.some(isActiveServiceJob) || tray.value.some(isActiveServiceJob) || detailNeedsRefresh.value)
    ) {
      pollTimer = setTimeout(() => {
        pollTimer = undefined;
        refreshInBackground();
      }, delay);
    }
  }

  async function refresh(nextOffset = offset.value, background = false) {
    const id = projectId.value;
    if (!id) return;
    const captured = generation;
    clearTimeout(pollTimer);
    pollTimer = undefined;
    listRequest?.abort();
    const request = (listRequest = new AbortController());
    const isCurrent = () => captured === generation && listRequest === request;
    const signal = request.signal;
    if (!background) loading.value = true;
    try {
      const projectQuery: JobQuery = { project_id: id, ...(!workspaceId && { kind: "diagnostic" }) };
      const status = filter.value === "all" ? undefined : [filter.value];
      const pageRequest = services.jobs.list({ ...projectQuery, limit: listLimit, offset: nextOffset, status }, signal);
      const [page, recent, active] = await Promise.all([
        pageRequest,
        nextOffset === 0 && !status ? pageRequest : services.jobs.list({ ...projectQuery, limit: trayLimit, offset: 0 }, signal),
        services.jobs.list({ ...projectQuery, limit: trayLimit, offset: 0, status: ["queued", "running"] }, signal),
      ]);
      if (!isCurrent()) return;
      if (page.offset !== 0 && page.offset >= page.total) {
        await refresh(Math.max(0, Math.floor((page.total - 1) / listLimit) * listLimit), background);
        return;
      }
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

      if (detailNeedsRefresh.value) void inspect(detailId.value, true);
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

  function changeFilter(status: typeof filter.value) {
    if (status === filter.value) return;
    filter.value = status;
    directoryIds.value = [];
    offset.value = total.value = 0;
    void refresh(0);
  }

  async function inspect(jobId: string, background = false) {
    if (background && detailRequest) return;
    detailRequest?.abort();
    detailRequest = undefined;
    if (detailId.value !== jobId) detailData.value = undefined;
    detailId.value = jobId;
    if (!background) {
      detailError.value = "";
      detailMissing.value = false;
    }
    const id = projectId.value;
    if (!id || !jobId) {
      detailLoading.value = false;
      return;
    }
    const captured = generation;
    const request = (detailRequest = new AbortController());
    const isCurrent = () => captured === generation && detailRequest === request && detailId.value === jobId;
    detailLoading.value = !background;
    try {
      const job = await services.jobs.get(jobId, request.signal, id);
      if (!isCurrent()) return;
      checkProject(job, id, jobId);
      if (
        workspaceId &&
        job.artifacts.some(
          (artifact) =>
            artifact.job_id !== job.id ||
            artifact.result.job_id !== job.id ||
            artifact.result.project_id !== id ||
            artifact.result.kind !== job.kind ||
            (artifact.result.kind === "document_inspection" &&
              (!isInspectionInput(job.resource_scope) ||
                artifact.result.document_id !== job.resource_scope.document_id ||
                artifact.result.document_version !== job.resource_scope.document_version)) ||
            (artifact.result.kind === "configuration_probe" &&
              (!isProbeScope(job.resource_scope) ||
                artifact.result.config_version_id !== job.resource_scope.config_version_id ||
                stableJobValue(artifact.result.version_ids) !== stableJobValue(job.resource_scope.version_ids))) ||
            (artifact.result.kind === "material_parse" &&
              (!isMaterialInput(job.resource_scope) ||
                artifact.result.material_id !== job.resource_scope.material_id ||
                artifact.result.original_version_id !== job.resource_scope.original_version_id ||
                artifact.result.original_sha256 !== job.resource_scope.original_sha256)) ||
            (artifact.result.kind === "content_revision" &&
              (!isContentRevisionInput(job.resource_scope) || artifact.result.run_id !== job.resource_scope.run_id)) ||
            !job.attempts.some((attempt) => attempt.id === artifact.attempt_id && attempt.status === "succeeded"),
        )
      )
        throw new ApiError("INVALID_RESPONSE");
      if (merge(job)) detailData.value = job;
      detailError.value = "";
      detailMissing.value = false;
    } catch (cause) {
      if (isCurrent() && !cancelledRequest(cause)) {
        detailError.value = readError(cause);
        detailMissing.value = cause instanceof ApiError && cause.code === "JOB_NOT_FOUND";
        if (detailMissing.value) {
          records.delete(jobId);
          detailData.value = undefined;
        }
      }
    } finally {
      if (isCurrent()) {
        detailRequest = undefined;
        detailLoading.value = false;
        if (!listRequest && !pollTimer && detailNeedsRefresh.value) schedulePoll(detailError.value ? 5000 : 1500);
      }
    }
  }

  async function createDiagnostic(from?: JobRead) {
    const id = projectId.value;
    if (workspaceId || !id || action.value || (from && (from.project_id !== id || !canRerunServiceJob(from) || pendingCreation.value))) return;
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

  async function submit(
    command: JobAction,
    identity: (string | number)[],
    requestJob: (id: string, key: string, signal: AbortSignal) => Promise<JobRead>,
    validate: (job: JobRead) => boolean,
  ) {
    const id = projectId.value;
    if (!id || !workspaceId || action.value) return;
    const captured = generation;
    const request = (actionRequest = new AbortController());
    const scope = "thesispilot.pending-job:" + JSON.stringify([services.sourceKey, workspaceId, id, ...identity]);
    const key = beginJobRequest(scope);
    action.value = command;
    actionError.value = notice.value = "";
    try {
      const job = await requestJob(id, key, request.signal);
      if (captured !== generation) return;
      checkProject(job, id);
      if (!validate(job)) throw new ApiError("INVALID_RESPONSE");
      confirmJobRequest(scope, key);
      merge(job);
      recentIds.value = [job.id, ...recentIds.value.filter((item) => item !== job.id)].slice(0, trayLimit);
      if (command.type === "retry") notice.value = "已创建重试任务。";
      await refresh(0, true);
      if (captured === generation) return job;
    } catch (cause) {
      if (captured === generation && !cancelledRequest(cause)) actionError.value = readError(cause);
    } finally {
      if (captured === generation) {
        actionRequest = undefined;
        action.value = null;
      }
    }
  }

  function inspectDocument(documentId: string, version: number) {
    return submit(
      { type: "inspect-document" },
      ["document_inspection", documentId, version],
      (id, key, signal) =>
        services.jobs.create(
          {
            project_id: id,
            kind: "document_inspection",
            input_snapshot: { schema_version: 1, document_id: documentId, document_version: version },
            configuration: { schema_version: 1, include_text_statistics: true },
          },
          key,
          signal,
        ),
      (job) =>
        job.kind === "document_inspection" &&
        isInspectionInput(job.resource_scope) &&
        job.resource_scope.document_id === documentId &&
        job.resource_scope.document_version === version &&
        isInspectionInput(job.input_snapshot) &&
        job.input_snapshot.document_id === documentId &&
        job.input_snapshot.document_version === version &&
        isInspectionConfiguration(job.configuration) &&
        job.configuration.include_text_statistics === true &&
        job.source_job_id === null,
    );
  }

  function probeConfiguration(versionId: string, variables: Record<string, string>) {
    const fixedVariables = { ...variables };
    return submit(
      { type: "probe-configuration" },
      ["configuration_probe", versionId, stableJobValue(fixedVariables)],
      (id, key, signal) =>
        services.jobs.create(
          { project_id: id, kind: "configuration_probe", input_snapshot: { schema_version: 1, config_version_id: versionId, variables: fixedVariables } },
          key,
          signal,
        ),
      (job) =>
        job.kind === "configuration_probe" &&
        isProbeScope(job.resource_scope) &&
        job.resource_scope.config_version_id === versionId &&
        isProbeConfiguration(job.configuration) &&
        job.configuration.config_version_id === versionId &&
        job.input_snapshot != null &&
        "config_version_id" in job.input_snapshot &&
        job.input_snapshot.config_version_id === versionId &&
        stableJobValue(job.input_snapshot.variables ?? {}) === stableJobValue(fixedVariables) &&
        job.source_job_id === null,
    );
  }

  function retry(job: JobRead) {
    const current = records.get(job.id);
    if (job.project_id !== projectId.value || !current || !canRerunServiceJob(current)) return;
    return submit(
      { type: "retry", id: job.id },
      ["retry", job.id],
      (id, key, signal) => services.jobs.retry(job.id, key, signal, id),
      (created) =>
        created.id !== current.id &&
        created.source_job_id === current.id &&
        created.kind === current.kind &&
        stableJobValue(created.resource_scope) === stableJobValue(current.resource_scope) &&
        stableJobValue(created.input_snapshot) === stableJobValue(current.input_snapshot) &&
        stableJobValue(created.configuration) === stableJobValue(current.configuration),
    );
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
      const confirmed = await services.jobs.cancel(job.id, request.signal, id);
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
    pollTimer = undefined;
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
      filter.value = "all";
      action.value = null;
      loadError.value = actionError.value = notice.value = detailId.value = detailError.value = "";
      loading.value = detailLoading.value = false;
      detailData.value = undefined;
      detailMissing.value = false;
      pendingCreation.value = !workspaceId && !!id && !!pendingDiagnosticKey(services.sourceKey, id);
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
    filter,
    loading,
    loadError,
    action,
    actionError,
    notice,
    pendingCreation,
    detail,
    detailData,
    detailLoading,
    detailError,
    detailMissing,
    refresh,
    refreshInBackground,
    changeFilter,
    inspect,
    createDiagnostic,
    inspectDocument,
    probeConfiguration,
    retry,
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
