<script setup lang="ts">
import { onMounted, ref, watch } from "vue";

/**
 * 印章：学生作出的决定。只用于“采纳 / 确认完成 / 已处理”这类由学生本人作出的动作，
 * 不用于 AI 判断，也不用于导师认可（本轮没有该状态）。
 * stamp 值变化时重播盖章动画。
 */
const props = withDefaults(defineProps<{ text: string; solid?: boolean; size?: "md" | "lg"; tone?: "seal" | "neutral"; animate?: boolean; stamp?: number }>(), {
  size: "md",
  tone: "seal",
  animate: true,
  stamp: 0,
});
const stamping = ref(false);
function play() {
  if (!props.animate) return;
  stamping.value = false;
  requestAnimationFrame(() => (stamping.value = true));
}
onMounted(play);
watch(() => props.stamp, play);
</script>

<template>
  <span
    class="tp-seal"
    :class="{ 'tp-seal--solid': solid, 'tp-seal--lg': size === 'lg', 'is-stamping': stamping }"
    :data-tone="tone"
    @animationend="stamping = false"
  >
    <slot name="icon" />{{ text }}
  </span>
</template>
