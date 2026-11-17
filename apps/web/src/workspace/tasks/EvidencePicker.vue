<script setup lang="ts">
import { computed, onActivated, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import type { BackendServices, DocumentRead, MaterialParseRead } from "@/services";
import { asApiError } from "@/services/errors";
import { listMotionHooks } from "@/design/motion";
import { nodeTextblocks } from "@/services/revisionProtectionV2";
import { documentTextblocks, evidenceLabel, exactTextRange, textareaTextRange, type EvidenceDraft } from "./taskFeedbackDraft";

const props = defineProps<{ services: BackendServices; projectId: string; disabled?: boolean }>();
const evidence = defineModel<EvidenceDraft[]>({ required: true });
const emit = defineEmits<{ document: [value: DocumentRead] }>();
const document = shallowRef<DocumentRead>();
const blockIndex = ref("");
/** v2 正文按节点（段落 / 标题，含表格与列表内）列出；v1 旧正文沿用编辑器路径。 */
const blocks = computed<{ label: string; text: string; path?: number[]; position?: number; node?: string }[]>(() => {
  const content = document.value?.content;
  if (!content) return [];
  if (content.schema_version === 2)
    return nodeTextblocks(content)
      .filter((item) => item.text.trim())
      .map((item) => ({ node: item.node, text: item.text, label: `${item.type === "heading" ? "标题" : "段落"} · ${item.text.slice(0, 64)}` }));
  return documentTextblocks(content.json);
});
const block = computed(() => blocks.value[Number(blockIndex.value)]);
const range = ref<{ from: number; to: number; text: string }>();
const choices = shallowRef<{ id: string; materialId: string; originalId: string; label: string }[]>([]);
const parseId = ref("");
const parsed = shallowRef<MaterialParseRead>();
const anchors = ref<string[]>([]);
const busy = ref(false);
const parseBusy = ref(false);
const error = ref("");
let request: AbortController | undefined;
let parseRequest: AbortController | undefined;
watch(blockIndex, () => {
  range.value = undefined;
});
async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  error.value = "";
  const results = await Promise.allSettled([
    props.services.documents.current(props.projectId, controller.signal),
    (async () => {
      const result: typeof choices.value = [];
      for (let offset = 0; !controller.signal.aborted;) {
        const materials = await props.services.materials.list(props.projectId, { offset, limit: 100 }, controller.signal);
        for (const material of materials.items) {
          if (material.removed || !material.linked) continue;
          for (let originalOffset = 0; !controller.signal.aborted;) {
            const originals = await props.services.materials.originals(props.projectId, material.id, { offset: originalOffset, limit: 100 }, controller.signal);
            for (const original of originals.items) {
              for (let parseOffset = 0; !controller.signal.aborted;) {
                const parses = await props.services.materials.parses(
                  props.projectId,
                  material.id,
                  original.id,
                  { offset: parseOffset, limit: 100 },
                  controller.signal,
                );
                result.push(
                  ...parses.items.map((item) => ({
                    id: item.id,
                    materialId: material.id,
                    originalId: original.id,
                    label: `${material.name} · 原件v${original.version} · 解析v${item.version}`,
                  })),
                );
                parseOffset += parses.items.length;
                if (!parses.items.length || parseOffset >= parses.total) break;
              }
            }
            originalOffset += originals.items.length;
            if (!originals.items.length || originalOffset >= originals.total) break;
          }
        }
        offset += materials.items.length;
        if (!materials.items.length || offset >= materials.total) break;
      }
      return result;
    })(),
  ]);
  if (controller.signal.aborted) return;
  const failures: string[] = [];
  if (results[0].status === "fulfilled") {
    document.value = results[0].value;
    range.value = undefined;
    emit("document", results[0].value);
  } else if (asApiError(results[0].reason).code !== "DOCUMENT_NOT_FOUND") failures.push(`正文：${asApiError(results[0].reason).message}`);
  if (results[1].status === "fulfilled") choices.value = results[1].value;
  else failures.push(`材料选项：${asApiError(results[1].reason).message}`);
  error.value = failures.join("；");
  busy.value = false;
}
function capture(event: Event) {
  const field = event.target as HTMLTextAreaElement;
  range.value = block.value ? textareaTextRange(block.value.text, field.selectionStart, field.selectionEnd) : undefined;
}
function addDocument() {
  if (!document.value || !block.value || !range.value || props.disabled) return;
  const selected = block.value;
  const { from, to, text } = range.value;
  const scalar = (offset: number) => Array.from(selected.text.slice(0, offset)).length;
  const next: EvidenceDraft = {
    kind: "document",
    document_id: document.value.id,
    version: document.value.version,
    selection: selected.node
      ? { node_id: selected.node, start: scalar(from), end: scalar(to), expected_text: text }
      : { textblock_path: selected.path!, from: selected.position! + from, to: selected.position! + to, text },
  };
  if (!evidence.value.some((item) => JSON.stringify(item) === JSON.stringify(next))) evidence.value = [...evidence.value, next];
  range.value = undefined;
}
async function selectParse(id: string) {
  parseRequest?.abort();
  parsed.value = undefined;
  anchors.value = [];
  const choice = choices.value.find((item) => item.id === id);
  if (!choice) return;
  const controller = new AbortController();
  parseRequest = controller;
  parseBusy.value = true;
  error.value = "";
  try {
    const result = await props.services.materials.parse(props.projectId, choice.materialId, choice.originalId, id, controller.signal);
    if (!controller.signal.aborted) parsed.value = result;
  } catch (issue) {
    if (!controller.signal.aborted) error.value = asApiError(issue).message;
  } finally {
    if (!controller.signal.aborted) parseBusy.value = false;
  }
}
function addMaterial() {
  const choice = choices.value.find((item) => item.id === parseId.value);
  if (!choice || !anchors.value.length || props.disabled) return;
  const next: EvidenceDraft = {
    kind: "material",
    material_id: choice.materialId,
    original_id: choice.originalId,
    parse_version_id: choice.id,
    anchor_ids: [...anchors.value].sort(),
  };
  if (!evidence.value.some((item) => JSON.stringify(item) === JSON.stringify(next))) evidence.value = [...evidence.value, next];
  anchors.value = [];
}
watch(
  () => props.projectId,
  () => void load(),
  { immediate: true },
);
/** 所在页面被外壳缓存；回到页面时重读证据来源，已加入的证据不变。 */
let activated = false;
onActivated(() => {
  if (activated) void load();
  activated = true;
});
onScopeDispose(() => {
  request?.abort();
  parseRequest?.abort();
});
</script>

<template>
  <section class="studio-stack evidence-picker" aria-label="精确版本证据">
    <div class="screen-heading">
      <h3 class="tp-subheading">产物证据</h3>
      <TpButton size="sm" :disabled="disabled || busy" @click="load">刷新证据来源</TpButton>
    </div>
    <p class="tp-caption">固定到服务已保存版本。请明确选择原文范围；新版本不会自动替换旧证据。</p>
    <p v-if="busy || parseBusy" role="status" class="tp-caption">正在读取证据来源…</p>
    <p v-if="error" role="alert" class="studio-notice">{{ error }}</p>
    <TpField v-if="document" v-slot="{ id }" :label="`正文证据段落 · v${document.version}`"
      ><TpSelect
        :id="id"
        v-model="blockIndex"
        :disabled="disabled || busy"
        :options="[{ value: '', label: '选择正文段落' }, ...blocks.map((item, index) => ({ value: String(index), label: item.label }))]"
    /></TpField>
    <template v-if="blockIndex !== '' && block">
      <TpField
        v-slot="{ id }"
        label="正文证据原文选区"
        :hint="block.node ? '在只读文字中用鼠标或键盘选择，程序按字符记录段内精确位置。' : '在只读文字中用鼠标或键盘选择，程序记录精确 UTF-16 范围。'"
      >
        <textarea :id="id" class="tp-input" rows="4" readonly :value="block.text" :disabled="disabled" @select="capture" @keyup="capture" @mouseup="capture" />
      </TpField>
      <p v-if="range" class="tp-caption">已选 {{ range.from }}–{{ range.to }}：{{ range.text }}</p>
      <div class="screen-actions">
        <TpButton size="sm" :disabled="disabled" @click="range = exactTextRange(block.text, 0, block.text.length)">选择整段作为证据</TpButton
        ><TpButton size="sm" :disabled="disabled || !range || evidence.length >= 20" @click="addDocument">添加正文选区证据</TpButton>
      </div>
    </template>
    <p v-if="!busy && !document" class="tp-caption">暂无已保存正文，可先添加材料证据。</p>
    <TpField v-slot="{ id }" label="材料证据解析版本"
      ><TpSelect
        :id="id"
        v-model="parseId"
        :disabled="disabled || busy || parseBusy"
        :options="[{ value: '', label: '选择材料原件与解析版本' }, ...choices.map((item) => ({ value: item.id, label: item.label }))]"
        @update:model-value="selectParse"
    /></TpField>
    <div v-if="parsed" class="evidence-anchors">
      <label v-for="anchor in parsed.result.anchors" :key="anchor.id" class="evidence-anchor"
        ><input
          v-model="anchors"
          class="checkbox checkbox-sm"
          type="checkbox"
          :value="anchor.id"
          :disabled="disabled || (!anchors.includes(anchor.id) && anchors.length >= 20)"
        /><span>{{ anchor.original_text || anchor.kind }}<small class="tp-caption">{{ anchor.id }}</small></span></label
      >
      <TpButton size="sm" :disabled="disabled || !anchors.length || evidence.length >= 20" @click="addMaterial">添加材料锚点证据</TpButton>
    </div>
    <TransitionGroup tag="ol" name="tp-list" v-bind="listMotionHooks" class="studio-stack evidence-list"
      ><li v-for="(item, index) in evidence" :key="JSON.stringify(item)">
        <span>{{ evidenceLabel(item) }}</span
        ><TpButton
          size="sm"
          variant="ghost"
          :disabled="disabled"
          :label="`移除证据 ${index + 1}`"
          @click="evidence = evidence.filter((_, position) => position !== index)"
          >移除</TpButton
        >
      </li></TransitionGroup
    >
  </section>
</template>

<style scoped>
.evidence-picker {
  padding: 16px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-m);
}
.evidence-anchors {
  display: grid;
  gap: 10px;
  max-height: 320px;
  overflow: auto;
}
.evidence-anchor {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
}
.evidence-anchor small {
  display: block;
}
.evidence-list {
  margin: 0;
  padding-left: 20px;
}
.evidence-list li {
  overflow-wrap: anywhere;
  font-size: 13px;
}
</style>
