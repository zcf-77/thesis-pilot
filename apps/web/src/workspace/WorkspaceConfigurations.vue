<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import ConfigChain from "@/components/domain/ConfigChain.vue";
import type { SelectOption } from "@/components/ui/selectControl";
import type { BackendServices, ProjectRead, JobRead } from "@/services";
import { asApiError } from "@/services/errors";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import ConfigurationContentForm from "./configurations/ConfigurationContentForm.vue";
import ConfigurationProbe from "./configurations/ConfigurationProbe.vue";
import { configChain, configHealth, healthStatus, type KnownVersion } from "./configurations/configurationChain";
import {
  blankContent,
  configurationChanges,
  configurationLibraries,
  contentError,
  printable,
  schemaValue,
  type ConfigurationContent,
  type ConfigurationLibrary,
} from "./configurations/configurationEditor";

const props = defineProps<{ services: BackendServices; project?: ProjectRead | null; kind: ConfigurationLibrary; focusId?: string }>();
const emit = defineEmits<{ openJob: [job: JobRead]; openKind: [kind: ConfigurationLibrary, id: string]; changed: [] }>();
type Config = Awaited<ReturnType<BackendServices["aiConfigs"]["get"]>>;
type Version = Awaited<ReturnType<BackendServices["aiConfigs"]["version"]>>;
type VersionPage = Awaited<ReturnType<BackendServices["aiConfigs"]["versions"]>>;
type References = Awaited<ReturnType<BackendServices["aiConfigs"]["references"]>>;
const query = ref("");
const enabledFilter = ref("all");
const entries = shallowRef<Config[]>([]);
const total = ref(0);
const offset = ref(0);
const listBusy = ref(false);
const listError = ref("");
const selected = shallowRef<Config>();
const detailBusy = ref(false);
const detailError = ref("");
const history = shallowRef<VersionPage>();
const viewing = shallowRef<Version>();
const comparison = shallowRef<Version>();
const references = shallowRef<References>();
const historyError = ref("");
const referenceError = ref("");
const versionBusy = ref(false);
const editorOpen = ref(false);
const editing = shallowRef<Config>();
const draftName = ref("");
const draft = ref<ConfigurationContent>(blankContent(props.kind));
const inputSchema = ref("{}");
const outputSchema = ref("{}");
const busy = ref(false);
const error = ref("");
const notice = ref("");
const mustReload = ref(false);
const unknownCreate = ref(false);
const copyOpen = ref(false);
const copyName = ref("");
const credential = ref<boolean>();
const credentialError = ref("");
const dependencyError = ref("");
const dependencyBusy = ref(false);
const dependencyVersions = shallowRef<{ config: Config; version: Version }[]>([]);
const dependencyComplete = computed(() => !dependencyBusy.value && !dependencyError.value);
const known = computed<KnownVersion[]>(() => dependencyVersions.value as unknown as KnownVersion[]);
const visibleEntries = computed(() => {
  const text = query.value.trim().toLowerCase();
  return entries.value.filter(
    (entry) =>
      (!text || `${entry.name} ${entry.content.description ?? ""}`.toLowerCase().includes(text)) &&
      (enabledFilter.value === "all" || entry.enabled === (enabledFilter.value === "enabled")),
  );
});
const filtering = computed(() => !!query.value.trim() || enabledFilter.value !== "all");
const health = (entry: Config) => configHealth(entry, known.value, dependencyComplete.value);
const chain = computed(() => {
  const config = selected.value;
  if (!config) return [];
  const shown = viewing.value && viewing.value.config_id === config.id ? viewing.value : config;
  return configChain({ name: shown.name, enabled: config.enabled, version: shown.version, content: shown.content }, known.value, dependencyComplete.value);
});
const credentialStatus = computed(
  () =>
    credentialError.value ||
    (credential.value === undefined
      ? "正在读取服务器凭据状态…"
      : credential.value
        ? "服务器凭据已配置。"
        : "服务器凭据缺失；真实调用会明确失败，可配置后重试。"),
);
const versionOptions = computed(() => {
  const versions = [...(history.value?.items ?? [])];
  if (viewing.value && !versions.some((item) => item.id === viewing.value!.id)) versions.unshift(viewing.value);
  if (comparison.value && !versions.some((item) => item.id === comparison.value!.id)) versions.push(comparison.value);
  return versions.map((item) => ({ value: item.version, label: `v${item.version} · ${item.name}` }));
});
const changes = computed(() =>
  viewing.value && comparison.value
    ? configurationChanges({ ...comparison.value.content, name: comparison.value.name }, { ...viewing.value.content, name: viewing.value.name })
    : [],
);
const fieldNames: Record<string, string> = {
  name: "配置名称",
  description: "说明",
  provider: "供应商",
  base_url: "官方接口地址",
  credential_ref: "服务器凭据别名",
  timeout_seconds: "超时秒数",
  max_retries: "显式重试预算",
  rate_limit_per_minute: "每分钟请求上限",
  api_version_id: "接口版本",
  model_code: "模型型号",
  capabilities: "模型能力",
  context_limit: "上下文保守上限",
  temperature: "温度",
  max_output_tokens: "最大输出 token",
  template: "提示词模板",
  variables: "声明变量",
  input_schema: "输入结构",
  output_schema: "输出结构",
  role: "智能体角色",
  instructions: "职责",
  model_version_id: "模型版本",
  prompt_version_id: "提示词版本",
  allowed_tools: "允许的操作",
};
const libraryName = (kind: string) => configurationLibraries.find((item) => item.value === kind)?.label ?? kind;
const taskLabels: Record<string, string> = { queued: "排队中", running: "执行中", succeeded: "已完成", failed: "失败", cancelled: "已取消" };
function dependencyOptions(kind: ConfigurationLibrary): SelectOption[] {
  const current = draft.value;
  const existing =
    current.kind === "model"
      ? current.api_version_id
      : current.kind === "agent"
        ? kind === "model"
          ? current.model_version_id
          : current.prompt_version_id
        : "";
  return [
    { value: "", label: `选择${libraryName(kind)}版本` },
    ...dependencyVersions.value
      .filter((item) => item.config.kind === kind)
      .map(({ config, version }) => ({
        value: version.id,
        label: `${version.name} · v${version.version}${config.enabled ? "" : "（已停用）"}`,
        disabled: !config.enabled && version.id !== existing,
      })),
  ];
}
function displayField(key: string, value: unknown) {
  if (key === "role" && typeof value === "string")
    return (
      (
        { general: "通用助手", literature: "文献助手", content: "内容助手", format: "格式助手", progress: "进度助手", review: "评审助手" } as Record<
          string,
          string
        >
      )[value] ?? value
    );
  if ((key === "capabilities" || key === "allowed_tools") && Array.isArray(value)) {
    const labels: Record<string, string> = {
      text: "文本",
      search: "检索",
      format: "格式",
      plan: "规划",
      review: "评审",
      read_context: "读取显式输入",
      return_suggestion: "返回建议",
    };
    return value.map((item) => labels[String(item)] ?? item).join("、");
  }
  if (["api_version_id", "model_version_id", "prompt_version_id"].includes(key)) {
    const entry = dependencyVersions.value.find((item) => item.version.id === value);
    return entry ? `${entry.version.name} · v${entry.version.version}` : printable(value);
  }
  return printable(value);
}
let listRequest: AbortController | undefined;
let detailRequest: AbortController | undefined;
let versionRequest: AbortController | undefined;
let mutationRequest: AbortController | undefined;
let dependencyRequest: AbortController | undefined;
let availabilityRequest: AbortController | undefined;
let referenceRequest: AbortController | undefined;

async function refreshReferences() {
  if (!selected.value) return;
  referenceRequest?.abort();
  const controller = new AbortController();
  referenceRequest = controller;
  referenceError.value = "";
  try {
    const result = await props.services.aiConfigs.references(selected.value.id, controller.signal);
    if (!controller.signal.aborted) references.value = result;
  } catch (problem) {
    if (!controller.signal.aborted) referenceError.value = asApiError(problem).message;
  }
}

async function openConfigReference(id: string) {
  referenceRequest?.abort();
  const controller = new AbortController();
  referenceRequest = controller;
  try {
    const config = await props.services.aiConfigs.get(id, controller.signal);
    if (controller.signal.aborted) return;
    referenceRequest = undefined;
    if (config.kind !== props.kind) emit("openKind", config.kind, config.id);
    else await inspect(config);
  } catch (problem) {
    if (!controller.signal.aborted) referenceError.value = asApiError(problem).message;
  }
}

async function focusConfig(id: string) {
  referenceRequest?.abort();
  const controller = new AbortController();
  referenceRequest = controller;
  try {
    const config = await props.services.aiConfigs.get(id, controller.signal);
    if (!controller.signal.aborted && config.kind === props.kind) await inspect(config);
  } catch (problem) {
    if (!controller.signal.aborted) detailError.value = asApiError(problem).message;
  }
}

async function openJobReference(id: string, projectId: string) {
  referenceRequest?.abort();
  const controller = new AbortController();
  referenceRequest = controller;
  try {
    const job = await props.services.jobs.get(id, controller.signal, projectId);
    if (!controller.signal.aborted) emit("openJob", job);
  } catch (problem) {
    if (!controller.signal.aborted) referenceError.value = asApiError(problem).message;
  }
}

async function load(nextOffset = offset.value) {
  listRequest?.abort();
  const controller = new AbortController();
  listRequest = controller;
  listBusy.value = true;
  listError.value = "";
  try {
    const page = await props.services.aiConfigs.list({ kind: props.kind, offset: nextOffset, limit: 20 }, controller.signal);
    if (controller.signal.aborted) return;
    entries.value = page.items;
    total.value = page.total;
    offset.value = page.offset;
  } catch (problem) {
    if (!controller.signal.aborted) listError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) listBusy.value = false;
  }
}

async function availability() {
  availabilityRequest?.abort();
  const controller = new AbortController();
  availabilityRequest = controller;
  credentialError.value = "";
  try {
    const result = await props.services.aiConfigs.availability(controller.signal);
    if (!controller.signal.aborted) credential.value = result.credential_configured;
  } catch (problem) {
    if (!controller.signal.aborted) credentialError.value = `凭据状态读取失败：${asApiError(problem).message}`;
  }
}

async function loadDependencies() {
  dependencyRequest?.abort();
  const controller = new AbortController();
  dependencyRequest = controller;
  dependencyBusy.value = true;
  dependencyError.value = "";
  const found: { config: Config; version: Version }[] = [];
  try {
    for (const kind of ["api", "model", "prompt"] as const) {
      let next = 0;
      do {
        const page = await props.services.aiConfigs.list({ kind, offset: next, limit: 100 }, controller.signal);
        if (controller.signal.aborted) return;
        for (const config of page.items) {
          let versionOffset = 0;
          do {
            const versions = await props.services.aiConfigs.versions(config.id, { offset: versionOffset, limit: 100 }, controller.signal);
            if (controller.signal.aborted) return;
            found.push(...versions.items.map((version) => ({ config, version })));
            versionOffset += versions.items.length;
            if (!versions.items.length || versionOffset >= versions.total) break;
          } while (!controller.signal.aborted);
        }
        next += page.items.length;
        if (!page.items.length || next >= page.total) break;
      } while (!controller.signal.aborted);
    }
    dependencyVersions.value = found;
  } catch (problem) {
    if (!controller.signal.aborted) {
      dependencyVersions.value = found;
      dependencyError.value = `关联版本仅部分读取：${asApiError(problem).message}`;
    }
  } finally {
    if (!controller.signal.aborted) dependencyBusy.value = false;
  }
}

async function inspect(config: Config) {
  referenceRequest?.abort();
  detailRequest?.abort();
  versionRequest?.abort();
  closeEditor(false);
  error.value = "";
  notice.value = "";
  mustReload.value = false;
  unknownCreate.value = false;
  const controller = new AbortController();
  detailRequest = controller;
  selected.value = config;
  viewing.value = undefined;
  comparison.value = undefined;
  history.value = undefined;
  references.value = undefined;
  detailBusy.value = true;
  detailError.value = "";
  historyError.value = "";
  referenceError.value = "";
  copyOpen.value = false;
  try {
    const latest = await props.services.aiConfigs.get(config.id, controller.signal);
    if (controller.signal.aborted) return;
    selected.value = latest;
    const results = await Promise.allSettled([
      props.services.aiConfigs.versions(latest.id, { limit: 20, offset: 0 }, controller.signal),
      props.services.aiConfigs.references(latest.id, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    if (results[0].status === "fulfilled") {
      history.value = results[0].value;
      viewing.value = results[0].value.items.find((item) => item.version === latest.version) ?? results[0].value.items[0];
      comparison.value = results[0].value.items.at(-1);
    } else historyError.value = asApiError(results[0].reason).message;
    if (results[1].status === "fulfilled") references.value = results[1].value;
    else referenceError.value = asApiError(results[1].reason).message;
  } catch (problem) {
    if (!controller.signal.aborted) detailError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) detailBusy.value = false;
  }
}

async function loadVersions(nextOffset: number) {
  if (!selected.value) return;
  versionRequest?.abort();
  const controller = new AbortController();
  versionRequest = controller;
  versionBusy.value = true;
  historyError.value = "";
  try {
    const page = await props.services.aiConfigs.versions(selected.value.id, { offset: nextOffset, limit: 20 }, controller.signal);
    if (!controller.signal.aborted) history.value = page;
  } catch (problem) {
    if (!controller.signal.aborted) historyError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) versionBusy.value = false;
  }
}

async function viewVersion(number: number, compare = false) {
  if (!selected.value) return;
  versionRequest?.abort();
  const controller = new AbortController();
  versionRequest = controller;
  versionBusy.value = true;
  historyError.value = "";
  try {
    const result = await props.services.aiConfigs.version(selected.value.id, number, controller.signal);
    if (!controller.signal.aborted) {
      if (compare) comparison.value = result;
      else viewing.value = result;
    }
  } catch (problem) {
    if (!controller.signal.aborted) historyError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) versionBusy.value = false;
  }
}

function edit(config?: Config) {
  mutationRequest?.abort();
  busy.value = false;
  editing.value = config;
  draftName.value = config?.name ?? "";
  draft.value = config ? ({ ...blankContent(config.kind), ...JSON.parse(JSON.stringify(config.content)) } as ConfigurationContent) : blankContent(props.kind);
  inputSchema.value = "input_schema" in draft.value ? JSON.stringify(draft.value.input_schema, null, 2) : "{}";
  outputSchema.value = "output_schema" in draft.value ? JSON.stringify(draft.value.output_schema, null, 2) : "{}";
  error.value = "";
  notice.value = "";
  mustReload.value = false;
  unknownCreate.value = false;
  editorOpen.value = true;
  copyOpen.value = false;
  void loadDependencies();
}
function closeEditor(cancel: boolean | Event = true) {
  if (cancel !== false) mutationRequest?.abort();
  busy.value = false;
  editorOpen.value = false;
  copyOpen.value = false;
  editing.value = undefined;
}

async function save() {
  if (busy.value || mustReload.value || unknownCreate.value) return;
  error.value = "";
  notice.value = "";
  if (!draftName.value.trim() || Array.from(draftName.value.trim()).length > 200) {
    error.value = "请输入 1 至 200 个字符的配置名称。";
    return;
  }
  try {
    if (draft.value.kind === "prompt" || draft.value.kind === "agent") {
      draft.value.input_schema = schemaValue(inputSchema.value);
      draft.value.output_schema = schemaValue(outputSchema.value);
    }
  } catch (problem) {
    error.value = (problem as Error).message;
    return;
  }
  error.value = contentError(draft.value);
  if (error.value) return;
  const controller = new AbortController();
  mutationRequest = controller;
  busy.value = true;
  try {
    const content = JSON.parse(JSON.stringify(draft.value)) as ConfigurationContent;
    const config = editing.value
      ? await props.services.aiConfigs.update(
          editing.value.id,
          { expected_version: editing.value.version, name: draftName.value.trim(), content },
          controller.signal,
        )
      : await props.services.aiConfigs.create({ name: draftName.value.trim(), content }, controller.signal);
    if (controller.signal.aborted) return;
    closeEditor(false);
    await load(0);
    if (controller.signal.aborted) return;
    void inspect(config);
    void loadDependencies();
    notice.value = `已保存不可变版本 v${config.version}，已有引用保留原版本。`;
    emit("changed");
  } catch (problem) {
    mutationError(problem, controller, !!editing.value);
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

function mutationError(problem: unknown, controller: AbortController, existing: boolean) {
  if (controller.signal.aborted) return;
  const issue = asApiError(problem);
  const unknown = issue.status === undefined || issue.status >= 500 || issue.code === "INVALID_RESPONSE";
  mustReload.value = existing && (unknown || issue.status === 409);
  unknownCreate.value = !existing && unknown;
  error.value = mustReload.value
    ? `${issue.message} 输入已保留，请先载入最新配置后重新编辑。`
    : unknownCreate.value
      ? "创建结果尚未确认，输入已保留。请刷新并核对配置列表，再决定是否重试。"
      : issue.message;
}

async function reload() {
  const id = editing.value?.id ?? selected.value?.id;
  if (!id || busy.value) return;
  mutationRequest?.abort();
  const controller = new AbortController();
  mutationRequest = controller;
  busy.value = true;
  try {
    const latest = await props.services.aiConfigs.get(id, controller.signal);
    if (!controller.signal.aborted) {
      selected.value = latest;
      edit(latest);
      notice.value = "已载入最新配置，请重新检查并编辑。";
    }
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

async function toggle() {
  if (!selected.value || busy.value || mustReload.value) return;
  const controller = new AbortController();
  mutationRequest = controller;
  busy.value = true;
  error.value = "";
  try {
    const updated = await props.services.aiConfigs.update(
      selected.value.id,
      { expected_version: selected.value.version, enabled: !selected.value.enabled },
      controller.signal,
    );
    if (!controller.signal.aborted) {
      await load();
      if (controller.signal.aborted) return;
      void inspect(updated);
      void loadDependencies();
      notice.value = updated.enabled ? "配置已启用。" : "配置已停用，新建引用与试跑会重新检查整个配置链。";
      emit("changed");
    }
  } catch (problem) {
    mutationError(problem, controller, true);
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

async function copy() {
  if (!selected.value || !viewing.value || busy.value || unknownCreate.value) return;
  if (!copyName.value.trim() || Array.from(copyName.value.trim()).length > 200) {
    error.value = "请输入 1 至 200 个字符的副本名称。";
    return;
  }
  const controller = new AbortController();
  mutationRequest = controller;
  busy.value = true;
  error.value = "";
  try {
    const created = await props.services.aiConfigs.copy(
      selected.value.id,
      { name: copyName.value.trim(), source_version: viewing.value.version },
      controller.signal,
    );
    if (!controller.signal.aborted) {
      copyOpen.value = false;
      await load(0);
      if (controller.signal.aborted) return;
      void inspect(created);
      void loadDependencies();
      notice.value = "已从所选版本创建独立副本。";
      emit("changed");
    }
  } catch (problem) {
    mutationError(problem, controller, false);
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

watch(
  () => props.kind,
  () => {
    query.value = "";
    enabledFilter.value = "all";
    entries.value = [];
    total.value = 0;
    referenceRequest?.abort();
    detailRequest?.abort();
    versionRequest?.abort();
    closeEditor();
    selected.value = undefined;
    viewing.value = undefined;
    error.value = "";
    notice.value = "";
    mustReload.value = false;
    unknownCreate.value = false;
    void load(0);
  },
);
watch(
  () => props.focusId,
  (id) => {
    if (id) void focusConfig(id);
  },
);
onMounted(() => {
  void load(0);
  if (props.focusId) void focusConfig(props.focusId);
  void availability();
  void loadDependencies();
});
onScopeDispose(() => {
  referenceRequest?.abort();
  listRequest?.abort();
  detailRequest?.abort();
  versionRequest?.abort();
  mutationRequest?.abort();
  dependencyRequest?.abort();
  availabilityRequest?.abort();
});
</script>

<template>
  <div class="cfg-stack">
    <div class="cfg-toolbar">
      <div class="cfg-search">
        <input v-model="query" class="tp-input" type="search" aria-label="搜索配置" placeholder="搜索名称或说明" />
        <TpSelect
          v-model="enabledFilter"
          class="cfg-filter"
          aria-label="配置启停筛选"
          :options="[
            { value: 'all', label: '全部状态' },
            { value: 'enabled', label: '已启用' },
            { value: 'disabled', label: '已停用' },
          ]"
        />
      </div>
      <TpButton variant="primary" :disabled="busy" @click="edit()">新增{{ libraryName(kind) }}</TpButton>
    </div>
    <div class="cfg-layout">
      <section class="screen-panel cfg-list" aria-label="配置列表" :aria-busy="listBusy || undefined">
        <div class="cfg-list__head">
          <h2 class="tp-heading">{{ libraryName(kind) }}库</h2>
          <span class="tp-label">{{ filtering ? `${visibleEntries.length} / ${entries.length}` : total }} 项</span>
          <TpButton size="sm" variant="ghost" :disabled="listBusy" @click="load()">刷新列表</TpButton>
        </div>
        <p v-if="listBusy" role="status" class="tp-caption cfg-pad">正在读取配置…</p>
        <TpState v-if="listError && !entries.length" kind="error" title="配置读取失败" :desc="listError" retryable @retry="load()" />
        <TpState v-else-if="!listBusy && !entries.length" kind="empty" title="还没有配置" desc="先建立接口，再创建模型、提示词与智能体。" />
        <TpState v-else-if="!listBusy && !visibleEntries.length" kind="empty" title="没有匹配的配置"
          ><TpButton
            size="sm"
            @click="
              query = '';
              enabledFilter = 'all';
            "
            >清除筛选</TpButton
          ></TpState
        >
        <TransitionGroup tag="ul" name="tp-list" v-bind="listMotionHooks" class="cfg-items tp-list-group"
          ><li v-for="config in visibleEntries" :key="config.id">
            <button
              type="button"
              class="cfg-entry"
              :class="{ 'is-selected': selected?.id === config.id }"
              :disabled="busy"
              :aria-label="config.name"
              :aria-pressed="selected?.id === config.id"
              @click="inspect(config)"
            >
              <span class="cfg-entry__text"><b>{{ config.name }}</b><small>{{ config.content.description || "尚未填写说明" }}</small></span
              ><span class="cfg-entry__meta"
                ><span class="tp-mono">v{{ config.version }}</span><TpStatus v-bind="healthStatus[health(config)]" size="sm"
              /></span>
            </button></li
        ></TransitionGroup>
        <p v-if="listError && entries.length" role="alert" class="studio-notice cfg-pad">{{ listError }}</p>
        <div v-if="total > 20" class="screen-actions cfg-pad">
          <TpButton size="sm" :disabled="listBusy || offset === 0" @click="load(Math.max(0, offset - 20))">上一页配置</TpButton
          ><TpButton size="sm" :disabled="listBusy || offset + entries.length >= total" @click="load(offset + 20)">下一页配置</TpButton>
        </div>
      </section>
      <div class="cfg-main">
        <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="notice" :key="notice" role="status" class="studio-notice">{{ notice }}</p></Transition>
        <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="error" :key="error" role="alert" class="studio-notice">{{ error }}</p></Transition>
        <div v-if="unknownCreate" class="screen-actions">
          <TpButton :disabled="listBusy" @click="load(0)">刷新并核对列表</TpButton
          ><TpButton
            :disabled="listBusy || !!listError"
            @click="
              unknownCreate = false;
              error = '';
            "
            >已核对，继续创建</TpButton
          >
        </div>
        <div v-if="mustReload" class="screen-actions"><TpButton :disabled="busy" @click="reload">载入最新配置</TpButton></div>
        <Transition name="tp-swap" v-bind="panelMotionHooks"
          ><section v-if="editorOpen" class="screen-panel cfg-panel" aria-label="配置编辑" @keydown.esc.stop="closeEditor">
            <div class="cfg-row">
              <div>
                <p class="tp-label">{{ editing ? "修订配置" : "新增配置" }}</p>
                <h2 class="tp-heading">{{ editing ? "编辑当前版本" : `新增${libraryName(kind)}` }}</h2>
              </div>
              <TpStatus label="未保存" tone="warning" />
            </div>
            <p v-if="editing" class="tp-caption">基于 v{{ editing.version }}，保存后生成新的不可变版本。</p>
            <form class="cfg-stack" @submit.prevent="save">
              <TpField v-slot="{ id }" label="配置名称" required
                ><input :id="id" v-model="draftName" class="tp-input" maxlength="200" :readonly="busy" required
              /></TpField>
              <ConfigurationContentForm
                v-model="draft"
                v-model:input-schema="inputSchema"
                v-model:output-schema="outputSchema"
                :disabled="busy"
                :api-versions="dependencyOptions('api')"
                :model-versions="dependencyOptions('model')"
                :prompt-versions="dependencyOptions('prompt')"
                :credential-status="credentialStatus"
              />
              <p v-if="dependencyBusy" class="tp-caption" role="status">正在读取可关联版本…</p>
              <p v-if="dependencyError" class="studio-notice" role="alert">
                {{ dependencyError }}<TpButton size="sm" @click="loadDependencies">重试关联版本</TpButton>
              </p>
              <div class="screen-actions">
                <TpButton type="submit" variant="primary" :loading="busy" :disabled="busy || mustReload || unknownCreate || dependencyBusy">{{
                  editing ? "保存配置新版本" : "创建配置"
                }}</TpButton
                ><TpButton variant="ghost" @click="closeEditor">取消</TpButton>
              </div>
            </form>
          </section></Transition
        >
        <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
          ><section v-if="selected" :key="selected.id" class="cfg-main" aria-label="配置详情" :aria-busy="detailBusy || undefined">
            <div class="screen-panel cfg-panel">
              <div class="cfg-row">
                <div>
                  <p class="tp-label">{{ libraryName(selected.kind) }} · 当前 v{{ selected.version }}</p>
                  <h2 class="tp-heading">{{ selected.name }}</h2>
                  <p v-if="selected.content.description" class="tp-caption">{{ selected.content.description }}</p>
                </div>
                <TpStatus v-bind="healthStatus[health(selected)]" />
              </div>
              <div class="screen-actions">
                <TpButton size="sm" :disabled="detailBusy || busy" @click="edit(selected)">编辑当前版本</TpButton
                ><TpButton
                  size="sm"
                  variant="ghost"
                  :disabled="detailBusy || busy || !viewing"
                  @click="
                    copyOpen = true;
                    copyName = `${viewing?.name} · 副本`;
                    error = '';
                    unknownCreate = false;
                  "
                  >复制所选版本</TpButton
                ><TpButton size="sm" variant="ghost" :disabled="detailBusy || busy || mustReload" @click="toggle">{{
                  selected.enabled ? "停用配置" : "启用配置"
                }}</TpButton>
              </div>
              <p v-if="detailBusy" role="status" class="tp-caption">正在读取版本与关联…</p>
              <TpState v-if="detailError" kind="error" title="详情读取失败" :desc="detailError" retryable @retry="inspect(selected)" />
              <Transition name="tp-swap" v-bind="panelMotionHooks"
                ><form v-if="copyOpen" class="cfg-copy cfg-stack" aria-label="复制配置" @submit.prevent="copy" @keydown.esc.stop="closeEditor">
                  <TpField v-slot="{ id }" label="副本名称"><input :id="id" v-model="copyName" class="tp-input" :readonly="busy" maxlength="200" /></TpField>
                  <p class="tp-caption">复制 v{{ viewing?.version }} 的内容与明确版本引用，副本从 v1 开始。</p>
                  <div class="screen-actions">
                    <TpButton type="submit" :loading="busy" :disabled="busy || unknownCreate">创建独立副本</TpButton
                    ><TpButton variant="ghost" @click="closeEditor">取消复制</TpButton>
                  </div>
                </form></Transition
              >
              <ConfigChain v-if="viewing" class="cfg-chain" :nodes="chain" />
              <p v-if="dependencyError" class="tp-caption" role="status">关联链可能不完整：{{ dependencyError }}</p>
              <section v-if="viewing" class="cfg-content">
                <h3 class="tp-heading">v{{ viewing.version }} 内容（只读）</h3>
                <dl>
                  <template v-for="(value, key) in viewing.content" :key="key"
                    ><template v-if="key !== 'kind'"
                      ><dt>{{ fieldNames[key] ?? key }}</dt>
                      <dd><pre>{{ displayField(key, value) }}</pre></dd></template
                    ></template
                  >
                </dl>
              </section>
              <section class="cfg-stack cfg-refs" aria-label="关联使用">
                <div class="cfg-row">
                  <h3 class="tp-heading">关联使用</h3>
                  <TpButton size="sm" variant="ghost" :disabled="detailBusy" @click="refreshReferences">刷新关联</TpButton>
                </div>
                <p v-if="referenceError" role="alert" class="studio-notice">关联暂不可读：{{ referenceError }}</p>
                <template v-if="references"
                  ><p v-if="!references.configs.length && !references.jobs.length" class="tp-caption">还没有配置或任务引用此配置的版本。</p>
                  <p v-if="references.configs_truncated || references.jobs_truncated" class="studio-notice" role="status">
                    仅显示部分引用，不能据此判断全部使用情况；可打开关联配置或任务中心继续核查。
                  </p>
                  <ul class="cfg-reflist">
                    <li v-for="item in references.configs" :key="item.version_id">
                      <span
                        >{{ libraryName(item.kind) }} · {{ item.name }} v{{ item.version }} · {{ item.current ? "当前版本" : "历史版本" }} ·
                        {{ item.enabled ? "启用中" : "已停用" }}</span
                      >
                      <TpButton size="sm" variant="ghost" @click="openConfigReference(item.config_id)">查看关联配置</TpButton>
                    </li>
                    <li v-for="item in references.jobs" :key="item.job_id">
                      <span>执行任务 {{ item.job_id }} · {{ taskLabels[item.status] ?? item.status }} · 项目 {{ item.project_id }}</span
                      ><TpButton size="sm" variant="ghost" @click="openJobReference(item.job_id, item.project_id)">查看关联任务</TpButton>
                    </li>
                  </ul></template
                >
              </section>
            </div>
            <ConfigurationProbe
              v-if="viewing"
              :key="viewing.id"
              :services="services"
              :project="project ?? undefined"
              :config-version-id="viewing.id"
              :config-name="`${viewing.name} · v${viewing.version}`"
              :kind="selected.kind"
              :enabled="selected.enabled"
              @open-job="emit('openJob', $event)"
            />
            <div v-if="viewing || historyError" class="screen-panel cfg-panel">
              <div class="cfg-row">
                <div>
                  <p class="tp-label">Version history</p>
                  <h2 class="tp-heading">配置版本</h2>
                </div>
              </div>
              <p v-if="historyError" role="alert" class="studio-notice">
                版本读取失败：{{ historyError }}<TpButton size="sm" @click="loadVersions(history?.offset ?? 0)">重试版本</TpButton>
              </p>
              <template v-if="viewing"
                ><div class="cfg-versions">
                  <TpField v-slot="{ id }" label="查看配置版本"
                    ><TpSelect
                      :id="id"
                      :model-value="viewing.version"
                      :options="versionOptions"
                      :disabled="versionBusy"
                      @update:model-value="viewVersion($event)" /></TpField
                  ><TpField v-slot="{ id }" label="比较基准版本"
                    ><TpSelect
                      :id="id"
                      :model-value="comparison?.version"
                      :options="versionOptions"
                      :disabled="versionBusy"
                      @update:model-value="viewVersion($event, true)"
                  /></TpField>
                </div>
                <p v-if="versionBusy" role="status" class="tp-caption">正在读取版本…</p>
                <div v-if="history && history.total > 20" class="screen-actions">
                  <TpButton size="sm" :disabled="versionBusy || history.offset === 0" @click="loadVersions(Math.max(0, history.offset - 20))"
                    >上一页版本</TpButton
                  ><TpButton
                    size="sm"
                    :disabled="versionBusy || history.offset + history.items.length >= history.total"
                    @click="loadVersions(history.offset + 20)"
                    >下一页版本</TpButton
                  >
                </div>
                <section v-if="comparison" class="cfg-stack" aria-label="版本比较">
                  <h3 class="tp-heading">v{{ comparison.version }} → v{{ viewing.version }} 变化</h3>
                  <p v-if="!changes.length" class="tp-caption">所选版本的名称与配置内容一致。启用状态以当前配置为准。</p>
                  <TransitionGroup name="tp-list" tag="div" class="cfg-stack tp-list-group" v-bind="listMotionHooks"
                    ><article v-for="change in changes" :key="`${comparison.version}:${viewing.version}:${change.key}`" class="cfg-change">
                      <h4>{{ fieldNames[change.key] ?? change.key }}</h4>
                      <div class="cfg-compare">
                        <div>
                          <span class="tp-caption">基准版本</span>
                          <pre>{{ displayField(change.key, change.before) }}</pre>
                        </div>
                        <div>
                          <span class="tp-caption">查看版本</span>
                          <pre>{{ displayField(change.key, change.after) }}</pre>
                        </div>
                      </div>
                    </article></TransitionGroup
                  >
                </section>
              </template>
            </div>
          </section></Transition
        >
        <TpState v-if="!selected && !editorOpen" class="screen-panel" kind="empty" title="选择一个配置" desc="查看版本、比较修改、检查关联并发起配置试跑。" />
      </div>
    </div>
    <p class="tp-caption">
      凭据状态：{{ credentialStatus }} <TpButton v-if="credentialError" size="sm" variant="ghost" @click="availability">重新读取凭据状态</TpButton>
    </p>
  </div>
</template>

<style scoped>
.cfg-stack {
  grid-template-columns: minmax(0, 1fr);
  display: grid;
  gap: 14px;
  min-width: 0;
}
.cfg-toolbar,
.cfg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.cfg-row {
  align-items: flex-start;
}
.cfg-search {
  display: flex;
  gap: 10px;
}
.cfg-search input {
  width: min(320px, 40vw);
}
.cfg-search .cfg-filter {
  width: 128px;
}
.cfg-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.cfg-main {
  grid-template-columns: minmax(0, 1fr);
  display: grid;
  gap: 16px;
  min-width: 0;
}
.cfg-list {
  overflow: hidden;
}
.cfg-list__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--tp-line);
}
.cfg-list__head h2 {
  margin-right: auto;
}
.cfg-pad {
  padding: 10px 14px;
}
.cfg-items {
  padding: 0;
  margin: 0;
  list-style: none;
}
.cfg-entry {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 0;
  border-bottom: 1px solid var(--tp-line);
  text-align: left;
  background: transparent;
  color: var(--tp-text);
  cursor: pointer;
}
.cfg-items li:last-child .cfg-entry {
  border-bottom: 0;
}
.cfg-entry:hover {
  background: var(--tp-surface-sunken);
}
.cfg-entry.is-selected {
  background: var(--tp-accent-soft);
  box-shadow: inset 3px 0 var(--tp-accent);
}
.cfg-entry:disabled {
  opacity: 0.6;
  cursor: wait;
}
.cfg-entry__text {
  min-width: 0;
}
.cfg-entry b {
  display: block;
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.cfg-entry small {
  display: block;
  margin-top: 4px;
  color: var(--tp-text-muted);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.cfg-entry__meta {
  display: grid;
  justify-items: end;
  gap: 6px;
  font-size: 11px;
  flex-shrink: 0;
}
.cfg-panel {
  grid-template-columns: minmax(0, 1fr);
  display: grid;
  gap: 14px;
  padding: 18px;
  min-width: 0;
}
.cfg-chain {
  grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
  gap: 12px;
}
.cfg-chain :deep(.tp-chain__node) {
  min-width: 0;
}
.cfg-chain :deep(.tp-chain__node::after) {
  display: none;
}
.cfg-versions,
.cfg-compare {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.cfg-content h3 {
  font-size: 14px;
  font-weight: 600;
  padding-block: 4px;
}
.cfg-content dl {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 10px;
  margin: 10px 0 0;
  font-size: 13px;
}
.cfg-content dt {
  color: var(--tp-text-muted);
}
.cfg-content dd {
  margin: 0;
  min-width: 0;
}
pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  font-family: var(--tp-font-mono);
}
.cfg-change,
.cfg-copy {
  padding: 12px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
}
.cfg-change h4 {
  font-size: 13px;
  margin: 0 0 8px;
}
.cfg-refs {
  padding-top: 14px;
  border-top: 1px solid var(--tp-line);
}
.cfg-reflist {
  display: grid;
  padding: 0;
  margin: 0;
  list-style: none;
}
.cfg-reflist li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-block: 6px;
  border-bottom: 1px solid var(--tp-line);
  font-size: 13px;
  overflow-wrap: anywhere;
}
@media (max-width: 900px) {
  .cfg-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .cfg-list {
    max-height: 360px;
    overflow-y: auto;
  }
}
@media (max-width: 600px) {
  .cfg-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .cfg-search input {
    width: 100%;
    min-width: 0;
  }
  .cfg-search .cfg-filter {
    width: 116px;
    flex-shrink: 0;
  }
  .cfg-panel {
    padding: 14px;
  }
  .cfg-versions,
  .cfg-compare {
    grid-template-columns: 1fr;
  }
  .cfg-content dl {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .cfg-reflist li {
    flex-wrap: wrap;
  }
}
</style>
