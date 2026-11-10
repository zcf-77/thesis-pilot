<script setup lang="ts">
import { PhArrowsClockwise, PhCopySimple, PhEye } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpProgress from "@/components/ui/TpProgress.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import type { MaterialView } from "@/domain/types";
import { parseStatus } from "@/domain/vocab";

/** 资料行：原件永远保留；解析状态、识别 / 未识别数量与诊断如实呈现。 */
defineProps<{ material: MaterialView }>();
defineEmits<{ open: [id: string]; retry: [id: string] }>();
</script>

<template>
  <div class="tp-row" style="grid-template-columns: auto minmax(0, 1fr) auto auto">
    <span class="tp-file" aria-hidden="true">{{ material.ext }}</span>
    <div class="min-w-0">
      <p class="flex items-center gap-2">
        <span class="truncate font-semibold">{{ material.name }}</span>
        <TpVersion :v="material.version" />
        <span v-if="material.duplicateOf" class="tp-evi"><TpIcon :icon="PhCopySimple" :size="12" />与 v{{ material.duplicateOf }} 内容相同，未重复解析</span>
      </p>
      <p class="tp-caption mt-0.5">
        {{ material.category }} · {{ material.size }} · {{ material.at }}
        <template v-if="material.recognized !== undefined"> · 识别 {{ material.recognized }} 项</template>
        <template v-if="material.unrecognized"> · <span class="font-semibold text-warn-content">未识别 {{ material.unrecognized }} 项</span></template>
      </p>
      <TpProgress v-if="material.status === 'processing'" class="mt-2 max-w-64" :value="material.progress" tone="info" label="解析进度" />
      <p v-if="material.diagnosis" class="mt-1 text-[0.75rem]" :class="material.status === 'failed' ? 'text-bad-content' : 'text-fg-muted'">
        {{ material.diagnosis }}
      </p>
    </div>
    <TpStatus :tone="parseStatus[material.status].tone" :label="parseStatus[material.status].label" :live="parseStatus[material.status].live" />
    <div class="flex gap-1">
      <TpButton v-if="material.status === 'failed'" variant="outline" size="sm" @click="$emit('retry', material.id)"
        ><TpIcon :icon="PhArrowsClockwise" />重试</TpButton
      >
      <TpButton variant="ghost" size="sm" icon-only :label="'查看 ' + material.name" @click="$emit('open', material.id)"><TpIcon :icon="PhEye" /></TpButton>
    </div>
  </div>
</template>
