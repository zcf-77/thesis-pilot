<script setup lang="ts">
import { PhCalendarBlank, PhCheck, PhCircleHalf, PhEye, PhFlagPennant, PhGitBranch, PhSealCheck, PhTextAlignLeft } from "@phosphor-icons/vue";
import { computed } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { TaskView } from "@/domain/types";
import { taskStatus } from "@/domain/vocab";
import EvidenceChip from "./EvidenceChip.vue";

/**
 * 任务卡。完成只能由学生确认（emit confirm）：字数、文件存在或 AI 判断都不会让它变成“已确认”。
 * 证据过期时保留旧关联并提示复核。
 */
const props = defineProps<{ task: TaskView }>();
defineEmits<{ confirm: [id: string]; open: [id: string] }>();

const word = computed(() => taskStatus[props.task.status]);
const depsDone = computed(() => props.task.dependsOn?.filter((d) => d.done).length ?? 0);
const blocked = computed(() => (props.task.dependsOn?.length ?? 0) > depsDone.value);
const stale = computed(() => props.task.evidence?.some((e) => e.stale));
</script>

<template>
  <article class="tp-card tp-card--interactive tp-task" :data-status="task.status">
    <span class="tp-task__check" aria-hidden="true">
      <TpIcon v-if="task.status === 'doing'" :icon="PhCircleHalf" :size="13" weight="fill" />
      <TpIcon v-else-if="task.status === 'verify'" :icon="PhEye" :size="13" />
      <TpIcon v-else-if="task.status === 'confirmed'" :icon="PhCheck" :size="13" weight="bold" />
    </span>
    <div class="min-w-0">
      <h3 class="tp-task__title">{{ task.title }}</h3>
      <p v-if="task.acceptance" class="tp-caption mt-0.5">验收：{{ task.acceptance }}</p>
      <div class="tp-task__meta">
        <span v-if="task.due" :data-due="task.dueState">
          <TpIcon :icon="task.hardDeadline ? PhFlagPennant : PhCalendarBlank" :size="13" />{{ task.due }}<template v-if="task.hardDeadline"> · 硬截止</template
          ><template v-if="task.dueState === 'overdue'"> · 已延期</template>
        </span>
        <span v-if="task.chapter"><TpIcon :icon="PhTextAlignLeft" :size="13" />{{ task.chapter }}</span>
        <span v-if="task.dependsOn?.length" :class="{ 'text-warn-content': blocked }">
          <TpIcon :icon="PhGitBranch" :size="13" />前置 {{ depsDone }}/{{ task.dependsOn.length }}<template v-if="blocked"> · 未就绪</template>
        </span>
      </div>
      <div v-if="task.evidence?.length" class="tp-task__evidence">
        <EvidenceChip v-for="e in task.evidence" :key="e.id" :evidence="e" />
      </div>
    </div>
    <div class="tp-task__side">
      <Transition name="tp-swap" mode="out-in">
        <TpSeal v-if="task.status === 'confirmed' && !stale" key="seal" text="已确认" />
        <TpStatus v-else-if="task.status === 'confirmed' && stale" key="recheck" tone="warning" label="已确认 · 需复核" />
        <TpButton v-else-if="task.status === 'verify'" key="confirm" variant="seal" size="sm" :disabled="blocked" @click="$emit('confirm', task.id)">
          <TpIcon :icon="PhSealCheck" />确认完成
        </TpButton>
        <TpStatus v-else key="status" :tone="word.tone" :label="word.label" :live="word.live" />
      </Transition>
      <span v-if="task.confirmedAt && task.status === 'confirmed'" class="tp-mono text-fg-faint">{{ task.confirmedAt }}</span>
    </div>
  </article>
</template>
