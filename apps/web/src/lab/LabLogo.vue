<script setup lang="ts">
/** 标志：一段铅笔虚线，变成墨线，最后落下一枚印章 —— 产品原则的缩写。 */
withDefaults(defineProps<{ size?: number }>(), { size: 32 });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="7" fill="var(--tp-surface-inverse)" />
    <path d="M6 22c4-10 7-10 10-4" fill="none" stroke="var(--tp-pencil-line)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="2.6 3.4" />
    <path d="M16 18c2 4 5 3 7-5" fill="none" stroke="var(--tp-text-inverse)" stroke-width="2.4" stroke-linecap="round" />
    <rect x="21" y="6.5" width="6" height="6" rx="1.2" fill="var(--tp-seal)" />
  </svg>
</template>
