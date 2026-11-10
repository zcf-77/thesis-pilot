<script setup lang="ts">
import { PhCpu, PhLinkSimple, PhSparkle } from "@phosphor-icons/vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import type { RequirementView } from "@/domain/types";
import { verdict } from "@/domain/vocab";

/**
 * 要求行。硬规则（程序检查）与语义要求（AI 判断）用不同图标与措辞区分；
 * 不能判定 / 矛盾 / 来源缺失 用“留白”语气，不伪装成合规。
 */
defineProps<{ requirement: RequirementView }>();
defineEmits<{ source: [id: string] }>();
</script>

<template>
  <div class="tp-row" style="grid-template-columns: auto minmax(0, 1fr) auto">
    <span
      class="tp-sev tp-tip"
      :data-sev="requirement.kind === 'hard' ? 'advice' : undefined"
      :class="requirement.kind === 'semantic' ? 'tp-pencil !border' : ''"
      :data-tip="requirement.kind === 'hard' ? '硬规则 · 由程序检查' : '语义要求 · AI 给出带依据的判断'"
      tabindex="0"
    >
      <TpIcon :icon="requirement.kind === 'hard' ? PhCpu : PhSparkle" :size="15" />
    </span>
    <div class="min-w-0">
      <p class="font-medium leading-snug">{{ requirement.text }}</p>
      <p class="tp-caption mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{{ requirement.category }}</span>
        <span v-if="requirement.param" class="font-semibold text-fg">{{ requirement.param }}</span>
        <button
          v-if="requirement.source"
          type="button"
          class="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2"
          @click="$emit('source', requirement.id)"
        >
          <TpIcon :icon="PhLinkSimple" :size="12" />{{ requirement.source }}
        </button>
        <TpVersion :v="requirement.version" />
      </p>
      <p v-if="requirement.verdictNote" class="mt-1 text-[0.75rem] text-fg-muted">{{ requirement.verdictNote }}</p>
    </div>
    <TpStatus :tone="verdict[requirement.verdict].tone" :label="verdict[requirement.verdict].label" />
  </div>
</template>
