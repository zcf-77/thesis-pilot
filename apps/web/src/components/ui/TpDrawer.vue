<script setup lang="ts">
import { PhX } from "@phosphor-icons/vue";
import { nextTick, ref, useId, watch } from "vue";
import { onKeyStroke } from "@vueuse/core";
import TpButton from "./TpButton.vue";
import TpIcon from "./TpIcon.vue";

/** 抽屉（L4）：不离开当前舞台的详情与编辑，例如通知收件箱、任务详情、来源定位。 */
defineProps<{ title: string; eyebrow?: string }>();
const open = defineModel<boolean>("open", { required: true });
const panel = ref<HTMLElement>();
const titleId = useId();
let returnFocus: HTMLElement | null = null;

watch(open, async (value) => {
  if (value) {
    returnFocus = document.activeElement as HTMLElement | null;
    await nextTick();
    panel.value?.focus();
  } else {
    returnFocus?.focus();
  }
});
onKeyStroke("Escape", () => {
  if (open.value) open.value = false;
});
</script>

<template>
  <Teleport to="body">
    <Transition name="tp-drawer">
      <div v-if="open">
        <div class="tp-scrim" @click="open = false" />
        <aside ref="panel" class="tp-drawer" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
          <header class="flex items-start gap-3 border-b border-line px-5 py-4">
            <div class="min-w-0 flex-1">
              <p v-if="eyebrow" class="tp-label mb-1">{{ eyebrow }}</p>
              <h2 :id="titleId" class="tp-heading truncate">{{ title }}</h2>
            </div>
            <TpButton variant="ghost" size="sm" icon-only label="关闭" @click="open = false"><TpIcon :icon="PhX" /></TpButton>
          </header>
          <div class="min-h-0 flex-1 overflow-auto px-5 py-4"><slot /></div>
          <footer v-if="$slots.actions" class="flex justify-end gap-2 border-t border-line px-5 py-3"><slot name="actions" /></footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>
