<script setup lang="ts">
import { PhArrowsClockwise, PhCloudSlash, PhMagnifyingGlass, PhNotePencil } from "@phosphor-icons/vue";
import TpButton from "./TpButton.vue";
import TpIcon from "./TpIcon.vue";

/**
 * 空 / 错 / 无结果 状态块。
 *   empty     还没有内容 —— 说明这里将出现什么，并给出第一步
 *   noresult  查过但没有 —— 说明查的范围，给出放宽条件的办法
 *   error     失败 —— 说明原数据是否安全、可以怎么继续（重试）
 */
defineProps<{ kind: "empty" | "noresult" | "error"; title: string; desc?: string; retryable?: boolean }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="tp-state" :role="kind === 'error' ? 'alert' : undefined">
    <div class="tp-state__art">
      <svg width="96" height="72" viewBox="0 0 96 72" fill="none" aria-hidden="true">
        <rect x="18" y="10" width="52" height="56" rx="4" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 4" />
        <path d="M28 26h32M28 36h24M28 46h28" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".55" />
        <g :style="{ color: kind === 'error' ? 'var(--tp-danger)' : 'var(--tp-pencil)' }">
          <circle cx="70" cy="50" r="15" fill="var(--tp-surface-raised)" stroke="currentColor" stroke-width="1.5" />
          <foreignObject x="60" y="40" width="20" height="20">
            <TpIcon :icon="kind === 'error' ? PhCloudSlash : kind === 'noresult' ? PhMagnifyingGlass : PhNotePencil" :size="20" />
          </foreignObject>
        </g>
      </svg>
    </div>
    <p class="tp-state__title">{{ title }}</p>
    <p v-if="desc" class="tp-state__desc">{{ desc }}</p>
    <div v-if="$slots.default || retryable" class="tp-state__actions">
      <TpButton v-if="retryable" variant="outline" size="sm" @click="$emit('retry')"><TpIcon :icon="PhArrowsClockwise" />重试</TpButton>
      <slot />
    </div>
  </div>
</template>
