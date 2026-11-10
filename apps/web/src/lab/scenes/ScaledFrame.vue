<script setup lang="ts">
import { computed, ref } from "vue";
import { useElementSize } from "@vueuse/core";

/** 把固定设计尺寸的场景等比缩放到容器宽度（方案对比用同一张“设计稿”才公平）。 */
const props = withDefaults(defineProps<{ width?: number; height?: number; inert?: boolean }>(), { width: 1280, height: 800 });
const box = ref<HTMLElement>();
const { width: boxWidth } = useElementSize(box);
const scale = computed(() => (boxWidth.value > 0 ? boxWidth.value / props.width : 0));
</script>

<template>
  <div ref="box" class="relative w-full overflow-hidden" :style="{ height: height * scale + 'px' }">
    <div v-if="scale > 0" :inert="inert" :style="{ width: width + 'px', height: height + 'px', transform: 'scale(' + scale + ')', transformOrigin: '0 0' }">
      <slot />
    </div>
  </div>
</template>
