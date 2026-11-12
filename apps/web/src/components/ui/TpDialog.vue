<script setup lang="ts">
import { nextTick, ref, useId, watch } from "vue";
import { onKeyStroke } from "@vueuse/core";

/** 对话框（L4 模态层）。只用于需要中断的决定：冲突、破坏性操作、会话失效。普通编辑用抽屉或就地展开。 */
defineProps<{ title: string; description?: string }>();
const open = defineModel<boolean>("open", { required: true });
const panel = ref<HTMLElement>();
const titleId = useId();
let returnFocus: HTMLElement | null = null;

watch(open, async (value) => {
  if (value) {
    returnFocus = document.activeElement as HTMLElement | null;
    await nextTick();
    (panel.value?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.value)?.focus();
  } else {
    returnFocus?.focus();
  }
});
onKeyStroke("Escape", () => {
  if (open.value) open.value = false;
});

function trap(event: KeyboardEvent) {
  if (event.key !== "Tab" || !panel.value) return;
  const nodes = [
    ...panel.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => node.getClientRects().length > 0 && !node.closest('[inert], [aria-hidden="true"]'));
  if (nodes.length === 0) {
    event.preventDefault();
    panel.value.focus();
    return;
  }
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  const outside = !nodes.includes(document.activeElement as HTMLElement);
  if (event.shiftKey && (document.activeElement === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="tp-modal">
      <div v-if="open">
        <div class="tp-scrim" @click="open = false" />
        <div ref="panel" class="tp-dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1" @keydown="trap">
          <header class="px-6 pt-5 pb-1">
            <h2 :id="titleId" class="tp-title !text-[1.375rem]">{{ title }}</h2>
            <p v-if="description" class="tp-caption mt-1">{{ description }}</p>
          </header>
          <div class="px-6 py-4"><slot /></div>
          <footer v-if="$slots.actions" class="flex justify-end gap-2 px-6 pb-5"><slot name="actions" /></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
