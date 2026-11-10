<script setup lang="ts">
import { PhBrain, PhPlugs, PhRobot, PhTextAa, PhWarningCircle } from "@phosphor-icons/vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import type { ConfigNodeView } from "@/domain/types";

/**
 * 四库关联链：接口 → 模型 → 提示词 → 智能体。
 * 任一环停用或无效，下游连线变成红色虚线并写明原因；系统不会静默换用另一个配置。
 */
const props = defineProps<{ nodes: ConfigNodeView[] }>();
const meta = {
  api: { name: "AI 接口库", icon: PhPlugs },
  model: { name: "模型库", icon: PhBrain },
  prompt: { name: "提示词库", icon: PhTextAa },
  agent: { name: "智能体库", icon: PhRobot },
};
const word = {
  active: { tone: "success", label: "启用" },
  disabled: { tone: "neutral", label: "停用" },
  invalid: { tone: "danger", label: "关联无效" },
} as const;
const brokenFrom = () => props.nodes.findIndex((n) => n.state !== "active");
</script>

<template>
  <div class="tp-chain">
    <div
      v-for="(node, i) in nodes"
      :key="node.lib"
      class="tp-card tp-chain__node"
      :class="{ 'is-broken': node.state !== 'active', 'is-after-broken': brokenFrom() >= 0 && i > brokenFrom() }"
      :data-state="node.state"
    >
      <p class="tp-label flex items-center gap-1.5"><TpIcon :icon="meta[node.lib].icon" :size="13" />{{ meta[node.lib].name }}</p>
      <p class="mt-1.5 truncate font-semibold">{{ node.name }}</p>
      <p class="mt-2 flex flex-wrap items-center gap-1.5">
        <TpVersion :v="node.version" /><TpStatus :tone="word[node.state].tone" :label="word[node.state].label" size="sm" />
      </p>
      <p v-if="node.problem" class="mt-2 flex items-start gap-1 text-[0.75rem] leading-snug text-bad-content">
        <TpIcon :icon="PhWarningCircle" :size="13" weight="fill" class="mt-0.5" />{{ node.problem }}
      </p>
    </div>
  </div>
</template>
