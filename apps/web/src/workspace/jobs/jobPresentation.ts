import { computed, ref, type Ref } from "vue";
import { createServiceJobsState, serviceJobFailure } from "../../lab/state/serviceJobs.ts";
import type { BackendServices, JobDetail, JobRead } from "../../services/index.ts";

export type JobKind = JobRead["kind"];
type Attempt = JobDetail["attempts"][number];

/** Kinds a formal workspace can hold; diagnostics are preview-only and rejected by the job state. */
export const kindOptions: { value: JobKind | "all"; label: string }[] = [
  { value: "all", label: "全部类型" },
  { value: "document_inspection", label: "正文结构检查" },
  { value: "configuration_probe", label: "配置试跑" },
  { value: "material_parse", label: "资料解析" },
  { value: "content_revision", label: "内容修订" },
];

export const attemptStatus: Record<Attempt["status"], { label: string; tone: "info" | "success" | "danger" | "ghost" | "warning"; live?: boolean }> = {
  running: { label: "执行中", tone: "info", live: true },
  succeeded: { label: "已完成", tone: "success" },
  failed: { label: "失败", tone: "danger" },
  cancelled: { label: "已取消", tone: "ghost" },
  lease_expired: { label: "执行中断", tone: "warning" },
};

export function attemptDiagnosis(attempt: Pick<Attempt, "status" | "error_code">) {
  switch (attempt.status) {
    case "running":
      return "正在执行，结果通过校验后才会保存。";
    case "succeeded":
      return "执行完成，结果已通过校验。";
    case "cancelled":
      return "已取消；之后返回的结果不会写入。";
    case "lease_expired":
      return "执行进程中断，本次没有产生结果。";
    case "failed":
      return serviceJobFailure({ status: "failed", error_code: attempt.error_code } as JobRead);
  }
}

/** Every attempt of a job runs on the same fixed input, scope and configuration. */
export function fixedInput(job: Pick<JobDetail, "resource_scope" | "input_snapshot" | "configuration">) {
  return JSON.stringify(
    { resource_scope: job.resource_scope ?? null, input_snapshot: job.input_snapshot ?? null, configuration: job.configuration ?? null },
    null,
    2,
  );
}

/**
 * The shared job state lists by status only. A second state over the same services adds the API's `kind`
 * filter, keeping its own records so cancel and retry stay validated against the rows it shows.
 */
export function useKindFilteredJobs(
  services: Pick<BackendServices, "sourceKey" | "jobs" | "projects">,
  projectId: Readonly<Ref<string | undefined>>,
  workspaceId: string | undefined,
) {
  const kind = ref<JobKind | "all">("all");
  const scopedProject = computed(() => (kind.value === "all" || !workspaceId ? undefined : projectId.value));
  const scoped = createServiceJobsState(
    {
      ...services,
      jobs: { ...services.jobs, list: (query, signal) => services.jobs.list({ ...query, kind: kind.value === "all" ? query.kind : kind.value }, signal) },
    },
    scopedProject,
    workspaceId,
  );
  function changeKind(next: JobKind | "all", status: JobRead["status"] | "all") {
    if (next === kind.value) return;
    // Passing through "all" resets the scoped state synchronously, so rows of the previous kind never linger.
    kind.value = "all";
    kind.value = next;
    if (next !== "all" && status !== "all") scoped.changeFilter(status);
  }
  return { kind, scoped, active: computed(() => scopedProject.value !== undefined), changeKind };
}
