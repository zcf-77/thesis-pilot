<script setup lang="ts">
import type { Tone } from "@/design/tone";

/** 线性进度。value 为空表示不确定进度（处理中但无法估计）。 */
const props = defineProps<{ value?: number; tone?: Extract<Tone, "success" | "warning" | "danger" | "info" | "pencil" | "neutral">; label: string }>();
const color = () => (props.tone ? "var(--tp-" + props.tone + ")" : undefined);
</script>

<template>
  <div
    class="tp-progress"
    :class="{ 'tp-progress--indeterminate': value === undefined }"
    role="progressbar"
    :aria-label="label"
    :aria-valuenow="value"
    aria-valuemin="0"
    aria-valuemax="100"
    :style="{ '--pg-color': color() }"
  >
    <span class="tp-progress__fill" :style="{ width: (value ?? 40) + '%' }" />
  </div>
</template>
