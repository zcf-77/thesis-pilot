<script setup lang="ts">
import type { Tone } from "@/design/tone";

/**
 * 状态胶囊。色调只表达“语气”，文字才是状态本身 —— 永远同时给出文字。
 * live=true 时圆点带涟漪，表示正在进行（生成中、处理中、执行中）。
 */
withDefaults(defineProps<{ tone?: Tone; label: string; live?: boolean; size?: "sm" | "md" }>(), { tone: "neutral", size: "md" });
</script>

<template>
  <span class="tp-status" :class="{ 'is-live': live, 'tp-status--sm': size === 'sm' }" :data-tone="tone">
    <span class="tp-status__dot" aria-hidden="true" />
    {{ label }}
  </span>
</template>
