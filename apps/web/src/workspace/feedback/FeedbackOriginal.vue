<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, type FunctionalComponent } from "vue";
import { highlightSegments, selectionSourceRange, type SelectionLike, type SourceRange, type TextTreeNode } from "./feedbackSelection";

/** 不可变原文：只读展示，Selection API 选区换算为原文 UTF-16 范围。 */
const props = defineProps<{ text: string; highlight?: { from: number; to: number }; disabled?: boolean }>();
const emit = defineEmits<{ select: [range: SourceRange | undefined] }>();
const root = ref<HTMLElement>();
const segments = computed(() => highlightSegments(props.text, props.highlight));
/** Render function keeps text nodes exact: template formatting must never inject whitespace into the immutable original. */
const OriginalText: FunctionalComponent<{ before: string; mark: string; after: string }> = (value) => [
  value.before,
  value.mark ? h("mark", { class: "feedback-original__mark" }, value.mark) : null,
  value.after,
];

function capture() {
  if (props.disabled || !root.value) return;
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !root.value.contains(selection.anchorNode) || !root.value.contains(selection.focusNode))
    return;
  emit("select", selectionSourceRange(root.value as unknown as TextTreeNode, selection as unknown as SelectionLike, props.text));
}
onMounted(() => document.addEventListener("selectionchange", capture));
onBeforeUnmount(() => document.removeEventListener("selectionchange", capture));
</script>

<template>
  <blockquote ref="root" class="feedback-original" aria-label="导师反馈原文" tabindex="0" @mouseup="capture" @keyup="capture">
    <OriginalText v-bind="segments" />
  </blockquote>
</template>

<style scoped>
.feedback-original {
  margin: 24px 32px 16px;
  font-family: var(--tp-font-prose);
  font-size: 20px;
  line-height: 1.95;
  color: var(--tp-ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
.feedback-original :deep(.feedback-original__mark) {
  color: inherit;
  background: var(--tp-accent-soft);
  border-bottom: 2px solid var(--tp-accent);
}
@media (max-width: 1150px) {
  .feedback-original {
    margin: 20px 24px 16px;
    font-size: 18px;
  }
}
@media (max-width: 760px) {
  .feedback-original {
    margin: 20px;
    font-size: 17px;
  }
}
</style>
