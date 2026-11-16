<script setup lang="ts">
import { computed, ref } from "vue";
import { PhCalendarBlank, PhFlagPennant } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import { listMotionHooks } from "@/design/motion";
import type { PlanAdjustmentItem, TaskSummary } from "@/services";
import { WINDOW_DAYS, offsetInWindow, shiftDate, shortDay, timelineRows, windowDays } from "./planView";

const props = defineProps<{
  items: readonly TaskSummary[];
  today: string;
  deadline?: string | null;
  planVersion?: number;
  preview?: readonly PlanAdjustmentItem[];
  selectedId?: string;
  loading?: boolean;
}>();
const emit = defineEmits<{ select: [id: string] }>();

const windowStart = ref(props.today);
const windowEnd = computed(() => shiftDate(windowStart.value, WINDOW_DAYS - 1));
const days = computed(() => windowDays(windowStart.value, props.today));
const rows = computed(() => timelineRows(props.items, windowStart.value, props.today, props.preview));
const previewing = computed(() => rows.value.some((row) => row.next));
const todayAt = computed(() => offsetInWindow(windowStart.value, props.today));
const deadlineAt = computed(() => offsetInWindow(windowStart.value, props.deadline));
const undated = computed(() => props.items.filter((item) => !item.archived && !item.start_date && !item.due_date).length);
const marker = (offset: number) => ({ left: `calc(108px + (100% - 108px) * ${offset + 0.5} / ${WINDOW_DAYS})` });
</script>

<template>
  <section class="screen-panel plan-calendar" aria-labelledby="plan-calendar-title">
    <header class="screen-panel__head plan-calendar__heading">
      <div>
        <p class="tp-label">{{ windowStart.slice(0, 7) }} · 近期安排</p>
        <h2 id="plan-calendar-title" class="tp-heading mt-1">把时间留给重要的事</h2>
      </div>
      <span class="tp-mono plan-version">计划 v{{ planVersion ?? 0 }}</span>
    </header>
    <div class="plan-calendar__meta">
      <span><TpIcon :icon="PhCalendarBlank" :size="15" />{{ shortDay(windowStart) }} — {{ shortDay(windowEnd) }}</span
      ><span class="plan-legend"
        ><i />当前计划<template v-if="previewing"><i class="is-pencil" />调整候选</template
        ><template v-if="rows.some((row) => row.flag !== undefined)"><TpIcon :icon="PhFlagPennant" :size="13" />任务硬截止</template></span
      >
    </div>
    <div class="screen-actions plan-window-controls">
      <TpButton size="sm" variant="ghost" @click="windowStart = shiftDate(windowStart, -WINDOW_DAYS)">前两周</TpButton>
      <TpDatePicker v-model="windowStart" class="plan-window-date" type="date" aria-label="时间线开始日期" @change="windowStart ||= today" />
      <TpButton size="sm" variant="ghost" @click="windowStart = today">回到今天</TpButton>
      <TpButton size="sm" variant="ghost" @click="windowStart = shiftDate(windowStart, WINDOW_DAYS)">后两周</TpButton>
    </div>
    <div class="plan-calendar__scroll" tabindex="0" aria-label="两周任务时间轴，可横向滚动">
      <div class="plan-grid" :class="{ 'is-preview': previewing }">
        <div class="plan-grid__dates">
          <span class="tp-label">任务</span>
          <div>
            <span v-for="day in days" :key="day.iso" class="tp-mono" :class="{ 'is-today': day.today, 'is-weekend': day.weekend }" :title="day.iso">{{
              day.date
            }}</span>
          </div>
        </div>
        <TransitionGroup name="tp-list" tag="div" class="tp-list-group" v-bind="listMotionHooks">
          <div v-for="row in rows" :key="row.id" class="plan-grid__row" :class="{ 'is-selected': row.id === selectedId }">
            <button type="button" class="plan-grid__label" :aria-pressed="row.id === selectedId" @click="emit('select', row.id)">{{ row.title }}</button>
            <div class="plan-grid__lane">
              <span v-for="day in days" :key="day.iso" class="plan-grid__cell" :class="{ 'is-weekend': day.weekend }" />
              <button
                v-if="row.current?.visible"
                type="button"
                class="plan-bar"
                :class="{ 'is-original': !!row.next, 'is-overdue': row.overdue }"
                :style="{ '--start': row.current.start, '--end': row.current.end }"
                :aria-label="`${row.title}，${row.current.label}${row.overdue ? '，已过预计完成' : ''}，查看任务`"
                @click="emit('select', row.id)"
              >
                <span>{{ row.current.label }}</span>
              </button>
              <Transition name="tp-swap">
                <span
                  v-if="row.next?.visible"
                  class="plan-bar is-candidate"
                  :style="{ '--start': row.next.start, '--end': row.next.end }"
                  :aria-label="`${row.title} 调整候选：${row.next.label}`"
                  >{{ row.next.label }}</span
                >
              </Transition>
              <span
                v-if="row.flag !== undefined"
                class="plan-grid__flag"
                :style="{ '--at': row.flag }"
                :title="`任务硬截止 ${row.hardDeadline}`"
                role="img"
                :aria-label="`任务硬截止 ${row.hardDeadline}`"
                ><TpIcon :icon="PhFlagPennant" :size="13"
              /></span>
            </div>
          </div>
        </TransitionGroup>
        <div v-if="todayAt !== undefined" class="plan-grid__today" :style="marker(todayAt)" aria-hidden="true"></div>
        <div v-if="deadlineAt !== undefined" class="plan-grid__hard" :style="marker(deadlineAt)" aria-hidden="true"><span>论文提交</span></div>
      </div>
    </div>
    <p class="tp-caption plan-window-note" :role="loading ? 'status' : undefined">
      {{
        loading
          ? "正在读取任务安排…"
          : rows.length
            ? `本窗口显示 ${rows.length} 项任务；可翻页，或从任务清单查看其他日期。`
            : "当前两周窗口没有安排，完整任务与日期可在下方清单查看。"
      }}{{ !loading && undated ? ` 另有 ${undated} 项任务未设日期。` : "" }}
    </p>
    <footer class="plan-calendar__footer">
      <TpIcon :icon="PhFlagPennant" :size="15" />
      <span v-if="deadline">论文提交 <b class="tp-mono">{{ deadline }}</b></span>
      <span v-else>项目尚未设置提交截止</span>
      <span class="tp-caption">{{ deadline ? "硬截止保持不变，调整不会越过" : "可在项目设置中补充" }}</span>
    </footer>
  </section>
</template>

<style scoped>
.plan-calendar {
  overflow: hidden;
}
.plan-calendar__heading {
  align-items: center;
}
.plan-version {
  white-space: nowrap;
  color: var(--tp-text-muted);
}
.plan-calendar__meta {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px 24px 20px;
  color: var(--tp-text-muted);
  font-size: 12px;
}
.plan-calendar__meta > span,
.plan-legend {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.plan-legend i {
  width: 16px;
  height: 8px;
  border-radius: var(--tp-radius-xs);
  background: var(--tp-ink);
}
.plan-legend i.is-pencil {
  background: var(--tp-pencil-soft);
  border: 1px dashed var(--tp-pencil-line);
}
.plan-window-controls {
  padding: 0 24px 16px;
  gap: 8px;
  flex-wrap: wrap;
}
.plan-window-date {
  width: 155px;
  min-width: 0;
}
.plan-calendar__scroll {
  overflow-x: auto;
  padding: 0 24px 20px;
}
.plan-grid {
  position: relative;
  min-width: 570px;
}
.plan-grid__dates,
.plan-grid__row {
  display: grid;
  grid-template-columns: 108px 1fr;
  align-items: center;
}
.plan-grid__dates {
  height: 32px;
}
.plan-grid__dates > div {
  display: grid;
  grid-template-columns: repeat(14, minmax(0, 1fr));
  text-align: center;
}
.plan-grid__dates .tp-mono {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  margin: auto;
  color: var(--tp-text-muted);
}
.plan-grid__dates .is-today {
  background: var(--tp-accent-soft);
  color: var(--tp-accent-soft-content);
  border-radius: 50%;
  font-weight: 700;
}
.plan-grid__dates .is-weekend:not(.is-today) {
  color: var(--tp-text-faint);
}
.plan-grid__row {
  min-height: 56px;
}
.plan-grid__label {
  font-size: 12px;
  text-align: left;
  width: fit-content;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-grid__label:hover,
.plan-grid__row.is-selected .plan-grid__label {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.plan-grid__lane {
  height: 56px;
  position: relative;
  display: grid;
  grid-template-columns: repeat(14, minmax(0, 1fr));
}
.plan-grid__cell {
  border-left: 1px solid var(--tp-line);
}
.plan-grid__cell.is-weekend {
  background: var(--tp-surface-sunken);
}
.plan-bar {
  position: absolute;
  top: 15px;
  left: calc(var(--start) / 14 * 100% + 2px);
  width: calc((var(--end) - var(--start)) / 14 * 100% - 4px);
  min-width: 6px;
  height: 26px;
  border-radius: var(--tp-radius-xs);
  border: 1px solid var(--tp-ink);
  background: var(--tp-ink);
  color: var(--tp-surface);
  font-family: var(--tp-font-mono);
  font-size: 10px;
  line-height: 24px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  z-index: 1;
  transition:
    left var(--tp-dur-deliberate) var(--tp-ease-standard),
    width var(--tp-dur-deliberate) var(--tp-ease-standard),
    top var(--tp-dur-moderate) var(--tp-ease-standard),
    height var(--tp-dur-moderate) var(--tp-ease-standard);
}
:global([data-motion="reduced"]) .plan-bar {
  transition: opacity 100ms linear;
}
.plan-bar.is-overdue:not(.is-original) {
  border-color: var(--tp-warning);
}
.plan-bar.is-original {
  top: 8px;
  height: 16px;
  line-height: 14px;
  background: transparent;
  border-style: dashed;
  border-color: var(--tp-ghost-line);
  color: var(--tp-text-muted);
}
.plan-bar.is-candidate {
  top: 28px;
  height: 22px;
  line-height: 20px;
  border-style: dashed;
  border-color: var(--tp-pencil-line);
  background: var(--tp-pencil-soft);
  color: var(--tp-pencil-content);
}
.plan-grid__flag {
  position: absolute;
  top: 2px;
  left: calc((var(--at) + 0.5) / 14 * 100% - 6px);
  color: var(--tp-danger-content);
  z-index: 2;
  line-height: 0;
}
.plan-grid__today,
.plan-grid__hard {
  position: absolute;
  top: 32px;
  bottom: 0;
  pointer-events: none;
  z-index: 2;
}
.plan-grid__today {
  border-left: 1px dashed var(--tp-accent);
}
.plan-grid__hard {
  border-left: 2px solid var(--tp-danger);
}
.plan-grid__hard span {
  position: absolute;
  bottom: 2px;
  left: 4px;
  font-size: 10px;
  white-space: nowrap;
}
.plan-grid__hard span {
  color: var(--tp-danger-content);
  font-weight: 600;
}
.plan-calendar__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border-top: 1px solid var(--tp-line);
}
.plan-calendar__footer > .tp-caption {
  margin-left: auto;
}
.plan-window-note {
  padding: 0 24px 16px;
}
@media (max-width: 700px) {
  .plan-calendar__meta,
  .plan-window-controls,
  .plan-calendar__scroll,
  .plan-calendar__footer,
  .plan-window-note {
    padding-inline: 16px;
  }
}
</style>
