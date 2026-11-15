<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowRef } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import type { BackendServices } from "@/services";
import { asApiError } from "@/services/errors";
import { listMotionHooks } from "@/design/motion";

export interface AssistantContextDraft {
  agentVersionId: string;
  bindingVersionId: string | null;
  bindingVersion: number | null;
  requiredBindingId: string | null;
  ready: boolean;
  sources: { materialId: string; originalId: string; parseId: string; anchorIds: string[] }[];
}
const props = defineProps<{ services: BackendServices; projectId: string; disabled: boolean }>();
const draft = defineModel<AssistantContextDraft>({ required: true });
type Agent = Awaited<ReturnType<BackendServices["aiConfigs"]["version"]>>;
type Parsed = Awaited<ReturnType<BackendServices["materials"]["parse"]>>;
type Binding = Awaited<ReturnType<BackendServices["materials"]["sourceBindingVersion"]>>;
type SourceChoice = { id: string; materialId: string; originalId: string; name: string; original: number; version: number };
const agents = shallowRef<{ version: Agent; enabled: boolean }[]>([]);
const sources = shallowRef<SourceChoice[]>([]);
const bindings = shallowRef<Binding[]>([]);
const loaded = shallowRef<Record<string, Parsed>>({});
const currentBinding = shallowRef<Awaited<ReturnType<BackendServices["materials"]["sourceBinding"]>>>();
const loading = ref(false);
const error = ref("");
const sourceLoading = ref(false);
const sourceError = ref("");
const chooseSource = ref("");
const anchorLimit = ref<Record<string, number>>({});
const agentOptions = computed(() => [
  { value: "", label: "选择固定内容助手版本" },
  ...agents.value.map((item) => ({
    value: item.version.id,
    label: `${item.version.name} · v${item.version.version}${item.enabled ? "" : "（已停用）"}`,
    disabled: !item.enabled,
  })),
]);
const sourceOptions = computed(() => [
  { value: "", label: "选择资料解析版本" },
  ...sources.value
    .filter((item) => !draft.value.sources.some((source) => source.parseId === item.id))
    .map((item) => ({ value: item.id, label: `${item.name} · 原件v${item.original} · 解析v${item.version}` })),
]);
const bindingOptions = computed(() => [
  { value: "", label: currentBinding.value?.current_version_id ? "请选择当前来源绑定（必选）" : "不包含模板与要求绑定" },
  ...bindings.value
    .filter((item) => item.id === currentBinding.value?.current_version_id)
    .map((item) => ({ value: item.id, label: `来源绑定 v${item.version}` })),
]);
const bindingId = computed({
  get: () => draft.value.bindingVersionId ?? "",
  set: (value: string) => {
    draft.value.bindingVersionId = value || null;
    draft.value.bindingVersion = bindings.value.find((item) => item.id === value)?.version ?? null;
  },
});
const sourceLabel = (id: string) => {
  const item = sources.value.find((source) => source.id === id);
  return item ? `${item.name} · 原件v${item.original} · 解析v${item.version}` : `固定解析版本 ${id.slice(0, 8)}`;
};
let request: AbortController | undefined;
let sourceRequest: AbortController | undefined;
async function allAgents(signal: AbortSignal) {
  const result: { version: Agent; enabled: boolean }[] = [];
  let offset = 0;
  do {
    const page = await props.services.aiConfigs.list({ kind: "agent", offset, limit: 100 }, signal);
    for (const config of page.items) {
      if (config.content.kind !== "agent" || config.content.role !== "content") continue;
      let versionOffset = 0;
      do {
        const history = await props.services.aiConfigs.versions(config.id, { offset: versionOffset, limit: 100 }, signal);
        result.push(
          ...history.items
            .filter((version) => version.content.kind === "agent" && version.content.role === "content")
            .map((version) => ({ version, enabled: config.enabled })),
        );
        versionOffset += history.items.length;
        if (!history.items.length || versionOffset >= history.total) break;
      } while (!signal.aborted);
    }
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  } while (!signal.aborted);
  return result;
}
async function allSources(signal: AbortSignal) {
  const result: SourceChoice[] = [];
  let offset = 0;
  do {
    const page = await props.services.materials.list(props.projectId, { offset, limit: 100 }, signal);
    for (const material of page.items) {
      if (!material.linked || material.removed) continue;
      let originalOffset = 0;
      do {
        const originals = await props.services.materials.originals(props.projectId, material.id, { offset: originalOffset, limit: 100 }, signal);
        for (const original of originals.items) {
          let parseOffset = 0;
          do {
            const parses = await props.services.materials.parses(props.projectId, material.id, original.id, { offset: parseOffset, limit: 100 }, signal);
            result.push(
              ...parses.items.map((parsed) => ({
                id: parsed.id,
                materialId: material.id,
                originalId: original.id,
                name: material.name,
                original: original.version,
                version: parsed.version,
              })),
            );
            parseOffset += parses.items.length;
            if (!parses.items.length || parseOffset >= parses.total) break;
          } while (!signal.aborted);
        }
        originalOffset += originals.items.length;
        if (!originals.items.length || originalOffset >= originals.total) break;
      } while (!signal.aborted);
    }
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  } while (!signal.aborted);
  return result;
}
async function allBindings(signal: AbortSignal) {
  const result: Binding[] = [];
  let offset = 0;
  do {
    const page = await props.services.materials.sourceBindingVersions(props.projectId, { offset, limit: 100 }, signal);
    result.push(...page.items);
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  } while (!signal.aborted);
  return result;
}
async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  loading.value = true;
  draft.value.ready = false;
  error.value = "";
  const results = await Promise.allSettled([
    allAgents(controller.signal),
    allSources(controller.signal),
    allBindings(controller.signal),
    props.services.materials.sourceBinding(props.projectId, controller.signal),
  ]);
  if (controller.signal.aborted) return;
  const failures: string[] = [];
  if (results[0].status === "fulfilled") agents.value = results[0].value;
  else failures.push(`助手配置：${asApiError(results[0].reason).message}`);
  if (results[1].status === "fulfilled") sources.value = results[1].value;
  else failures.push(`资料：${asApiError(results[1].reason).message}`);
  if (results[2].status === "fulfilled") bindings.value = results[2].value;
  else failures.push(`来源绑定：${asApiError(results[2].reason).message}`);
  if (results[3].status === "fulfilled") {
    currentBinding.value = results[3].value;
    draft.value.requiredBindingId = results[3].value.current_version_id;
  } else failures.push(`当前绑定：${asApiError(results[3].reason).message}`);
  draft.value.ready = failures.length === 0;
  error.value = failures.join(" ");
  loading.value = false;
}
async function addSource(id: string) {
  chooseSource.value = "";
  const item = sources.value.find((source) => source.id === id);
  if (!item || props.disabled || sourceLoading.value) return;
  if (draft.value.sources.length >= 10) {
    sourceError.value = "一次最多选择 10 份资料。";
    return;
  }
  sourceRequest?.abort();
  const controller = new AbortController();
  sourceRequest = controller;
  sourceLoading.value = true;
  sourceError.value = "";
  try {
    const parsed = await props.services.materials.parse(props.projectId, item.materialId, item.originalId, item.id, controller.signal);
    if (controller.signal.aborted) return;
    loaded.value = { ...loaded.value, [id]: parsed };
    if (!draft.value.sources.some((source) => source.parseId === id))
      draft.value.sources.push({ materialId: item.materialId, originalId: item.originalId, parseId: id, anchorIds: [] });
    anchorLimit.value[id] = 10;
  } catch (problem) {
    if (!controller.signal.aborted) sourceError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) sourceLoading.value = false;
  }
}
onMounted(() => void load());
onScopeDispose(() => {
  request?.abort();
  sourceRequest?.abort();
});
</script>

<template>
  <section class="assistant-context studio-stack" aria-label="助手固定上下文">
    <TpField v-slot="{ id }" label="内容助手配置版本"
      ><TpSelect :id="id" v-model="draft.agentVersionId" :options="agentOptions" :disabled="disabled || loading"
    /></TpField>
    <p v-if="!loading && !agents.length" class="studio-notice">暂无内容角色的智能体配置，请先在四库建立内容助手。本轮不代替其他专业。</p>
    <TpField v-slot="{ id }" label="包含来源绑定快照"
      ><TpSelect :id="id" v-model="bindingId" :options="bindingOptions" :disabled="disabled || loading"
    /></TpField>
    <p class="tp-caption">项目已有模板或要求绑定时，必须明确选择当前固定版本；没有绑定时不补造依据。</p>
    <TpField v-slot="{ id }" label="添加资料解析版本"
      ><TpSelect :id="id" :model-value="chooseSource" :options="sourceOptions" :disabled="disabled || loading || sourceLoading" @update:model-value="addSource"
    /></TpField>
    <p class="tp-caption">资料需逐份选择来源锚点；未勾选锚点的资料不会发送。资料内容不授予工具或写入权限。</p>
    <p v-if="loading || sourceLoading" role="status" class="tp-caption">正在读取固定上下文…</p>
    <p v-if="error || sourceError" role="alert" class="studio-notice">{{ error || sourceError }}</p>
    <TpButton size="sm" variant="ghost" :disabled="disabled || loading" @click="load">刷新上下文选项</TpButton>
    <TransitionGroup tag="div" name="tp-list" v-bind="listMotionHooks" class="studio-stack tp-list-group"
      ><article v-for="source in draft.sources" :key="source.parseId" class="assistant-source">
        <div class="studio-row">
          <strong>{{ sourceLabel(source.parseId) }}</strong
          ><TpButton size="sm" variant="ghost" :disabled="disabled" @click="draft.sources = draft.sources.filter((item) => item.parseId !== source.parseId)"
            >移除此资料</TpButton
          >
        </div>
        <p v-if="!loaded[source.parseId]?.result.anchors.length" class="tp-caption">本版本没有可选来源锚点，不会发送原文。</p>
        <label v-for="anchor in loaded[source.parseId]?.result.anchors.slice(0, anchorLimit[source.parseId] ?? 10)" :key="anchor.id" class="assistant-anchor"
          ><input
            v-model="source.anchorIds"
            type="checkbox"
            class="checkbox checkbox-sm"
            :value="anchor.id"
            :disabled="disabled"
            :aria-label="`使用资料锚点：${sourceLabel(source.parseId)} · ${anchor.id}`"
          /><span>{{ anchor.original_text }}</span></label
        ><TpButton
          v-if="(loaded[source.parseId]?.result.anchors.length ?? 0) > (anchorLimit[source.parseId] ?? 10)"
          size="sm"
          variant="ghost"
          @click="anchorLimit[source.parseId] = (anchorLimit[source.parseId] ?? 10) + 10"
          >查看更多资料锚点</TpButton
        >
      </article></TransitionGroup
    >
  </section>
</template>

<style scoped>
.assistant-context {
  padding: 14px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
}
.assistant-source {
  padding: 12px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.assistant-anchor {
  display: flex;
  align-items: start;
  gap: 8px;
  margin-top: 10px;
  line-height: 1.6;
}
.assistant-anchor span {
  white-space: pre-wrap;
  max-height: 100px;
  overflow: auto;
}
.assistant-anchor input {
  flex-shrink: 0;
  margin-top: 3px;
}
</style>
