<script setup lang="ts">
import { PhCrosshair } from "@phosphor-icons/vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";
import TpIcon from "@/components/ui/TpIcon.vue";
import type { ReviewIssue } from "@/services";
import { basisLabel, locationLabel, severityLabel } from "./reviewView";

/** 评审问题：只陈述问题、位置与依据。定位只读跳转；修改须学生另行发起受控修订。 */
defineProps<{ issue: ReviewIssue; locate?: RouteLocationRaw }>();
const sev = { major: "重", minor: "中", advice: "议" } as const;
</script>

<template>
  <div class="tp-issue review-issue">
    <span class="tp-sev tp-tip" :data-sev="issue.severity" :data-tip="severityLabel[issue.severity]" tabindex="0"
      >{{ sev[issue.severity] }}<span class="sr-only">{{ severityLabel[issue.severity] }}</span></span
    >
    <div class="min-w-0">
      <p class="font-semibold leading-snug">{{ issue.title }}</p>
      <p class="tp-caption mt-0.5">
        <span class="font-medium" :class="issue.location.status === 'unlocated' ? 'text-fg-faint' : 'text-fg'">{{ locationLabel(issue) }}</span>
        · 依据：<span :class="{ 'review-issue__missing': issue.basis_status === 'missing' }">{{ basisLabel(issue) }}</span>
      </p>
      <p class="mt-1.5 text-[0.8125rem] text-fg-muted">{{ issue.explanation }}</p>
      <p class="mt-1 text-[0.8125rem]"><span class="text-fg-muted">修改方向：</span>{{ issue.direction }}</p>
      <div v-if="locate" class="mt-2 flex gap-2">
        <RouterLink :to="locate" class="tp-btn tp-btn--outline tp-btn--sm"><TpIcon :icon="PhCrosshair" />定位到正文</RouterLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.review-issue__missing {
  color: var(--tp-warning);
  font-weight: 600;
}
</style>
