<script setup lang="ts">
import { PhCrosshair, PhPencilSimpleLine } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import type { IssueView } from "@/domain/types";

/** 评审问题条目。只陈述问题与依据；“请求修订候选”是另一件事，走修订流程（铅笔按钮）。 */
defineProps<{ issue: IssueView }>();
defineEmits<{ locate: [id: string]; revise: [id: string] }>();
const sev = { major: "重", minor: "中", advice: "议" } as const;
const sevLabel = { major: "严重", minor: "一般", advice: "建议" } as const;
</script>

<template>
  <div class="tp-issue">
    <span class="tp-sev tp-tip" :data-sev="issue.severity" :data-tip="sevLabel[issue.severity]" tabindex="0">{{ sev[issue.severity] }}</span>
    <div class="min-w-0">
      <p class="font-semibold leading-snug">{{ issue.title }}</p>
      <p class="tp-caption mt-0.5"><span class="font-medium text-fg">{{ issue.location }}</span> · 依据：{{ issue.basis }}</p>
      <p class="mt-1.5 text-[0.8125rem] text-fg-muted">{{ issue.suggestion }}</p>
      <div class="mt-2 flex gap-2">
        <TpButton size="sm" variant="outline" @click="$emit('locate', issue.id)"><TpIcon :icon="PhCrosshair" />定位到正文</TpButton>
        <TpButton size="sm" variant="pencil" @click="$emit('revise', issue.id)"><TpIcon :icon="PhPencilSimpleLine" />请求修订候选</TpButton>
      </div>
    </div>
  </div>
</template>
