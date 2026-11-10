<script setup lang="ts" generic="T extends string">
import { nextTick, onMounted, ref, watch, type Component } from "vue";
import { useResizeObserver } from "@vueuse/core";
import TpIcon from "./TpIcon.vue";

/** 分段选择：互斥切换，滑块以弹簧曲线跟随。 */
const props = defineProps<{ options: { value: T; label: string; icon?: Component }[]; label: string }>();
const model = defineModel<T>({ required: true });

const root = ref<HTMLElement>();
const thumb = ref({ x: 0, w: 0, ready: false });

function measure() {
  const el = root.value?.querySelector<HTMLElement>('[aria-checked="true"]');
  if (!el) return;
  thumb.value = { x: el.offsetLeft, w: el.offsetWidth, ready: true };
}
onMounted(measure);
watch(model, () => nextTick(measure));
watch(
  () => props.options,
  () => nextTick(measure),
);
useResizeObserver(root, measure);

function onKey(event: KeyboardEvent) {
  const index = props.options.findIndex((o) => o.value === model.value);
  const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (!delta) return;
  event.preventDefault();
  const next = props.options[(index + delta + props.options.length) % props.options.length];
  model.value = next.value;
  void nextTick(() => root.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
}
</script>

<template>
  <div ref="root" class="tp-seg" role="radiogroup" :aria-label="label" @keydown="onKey">
    <span
      class="tp-seg__thumb"
      :style="{ width: thumb.w + 'px', transform: 'translateX(' + thumb.x + 'px)', opacity: thumb.ready ? 1 : 0 }"
      aria-hidden="true"
    />
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      class="tp-seg__item"
      :aria-checked="model === option.value"
      :tabindex="model === option.value ? 0 : -1"
      @click="model = option.value"
    >
      <TpIcon v-if="option.icon" :icon="option.icon" :size="15" />
      {{ option.label }}
    </button>
  </div>
</template>
