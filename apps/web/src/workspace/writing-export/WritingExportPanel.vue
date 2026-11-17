<script setup lang="ts">
import { computed, watch } from "vue";
import { useRouter } from "vue-router";
import { PhX } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { BackendServices, ProjectRead } from "@/services";
import type { DocsSnapshot } from "../editor/docsSnapshot";
import type { PreviewHighlight } from "../editor";
import { officeModes } from "../export/useExports";
import { exportRoute } from "../workspaceRoutes";
import { quickFormats, useWritingExport } from "./useWritingExport";

const props = defineProps<{
  services: BackendServices;
  project: ProjectRead;
  document: { id: string; version: number; snapshot: DocsSnapshot } | null;
  selection: { node: string; start: number; end: number; text: string } | null;
  eligible: boolean;
}>();
const emit = defineEmits<{
  overlays: [group: string, highlights: PreviewHighlight[]];
  focus: [anchor: { node: string; start?: number; end?: number }];
  changed: [];
  close: [];
}>();

const router = useRouter();
const flow = useWritingExport(props.services, props.project.id);
const { format, mode, trackChanges, source, busy, error, canPreserve, effectiveMode, hint } = flow;

watch(
  () => (props.document ? `${props.document.id}:${props.document.version}` : ""),
  () => void flow.load(props.document ? { id: props.document.id, version: props.document.version } : null),
  { immediate: true },
);
const label = computed(() => `导出 ${format.value === "docx" ? "Word" : "PDF"}${props.document ? `（v${props.document.version}）` : ""}`);

async function submit() {
  const created = await flow.submit();
  if (created) await router.push(exportRoute(props.project.id));
}
</script>

<template>
  <section class="writing-export" aria-labelledby="writing-export-title" @keydown.esc.self="emit('close')">
    <header class="writing-export__head">
      <h2 id="writing-export-title" class="tp-subheading">导出</h2>
      <TpButton variant="ghost" size="sm" icon-only label="关闭导出" @click="emit('close')"><TpIcon :icon="PhX" :size="16" /></TpButton>
    </header>

    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <p v-if="!document" key="empty" class="tp-caption">保存第一版正文后即可导出。</p>

      <form v-else key="form" class="writing-export__stack" @submit.prevent="submit">
        <div class="tp-field">
          <span class="tp-field__label">文件格式</span>
          <TpSegmented v-model="format" label="导出文件格式" :options="quickFormats" />
        </div>

        <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
          <p v-if="source.status === 'loading'" key="loading" class="tp-caption" role="status">
            <span class="tp-btn__spinner" aria-hidden="true" />正在查找 Word 原件…
          </p>
          <div v-else-if="canPreserve && source.status === 'ready'" key="ready" class="tp-field">
            <span class="tp-field__label">处理方式</span>
            <TpSegmented v-model="mode" label="导出处理方式" :options="officeModes" />
            <span class="tp-caption">原件：{{ source.source.filename }} · v{{ source.source.document_version }} 导入</span>
          </div>
          <p v-else-if="source.status === 'failed'" key="failed" class="studio-notice" role="alert">{{ source.message }} 将按正文重建并附损失报告。</p>
          <p v-else key="none" class="tp-caption">没有导入的 Word 原件，将按正文重建并附损失报告。</p>
        </Transition>
        <p v-if="canPreserve" class="writing-export__hint">{{ hint }}</p>
        <Transition name="tp-swap" v-bind="panelMotionHooks">
          <label v-if="format === 'docx' && effectiveMode === 'preserve'" class="writing-export__check"
            ><input v-model="trackChanges" class="tp-checkbox" type="checkbox" :disabled="busy" />带修订标记</label
          >
        </Transition>
        <Transition name="tp-swap" v-bind="panelMotionHooks">
          <p v-if="!eligible" class="tp-caption">将导出已保存的 v{{ document.version }}，未保存的修改不包含在内。</p>
        </Transition>
        <Transition name="tp-swap" v-bind="panelMotionHooks">
          <p v-if="error" :key="error" class="studio-notice" role="alert">{{ error }}</p>
        </Transition>
        <div class="screen-actions">
          <TpButton type="submit" variant="primary" :loading="busy" :disabled="busy || source.status === 'loading'">{{ label }}</TpButton>
        </div>
      </form>
    </Transition>
  </section>
</template>

<style scoped>
.writing-export {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.writing-export__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.writing-export__stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.writing-export__hint {
  font-size: 13px;
  line-height: 1.7;
  color: var(--tp-text-muted);
}
.writing-export__check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  cursor: pointer;
}
</style>
