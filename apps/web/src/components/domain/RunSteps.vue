<script setup lang="ts">
import { PhArrowsClockwise } from "@phosphor-icons/vue";
import { computed } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { RunStepView } from "@/domain/types";
import { agents, runStepStatus } from "@/domain/vocab";

/**
 * 一次复杂请求拆成的多个子任务。部分失败必须被看见：汇总行如实写“几项完成、几项失败”，不写“已完成”。
 */
const props = defineProps<{ steps: RunStepView[] }>();
defineEmits<{ retry: [id: string] }>();

const summary = computed(() => {
  const count = (s: RunStepView["status"]) => props.steps.filter((x) => x.status === s).length;
  const parts: string[] = [];
  if (count("done")) parts.push(count("done") + " 项完成");
  if (count("running")) parts.push(count("running") + " 项执行中");
  if (count("waiting")) parts.push(count("waiting") + " 项等待");
  if (count("failed")) parts.push(count("failed") + " 项失败");
  if (count("cancelled")) parts.push(count("cancelled") + " 项已取消");
  return "共 " + props.steps.length + " 项：" + parts.join("，");
});
</script>

<template>
  <div class="tp-card tp-card--flat px-3 py-2">
    <p class="tp-caption pb-1.5">{{ summary }}</p>
    <ul class="tp-steps">
      <li v-for="step in steps" :key="step.id" class="tp-step" :data-status="step.status">
        <span class="tp-avatar tp-avatar--sm" :data-agent="step.agent">{{ agents[step.agent].short }}</span>
        <span class="truncate font-medium">{{ step.title }}</span>
        <span class="flex items-center gap-1.5">
          <TpButton v-if="step.status === 'failed'" size="sm" variant="ghost" icon-only :label="'重试：' + step.title" @click="$emit('retry', step.id)"
            ><TpIcon :icon="PhArrowsClockwise" :size="14"
          /></TpButton>
          <TpStatus :tone="runStepStatus[step.status].tone" :label="runStepStatus[step.status].label" :live="runStepStatus[step.status].live" size="sm" />
        </span>
        <p v-if="step.detail" class="tp-step__detail">{{ step.detail }}</p>
      </li>
    </ul>
  </div>
</template>
