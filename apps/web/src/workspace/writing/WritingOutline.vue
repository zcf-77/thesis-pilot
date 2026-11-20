<script setup lang="ts">
import { PhListMagnifyingGlass, PhX } from "@phosphor-icons/vue";
import { computed } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import { listMotionHooks } from "@/design/motion";
import type { DocsChapter } from "../editor/docsSnapshot.ts";
import { outlineRows } from "./structure.ts";

/** 章节目录：由正文标题派生（章节 ID = 标题块 ID），逐章字数与全文字数同一口径。 */
const props = defineProps<{ chapters: readonly DocsChapter[]; current?: string; words: number; compact: boolean; flash?: string }>();
const emit = defineEmits<{ select: [id: string]; close: [] }>();
const rows = computed(() => outlineRows(props.chapters));
</script>

<template>
  <div class="writing-outline">
    <header class="writing-outline__head">
      <h2 class="tp-label">章节目录</h2>
      <TpButton v-if="compact" class="writing-outline__close" variant="ghost" icon-only label="关闭章节目录" data-drawer-close @click="emit('close')">
        <TpIcon :icon="PhX" :size="18" />
      </TpButton>
    </header>
    <TransitionGroup tag="nav" name="tp-list" v-bind="listMotionHooks" class="writing-outline__list tp-list-group" aria-label="文章章节目录">
      <button
        v-for="row in rows"
        :key="row.id"
        type="button"
        class="writing-outline__row"
        :class="{ 'is-current': current === row.id, 'tp-flash': flash === row.id }"
        :style="{ '--depth': row.depth }"
        :data-level="row.level"
        :aria-current="current === row.id ? 'location' : undefined"
        @click="emit('select', row.id)"
      >
        <span class="writing-outline__title">{{ row.title.trim() || "未命名章节" }}</span>
        <small class="writing-outline__words">{{ row.words.toLocaleString() }}</small>
      </button>
      <p v-if="!rows.length" key="empty" class="writing-outline__empty">
        <TpIcon :icon="PhListMagnifyingGlass" :size="16" />
        <span>把段落设为标题后，章节会出现在这里。</span>
      </p>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.writing-outline {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 14px 8px;
  gap: 10px;
}
.writing-outline__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 36px;
  padding-inline: 8px 0;
}
.writing-outline__head h2 {
  color: var(--tp-text-muted);
}
.writing-outline__close {
  flex: none;
  min-inline-size: 36px;
  min-block-size: 36px;
}
.writing-outline__list {
  position: relative;
  display: grid;
  flex: 1;
  align-content: start;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.writing-outline__row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 8px;
  min-height: 36px;
  padding: 7px 8px 7px calc(10px + var(--depth, 0) * 14px);
  border-radius: var(--tp-radius-s);
  text-align: left;
  color: var(--tp-text);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  transition:
    background-color var(--tp-dur-instant) linear,
    color var(--tp-dur-instant) linear;
}
.writing-outline__row:not([data-level="1"]) {
  font-weight: 400;
  font-size: 12.5px;
  color: var(--tp-text-muted);
}
.writing-outline__row::before {
  content: "";
  position: absolute;
  inset-block: 8px;
  inset-inline-start: 2px;
  width: 2px;
  border-radius: 2px;
  background: transparent;
  transition: background-color var(--tp-dur-fast) linear;
}
.writing-outline__row:hover {
  background: var(--tp-surface-sunken);
  color: var(--tp-text);
}
.writing-outline__row.is-current {
  background: var(--tp-accent-soft);
  color: var(--tp-accent-soft-content);
}
.writing-outline__row.is-current::before {
  background: var(--tp-accent);
}
.writing-outline__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
}
.writing-outline__words {
  font-family: var(--tp-font-mono);
  font-size: 11px;
  color: var(--tp-text-faint);
  font-variant-numeric: tabular-nums;
}
.writing-outline__empty {
  display: flex;
  gap: 8px;
  padding: 10px 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--tp-text-muted);
}
.writing-outline__empty :deep(svg) {
  flex: none;
  margin-top: 3px;
}
</style>
