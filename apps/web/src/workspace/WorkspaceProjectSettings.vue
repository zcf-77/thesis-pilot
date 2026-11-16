<script setup lang="ts">
import { nextTick, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import type { ProjectRead, ProjectService, ProjectFlowService } from "@/services";
import { asApiError } from "@/services/errors";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { useFlowPicker } from "./projects/flowCatalog";
import { changedFields, draftOf, isUncertain, projectNameError } from "./projects/projectSetup";

const props = defineProps<{ project: ProjectRead; projects: ProjectService; projectFlows: ProjectFlowService }>();
const emit = defineEmits<{ updated: [project: ProjectRead]; close: [] }>();
const base = shallowRef(props.project);
const draft = ref(draftOf(props.project));
const picker = useFlowPicker(props.projectFlows);
const { selectedFlow, versionId, stageId, flowOptions, versionOptions, stageOptions } = picker;
const busy = ref(false);
const error = ref("");
const notice = ref("");
const mustReload = ref(false);
const nameInput = ref<HTMLInputElement>();
let request: AbortController | undefined;

function close() {
  request?.abort();
  picker.stop();
  emit("close");
}

function restore(project: ProjectRead) {
  base.value = project;
  draft.value = draftOf(project);
  error.value = "";
  notice.value = "";
  mustReload.value = false;
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
    void picker.load(latest.flow_version_id ?? "", latest.stage_id ?? "");
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

async function save() {
  if (busy.value || mustReload.value || picker.busy.value) return;
  error.value = "";
  notice.value = "";
  error.value = projectNameError(draft.value.name);
  if (error.value) return;
  const unchangedBinding = versionId.value === (base.value.flow_version_id ?? "") && stageId.value === (base.value.stage_id ?? "");
  error.value = picker.bindingError(unchangedBinding);
  if (error.value) return;
  const changes = changedFields({ ...draft.value, flow_version_id: versionId.value, stage_id: stageId.value }, base.value);
  if (!changes) {
    notice.value = "没有需要保存的修改。";
    return;
  }
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  try {
    const latest = await props.projects.update(base.value.id, { ...changes, expected_version: base.value.version }, controller.signal);
    if (controller.signal.aborted) return;
    restore(latest);
    emit("updated", latest);
    notice.value = "项目设置已保存。";
  } catch (problem) {
    if (controller.signal.aborted) return;
    const issue = asApiError(problem);
    mustReload.value = issue.status === 409 || isUncertain(issue);
    error.value = mustReload.value ? `${issue.message} 输入已保留；请先载入最新项目，核对是否已保存，再重新编辑。` : issue.message;
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

watch(
  () => props.project.id,
  () => {
    request?.abort();
    busy.value = false;
    restore(props.project);
    void picker.load(props.project.flow_version_id ?? "", props.project.stage_id ?? "");
  },
  { immediate: true },
);
onMounted(() => void nextTick(() => nameInput.value?.focus()));
onScopeDispose(() => request?.abort());
</script>

<template>
  <section class="screen-panel studio-body studio-stack lifecycle-settings" aria-label="项目设置" @keydown.esc.stop="close">
    <div class="studio-row">
      <h2 class="tp-subheading">编辑项目</h2>
      <span class="tp-caption">项目版本 v{{ base.version }}</span>
    </div>
    <form class="studio-stack" @submit.prevent="save()">
      <fieldset :disabled="busy" class="lifecycle-fields">
        <TpField v-slot="{ id }" label="项目名称" required
          ><input :id="id" ref="nameInput" v-model="draft.name" class="tp-input" maxlength="200" required
        /></TpField>
        <TpField v-slot="{ id }" label="论文题目" optional><input :id="id" v-model="draft.title" class="tp-input" maxlength="500" /></TpField>
        <TpField v-slot="{ id }" label="重要截止日期" optional><TpDatePicker :id="id" v-model="draft.deadline" :disabled="busy" /></TpField>
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
        <TpField v-slot="{ id }" label="项目流程"
          ><TpSelect :id="id" :model-value="selectedFlow" :options="flowOptions" :disabled="busy || picker.busy.value" @update:model-value="picker.chooseFlow"
        /></TpField>
        <template v-if="selectedFlow">
          <TpField v-slot="{ id }" label="绑定流程版本" hint="绑定后不随流程更新自动变化。"
            ><TpSelect :id="id" v-model="versionId" :options="versionOptions" :disabled="busy || picker.busy.value" @change="stageId = ''"
          /></TpField>
          <TpField v-slot="{ id }" label="当前阶段" hint="阶段仅表示当前位置，不代表已完成，也不替代任务验收。"
            ><TpSelect :id="id" v-model="stageId" :options="stageOptions" :disabled="busy || picker.busy.value || !versionId"
          /></TpField>
        </template>
      </fieldset>
      <Transition name="tp-swap" v-bind="panelMotionHooks">
        <TpField
          v-if="draft.planning_mode === 'personal'"
          v-slot="{ id }"
          label="个人规划"
          optional
          hint="可以暂不填写。系统会依据任务、产物和截止日期提醒，不推测你的效率。"
        >
          <textarea :id="id" v-model="draft.plan_note" class="tp-input" rows="3" :readonly="busy" />
        </TpField>
      </Transition>
      <details class="studio-notice" :open="!!base.existing_artifacts || undefined">
        <summary>登记已有进度与完成产物（可选）</summary>
        <div class="studio-stack mt-4">
          <TpField v-slot="{ id }" label="已有产物" optional hint="每行一项，例如开题报告、实验结果表。这里只登记事实，不自动完成任务。">
            <textarea :id="id" v-model="draft.existing_artifacts" class="tp-input" rows="3" :readonly="busy" />
          </TpField>
        </div>
      </details>
      <p v-if="picker.busy.value" role="status" class="tp-caption">正在读取流程与版本…</p>
      <div v-if="picker.error.value" role="alert" class="studio-notice screen-actions">
        {{ picker.error.value
        }}<TpButton size="sm" :disabled="picker.busy.value" @click="picker.load(base.flow_version_id ?? '', base.stage_id ?? '')">重试读取流程</TpButton>
      </div>
      <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="error" :key="error" role="alert" class="studio-notice">{{ error }}</p></Transition>
      <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="notice" :key="notice" role="status" class="tp-caption">{{ notice }}</p></Transition>
      <div class="screen-actions">
        <TpButton type="submit" variant="primary" :loading="busy" :disabled="busy || picker.busy.value || mustReload">保存项目</TpButton>
        <TpButton v-if="mustReload" :disabled="busy" @click="reload">载入最新项目</TpButton>
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
