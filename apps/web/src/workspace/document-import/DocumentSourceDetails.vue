<script setup lang="ts">
import { computed, onScopeDispose, ref } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import type { BackendServices } from "@/services";
import { asApiError } from "@/services/errors";
import { sourceEditablePaths } from "./importDraft";

type Source = Awaited<ReturnType<BackendServices["documentSources"]["current"]>>;
const props = defineProps<{
  services: BackendServices;
  projectId: string;
  source?: Source;
  version: number;
  loading: boolean;
  missing: boolean;
  error: string;
  historical?: boolean;
}>();
defineEmits<{ retry: [] }>();
const busy = ref(false);
const downloadError = ref("");
let request: AbortController | undefined;
let url: string | undefined;
const editableCount = computed(() => sourceEditablePaths(props.source)?.length);
const corrections = computed(() => {
  const data = props.source?.guard_contract.chapter_overrides;
  if (!Array.isArray(data)) return [];
  return data
    .filter((item) => !!item && typeof item === "object" && !Array.isArray(item))
    .map((item) => {
      const row = item as Record<string, unknown>;
      const attrs =
        row.target_attrs && typeof row.target_attrs === "object" && !Array.isArray(row.target_attrs) ? (row.target_attrs as Record<string, unknown>) : {};
      return {
        anchor: String(row.anchor_id ?? ""),
        label: row.target_type === "heading" ? `${typeof attrs.level === "number" ? attrs.level : ""}级标题` : "普通段落",
      };
    });
});
async function download() {
  const source = props.source;
  if (!source || busy.value) return;
  request?.abort();
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  downloadError.value = "";
  try {
    const blob = await props.services.materials.download(props.projectId, source.material_id, source.original_version_id, controller.signal);
    if (controller.signal.aborted) return;
    url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = source.filename;
    link.click();
    const current = url;
    setTimeout(() => {
      URL.revokeObjectURL(current);
      if (url === current) url = undefined;
    }, 1000);
  } catch (problem) {
    if (!controller.signal.aborted) downloadError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
onScopeDispose(() => {
  request?.abort();
  if (url) URL.revokeObjectURL(url);
});
</script>

<template>
  <section class="document-source-details studio-stack" :aria-label="historical ? '历史正式稿来源' : '正式稿来源'">
    <div class="studio-row">
      <h2 class="tp-heading">{{ historical ? "历史正式稿来源" : "正式稿来源" }}</h2>
      <span class="tp-caption">正式稿 v{{ version }}</span>
    </div>
    <p v-if="loading" role="status" class="tp-caption">正在核对固定来源与保护映射，正文暂为只读…</p>
    <p v-if="error" role="alert" class="studio-notice">{{ error }}<TpButton size="sm" @click="$emit('retry')">重试来源读取</TpButton></p>
    <p v-if="missing && !loading" class="tp-caption">此版本无原件导入来源；普通空稿按现有编辑规则工作。</p>
    <template v-if="source"
      ><p><strong>{{ source.filename }}</strong> · {{ source.file_type.toUpperCase() }}</p>
      <p class="tp-caption">
        固定原件 {{ source.original_version_id.slice(0, 8) }} · 解析版本 {{ source.parse_version_id.slice(0, 8) }} · {{ source.guard_version }}
      </p>
      <p class="tp-caption">支持范围：仅 {{ editableCount ?? 0 }} 个已映射纯文字槽；格式、结构、锁定内容及未知对象保持保护。编辑投影不等于完整 DOCX 转换。</p>
      <p class="source-digest tp-caption">原件 SHA-256：{{ source.original_sha256 }}</p>
      <p v-if="corrections.length" class="tp-caption">
        已应用 {{ corrections.length }} 项章节校正：<span v-for="item in corrections" :key="item.anchor">{{ item.label }}（{{ item.anchor }}） </span>
      </p>
      <p v-else class="tp-caption">未应用额外章节校正，保留来源章节类型。</p>
      <div class="screen-actions"><TpButton size="sm" :disabled="busy" :loading="busy" @click="download">下载来源原件</TpButton></div>
      <p v-if="downloadError" role="alert" class="studio-notice">{{ downloadError }}</p></template
    >
  </section>
</template>

<style scoped>
.document-source-details {
  padding: 16px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.source-digest {
  font-size: 11px;
  font-family: var(--tp-font-mono);
}
</style>
