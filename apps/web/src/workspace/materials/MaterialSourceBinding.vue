<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import type { BackendServices } from "@/services";
import { asApiError } from "@/services/errors";
import { panelMotionHooks } from "@/lab/components/integration/motion";

const props = defineProps<{ services: BackendServices; projectId: string; refreshToken: number }>();
type Binding = Awaited<ReturnType<BackendServices["materials"]["sourceBinding"]>>;
type HistoryPage = Awaited<ReturnType<BackendServices["materials"]["sourceBindingVersions"]>>;
type History = Awaited<ReturnType<BackendServices["materials"]["sourceBindingVersion"]>>;
type Choice = { id: string; kind: string; name: string; original: number; version: number };
const binding = shallowRef<Binding>();
const choices = shallowRef<Choice[]>([]);
const template = ref("");
const requirements = ref<string[]>([]);
const loading = ref(false);
const optionLoading = ref(false);
const busy = ref(false);
const error = ref("");
const optionError = ref("");
const notice = ref("");
const mustReload = ref(false);
const history = shallowRef<HistoryPage>();
const viewing = shallowRef<History>();
const historyBusy = ref(false);
const historyError = ref("");
const choiceLabel = (item: Choice) => `${item.name} · 原件v${item.original} · 解析v${item.version}`;
const templateOptions = computed(() => [
  { value: "", label: "不绑定模板" },
  ...choices.value.filter((item) => item.kind === "template").map((item) => ({ value: item.id, label: choiceLabel(item) })),
  ...(template.value && !choices.value.some((item) => item.id === template.value)
    ? [{ value: template.value, label: `已绑定解析版本 ${template.value.slice(0, 8)}` }]
    : []),
]);
const requirementChoices = computed(() => choices.value.filter((item) => item.kind === "requirements"));
const missingRequirements = computed(() => requirements.value.filter((id) => !choices.value.some((item) => item.id === id)));
const sourceLabel = (id: string | null) =>
  id
    ? choices.value.find((item) => item.id === id)
      ? choiceLabel(choices.value.find((item) => item.id === id)!)
      : `固定解析版本 ${id.slice(0, 8)}`
    : "未绑定";
let currentRequest: AbortController | undefined;
let optionsRequest: AbortController | undefined;
let saveRequest: AbortController | undefined;
let historyRequest: AbortController | undefined;

async function loadCurrent() {
  currentRequest?.abort();
  const controller = new AbortController();
  currentRequest = controller;
  loading.value = true;
  error.value = "";
  try {
    const latest = await props.services.materials.sourceBinding(props.projectId, controller.signal);
    if (!controller.signal.aborted) {
      binding.value = latest;
      template.value = latest.template_parse_version_id ?? "";
      requirements.value = [...latest.requirement_parse_version_ids];
      mustReload.value = false;
    }
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}
async function loadOptions() {
  optionsRequest?.abort();
  const controller = new AbortController();
  optionsRequest = controller;
  optionLoading.value = true;
  optionError.value = "";
  const found: Choice[] = [];
  try {
    let offset = 0;
    do {
      const materials = await props.services.materials.list(props.projectId, { offset, limit: 100 }, controller.signal);
      if (controller.signal.aborted) return;
      for (const material of materials.items) {
        if (!["template", "requirements"].includes(material.kind) || material.removed || !material.linked) continue;
        let originalOffset = 0;
        do {
          const originals = await props.services.materials.originals(props.projectId, material.id, { offset: originalOffset, limit: 100 }, controller.signal);
          if (controller.signal.aborted) return;
          for (const original of originals.items) {
            let parseOffset = 0;
            do {
              const parses = await props.services.materials.parses(
                props.projectId,
                material.id,
                original.id,
                { offset: parseOffset, limit: 100 },
                controller.signal,
              );
              if (controller.signal.aborted) return;
              found.push(
                ...parses.items.map((item) => ({ id: item.id, kind: material.kind, name: material.name, original: original.version, version: item.version })),
              );
              parseOffset += parses.items.length;
              if (!parses.items.length || parseOffset >= parses.total) break;
            } while (!controller.signal.aborted);
          }
          originalOffset += originals.items.length;
          if (!originals.items.length || originalOffset >= originals.total) break;
        } while (!controller.signal.aborted);
      }
      offset += materials.items.length;
      if (!materials.items.length || offset >= materials.total) break;
    } while (!controller.signal.aborted);
    choices.value = found;
  } catch (problem) {
    if (!controller.signal.aborted) {
      choices.value = found;
      optionError.value = `可绑定版本仅部分读取：${asApiError(problem).message}`;
    }
  } finally {
    if (!controller.signal.aborted) optionLoading.value = false;
  }
}
async function save() {
  if (!binding.value || busy.value || mustReload.value) return;
  if (requirements.value.length > 50) {
    error.value = "每个绑定快照最多选择 50 个要求解析版本。";
    return;
  }
  saveRequest?.abort();
  const controller = new AbortController();
  saveRequest = controller;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const latest = await props.services.materials.updateSourceBinding(
      props.projectId,
      { expected_version: binding.value.version, template_parse_version_id: template.value || null, requirement_parse_version_ids: [...requirements.value] },
      controller.signal,
    );
    if (!controller.signal.aborted) {
      binding.value = latest;
      template.value = latest.template_parse_version_id ?? "";
      requirements.value = [...latest.requirement_parse_version_ids];
      notice.value = `已保存来源绑定 v${latest.version}；后续解析不会自动替换这些固定版本。`;
    }
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      mustReload.value = issue.status === 409 || issue.status === undefined || issue.status >= 500 || issue.code === "INVALID_RESPONSE";
      error.value = mustReload.value ? `${issue.message} 选择已保留，请载入最新绑定后重新核对。` : issue.message;
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
async function loadHistory(offset = 0) {
  historyRequest?.abort();
  const controller = new AbortController();
  historyRequest = controller;
  historyBusy.value = true;
  historyError.value = "";
  try {
    const page = await props.services.materials.sourceBindingVersions(props.projectId, { offset, limit: 20 }, controller.signal);
    if (!controller.signal.aborted) {
      history.value = page;
      viewing.value = page.items[0];
    }
  } catch (problem) {
    if (!controller.signal.aborted) historyError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) historyBusy.value = false;
  }
}
async function viewHistory(version: number) {
  historyRequest?.abort();
  const controller = new AbortController();
  historyRequest = controller;
  historyBusy.value = true;
  historyError.value = "";
  try {
    const item = await props.services.materials.sourceBindingVersion(props.projectId, version, controller.signal);
    if (!controller.signal.aborted) viewing.value = item;
  } catch (problem) {
    if (!controller.signal.aborted) historyError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) historyBusy.value = false;
  }
}
onMounted(() => {
  void loadCurrent();
  void loadOptions();
});
watch(
  () => props.refreshToken,
  () => void loadOptions(),
);
onScopeDispose(() => {
  currentRequest?.abort();
  optionsRequest?.abort();
  saveRequest?.abort();
  historyRequest?.abort();
});
</script>

<template>
  <section class="screen-panel studio-body studio-stack" aria-label="项目来源绑定">
    <div class="studio-row">
      <h2 class="tp-heading">项目来源绑定</h2>
      <span v-if="binding" class="tp-caption">{{ binding.version ? "当前 v" + binding.version : "尚未绑定" }}</span>
    </div>
    <p class="tp-caption">只绑定本项目的确切解析版本，不随新上传或重新解析自动变化，不修改正式稿。</p>
    <p v-if="loading || optionLoading" role="status" class="tp-caption">正在读取来源与固定版本…</p>
    <form v-if="binding" class="studio-stack" @submit.prevent="save">
      <TpField v-slot="{ id }" label="模板解析版本"
        ><TpSelect :id="id" v-model="template" :options="templateOptions" :disabled="busy || loading || optionLoading"
      /></TpField>
      <fieldset class="binding-requirements" :disabled="busy || loading || optionLoading">
        <legend class="tp-caption">要求解析版本（可多选）</legend>
        <p v-if="!requirementChoices.length && !optionLoading" class="tp-caption">暂无已解析的要求来源，请先上传并等待解析。</p>
        <label v-for="item in requirementChoices" :key="item.id"
          ><input v-model="requirements" type="checkbox" class="checkbox checkbox-sm" :value="item.id" :aria-label="`绑定要求：${choiceLabel(item)}`" /><span>{{
            choiceLabel(item)
          }}</span></label
        ><label v-for="id in missingRequirements" :key="id"
          ><input v-model="requirements" type="checkbox" class="checkbox checkbox-sm" :value="id" /><span
            >{{ sourceLabel(id) }}（当前列表不可用，原绑定保留）</span
          ></label
        >
      </fieldset>
      <div class="screen-actions">
        <TpButton type="submit" variant="primary" :loading="busy" :disabled="busy || loading || optionLoading || mustReload">保存来源绑定</TpButton
        ><TpButton v-if="mustReload" :disabled="busy || loading" @click="loadCurrent">载入最新绑定</TpButton
        ><TpButton variant="ghost" :disabled="optionLoading" @click="loadOptions">刷新可绑定版本</TpButton>
      </div>
    </form>
    <Transition name="tp-swap" v-bind="panelMotionHooks"
      ><p v-if="error" :key="error" role="alert" class="studio-notice">
        {{ error }}<TpButton v-if="!binding" size="sm" @click="loadCurrent">重试绑定读取</TpButton>
      </p></Transition
    >
    <p v-if="optionError" role="alert" class="studio-notice">{{ optionError }}<TpButton size="sm" @click="loadOptions">重试可绑定版本</TpButton></p>
    <p v-if="notice" role="status" class="tp-caption">{{ notice }}</p>
    <div class="screen-actions"><TpButton size="sm" :disabled="historyBusy" @click="loadHistory()">查看绑定历史</TpButton></div>
    <p v-if="historyError" role="alert" class="studio-notice">
      {{ historyError }}<TpButton size="sm" @click="loadHistory(history?.offset ?? 0)">重试绑定历史</TpButton>
    </p>
    <Transition name="tp-swap" v-bind="panelMotionHooks"
      ><section v-if="history" class="binding-history studio-stack" aria-label="来源绑定历史">
        <p v-if="!history.total" class="tp-caption">还没有已保存的来源绑定。</p>
        <template v-if="viewing"
          ><TpField v-slot="{ id }" label="历史绑定版本"
            ><TpSelect
              :id="id"
              :model-value="viewing.version"
              :options="history.items.map((item) => ({ value: item.version, label: `来源绑定 v${item.version}` }))"
              :disabled="historyBusy"
              @update:model-value="viewHistory"
          /></TpField>
          <p class="tp-caption">只读快照 · {{ viewing.created_at }}</p>
          <p>模板：{{ sourceLabel(viewing.template_parse_version_id) }}</p>
          <ul>
            <li v-for="id in viewing.requirement_parse_version_ids" :key="id">要求：{{ sourceLabel(id) }}</li>
          </ul></template
        >
        <div v-if="history.total > 20" class="screen-actions">
          <TpButton size="sm" :disabled="historyBusy || history.offset === 0" @click="loadHistory(Math.max(0, history.offset - 20))">上一页绑定</TpButton
          ><TpButton size="sm" :disabled="historyBusy || history.offset + history.items.length >= history.total" @click="loadHistory(history.offset + 20)"
            >下一页绑定</TpButton
          >
        </div>
      </section></Transition
    >
  </section>
</template>

<style scoped>
.binding-requirements {
  padding: 0;
  margin: 0;
  border: 0;
  display: grid;
  gap: 12px;
  min-width: 0;
}
.binding-requirements legend {
  margin-bottom: 12px;
}
.binding-requirements label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.binding-history {
  padding: 16px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  font-size: 13px;
  background: var(--tp-surface-sunken);
}
</style>
