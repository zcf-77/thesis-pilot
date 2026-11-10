<script setup lang="ts">
import { Download, FileCheck2, MapPin } from "@lucide/vue";
import type { ReviewReportData } from "../types";

defineProps<{ report: ReviewReportData }>();
const emit = defineEmits<{ locate: [section: string]; download: [] }>();
</script>

<template>
  <section class="review-report" aria-label="论文评审报告">
    <header class="report-heading">
      <FileCheck2 :size="15" aria-hidden="true" />
      <h3>评审报告</h3>
      <button
        type="button"
        class="btn btn-sm btn-ghost download-button"
        aria-label="下载评审报告"
        @click="emit('download')"
      >
        <Download :size="14" aria-hidden="true" />下载报告
      </button>
    </header>
    <div class="score-overview">
      <div><span class="score">{{ report.score }}</span><span class="score-max"> / 100</span></div>
      <div class="score-note">
        <strong>参考评分</strong><span>示例量表 · 正文版本 {{ report.version }}</span>
      </div>
    </div>
    <div class="dimensions" aria-label="评审分项">
      <div v-for="dimension in report.dimensions" :key="dimension.label" class="dimension">
        <span>{{ dimension.label }}</span
        ><meter
          :value="dimension.score"
          min="0"
          :max="dimension.max"
          :aria-label="`${dimension.label} ${dimension.score}/${dimension.max}`"
        /><span class="dimension-score"
          >{{ dimension.score }}<span> / {{ dimension.max }}</span></span
        >
      </div>
    </div>
    <h4>问题清单 <span>{{ report.issues.length }}</span></h4>
    <ol v-if="report.issues.length" class="issues">
      <li v-for="issue in report.issues" :key="issue.id" class="issue">
        <div class="issue-heading">
          <span class="severity" :class="{ important: issue.severity === '需补充' }">{{
            issue.severity
          }}</span>
          <h5>{{ issue.title }}</h5>
        </div>
        <p>{{ issue.detail }}</p>
        <blockquote>{{ issue.evidence }}</blockquote>
        <button
          class="btn btn-sm btn-ghost locate-button"
          type="button"
          :aria-label="`定位段落：${issue.section}`"
          @click="emit('locate', issue.section)"
        >
          <MapPin :size="12" aria-hidden="true" />{{ issue.section }}<span>定位段落</span>
        </button>
      </li>
    </ol>
    <p v-else class="no-issues">本次评审未列出问题。</p>
    <div v-if="report.unchecked.length" class="unchecked">
      <h4>未检查项</h4>
      <ul>
        <li v-for="item in report.unchecked" :key="item">{{ item }}</li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.review-report {
  min-width: 0;
  padding: 18px;
}
.report-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--accent);
}
h3 {
  margin: 0;
  color: var(--ink);
  font-size: 12px;
  font-weight: 600;
}
.download-button {
  margin-left: auto;
  padding: 0;
  height: 27px;
  min-height: 27px;
  color: var(--muted);
  font-size: 10px;
  font-weight: 400;
}
.score-overview {
  display: flex;
  align-items: center;
  gap: 17px;
  margin: 14px 0 17px;
}
.score {
  color: var(--accent);
  font-size: 35px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: -1.5px;
}
.score-max {
  color: var(--muted);
  font-size: 11px;
}
.score-note {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--muted);
  font-size: 10px;
}
.score-note strong {
  color: var(--ink);
  font-size: 11px;
  font-weight: 500;
}
.dimensions {
  display: grid;
  gap: 10px;
  padding-bottom: 17px;
  border-bottom: 1px solid var(--line);
}
.dimension {
  display: grid;
  grid-template-columns: 58px minmax(35px, 1fr) 47px;
  gap: 9px;
  align-items: center;
  color: var(--muted);
  font-size: 10px;
}
.dimension-score {
  text-align: right;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.dimension-score span {
  color: var(--muted);
}
meter {
  width: 100%;
  height: 5px;
  border: 0;
  border-radius: 3px;
  background: var(--soft);
}
meter::-webkit-meter-bar {
  height: 5px;
  background: var(--soft);
  border: 0;
  border-radius: 3px;
}
meter::-webkit-meter-optimum-value {
  background: #7ca690;
  border-radius: 3px;
}
meter::-moz-meter-bar {
  background: #7ca690;
  border-radius: 3px;
}
h4 {
  display: flex;
  gap: 7px;
  margin: 17px 0 12px;
  color: var(--ink);
  font-size: 11px;
  font-weight: 600;
}
h4 > span {
  color: var(--muted);
  font-weight: 400;
}
.issues {
  padding: 0;
  margin: 0;
  list-style: none;
}
.issue {
  padding: 13px 0;
  border-bottom: 1px solid var(--line);
}
.issue:first-child {
  padding-top: 0;
}
.issue-heading {
  display: flex;
  align-items: flex-start;
  gap: 7px;
}
h5 {
  margin: 1px 0 0;
  color: var(--ink);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.7;
}
.severity {
  flex-shrink: 0;
  padding: 3px 5px;
  border-radius: 3px;
  background: var(--soft);
  color: var(--accent);
  font-size: 9px;
  line-height: 1.5;
}
.severity.important {
  background: #f6f0e6;
  color: #9c793f;
}
.issue p,
.no-issues {
  margin: 8px 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.9;
  overflow-wrap: anywhere;
}
blockquote {
  margin: 9px 0;
  padding: 2px 0 2px 9px;
  border-left: 2px solid var(--line);
  color: var(--muted);
  font-size: 10px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.locate-button {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: 5px;
  max-width: 100%;
  min-height: 26px;
  height: auto;
  padding: 4px 0;
  color: var(--accent);
  font-size: 10px;
  font-weight: 400;
  text-align: left;
  white-space: normal;
}
.locate-button span {
  margin-left: 4px;
  color: var(--muted);
}
.unchecked h4 {
  margin-bottom: 8px;
  color: var(--muted);
}
.unchecked ul {
  margin: 0;
  padding-left: 15px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.9;
}
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
</style>
