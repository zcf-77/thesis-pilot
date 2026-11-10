<script setup lang="ts" generic="T extends string">
import { nextTick, onMounted, ref, watch } from "vue";
import { useResizeObserver } from "@vueuse/core";

/** 标签页头：下划线指示器在标签之间滑动。内容区由使用方按 v-model 渲染。 */
const props = defineProps<{ tabs: { value: T; label: string; count?: number }[]; label: string }>();
const model = defineModel<T>({ required: true });

const root = ref<HTMLElement>();
const bar = ref({ x: 0, w: 0 });

function measure() {
  const el = root.value?.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!el) return;
  bar.value = { x: el.offsetLeft, w: el.offsetWidth };
}
onMounted(measure);
watch(model, () => nextTick(measure));
watch(
  () => props.tabs,
  () => nextTick(measure),
  { deep: true },
);
useResizeObserver(root, measure);

function onKey(event: KeyboardEvent) {
  const index = props.tabs.findIndex((t) => t.value === model.value);
  const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (!delta) return;
  event.preventDefault();
  model.value = props.tabs[(index + delta + props.tabs.length) % props.tabs.length].value;
  void nextTick(() => root.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
}
</script>

<template>
  <div ref="root" class="tp-tabs" role="tablist" :aria-label="label" @keydown="onKey">
    <button
      v-for="tab in tabs"
      :key="tab.value"
      type="button"
      role="tab"
      class="tp-tabs__tab"
      :aria-selected="model === tab.value"
      :tabindex="model === tab.value ? 0 : -1"
      @click="model = tab.value"
    >
      {{ tab.label }}
      <span v-if="tab.count !== undefined" class="tp-tabs__count">{{ tab.count }}</span>
    </button>
    <span class="tp-tabs__bar" :style="{ width: bar.w + 'px', transform: 'translateX(' + bar.x + 'px)' }" aria-hidden="true" />
  </div>
</template>
