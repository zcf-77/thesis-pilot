<script setup lang="ts">
import { PhArrowRight, PhCalendarBlank, PhFileText, PhGitBranch } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { TaskSummary } from "@/services";
import { listMotionHooks } from "@/design/motion";
import { dependencyGap, evidenceGap, isOverdue, primaryTaskAction, shortDate, statusFor, type TaskFilter, type TaskPrimaryAction } from "./taskBoard";

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
const emit = defineEmits<{ select: [id: string]; action: [id: string, action: TaskPrimaryAction]; create: []; retry: [] }>();
</script>

<template>
  <section class="screen-panel plan-tasks" aria-labelledby="plan-tasks-title" :aria-busy="loading || undefined">
    <header class="screen-panel__head plan-tasks__heading">
      <div class="plan-tasks__title">
        <h2 id="plan-tasks-title" class="tp-heading">任务清单</h2>
        <span v-if="!loading && !error" class="tp-caption">{{ items.length }}<template v-if="total !== items.length"> / {{ total }}</template> 项</span>
      </div>
      <TpSegmented
        v-model="filter"
        label="任务筛选"
        :options="[
          { value: 'open', label: '待处理' },
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
        :title="total ? '没有待处理任务' : '从一项具体任务开始'"
        :desc="total ? '已确认或已归档的任务可在全部中查看。' : '写下目标、验收条件和期限。'"
        ><TpButton v-if="total" size="sm" @click="filter = 'all'">查看全部任务</TpButton
        ><TpButton v-else variant="primary" size="sm" :disabled="disabled" @click="emit('create')">新增第一项任务</TpButton></TpState
      >
      <TransitionGroup v-else key="list" name="tp-list" tag="ul" v-bind="listMotionHooks" class="plan-task-list tp-list-group" aria-label="任务">
        <li v-for="task in items" :key="task.id" class="plan-task-row" :class="{ 'is-selected': selectedId === task.id, 'is-archived': task.archived }">
          <button
            type="button"
            class="plan-task"
            :aria-pressed="selectedId === task.id"
            :disabled="disabled && selectedId !== task.id"
            @click="emit('select', task.id)"
          >
            <span class="plan-task__text">
              <b>{{ task.title }}</b>
              <span class="plan-task__dates">
                <TpIcon :icon="PhCalendarBlank" :size="14" />
                <span>{{ task.due_date ? `截止 ${shortDate(task.due_date)}` : "未设期限" }}</span>
                <span v-if="task.hard_deadline">硬截止 {{ shortDate(task.hard_deadline) }}</span>
                <span v-if="isOverdue(task, today)" class="plan-overdue">已延期</span>
              </span>
              <span class="plan-task__signals">
                <span :class="{ 'is-gap': dependencyGap(task).blocked }"> <TpIcon :icon="PhGitBranch" :size="13" />{{ dependencyGap(task).label }} </span>
                <span v-if="evidenceGap(task)" class="is-gap"><TpIcon :icon="PhFileText" :size="13" />{{ evidenceGap(task) }}</span>
                <span v-if="chapters.get(task.id)" class="plan-task__chapter">{{ chapters.get(task.id) }}</span>
              </span>
            </span>
            <TpStatus size="sm" :tone="statusFor(task).tone" :label="statusFor(task).label" />
          </button>
          <TpButton
            class="plan-task__action"
            size="sm"
            variant="ghost"
            :disabled="disabled"
            :label="`${primaryTaskAction(task).label}：${task.title}`"
            @click="emit('action', task.id, primaryTaskAction(task).action)"
          >
            {{ primaryTaskAction(task).label }}<TpIcon :icon="PhArrowRight" :size="14" />
          </TpButton>
        </li>
      </TransitionGroup>
    </Transition>
  </section>
</template>

<style scoped>
.plan-tasks {
  overflow: hidden;
}
.plan-tasks__heading {
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding-block: 16px;
}
.plan-tasks__title {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}
.plan-tasks__title > .tp-caption {
  color: var(--tp-text-muted);
  white-space: nowrap;
}
.plan-tasks__loading {
  padding: 24px;
}
.plan-task-list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}
.plan-task-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  min-width: 0;
  border-top: 1px solid var(--tp-line);
  transition: background-color var(--tp-dur-fast) var(--tp-ease-standard);
}
.plan-task-row:first-child {
  border-top: 0;
}
.plan-task-row:hover,
.plan-task-row.is-selected {
  background: var(--tp-surface-sunken);
}
.plan-task-row.is-selected::before {
  content: "";
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: 3px;
  background: var(--tp-accent);
  pointer-events: none;
}
.plan-task-row.is-archived .plan-task__text > b {
  color: var(--tp-text-muted);
}
.plan-task {
  min-width: 0;
  min-height: 76px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 16px 8px 16px 20px;
  text-align: left;
}
.plan-task:focus-visible {
  outline-offset: -3px;
}
.plan-task:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.plan-task__text {
  min-width: 0;
  display: grid;
  gap: 6px;
}
.plan-task__text > b {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.plan-task__dates,
.plan-task__signals,
.plan-task__signals > span {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  min-width: 0;
}
.plan-task__dates,
.plan-task__signals {
  color: var(--tp-text-muted);
  font-size: 12px;
  line-height: 1.55;
}
.plan-task__dates > span + span,
.plan-task__signals > span + span {
  position: relative;
  padding-left: 10px;
}
.plan-task__dates > span + span::before,
.plan-task__signals > span + span::before {
  content: "·";
  position: absolute;
  left: 1px;
  color: var(--tp-text-faint);
}
.plan-task__signals .is-gap,
.plan-overdue {
  color: var(--tp-warning-content);
}
.plan-task__chapter {
  max-width: 100%;
  overflow-wrap: anywhere;
}
.plan-task__action {
  margin-right: 12px;
  white-space: nowrap;
}
@media (max-width: 700px) {
  .plan-task-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .plan-task {
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 16px 16px 4px;
  }
  .plan-task__action {
    justify-self: end;
    margin: 0 12px 8px;
  }
}
@media (max-width: 420px) {
  .plan-task {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  .plan-task > .tp-status {
    justify-self: start;
  }
}
</style>
