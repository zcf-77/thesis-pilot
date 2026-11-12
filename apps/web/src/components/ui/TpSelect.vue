<script setup lang="ts" generic="T extends string | number = string">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useAttrs, useId, watch } from "vue";
import { PhCaretDown, PhCheck, PhMagnifyingGlass, PhX } from "@phosphor-icons/vue";
import { useThemeScope } from "@/design/theme";
import TpIcon from "./TpIcon.vue";
import {
  filterSelectOptions,
  nextSelectIndex,
  selectPopoverPosition,
  typeaheadSelectIndex,
  selectPresenceTransition,
  selectMotionPlan,
  type SelectOption,
  type SelectPresence,
} from "./selectControl";

defineOptions({ inheritAttrs: false });
const props = withDefaults(
  defineProps<{
    modelValue?: T;
    options: readonly SelectOption[];
    id?: string;
    name?: string;
    disabled?: boolean;
    required?: boolean;
    placeholder?: string;
    searchable?: boolean;
    modelModifiers?: { number?: boolean };
  }>(),
  { placeholder: "请选择", searchable: undefined },
);
const emit = defineEmits<{
  "update:modelValue": [value: T];
  change: [value: T];
  blur: [event: FocusEvent];
}>();
const attrs = useAttrs();
const theme = useThemeScope();
const generatedId = useId();
const controlId = computed(() => props.id ?? `tp-select-${generatedId}`);
const listId = computed(() => `${controlId.value}-list`);
const errorId = computed(() => `${controlId.value}-required`);
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLDivElement>();
const list = ref<HTMLDivElement>();
const search = ref<HTMLInputElement>();
const presence = ref<SelectPresence>({ run: 0, phase: "hidden" });
const open = computed(() => presence.value.phase === "entering" || presence.value.phase === "shown");
const present = computed(() => presence.value.phase !== "hidden");
const query = ref("");
const active = ref(-1);
const invalidAttempt = ref(false);
const popupStyle = ref({ left: "12px", top: "12px", width: "248px", maxHeight: "392px" });
const placement = ref("bottom");
const selected = computed(() => props.options.find((option) => Object.is(option.value, props.modelValue)));
const filtered = computed(() => filterSelectOptions(props.options, query.value));
const hasSearch = computed(() => props.searchable ?? props.options.length > 7);
const activeId = computed(() => (open.value && active.value >= 0 ? `${listId.value}-option-${active.value}` : undefined));
const validValue = computed(() => selected.value !== undefined && selected.value.value !== "");
const displayText = computed(() => selected.value?.label ?? (props.modelValue !== undefined && props.modelValue !== "" ? "当前选项不可用" : props.placeholder));
let typeBuffer = "";
let typeTimer: ReturnType<typeof setTimeout> | undefined;
let resizeObserver: ResizeObserver | undefined;
let motion: Animation | undefined;
let disposed = false;

function currentAppearance() {
  if (!present.value || !panel.value) return undefined;
  const style = getComputedStyle(panel.value);
  return { opacity: style.opacity, transform: style.transform, filter: style.filter };
}
function finishMotion(run: number) {
  if (disposed || run !== presence.value.run) return;
  presence.value = selectPresenceTransition(presence.value, { complete: run });
  if (!present.value) {
    panel.value?.hidePopover?.();
    if (panel.value) panel.value.style.display = "none";
    query.value = "";
  }
}
function animatePopup(phase: "enter" | "leave", run: number, from?: { opacity: string; transform: string; filter: string }) {
  const element = panel.value;
  if (!element || disposed || run !== presence.value.run) return;
  element.dataset.phase = presence.value.phase;
  const style = getComputedStyle(element);
  const reduced =
    !!element.closest('[data-motion="reduced"]') || (matchMedia("(prefers-reduced-motion: reduce)").matches && !element.closest('[data-motion="full"]'));
  const plan = selectMotionPlan(
    phase,
    {
      duration: style.transitionDuration,
      easing: style.transitionTimingFunction,
      enterTransform: style.getPropertyValue("--tp-enter-transform").trim(),
      enterFilter: style.getPropertyValue("--tp-enter-filter").trim(),
    },
    reduced,
    from,
  );
  const running = element.animate(plan.frames, plan.timing);
  motion = running;
  void running.finished.then(
    () => {
      if (disposed || run !== presence.value.run || motion !== running) return;
      motion = undefined;
      finishMotion(run);
      running.cancel();
    },
    () => {},
  );
}

function forwardedAttrs() {
  const { class: _class, style: _style, ...rest } = attrs;
  return rest;
}
function wrapperClass() {
  return typeof attrs.class === "string" ? attrs.class.split(/\s+/).filter((value) => value !== "tp-input") : attrs.class;
}
function invalid() {
  return invalidAttempt.value || attrs["aria-invalid"] === true || attrs["aria-invalid"] === "true";
}
function describedBy() {
  return [attrs["aria-describedby"], invalidAttempt.value ? errorId.value : undefined].filter(Boolean).join(" ") || undefined;
}
function updatePosition() {
  if (!open.value || !trigger.value || !panel.value) return;
  const position = selectPopoverPosition(trigger.value.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, panel.value.scrollHeight);
  popupStyle.value = {
    left: `${position.left}px`,
    top: `${position.top}px`,
    width: `${position.width}px`,
    maxHeight: `${position.maxHeight}px`,
  };
  placement.value = position.side;
}
function revealActive() {
  const option = list.value?.querySelector<HTMLElement>(`[data-index="${active.value}"]`);
  if (!option || !list.value) return;
  const optionRect = option.getBoundingClientRect();
  const listRect = list.value.getBoundingClientRect();
  if (optionRect.top < listRect.top) list.value.scrollTop -= listRect.top - optionRect.top;
  else if (optionRect.bottom > listRect.bottom) list.value.scrollTop += optionRect.bottom - listRect.bottom;
}
function setActive(index: number) {
  active.value = index;
  void nextTick(revealActive);
}
async function show(direction: 1 | -1 = 1) {
  if (props.disabled || open.value) return;
  const from = currentAppearance();
  motion?.cancel();
  motion = undefined;
  presence.value = selectPresenceTransition(presence.value, "open");
  const run = presence.value.run;
  query.value = "";
  typeBuffer = "";
  const current = filtered.value.findIndex((option) => Object.is(option.value, props.modelValue) && !option.disabled);
  active.value = current >= 0 ? current : nextSelectIndex(filtered.value, direction === 1 ? -1 : 0, direction);
  await nextTick();
  if (disposed || run !== presence.value.run || !open.value || !panel.value) return;
  panel.value.inert = false;
  panel.value.removeAttribute("aria-hidden");
  panel.value.style.pointerEvents = "";
  panel.value.showPopover?.();
  updatePosition();
  animatePopup("enter", run, from);
  await nextTick();
  if (disposed || run !== presence.value.run || !open.value) return;
  updatePosition();
  if (hasSearch.value) search.value?.focus({ preventScroll: true });
  else trigger.value?.focus({ preventScroll: true });
  revealActive();
}
function close(restoreFocus = false) {
  if (!open.value) return;
  const from = currentAppearance();
  motion?.cancel();
  motion = undefined;
  presence.value = selectPresenceTransition(presence.value, "close");
  if (restoreFocus || panel.value?.contains(document.activeElement)) trigger.value?.focus({ preventScroll: true });
  // Stop interaction immediately while the painted panel finishes its themed exit.
  if (panel.value) {
    panel.value.inert = true;
    panel.value.setAttribute("aria-hidden", "true");
    panel.value.style.pointerEvents = "none";
  }
  animatePopup("leave", presence.value.run, from);
}
function toggle() {
  if (open.value) close(true);
  else void show();
}
function choose(option: SelectOption) {
  if (!open.value || props.disabled || option.disabled) return;
  const numeric = props.modelModifiers?.number && option.value !== "" ? Number(option.value) : undefined;
  const value = (numeric !== undefined && Number.isFinite(numeric) ? numeric : option.value) as T;
  emit("update:modelValue", value);
  emit("change", value);
  invalidAttempt.value = props.required && value === "";
  close(true);
}
function clearQuery() {
  query.value = "";
  search.value?.focus();
}
function keydown(event: KeyboardEvent) {
  if (props.disabled || event.isComposing) return;
  if (!open.value) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      void show(event.key === "ArrowUp" ? -1 : 1);
    }
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close(true);
  } else if (event.key === "Tab") {
    // Restore the trigger before the browser performs its normal next/previous field movement.
    close(true);
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    setActive(nextSelectIndex(filtered.value, active.value, event.key === "ArrowDown" ? 1 : -1));
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    setActive(nextSelectIndex(filtered.value, event.key === "Home" ? -1 : 0, event.key === "Home" ? 1 : -1));
  } else if (event.key === "Enter" || (event.key === " " && event.target !== search.value)) {
    event.preventDefault();
    const option = filtered.value[active.value];
    if (option) choose(option);
  } else if (event.key.length === 1 && event.target !== search.value && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    clearTimeout(typeTimer);
    typeBuffer += event.key;
    const found = typeaheadSelectIndex(filtered.value, typeBuffer, active.value);
    if (found >= 0) setActive(found);
    typeTimer = setTimeout(() => (typeBuffer = ""), 700);
  }
}
function outside(event: PointerEvent) {
  if (open.value && event.target instanceof Node && !root.value?.contains(event.target)) close();
}
async function focusout(event: FocusEvent) {
  // During native focus transfer activeElement can briefly be BODY until focusin.
  // The declared destination is already reliable for internal search actions.
  if (event.relatedTarget instanceof Node && root.value?.contains(event.relatedTarget)) return;
  await nextTick();
  if (!root.value?.contains(document.activeElement)) {
    close();
    emit("blur", event);
  }
}
function requiredInvalid(event: Event) {
  event.preventDefault();
  invalidAttempt.value = true;
  trigger.value?.focus();
}

watch(query, () => {
  const current = query.value ? -1 : filtered.value.findIndex((option) => Object.is(option.value, props.modelValue) && !option.disabled);
  setActive(current >= 0 ? current : nextSelectIndex(filtered.value, -1, 1));
  void nextTick(updatePosition);
});
watch(
  () => props.options,
  () => {
    if (!open.value) return;
    const current = filtered.value.findIndex((option) => Object.is(option.value, props.modelValue) && !option.disabled);
    setActive(current >= 0 ? current : nextSelectIndex(filtered.value, -1, 1));
    void nextTick(updatePosition);
  },
  { deep: true },
);
watch(
  () => props.modelValue,
  () => {
    if (validValue.value) invalidAttempt.value = false;
  },
);
watch(
  () => props.disabled,
  (value) => {
    if (value) close();
  },
);
onMounted(() => {
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("resize", updatePosition);
  window.addEventListener("scroll", updatePosition, true);
  resizeObserver = new ResizeObserver(updatePosition);
  if (trigger.value) resizeObserver.observe(trigger.value);
});
onBeforeUnmount(() => {
  disposed = true;
  motion?.cancel();
  motion = undefined;
  presence.value = selectPresenceTransition(presence.value, "destroy");
  panel.value?.hidePopover?.();
  clearTimeout(typeTimer);
  resizeObserver?.disconnect();
  document.removeEventListener("pointerdown", outside, true);
  window.removeEventListener("resize", updatePosition);
  window.removeEventListener("scroll", updatePosition, true);
});
defineExpose({ focus: () => trigger.value?.focus(), close });
</script>

<template>
  <div ref="root" class="tp-select" :class="wrapperClass()" :style="attrs.style" @keydown="keydown" @focusout="focusout">
    <button
      v-bind="forwardedAttrs()"
      :id="controlId"
      ref="trigger"
      type="button"
      role="combobox"
      class="tp-select__trigger"
      :class="{ 'is-empty': !selected, 'is-open': open }"
      :disabled="disabled"
      :data-value="modelValue === undefined ? '' : String(modelValue)"
      :aria-controls="listId"
      :aria-expanded="open"
      :aria-activedescendant="activeId"
      :aria-required="required || undefined"
      :aria-invalid="invalid() || undefined"
      :aria-describedby="describedBy()"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <span class="tp-select__value">{{ displayText }}</span>
      <TpIcon :icon="PhCaretDown" :size="14" class="tp-select__caret" />
    </button>
    <input v-if="name" type="hidden" :name="name" :value="modelValue" :disabled="disabled" />
    <input
      v-if="required"
      class="tp-select__validation"
      type="text"
      tabindex="-1"
      aria-hidden="true"
      :value="validValue ? 'selected' : ''"
      :disabled="disabled"
      required
      @invalid="requiredInvalid"
    />
    <span v-if="invalidAttempt" :id="errorId" class="tp-select__error" role="alert">请选择一项后继续。</span>
    <div
      v-show="present"
      ref="panel"
      popover="manual"
      class="tp-select__popover"
      :data-theme="theme.id.value"
      :data-placement="placement"
      :data-phase="presence.phase"
      :inert="!open"
      :aria-hidden="!open || undefined"
      :style="popupStyle"
    >
      <div v-if="hasSearch" class="tp-select__search">
        <TpIcon :icon="PhMagnifyingGlass" :size="16" />
        <input
          ref="search"
          v-model="query"
          type="text"
          role="searchbox"
          autocomplete="off"
          spellcheck="false"
          aria-label="搜索选项"
          :aria-controls="listId"
          :aria-activedescendant="activeId"
          placeholder="搜索选项…"
        />
        <button v-if="query" type="button" class="tp-select__clear" aria-label="清空选项搜索" @click="clearQuery" @keydown.enter.stop @keydown.space.stop>
          <TpIcon :icon="PhX" :size="14" />
        </button>
      </div>
      <div :id="listId" ref="list" class="tp-select__list" role="listbox" :aria-labelledby="controlId">
        <template v-for="(option, index) in filtered" :key="`${typeof option.value}:${option.value}`">
          <div v-if="option.group && option.group !== filtered[index - 1]?.group" class="tp-select__group" role="presentation">{{ option.group }}</div>
          <button
            :id="`${listId}-option-${index}`"
            type="button"
            role="option"
            class="tp-select__option"
            :class="{ 'is-active': index === active }"
            tabindex="-1"
            :data-index="index"
            :data-value="String(option.value)"
            :aria-label="option.label"
            :aria-selected="Object.is(option.value, modelValue)"
            :aria-disabled="option.disabled || undefined"
            :disabled="option.disabled"
            @pointermove="!option.disabled && (active = index)"
            @mousedown.prevent
            @click="choose(option)"
          >
            <span class="tp-select__option-text"><span>{{ option.label }}</span><small v-if="option.description">{{ option.description }}</small></span>
            <span class="tp-select__mark"><TpIcon v-if="Object.is(option.value, modelValue)" :icon="PhCheck" :size="15" weight="bold" /></span>
          </button>
        </template>
        <div v-if="!filtered.length" class="tp-select__empty" role="status">
          <TpIcon :icon="PhMagnifyingGlass" :size="22" />
          <span>{{ query ? "没有匹配的选项" : "暂无可选项" }}</span>
          <button v-if="query" type="button" @click="clearQuery" @keydown.enter.stop @keydown.space.stop>清空搜索</button>
        </div>
      </div>
      <div v-if="hasSearch && filtered.length" class="tp-select__count">{{ filtered.length }} 项可查看</div>
    </div>
  </div>
</template>

<style scoped>
.tp-select {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  min-width: 0;
  width: 100%;
  vertical-align: middle;
}
.tp-select__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 38px;
  padding: 8px 12px;
  border: var(--tp-border-w) solid var(--tp-outline);
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-raised);
  color: var(--tp-text);
  font-family: var(--tp-font-body);
  font-size: 13px;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--tp-dur-fast) linear,
    background-color var(--tp-dur-fast) linear,
    box-shadow var(--tp-dur-fast) linear;
}
.tp-select__trigger:hover:not(:disabled) {
  border-color: var(--tp-line-strong);
  background: var(--tp-surface);
}
.tp-select__trigger:focus-visible,
.tp-select__trigger.is-open {
  outline: 2px solid var(--tp-focus);
  outline-offset: 2px;
  border-color: var(--tp-focus);
}
.tp-select__trigger[aria-invalid="true"] {
  border-color: var(--tp-danger);
}
.tp-select__trigger:disabled {
  cursor: not-allowed;
  color: var(--tp-text-faint);
  background: var(--tp-surface-sunken);
  border-color: var(--tp-line);
}
.tp-select__trigger.is-empty {
  color: var(--tp-text-muted);
}
.tp-select__value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tp-select__caret {
  flex: none;
  color: var(--tp-text-muted);
  transition: transform var(--tp-dur-fast) var(--tp-ease-standard);
}
.is-open .tp-select__caret {
  transform: rotate(180deg);
}
.tp-select__validation {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
  clip-path: inset(50%);
}
.tp-select__error {
  color: var(--tp-danger-content);
  font-size: 12px;
  margin-top: 6px;
}
.tp-select__popover {
  position: fixed;
  inset: auto;
  z-index: 80;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  border: var(--tp-border-w) solid var(--tp-line-strong);
  border-radius: var(--tp-radius-m);
  background: var(--tp-surface-raised);
  color: var(--tp-text);
  box-shadow: var(--tp-shadow-3);
  font-family: var(--tp-font-body);
  font-size: 13px;
  text-align: left;
  transform-origin: top left;
  transition-property: none;
  transition-duration: var(--tp-dur-base);
  transition-timing-function: var(--tp-ease-enter);
}
.tp-select__popover[data-placement="top"] {
  transform-origin: bottom left;
}
.tp-select__popover[data-phase="leaving"] {
  pointer-events: none;
  transition-duration: var(--tp-dur-fast);
  transition-timing-function: var(--tp-ease-exit);
}
:global([data-motion="reduced"]) .tp-select__popover {
  transition-duration: 100ms;
  transition-timing-function: linear;
}
@media (prefers-reduced-motion: reduce) {
  :global(html:not([data-motion="full"])) .tp-select__popover {
    transition-duration: 100ms;
    transition-timing-function: linear;
  }
}
.tp-select__popover::backdrop {
  background: transparent;
  pointer-events: none;
}
.tp-select__search {
  display: flex;
  flex: none;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--tp-line);
  color: var(--tp-text-muted);
}
.tp-select__search input {
  appearance: none;
  min-width: 0;
  width: 100%;
  padding: 4px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  outline: none;
  box-shadow: none;
  color: var(--tp-text);
  font: inherit;
  line-height: 1.5;
}
.tp-select__search input::placeholder {
  color: var(--tp-text-muted);
}
.tp-select__clear {
  display: grid;
  flex: none;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--tp-radius-xs);
}
.tp-select__clear:hover {
  background: var(--tp-surface-sunken);
  color: var(--tp-text);
}
.tp-select__list {
  flex: 1;
  min-height: 0;
  padding: 5px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scroll-padding: 5px;
}
.tp-select__option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 38px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: var(--tp-radius-s);
  text-align: left;
  line-height: 1.5;
  font: inherit;
  cursor: pointer;
}
.tp-select__option.is-active {
  border-color: var(--tp-line);
  background: var(--tp-surface-sunken);
}
.tp-select__option[aria-selected="true"] {
  color: var(--tp-accent-soft-content);
  background: var(--tp-accent-soft);
}
.tp-select__option:focus-visible {
  outline: 2px solid var(--tp-focus);
  outline-offset: -2px;
}
.tp-select__option:disabled {
  color: var(--tp-text-faint);
  cursor: not-allowed;
  background: transparent;
}
.tp-select__option-text {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
  overflow-wrap: anywhere;
}
.tp-select__option-text small {
  color: var(--tp-text-muted);
  font-size: 11px;
  line-height: 1.5;
}
.tp-select__mark {
  display: grid;
  flex: none;
  width: 18px;
  place-items: center;
}
.tp-select__group {
  padding: 11px 10px 5px;
  font-size: 11px;
  color: var(--tp-text-muted);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.tp-select__empty {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 24px 12px;
  color: var(--tp-text-muted);
}
.tp-select__empty button {
  min-height: 28px;
  padding: 4px 8px;
  border-radius: var(--tp-radius-s);
  color: var(--tp-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.tp-select__count {
  flex: none;
  padding: 7px 14px;
  border-top: 1px solid var(--tp-line);
  color: var(--tp-text-muted);
  font-size: 10px;
}
</style>
