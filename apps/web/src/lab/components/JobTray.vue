<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId } from "vue";
import { PhClock, PhX } from "@phosphor-icons/vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import { jobStatus } from "@/domain/vocab";
import type { JobRead } from "@/services";
import { useBackendServices } from "@/services/runtime";
import { useJobsState, cancelPreviewJob, canRetryProjectJob, retryProjectJob, type PreviewJob } from "../state/jobState";
import { useServiceJobs, canRerunServiceJob, diagnosticJobTitle, isActiveServiceJob, serviceJobFailure, serviceJobStatus } from "../state/serviceJobs";
import { panelMotionHooks } from "./integration/motion";

const local = useJobsState();
const service = useServiceJobs();
const serviceLabel = useBackendServices().sourceLabel;
const open = ref(false);
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const root = ref<HTMLElement>();
const panelId = useId();
const isLocalActive = (job: PreviewJob) => job.status === "queued" || job.status === "running";
type TrayItem = { source: "local"; job: PreviewJob } | { source: "service"; job: JobRead };
const serviceJobs = computed(() => service?.tray.value ?? []);
const serviceAction = computed(() => service?.action.value);
const pendingCreation = computed(() => service?.pendingCreation.value);
const serviceLoading = computed(() => service?.loading.value);
const loadError = computed(() => service?.loadError.value);
const actionError = computed(() => service?.actionError.value);
const notice = computed(() => service?.notice.value);
const remoteUnknown = computed(() => !!service?.projectId.value && service.activeCount.value === null);
const running = computed(() => local.value.jobs.filter(isLocalActive).length + (service?.activeCount.value ?? 0));
const isActive = (item: TrayItem) => (item.source === "service" ? isActiveServiceJob(item.job) : isLocalActive(item.job));
const updatedAt = (item: TrayItem) => (item.source === "service" ? item.job.updated_at : item.job.at);
const recent = computed(() => {
  const rows: TrayItem[] = [
    ...local.value.jobs.map((job) => ({ source: "local", job }) as const),
    ...serviceJobs.value.map((job) => ({ source: "service", job }) as const),
  ];
  return rows.sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || updatedAt(b).localeCompare(updatedAt(a))).slice(0, 8);
});
const failures = computed(() => recent.value.filter(({ job }) => job.status === "failed" || job.status === "partial").length);
const status = (item: TrayItem) => (item.source === "service" ? serviceJobStatus(item.job) : jobStatus[item.job.status]);
const detailLink = (item: TrayItem) => ({ path: "/screens/jobs", query: { source: item.source, job: item.job.id } });

async function toggle() {
  open.value = !open.value;
  if (!open.value) return;
  service?.refreshInBackground();
  await nextTick();
  if (open.value) panel.value?.focus();
}
function close() {
  open.value = false;
  trigger.value?.focus();
}
function outside(event: PointerEvent) {
  const target = event.target as Node;
  if (open.value && !root.value?.contains(target) && !panel.value?.contains(target)) open.value = false;
}
onMounted(() => document.addEventListener("pointerdown", outside));
onUnmounted(() => document.removeEventListener("pointerdown", outside));
</script>

<template>
  <div ref="root" class="job-tray" @keydown.esc.stop="close">
    <button
      ref="trigger"
      class="job-tray__trigger"
      :aria-expanded="open"
      :aria-controls="panelId"
      :aria-label="'后台任务：' + running + ' 项运行中，' + failures + ' 项需留意' + (remoteUnknown ? '，服务任务状态尚未确认' : '')"
      @click="toggle"
    >
      <TpIcon :icon="PhClock" :size="20" /><span>任务</span><span v-if="running || failures" class="job-tray__count">{{ running || failures }}</span>
    </button>
    <Teleport to="body">
      <Transition name="tp-pop" v-bind="panelMotionHooks">
        <section v-if="open" :id="panelId" ref="panel" class="job-tray__panel" tabindex="-1" aria-label="后台任务托盘" @keydown.esc.stop="close">
          <header class="studio-row">
            <div>
              <h2 class="tp-subheading">后台任务</h2>
              <p v-if="!remoteUnknown || running || failures" class="tp-caption mt-1">{{ running }} 项运行中 · {{ failures }} 项需留意</p>
            </div>
            <TpButton class="job-tray__close" variant="ghost" icon-only label="收起任务托盘" @click="close"><TpIcon :icon="PhX" :size="18" /></TpButton>
          </header>
          <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
            <p v-if="actionError" :key="actionError" role="alert" class="tp-caption">{{ actionError }}</p>
            <p v-else-if="notice" :key="notice" role="status" class="tp-caption">{{ notice }}</p>
          </Transition>
          <Transition name="tp-swap" v-bind="panelMotionHooks">
            <div v-if="loadError" class="screen-actions">
              <p role="status" class="tp-caption">服务任务状态暂时无法读取。</p>
              <TpButton size="sm" variant="ghost" @click="service?.refreshInBackground()">重新读取</TpButton>
            </div>
          </Transition>
          <Transition name="tp-swap" v-bind="panelMotionHooks">
            <TpButton v-if="pendingCreation && !serviceAction" size="sm" variant="tonal" @click="service?.createDiagnostic()">确认上次运行请求</TpButton>
          </Transition>
          <TransitionGroup tag="div" name="tp-list" v-bind="listMotionHooks" class="job-tray__list tp-list-group">
            <article v-for="item in recent" :key="item.source + ':' + item.job.id" class="job-tray__item" data-testid="tray-job-row">
              <div class="studio-row">
                <b>{{ item.source === "service" ? diagnosticJobTitle : item.job.title }}</b>
                <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                  <TpStatus :key="item.job.status" size="sm" :label="status(item).label" :tone="status(item).tone" :live="status(item).live" />
                </Transition>
              </div>
              <p v-if="service || item.job.status === 'failed' || item.job.status === 'partial'" class="tp-caption mt-2">
                <template v-if="service">{{ item.source === "service" ? serviceLabel : "本机任务" }}</template>
                <template v-if="item.source === 'service' && serviceJobFailure(item.job)"> · {{ serviceJobFailure(item.job) }}</template>
                <template v-else-if="item.source === 'local' && (item.job.status === 'failed' || item.job.status === 'partial')"
                  >{{ service ? " · " : "" }}{{ item.job.diagnosis }}</template
                >
              </p>
              <div class="screen-actions mt-3">
                <Transition v-if="item.source === 'service'" name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                  <TpButton
                    v-if="isActiveServiceJob(item.job)"
                    key="cancel"
                    size="sm"
                    :loading="serviceAction?.type === 'cancel' && serviceAction.id === item.job.id"
                    :disabled="!!serviceAction"
                    @click="service?.cancel(item.job)"
                    >取消</TpButton
                  >
                  <TpButton
                    v-else-if="canRerunServiceJob(item.job)"
                    key="rerun"
                    size="sm"
                    :loading="serviceAction?.type === 'create' && serviceAction.fromId === item.job.id"
                    :disabled="!!serviceAction || pendingCreation"
                    @click="service?.createDiagnostic(item.job)"
                    >重新运行</TpButton
                  >
                </Transition>
                <Transition v-else name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                  <TpButton v-if="isLocalActive(item.job)" key="cancel" size="sm" @click="cancelPreviewJob(item.job)">取消</TpButton>
                  <TpButton v-else-if="canRetryProjectJob(item.job)" key="retry" size="sm" @click="retryProjectJob(item.job)">重试</TpButton>
                  <RouterLink
                    v-else-if="['failed', 'cancelled', 'partial'].includes(item.job.status)"
                    key="source"
                    :to="item.job.route"
                    class="studio-link"
                    @click="open = false"
                    >回来源重试 ↗</RouterLink
                  >
                </Transition>
                <RouterLink :to="detailLink(item)" class="studio-link" @click="open = false">查看详情 ↗</RouterLink>
              </div>
            </article>
            <p v-if="!recent.length && !serviceLoading && !loadError" key="empty" class="job-tray__empty tp-caption">还没有后台任务。</p>
            <p v-else-if="!recent.length && serviceLoading" key="loading" role="status" class="tp-caption">正在读取任务…</p>
          </TransitionGroup>
          <RouterLink class="studio-link" to="/screens/jobs" @click="open = false">查看全部执行记录 ↗</RouterLink>
        </section>
      </Transition>
    </Teleport>
  </div>
</template>
<style scoped>
.job-tray {
  width: 100%;
}
.job-tray__trigger {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 44px;
  padding: 6px;
  color: var(--tp-text-muted);
  border-radius: var(--tp-radius-m);
  font-size: 11px;
}
.job-tray__trigger:hover,
.job-tray__trigger[aria-expanded="true"] {
  color: var(--tp-accent);
  background: var(--tp-accent-soft);
}
.job-tray__count {
  position: absolute;
  top: 0;
  right: 4px;
  min-width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--tp-action);
  color: var(--tp-action-content);
  font-size: 10px;
  line-height: 16px;
}
.job-tray__panel {
  position: fixed;
  z-index: 70;
  left: 88px;
  bottom: 18px;
  width: min(430px, calc(100vw - 110px));
  max-height: min(680px, calc(100dvh - 100px));
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--tp-line-strong);
  border-radius: var(--tp-radius-l);
  background-color: var(--tp-canvas);
  background-image: linear-gradient(var(--tp-surface-raised), var(--tp-surface-raised));
  color: var(--tp-text);
  box-shadow: var(--tp-shadow-3);
}
.job-tray__close {
  flex: 0 0 auto;
  min-inline-size: 36px;
  min-block-size: 36px;
}
.job-tray__list {
  overflow: auto;
  min-height: 0;
}
.job-tray__item {
  padding: 16px 0;
  border-bottom: 1px solid var(--tp-line);
  overflow-wrap: anywhere;
}
.job-tray__item:first-child {
  padding-top: 0;
}
.job-tray__item b {
  font-size: 13px;
}
.job-tray__empty {
  padding: 20px 0;
  line-height: 1.8;
}
@media (max-width: 640px) {
  .job-tray__panel {
    left: 12px;
    bottom: 16px;
    width: calc(100vw - 24px);
  }
}
</style>
