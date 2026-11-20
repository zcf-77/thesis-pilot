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
/** 显示用字符位置按 Unicode 字符计数（与 v2 标量偏移一致），从 1 开始。 */
const rangeLabel = computed(() => {
  if (!range.value || !block.value) return "";
  const count = (offset: number) => Array.from(block.value!.text.slice(0, offset)).length;
  return `${count(range.value.from) + 1}–${count(range.value.to)}`;
});
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
function displayEvidence(item: EvidenceDraft) {
  if (item.kind === "document") {
    const text = "expected_text" in item.selection ? item.selection.expected_text : item.selection.text;
    return `正文 v${item.version} · ${text}`;
  }
  const choice = choices.value.find((entry) => entry.id === item.parse_version_id);
  return `${choice?.label ?? "历史材料证据"} · ${item.anchor_ids.length} 个锚点`;
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
    <div class="evidence-picker__heading">
      <h3 class="tp-subheading">产物证据</h3>
      <TpButton size="sm" variant="ghost" :disabled="disabled || busy" @click="load">刷新来源</TpButton>
    </div>
    <p class="tp-caption">固定到所选版本；来源更新后需复核。</p>
    <Transition name="tp-swap">
      <p v-if="busy || parseBusy" role="status" class="tp-caption">正在读取证据来源…</p>
    </Transition>
    <Transition name="tp-swap">
      <p v-if="error" role="alert" class="studio-notice">{{ error }}</p>
    </Transition>
    <TpField v-if="document" v-slot="{ id }" :label="`正文段落 · v${document.version}`">
      <TpSelect
        :id="id"
        v-model="blockIndex"
        :disabled="disabled || busy"
        :options="[{ value: '', label: '选择正文段落' }, ...blocks.map((item, index) => ({ value: String(index), label: item.label }))]"
      />
    </TpField>
    <template v-if="blockIndex !== '' && block">
      <TpField v-slot="{ id }" label="正文证据选区" hint="在只读原文中用鼠标或键盘选择精确范围。">
        <textarea :id="id" class="tp-input" rows="4" readonly :value="block.text" :disabled="disabled" @select="capture" @keyup="capture" @mouseup="capture" />
      </TpField>
      <Transition name="tp-swap">
        <p v-if="range" class="tp-caption evidence-range" role="status">已选第 {{ rangeLabel }} 字：{{ range.text }}</p>
      </Transition>
      <div class="screen-actions">
        <TpButton size="sm" variant="ghost" :disabled="disabled" @click="range = exactTextRange(block.text, 0, block.text.length)">选择整段</TpButton>
        <TpButton size="sm" :disabled="disabled || !range || evidence.length >= 20" @click="addDocument">添加正文证据</TpButton>
      </div>
    </template>
    <p v-if="!busy && !document" class="tp-caption">暂无已保存正文，可添加材料证据。</p>
    <TpField v-slot="{ id }" label="材料解析版本">
      <TpSelect
        :id="id"
        v-model="parseId"
        :disabled="disabled || busy || parseBusy"
        :options="[{ value: '', label: '选择材料原件与解析版本' }, ...choices.map((item) => ({ value: item.id, label: item.label }))]"
        @update:model-value="selectParse"
      />
    </TpField>
    <Transition name="tp-swap">
      <div v-if="parsed" class="evidence-anchors">
        <label v-for="anchor in parsed.result.anchors" :key="anchor.id" class="evidence-anchor">
          <input
            v-model="anchors"
            class="tp-checkbox"
            type="checkbox"
            :value="anchor.id"
            :disabled="disabled || (!anchors.includes(anchor.id) && anchors.length >= 20)"
          /><span>{{ anchor.original_text || anchor.kind }}</span>
        </label>
        <TpButton size="sm" :disabled="disabled || !anchors.length || evidence.length >= 20" @click="addMaterial">添加材料证据</TpButton>
      </div>
    </Transition>
    <TransitionGroup tag="ol" name="tp-list" v-bind="listMotionHooks" class="evidence-list tp-list-group">
      <li v-for="(item, index) in evidence" :key="JSON.stringify(item)">
        <div class="evidence-list__content">
          <span>{{ displayEvidence(item) }}</span>
          <details class="tp-disclosure evidence-list__technical">
            <summary class="tp-caption">定位信息</summary>
            <p class="tp-mono">{{ evidenceLabel(item) }}</p>
          </details>
        </div>
        <TpButton
          size="sm"
          variant="ghost"
          :disabled="disabled"
          :label="`移除证据 ${index + 1}`"
          @click="evidence = evidence.filter((_, position) => position !== index)"
          >移除</TpButton
        >
      </li>
    </TransitionGroup>
  </section>
</template>

<style scoped>
.evidence-picker {
  padding-top: 16px;
  border-top: 1px solid var(--tp-line);
}
.evidence-picker__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.evidence-range {
  overflow-wrap: anywhere;
}
.evidence-anchors {
  display: grid;
  gap: 8px;
  max-height: 320px;
  overflow: auto;
}
.evidence-anchor {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-height: 32px;
  font-size: 13px;
}
.evidence-anchor input {
  flex: none;
  margin-top: 3px;
}
.evidence-list {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.evidence-list li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding-block: 8px;
  border-top: 1px solid var(--tp-line);
  overflow-wrap: anywhere;
  font-size: 13px;
}
.evidence-list__content {
  min-width: 0;
}
.evidence-list__technical {
  margin-top: 4px;
}
.evidence-list__technical p {
  padding-top: 4px;
  overflow-wrap: anywhere;
}
</style>
