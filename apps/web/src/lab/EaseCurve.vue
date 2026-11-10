<script setup lang="ts">
import { computed } from "vue";

/** 把 CSS 缓动（cubic-bezier / linear()）画成曲线，并用同一条曲线驱动下方的小球。 */
const props = defineProps<{ easing: string; duration: number; name: string; note: string; play: number }>();

const path = computed(() => {
  const bezier = props.easing.match(/cubic-bezier\(([^)]+)\)/);
  if (bezier) {
    const [a, b, c, d] = bezier[1].split(",").map(Number);
    return "M0,100 C" + a * 100 + "," + (1 - b) * 100 + " " + c * 100 + "," + (1 - d) * 100 + " 100,0";
  }
  const linear = props.easing.match(/linear\(([^)]+)\)/);
  if (linear) {
    const points = linear[1].split(",").map((p) => Number(p.trim().split(" ")[0]));
    return points.map((v, i) => (i === 0 ? "M" : "L") + (i / (points.length - 1)) * 100 + "," + (1 - v) * 100).join(" ");
  }
  return "M0,100 L100,0";
});
</script>

<template>
  <div class="tp-card p-4">
    <div class="flex items-baseline justify-between gap-2">
      <p class="tp-subheading">{{ name }}</p>
      <p class="tp-mono text-fg-muted">{{ duration }}ms</p>
    </div>
    <p class="tp-caption">{{ note }}</p>
    <svg viewBox="-6 -34 112 150" class="mt-2 w-full overflow-visible" aria-hidden="true">
      <path d="M0,0 H100 M0,100 H100" stroke="var(--tp-line)" stroke-width="0.8" stroke-dasharray="2 3" />
      <path d="M0,100 V0 M100,100 V0" stroke="var(--tp-line)" stroke-width="0.8" />
      <path
        :key="play"
        :d="path"
        pathLength="100"
        fill="none"
        stroke="var(--tp-accent)"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="lab-curve"
        :style="{ animationDuration: duration + 'ms' }"
      />
    </svg>
    <div class="lab-ball-track">
      <i :key="play" class="lab-ball" :style="{ animationDuration: duration + 'ms', animationTimingFunction: easing }" />
    </div>
  </div>
</template>
