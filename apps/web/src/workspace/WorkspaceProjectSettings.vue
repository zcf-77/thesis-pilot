<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import type { ProjectRead, ProjectService, ProjectFlowService } from "@/services";
import { asApiError } from "@/services/errors";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { projectBindingError } from "./projectLifecycle";

const props = defineProps<{ project: ProjectRead; projects: ProjectService; projectFlows: ProjectFlowService }>();
const emit = defineEmits<{ updated: [project: ProjectRead]; close: [] }>();
type Flow = Awaited<ReturnType<ProjectFlowService["get"]>>;
type FlowVersion = Awaited<ReturnType<ProjectFlowService["version"]>>;
const base = shallowRef(props.project);
const draft = ref({
  name: "",
  title: "",
  deadline: "",
  planning_mode: "none" as "none" | "personal",
  plan_note: "",
  existing_artifacts: "",
  flow_version_id: "",
  stage_id: "",
});
const flows = shallowRef<Flow[]>([]);
const versions = shallowRef<FlowVersion[]>([]);
const selectedFlow = ref("");
const selectedVersion = computed(() => versions.value.find((item) => item.id === draft.value.flow_version_id));
const flowBusy = ref(false);
const busy = ref(false);
const error = ref("");
const flowError = ref("");
const notice = ref("");
const mustReload = ref(false);
const flowOptions = computed(() => [
  { value: "", label: "不绑定流程" },
  ...flows.value.map((flow) => ({
    value: flow.id,
    label: `${flow.name}${flow.enabled ? "" : "（已停用，仅保留原绑定）"}`,
    disabled: !flow.enabled && !versions.value.some((version) => version.flow_id === flow.id && version.id === base.value.flow_version_id),
  })),
]);
const versionOptions = computed(() => [
  { value: "", label: "选择明确版本" },
  ...versions.value.map((item) => ({ value: item.id, label: `${item.name} · v${item.version}` })),
]);
const stageOptions = computed(() => [
  { value: "", label: "选择当前阶段" },
  ...(selectedVersion.value?.stages ?? []).map((stage) => ({
    value: stage.id,
    label: `${stage.name}${stage.enabled === false ? "（已停用）" : ""}`,
    disabled: stage.enabled === false,
  })),
]);
let request: AbortController | undefined;
let flowRequest: AbortController | undefined;

function close() {
  request?.abort();
  flowRequest?.abort();
  emit("close");
}

function restore(project: ProjectRead) {
  base.value = project;
  draft.value = {
    name: project.name,
    title: project.title,
    deadline: project.deadline ?? "",
    planning_mode: project.planning_mode,
    plan_note: project.plan_note,
    existing_artifacts: project.existing_artifacts,
    flow_version_id: project.flow_version_id ?? "",
    stage_id: project.stage_id ?? "",
  };
  error.value = "";
  notice.value = "";
  mustReload.value = false;
}

async function loadFlows() {
  flowRequest?.abort();
  const controller = new AbortController();
  flowRequest = controller;
  flowBusy.value = true;
  flowError.value = "";
  try {
    const all: Flow[] = [];
    let offset = 0;
    do {
      const page = await props.projectFlows.list({ offset, limit: 100 }, controller.signal);
      if (controller.signal.aborted) return;
      all.push(...page.items);
      offset += page.items.length;
      if (offset >= page.total || !page.items.length) break;
    } while (!controller.signal.aborted);
    flows.value = all;
    versions.value = [];
    selectedFlow.value = "";
    if (draft.value.flow_version_id) {
      // Resolve an immutable binding without assuming it is the flow's latest version.
      for (const flow of all) {
        let versionOffset = 0;
        do {
          const page = await props.projectFlows.versions(flow.id, { offset: versionOffset, limit: 100 }, controller.signal);
          if (controller.signal.aborted) return;
          const found = page.items.find((version) => version.id === draft.value.flow_version_id);
          if (found) {
            selectedFlow.value = flow.id;
            versions.value = page.items;
            await loadVersions(flow.id, controller);
            return;
          }
          versionOffset += page.items.length;
          if (versionOffset >= page.total || !page.items.length) break;
        } while (!controller.signal.aborted);
      }
      flowError.value = "无法定位原绑定版本；请重试读取流程，原绑定暂时保留。";
    }
  } catch (problem) {
    if (!controller.signal.aborted) flowError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) flowBusy.value = false;
  }
}

async function loadVersions(flowId: string, inherited?: AbortController) {
  if (!inherited) flowRequest?.abort();
  const controller = inherited ?? new AbortController();
  flowRequest = controller;
  flowBusy.value = true;
  flowError.value = "";
  try {
    const all: FlowVersion[] = [];
    let offset = 0;
    do {
      const page = await props.projectFlows.versions(flowId, { offset, limit: 100 }, controller.signal);
      if (controller.signal.aborted) return;
      all.push(...page.items);
      offset += page.items.length;
      if (offset >= page.total || !page.items.length) break;
    } while (!controller.signal.aborted);
    versions.value = all;
  } catch (problem) {
    if (!controller.signal.aborted) flowError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) flowBusy.value = false;
  }
}

function chooseFlow(id: string) {
  selectedFlow.value = id;
  draft.value.flow_version_id = "";
  draft.value.stage_id = "";
  versions.value = [];
  if (id) void loadVersions(id);
  else {
    flowRequest?.abort();
    flowBusy.value = false;
    flowError.value = "";
  }
}

async function reload() {
  if (busy.value) return;
  request?.abort();
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  try {
    const latest = await props.projects.get(base.value.id, controller.signal);
    if (controller.signal.aborted) return;
    restore(latest);
    emit("updated", latest);
    notice.value = "已载入最新项目，请重新检查后保存。";
    await loadFlows();
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

async function save(archived = base.value.archived) {
  if (busy.value || mustReload.value || flowBusy.value) return;
  error.value = "";
  notice.value = "";
  if (!draft.value.name.trim() || Array.from(draft.value.name.trim()).length > 200) {
    error.value = "请输入 1 至 200 个字符的项目名称。";
    return;
  }
  const unchangedBinding = draft.value.flow_version_id === (base.value.flow_version_id ?? "") && draft.value.stage_id === (base.value.stage_id ?? "");
  if (!unchangedBinding) {
    error.value =
      selectedFlow.value && !draft.value.flow_version_id
        ? "请选择明确的流程版本。"
        : projectBindingError(draft.value.flow_version_id, draft.value.stage_id, selectedVersion.value?.stages ?? []);
    if (!error.value && selectedFlow.value && !flows.value.find((flow) => flow.id === selectedFlow.value)?.enabled)
      error.value = "已停用流程不能建立新绑定，请选择启用中的流程。";
    if (error.value) return;
  }
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  try {
    const latest = await props.projects.update(
      base.value.id,
      {
        ...draft.value,
        name: draft.value.name.trim(),
        deadline: draft.value.deadline || null,
        flow_version_id: draft.value.flow_version_id || null,
        stage_id: draft.value.stage_id || null,
        archived,
        expected_version: base.value.version,
      },
      controller.signal,
    );
    if (controller.signal.aborted) return;
    restore(latest);
    emit("updated", latest);
    notice.value = archived ? "项目已归档，论文与版本记录继续保留。" : "项目设置已保存。";
  } catch (problem) {
    if (controller.signal.aborted) return;
    const issue = asApiError(problem);
    mustReload.value = issue.status === 409 || issue.status === undefined || issue.status >= 500 || issue.code === "INVALID_RESPONSE";
    error.value = mustReload.value ? `${issue.message} 输入已保留；请先载入最新项目，核对是否已保存，再重新编辑。` : issue.message;
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

watch(
  () => props.project.id,
  () => {
    request?.abort();
    flowRequest?.abort();
    busy.value = false;
    restore(props.project);
    void loadFlows();
  },
  { immediate: true },
);
onScopeDispose(() => {
  request?.abort();
  flowRequest?.abort();
});
</script>

<template>
  <section class="screen-panel studio-body studio-stack lifecycle-settings" aria-label="项目设置" @keydown.esc.stop="close">
    <div class="screen-actions lifecycle-title">
      <h2 class="tp-heading">项目设置</h2>
      <span class="tp-caption">版本 {{ base.version }} · {{ base.archived ? "已归档" : "进行中" }}</span
      ><TpButton size="sm" variant="ghost" @click="close">关闭设置</TpButton>
    </div>
    <form class="studio-stack" @submit.prevent="save()">
      <fieldset :disabled="busy" class="lifecycle-fields">
        <TpField v-slot="{ id }" label="项目名称" required><input :id="id" v-model="draft.name" class="tp-input" maxlength="200" required /></TpField>
        <TpField v-slot="{ id }" label="论文题目" optional><input :id="id" v-model="draft.title" class="tp-input" maxlength="500" /></TpField>
        <TpField v-slot="{ id }" label="项目截止日期" optional><TpDatePicker :id="id" v-model="draft.deadline" :disabled="busy" /></TpField>
        <TpField v-slot="{ id }" label="规划方式"
          ><TpSelect
            :id="id"
            v-model="draft.planning_mode"
            :disabled="busy"
            :options="[
              { value: 'none', label: '暂不规划' },
              { value: 'personal', label: '个人规划' },
            ]"
        /></TpField>
        <TpField v-slot="{ id }" label="规划说明" optional><textarea :id="id" v-model="draft.plan_note" class="tp-input" rows="3" /></TpField>
        <TpField v-slot="{ id }" label="已有产物" hint="记录已有草稿、开题报告等；本字段不上传文件。">
          <textarea :id="id" v-model="draft.existing_artifacts" class="tp-input" rows="3" />
        </TpField>
        <TpField v-slot="{ id }" label="项目流程"
          ><TpSelect :id="id" :model-value="selectedFlow" :options="flowOptions" :disabled="busy || flowBusy" @update:model-value="chooseFlow"
        /></TpField>
        <template v-if="selectedFlow">
          <TpField v-slot="{ id }" label="绑定流程版本" hint="绑定后不随流程更新自动变化。"
            ><TpSelect :id="id" v-model="draft.flow_version_id" :options="versionOptions" :disabled="busy || flowBusy" @change="draft.stage_id = ''"
          /></TpField>
          <TpField v-slot="{ id }" label="当前阶段" hint="阶段仅表示当前位置，不代表已完成，也不替代任务验收。"
            ><TpSelect :id="id" v-model="draft.stage_id" :options="stageOptions" :disabled="busy || flowBusy || !draft.flow_version_id"
          /></TpField>
        </template>
      </fieldset>
      <p v-if="flowBusy" role="status" class="tp-caption">正在读取流程与版本…</p>
      <div v-if="flowError" role="alert" class="studio-notice">
        {{ flowError }}<TpButton size="sm" :disabled="flowBusy" @click="loadFlows">重试流程</TpButton>
      </div>
      <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="error" :key="error" role="alert" class="studio-notice">{{ error }}</p></Transition>
      <p v-if="notice" role="status" class="tp-caption">{{ notice }}</p>
      <div class="screen-actions">
        <TpButton type="submit" variant="primary" :loading="busy" :disabled="busy || flowBusy || mustReload">保存项目设置</TpButton>
        <TpButton v-if="mustReload" :disabled="busy" @click="reload">载入最新项目</TpButton>
        <TpButton :disabled="busy || flowBusy || mustReload" @click="save(!base.archived)">{{ base.archived ? "恢复项目" : "归档项目" }}</TpButton>
        <TpButton variant="ghost" @click="close">取消</TpButton>
      </div>
    </form>
  </section>
</template>

<style scoped>
.lifecycle-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  padding: 0;
  margin: 0;
  border: 0;
  min-width: 0;
}
.lifecycle-title {
  justify-content: space-between;
}
.lifecycle-settings textarea {
  width: 100%;
  resize: vertical;
}
@media (max-width: 700px) {
  .lifecycle-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
