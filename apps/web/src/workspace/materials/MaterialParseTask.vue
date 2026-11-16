<script setup lang="ts">
import { computed, onScopeDispose, shallowRef, ref, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpProgress from "@/components/ui/TpProgress.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { BackendServices, JobRead } from "@/services";
import { ApiError, asApiError } from "@/services/errors";
import { serviceJobFailure } from "@/lab/state/serviceJobs";
import { beginJobRequest, confirmJobRequest } from "@/lab/components/integration/jobsRequests";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { materialParseState, taskUpdateAllowed } from "./materialPresentation";

/** Status row, progress and cancel/retry for the parse task of one original. Extra actions come through the slot. */
const props = defineProps<{ services: BackendServices; job?: JobRead; summary?: { status: "complete" | "partial" }; loading?: boolean }>();
const emit = defineEmits<{ updated: [job: JobRead]; finished: [job: JobRead]; openJob: [job: JobRead] }>();
const current = shallowRef(props.job);
const active = computed(() => current.value?.status === "queued" || current.value?.status === "running");
const state = computed(() => materialParseState(current.value, props.summary, props.loading));
const failure = computed(() => {
  const message = current.value ? serviceJobFailure(current.value) : "";
  if (!message) return "";
  return /原件/.test(message) ? message : `${message.replace(/。$/, "")}。原件已保留，可重试解析。`;
});
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
  const job = current.value;
  if (!job || checking.value || disposed) return;
  pollRequest?.abort();
  const controller = new AbortController();
  pollRequest = controller;
  checking.value = true;
  try {
    const latest = await props.services.jobs.get(job.id, controller.signal, job.project_id);
    if (!controller.signal.aborted && current.value?.id === job.id) {
      accept(latest);
      error.value = "";
    }
  } catch (problem) {
    if (!controller.signal.aborted) error.value = `解析状态读取失败：${asApiError(problem).message}`;
  } finally {
    if (!controller.signal.aborted) {
      checking.value = false;
      if (!error.value) schedule();
    }
  }
}
async function cancel() {
  const job = current.value;
  if (!job || busy.value || !active.value) return;
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  error.value = "";
  try {
    const latest = await props.services.jobs.cancel(job.id, controller.signal, job.project_id);
    if (!controller.signal.aborted && current.value?.id === job.id) {
      accept(latest);
      notice.value = latest.status === "cancelled" ? "服务端已确认取消，原件继续保留；迟到的结果不会写回。" : "已读取服务端状态，请以当前任务为准。";
      schedule();
    }
  } catch (problem) {
    if (!controller.signal.aborted) error.value = `${asApiError(problem).message} 请重新读取状态核对取消结果。`;
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
async function retry() {
  const job = current.value;
  if (!job || busy.value || active.value) return;
  if (!retryCommand) {
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
      notice.value = "已基于同一原件创建重试任务。";
      schedule();
    }
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      if (issue.status !== undefined && issue.status < 500 && issue.code !== "INVALID_RESPONSE") {
        confirmJobRequest(command.scope, command.key);
        retryCommand = undefined;
      }
      error.value = retryCommand ? "重试结果未知，原件不受影响；请再次重试以用原请求确认。" : issue.message;
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
watch(
  () => props.job,
  (job) => {
    if (job && taskUpdateAllowed(current.value, job)) {
      if (current.value?.id !== job.id) notice.value = "";
      current.value = job;
    }
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
  <section class="material-task" aria-label="解析状态">
    <div class="library-detail-status"><TpStatus :tone="state.tone" :label="state.label" :live="state.live" size="sm" /><slot name="status" /></div>
    <Transition name="tp-swap" v-bind="panelMotionHooks"><TpProgress v-if="active" label="解析进度" tone="info" /></Transition>
    <p v-if="failure" class="tp-ghost library-detail-note" role="status">{{ failure }}</p>
    <Transition name="tp-swap" v-bind="panelMotionHooks"
      ><p v-if="error" :key="error" class="studio-notice" role="alert">
        {{ error }}<TpButton size="sm" :disabled="checking" @click="refresh">重新读取状态</TpButton>
      </p></Transition
    >
    <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="notice" :key="notice" role="status" class="tp-caption">{{ notice }}</p></Transition>
    <div class="screen-actions">
      <TpButton v-if="active" size="sm" :disabled="busy" @click="cancel">取消解析</TpButton
      ><TpButton
        v-else-if="current && (current.status === 'failed' || current.status === 'cancelled') && state.key !== 'unsupported'"
        size="sm"
        :disabled="busy"
        @click="retry"
        >重试解析</TpButton
      ><slot name="actions" /><TpButton v-if="current" size="sm" variant="ghost" @click="emit('openJob', current)">在任务中心查看</TpButton>
    </div>
  </section>
</template>

<style scoped>
.material-task {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.library-detail-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.library-detail-note {
  padding: 12px;
  font-size: 12px;
  line-height: 1.7;
}
</style>
