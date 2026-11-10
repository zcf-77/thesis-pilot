<script setup lang="ts">
import { PhCheck } from "@phosphor-icons/vue";
import { computed, onMounted, ref } from "vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import type { StageView } from "@/domain/types";

/**
 * 流程航线：阶段是途经点。走过的路是实线（事实），没走的路是虚线（计划）。
 * 当前阶段带涟漪。进入时实线从起点画到当前位置。
 */
const props = defineProps<{ stages: StageView[]; compact?: boolean }>();
defineEmits<{ select: [id: string] }>();

const mounted = ref(false);
onMounted(() => requestAnimationFrame(() => (mounted.value = true)));
const progress = computed(() => {
  if (!mounted.value || props.stages.length < 2) return 0;
  const current = props.stages.findIndex((s) => s.state === "current");
  const last = current >= 0 ? current : props.stages.filter((s) => s.state === "done").length - 1;
  return Math.max(last, 0) / (props.stages.length - 1);
});
</script>

<template>
  <ol class="tp-route" :class="{ 'tp-route--compact': compact }" :style="{ '--n': stages.length, '--p': progress }" aria-label="毕设流程阶段">
    <span class="tp-route__track" aria-hidden="true" />
    <span class="tp-route__fill" aria-hidden="true" />
    <li v-for="stage in stages" :key="stage.id" class="tp-route__stop" :data-state="stage.state" :aria-current="stage.state === 'current' ? 'step' : undefined">
      <span class="tp-route__dot"><TpIcon v-if="stage.state === 'done'" :icon="PhCheck" :size="11" weight="bold" /></span>
      <span class="tp-route__name">{{ stage.name }}</span>
      <span v-if="stage.date" class="tp-route__date">{{ stage.date }}</span>
    </li>
  </ol>
</template>
