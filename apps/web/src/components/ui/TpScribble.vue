<script setup lang="ts">
/** 铅笔涂写：AI 正在生成候选时的加载标记（区别于普通转圈 —— 转圈是系统在忙，涂写是 AI 在起草）。 */
withDefaults(defineProps<{ size?: number; label?: string }>(), { size: 28, label: "正在起草" });
</script>

<template>
  <span class="tp-scribble" role="status" :aria-label="label">
    <svg :width="size * 1.6" :height="size" viewBox="0 0 48 30">
      <path pathLength="100" d="M3 22 C 8 6, 12 6, 14 18 S 20 26, 23 12 S 29 4, 31 17 S 37 26, 40 11 L 45 8" />
    </svg>
  </span>
</template>
