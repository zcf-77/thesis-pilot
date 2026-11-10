<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

/** 环形进度：进入视口后从 0 画到目标值。中间内容由插槽提供。 */
const props = withDefaults(defineProps<{ value: number; size?: number; stroke?: number; color?: string; label: string }>(), { size: 72, stroke: 7 });
const r = computed(() => (props.size - props.stroke) / 2);
const c = computed(() => 2 * Math.PI * r.value);
const shown = ref(0);
onMounted(() => requestAnimationFrame(() => (shown.value = 1)));
const offset = computed(() => c.value * (1 - (Math.min(Math.max(props.value, 0), 100) / 100) * shown.value));
</script>

<template>
  <span
    class="tp-ring"
    role="img"
    :aria-label="label + ' ' + Math.round(value) + '%'"
    :style="{ width: size + 'px', height: size + 'px', '--ring-color': color }"
  >
    <svg :width="size" :height="size" :viewBox="'0 0 ' + size + ' ' + size" style="transform: rotate(-90deg)">
      <circle class="tp-ring__track" :cx="size / 2" :cy="size / 2" :r="r" :stroke-width="stroke" />
      <circle class="tp-ring__value" :cx="size / 2" :cy="size / 2" :r="r" :stroke-width="stroke" :stroke-dasharray="c" :stroke-dashoffset="offset" />
    </svg>
    <span class="tp-ring__label"><slot /></span>
  </span>
</template>
