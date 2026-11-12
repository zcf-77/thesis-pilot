import { usePreviewModule, type PreviewProject } from "./previewWorkspace.ts";

export type JobStatus = "queued" | "running" | "done" | "partial" | "failed" | "cancelled";
export const jobKinds = ["解析", "生成", "检索", "计划", "反馈", "评审", "配置", "导出"];
export const jobLabels: Record<JobStatus, string> = {
  queued: "排队中",
  running: "执行中",
  done: "已完成",
  partial: "部分完成",
  failed: "失败",
  cancelled: "已取消",
};
export interface JobAttempt {
  number: number;
  token: number;
  startedAt: string;
  finishedAt: string;
  status: JobStatus;
  input: string;
  diagnosis: string;
  snapshot: Record<string, unknown>;
}
export interface PreviewJob {
  id: string;
  title: string;
  kind: string;
  status: JobStatus;
  attempt: number;
  input: string;
  diagnosis: string;
  at: string;
  route: string;
  token: number;
  projectId?: string;
  sourceId?: string;
  snapshot?: Record<string, unknown>;
  attempts?: JobAttempt[];
}
export interface JobsState {
  jobs: PreviewJob[];
}
export interface JobSpec {
  title: string;
  kind: string;
  route: string;
  input: string;
  snapshot?: Record<string, unknown>;
  sourceId?: string;
  queued?: boolean;
}
export interface JobControls {
  cancel?: () => void;
  retry?: () => void;
}
export interface ProjectJobHandle {
  id: string;
  token: number;
  isActive: () => boolean;
  start: () => boolean;
  finish: (status: "done" | "partial" | "failed", diagnosis: string) => boolean;
  cancel: () => void;
}
const controls = new Map<string, JobControls>();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const stamp = () => new Date().toISOString();
const active = (job: PreviewJob) => job.status === "queued" || job.status === "running";

export function getProjectJobs(project: PreviewProject): JobsState {
  if (!project.modules.jobs) project.modules.jobs = { jobs: [] };
  return project.modules.jobs as JobsState;
}
export function useJobsState() {
  return usePreviewModule<JobsState>("jobs", () => ({ jobs: [] }));
}

function updateAttempt(job: PreviewJob) {
  const attempt = job.attempts?.find((a) => a.number === job.attempt);
  if (!attempt) return;
  attempt.status = job.status;
  attempt.diagnosis = job.diagnosis;
  if (!active(job)) attempt.finishedAt = stamp();
}

/** 固定项目与输入，不因用户导航而串项目；回调仅存内存，不进入备份。 */
export function startProjectJob(project: PreviewProject, spec: JobSpec, callbacks: JobControls = {}): ProjectJobHandle {
  const state = getProjectJobs(project);
  let job = spec.sourceId ? state.jobs.find((j) => j.sourceId === spec.sourceId) : undefined;
  if (job && active(job)) cancelPreviewJob(job);
  if (!job) {
    state.jobs.unshift({
      id: crypto.randomUUID(),
      projectId: project.id,
      sourceId: spec.sourceId,
      title: spec.title,
      kind: spec.kind,
      route: spec.route,
      input: spec.input,
      status: "queued",
      attempt: 0,
      token: 0,
      diagnosis: "",
      at: stamp(),
      attempts: [],
      snapshot: {},
    });
    job = state.jobs[0]!;
  }
  job.projectId = project.id;
  job.title = spec.title;
  job.kind = spec.kind;
  job.route = spec.route;
  job.input = spec.input;
  job.snapshot = clone({ projectId: project.id, docVersion: project.document.version, requirementVersion: project.requirementVersion, ...spec.snapshot });
  job.token += 1;
  job.attempt += 1;
  job.status = spec.queued ? "queued" : "running";
  job.at = stamp();
  job.diagnosis = spec.queued ? "等待执行；输入范围已固定。" : "正在执行；取消后不会接受本次迟到结果。";
  job.attempts ??= [];
  job.attempts.push({
    number: job.attempt,
    token: job.token,
    startedAt: job.at,
    finishedAt: "",
    status: job.status,
    input: job.input,
    diagnosis: job.diagnosis,
    snapshot: clone(job.snapshot),
  });
  controls.set(job.id, callbacks);
  const captured = job;
  const token = captured.token;
  return {
    id: captured.id,
    token,
    isActive: () => captured.token === token && active(captured),
    start: () => {
      if (captured.token !== token || captured.status !== "queued") return false;
      captured.status = "running";
      captured.diagnosis = "正在执行；输入范围已固定。";
      updateAttempt(captured);
      return true;
    },
    finish: (status, diagnosis) => {
      if (captured.token !== token || !active(captured)) return false;
      captured.status = status;
      captured.diagnosis = diagnosis;
      updateAttempt(captured);
      return true;
    },
    cancel: () => {
      if (captured.token === token) cancelPreviewJob(captured);
    },
  };
}
export function cancelPreviewJob(job: PreviewJob) {
  if (!active(job)) return;
  job.token += 1;
  job.status = "cancelled";
  job.diagnosis = "已取消，本次迟到结果不会写入；原输入与已有结果保留。";
  updateAttempt(job);
  controls.get(job.id)?.cancel?.();
}
export function canRetryProjectJob(job: PreviewJob) {
  return ["failed", "cancelled", "partial"].includes(job.status) && !!controls.get(job.id)?.retry;
}
export function retryProjectJob(job: PreviewJob): boolean {
  if (!canRetryProjectJob(job)) return false;
  controls.get(job.id)!.retry!();
  return true;
}
/** 兼容原有确定性测试和预览调用；仍遵守取消令牌。 */
export function finishPreviewJob(job: PreviewJob, token: number, fail: boolean) {
  if (job.token !== token || job.status !== "running") return;
  job.status = fail ? "failed" : "done";
  job.diagnosis = fail ? "模拟请求超时；原数据保留，可重试。" : "模拟任务完成；没有调用外部服务或修改论文。";
  updateAttempt(job);
}

/** 恢复仅结束丢失运行时的尝试，保留此前完成/失败的历史诊断。 */
export function normalizeRestoredJobs(value: unknown) {
  if (!record(value) || !Array.isArray(value.jobs)) return;
  for (const candidate of value.jobs) {
    if (!record(candidate)) continue;
    const job = candidate as unknown as PreviewJob;
    if (active(job)) {
      job.status = "cancelled";
      job.token += 1;
      job.diagnosis = "恢复时原执行已中断，输入与历史保留；请回到来源重新执行。";
    }
    for (const attempt of job.attempts ?? []) {
      if (["queued", "running"].includes(attempt.status)) {
        attempt.status = "cancelled";
        attempt.finishedAt = stamp();
        attempt.diagnosis = "恢复时原执行已中断；此尝试未继续运行。";
      }
    }
  }
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 2_000_000;
const natural = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const status = (v: unknown): v is JobStatus => typeof v === "string" && Object.hasOwn(jobLabels, v);
const snapshot = (v: unknown): v is Record<string, unknown> => record(v) && JSON.stringify(v).length <= 2_000_000;
export function validateJobsState(v: unknown): v is JobsState {
  if (!record(v) || !Array.isArray(v.jobs) || v.jobs.length > 10000) return false;
  const ids = new Set<string>();
  return v.jobs.every((j) => {
    if (
      !record(j) ||
      !text(j.id) ||
      ids.has(j.id) ||
      !text(j.title) ||
      !text(j.kind) ||
      !jobKinds.includes(j.kind) ||
      !status(j.status) ||
      !natural(j.attempt) ||
      !natural(j.token) ||
      !text(j.input) ||
      !text(j.diagnosis) ||
      !text(j.at) ||
      !text(j.route)
    )
      return false;
    ids.add(j.id);
    if (j.projectId !== undefined && !text(j.projectId)) return false;
    if (j.sourceId !== undefined && !text(j.sourceId)) return false;
    if (j.snapshot !== undefined && !snapshot(j.snapshot)) return false;
    if (j.attempts === undefined) return true;
    if (!Array.isArray(j.attempts) || j.attempts.length > 10000) return false;
    const numbers = new Set<number>();
    return j.attempts.every((a) => {
      if (
        !record(a) ||
        !natural(a.number) ||
        a.number === 0 ||
        a.number > (j.attempt as number) ||
        numbers.has(a.number) ||
        !natural(a.token) ||
        !status(a.status) ||
        !text(a.startedAt) ||
        !text(a.finishedAt) ||
        !text(a.input) ||
        !text(a.diagnosis) ||
        !snapshot(a.snapshot)
      )
        return false;
      numbers.add(a.number);
      return true;
    });
  });
}
