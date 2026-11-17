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
    <footer class="writing-outline__foot">
      <div class="writing-outline__total"><span>正文字数</span><strong>{{ words.toLocaleString() }}</strong></div>
      <p class="writing-outline__target"><span class="writing-outline__ghost" aria-hidden="true" />字数目标未设置</p>
      <small>不含标题、表格、图片及参考文献；字数不代表质量。</small>
    </footer>
  </div>
</template>

<style scoped>
.writing-outline {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 18px 12px 16px;
  gap: 14px;
}
.writing-outline__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
  padding-inline: 6px;
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
  min-height: 34px;
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
.writing-outline__foot {
  display: grid;
  gap: 8px;
  margin-top: auto;
  padding: 14px 6px 0;
  border-top: 1px solid var(--tp-line);
}
.writing-outline__total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 12px;
  color: var(--tp-text-muted);
}
.writing-outline__total strong {
  font-family: var(--tp-font-display);
  font-weight: var(--tp-display-weight);
  font-size: 24px;
  color: var(--tp-text);
  font-variant-numeric: tabular-nums;
}
.writing-outline__target {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--tp-text-muted);
}
.writing-outline__ghost {
  width: 10px;
  height: 10px;
  border: 1.5px dashed var(--tp-ghost-line);
  border-radius: 50%;
}
.writing-outline__foot small {
  font-size: 11px;
  line-height: 1.6;
  color: var(--tp-text-faint);
}
</style>
