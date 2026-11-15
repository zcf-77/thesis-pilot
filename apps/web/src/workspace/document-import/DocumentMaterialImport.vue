<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowRef } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import type { BackendServices } from "@/services";
import { asApiError } from "@/services/errors";
import { beginJobRequest, confirmJobRequest } from "@/lab/components/integration/jobsRequests";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { listMotionHooks } from "@/design/motion";
import { chapterCorrections, type ChapterDraft } from "./importDraft";

const props = defineProps<{ services: BackendServices; projectId: string; disabled: boolean }>();
const emit = defineEmits<{ imported: []; close: []; checkCurrent: [] }>();
type Material = Awaited<ReturnType<BackendServices["materials"]["get"]>>;
type Original = Awaited<ReturnType<BackendServices["materials"]["original"]>>;
type Parse = Awaited<ReturnType<BackendServices["materials"]["parses"]>>["items"][number];
type Preview = Awaited<ReturnType<BackendServices["documentSources"]["preview"]>>;
type Command = Parameters<BackendServices["documentSources"]["import"]>[1];
const materials = shallowRef<Material[]>([]);
const originals = shallowRef<Original[]>([]);
const parses = shallowRef<Parse[]>([]);
const materialId = ref("");
const originalId = ref("");
const parseId = ref("");
const preview = shallowRef<Preview>();
const drafts = ref<Record<string, ChapterDraft>>({});
const loading = ref(false);
const previewBusy = ref(false);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const pending = shallowRef<{ command: Command; scope: string }>();
const original = computed(() => originals.value.find((item) => item.id === originalId.value));
const materialOptions = computed(() => [
  { value: "", label: "选择本项目资料" },
  ...materials.value.map((item) => ({ value: item.id, label: item.name, disabled: item.removed || !item.linked })),
]);
const originalOptions = computed(() => [
  { value: "", label: "选择固定原件版本" },
  ...originals.value.map((item) => ({ value: item.id, label: `原件 v${item.version} · ${item.filename}`, disabled: item.file_type === "pdf" })),
]);
const parseOptions = computed(() => [
  { value: "", label: "选择固定解析版本" },
  ...parses.value.map((item) => ({ value: item.id, label: `解析 v${item.version} · ${item.status === "complete" ? "完整" : "部分"}` })),
]);
let readRequest: AbortController | undefined;
let previewRequest: AbortController | undefined;
let importRequest: AbortController | undefined;
function resetPreview() {
  previewRequest?.abort();
  previewBusy.value = false;
  preview.value = undefined;
  drafts.value = {};
  error.value = "";
  notice.value = "";
}
function close() {
  readRequest?.abort();
  previewRequest?.abort();
  importRequest?.abort();
  emit("close");
}
async function loadMaterials() {
  readRequest?.abort();
  const controller = new AbortController();
  readRequest = controller;
  loading.value = true;
  error.value = "";
  try {
    const all: Material[] = [];
    let offset = 0;
    do {
      const page = await props.services.materials.list(props.projectId, { offset, limit: 100 }, controller.signal);
      if (controller.signal.aborted) return;
      all.push(...page.items);
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) break;
    } while (!controller.signal.aborted);
    materials.value = all;
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}
async function chooseMaterial(id: string) {
  resetPreview();
  materialId.value = id;
  originalId.value = "";
  parseId.value = "";
  originals.value = [];
  parses.value = [];
  readRequest?.abort();
  if (!id) {
    loading.value = false;
    return;
  }
  const controller = new AbortController();
  readRequest = controller;
  loading.value = true;
  try {
    const all: Original[] = [];
    let offset = 0;
    do {
      const page = await props.services.materials.originals(props.projectId, id, { offset, limit: 100 }, controller.signal);
      if (controller.signal.aborted) return;
      all.push(...page.items);
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) break;
    } while (!controller.signal.aborted);
    originals.value = all;
    const current = all.find((item) => item.id === materials.value.find((item) => item.id === id)?.current_original_id && item.file_type !== "pdf");
    if (current) void chooseOriginal(current.id);
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}
async function chooseOriginal(id: string) {
  resetPreview();
  originalId.value = id;
  parseId.value = "";
  parses.value = [];
  readRequest?.abort();
  if (!id) {
    loading.value = false;
    return;
  }
  const controller = new AbortController();
  readRequest = controller;
  loading.value = true;
  try {
    const all: Parse[] = [];
    let offset = 0;
    do {
      const page = await props.services.materials.parses(props.projectId, materialId.value, id, { offset, limit: 100 }, controller.signal);
      if (controller.signal.aborted) return;
      all.push(...page.items);
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) break;
    } while (!controller.signal.aborted);
    parses.value = all;
    parseId.value = all.find((item) => item.id === original.value?.latest_parse_id)?.id ?? all[0]?.id ?? "";
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}
async function loadPreview() {
  if (!materialId.value || !originalId.value || !parseId.value || busy.value || pending.value) return;
  previewRequest?.abort();
  const controller = new AbortController();
  previewRequest = controller;
  previewBusy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await props.services.documentSources.preview(
      props.projectId,
      { material_id: materialId.value, original_version_id: originalId.value, parse_version_id: parseId.value },
      controller.signal,
    );
    if (controller.signal.aborted) return;
    preview.value = result;
    drafts.value = Object.fromEntries(result.chapters.map((item) => [item.anchor_id, { kind: item.kind, level: item.level ?? 1 }]));
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) previewBusy.value = false;
  }
}
async function importSource() {
  if (props.disabled || busy.value || !preview.value?.can_import) return;
  if (!pending.value) {
    try {
      const chapter_corrections = chapterCorrections(preview.value.chapters, drafts.value);
      const scope =
        "thesispilot.pending-source-import:" +
        JSON.stringify([
          props.services.sourceKey,
          props.projectId,
          preview.value.material_id,
          preview.value.original_version_id,
          preview.value.parse_version_id,
          chapter_corrections,
        ]);
      pending.value = {
        scope,
        command: {
          material_id: preview.value.material_id,
          original_version_id: preview.value.original_version_id,
          parse_version_id: preview.value.parse_version_id,
          chapter_corrections,
          command_id: beginJobRequest(scope),
        },
      };
    } catch (problem) {
      error.value = (problem as Error).message;
      return;
    }
  }
  const command = pending.value;
  const controller = new AbortController();
  importRequest = controller;
  busy.value = true;
  error.value = "";
  try {
    await props.services.documentSources.import(props.projectId, command.command, controller.signal);
    if (controller.signal.aborted) return;
    confirmJobRequest(command.scope, command.command.command_id);
    pending.value = undefined;
    notice.value = "已从固定来源建立正式稿 v1。";
    emit("imported");
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      if (issue.status !== undefined && issue.status < 500 && issue.code !== "INVALID_RESPONSE") {
        confirmJobRequest(command.scope, command.command.command_id);
        pending.value = undefined;
      }
      error.value = pending.value
        ? "导入结果尚未确认，固定来源和章节选择已保留；请使用原命令确认或检查当前正式稿。"
        : `${issue.message} 当前来源和章节选择已保留，未自动覆盖正文。`;
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
onMounted(() => void loadMaterials());
onScopeDispose(() => {
  readRequest?.abort();
  previewRequest?.abort();
  importRequest?.abort();
});
</script>

<template>
  <section class="screen-panel studio-body studio-stack document-import" aria-label="从资料导入" @keydown.esc.stop="close">
    <div class="studio-row">
      <h2 class="tp-heading">从资料导入</h2>
      <TpButton size="sm" variant="ghost" @click="close">关闭资料导入</TpButton>
    </div>
    <p class="tp-caption">仅为尚无正式稿的项目建立 v1；原件、解析与来源保持固定。PDF 暂不支持导入。</p>
    <div class="import-selectors">
      <TpField v-slot="{ id }" label="导入资料"
        ><TpSelect
          :id="id"
          :model-value="materialId"
          :options="materialOptions"
          :disabled="loading || busy || !!pending || disabled"
          @update:model-value="chooseMaterial" /></TpField
      ><TpField v-slot="{ id }" label="导入原件版本"
        ><TpSelect
          :id="id"
          :model-value="originalId"
          :options="originalOptions"
          :disabled="loading || busy || !!pending || !materialId || disabled"
          @update:model-value="chooseOriginal" /></TpField
      ><TpField v-slot="{ id }" label="导入解析版本"
        ><TpSelect
          :id="id"
          v-model="parseId"
          :options="parseOptions"
          :disabled="loading || busy || !!pending || !originalId || disabled"
          @change="resetPreview"
      /></TpField>
    </div>
    <p v-if="loading" class="tp-caption" role="status">正在读取固定来源版本…</p>
    <p v-if="materialId && !loading && !originals.some((item) => item.file_type !== 'pdf')" class="studio-notice">此资料没有可导入的 DOCX 或文本原件。</p>
    <p v-if="originalId && !loading && !parses.length" class="studio-notice">所选原件尚无成功解析版本，请先到资料页查看任务。</p>
    <div class="screen-actions">
      <TpButton :disabled="loading || busy || previewBusy || !!pending || !parseId || disabled" :loading="previewBusy" @click="loadPreview"
        >预览导入范围</TpButton
      ><TpButton variant="ghost" :disabled="loading || busy || !!pending" @click="loadMaterials">刷新可选资料</TpButton>
    </div>
    <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="error" :key="error" class="studio-notice" role="alert">{{ error }}</p></Transition>
    <p v-if="notice" class="tp-caption" role="status">{{ notice }}</p>
    <Transition name="tp-swap" v-bind="panelMotionHooks"
      ><section v-if="preview" class="studio-stack" aria-label="原始章节预览">
        <h3 class="tp-heading">原始章节预览</h3>
        <p class="tp-caption">{{ preview.filename }} · {{ preview.parser_version }} · {{ preview.status === "complete" ? "完整解析" : "部分解析" }}</p>
        <p class="import-digest tp-caption">原件 SHA-256：{{ preview.original_sha256 }}</p>
        <ul v-if="preview.diagnostics.length" class="import-diagnostics">
          <li v-for="(item, index) in preview.diagnostics" :key="index">{{ item }}</li>
        </ul>
        <p class="studio-notice">
          导入后仅支持已映射的纯文字编辑；章节、格式、结构和未知对象保留锁定。下方为本次“导入后”的类型选择，最终由服务器验证并在显式导入时生效。
        </p>
        <p v-if="preview.chapters_truncated" class="studio-notice">仅显示部分章节候选，其余来源结构原样保留。</p>
        <TransitionGroup tag="div" name="tp-list" v-bind="listMotionHooks" class="studio-stack tp-list-group"
          ><article v-for="(chapter, index) in preview.chapters" :key="chapter.anchor_id" class="import-chapter" :aria-label="`导入章节 ${index + 1}`">
            <p class="import-chapter-title">{{ chapter.title || "（空段落）" }}</p>
            <p class="tp-caption">
              原类型：{{ chapter.kind === "heading" ? `${chapter.level}级标题` : "普通段落" }} · {{ chapter.editable ? "可校正类型" : "保留原结构" }}
            </p>
            <div v-if="drafts[chapter.anchor_id]" class="import-chapter-controls">
              <TpField v-slot="{ id }" label="导入后类型"
                ><TpSelect
                  :id="id"
                  v-model="drafts[chapter.anchor_id]!.kind"
                  :disabled="!chapter.editable || busy || !!pending"
                  :options="[
                    { value: 'paragraph', label: '普通段落', disabled: !chapter.allowed_kinds.includes('paragraph') },
                    { value: 'heading', label: '标题', disabled: !chapter.allowed_kinds.includes('heading') },
                  ]" /></TpField
              ><TpField v-if="drafts[chapter.anchor_id]!.kind === 'heading'" v-slot="{ id }" label="导入后标题级别"
                ><TpSelect
                  :id="id"
                  v-model="drafts[chapter.anchor_id]!.level"
                  :disabled="!chapter.editable || busy || !!pending"
                  :options="[1, 2, 3, 4, 5, 6].map((value) => ({ value, label: `${value}级标题` }))"
              /></TpField>
            </div></article
        ></TransitionGroup>
        <p v-if="preview.existing_document_id" class="studio-notice">项目已有正式稿，不能导入覆盖；请检查当前正式稿。</p>
        <div class="screen-actions">
          <TpButton variant="primary" :disabled="busy || !preview.can_import || disabled" :loading="busy" @click="importSource">{{
            pending ? "使用原导入命令确认" : "确认导入正式稿"
          }}</TpButton
          ><TpButton :disabled="busy" @click="emit('checkCurrent')">检查当前正式稿</TpButton>
        </div>
      </section></Transition
    >
  </section>
</template>

<style scoped>
.import-selectors,
.import-chapter-controls {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.import-chapter {
  padding: 16px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
}
.import-chapter-title {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.7;
  margin-bottom: 8px;
}
.import-chapter-controls {
  margin-top: 12px;
}
.import-digest {
  font-family: var(--tp-font-mono);
  font-size: 11px;
  overflow-wrap: anywhere;
}
.import-diagnostics {
  font-size: 13px;
  padding-left: 20px;
}
@media (max-width: 700px) {
  .import-selectors,
  .import-chapter-controls {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
