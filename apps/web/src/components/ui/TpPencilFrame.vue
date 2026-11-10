<script setup lang="ts">
import { ref } from "vue";
import { useElementSize } from "@vueuse/core";
import { useThemeScope } from "@/design/theme";

/**
 * 铅笔框：AI 提议的容器。
 *   pencil      虚线、手绘抖动 —— 尚未采纳
 *   generating  虚线流动 —— 正在生成
 *   inked       一笔实线沿边框描过，底色从铅笔浅底变为纸面 —— 学生已采纳（“落墨”）
 *   erased      褪成留白 —— 已拒绝 / 已取消
 */
withDefaults(defineProps<{ state?: "pencil" | "generating" | "inked" | "erased" }>(), { state: "pencil" });

const el = ref<HTMLElement>();
const { width, height } = useElementSize(el, undefined, { box: "border-box" });
const scope = useThemeScope();
const radius = () => parseFloat(scope.def.value.vars["radius-m"]);
</script>

<template>
  <div ref="el" class="tp-pf" :class="{ 'is-generating': state === 'generating', 'is-inked': state === 'inked', 'is-erased': state === 'erased' }">
    <svg v-if="width > 2" class="tp-pf__svg" aria-hidden="true">
      <rect class="tp-pf__pencil" x="0.75" y="0.75" :width="width - 1.5" :height="height - 1.5" :rx="radius()" />
      <rect class="tp-pf__ink" x="0.75" y="0.75" :width="width - 1.5" :height="height - 1.5" :rx="radius()" pathLength="100" />
    </svg>
    <div class="tp-pf__body"><slot /></div>
  </div>
</template>
