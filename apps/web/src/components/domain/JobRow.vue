<script setup lang="ts">
import { PhArrowsClockwise, PhExport, PhFileMagnifyingGlass, PhMagnifyingGlass, PhPencilSimpleLine, PhSealCheck, PhX } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpProgress from "@/components/ui/TpProgress.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { JobView } from "@/domain/types";
import { jobStatus } from "@/domain/vocab";

/** 后台任务行：输入范围、所用版本快照、状态、诊断与重试次数。取消后迟到结果不会恢复任务。 */
defineProps<{ job: JobView }>();
defineEmits<{ cancel: [id: string]; retry: [id: string] }>();
const icons = { parse: PhFileMagnifyingGlass, generate: PhPencilSimpleLine, search: PhMagnifyingGlass, review: PhSealCheck, export: PhExport };
</script>

<template>
  <div class="tp-row" style="grid-template-columns: auto minmax(0, 1fr) 7rem auto auto">
    <span class="tp-avatar"><TpIcon :icon="icons[job.kind]" :size="16" /></span>
    <div class="min-w-0">
      <p class="truncate font-semibold">{{ job.title }}</p>
      <p class="tp-caption mt-0.5 truncate">
        {{ job.scope }} · <span class="tp-mono">{{ job.snapshot }}</span><template v-if="job.attempt > 1"> · 第 {{ job.attempt }} 次尝试</template>
      </p>
      <p v-if="job.diagnosis" class="mt-0.5 text-[0.75rem]" :class="job.status === 'failed' ? 'text-bad-content' : 'text-fg-muted'">{{ job.diagnosis }}</p>
    </div>
    <TpProgress v-if="job.status === 'running'" :value="job.progress" tone="info" :label="job.title + ' 进度'" />
    <span v-else />
    <TpStatus :tone="jobStatus[job.status].tone" :label="jobStatus[job.status].label" :live="jobStatus[job.status].live" />
    <span class="flex w-16 justify-end">
      <TpButton v-if="job.status === 'running' || job.status === 'queued'" size="sm" variant="ghost" @click="$emit('cancel', job.id)"
        ><TpIcon :icon="PhX" />取消</TpButton
      >
      <TpButton
        v-else-if="job.status === 'failed' || job.status === 'partial' || job.status === 'cancelled'"
        size="sm"
        variant="ghost"
        @click="$emit('retry', job.id)"
        ><TpIcon :icon="PhArrowsClockwise" />重试</TpButton
      >
    </span>
  </div>
</template>
