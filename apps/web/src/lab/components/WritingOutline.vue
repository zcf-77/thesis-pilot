<script setup lang="ts">
import { computed } from "vue";
import { PhX } from "@phosphor-icons/vue";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { PlanTask } from "../state/planState";
import type { LibraryRequirement } from "../state/libraryState";
import { collectChapters } from "../state/editorAdapter";
import { wordTarget } from "../services/libraryService";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpProgress from "@/components/ui/TpProgress.vue";
import { listMotionHooks } from "@/design/motion";
const props = defineProps<{
  doc?: ProseMirrorNode;
  cursor: number;
  title: string;
  version: number;
  tasks?: PlanTask[];
  requirements?: LibraryRequirement[];
  words: number;
  compact?: boolean;
}>();
defineEmits<{ select: [position: number]; close: [] }>();
const chapters = computed(() => collectChapters(props.doc).filter((c) => c.title !== props.title));
const current = computed(() => chapters.value.filter((c) => c.position < props.cursor).at(-1)?.id);
const target = computed(() => (props.requirements ? wordTarget(props.requirements).target : 0));
function confirmed(title: string) {
  const linked = props.tasks?.filter((t) => t.chapter === title || (t.chapter && title.includes(t.chapter)));
  return !!(
    linked?.length &&
    linked.every((t) => t.status === "confirmed" && t.evidence.some((e) => !e.archived && e.kind === "document" && e.version === props.version))
  );
}
</script>
<template>
  <div class="outline-content">
    <header>
      <h2>章节</h2>
      <TpButton v-if="compact" class="outline-close" variant="ghost" icon-only label="关闭章节目录" data-drawer-close @click="$emit('close')">
        <TpIcon :icon="PhX" :size="18" />
      </TpButton>
    </header>
    <TransitionGroup tag="nav" name="tp-list" v-bind="listMotionHooks" class="tp-list-group" aria-label="文章章节目录">
      <button
        v-for="chapter in chapters"
        :key="chapter.id"
        type="button"
        :class="{ active: current === chapter.id, nested: chapter.level > 2, 'without-evidence': !tasks }"
        :aria-current="current === chapter.id ? 'location' : undefined"
        @click="$emit('select', chapter.position)"
      >
        <span
          v-if="tasks"
          class="outline-state"
          :class="{ confirmed: confirmed(chapter.title), selected: current === chapter.id }"
          :title="confirmed(chapter.title) ? '学生已确认当前版本证据' : '尚未确认当前版本'"
          >{{ confirmed(chapter.title) ? "✓" : "" }}</span
        >
        <span>{{ chapter.title || "未命名章节" }}</span><small>{{ chapter.words.toLocaleString() }}</small>
      </button>
      <p v-if="!chapters.length" key="empty" class="outline-empty">给段落设置标题后，章节会出现在这里。</p>
    </TransitionGroup>
    <footer>
      <div><span>正文字符</span><strong>{{ words.toLocaleString() }}</strong></div>
      <TpProgress v-if="target" :value="(Math.min(words, target) / target) * 100" :label="`字数目标进度，${words} / ${target}`" />
      <p v-if="requirements">{{ target ? `目标 ≥ ${target.toLocaleString()} 字 · ${words >= target ? "已达数量目标" : "尚未达到"}` : "字数目标未绑定" }}</p>
      <small>不含标题、图表及参考文献；字数不代表质量。</small>
    </footer>
  </div>
</template>
<style scoped>
.outline-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 540px;
  padding: 20px 16px;
  gap: 24px;
}
.outline-content header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.outline-content h2 {
  font-size: 13px;
  font-weight: 650;
  color: var(--tp-text-muted);
}
.outline-close {
  flex: 0 0 auto;
  min-inline-size: 36px;
  min-block-size: 36px;
}
.outline-content nav {
  display: grid;
  gap: 7px;
}
.outline-content nav button {
  display: grid;
  grid-template-columns: 15px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 10px 8px;
  text-align: left;
  border-radius: var(--tp-radius-s);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.6;
}
.outline-content nav button.nested {
  margin-left: 16px;
  font-size: 12px;
  font-weight: 400;
}
.outline-content nav button.without-evidence {
  grid-template-columns: minmax(0, 1fr) auto;
}
.outline-content nav button.active {
  background: var(--tp-accent-soft);
  color: var(--tp-accent-soft-content);
}
.outline-content nav button:hover {
  background: var(--tp-surface-sunken);
}
.outline-content small {
  font-size: 11px;
  color: var(--tp-text-faint);
  font-variant-numeric: tabular-nums;
}
.outline-state {
  border: 1.5px dashed var(--tp-text-faint);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 9px;
}
.outline-state.confirmed {
  background: var(--tp-seal);
  border-style: solid;
  color: var(--tp-seal-content);
}
.outline-state.selected {
  border: 2px solid var(--tp-accent);
  box-shadow: inset 0 0 0 2px var(--tp-surface);
  background: var(--tp-accent);
}
footer {
  border-top: 1px solid var(--tp-line);
  padding-top: 20px;
  margin-top: auto;
  display: grid;
  gap: 10px;
}
footer > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 12px;
  color: var(--tp-text-muted);
}
footer strong {
  font-family: var(--tp-font-display);
  font-size: 25px;
  color: var(--tp-text);
}
footer p,
.outline-empty {
  font-size: 11px;
  line-height: 1.7;
  color: var(--tp-text-muted);
}
footer :deep(.tp-progress) {
  height: 5px;
  width: 100%;
}
@media (max-width: 959px) {
  .outline-content {
    min-height: 0;
  }
  .outline-content header,
  .outline-content footer {
    flex-shrink: 0;
  }
  .outline-content nav {
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
  }
}
</style>
