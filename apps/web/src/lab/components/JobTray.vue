<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId } from "vue";
import { PhClock, PhX } from "@phosphor-icons/vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import { useJobsState, jobLabels, cancelPreviewJob, canRetryProjectJob, retryProjectJob } from "../state/jobState";
const state = useJobsState();
const open = ref(false);
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const root = ref<HTMLElement>();
const panelId = useId();
const running = computed(() => state.value.jobs.filter((j) => ["queued", "running"].includes(j.status)).length);
const failures = computed(() => state.value.jobs.filter((j) => ["failed", "partial"].includes(j.status)).length);
const recent = computed(() =>
  [...state.value.jobs]
    .sort((a, b) => Number(["queued", "running"].includes(b.status)) - Number(["queued", "running"].includes(a.status)) || b.at.localeCompare(a.at))
    .slice(0, 8),
);
async function toggle() {
  open.value = !open.value;
  if (open.value) {
    await nextTick();
    panel.value?.focus();
  }
}
function close() {
  open.value = false;
  trigger.value?.focus();
}
function outside(event: PointerEvent) {
  if (open.value && !root.value?.contains(event.target as Node)) open.value = false;
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
      :aria-label="'后台任务：' + running + ' 项运行中，' + failures + ' 项需留意'"
      @click="toggle"
    >
      <TpIcon :icon="PhClock" :size="20" /><span>任务</span><span v-if="running || failures" class="job-tray__count">{{ running || failures }}</span>
    </button>
    <Transition name="tp-pop">
      <section v-if="open" :id="panelId" ref="panel" class="job-tray__panel" tabindex="-1" aria-label="后台任务托盘">
        <header class="studio-row">
          <div>
            <h2 class="tp-subheading">后台任务</h2>
            <p class="tp-caption mt-1">{{ running }} 项运行中 · {{ failures }} 项需留意</p>
          </div>
          <button class="tp-icon-btn" aria-label="收起任务托盘" @click="close"><TpIcon :icon="PhX" :size="18" /></button>
        </header>
        <TransitionGroup tag="div" name="tp-list" v-bind="listMotionHooks" class="job-tray__list tp-list-group">
          <article v-for="job in recent" :key="job.id" class="job-tray__item">
            <div class="studio-row">
              <b>{{ job.title }}</b
              ><TpStatus
                size="sm"
                :label="jobLabels[job.status]"
                :live="job.status === 'running'"
                :tone="job.status === 'failed' ? 'danger' : job.status === 'done' ? 'success' : 'info'"
              />
            </div>
            <p class="tp-caption mt-2">{{ job.input }}</p>
            <p class="tp-caption mt-2">{{ job.diagnosis }}</p>
            <div class="screen-actions mt-3">
              <TpButton v-if="['queued', 'running'].includes(job.status)" size="sm" @click="cancelPreviewJob(job)">取消</TpButton>
              <TpButton v-if="canRetryProjectJob(job)" size="sm" @click="retryProjectJob(job)">重试</TpButton>
              <RouterLink :to="'/screens/jobs?job=' + job.id" class="studio-link" @click="open = false">输入与历史 ↗</RouterLink>
              <RouterLink
                v-if="['failed', 'cancelled', 'partial'].includes(job.status) && !canRetryProjectJob(job)"
                :to="job.route"
                class="studio-link"
                @click="open = false"
                >回来源重试 ↗</RouterLink
              >
            </div>
          </article>
          <p v-if="!recent.length" key="empty" class="job-tray__empty tp-caption">还没有后台任务。发起解析、生成、评审或导出后，可以在这里查看结果。</p>
        </TransitionGroup>
        <RouterLink class="studio-link" to="/screens/jobs" @click="open = false">查看全部执行记录 ↗</RouterLink>
      </section>
    </Transition>
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
  background: var(--tp-surface);
  color: var(--tp-text);
  box-shadow: var(--tp-shadow-3);
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
