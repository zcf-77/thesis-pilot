<script setup lang="ts">
import { PhX } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpTabs from "@/components/ui/TpTabs.vue";

/** 副驾坞外框：面板标签、关闭、宽度调整（320—480，拖拽或方向键）。面板内容由写作页按注册表放入。 */
const props = defineProps<{ tabs: { value: string; label: string }[]; closable: boolean; resizable: boolean; closeLabel: string }>();
const active = defineModel<string>("active", { required: true });
const width = defineModel<number>("width", { required: true });
const emit = defineEmits<{ close: [] }>();
const MIN = 320;
const MAX = 480;
const clamp = (value: number) => Math.min(MAX, Math.max(MIN, Math.round(value)));

function drag(event: PointerEvent) {
  if (!props.resizable) return;
  const handle = event.currentTarget as HTMLElement;
  const start = event.clientX;
  const initial = width.value;
  handle.setPointerCapture(event.pointerId);
  const move = (next: PointerEvent) => (width.value = clamp(initial + start - next.clientX));
  const stop = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", stop);
    handle.removeEventListener("pointercancel", stop);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
}
</script>

<template>
  <aside class="writing-copilot" aria-label="写作副驾">
    <button
      v-if="resizable"
      class="writing-copilot__resize"
      type="button"
      role="separator"
      aria-orientation="vertical"
      :aria-valuenow="width"
      :aria-valuemin="MIN"
      :aria-valuemax="MAX"
      aria-label="调整副驾宽度（左右方向键）"
      @pointerdown.prevent="drag"
      @keydown.left.prevent="width = clamp(width + 16)"
      @keydown.right.prevent="width = clamp(width - 16)"
    />
    <header class="writing-copilot__head">
      <TpTabs v-model="active" :tabs="tabs" label="副驾面板" class="writing-copilot__tabs" />
      <TpButton v-if="closable" class="writing-copilot__close" variant="ghost" icon-only :label="closeLabel" data-drawer-close @click="emit('close')">
        <TpIcon :icon="PhX" :size="17" />
      </TpButton>
    </header>
    <div class="writing-copilot__body">
      <slot />
    </div>
  </aside>
</template>

<style scoped>
.writing-copilot {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  border: var(--tp-border-w) solid var(--tp-line-strong);
  border-radius: var(--tp-radius-m);
  background: var(--tp-surface-raised);
  box-shadow: var(--tp-shadow-1);
}
.writing-copilot__resize {
  position: absolute;
  inset-block: 12px;
  left: -10px;
  z-index: 3;
  width: 12px;
  cursor: col-resize;
  border-radius: 6px;
  background: transparent;
  transition: background-color var(--tp-dur-instant) linear;
}
.writing-copilot__resize:hover,
.writing-copilot__resize:focus-visible {
  background: color-mix(in srgb, var(--tp-accent) 18%, transparent);
  outline: none;
}
.writing-copilot__head {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 4px 8px 0 12px;
  border-bottom: 1px solid var(--tp-line);
}
.writing-copilot__tabs {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.writing-copilot__tabs :deep(.tp-tabs__tab) {
  padding: 12px 10px;
  font-size: 12.5px;
}
.writing-copilot__close {
  flex: none;
  align-self: center;
  min-inline-size: 36px;
  min-block-size: 36px;
}
.writing-copilot__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px;
  scrollbar-width: thin;
}
</style>
