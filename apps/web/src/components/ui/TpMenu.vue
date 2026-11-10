<script setup lang="ts">
import { ref } from "vue";
import { onClickOutside, onKeyStroke } from "@vueuse/core";

/** 下拉菜单（L3 浮动层）：触发器走 trigger 插槽，菜单项用 .tp-menu__item。 */
withDefaults(defineProps<{ align?: "start" | "end" }>(), { align: "start" });
const open = ref(false);
const root = ref<HTMLElement>();
onClickOutside(root, () => (open.value = false));
onKeyStroke("Escape", () => (open.value = false));
</script>

<template>
  <div ref="root" class="relative inline-block">
    <slot name="trigger" :open="open" :toggle="() => (open = !open)" />
    <Transition name="tp-pop">
      <div
        v-if="open"
        class="tp-menu absolute top-[calc(100%+6px)] z-30"
        :class="align === 'end' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'"
        role="menu"
        @click="open = false"
      >
        <slot />
      </div>
    </Transition>
  </div>
</template>
