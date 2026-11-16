<script setup lang="ts">
import { computed } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { jobStatus } from "@/domain/vocab";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { ExportRead } from "@/services";
import { exportFailure, exportTitle, formatLabel, formatTime, isActiveExport } from "./useExports";

const props = defineProps<{ item: ExportRead; pending?: string }>();
defineEmits<{ download: [item: ExportRead]; retry: [item: ExportRead]; cancel: [item: ExportRead] }>();
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
</script>

<template>
  <article class="export-item" :data-status="item.status" data-testid="export-item">
    <div class="studio-row">
      <div class="min-w-0">
        <p class="export-item__title">{{ exportTitle(item) }} · {{ formatLabel[item.format] }}</p>
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
        <p class="tp-caption">正文与历史版本没有改变，可按原输入重新导出。</p>
      </div>
    </Transition>
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
        <TpButton v-else key="retry" size="sm" :loading="busy('retry')" :disabled="!!pending" @click="$emit('retry', item)">按原输入重试</TpButton>
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
.export-item__actions:empty {
  display: none;
}
</style>
