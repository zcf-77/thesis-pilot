<script setup lang="ts">
import { PhArrowCounterClockwise, PhCheck, PhMagnifyingGlass } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { TaskSummary } from "@/services";
import { listMotionHooks } from "@/design/motion";
import { isOverdue, shortDate, statusFor, type TaskFilter } from "./taskBoard";

defineProps<{
  items: readonly TaskSummary[];
  total: number;
  selectedId?: string;
  disabled: boolean;
  loading: boolean;
  error: string;
  today: string;
  chapters: ReadonlyMap<string, string>;
}>();
const filter = defineModel<TaskFilter>("filter", { required: true });
const emit = defineEmits<{ select: [id: string]; create: []; retry: [] }>();
function meta(task: TaskSummary, chapters: ReadonlyMap<string, string>) {
  return (
    [chapters.get(task.id), task.due_date ? `截止 ${shortDate(task.due_date)}` : "", task.archived ? "已归档" : ""].filter(Boolean).join(" · ") || "未设截止"
  );
}
</script>

<template>
  <section class="screen-panel plan-tasks" aria-labelledby="plan-tasks-title" :aria-busy="loading || undefined">
    <header class="screen-panel__head plan-tasks__heading">
      <h2 id="plan-tasks-title" class="tp-heading">任务清单</h2>
      <TpSegmented
        v-model="filter"
        label="任务筛选"
        :options="[
          { value: 'open', label: '未完成' },
          { value: 'all', label: '全部' },
        ]"
      />
    </header>
    <Transition name="tp-swap" mode="out-in">
      <div v-if="loading && !total" key="loading" class="studio-body workspace-loading plan-tasks__loading" role="status">
        <span class="tp-btn__spinner" aria-hidden="true" />正在读取任务…
      </div>
      <TpState v-else-if="error" key="error" kind="error" title="无法读取任务" :desc="`${error} 已保存的任务不受影响。`" retryable @retry="emit('retry')" />
      <TpState
        v-else-if="!items.length"
        key="blank"
        :kind="total ? 'noresult' : 'empty'"
        :title="total ? '没有未完成的任务' : '从一项具体任务开始'"
        :desc="total ? '切换到全部，查看已确认或已归档的任务。' : '写下目标、验收条件和期限，再关联实际产物。'"
        ><TpButton v-if="total" size="sm" @click="filter = 'all'">查看全部任务</TpButton
        ><TpButton v-else variant="primary" size="sm" :disabled="disabled" @click="emit('create')">新增第一项任务</TpButton></TpState
      >
      <TransitionGroup v-else key="list" name="tp-list" tag="div" v-bind="listMotionHooks" class="plan-task-list tp-list-group" aria-label="任务">
        <button
          v-for="task in items"
          :key="task.id"
          type="button"
          class="plan-task"
          :class="{ 'is-selected': selectedId === task.id, 'is-archived': task.archived }"
          :aria-pressed="selectedId === task.id"
          :disabled="disabled && selectedId !== task.id"
          :aria-label="`选择任务 ${task.title}`"
          @click="emit('select', task.id)"
        >
          <span class="plan-task__marker" :class="{ 'is-confirmed': task.status === 'confirmed' }" aria-hidden="true"
            ><TpIcon v-if="task.status === 'confirmed'" :icon="PhCheck" :size="12" /><TpIcon
              v-else-if="task.status === 'verify'"
              :icon="PhMagnifyingGlass"
              :size="12" /><TpIcon v-else-if="task.status === 'rework'" :icon="PhArrowCounterClockwise" :size="12"
          /></span>
          <span class="plan-task__text"
            ><b>{{ task.title }}</b
            ><span class="tp-caption">{{ meta(task, chapters) }}<span v-if="isOverdue(task, today)" class="plan-overdue"> · 已延期</span></span></span
          >
          <TpStatus size="sm" :tone="statusFor(task).tone" :label="statusFor(task).label" />
        </button>
      </TransitionGroup>
    </Transition>
    <p class="plan-tasks__footer tp-caption">{{ items.length }} 项任务<template v-if="total !== items.length"> · 共 {{ total }} 项</template></p>
  </section>
</template>

<style scoped>
.plan-tasks__heading {
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.plan-tasks__loading {
  padding: 24px;
}
.plan-task-list {
  display: grid;
}
.plan-task {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  text-align: left;
  border-bottom: 1px solid var(--tp-line);
  border-left: 3px solid transparent;
  transition: background-color var(--tp-dur-fast) var(--tp-ease-standard);
}
.plan-task:hover:not(:disabled) {
  background: var(--tp-surface-sunken);
}
.plan-task:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.plan-task.is-selected {
  border-left-color: var(--tp-accent);
  background: var(--tp-surface-sunken);
}
.plan-task.is-archived .plan-task__text b {
  color: var(--tp-text-muted);
}
.plan-task__marker {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  border: 1px solid var(--tp-line-strong);
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--tp-text-muted);
}
.plan-task__marker.is-confirmed {
  color: var(--tp-seal);
  border-color: var(--tp-seal);
}
.plan-task__text {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 4px;
}
.plan-task__text b {
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.plan-overdue {
  color: var(--tp-warning-content);
}
.plan-tasks__footer {
  padding: 12px 24px;
}
@media (max-width: 700px) {
  .plan-task {
    padding: 16px 12px;
    gap: 8px;
    flex-wrap: wrap;
  }
  .plan-task__text {
    flex-basis: calc(100% - 40px);
  }
  .plan-task > .tp-status {
    margin-left: 28px;
  }
}
</style>
