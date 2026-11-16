<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, shallowRef } from "vue";
import { RouterLink } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { BackendServices, ProjectRead } from "@/services";
import { asApiError } from "@/services/errors";
import MaterialSourceBinding from "../materials/MaterialSourceBinding.vue";
import { materialsRoute } from "../workspaceRoutes";
import { readAll, useFlowPicker } from "./flowCatalog";
import { changedFields, createPayload, emptyDraft, findCreatedProject, isUncertain, projectNameError, setupSteps, type SetupStep } from "./projectSetup";

const props = defineProps<{ services: BackendServices }>();
const emit = defineEmits<{ persisted: [project: ProjectRead]; done: [project: ProjectRead]; close: [] }>();
const draft = ref(emptyDraft());
const step = ref<SetupStep>("basics");
const index = computed(() => setupSteps.findIndex((item) => item.id === step.value));
const created = shallowRef<ProjectRead>();
const busy = ref(false);
const error = ref("");
const nameError = ref("");
const mustReload = ref(false);
const uncertain = ref(false);
const verified = ref(false);
const match = shallowRef<ProjectRead>();
const materialCount = ref<number>();
const materialError = ref("");
const documentUncertain = ref(false);
const nameInput = ref<HTMLInputElement>();
const picker = useFlowPicker(props.services.projectFlows);
const { selectedFlow, versionId, stageId, flowOptions, versionOptions, stageOptions } = picker;
const planOptions = [
  { value: "personal" as const, label: "个人规划" },
  { value: "none" as const, label: "暂不规划" },
];
let flowsLoaded = false;
let request: AbortController | undefined;
let attemptStarted = 0;

function begin() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  error.value = "";
  return controller;
}
function finish(controller: AbortController) {
  if (request === controller) busy.value = false;
}

async function go(next: SetupStep) {
  step.value = next;
  error.value = "";
  if (next === "flow" && !flowsLoaded) {
    flowsLoaded = true;
    void picker.load(draft.value.flow_version_id, draft.value.stage_id);
  }
  if (next === "sources") void readMaterials();
  if (next === "basics") {
    await nextTick();
    nameInput.value?.focus();
  }
}

function syncFlow() {
  if (!flowsLoaded) return true;
  const stored = created.value;
  const unchanged = stored
    ? versionId.value === (stored.flow_version_id ?? "") && stageId.value === (stored.stage_id ?? "")
    : !selectedFlow.value && !versionId.value && !stageId.value;
  error.value = picker.bindingError(unchanged);
  if (error.value) return false;
  draft.value.flow_version_id = versionId.value;
  draft.value.stage_id = stageId.value;
  return true;
}

/** Creates the project once; afterwards only changed fields are patched against the stored version. */
async function persist() {
  const controller = begin();
  try {
    const stored = created.value;
    let saved: ProjectRead;
    if (!stored) {
      attemptStarted = Date.now();
      saved = await props.services.projects.create(createPayload(draft.value), controller.signal);
    } else {
      const changes = changedFields(draft.value, stored);
      saved = changes ? await props.services.projects.update(stored.id, { ...changes, expected_version: stored.version }, controller.signal) : stored;
    }
    if (controller.signal.aborted) return;
    created.value = saved;
    uncertain.value = mustReload.value = false;
    match.value = undefined;
    emit("persisted", saved);
    return saved;
  } catch (problem) {
    if (controller.signal.aborted) return;
    const issue = asApiError(problem);
    if (!created.value && isUncertain(issue)) {
      uncertain.value = true;
      error.value = "创建结果尚未确认，输入已保留。正在核对项目列表，避免重复创建。";
      await verifyCreated(controller);
    } else if (created.value && (issue.status === 409 || isUncertain(issue))) {
      mustReload.value = true;
      error.value = `${issue.message} 输入已保留；请载入最新项目后再继续。`;
    } else error.value = issue.message;
  } finally {
    finish(controller);
  }
}

async function verifyCreated(controller: AbortController) {
  verified.value = false;
  try {
    const items = await readAll((query) => props.services.projects.list(query, controller.signal), controller.signal);
    if (controller.signal.aborted) return;
    match.value = findCreatedProject(items, draft.value.name, attemptStarted);
    verified.value = true;
    error.value = match.value
      ? `项目列表中已有刚创建的“${match.value.name}”。可以继续设置它，不必重新创建。`
      : "项目列表中没有找到这次创建的项目，输入已保留，可以重新创建。";
  } catch (problem) {
    if (!controller.signal.aborted) error.value = `创建结果尚未确认，项目列表也暂时无法读取：${asApiError(problem).message}`;
  }
}

async function retryVerify() {
  const controller = begin();
  try {
    await verifyCreated(controller);
  } finally {
    finish(controller);
  }
}

function adopt() {
  if (!match.value) return;
  created.value = match.value;
  emit("persisted", match.value);
  uncertain.value = false;
  match.value = undefined;
  error.value = "";
  void advance();
}

async function reloadLatest() {
  const stored = created.value;
  if (!stored) return;
  const controller = begin();
  try {
    const latest = await props.services.projects.get(stored.id, controller.signal);
    if (controller.signal.aborted) return;
    created.value = latest;
    mustReload.value = false;
    emit("persisted", latest);
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    finish(controller);
  }
}

async function readMaterials() {
  const project = created.value;
  if (!project) return;
  materialCount.value = undefined;
  materialError.value = "";
  const controller = begin();
  try {
    const page = await props.services.materials.list(project.id, { limit: 1, offset: 0 }, controller.signal);
    if (!controller.signal.aborted) materialCount.value = page.total;
  } catch (problem) {
    if (!controller.signal.aborted) materialError.value = asApiError(problem).message;
  } finally {
    finish(controller);
  }
}

function checkBasics() {
  nameError.value = projectNameError(draft.value.name);
  if (nameError.value) nameInput.value?.focus();
  return !nameError.value;
}

async function advance() {
  if (busy.value || mustReload.value || (uncertain.value && !verified.value)) return;
  if (step.value === "basics") {
    if (!checkBasics()) return;
    if (created.value && !(await persist())) return;
    return go("flow");
  }
  if (step.value === "flow") {
    if (picker.busy.value || !syncFlow()) return;
    if (created.value && !(await persist())) return;
    return go("plan");
  }
  if (step.value === "plan") {
    if (!(await persist())) return;
    return go("sources");
  }
  if (step.value === "sources") return go("start");
}

/** Skip the remaining steps: create with what is filled now and continue in the writing page. */
async function createNow() {
  if (busy.value || !checkBasics() || (uncertain.value && !verified.value)) return;
  const saved = await persist();
  if (saved) emit("done", saved);
}

async function startBlank() {
  const project = created.value;
  if (!project || busy.value) return;
  const controller = begin();
  try {
    if (documentUncertain.value) {
      try {
        await props.services.documents.current(project.id, controller.signal);
        if (!controller.signal.aborted) emit("done", project);
        return;
      } catch (problem) {
        if (asApiError(problem).code !== "DOCUMENT_NOT_FOUND") throw problem;
      }
    }
    await props.services.documents.createBlank(project.id, controller.signal);
    if (!controller.signal.aborted) emit("done", project);
  } catch (problem) {
    if (controller.signal.aborted) return;
    const issue = asApiError(problem);
    if (issue.code === "DOCUMENT_ALREADY_EXISTS") emit("done", project);
    else {
      documentUncertain.value = isUncertain(issue);
      error.value = documentUncertain.value
        ? "正文创建结果尚未确认。项目已保存；重试时会先核对是否已有正式稿。"
        : `${issue.message} 项目已保存，可以重试或稍后在写作页开始。`;
    }
  } finally {
    finish(controller);
  }
}

function back() {
  if (busy.value || index.value === 0) return;
  void go(setupSteps[index.value - 1]!.id);
}

function cancel(event?: KeyboardEvent) {
  if (busy.value || event?.isComposing) return;
  request?.abort();
  picker.stop();
  emit("close");
}

onMounted(() => nameInput.value?.focus());
defineExpose({ focus: () => (step.value === "basics" ? nameInput.value?.focus() : undefined) });
onScopeDispose(() => request?.abort());
</script>

<template>
  <form class="screen-panel studio-body studio-stack project-setup" aria-label="新建项目" @submit.prevent="advance" @keydown.esc.stop="cancel">
    <div class="studio-row">
      <h2 class="tp-subheading">{{ created ? "继续设置项目" : "开始一个新项目" }}</h2>
      <span class="tp-caption">第 {{ index + 1 }} / {{ setupSteps.length }} 步</span>
    </div>
    <ol class="project-setup__steps" aria-label="设置步骤">
      <li v-for="(item, position) in setupSteps" :key="item.id" :data-state="position < index ? 'done' : position === index ? 'current' : 'next'">
        <button v-if="position < index" type="button" class="studio-text-button" :disabled="busy || (position >= 3 && !created)" @click="go(item.id)">
          {{ item.label }}
        </button>
        <span v-else :aria-current="position === index ? 'step' : undefined">{{ item.label }}</span>
      </li>
    </ol>

    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <fieldset v-if="step === 'basics'" key="basics" class="project-setup__fields" :disabled="busy">
        <legend class="sr-only">题目与截止</legend>
        <TpField v-slot="{ id, invalid, describedby }" label="项目名称" required :error="nameError">
          <input
            :id="id"
            ref="nameInput"
            v-model="draft.name"
            class="tp-input"
            maxlength="200"
            autocomplete="off"
            :aria-invalid="invalid || undefined"
            :aria-describedby="invalid ? describedby : undefined"
            @input="nameError = ''"
          />
        </TpField>
        <TpField v-slot="{ id }" label="论文题目" optional><input :id="id" v-model="draft.title" class="tp-input" maxlength="500" /></TpField>
        <TpField v-slot="{ id }" label="重要截止日期" optional><TpDatePicker :id="id" v-model="draft.deadline" :disabled="busy" /></TpField>
      </fieldset>

      <fieldset v-else-if="step === 'flow'" key="flow" class="project-setup__fields" :disabled="busy">
        <legend class="sr-only">流程与阶段</legend>
        <TpField v-slot="{ id }" label="项目流程" hint="可以暂不绑定，之后在项目编辑中选择。"
          ><TpSelect :id="id" :model-value="selectedFlow" :options="flowOptions" :disabled="picker.busy.value" @update:model-value="picker.chooseFlow"
        /></TpField>
        <template v-if="selectedFlow">
          <TpField v-slot="{ id }" label="绑定流程版本" hint="绑定后不随流程更新自动变化。"
            ><TpSelect :id="id" v-model="versionId" :options="versionOptions" :disabled="picker.busy.value" @change="stageId = ''"
          /></TpField>
          <TpField v-slot="{ id }" label="当前阶段" hint="阶段仅表示当前位置，不代表已完成，也不替代任务验收。"
            ><TpSelect :id="id" v-model="stageId" :options="stageOptions" :disabled="picker.busy.value || !versionId"
          /></TpField>
        </template>
        <p v-if="picker.busy.value" role="status" class="tp-caption">正在读取流程与版本…</p>
        <div v-if="picker.error.value" role="alert" class="studio-notice screen-actions">
          {{ picker.error.value }}<TpButton size="sm" @click="picker.load(versionId, stageId)">重试读取流程</TpButton>
        </div>
      </fieldset>

      <fieldset v-else-if="step === 'plan'" key="plan" class="project-setup__fields" :disabled="busy">
        <legend class="sr-only">规划方式</legend>
        <div class="studio-stack project-setup__plan">
          <span class="tp-field__label">规划方式</span>
          <TpSegmented v-model="draft.planning_mode" :options="planOptions" label="规划方式" />
        </div>
        <Transition name="tp-swap" v-bind="panelMotionHooks">
          <TpField
            v-if="draft.planning_mode === 'personal'"
            v-slot="{ id }"
            label="个人规划"
            optional
            hint="可以暂不填写。系统会依据任务、产物和截止日期提醒，不推测你的效率。"
          >
            <textarea :id="id" v-model="draft.plan_note" rows="3" class="tp-input" />
          </TpField>
        </Transition>
        <details class="studio-notice">
          <summary>登记已有进度与完成产物（可选）</summary>
          <div class="studio-stack mt-4">
            <TpField v-slot="{ id }" label="已有产物" optional hint="每行一项，例如开题报告、实验结果表。这里只登记事实，不自动完成任务。">
              <textarea :id="id" v-model="draft.existing_artifacts" rows="3" class="tp-input" />
            </TpField>
          </div>
        </details>
      </fieldset>

      <div v-else-if="step === 'sources'" key="sources" class="studio-stack">
        <p v-if="materialCount === undefined && !materialError" role="status" class="tp-caption">正在读取项目资料…</p>
        <div v-else-if="materialError" role="alert" class="studio-notice screen-actions">
          {{ materialError }}<TpButton size="sm" :disabled="busy" @click="readMaterials">重试读取资料</TpButton>
        </div>
        <MaterialSourceBinding v-else-if="created && materialCount" :services="services" :project-id="created.id" :refresh-token="0" />
        <div v-else-if="created" class="studio-notice studio-stack">
          <p>这个项目还没有模板或要求资料。可以先开始写作，之后在资料页上传并绑定解析版本。</p>
          <RouterLink class="studio-link" :to="materialsRoute(created.id)">打开资料页 ↗</RouterLink>
        </div>
      </div>

      <div v-else key="start" class="studio-stack">
        <p class="studio-copy">从空白正式稿开始，或进入写作页导入已有论文原件。</p>
      </div>
    </Transition>

    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <div v-if="error" :key="error" role="alert" class="studio-notice studio-stack">
        <p>{{ error }}</p>
        <div v-if="mustReload || (uncertain && !busy)" class="screen-actions">
          <TpButton v-if="mustReload" size="sm" @click="reloadLatest">载入最新项目</TpButton>
          <TpButton v-if="uncertain && match" size="sm" variant="primary" @click="adopt">继续设置此项目</TpButton>
          <TpButton v-if="uncertain && !verified" size="sm" @click="retryVerify">重新核对项目列表</TpButton>
        </div>
      </div>
    </Transition>

    <div class="screen-actions">
      <template v-if="step === 'start'">
        <TpButton variant="primary" :loading="busy" :disabled="busy" @click="startBlank">创建空白正文</TpButton>
        <TpButton :disabled="busy" @click="created && $emit('done', created)">稍后在写作页导入</TpButton>
      </template>
      <TpButton v-else type="submit" variant="primary" :loading="busy" :disabled="busy || mustReload || (uncertain && !verified) || picker.busy.value">
        {{ step === "plan" ? (created ? "保存并继续" : uncertain && !match ? "重新创建并继续" : "创建项目并继续") : "下一步" }}
      </TpButton>
      <TpButton v-if="step === 'basics' && !created" :disabled="busy || (uncertain && !verified)" @click="createNow">创建项目</TpButton>
      <TpButton v-if="index > 0" variant="ghost" :disabled="busy" @click="back">上一步</TpButton>
      <TpButton variant="ghost" :disabled="busy" @click="cancel()">{{ created ? "收起" : "取消" }}</TpButton>
    </div>
  </form>
</template>

<style scoped>
.project-setup__steps {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  counter-reset: setup;
}
.project-setup__steps li {
  counter-increment: setup;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--tp-text-faint);
}
.project-setup__steps li::before {
  content: counter(setup);
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--tp-line-strong);
  border-radius: 999px;
  font-size: 12px;
}
.project-setup__steps li[data-state="current"] {
  color: var(--tp-text);
  font-weight: 600;
}
.project-setup__steps li[data-state="current"]::before {
  border-color: var(--tp-accent);
  background: var(--tp-accent-soft);
  color: var(--tp-accent-soft-content);
}
.project-setup__steps li[data-state="done"] {
  color: var(--tp-text-muted);
}
.project-setup__steps li[data-state="done"]::before {
  border-color: var(--tp-accent);
  color: var(--tp-accent);
}
.project-setup__fields {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.project-setup__plan {
  gap: 8px;
  align-items: flex-start;
}
.project-setup textarea {
  width: 100%;
  resize: vertical;
}
</style>
