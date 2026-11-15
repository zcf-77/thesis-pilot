<script setup lang="ts">
import { computed, onScopeDispose, shallowRef, ref, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { BackendServices, JobRead } from "@/services";
import { ApiError, asApiError } from "@/services/errors";
import { serviceJobFailure, serviceJobStatus } from "@/lab/state/serviceJobs";
import { beginJobRequest, confirmJobRequest } from "@/lab/components/integration/jobsRequests";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { taskUpdateAllowed } from "./materialPresentation";

const props = defineProps<{ services: BackendServices; job: JobRead }>();
const emit = defineEmits<{ updated: [job: JobRead]; finished: [job: JobRead]; openJob: [job: JobRead] }>();
const current = shallowRef(props.job);
const active = computed(() => current.value.status === "queued" || current.value.status === "running");
const busy = ref(false);
const checking = ref(false);
const error = ref("");
const notice = ref("");
let request: AbortController | undefined;
let pollRequest: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let retryCommand: { job: JobRead; scope: string; key: string } | undefined;
let finishedId = "";
let disposed = false;

function schedule() {
  if (timer) clearTimeout(timer);
  if (!disposed && active.value) timer = setTimeout(() => void refresh(), 1200);
}
function accept(job: JobRead) {
  if (!taskUpdateAllowed(current.value, job)) return;
  current.value = job;
  emit("updated", job);
  if (job.status === "succeeded" && finishedId !== job.id) {
    finishedId = job.id;
    emit("finished", job);
  }
}
async function refresh() {
  if (checking.value || disposed) return;
  pollRequest?.abort();
  const controller = new AbortController();
  pollRequest = controller;
  checking.value = true;
  const job = current.value;
  try {
    const latest = await props.services.jobs.get(job.id, controller.signal, job.project_id);
    if (!controller.signal.aborted && current.value.id === job.id) {
      accept(latest);
      error.value = "";
    }
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) {
      checking.value = false;
      if (!error.value) schedule();
    }
  }
}
async function cancel() {
  if (busy.value || !active.value) return;
  const job = current.value;
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  error.value = "";
  try {
    const latest = await props.services.jobs.cancel(job.id, controller.signal, job.project_id);
    if (!controller.signal.aborted && current.value.id === job.id) {
      accept(latest);
      notice.value = latest.status === "cancelled" ? "服务端已确认取消，原件继续保留。" : "已读取服务端状态，请以当前任务为准。";
      schedule();
    }
  } catch (problem) {
    if (!controller.signal.aborted) error.value = `${asApiError(problem).message} 请刷新核对取消结果。`;
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
async function retry() {
  if (busy.value || active.value) return;
  if (!retryCommand) {
    const job = current.value;
    const scope = "thesispilot.pending-material-retry:" + JSON.stringify([props.services.sourceKey, job.project_id, job.id]);
    retryCommand = { job, scope, key: beginJobRequest(scope) };
  }
  const command = retryCommand;
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  error.value = "";
  try {
    const latest = await props.services.jobs.retry(command.job.id, command.key, controller.signal, command.job.project_id);
    if (!controller.signal.aborted) {
      if (latest.project_id !== command.job.project_id || latest.source_job_id !== command.job.id) throw new ApiError("INVALID_RESPONSE");
      confirmJobRequest(command.scope, command.key);
      retryCommand = undefined;
      accept(latest);
      notice.value = "已创建固定原件的重试任务。";
      schedule();
    }
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      if (issue.status !== undefined && issue.status < 500 && issue.code !== "INVALID_RESPONSE") {
        confirmJobRequest(command.scope, command.key);
        retryCommand = undefined;
      }
      error.value = retryCommand ? "重试结果未知，请继续使用原请求确认。" : issue.message;
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
watch(
  () => props.job,
  (job) => {
    if (taskUpdateAllowed(current.value, job)) current.value = job;
    schedule();
  },
  { immediate: true },
);
onScopeDispose(() => {
  disposed = true;
  request?.abort();
  pollRequest?.abort();
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <section class="material-task studio-stack" aria-label="资料解析任务">
    <div class="studio-row">
      <h3 class="tp-heading">资料解析任务</h3>
      <TpStatus v-bind="serviceJobStatus(current)" />
    </div>
    <p class="tp-caption">确定性解析 · 不调用模型 · 不修改正式稿</p>
    <p v-if="serviceJobFailure(current)" class="studio-notice" role="alert">
      {{ serviceJobFailure(current) }}<span v-if="current.error_code">（{{ current.error_code }}）</span>
    </p>
    <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="error" :key="error" class="studio-notice" role="alert">{{ error }}</p></Transition>
    <p v-if="notice" role="status" class="tp-caption">{{ notice }}</p>
    <div class="screen-actions">
      <TpButton v-if="active" size="sm" :disabled="busy" @click="cancel">取消解析</TpButton
      ><TpButton v-else-if="current.status === 'failed' || current.status === 'cancelled'" size="sm" :disabled="busy" @click="retry">重试解析</TpButton
      ><TpButton size="sm" :disabled="checking" @click="refresh">刷新解析状态</TpButton
      ><TpButton size="sm" variant="ghost" @click="emit('openJob', current)">在任务中心查看</TpButton>
    </div>
    <p v-if="active" class="tp-caption" role="status">正在等待服务端结果；离开页面不会取消远端任务。</p>
  </section>
</template>

<style scoped>
.material-task {
  border-top: 1px solid var(--tp-line);
  padding-top: 18px;
}
</style>
