<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useAppearanceStore } from "@/stores/appearance";

/** 数字跳表：数值变化时滚动到新值。减弱动效时直接显示终值。 */
const props = withDefaults(defineProps<{ value: number; duration?: number; decimals?: number }>(), { duration: 900, decimals: 0 });
const appearance = useAppearanceStore();
const shown = ref(0);
let raf = 0;

function run(from: number, to: number) {
  cancelAnimationFrame(raf);
  if (appearance.motion === "reduced") {
    shown.value = to;
    return;
  }
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min((now - start) / props.duration, 1);
    const eased = 1 - (1 - t) ** 4;
    shown.value = from + (to - from) * eased;
    if (t < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
onMounted(() => run(0, props.value));
watch(
  () => props.value,
  (to, from) => run(from, to),
);
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <span style="font-variant-numeric: tabular-nums">{{ shown.toFixed(decimals) }}</span>
</template>
