<script setup lang="ts">
import { listMotionHooks } from "@/design/motion";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { PhArrowRight, PhCheck, PhCopy, PhGearSix, PhPlus, PhSlidersHorizontal, PhStack, PhTestTube } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpTabs from "@/components/ui/TpTabs.vue";
import ConfigChain from "@/components/domain/ConfigChain.vue";
import type { ConfigNodeView } from "@/domain/types";
import { usePreviewWorkspaceStore } from "../state/previewWorkspace";
import { startProjectJob, type PreviewJob } from "../state/jobState";
import {
  allowedTools,
  capabilities,
  libraryNames,
  blankConfig,
  cancelConfigRun,
  configChain,
  configProblems,
  contentOf,
  finishConfigRun,
  referencedBy,
  saveConfig,
  saveStages,
  startConfigRun,
  toggleConfig,
  useSettingsState,
  workflowBindingStage,
  type ConfigContent,
  type ConfigEntry,
  type ConfigLibrary,
  type ConfigRun,
  type RunScenario,
  type WorkflowStage,
} from "../state/settingsState";

type Tab = ConfigLibrary | "workflow" | "system" | "runs";
const workspace = usePreviewWorkspaceStore();
const state = useSettingsState();
const route = useRoute();
const tab = ref<Tab>("agent");
const selectedId = ref("agent-general");
const query = ref("");
const enabledFilter = ref("all");
const tabs: { value: Tab; label: string }[] = [
  { value: "agent", label: "智能体" },
  { value: "prompt", label: "提示词" },
  { value: "api", label: "AI 接口" },
  { value: "model", label: "模型" },
  { value: "workflow", label: "阶段流程" },
  { value: "system", label: "业务设置" },
  { value: "runs", label: "运行记录" },
];
watch(
  () => [route.path, route.query.tab],
  ([path, target]) => {
    if (path === "/screens/settings" && typeof target === "string" && tabs.some((item) => item.value === target)) tab.value = target as Tab;
  },
  { immediate: true },
);
const isLibrary = computed(() => ["agent", "prompt", "api", "model"].includes(tab.value));
const lib = computed(() => tab.value as ConfigLibrary);
const entries = computed(() =>
  state.value.entries.filter(
    (e) =>
      e.lib === lib.value &&
      (!query.value || (e.name + e.description).includes(query.value)) &&
      (enabledFilter.value === "all" || e.enabled === (enabledFilter.value === "enabled")),
  ),
);
const selected = computed(() => state.value.entries.find((e) => e.id === selectedId.value && e.lib === lib.value) ?? entries.value[0]);
const dependencies = computed(() => (selected.value ? configChain(state.value, selected.value) : []));
const nodes = computed<ConfigNodeView[]>(() =>
  dependencies.value.map((e) => {
    const problems = configProblems(state.value, e);
    return { lib: e.lib, name: e.name, version: e.version, state: !e.enabled ? "disabled" : problems.length ? "invalid" : "active", problem: problems[0] };
  }),
);
const problems = computed(() => (selected.value ? configProblems(state.value, selected.value) : []));
const references = computed(() => (selected.value ? referencedBy(state.value, selected.value.id) : []));
function containsConfig(value: unknown, id: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsConfig(item, id));
  const row = value as Record<string, unknown>;
  return row.id === id || Object.values(row).some((item) => containsConfig(item, id));
}
const usedJobs = computed(() => {
  const jobs = (workspace.current.modules.jobs as { jobs?: PreviewJob[] } | undefined)?.jobs ?? [];
  return selected.value ? jobs.filter((job) => containsConfig(job.snapshot, selected.value!.id)) : [];
});
const usedRuns = computed(() => (selected.value ? state.value.runs.filter((run) => run.snapshot.some((node) => node.id === selected.value!.id)) : []));
const historyVersion = ref(1);
const revision = computed(() => selected.value?.history.find((h) => h.version === historyVersion.value));
const changes = computed(() =>
  selected.value && revision.value
    ? Object.keys(revision.value.content).filter(
        (key) => JSON.stringify(revision.value!.content[key as keyof ConfigContent]) !== JSON.stringify(selected.value![key as keyof ConfigContent]),
      )
    : [],
);
const notices = ref("");
const draft = ref<ConfigContent | null>(null);
const editingId = ref("");
const variablesText = ref("");
const errors = ref<string[]>([]);
const formRoot = ref<HTMLElement>();
let draftFocusOrigin: Element | null = null;
let draftFocusPending = false;
function focusDraftAfterEnter(element: Element) {
  if (!draftFocusPending || element !== formRoot.value || !draft.value) return;
  draftFocusPending = false;
  if (document.activeElement === draftFocusOrigin || document.activeElement === document.body) {
    formRoot.value?.querySelector<HTMLInputElement>("input")?.focus();
  }
}
watch(tab, () => {
  draft.value = null;
  errors.value = [];
  query.value = "";
  enabledFilter.value = "all";
  selectedId.value = state.value.entries.find((e) => e.lib === lib.value)?.id ?? "";
});
watch(selected, (e) => {
  historyVersion.value = e?.history[0]?.version ?? 1;
  errors.value = [];
});

function selectEntry(entry: ConfigEntry) {
  tab.value = entry.lib;
  void nextTick(() => {
    selectedId.value = entry.id;
    draft.value = null;
  });
}
function editEntry(entry?: ConfigEntry, copy = false) {
  draftFocusOrigin = document.activeElement;
  draftFocusPending = true;
  editingId.value = copy ? "" : (entry?.id ?? "");
  draft.value = entry ? contentOf(entry) : blankConfig();
  if (copy && draft.value) draft.value.name += " · 副本";
  if (!entry && draft.value) {
    draft.value.apiId = state.value.entries.find((e) => e.lib === "api" && e.enabled)?.id ?? "";
    draft.value.modelId = state.value.entries.find((e) => e.lib === "model" && e.enabled)?.id ?? "";
    draft.value.promptId = state.value.entries.find((e) => e.lib === "prompt" && e.enabled)?.id ?? "";
    draft.value.promptVersion = state.value.entries.find((e) => e.id === draft.value!.promptId)?.version ?? 1;
  }
  variablesText.value = draft.value.variables.join(", ");
  errors.value = [];
  notices.value = "";
}
function submitConfig() {
  if (!draft.value) return;
  draft.value.variables = variablesText.value
    .split(/[,，]/)
    .map((v) => v.trim())
    .filter(Boolean);
  const result = saveConfig(state.value, lib.value, draft.value, editingId.value);
  errors.value = result.errors;
  if (result.entry) {
    selectedId.value = result.entry.id;
    draft.value = null;
    notices.value = `已保存 ${result.entry.name} v${result.entry.version}，历史运行仍使用原快照。`;
    workspace.recordEvent("配置已更新", `${result.entry.name} v${result.entry.version}`, "/screens/settings");
  }
}
function toggleSelected() {
  if (!selected.value) return;
  toggleConfig(selected.value);
  notices.value = `${selected.value.name} 已${selected.value.enabled ? "启用" : "停用"}；相关配置会重新检查有效性。`;
}
function entryLabel(id: string) {
  return state.value.entries.find((e) => e.id === id)?.name ?? "关联不存在";
}
const fieldNames: Record<string, string> = {
  name: "名称",
  enabled: "启停",
  description: "用途/职责",
  address: "地址",
  timeout: "超时",
  retries: "重试",
  rateLimit: "限流",
  apiId: "API 引用",
  modelCode: "模型标识",
  capabilities: "能力",
  contextLimit: "上下文",
  temperature: "温度",
  body: "提示词正文",
  variables: "变量",
  modelId: "模型引用",
  promptId: "提示词引用",
  promptVersion: "提示词版本",
  capability: "任务能力",
  tools: "工具",
  inputSchema: "输入结构",
  outputSchema: "输出结构",
  keyRef: "密钥引用",
  protocol: "协议",
};

const scenario = ref<RunScenario>("success");
const variables = reactive<Record<string, string>>({
  context: "自制章节样例",
  goal: "检查论述结构",
  requirements: "项目绑定的适用要求版本",
  materials: "仅使用学生选中的资料",
});
const prompt = computed(() => dependencies.value.find((e) => e.lib === "prompt"));
const promptPreview = computed(
  () => prompt.value?.body.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => variables[key.trim()] || `［缺少 ${key.trim()}］`) ?? "",
);
const timers = new Map<string, { timer: ReturnType<typeof setTimeout>; owner: typeof state.value }>();
const jobHandles = new Map<string, ReturnType<typeof startProjectJob>>();
const runSelected = ref("");
const viewedRun = computed(() => state.value.runs.find((r) => r.id === runSelected.value) ?? state.value.runs[0]);
function startRun(entry = selected.value, attempt = 1) {
  if (!entry) return;
  const owner = state.value;
  const runPrompt = configChain(owner, entry).find((e) => e.lib === "prompt");
  const supplied = Object.fromEntries((runPrompt?.variables ?? []).map((key) => [key, variables[key] ?? ""]));
  const result = startConfigRun(
    owner,
    entry,
    scenario.value,
    supplied,
    workspace.current.id,
    workspace.current.document.version,
    attempt,
    workspace.current.requirementVersion,
  );
  errors.value = result.errors;
  if (!result.run) return;
  runSelected.value = result.run.id;
  const id = result.run.id;
  const job = startProjectJob(
    workspace.current,
    {
      title: result.run.title,
      kind: "配置",
      route: "/screens/settings?tab=runs&run=" + id,
      input: `${entry.name} v${entry.version}`,
      sourceId: "config-" + entry.id,
      snapshot: { config: result.run.snapshot, runId: id },
    },
    {
      cancel: () => {
        cancelConfigRun(owner, id);
        const pending = timers.get(id);
        if (pending) clearTimeout(pending.timer);
        timers.delete(id);
      },
      retry: () => {
        if (workspace.current.id === result.run!.projectId) retryRun(result.run!);
      },
    },
  );
  jobHandles.set(id, job);
  timers.set(id, {
    owner,
    timer: setTimeout(() => {
      finishConfigRun(owner, id);
      const finished = owner.runs.find((run) => run.id === id);
      if (finished && finished.status !== "running" && finished.status !== "cancelled") job.finish(finished.status, finished.result);
      timers.delete(id);
    }, 1600),
  });
  notices.value = "模拟运行已开始；可在本页或任务托盘查看。";
}
function retryRun(run: ConfigRun) {
  const entry = state.value.entries.find((e) => e.id === run.entryId);
  if (!entry) {
    errors.value = ["原配置已不存在，无法重试。"];
    return;
  }
  scenario.value = run.scenario;
  startRun(entry, run.attempt + 1);
}
function cancelRun(run: ConfigRun) {
  jobHandles.get(run.id)?.cancel();
  cancelConfigRun(state.value, run.id);
  const pending = timers.get(run.id);
  if (pending) clearTimeout(pending.timer);
  timers.delete(run.id);
}
onBeforeUnmount(() => {
  for (const [id, pending] of timers) {
    clearTimeout(pending.timer);
    cancelConfigRun(pending.owner, id);
    jobHandles.get(id)?.cancel();
  }
});
watch(
  () => route.query.run,
  (id) => {
    if (typeof id === "string") {
      tab.value = "runs";
      runSelected.value = id;
    }
  },
  { immediate: true },
);

const stageDraft = ref<WorkflowStage | null>(null);
const stageErrors = ref<string[]>([]);
const selectedWorkflowVersion = ref(1);
const bindingVersion = ref(state.value.workflowVersion);
const bindingStages = computed(() => state.value.workflowHistory.find((item) => item.version === bindingVersion.value)?.stages ?? []);
const workflowSnapshot = computed(() => state.value.workflowHistory.find((h) => h.version === selectedWorkflowVersion.value));
const bindingChoice = ref("");
const bindingStageId = computed({
  get: () =>
    bindingChoice.value || workflowBindingStage(state.value, workspace.current.workflowVersion, workspace.current.stage, "", bindingVersion.value)?.id || "",
  set: (value) => {
    bindingChoice.value = value;
  },
});
function editStage(stage?: WorkflowStage) {
  stageDraft.value = stage
    ? { ...stage }
    : {
        id: crypto.randomUUID(),
        name: "",
        description: "",
        deliverables: "",
        condition: "",
        deadline: "",
        start: "",
        predecessorId: state.value.stages.at(-1)?.id ?? "",
        enabled: true,
      };
  stageErrors.value = [];
}
function commitStage() {
  if (!stageDraft.value) return;
  const next = state.value.stages.map((s) => (s.id === stageDraft.value!.id ? { ...stageDraft.value! } : { ...s }));
  if (!next.some((s) => s.id === stageDraft.value!.id)) next.push({ ...stageDraft.value });
  stageErrors.value = saveStages(state.value, next);
  if (!stageErrors.value.length) {
    stageDraft.value = null;
    bindingVersion.value = state.value.workflowVersion;
    notices.value = `流程 v${state.value.workflowVersion} 已保存。项目仍绑定 v${workspace.current.workflowVersion}。`;
  }
}
function toggleStage(stage: WorkflowStage) {
  const next = state.value.stages.map((s) => ({ ...s, enabled: s.id === stage.id ? !s.enabled : s.enabled }));
  stageErrors.value = saveStages(state.value, next);
  if (!stageErrors.value.length) bindingVersion.value = state.value.workflowVersion;
}
function moveStage(index: number, offset: number) {
  const next = state.value.stages.map((s) => ({ ...s }));
  const target = index + offset;
  if (target < 0 || target >= next.length) return;
  const a = next[index]!;
  next[index] = next[target]!;
  next[target] = a;
  stageErrors.value = saveStages(state.value, next);
  if (!stageErrors.value.length) bindingVersion.value = state.value.workflowVersion;
}
function bindWorkflow() {
  const next = workflowBindingStage(state.value, workspace.current.workflowVersion, workspace.current.stage, bindingStageId.value, bindingVersion.value);
  if (!next) {
    stageErrors.value = ["当前阶段在新流程中不存在或已停用。请先选择绑定后的当前阶段。"];
    return;
  }
  workspace.current.workflowVersion = bindingVersion.value;
  workspace.current.stage = next.name;
  stageErrors.value = [];
  bindingChoice.value = "";
  notices.value = `当前项目已绑定流程 v${bindingVersion.value}，当前阶段为「${next.name}」；未自动确认任何阶段完成。`;
  workspace.recordEvent("流程绑定已更新", `流程 v${bindingVersion.value} · ${next.name}`, "/screens/settings?tab=workflow");
}
const categoryDraft = ref("");
const categoryEditing = ref("");
const systemError = ref("");
const reminderDraft = reactive({ ...state.value.reminder });
function saveCategory() {
  const name = categoryDraft.value.trim();
  if (!name) {
    systemError.value = "请填写分类名称。";
    return;
  }
  if (state.value.categories.some((c) => c.name === name && c.id !== categoryEditing.value)) {
    systemError.value = "已有同名资料分类。";
    return;
  }
  const existing = state.value.categories.find((c) => c.id === categoryEditing.value);
  if (existing) existing.name = name;
  else state.value.categories.push({ id: crypto.randomUUID(), name, enabled: true, kind: "other" });
  state.value.systemVersion += 1;
  categoryDraft.value = "";
  categoryEditing.value = "";
  systemError.value = "";
}
function saveReminders() {
  if (
    !Number.isInteger(reminderDraft.cooldownHours) ||
    reminderDraft.cooldownHours < 1 ||
    reminderDraft.cooldownHours > 168 ||
    !Number.isInteger(reminderDraft.overdueDays) ||
    reminderDraft.overdueDays < 1 ||
    reminderDraft.overdueDays > 30
  ) {
    systemError.value = "冷却时间须为 1—168 小时，延期阈值须为 1—30 天。";
    return;
  }
  state.value.reminder = { ...reminderDraft };
  state.value.systemVersion += 1;
  systemError.value = "";
  notices.value = "提醒参数已保存为预览配置；不会创建真实定时任务。";
}
</script>

<template>
  <div class="screen-page settings-screen">
    <header class="screen-heading">
      <div>
        <p class="tp-label">Configuration · 有据可依，有迹可循</p>
        <h1 class="tp-display mt-3">配置台</h1>
        <p class="screen-lead">让助手知道边界，让每次运行都有一份可追溯的配置。</p>
      </div>
      <div class="settings-summary">
        <span class="tp-label">已启用配置</span><strong>{{ state.entries.filter((e) => e.enabled).length }}<small> / {{ state.entries.length }}</small></strong
        ><span>四库关联 · 版本独立保留</span>
      </div>
    </header>

    <div class="settings-intro">
      <TpIcon :icon="PhGearSix" :size="20" /><span>配置改变能力与调用方式。论文和计划的正式修改，始终需要学生审阅采纳。</span
      ><RouterLink to="/screens/jobs">执行任务 <TpIcon :icon="PhArrowRight" :size="14" /></RouterLink>
    </div>
    <div class="settings-tabs"><TpTabs v-model="tab" :tabs="tabs" label="配置台模块" /></div>
    <Transition name="tp-swap" mode="out-in">
      <p :key="notices" v-if="notices" class="settings-notice" role="status"><TpIcon :icon="PhCheck" :size="16" />{{ notices }}</p>
    </Transition>

    <Transition name="tp-swap" mode="out-in">
      <div class="settings-section-stack" :key="'library:' + tab" v-if="isLibrary">
        <div class="settings-toolbar">
          <div class="settings-search">
            <input v-model="query" class="tp-input" type="search" aria-label="搜索配置" placeholder="搜索名称或职责" /><TpSelect
              v-model="enabledFilter"
              class="settings-filter"
              aria-label="配置启停筛选"
              :options="[
                { value: 'all', label: '全部状态' },
                { value: 'enabled', label: '已启用' },
                { value: 'disabled', label: '已停用' },
              ]"
            />
          </div>
          <TpButton variant="primary" @click="editEntry()"><TpIcon :icon="PhPlus" :size="16" />新增{{ libraryNames[lib] }}</TpButton>
        </div>
        <div class="settings-layout">
          <section class="screen-panel settings-list" aria-label="配置清单">
            <div class="screen-panel__head">
              <h2 class="tp-heading">{{ libraryNames[lib] }}库</h2>
              <span class="tp-label">{{ entries.length }} 项</span>
            </div>
            <TransitionGroup name="tp-list" tag="div" class="tp-list-group" v-bind="listMotionHooks">
              <button
                v-for="entry in entries"
                :key="entry.id"
                class="settings-item"
                :class="{ 'is-selected': selected?.id === entry.id }"
                :aria-pressed="selected?.id === entry.id"
                @click="
                  selectedId = entry.id;
                  draft = null;
                "
              >
                <span><b>{{ entry.name }}</b><small>{{ entry.description || "尚未填写说明" }}</small></span
                ><span class="settings-item__meta"
                  ><span class="tp-mono">v{{ entry.version }}</span
                  ><TpStatus
                    :tone="!entry.enabled ? 'neutral' : configProblems(state, entry).length ? 'danger' : 'success'"
                    :label="!entry.enabled ? '停用' : configProblems(state, entry).length ? '关联无效' : '启用'"
                    size="sm"
                /></span>
              </button>
            </TransitionGroup>
            <Transition name="tp-swap">
              <div v-if="!entries.length" class="settings-empty">
                <TpIcon :icon="PhStack" :size="28" />
                <h3>没有匹配的配置</h3>
                <p>调整筛选，或创建这一库的第一项。</p>
                <TpButton
                  size="sm"
                  @click="
                    query = '';
                    enabledFilter = 'all';
                  "
                  >清除筛选</TpButton
                >
              </div>
            </Transition>
          </section>

          <div class="settings-main">
            <Transition name="tp-swap" mode="out-in" @after-enter="focusDraftAfterEnter">
              <form
                :key="'edit:' + (editingId || lib)"
                v-if="draft"
                ref="formRoot"
                class="screen-panel settings-form"
                @submit.prevent="submitConfig"
                @keydown.esc.prevent="
                  draft = null;
                  errors = [];
                "
              >
                <div class="settings-section-heading">
                  <div>
                    <p class="tp-label">{{ editingId ? "修订配置" : "新增配置" }}</p>
                    <h2>{{ editingId ? "保存为下一个版本" : "建立清晰的能力边界" }}</h2>
                  </div>
                  <TpStatus label="未保存" tone="warning" />
                </div>
                <div class="settings-form-grid">
                  <TpField v-slot="f" label="配置名称" required><input :id="f.id" v-model="draft.name" class="tp-input" maxlength="80" required /></TpField
                  ><TpField v-slot="f" label="用途与职责" :required="lib === 'agent'"
                    ><input :id="f.id" v-model="draft.description" class="tp-input" maxlength="200"
                  /></TpField>
                </div>
                <template v-if="lib === 'api'">
                  <div class="settings-form-grid">
                    <TpField v-slot="f" label="协议"
                      ><TpSelect
                        :id="f.id"
                        v-model="draft.protocol"
                        :options="[
                          { value: 'OpenAI compatible', label: 'OpenAI compatible' },
                          { value: '自定义 JSON（模拟）', label: '自定义 JSON（模拟）' },
                        ]" /></TpField
                    ><TpField v-slot="f" label="密钥引用" hint="仅接受 demo: 开头的虚构引用，不输入真实密钥。"
                      ><input :id="f.id" v-model="draft.keyRef" class="tp-input" autocomplete="off" :aria-describedby="f.describedby"
                    /></TpField>
                  </div>
                  <TpField v-slot="f" label="示例地址" hint="仅允许 example.invalid，不会向此地址发出请求。"
                    ><input :id="f.id" v-model="draft.address" class="tp-input" type="url" :aria-describedby="f.describedby"
                  /></TpField>
                  <div class="settings-form-grid settings-form-grid--three">
                    <TpField v-slot="f" label="超时（秒）"
                      ><input :id="f.id" v-model.number="draft.timeout" type="number" class="tp-input" min="1" max="300" /></TpField
                    ><TpField v-slot="f" label="最大重试次数"
                      ><input :id="f.id" v-model.number="draft.retries" type="number" class="tp-input" min="0" max="5" /></TpField
                    ><TpField v-slot="f" label="每分钟请求上限"
                      ><input :id="f.id" v-model.number="draft.rateLimit" type="number" class="tp-input" min="1" max="1000"
                    /></TpField>
                  </div>
                </template>
                <template v-if="lib === 'model'">
                  <div class="settings-form-grid">
                    <TpField v-slot="f" label="关联 API" required
                      ><TpSelect
                        :id="f.id"
                        v-model="draft.apiId"
                        :options="[
                          { value: '', label: '请选择' },
                          ...state.entries
                            .filter((e) => e.lib === 'api')
                            .map((api) => ({ value: api.id, label: api.name + (api.enabled ? '' : '（已停用）') })),
                        ]" /></TpField
                    ><TpField v-slot="f" label="服务商模型标识" required><input :id="f.id" v-model="draft.modelCode" class="tp-input" /></TpField>
                  </div>
                  <fieldset class="settings-checks">
                    <legend>模型能力（自制示例，尚未外部核验）</legend>
                    <label v-for="cap in capabilities" :key="cap"
                      ><input class="tp-checkbox" v-model="draft.capabilities" type="checkbox" :value="cap" />{{ cap }}</label
                    >
                  </fieldset>
                  <div class="settings-form-grid">
                    <TpField v-slot="f" label="上下文限制"
                      ><input :id="f.id" v-model.number="draft.contextLimit" class="tp-input" type="number" min="256" max="1000000" /></TpField
                    ><TpField v-slot="f" label="温度"
                      ><input :id="f.id" v-model.number="draft.temperature" class="tp-input" type="number" min="0" max="2" step="0.1"
                    /></TpField>
                  </div>
                </template>
                <template v-if="lib === 'prompt'">
                  <TpField v-slot="f" label="提示词正文" required hint="上下文和资料是数据，不能改变工具权限。">
                    <textarea :id="f.id" v-model="draft.body" class="tp-input settings-textarea" rows="5" :aria-describedby="f.describedby" />
                  </TpField>
                  <TpField v-slot="f" label="声明变量" hint="逗号分隔：context、goal、requirements、materials，须与正文占位符一致。"
                    ><input :id="f.id" v-model="variablesText" class="tp-input" :aria-describedby="f.describedby"
                  /></TpField>
                </template>
                <template v-if="lib === 'agent'">
                  <div class="settings-form-grid">
                    <TpField v-slot="f" label="关联模型" required
                      ><TpSelect
                        :id="f.id"
                        v-model="draft.modelId"
                        searchable
                        :options="[
                          { value: '', label: '请选择' },
                          ...state.entries
                            .filter((e) => e.lib === 'model')
                            .map((model) => ({ value: model.id, label: model.name + (model.enabled ? '' : '（已停用）') })),
                        ]" /></TpField
                    ><TpField v-slot="f" label="关联提示词" required
                      ><TpSelect
                        :id="f.id"
                        v-model="draft.promptId"
                        searchable
                        @change="draft.promptVersion = state.entries.find((item) => item.id === draft!.promptId)?.version ?? 1"
                        :options="[
                          { value: '', label: '请选择' },
                          ...state.entries
                            .filter((e) => e.lib === 'prompt')
                            .map((item) => ({ value: item.id, label: item.name + (item.enabled ? '' : '（已停用）') })),
                        ]"
                    /></TpField>
                    <TpField v-slot="f" label="绑定提示词版本" required hint="固定此版本；后续提示词更新不会自动改变智能体。">
                      <TpSelect
                        :id="f.id"
                        v-model.number="draft.promptVersion"
                        :options="
                          (state.entries.find((entry) => entry.id === draft!.promptId)?.history ?? []).map((item) => ({
                            value: item.version,
                            label: `v${item.version} · ${item.summary}`,
                          }))
                        "
                      />
                    </TpField>
                  </div>
                  <TpField v-slot="f" label="适用任务能力"
                    ><TpSelect :id="f.id" v-model="draft.capability" :options="capabilities.map((cap) => ({ value: cap, label: cap }))"
                  /></TpField>
                  <fieldset class="settings-checks">
                    <legend>允许使用的工具</legend>
                    <label v-for="tool in allowedTools" :key="tool"
                      ><input class="tp-checkbox" v-model="draft.tools" type="checkbox" :value="tool" />{{ tool }}</label
                    >
                  </fieldset>
                  <p class="settings-hint">只读与提议工具可配置；正式写入、执行代码和绕过保护规则的权限不可配置。</p>
                </template>
                <div v-if="lib === 'prompt' || lib === 'agent'" class="settings-form-grid">
                  <TpField v-slot="f" label="输入结构（JSON）">
                    <textarea :id="f.id" v-model="draft.inputSchema" class="tp-input settings-code" rows="3" /></TpField
                  ><TpField v-slot="f" label="输出约束（JSON）">
                    <textarea :id="f.id" v-model="draft.outputSchema" class="tp-input settings-code" rows="3" />
                  </TpField>
                </div>
                <Transition name="tp-swap">
                  <ul v-if="errors.length" class="settings-errors" role="alert">
                    <li v-for="error in errors" :key="error">{{ error }}</li>
                  </ul>
                </Transition>
                <div class="screen-actions">
                  <TpButton variant="primary" type="submit">保存配置</TpButton
                  ><TpButton
                    variant="ghost"
                    @click="
                      draft = null;
                      errors = [];
                    "
                    >取消</TpButton
                  ><span class="settings-hint">Esc 取消 · 多行 Enter 换行</span>
                </div>
              </form>

              <div class="settings-detail-stack" :key="selected.id" v-else-if="selected">
                <section class="screen-panel settings-detail">
                  <div class="settings-section-heading">
                    <div>
                      <p class="tp-label">{{ libraryNames[selected.lib] }} · v{{ selected.version }}</p>
                      <h2>{{ selected.name }}</h2>
                      <p>{{ selected.description || "可通过编辑补充用途说明。" }}</p>
                    </div>
                    <TpStatus :label="selected.enabled ? '已启用' : '已停用'" :tone="selected.enabled ? 'success' : 'neutral'" />
                  </div>
                  <div class="screen-actions">
                    <TpButton size="sm" @click="editEntry(selected)">编辑配置</TpButton
                    ><TpButton size="sm" variant="ghost" @click="editEntry(selected, true)"><TpIcon :icon="PhCopy" :size="14" />复制</TpButton
                    ><TpButton size="sm" variant="ghost" @click="toggleSelected">{{ selected.enabled ? "停用配置" : "启用配置" }}</TpButton>
                  </div>
                  <ConfigChain :nodes="nodes" />
                  <Transition name="tp-swap">
                    <ul v-if="problems.length" class="settings-errors" role="alert">
                      <li v-for="error in problems" :key="error">{{ error }}</li>
                    </ul>
                  </Transition>
                  <dl class="settings-facts" v-if="lib === 'api'">
                    <div>
                      <dt>协议 / 地址</dt>
                      <dd>{{ selected.protocol }}<code>{{ selected.address }}</code></dd>
                    </div>
                    <div>
                      <dt>调用策略</dt>
                      <dd>{{ selected.timeout }} 秒超时 · 最多重试 {{ selected.retries }} 次 · {{ selected.rateLimit }} 次/分钟</dd>
                    </div>
                    <div>
                      <dt>密钥</dt>
                      <dd>虚构引用 {{ selected.keyRef }} · 未存储任何真实密钥</dd>
                    </div>
                  </dl>
                  <dl class="settings-facts" v-if="lib === 'model'">
                    <div>
                      <dt>所属接口</dt>
                      <dd>{{ entryLabel(selected.apiId) }}</dd>
                    </div>
                    <div>
                      <dt>模型标识 / 能力</dt>
                      <dd>{{ selected.modelCode }}<code>{{ selected.capabilities.join(" · ") }}</code></dd>
                    </div>
                    <div>
                      <dt>参数</dt>
                      <dd>上下文 {{ selected.contextLimit.toLocaleString() }} · 温度 {{ selected.temperature }}</dd>
                    </div>
                    <div>
                      <dt>信息依据</dt>
                      <dd>自制预览配置；实际能力、费用与核验时间均未知</dd>
                    </div>
                  </dl>
                  <template v-if="lib === 'prompt'">
                    <pre class="settings-prompt">{{ selected.body }}</pre>
                    <p class="settings-hint">变量：{{ selected.variables.join("、") }}</p>
                    <div class="settings-form-grid">
                      <div>
                        <p class="tp-label">输入结构</p>
                        <pre class="settings-code-block">{{ selected.inputSchema }}</pre>
                      </div>
                      <div>
                        <p class="tp-label">输出约束</p>
                        <pre class="settings-code-block">{{ selected.outputSchema }}</pre>
                      </div>
                    </div></template
                  >
                  <dl class="settings-facts" v-if="lib === 'agent'">
                    <div>
                      <dt>适用任务</dt>
                      <dd>{{ selected.capability }} · 依据项目要求 v{{ workspace.current.requirementVersion }}</dd>
                    </div>
                    <div>
                      <dt>工具边界</dt>
                      <dd>{{ selected.tools.join("、") }}</dd>
                    </div>
                    <div>
                      <dt>绑定提示词</dt>
                      <dd>
                        {{ entryLabel(selected.promptId) }} · v{{ selected.promptVersion ?? dependencies.find((item) => item.lib === "prompt")?.version }}
                      </dd>
                    </div>
                    <div>
                      <dt>输入 / 输出</dt>
                      <dd><code>{{ selected.inputSchema }}</code><code>{{ selected.outputSchema }}</code></dd>
                    </div>
                    <div>
                      <dt>写入边界</dt>
                      <dd>产生候选；学生采纳并通过程序校验后才应用</dd>
                    </div>
                  </dl>
                  <div class="settings-references">
                    <h3>被哪些配置使用</h3>
                    <p v-if="!references.length" class="settings-hint">当前没有下游配置引用。</p>
                    <button v-for="entry in references" :key="entry.id" class="settings-ref" @click="selectEntry(entry)">
                      {{ entry.name }} <span>v{{ entry.version }} <TpIcon :icon="PhArrowRight" :size="12" /></span>
                    </button>
                    <p v-if="references.length" class="settings-hint">停用后这些关联会显示无效，系统不会自动替换。</p>
                  </div>
                  <div class="settings-references">
                    <h3>使用此配置的任务</h3>
                    <p v-if="!usedJobs.length && !usedRuns.length" class="settings-hint">暂无运行记录。</p>
                    <RouterLink v-for="job in usedJobs" :key="job.id" class="settings-ref" :to="{ path: '/screens/jobs', query: { job: job.id } }"
                      >{{ job.title }}<span>第{{ job.attempt }}次 · 查看固定输入</span></RouterLink
                    >
                    <button
                      v-for="run in usedRuns"
                      :key="run.id"
                      class="settings-ref"
                      @click="
                        tab = 'runs';
                        runSelected = run.id;
                      "
                    >
                      {{ run.title
                      }}<span
                        >{{
                          run.snapshot.find((node) => node.id === selected!.id)?.version
                            ? "v" + run.snapshot.find((node) => node.id === selected!.id)!.version
                            : ""
                        }}
                        · {{ run.at }}</span
                      >
                    </button>
                  </div>
                </section>

                <section class="screen-panel settings-detail">
                  <div class="settings-section-heading">
                    <div>
                      <p class="tp-label">Simulation · 固定样例</p>
                      <h2><TpIcon :icon="PhTestTube" :size="20" /> 检查这条配置链</h2>
                    </div>
                    <TpStatus tone="info" label="不发送外部请求" />
                  </div>
                  <div v-if="prompt" class="settings-form-grid">
                    <TpField v-for="variable in prompt.variables" :key="variable" v-slot="f" :label="'变量 ' + variable"
                      ><input :id="f.id" v-model="variables[variable]" class="tp-input" maxlength="200"
                    /></TpField>
                  </div>
                  <details v-if="prompt" class="settings-disclosure">
                    <summary>查看变量替换预览</summary>
                    <pre class="settings-prompt">{{ promptPreview }}</pre>
                  </details>
                  <div class="settings-run-controls">
                    <TpField v-slot="f" label="模拟场景"
                      ><TpSelect
                        :id="f.id"
                        v-model="scenario"
                        :options="[
                          { value: 'success', label: '正常返回' },
                          { value: 'auth', label: '认证失败' },
                          { value: 'timeout', label: '超时' },
                          { value: 'rate', label: '限流' },
                          { value: 'incompatible', label: '返回结构不兼容' },
                        ]" /></TpField
                    ><TpButton
                      variant="pencil"
                      :disabled="problems.length > 0 || state.runs.some((r) => r.entryId === selected!.id && r.status === 'running')"
                      @click="startRun()"
                      >开始模拟运行</TpButton
                    >
                  </div>
                  <Transition name="tp-swap">
                    <ul v-if="errors.length" class="settings-errors" role="alert">
                      <li v-for="error in errors" :key="error">{{ error }}</li>
                    </ul>
                  </Transition>
                  <Transition name="tp-swap" mode="out-in">
                    <div
                      :key="viewedRun.id + ':' + viewedRun.status"
                      v-if="viewedRun && viewedRun.entryId === selected.id"
                      class="settings-run-result"
                      aria-live="polite"
                    >
                      <div class="settings-row">
                        <b>{{ viewedRun.title }}</b
                        ><TpStatus
                          :tone="viewedRun.status === 'failed' ? 'danger' : viewedRun.status === 'done' ? 'success' : 'neutral'"
                          :label="
                            viewedRun.status === 'running'
                              ? '模拟运行中'
                              : viewedRun.status === 'done'
                                ? '模拟完成'
                                : viewedRun.status === 'failed'
                                  ? '模拟失败'
                                  : '已取消'
                          "
                          :live="viewedRun.status === 'running'"
                        />
                      </div>
                      <p>{{ viewedRun.result }}</p>
                      <div class="screen-actions">
                        <TpButton v-if="viewedRun.status === 'running'" size="sm" @click="cancelRun(viewedRun)">取消运行</TpButton
                        ><TpButton v-if="viewedRun.status === 'failed' || viewedRun.status === 'cancelled'" size="sm" @click="retryRun(viewedRun)"
                          >重试本次配置</TpButton
                        ><TpButton size="sm" variant="ghost" @click="tab = 'runs'">查看快照与诊断</TpButton>
                      </div>
                    </div>
                  </Transition>
                </section>

                <section class="screen-panel settings-detail">
                  <div class="settings-section-heading">
                    <div>
                      <p class="tp-label">Version history</p>
                      <h2>配置版本</h2>
                    </div>
                    <TpSelect
                      v-model.number="historyVersion"
                      class="settings-version-select"
                      aria-label="选择配置历史版本"
                      :options="selected.history.map((version) => ({ value: version.version, label: `v${version.version} · ${version.summary}` }))"
                    />
                  </div>
                  <p class="settings-hint">{{ revision?.at }} · 当前 v{{ selected.version }}；比较不会恢复或覆盖配置。</p>
                  <p v-if="!changes.length">所选版本与当前内容一致。</p>
                  <TransitionGroup name="tp-list" tag="div" class="tp-list-group studio-stack" v-bind="listMotionHooks">
                    <div v-for="key in changes" :key="historyVersion + ':' + key" class="settings-diff">
                      <b>{{ fieldNames[key] ?? key }}</b><del>{{ revision?.content[key as keyof ConfigContent] }}</del
                      ><ins>{{ selected[key as keyof ConfigContent] }}</ins>
                    </div>
                  </TransitionGroup>
                </section>
              </div>
            </Transition>
          </div>
        </div>
      </div>

      <div class="settings-section-stack" key="workflow" v-else-if="tab === 'workflow'">
        <div class="settings-toolbar">
          <div>
            <h2 class="tp-heading">从开题走到答辩</h2>
            <p class="settings-hint">当前流程 v{{ state.workflowVersion }} · 项目绑定 v{{ workspace.current.workflowVersion }} · 自制示例，可按需调整</p>
          </div>
          <div class="screen-actions">
            <TpButton @click="editStage()"><TpIcon :icon="PhPlus" :size="16" />新增阶段</TpButton
            ><TpButton variant="primary" :disabled="workspace.current.workflowVersion === bindingVersion" @click="bindWorkflow">{{
              bindingVersion === state.workflowVersion ? "绑定当前流程" : "绑定所选流程"
            }}</TpButton>
          </div>
        </div>
        <Transition name="tp-swap">
          <ul v-if="stageErrors.length" class="settings-errors" role="alert">
            <li v-for="error in stageErrors" :key="error">{{ error }}</li>
          </ul>
        </Transition>
        <div class="screen-panel settings-detail">
          <TpField v-slot="f" label="绑定流程版本"
            ><TpSelect
              :id="f.id"
              v-model.number="bindingVersion"
              @change="bindingChoice = ''"
              :options="state.workflowHistory.map((revision) => ({ value: revision.version, label: `v${revision.version} · ${revision.at}` }))"
          /></TpField>
          <TpField v-slot="f" label="绑定后当前阶段" hint="阶段改名会按原 ID 对应；当前阶段被停用时，请明确选择。绑定不代表完成任何阶段。">
            <TpSelect
              :id="f.id"
              v-model="bindingStageId"
              :aria-describedby="f.describedby"
              :options="[
                { value: '', label: '请选择当前阶段' },
                ...bindingStages.filter((item) => item.enabled).map((stage) => ({ value: stage.id, label: stage.name })),
              ]"
            />
          </TpField>
        </div>
        <Transition name="tp-swap" mode="out-in">
          <form
            :key="stageDraft.id || 'new-stage'"
            v-if="stageDraft"
            class="screen-panel settings-form"
            @submit.prevent="commitStage"
            @keydown.esc.prevent="stageDraft = null"
          >
            <h2 class="tp-heading">编辑阶段</h2>
            <div class="settings-form-grid">
              <TpField v-slot="f" label="阶段名称" required><input :id="f.id" v-model="stageDraft.name" class="tp-input" required /></TpField
              ><TpField v-slot="f" label="截止日期"><TpDatePicker :id="f.id" v-model="stageDraft.deadline" type="date" /></TpField>
              <TpField v-slot="f" label="开始日期" hint="用于计算阶段已用时间；未填写则保持未知。"
                ><TpDatePicker :id="f.id" v-model="stageDraft.start" type="date"
              /></TpField>
            </div>
            <TpField v-slot="f" label="阶段说明"><input :id="f.id" v-model="stageDraft.description" class="tp-input" /></TpField>
            <div class="settings-form-grid">
              <TpField v-slot="f" label="所需产物" required><input :id="f.id" v-model="stageDraft.deliverables" class="tp-input" required /></TpField
              ><TpField v-slot="f" label="完成条件" required><input :id="f.id" v-model="stageDraft.condition" class="tp-input" required /></TpField>
            </div>
            <TpField v-slot="f" label="前置阶段"
              ><TpSelect
                :id="f.id"
                v-model="stageDraft.predecessorId"
                :options="[
                  { value: '', label: '无前置' },
                  ...state.stages
                    .filter((s) => s.id !== stageDraft!.id)
                    .map((stage) => ({ value: stage.id, label: stage.name + (stage.enabled ? '' : '（停用）') })),
                ]"
            /></TpField>
            <div class="screen-actions">
              <TpButton type="submit" variant="primary">保存阶段</TpButton><TpButton variant="ghost" @click="stageDraft = null">取消</TpButton>
            </div>
          </form>
        </Transition>
        <TransitionGroup name="tp-list" tag="section" v-bind="listMotionHooks" class="tp-list-group screen-panel settings-stages">
          <article v-for="(stage, index) in state.stages" :key="stage.id" class="settings-stage">
            <span class="settings-stage__number tp-mono">{{ String(index + 1).padStart(2, "0") }}</span>
            <div>
              <div class="settings-row">
                <h3>{{ stage.name }}</h3>
                <TpStatus :label="stage.enabled ? '启用' : '停用'" :tone="stage.enabled ? 'info' : 'neutral'" size="sm" />
              </div>
              <p>{{ stage.description }}</p>
              <dl class="settings-stage-facts">
                <div>
                  <dt>产物</dt>
                  <dd>{{ stage.deliverables }}</dd>
                </div>
                <div>
                  <dt>完成条件</dt>
                  <dd>{{ stage.condition }}</dd>
                </div>
                <div>
                  <dt>前置 / 截止</dt>
                  <dd>{{ state.stages.find((s) => s.id === stage.predecessorId)?.name || "无" }} · {{ stage.deadline || "未设定" }}</dd>
                </div>
                <div>
                  <dt>阶段区间</dt>
                  <dd>{{ stage.start || "开始日未知" }} — {{ stage.deadline || "截止日未知" }}</dd>
                </div>
              </dl>
            </div>
            <div class="settings-stage__actions">
              <TpButton size="sm" @click="editStage(stage)">编辑</TpButton
              ><TpButton size="sm" variant="ghost" @click="toggleStage(stage)">{{ stage.enabled ? "停用" : "启用" }}</TpButton
              ><TpButton size="sm" variant="ghost" :disabled="index === 0" :label="'上移' + stage.name" @click="moveStage(index, -1)">上移</TpButton
              ><TpButton size="sm" variant="ghost" :disabled="index === state.stages.length - 1" :label="'下移' + stage.name" @click="moveStage(index, 1)"
                >下移</TpButton
              >
            </div>
          </article>
        </TransitionGroup>
        <details class="screen-panel settings-detail">
          <summary>查看流程历史</summary>
          <TpSelect
            v-model.number="selectedWorkflowVersion"
            class="mt-4"
            aria-label="流程历史版本"
            :options="state.workflowHistory.map((version) => ({ value: version.version, label: `v${version.version} · ${version.at}` }))"
          />
          <ol class="settings-history-stages">
            <li v-for="stage in workflowSnapshot?.stages" :key="stage.id">
              {{ stage.name }} · {{ stage.enabled ? "启用" : "停用" }} · {{ stage.deadline || "无期限" }}
            </li>
          </ol>
        </details>
      </div>

      <div class="settings-section-stack" key="system" v-else-if="tab === 'system'">
        <div class="settings-system-grid">
          <section class="screen-panel settings-detail">
            <div class="settings-section-heading">
              <div>
                <p class="tp-label">Dictionary</p>
                <h2>资料分类</h2>
              </div>
              <TpIcon :icon="PhStack" :size="24" />
            </div>
            <form
              class="settings-category-form"
              @submit.prevent="saveCategory"
              @keydown.esc.prevent="
                categoryDraft = '';
                categoryEditing = '';
              "
            >
              <TpField v-slot="f" :label="categoryEditing ? '编辑分类名称' : '新分类名称'"
                ><input :id="f.id" v-model="categoryDraft" class="tp-input" maxlength="40" /></TpField
              ><TpButton type="submit">{{ categoryEditing ? "保存分类" : "添加分类" }}</TpButton>
            </form>
            <TransitionGroup name="tp-list" tag="div" class="tp-list-group" v-bind="listMotionHooks">
              <div v-for="category in state.categories" :key="category.id" class="settings-category">
                <span>{{ category.name }}<small>{{ category.enabled ? "使用中" : "已停用，历史关联保留" }}</small></span>
                <div class="screen-actions">
                  <TpButton
                    size="sm"
                    variant="ghost"
                    @click="
                      categoryDraft = category.name;
                      categoryEditing = category.id;
                    "
                    >编辑</TpButton
                  ><TpButton
                    size="sm"
                    variant="ghost"
                    @click="
                      category.enabled = !category.enabled;
                      state.systemVersion += 1;
                    "
                    >{{ category.enabled ? "停用" : "启用" }}</TpButton
                  >
                </div>
              </div>
            </TransitionGroup>
          </section>
          <form class="screen-panel settings-form" @submit.prevent="saveReminders">
            <div class="settings-section-heading">
              <div>
                <p class="tp-label">Reminder policy</p>
                <h2>提醒参数</h2>
              </div>
              <TpIcon :icon="PhSlidersHorizontal" :size="24" />
            </div>
            <label class="settings-checkbox"><input class="tp-checkbox" v-model="reminderDraft.enabled" type="checkbox" />启用事件提醒规则</label
            ><TpField v-slot="f" label="同类事件冷却时间（小时）" hint="合并重复事件，避免频繁打断。"
              ><input
                :id="f.id"
                v-model.number="reminderDraft.cooldownHours"
                class="tp-input"
                type="number"
                min="1"
                max="168"
                :aria-describedby="f.describedby" /></TpField
            ><TpField v-slot="f" label="明显延期阈值（天）"
              ><input :id="f.id" v-model.number="reminderDraft.overdueDays" class="tp-input" type="number" min="1" max="30"
            /></TpField>
            <p class="settings-hint">没有观察到编辑不代表没有工作。学生可补充线下进展；主动建议仍遵守个人静默偏好。</p>
            <TpButton type="submit" variant="primary">保存提醒参数</TpButton
            ><RouterLink to="/screens/account" class="settings-link">查看演示用户、会话与通知偏好 →</RouterLink>
          </form>
        </div>
        <Transition name="tp-swap" mode="out-in">
          <p :key="systemError" v-if="systemError" class="settings-errors" role="alert">{{ systemError }}</p>
        </Transition>
        <p class="settings-hint">业务设置 v{{ state.systemVersion }} · 当前预览的配置状态；未接入后台调度。</p>
      </div>

      <div class="settings-section-stack" key="runs" v-else-if="tab === 'runs'">
        <div class="settings-toolbar">
          <div>
            <h2 class="tp-heading">每一次运行，都有据可查</h2>
            <p class="settings-hint">只记录配置和必要摘要。修改配置不会改变已发生运行的版本快照。</p>
          </div>
          <TpStatus label="全部为本地模拟" tone="info" />
        </div>
        <div v-if="!state.runs.length" class="screen-panel settings-empty">
          <TpIcon :icon="PhTestTube" :size="32" />
          <h3>还没有运行记录</h3>
          <p>从任意配置详情开始一次模拟检查。</p>
          <TpButton @click="tab = 'agent'">前往智能体库</TpButton>
        </div>
        <div v-else class="settings-layout">
          <section class="screen-panel settings-list">
            <TransitionGroup name="tp-list" tag="div" class="tp-list-group" v-bind="listMotionHooks">
              <button
                v-for="run in state.runs"
                :key="run.id"
                class="settings-item"
                :class="{ 'is-selected': viewedRun?.id === run.id }"
                @click="runSelected = run.id"
              >
                <span><b>{{ run.title }}</b><small>{{ run.at }} · 第 {{ run.attempt }} 次尝试</small></span
                ><TpStatus
                  :tone="run.status === 'failed' ? 'danger' : run.status === 'done' ? 'success' : 'neutral'"
                  :label="run.status === 'running' ? '运行中' : run.status === 'done' ? '完成' : run.status === 'failed' ? '失败' : '取消'"
                  size="sm"
                />
              </button>
            </TransitionGroup>
          </section>
          <Transition name="tp-swap" mode="out-in">
            <section :key="viewedRun.id" v-if="viewedRun" class="screen-panel settings-detail">
              <div class="settings-section-heading">
                <div>
                  <p class="tp-label">Run snapshot</p>
                  <h2>{{ viewedRun.title }}</h2>
                </div>
              </div>
              <p class="settings-run-diagnosis">{{ viewedRun.result }}</p>
              <dl class="settings-facts">
                <div>
                  <dt>范围</dt>
                  <dd>当前项目 · 正文 v{{ viewedRun.docVersion }} · 要求 v{{ viewedRun.requirementVersion }} · 仅固定样例</dd>
                </div>
                <div>
                  <dt>运行时间</dt>
                  <dd>{{ viewedRun.at }} → {{ viewedRun.finishedAt || "运行中" }}</dd>
                </div>
              </dl>
              <h3>固定配置快照</h3>
              <div v-for="node in viewedRun.snapshot" :key="node.id" class="settings-snapshot">
                <div class="settings-row"><span>{{ libraryNames[node.lib] }} · {{ node.name }}</span><b class="tp-mono">v{{ node.version }}</b></div>
                <details>
                  <summary>查看当次配置</summary>
                  <pre class="settings-code-block">{{ JSON.stringify(node.content, null, 2) }}</pre>
                </details>
              </div>
              <p class="settings-hint">快照中的密钥仅为 demo: 虚构引用；不包含论文原文。</p>
              <div class="screen-actions">
                <TpButton v-if="viewedRun.status === 'running'" @click="cancelRun(viewedRun)">取消运行</TpButton
                ><TpButton v-if="viewedRun.status === 'failed' || viewedRun.status === 'cancelled'" @click="retryRun(viewedRun)">重新校验并重试</TpButton
                ><TpButton variant="ghost" @click="selectEntry(state.entries.find((e) => e.id === viewedRun!.entryId)!)">查看当前配置</TpButton>
              </div>
              <Transition name="tp-swap">
                <ul v-if="errors.length" class="settings-errors" role="alert">
                  <li v-for="error in errors" :key="error">{{ error }}</li>
                </ul>
              </Transition>
            </section>
          </Transition>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.settings-section-stack,
.settings-detail-stack {
  display: grid;
  gap: 24px;
  min-width: 0;
}
.settings-summary {
  display: grid;
  gap: 4px;
  min-width: 180px;
  color: var(--tp-text-muted);
  font-size: 12px;
}
.settings-summary strong {
  font-family: var(--tp-font-display);
  font-size: 32px;
  line-height: 1.2;
  color: var(--tp-text);
}
.settings-summary small {
  font-size: 16px;
  color: var(--tp-text-faint);
  font-weight: 400;
}
.settings-intro {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-m);
  background: var(--tp-surface);
  color: var(--tp-text-muted);
  font-size: 13px;
}
.settings-intro > span {
  flex: 1;
}
.settings-intro a {
  display: flex;
  gap: 8px;
  align-items: center;
  white-space: nowrap;
  color: var(--tp-text);
}
.settings-tabs {
  overflow-x: auto;
  max-width: 100%;
}
.settings-tabs :deep(.tp-tabs) {
  min-width: max-content;
}
.settings-notice {
  display: flex;
  align-items: start;
  gap: 8px;
  font-size: 13px;
  padding: 12px 16px;
  border-left: 2px solid var(--tp-accent);
  background: var(--tp-surface-sunken);
}
.settings-toolbar,
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.settings-search {
  display: flex;
  gap: 12px;
}
.settings-search input {
  width: min(320px, 40vw);
}
.settings-search .settings-filter {
  width: 128px;
}
.settings-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.settings-list {
  overflow: hidden;
}
.settings-item {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  text-align: left;
  padding: 20px;
  gap: 12px;
  border-bottom: 1px solid var(--tp-line);
  background: transparent;
  color: var(--tp-text);
}
.settings-item:last-child {
  border-bottom: 0;
}
.settings-item:hover {
  background: var(--tp-surface-sunken);
}
.settings-item.is-selected {
  background: var(--tp-accent-soft);
  box-shadow: inset 3px 0 var(--tp-accent);
}
.settings-item > span:first-child {
  min-width: 0;
}
.settings-item b {
  display: block;
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.settings-item small {
  display: block;
  color: var(--tp-text-muted);
  font-size: 12px;
  margin-top: 8px;
  line-height: 1.6;
}
.settings-item__meta {
  display: grid;
  justify-items: end;
  gap: 8px;
  font-size: 11px;
}
.settings-main {
  display: grid;
  gap: 24px;
  min-width: 0;
}
.settings-detail,
.settings-form {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}
.settings-section-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.settings-section-heading h2 {
  font-size: 20px;
  font-weight: 600;
  margin-top: 8px;
  line-height: 1.5;
}
.settings-section-heading h2 :deep(svg) {
  display: inline-block;
  vertical-align: -3px;
}
.settings-section-heading p:not(.tp-label) {
  color: var(--tp-text-muted);
  font-size: 13px;
  margin-top: 8px;
  line-height: 1.7;
}
.settings-detail :deep(.tp-chain) {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.settings-detail :deep(.tp-chain__node) {
  min-width: 0;
}
.settings-detail :deep(.tp-chain__node::after) {
  display: none;
}
.settings-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.settings-form-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.settings-form .tp-input,
.settings-detail .tp-input {
  width: 100%;
  min-width: 0;
}
.settings-textarea,
.settings-code {
  resize: vertical;
  line-height: 1.7;
}
.settings-code {
  font-family: var(--tp-font-mono);
  font-size: 12px;
}
.settings-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
}
.settings-checks legend {
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 600;
}
.settings-checks label,
.settings-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.settings-checks input,
.settings-checkbox input {
  accent-color: var(--tp-accent);
}
.settings-hint {
  color: var(--tp-text-muted);
  font-size: 12px;
  line-height: 1.8;
}
.settings-errors {
  padding: 12px 16px;
  color: var(--tp-danger-content);
  border: 1px solid var(--tp-danger);
  border-radius: var(--tp-radius-s);
  background: var(--tp-danger-soft);
  font-size: 13px;
  line-height: 1.8;
  list-style: inside;
}
.settings-facts {
  display: grid;
  gap: 16px;
  font-size: 13px;
}
.settings-facts > div {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 16px;
}
.settings-facts dt {
  color: var(--tp-text-muted);
}
.settings-facts dd {
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.settings-facts code {
  display: block;
  font-size: 12px;
  font-family: var(--tp-font-mono);
  overflow-wrap: anywhere;
}
.settings-prompt,
.settings-code-block {
  padding: 16px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
  font-size: 13px;
  line-height: 1.9;
}
.settings-prompt {
  font-family: var(--tp-font-prose);
}
.settings-code-block {
  font-family: var(--tp-font-mono);
  font-size: 11px;
  margin-top: 8px;
}
.settings-references {
  padding-top: 20px;
  border-top: 1px solid var(--tp-line);
}
.settings-references h3 {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 12px;
}
.settings-ref {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  font-size: 13px;
  border-bottom: 1px solid var(--tp-line);
  text-align: left;
}
.settings-ref > span {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--tp-text-muted);
}
.settings-run-controls {
  display: flex;
  align-items: flex-end;
  gap: 16px;
}
.settings-run-controls > :first-child {
  flex: 1;
}
.settings-run-result {
  display: grid;
  gap: 16px;
  padding: 16px;
  border: 1px dashed var(--tp-line-strong);
  border-radius: var(--tp-radius-m);
  font-size: 13px;
  line-height: 1.8;
}
.settings-version-select {
  max-width: 240px;
}
.settings-diff {
  display: grid;
  gap: 8px;
  font-size: 13px;
}
.settings-diff del,
.settings-diff ins {
  padding: 8px 12px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  text-decoration: none;
  background: var(--tp-surface-sunken);
}
.settings-diff del {
  border-left: 2px solid var(--tp-danger);
}
.settings-diff ins {
  border-left: 2px solid var(--tp-success);
}
.settings-disclosure {
  font-size: 13px;
}
.settings-disclosure summary,
.settings-detail > summary {
  cursor: pointer;
  font-weight: 600;
}
.settings-empty {
  display: grid;
  place-items: center;
  text-align: center;
  padding: 48px 24px;
  gap: 16px;
}
.settings-empty > :deep(svg) {
  color: var(--tp-text-faint);
}
.settings-empty p {
  font-size: 13px;
  color: var(--tp-text-muted);
}
.settings-stage {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: start;
  gap: 20px;
  padding: 24px;
  border-bottom: 1px solid var(--tp-line);
}
.settings-stage:last-child {
  border-bottom: 0;
}
.settings-stage__number {
  color: var(--tp-text-faint);
  font-size: 20px;
  padding-top: 4px;
}
.settings-stage h3 {
  font-size: 16px;
  font-weight: 600;
}
.settings-stage p {
  color: var(--tp-text-muted);
  margin-top: 8px;
  font-size: 13px;
}
.settings-stage-facts {
  display: grid;
  gap: 8px;
  margin-top: 16px;
  font-size: 12px;
}
.settings-stage-facts > div {
  display: flex;
  gap: 12px;
}
.settings-stage-facts dt {
  color: var(--tp-text-muted);
  min-width: 72px;
}
.settings-stage__actions {
  display: grid;
  grid-template-columns: repeat(2, auto);
  gap: 8px;
}
.settings-history-stages {
  display: grid;
  gap: 12px;
  margin: 20px 0 0;
  list-style-position: inside;
  font-size: 13px;
}
.settings-system-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  align-items: start;
}
.settings-category-form {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}
.settings-category-form > :first-child {
  flex: 1;
  min-width: 0;
}
.settings-category {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
  border-top: 1px solid var(--tp-line);
  font-size: 13px;
}
.settings-category small {
  display: block;
  font-size: 11px;
  color: var(--tp-text-muted);
  margin-top: 4px;
}
.settings-link {
  font-size: 13px;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.settings-run-diagnosis {
  font-size: 14px;
  line-height: 1.8;
  padding: 16px;
  border: 1px dashed var(--tp-line-strong);
}
.settings-snapshot {
  padding: 16px;
  background: var(--tp-surface-sunken);
  border-radius: var(--tp-radius-s);
  font-size: 13px;
}
.settings-snapshot details {
  margin-top: 12px;
}
@media (max-width: 1100px) {
  .settings-layout {
    grid-template-columns: 240px minmax(0, 1fr);
  }
  .settings-system-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 900px) {
  .settings-layout {
    grid-template-columns: 1fr;
  }
  .settings-list {
    max-height: 360px;
    overflow-y: auto;
  }
  .settings-intro {
    flex-wrap: wrap;
  }
  .settings-intro > span {
    flex-basis: calc(100% - 40px);
  }
  .settings-intro a {
    margin-left: 32px;
  }
}
@media (max-width: 600px) {
  .settings-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .settings-search input {
    width: 100%;
    min-width: 0;
  }
  .settings-search .settings-filter {
    width: 116px;
    flex-shrink: 0;
  }
  .settings-detail,
  .settings-form {
    padding: 16px;
  }
  .settings-form-grid,
  .settings-form-grid--three {
    grid-template-columns: 1fr;
  }
  .settings-section-heading {
    flex-wrap: wrap;
  }
  .settings-facts > div {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .settings-stage {
    grid-template-columns: 24px minmax(0, 1fr);
    padding: 16px;
    gap: 12px;
  }
  .settings-stage__actions {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
  }
  .settings-run-controls {
    flex-direction: column;
    align-items: stretch;
  }
  .settings-row {
    flex-wrap: wrap;
  }
  .settings-category {
    flex-wrap: wrap;
  }
}
</style>
