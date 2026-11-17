<script setup lang="ts">
import { PhCloudCheck, PhCloudSlash, PhSpinnerGap } from "@phosphor-icons/vue";
import TpIcon from "@/components/ui/TpIcon.vue";

/** 状态栏：页码、字数、选区、当前章、本机草稿与缩放；数字用等宽字体，变化不跳动。 */
defineProps<{
  page: number;
  pages: number;
  laying: boolean;
  words: number;
  selected?: number;
  chapter?: string;
  draft: "idle" | "pending" | "saved" | "error";
  zoom: string;
}>();
const emit = defineEmits<{ zoom: [] }>();
</script>

<template>
  <footer class="writing-status" aria-label="正文状态">
    <span class="writing-status__item">
      <template v-if="pages">第 <b>{{ Math.max(1, page) }}</b> 页 / 共 <b>{{ pages }}</b> 页</template><template v-else>正在排版</template>
      <span v-if="laying && pages" class="writing-status__faint">· 排版中</span>
    </span>
    <span class="writing-status__item"><b>{{ words.toLocaleString() }}</b> 字</span>
    <span v-if="selected !== undefined" class="writing-status__item">已选 <b>{{ selected.toLocaleString() }}</b> 字</span>
    <span v-if="chapter" class="writing-status__item writing-status__chapter" :title="chapter">{{ chapter }}</span>
    <span class="writing-status__spacer" />
    <Transition name="tp-swap" mode="out-in">
      <span v-if="draft === 'pending'" key="pending" class="writing-status__item writing-status__faint"
        ><TpIcon :icon="PhSpinnerGap" :size="13" class="tp-spin" />正在保留草稿</span
      >
      <span v-else-if="draft === 'saved'" key="saved" class="writing-status__item"><TpIcon :icon="PhCloudCheck" :size="13" />草稿已保留在本机</span>
      <span v-else-if="draft === 'error'" key="error" class="writing-status__item is-danger"><TpIcon :icon="PhCloudSlash" :size="13" />草稿未能写入本机</span>
    </Transition>
    <button type="button" class="writing-status__zoom" :title="'切换缩放：' + zoom" @click="emit('zoom')">{{ zoom }}</button>
  </footer>
</template>

<style scoped>
.writing-status {
  display: flex;
  align-items: center;
  gap: 4px 16px;
  min-height: 32px;
  padding: 4px 14px;
  border-top: 1px solid var(--tp-line);
  background: var(--tp-surface);
  color: var(--tp-text-muted);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
}
.writing-status__item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.writing-status__item b {
  font-family: var(--tp-font-mono);
  font-weight: 500;
  color: var(--tp-text);
  font-variant-numeric: tabular-nums;
}
.writing-status__chapter {
  min-width: 0;
  max-width: 22em;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  color: var(--tp-text);
}
.writing-status__faint {
  color: var(--tp-text-faint);
}
.writing-status__spacer {
  flex: 1;
}
.is-danger {
  color: var(--tp-danger);
}
.writing-status__zoom {
  padding: 2px 8px;
  border-radius: var(--tp-radius-xs);
  font-family: var(--tp-font-mono);
  font-size: 11.5px;
  color: var(--tp-text-muted);
}
.writing-status__zoom:hover {
  background: var(--tp-surface-sunken);
  color: var(--tp-text);
}
@media (max-width: 599px) {
  .writing-status__chapter,
  .writing-status__item:nth-child(3) {
    display: none;
  }
}
</style>
