<script setup lang="ts">
import { PhCheck, PhCloudSlash, PhPencilSimple } from "@phosphor-icons/vue";
import TpIcon from "./TpIcon.vue";

/**
 * 保存状态。正文保存 ≠ AI 修改采纳：这里只表达“草稿是否已落盘”。
 * failed 时文稿仍在编辑器内存中，提供重试，不清空。
 */
defineProps<{ state: "saved" | "saving" | "dirty" | "failed"; at?: string }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-[0.75rem] font-medium" role="status">
    <Transition name="tp-swap" mode="out-in">
      <span v-if="state === 'saved'" key="saved" class="inline-flex items-center gap-1 text-fg-muted">
        <TpIcon :icon="PhCheck" :size="13" weight="bold" class="text-ok-content" />已保存<template v-if="at"> · {{ at }}</template>
      </span>
      <span v-else-if="state === 'saving'" key="saving" class="inline-flex items-center gap-1.5 text-fg-muted">
        <span class="inline-block size-3 rounded-full border-[1.5px] border-current border-r-transparent tp-spin" />保存中
      </span>
      <span v-else-if="state === 'dirty'" key="dirty" class="inline-flex items-center gap-1 text-fg-muted">
        <TpIcon :icon="PhPencilSimple" :size="13" />有未保存的修改
      </span>
      <button
        v-else
        key="failed"
        type="button"
        class="inline-flex items-center gap-1 rounded-xs bg-bad-soft px-1.5 py-0.5 text-bad-content"
        @click="$emit('retry')"
      >
        <TpIcon :icon="PhCloudSlash" :size="13" />保存失败 · 文稿仍在本页，点此重试
      </button>
    </Transition>
  </span>
</template>
