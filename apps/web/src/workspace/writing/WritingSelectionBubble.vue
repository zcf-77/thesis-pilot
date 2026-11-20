<script setup lang="ts">
import { PhLockKey, PhLockKeyOpen, PhPencilSimpleLine } from "@phosphor-icons/vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import { panelMotionHooks } from "@/lab/components/integration/motion";

/** 选区气泡（L3）：就地提供“请 AI 起草”与锁定；不改正文，按下时不夺走纸面的选区。 */
defineProps<{
  position: { top: number; left: number } | null;
  draft: boolean;
  lock: "lock" | "unlock" | null;
  note?: string;
}>();
const emit = defineEmits<{ draft: []; lock: []; unlock: [] }>();
</script>

<template>
  <Teleport to="body">
    <Transition name="writing-bubble" v-bind="panelMotionHooks">
      <div
        v-if="position"
        class="writing-bubble"
        :style="{ top: position.top + 'px', left: position.left + 'px' }"
        role="toolbar"
        aria-label="选区操作"
        @mousedown.prevent
      >
        <button v-if="draft" type="button" class="writing-bubble__draft" @click="emit('draft')">
          <TpIcon :icon="PhPencilSimpleLine" :size="14" />请 AI 起草
        </button>
        <button v-if="lock === 'lock'" type="button" @click="emit('lock')"><TpIcon :icon="PhLockKey" :size="14" />锁定</button>
        <button v-else-if="lock === 'unlock'" type="button" @click="emit('unlock')"><TpIcon :icon="PhLockKeyOpen" :size="14" />解除锁定</button>
        <span v-if="note" class="writing-bubble__note">{{ note }}</span>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.writing-bubble {
  position: fixed;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  transform: translate(-50%, calc(-100% - 10px));
  border: var(--tp-border-w) solid var(--tp-outline);
  border-radius: var(--tp-radius-m);
  background: var(--tp-surface-raised);
  box-shadow: var(--tp-shadow-3);
  backdrop-filter: var(--tp-surface-backdrop);
  white-space: nowrap;
}
.writing-bubble button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 10px;
  border-radius: calc(var(--tp-radius-m) - 4px);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--tp-text);
  transition: background-color var(--tp-dur-instant) linear;
}
.writing-bubble button:hover {
  background: var(--tp-surface-sunken);
}
.writing-bubble__draft {
  color: var(--tp-pencil-content) !important;
  border: 1px dashed var(--tp-pencil-line);
  background: var(--tp-pencil-soft);
}
.writing-bubble__draft:hover {
  background: color-mix(in srgb, var(--tp-pencil-soft) 70%, var(--tp-pencil-line)) !important;
}
.writing-bubble__note {
  padding: 0 8px;
  font-size: 12px;
  color: var(--tp-text-muted);
}
/* 气泡用 transform 定位，进出用独立的 translate / scale 属性叠加，不与定位冲突。 */
.writing-bubble-enter-active {
  transition:
    opacity var(--tp-dur-base) var(--tp-ease-enter),
    translate var(--tp-dur-spring) var(--tp-ease-spring),
    scale var(--tp-dur-spring) var(--tp-ease-spring);
}
.writing-bubble-leave-active {
  transition:
    opacity var(--tp-dur-fast) var(--tp-ease-exit),
    translate var(--tp-dur-fast) var(--tp-ease-exit),
    scale var(--tp-dur-fast) var(--tp-ease-exit);
  pointer-events: none;
}
.writing-bubble-enter-from,
.writing-bubble-leave-to {
  opacity: 0;
  translate: 0 4px;
  scale: 0.96;
}
:global([data-motion="reduced"] .writing-bubble:is(.writing-bubble-enter-active, .writing-bubble-leave-active)) {
  transition: opacity 100ms linear;
  translate: none;
  scale: none;
}
</style>
