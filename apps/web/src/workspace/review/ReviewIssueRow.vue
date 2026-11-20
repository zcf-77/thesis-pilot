<script setup lang="ts">
import { PhCrosshair } from "@phosphor-icons/vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";
import TpIcon from "@/components/ui/TpIcon.vue";
import type { ReviewIssue } from "@/services";
import { basisLabel, locationLabel, severityLabel } from "./reviewView";

/** 评审问题：只陈述问题、位置与依据。定位只读跳转；修改须学生另行发起受控修订。 */
defineProps<{ issue: ReviewIssue; locate?: RouteLocationRaw }>();
</script>

<template>
  <article class="tp-issue review-issue">
    <span class="review-issue__severity" :data-sev="issue.severity">{{ severityLabel[issue.severity] }}</span>
    <div class="review-issue__body">
      <h3 class="review-issue__title">{{ issue.title }}</h3>
      <p class="review-issue__location tp-caption" :class="{ 'is-unlocated': issue.location.status === 'unlocated' }">
        {{ locationLabel(issue) }}
      </p>
      <p class="review-issue__explanation">{{ issue.explanation }}</p>
      <p class="review-issue__direction"><span>修改方向</span>{{ issue.direction }}</p>
      <p class="review-issue__basis" :class="{ 'is-missing': issue.basis_status === 'missing' }"><span>依据</span>{{ basisLabel(issue) }}</p>
      <RouterLink v-if="locate" :to="locate" class="tp-btn tp-btn--outline tp-btn--sm review-issue__locate">
        <TpIcon :icon="PhCrosshair" />定位到正文
      </RouterLink>
    </div>
  </article>
</template>

<style scoped>
.review-issue {
  align-items: start;
}
.review-issue__severity {
  flex: 0 0 40px;
  padding-top: 2px;
  border-left: 3px solid var(--tp-line-strong);
  padding-left: 8px;
  color: var(--tp-text);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
}
.review-issue__severity[data-sev="major"] {
  border-left-color: var(--tp-danger);
}
.review-issue__severity[data-sev="minor"] {
  border-left-color: var(--tp-warning);
}
.review-issue__body {
  min-width: 0;
}
.review-issue__title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.review-issue__location {
  margin-top: 4px;
  color: var(--tp-text);
  overflow-wrap: anywhere;
}
.review-issue__location.is-unlocated {
  color: var(--tp-text-muted);
  text-decoration: underline dashed var(--tp-ghost-line);
  text-underline-offset: 4px;
}
.review-issue__explanation,
.review-issue__direction,
.review-issue__basis {
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.review-issue__explanation {
  margin-top: 12px;
  color: var(--tp-text-muted);
}
.review-issue__direction,
.review-issue__basis {
  margin-top: 8px;
}
.review-issue__direction > span,
.review-issue__basis > span {
  margin-right: 8px;
  color: var(--tp-text-muted);
  font-size: 12px;
  font-weight: 600;
}
.review-issue__basis.is-missing {
  color: var(--tp-warning-content);
}
.review-issue__locate {
  margin-top: 12px;
}
@media (max-width: 480px) {
  .review-issue {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  .review-issue__severity {
    width: fit-content;
    padding-top: 0;
  }
}
</style>
