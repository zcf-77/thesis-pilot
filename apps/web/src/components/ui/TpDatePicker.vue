<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useAttrs, useId, watch } from "vue";
import { PhCalendarBlank, PhCaretLeft, PhCaretRight, PhClock, PhX } from "@phosphor-icons/vue";
import TpIcon from "./TpIcon.vue";
import {
  calendarDays,
  dateValue,
  isPickerValue,
  localTime,
  localToday,
  normalizePickerValue,
  parseDate,
  pickerError,
  shiftDay,
  shiftMonth,
  type PickerType,
} from "./datePicker";

defineOptions({ inheritAttrs: false });
const props = withDefaults(
  defineProps<{
    modelValue?: string;
    type?: PickerType;
    id?: string;
    name?: string;
    disabled?: boolean;
    required?: boolean;
    min?: string;
    max?: string;
    placeholder?: string;
  }>(),
  { modelValue: "", type: "date", disabled: false, required: false, min: "", max: "" },
);
const emit = defineEmits<{
  "update:modelValue": [value: string];
  change: [value: string];
  blur: [event: FocusEvent];
}>();
const attrs = useAttrs();
const generatedId = useId();
const inputId = computed(() => props.id ?? generatedId);
const panelId = `${generatedId}-calendar`;
const titleId = `${generatedId}-title`;
const errorId = `${generatedId}-error`;
const root = ref<HTMLElement>();
const input = ref<HTMLInputElement>();
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const calendar = ref<HTMLElement>();
const open = ref(false);
const present = ref(false);
let motionTicket = 0;
let panelAnimation: Animation | undefined;
let monthAnimation: Animation | undefined;
let focusTimer: ReturnType<typeof setTimeout> | undefined;
const raw = ref(props.modelValue);
const touched = ref(false);
const panelError = ref("");
const draftDate = ref(localToday());
const draftHour = ref("09");
const draftMinute = ref("00");
const focusDate = ref(localToday());
const visible = ref(parseDate(localToday())!);
const position = ref({ left: "0px", top: "0px", width: "312px", maxHeight: "420px" });
const days = computed(() => calendarDays(visible.value.year, visible.value.month));
const weeks = computed(() => Array.from({ length: 6 }, (_, i) => days.value.slice(i * 7, i * 7 + 7)));
const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const kindLabel = computed(() => (props.type === "time" ? "时间" : props.type === "datetime-local" ? "日期时间" : "日期"));
const placeholder = computed(() => props.placeholder ?? (props.type === "date" ? "YYYY-MM-DD" : props.type === "time" ? "HH:mm" : "YYYY-MM-DDTHH:mm"));
const currentValue = computed(() =>
  props.type === "date"
    ? draftDate.value
    : props.type === "time"
      ? `${draftHour.value}:${draftMinute.value}`
      : `${draftDate.value}T${draftHour.value}:${draftMinute.value}`,
);
const validation = computed(() => pickerError(normalizePickerValue(raw.value, props.type), props.type, props.min, props.max, props.required));
const error = computed(() => (touched.value ? validation.value : ""));
const minDate = computed(() => (props.type === "datetime-local" ? props.min.slice(0, 10) : props.min));
const maxDate = computed(() => (props.type === "datetime-local" ? props.max.slice(0, 10) : props.max));

function inputAttrs() {
  const { class: _class, style: _style, "aria-invalid": _invalid, "aria-describedby": _describedby, ...rest } = attrs;
  return rest;
}
function describedBy() {
  return [typeof attrs["aria-describedby"] === "string" ? attrs["aria-describedby"] : "", error.value ? errorId : ""].filter(Boolean).join(" ") || undefined;
}
function ariaInvalid() {
  if (error.value) return true;
  const value = attrs["aria-invalid"];
  return value === true || value === false || value === "true" || value === "false" || value === "grammar" || value === "spelling" ? value : undefined;
}
function applyValidity() {
  input.value?.setCustomValidity(validation.value);
}
function publish(value: string) {
  raw.value = value;
  emit("update:modelValue", value);
  emit("change", value);
  applyValidity();
}
function edit(event: Event) {
  raw.value = (event.target as HTMLInputElement).value;
  const normalized = normalizePickerValue(raw.value, props.type);
  if (!normalized || !pickerError(normalized, props.type, props.min, props.max)) {
    emit("update:modelValue", normalized);
    emit("change", normalized);
  }
  applyValidity();
}
function blur(event: FocusEvent) {
  touched.value = true;
  const normalized = normalizePickerValue(raw.value, props.type);
  if (!pickerError(normalized, props.type, props.min, props.max, props.required)) raw.value = normalized;
  applyValidity();
  emit("blur", event);
}
function dayDisabled(value: string): boolean {
  return !!pickerError(value, "date", minDate.value, maxDate.value);
}
function timeValue(hour: string, minute: string) {
  return props.type === "time" ? `${hour}:${minute}` : `${draftDate.value}T${hour}:${minute}`;
}
function minuteDisabled(minute: string) {
  return !!pickerError(timeValue(draftHour.value, minute), props.type, props.min, props.max);
}
function hourDisabled(hour: string) {
  return minutes.every((minute) => !!pickerError(timeValue(hour, minute), props.type, props.min, props.max));
}
function updatePosition() {
  if (!open.value || !root.value || !panel.value) return;
  const rect = root.value.getBoundingClientRect();
  const width = Math.min(312, window.innerWidth - 16);
  const below = window.innerHeight - rect.bottom - 12;
  const above = rect.top - 12;
  const height = Math.min(panel.value.scrollHeight || 420, window.innerHeight - 16);
  const down = below >= Math.min(height, 360) || below >= above;
  const maxHeight = Math.max(80, down ? below : above);
  position.value = {
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
    top: `${down ? Math.min(rect.bottom + 6, window.innerHeight - 88) : Math.max(8, rect.top - Math.min(height, maxHeight) - 6)}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
  };
}
function resetDraft() {
  const normalized = normalizePickerValue(raw.value, props.type);
  const value = isPickerValue(normalized, props.type) ? normalized : props.modelValue;
  draftDate.value = props.type !== "time" && parseDate(value.slice(0, 10)) ? value.slice(0, 10) : localToday();
  if (parseDate(minDate.value) && draftDate.value < minDate.value) draftDate.value = minDate.value;
  if (parseDate(maxDate.value) && draftDate.value > maxDate.value) draftDate.value = maxDate.value;
  const time = props.type === "time" ? value : value.slice(11);
  const valid = isPickerValue(time, "time") ? time : localTime();
  draftHour.value = valid.slice(0, 2);
  draftMinute.value = valid.slice(3);
  focusDate.value = draftDate.value;
  visible.value = parseDate(draftDate.value)!;
  panelError.value = "";
}
function reducedMotion() {
  const mode = root.value?.closest<HTMLElement>("[data-motion]")?.dataset.motion;
  return mode === "reduced" || (mode !== "full" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}
function durationOf(value: string) {
  const time = value.split(",")[0]?.trim() ?? "0s";
  const number = Number.parseFloat(time);
  return Number.isFinite(number) ? number * (time.endsWith("ms") ? 1 : 1000) : 0;
}
function panelMotion(entering: boolean, previous?: { opacity: string; transform: string; filter: string }) {
  const node = panel.value;
  if (!node?.animate) return undefined;
  const style = getComputedStyle(node);
  const reduced = reducedMotion();
  const from: Keyframe = { opacity: previous?.opacity ?? (entering ? 0 : style.opacity) };
  const to: Keyframe = { opacity: entering ? 1 : 0 };
  if (!reduced) {
    from.transform = previous?.transform ?? (entering ? style.getPropertyValue("--tp-enter-transform").trim() || "none" : style.transform);
    from.filter = previous?.filter ?? (entering ? style.getPropertyValue("--tp-enter-filter").trim() || "none" : style.filter);
    to.transform = entering ? "none" : "translateY(-3px) scale(0.985)";
    to.filter = "none";
  }
  return node.animate([from, to], {
    duration: reduced ? 100 : durationOf(entering ? style.transitionDuration : style.animationDuration),
    easing: style.getPropertyValue(entering ? "--tp-ease-enter" : "--tp-ease-exit").trim() || "ease",
    fill: "both",
  });
}
function motionSnapshot() {
  if (!present.value || !panel.value) return undefined;
  const style = getComputedStyle(panel.value);
  return { opacity: style.opacity, transform: style.transform, filter: style.filter };
}
function finishClosing(ticket: number) {
  if (ticket !== motionTicket || open.value) return;
  if (panel.value?.hidePopover && panel.value.matches(":popover-open")) panel.value.hidePopover();
  panelAnimation?.cancel();
  panelAnimation = undefined;
  present.value = false;
}
async function show() {
  if (props.disabled || open.value) return;
  clearFocusCheck();
  const ticket = ++motionTicket;
  const previous = motionSnapshot();
  panelAnimation?.cancel();
  panelAnimation = undefined;
  resetDraft();
  open.value = true;
  present.value = true;
  await nextTick();
  if (ticket !== motionTicket || !open.value) return;
  if (panel.value) {
    panel.value.inert = false;
    panel.value.removeAttribute("aria-hidden");
    if (panel.value.showPopover && !panel.value.matches(":popover-open")) panel.value.showPopover();
  }
  updatePosition();
  panelAnimation = panelMotion(true, previous);
  void panelAnimation?.finished
    .then(() => {
      if (ticket !== motionTicket || !open.value) return;
      panelAnimation?.cancel();
      panelAnimation = undefined;
    })
    .catch(() => {});
  await nextTick();
  if (ticket !== motionTicket || !open.value) return;
  if (props.type === "time") panel.value?.querySelector<HTMLElement>('.tp-date-time__list [aria-selected="true"]')?.focus();
  else panel.value?.querySelector<HTMLElement>(`[data-date="${focusDate.value}"]`)?.focus();
  for (const item of panel.value?.querySelectorAll<HTMLElement>('.tp-date-time__list [aria-selected="true"]') ?? []) item.scrollIntoView({ block: "nearest" });
}
function close(restoreFocus = false) {
  if (!open.value) return;
  clearFocusCheck();
  const ticket = ++motionTicket;
  const previous = motionSnapshot();
  panelAnimation?.cancel();
  monthAnimation?.cancel();
  open.value = false;
  // Leave visually, but leave the tab order and hit testing immediately.
  if (panel.value) {
    panel.value.inert = true;
    panel.value.setAttribute("aria-hidden", "true");
  }
  if (restoreFocus) trigger.value?.focus();
  panelAnimation = panelMotion(false, previous);
  if (!panelAnimation) finishClosing(ticket);
  else void panelAnimation.finished.then(() => finishClosing(ticket)).catch(() => {});
}
function toggle() {
  if (open.value) close(true);
  else void show();
}
function apply() {
  panelError.value = pickerError(currentValue.value, props.type, props.min, props.max, props.required);
  if (panelError.value) return;
  touched.value = true;
  publish(currentValue.value);
  close(true);
}
function selectDate(value: string) {
  if (dayDisabled(value)) return;
  draftDate.value = value;
  focusDate.value = value;
  visible.value = parseDate(value)!;
  panelError.value = "";
  if (props.type === "date") apply();
}
function clear() {
  touched.value = true;
  publish("");
  close(true);
}
function today() {
  if (props.type !== "time") {
    if (dayDisabled(localToday())) return;
    selectDate(localToday());
  } else {
    const time = localTime();
    draftHour.value = time.slice(0, 2);
    draftMinute.value = time.slice(3);
    apply();
  }
}
function moveMonth(amount: number) {
  visible.value = shiftMonth(visible.value, amount);
  focusDate.value = dateValue(visible.value);
}
async function dateKey(event: KeyboardEvent, value: string) {
  let next = value;
  if (event.key === "ArrowLeft") next = shiftDay(value, -1);
  else if (event.key === "ArrowRight") next = shiftDay(value, 1);
  else if (event.key === "ArrowUp") next = shiftDay(value, -7);
  else if (event.key === "ArrowDown") next = shiftDay(value, 7);
  else if (event.key === "PageUp" || event.key === "PageDown")
    next = dateValue(shiftMonth(parseDate(value)!, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1)));
  else if (event.key === "Home" || event.key === "End") {
    const index = days.value.findIndex((day) => day.value === value);
    next = shiftDay(value, (event.key === "Home" ? 0 : 6) - (index % 7));
  } else return;
  event.preventDefault();
  event.stopPropagation();
  if (dayDisabled(next)) return;
  focusDate.value = next;
  visible.value = parseDate(next)!;
  await nextTick();
  panel.value?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus();
}
function timeKey(event: KeyboardEvent) {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const items = [...((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const index =
    event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
  event.preventDefault();
  event.stopPropagation();
  items[index]?.focus();
}
function escape(event: KeyboardEvent) {
  if (event.key !== "Escape" || !open.value) return;
  event.preventDefault();
  event.stopPropagation();
  close(true);
}
function inputKey(event: KeyboardEvent) {
  if (event.key === "ArrowDown" && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    void show();
  } else escape(event);
}
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) close();
}
function clearFocusCheck() {
  if (focusTimer !== undefined) clearTimeout(focusTimer);
  focusTimer = undefined;
}
function focusOut(event: FocusEvent) {
  // During a native focus transfer, activeElement can briefly be body before focusin.
  // Closing in nextTick would inert the destination button before its click is delivered.
  if (event.relatedTarget instanceof Node && root.value?.contains(event.relatedTarget)) return;
  clearFocusCheck();
  const ticket = motionTicket;
  focusTimer = setTimeout(() => {
    focusTimer = undefined;
    if (ticket === motionTicket && open.value && !root.value?.contains(document.activeElement)) close();
  }, 0);
}
watch(
  () => props.modelValue,
  (value) => {
    if (value !== normalizePickerValue(raw.value, props.type)) raw.value = value;
    applyValidity();
  },
);
watch(() => [props.min, props.max, props.required], applyValidity);
watch(
  () => `${visible.value.year}-${visible.value.month}`,
  () => {
    if (!open.value || !calendar.value?.animate) return;
    monthAnimation?.cancel();
    const style = getComputedStyle(calendar.value);
    // Keep the live grid mounted, so changing month never throws away the input or calendar focus.
    monthAnimation = calendar.value.animate([{ opacity: 0.35 }, { opacity: 1 }], {
      duration: reducedMotion() ? 100 : durationOf(style.animationDuration),
      easing: style.getPropertyValue("--tp-ease-enter").trim() || "ease",
    });
  },
  { flush: "post" },
);
watch(
  () => props.disabled,
  (value) => {
    if (value) close();
  },
);
onMounted(() => {
  applyValidity();
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("scroll", updatePosition, true);
  window.addEventListener("resize", updatePosition);
});
onBeforeUnmount(() => {
  ++motionTicket;
  clearFocusCheck();
  panelAnimation?.cancel();
  monthAnimation?.cancel();
  if (panel.value?.hidePopover && panel.value.matches(":popover-open")) panel.value.hidePopover();
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("scroll", updatePosition, true);
  window.removeEventListener("resize", updatePosition);
});
defineExpose({ focus: () => input.value?.focus(), open: show, close });
</script>

<template>
  <div
    ref="root"
    class="tp-date-field"
    :class="[attrs.class, { 'is-disabled': disabled }]"
    :style="attrs.style"
    @focusin="clearFocusCheck"
    @focusout="focusOut"
    @keydown="escape"
  >
    <div class="tp-date-control" :class="{ 'is-open': open, 'is-invalid': !!error || attrs['aria-invalid'] === true || attrs['aria-invalid'] === 'true' }">
      <input
        v-bind="inputAttrs()"
        :id="inputId"
        ref="input"
        class="tp-date-input"
        type="text"
        :value="raw"
        :name="name"
        :placeholder="placeholder"
        :disabled="disabled"
        :required="required"
        :aria-invalid="ariaInvalid()"
        :aria-describedby="describedBy()"
        autocomplete="off"
        spellcheck="false"
        @input="edit"
        @blur="blur"
        @keydown="inputKey"
        @invalid="touched = true"
      />
      <button
        ref="trigger"
        type="button"
        class="tp-date-trigger"
        :disabled="disabled"
        :aria-label="`打开${kindLabel}选择器`"
        aria-haspopup="dialog"
        :aria-expanded="open"
        :aria-controls="panelId"
        @click="toggle"
      >
        <TpIcon :icon="type === 'time' ? PhClock : PhCalendarBlank" :size="17" />
      </button>
    </div>
    <p v-if="error" :id="errorId" class="tp-date-error" role="alert">{{ error }}</p>
    <div
      v-if="present"
      :id="panelId"
      ref="panel"
      class="tp-date-panel"
      popover="manual"
      role="dialog"
      :inert="!open"
      :aria-hidden="!open || undefined"
      :data-state="open ? 'open' : 'closing'"
      :aria-labelledby="titleId"
      :style="position"
      @keydown="escape"
    >
      <header class="tp-date-panel__title">
        <span :id="titleId">选择{{ kindLabel }}</span>
        <button type="button" class="tp-date-icon" aria-label="关闭日期时间面板" @click="close(true)"><TpIcon :icon="PhX" :size="16" /></button>
      </header>
      <template v-if="type !== 'time'">
        <div class="tp-date-month">
          <button type="button" class="tp-date-icon" aria-label="上个月" :disabled="visible.year === 1 && visible.month === 1" @click="moveMonth(-1)">
            <TpIcon :icon="PhCaretLeft" :size="16" />
          </button>
          <strong aria-live="polite">{{ visible.year }} 年 {{ visible.month }} 月</strong>
          <button type="button" class="tp-date-icon" aria-label="下个月" :disabled="visible.year === 9999 && visible.month === 12" @click="moveMonth(1)">
            <TpIcon :icon="PhCaretRight" :size="16" />
          </button>
        </div>
        <div ref="calendar" class="tp-date-grid" role="grid" :aria-label="`${visible.year}年${visible.month}月`">
          <div class="tp-date-week" role="row">
            <span v-for="label in ['一', '二', '三', '四', '五', '六', '日']" :key="label" role="columnheader">{{ label }}</span>
          </div>
          <div v-for="(week, index) in weeks" :key="index" class="tp-date-week" role="row">
            <button
              v-for="day in week"
              :key="day.value"
              type="button"
              role="gridcell"
              :data-date="day.value"
              class="tp-date-day"
              :class="{ 'is-outside': !day.currentMonth, 'is-today': day.value === localToday() }"
              :disabled="dayDisabled(day.value)"
              :aria-label="day.value"
              :aria-selected="day.value === draftDate"
              :aria-current="day.value === localToday() ? 'date' : undefined"
              :tabindex="day.value === focusDate ? 0 : -1"
              @click="selectDate(day.value)"
              @keydown="dateKey($event, day.value)"
            >
              {{ day.day }}
            </button>
          </div>
        </div>
      </template>
      <div v-if="type !== 'date'" class="tp-date-time">
        <div class="tp-date-time__heading"><TpIcon :icon="PhClock" :size="15" /><strong>{{ draftHour }}:{{ draftMinute }}</strong><span>24 小时制</span></div>
        <div class="tp-date-time__columns">
          <div>
            <span :id="`${generatedId}-hours`" class="tp-date-time__label">小时</span>
            <div class="tp-date-time__list" role="listbox" :aria-labelledby="`${generatedId}-hours`" @keydown="timeKey">
              <button
                v-for="hour in hours"
                :key="hour"
                type="button"
                role="option"
                :aria-selected="draftHour === hour"
                :disabled="hourDisabled(hour)"
                :tabindex="draftHour === hour ? 0 : -1"
                @click="
                  draftHour = hour;
                  panelError = '';
                "
              >
                {{ hour }}
              </button>
            </div>
          </div>
          <div>
            <span :id="`${generatedId}-minutes`" class="tp-date-time__label">分钟</span>
            <div class="tp-date-time__list" role="listbox" :aria-labelledby="`${generatedId}-minutes`" @keydown="timeKey">
              <button
                v-for="minute in minutes"
                :key="minute"
                type="button"
                role="option"
                :aria-selected="draftMinute === minute"
                :disabled="minuteDisabled(minute)"
                :tabindex="draftMinute === minute ? 0 : -1"
                @click="
                  draftMinute = minute;
                  panelError = '';
                "
              >
                {{ minute }}
              </button>
            </div>
          </div>
        </div>
      </div>
      <p v-if="panelError" class="tp-date-error" role="alert">{{ panelError }}</p>
      <footer class="tp-date-actions">
        <button type="button" @click="clear">清空</button>
        <button type="button" :disabled="type !== 'time' && dayDisabled(localToday())" @click="today">{{ type === "time" ? "现在" : "今天" }}</button>
        <button v-if="type !== 'date'" type="button" class="tp-date-apply" @click="apply">应用{{ kindLabel }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.tp-date-field {
  width: 100%;
  min-width: 0;
}
.tp-date-control {
  display: flex;
  align-items: center;
  min-height: 36px;
  padding-right: 4px;
  border: var(--tp-border-w) solid var(--tp-outline);
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-raised);
  transition:
    border-color var(--tp-dur-fast),
    box-shadow var(--tp-dur-fast);
}
.tp-date-control:hover {
  border-color: var(--tp-line-strong);
}
.tp-date-control:focus-within,
.tp-date-control.is-open {
  border-color: var(--tp-focus);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tp-focus) 18%, transparent);
}
.tp-date-control.is-invalid {
  border-color: var(--tp-danger);
}
.tp-date-input {
  appearance: none;
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 34px;
  padding: 0 11px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--tp-text);
  font-family: var(--tp-font-mono);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.tp-date-input::placeholder {
  color: var(--tp-text-faint);
  font-family: var(--tp-font-body);
  font-size: 12px;
}
.tp-date-input:focus-visible {
  outline: none;
}
.tp-date-trigger,
.tp-date-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: var(--tp-radius-xs);
  color: var(--tp-text-muted);
  background: transparent;
}
.tp-date-trigger:hover,
.tp-date-icon:hover {
  color: var(--tp-accent-soft-content);
  background: var(--tp-accent-soft);
}
.tp-date-field.is-disabled {
  opacity: 0.55;
}
.tp-date-field.is-disabled .tp-date-control {
  background: var(--tp-surface-sunken);
}
.tp-date-panel {
  position: fixed;
  inset: auto;
  margin: 0;
  padding: 12px;
  overflow: auto;
  overscroll-behavior: contain;
  border: var(--tp-border-w) solid var(--tp-outline);
  border-radius: var(--tp-radius-m);
  background: var(--tp-surface-raised);
  color: var(--tp-text);
  box-shadow: var(--tp-shadow-3);
  font-family: var(--tp-font-body);
  font-size: 13px;
  z-index: 80;
  scrollbar-width: thin;
  transition-duration: var(--tp-dur-base);
  animation-duration: var(--tp-dur-fast);
  transform-origin: top left;
}
.tp-date-panel[inert] {
  pointer-events: none;
}
.tp-date-grid {
  animation-duration: var(--tp-dur-base);
}
.tp-date-panel::backdrop {
  background: transparent;
}
.tp-date-panel__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--tp-line);
  font-weight: 600;
}
.tp-date-panel__title > span {
  font-size: 12px;
  color: var(--tp-text-muted);
}
.tp-date-month {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0 8px;
}
.tp-date-month strong {
  font-weight: 650;
}
.tp-date-week {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 3px;
}
.tp-date-week + .tp-date-week {
  margin-top: 3px;
}
.tp-date-week > span {
  padding: 5px 0 8px;
  text-align: center;
  font-size: 11px;
  color: var(--tp-text-faint);
}
.tp-date-day {
  position: relative;
  min-width: 0;
  height: 32px;
  border: 1px solid transparent;
  border-radius: var(--tp-radius-s);
  font-family: var(--tp-font-mono);
  font-size: 12px;
  transition: background-color var(--tp-dur-fast);
}
.tp-date-day:hover:not(:disabled) {
  background: var(--tp-accent-soft);
  color: var(--tp-accent-soft-content);
}
.tp-date-day.is-outside {
  color: var(--tp-text-faint);
}
.tp-date-day.is-today::after {
  content: "";
  position: absolute;
  bottom: 3px;
  left: calc(50% - 2px);
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
}
.tp-date-day[aria-selected="true"] {
  background: var(--tp-action-fill);
  color: var(--tp-action-content);
  font-weight: 700;
}
.tp-date-panel button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.tp-date-panel button:focus-visible,
.tp-date-trigger:focus-visible {
  outline: 2px solid var(--tp-focus);
  outline-offset: 1px;
}
.tp-date-time {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--tp-line);
}
.tp-date-time__heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.tp-date-time__heading strong {
  font-family: var(--tp-font-mono);
  font-size: 17px;
}
.tp-date-time__heading > span {
  margin-left: auto;
  color: var(--tp-text-faint);
  font-size: 11px;
}
.tp-date-time__columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.tp-date-time__label {
  display: block;
  margin-bottom: 6px;
  color: var(--tp-text-muted);
  text-align: center;
  font-size: 11px;
}
.tp-date-time__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 136px;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 4px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
  scrollbar-width: thin;
}
.tp-date-time__list button {
  flex: none;
  height: 30px;
  border-radius: var(--tp-radius-xs);
  font-family: var(--tp-font-mono);
}
.tp-date-time__list button:hover:not(:disabled) {
  background: var(--tp-accent-soft);
  color: var(--tp-accent-soft-content);
}
.tp-date-time__list button[aria-selected="true"] {
  background: var(--tp-action-fill);
  color: var(--tp-action-content);
  font-weight: 700;
}
.tp-date-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: 10px;
  margin-top: 10px;
  border-top: 1px solid var(--tp-line);
}
.tp-date-actions button {
  min-height: 30px;
  padding: 0 10px;
  border-radius: var(--tp-radius-s);
  font-size: 12px;
}
.tp-date-actions button:hover:not(:disabled) {
  background: var(--tp-surface-sunken);
}
.tp-date-actions .tp-date-apply {
  margin-left: auto;
  background: var(--tp-action-fill);
  color: var(--tp-action-content);
}
.tp-date-actions .tp-date-apply:hover {
  background: var(--tp-action-hover);
}
.tp-date-error {
  margin-top: 6px;
  color: var(--tp-danger-content);
  font-size: 11px;
  line-height: 1.6;
}
</style>
