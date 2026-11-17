<script setup lang="ts">
import { computed } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { jobStatus } from "@/domain/vocab";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { ExportRead } from "@/services";
import { exportFailure, exportNeedsRegenerate, exportTitle, formatLabel, formatTime, isActiveExport, officeModeLabel, reportSummary } from "./useExports";

const props = defineProps<{ item: ExportRead; pending?: string; retried?: boolean }>();
defineEmits<{ download: [item: ExportRead]; retry: [item: ExportRead]; cancel: [item: ExportRead]; regenerate: [item: ExportRead] }>();
const status = computed(() => {
  const { label, tone, live } = jobStatus[props.item.status === "succeeded" ? "done" : props.item.status];
  return { label, tone, live };
});
const ended = computed(() => props.item.status === "failed" || props.item.status === "cancelled");
const size = computed(() => {
  const bytes = props.item.file?.byte_size ?? 0;
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
});
const busy = (action: string) => props.pending === `${action}:${props.item.job_id}`;
const mode = computed(() => (props.item.office_mode ? ` · ${officeModeLabel[props.item.office_mode]}${props.item.track_changes ? " · 带修订标记" : ""}` : ""));
const needsRegenerate = computed(() => exportNeedsRegenerate(props.item));
const report = computed(() => props.item.report ?? null);
const hasDetails = computed(() => !!report.value && report.value.unsupported_changes.length + report.value.losses.length + report.value.warnings.length > 0);
</script>

<template>
  <article class="export-item" :data-status="item.status" data-testid="export-item">
    <div class="studio-row">
      <div class="min-w-0">
        <p class="export-item__title">{{ exportTitle(item) }} · {{ formatLabel[item.format] }}{{ mode }}</p>
        <p class="tp-caption mt-1">
          <time :datetime="item.created_at">{{ formatTime(item.created_at) }}</time><span v-if="item.source_job_id"> · 按原输入重试</span
          ><span v-if="item.file"> · {{ size }}</span>
        </p>
      </div>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <TpStatus :key="item.status" v-bind="status" />
      </Transition>
    </div>
    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <div v-if="ended" class="export-item__failure" :role="item.status === 'failed' ? 'alert' : undefined">
        <p class="export-item__what">{{ exportFailure(item) }}</p>
        <p class="tp-caption">
          正文与历史版本没有改变，{{ needsRegenerate ? "可改为按正文重新生成。" : retried ? "已按原输入重新导出。" : "可按原输入重新导出。" }}
        </p>
      </div>
    </Transition>
    <section v-if="report" class="export-item__report" :aria-label="`${exportTitle(item)} 导出说明`">
      <p class="export-item__summary">
        <span v-for="part in reportSummary(report)" :key="part">{{ part }}</span>
      </p>
      <details v-if="hasDetails" class="tp-disclosure export-item__details">
        <summary>查看导出说明</summary>
        <div class="export-item__groups">
          <div v-if="report.unsupported_changes.length">
            <h4 class="tp-label">未写入原件的变化</h4>
            <ul>
              <li v-for="(change, index) in report.unsupported_changes" :key="`c${index}`">{{ change.detail }}</li>
            </ul>
          </div>
          <div v-if="report.losses.length">
            <h4 class="tp-label">损失</h4>
            <ul>
              <li v-for="(loss, index) in report.losses" :key="`l${index}`">{{ loss.label }}</li>
            </ul>
          </div>
          <div v-if="report.warnings.length">
            <h4 class="tp-label">告警</h4>
            <ul>
              <li v-for="(warning, index) in report.warnings" :key="`w${index}`">{{ warning.message }}</li>
            </ul>
            <p v-if="report.warning_total > report.warnings.length" class="tp-caption">另有 {{ report.warning_total - report.warnings.length }} 条未列出。</p>
          </div>
        </div>
      </details>
    </section>
    <div class="screen-actions export-item__actions">
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <TpButton v-if="item.status === 'succeeded'" key="download" size="sm" :loading="busy('download')" :disabled="!!pending" @click="$emit('download', item)"
          >下载文件</TpButton
        >
        <TpButton
          v-else-if="isActiveExport(item)"
          key="cancel"
          size="sm"
          variant="ghost"
          :loading="busy('cancel')"
          :disabled="!!pending"
          @click="$emit('cancel', item)"
          >取消导出</TpButton
        >
        <TpButton v-else-if="needsRegenerate" key="regenerate" size="sm" :loading="busy('regenerate')" :disabled="!!pending" @click="$emit('regenerate', item)"
          >改为重新生成</TpButton
        >
        <TpButton v-else-if="!retried" key="retry" size="sm" :loading="busy('retry')" :disabled="!!pending" @click="$emit('retry', item)"
          >按原输入重试</TpButton
        >
      </Transition>
    </div>
  </article>
</template>

<style scoped>
.export-item {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.export-item__title {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.export-item__failure {
  padding: 12px 16px;
  border-left: 3px solid var(--tp-danger);
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
  line-height: 1.7;
}
.export-item[data-status="cancelled"] .export-item__failure {
  border-left-color: var(--tp-line-strong);
}
.export-item__what {
  font-size: 13px;
  font-weight: 600;
}
.export-item__report {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.export-item__summary {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 13px;
  color: var(--tp-text-muted);
}
.export-item__summary span + span::before {
  content: "·";
  margin-right: 12px;
}
.export-item__details > summary {
  display: flex;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
}
.export-item__groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 10px;
}
.export-item__groups ul {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.export-item__actions:empty {
  display: none;
}
</style>
