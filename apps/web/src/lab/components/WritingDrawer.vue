<script setup lang="ts">
import { onBeforeUnmount, onDeactivated, ref, watch } from "vue";

const props = defineProps<{ compact: boolean; open: boolean; label: string }>();
const emit = defineEmits<{ dismiss: []; closed: [] }>();
const dialog = ref<HTMLDialogElement>();

function activate() {
  const element = dialog.value;
  if (!element || !props.compact || !props.open) return;
  element.inert = false;
  const wasOpen = element.open;
  if (!wasOpen) element.showModal();
  requestAnimationFrame(() => {
    if (!props.compact || !props.open || !element.open || element.inert || element.contains(document.activeElement)) return;
    element.querySelector<HTMLElement>("[data-drawer-close]")?.focus({ preventScroll: true });
  });
}

function release() {
  const element = dialog.value;
  if (!element) return;
  if (element.open) element.close();
  element.inert = false;
}

watch(
  [dialog, () => props.compact, () => props.open],
  () => {
    if (!props.compact) release();
    else activate();
  },
  { flush: "post" },
);

function beforeLeave(element: Element) {
  if (element instanceof HTMLDialogElement && element.open) element.inert = true;
}

function afterLeave() {
  if (props.open && props.compact) return;
  release();
  emit("closed");
}

function dismiss() {
  if (props.open) emit("dismiss");
}

function trapTab(event: KeyboardEvent) {
  const element = dialog.value;
  if (!element?.open || element.inert) return;
  const targets = [...element.querySelectorAll<HTMLElement>("button, a[href], input, textarea, select, summary, [tabindex]")].filter(
    (node) => node.tabIndex >= 0 && !node.matches(":disabled") && node.getClientRects().length > 0 && !node.closest('[inert], [aria-hidden="true"]'),
  );
  const focused = document.activeElement;
  const first = targets[0];
  const last = targets.at(-1);
  if (event.shiftKey && focused === first && last) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && focused === last && first) {
    event.preventDefault();
    first.focus();
  }
}

onDeactivated(release);
onBeforeUnmount(release);
</script>

<template>
  <Transition name="tp-drawer" :css="compact" @before-leave="beforeLeave" @after-leave="afterLeave" @leave-cancelled="activate">
    <dialog
      v-show="!compact || open"
      ref="dialog"
      class="write-drawer-dialog"
      :role="compact ? undefined : 'presentation'"
      :aria-label="compact ? label : undefined"
      @cancel.prevent="dismiss"
      @keydown.tab="trapTab"
    >
      <div v-if="compact" class="write-drawer-backdrop" aria-hidden="true" @click="dismiss" @wheel.prevent />
      <slot />
    </dialog>
  </Transition>
</template>

<style scoped>
.write-drawer-dialog {
  display: contents;
  color: inherit;
  font: inherit;
}
@media (max-width: 959px) {
  .write-drawer-dialog {
    position: fixed;
    inset: 0;
    display: none;
    margin: 0;
    padding: 0;
    border: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    background: transparent;
    overflow: hidden;
  }
  .write-drawer-dialog[open] {
    display: block;
  }
  .write-drawer-dialog::backdrop {
    background: transparent;
  }
  .write-drawer-backdrop {
    position: absolute;
    inset: 0;
    background: var(--tp-scrim);
    touch-action: none;
  }
  .write-drawer-dialog.tp-drawer-enter-active {
    transition: opacity var(--tp-dur-spring) linear;
  }
  .write-drawer-dialog.tp-drawer-leave-active {
    transition: opacity var(--tp-dur-moderate) linear;
  }
  .write-drawer-dialog.tp-drawer-enter-from,
  .write-drawer-dialog.tp-drawer-leave-to {
    opacity: 0;
  }
  :global([data-motion="reduced"] .write-drawer-dialog:is(.tp-drawer-enter-active, .tp-drawer-leave-active)) {
    transition: opacity 100ms linear;
  }
  :global([data-motion="reduced"] .write-drawer-dialog:is(.tp-drawer-enter-active, .tp-drawer-leave-active) .tp-drawer) {
    transition: none;
    opacity: 1;
  }
  :global(html:has(.write-drawer-dialog:modal)) {
    overflow: hidden;
  }
}
</style>
