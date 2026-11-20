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
const nameError = ref("");
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
  nameError.value = "";
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
  nameError.value = projectNameError(draft.value.name);
  if (nameError.value) {
    nameInput.value?.focus();
    return;
  }
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
  <section class="screen-panel lifecycle-settings" aria-label="项目设置" @keydown.esc.stop="close">
    <header class="lifecycle-settings__head">
      <div>
        <h2 class="tp-heading">编辑项目</h2>
        <p class="tp-caption">修改项目资料与当前设置，不改动正文和历史版本。</p>
      </div>
    </header>
    <form class="lifecycle-settings__form" @submit.prevent="save()">
      <section class="lifecycle-section" aria-labelledby="project-basic-settings">
        <h3 id="project-basic-settings" class="tp-subheading">基本信息</h3>
        <fieldset :disabled="busy" class="lifecycle-fields">
          <TpField v-slot="{ id, invalid, describedby }" label="项目名称" required :error="nameError">
            <input
              :id="id"
              ref="nameInput"
              v-model="draft.name"
              class="tp-input"
              maxlength="200"
              required
              :aria-invalid="invalid || undefined"
              :aria-describedby="invalid ? describedby : undefined"
              @input="nameError = ''"
            />
          </TpField>
          <TpField v-slot="{ id }" label="论文题目" optional><input :id="id" v-model="draft.title" class="tp-input" maxlength="500" /></TpField>
          <TpField v-slot="{ id }" label="重要截止日期" optional><TpDatePicker :id="id" v-model="draft.deadline" :disabled="busy" /></TpField>
        </fieldset>
      </section>

      <section class="lifecycle-section" aria-labelledby="project-flow-settings">
        <h3 id="project-flow-settings" class="tp-subheading">流程与阶段</h3>
        <fieldset :disabled="busy" class="lifecycle-fields">
          <TpField v-slot="{ id }" label="项目流程">
            <TpSelect
              :id="id"
              :model-value="selectedFlow"
              :options="flowOptions"
              :disabled="busy || picker.busy.value"
              @update:model-value="picker.chooseFlow"
            />
          </TpField>
          <template v-if="selectedFlow">
            <TpField v-slot="{ id }" label="绑定流程版本" hint="项目固定使用所选版本。">
              <TpSelect :id="id" v-model="versionId" :options="versionOptions" :disabled="busy || picker.busy.value" @change="stageId = ''" />
            </TpField>
            <TpField v-slot="{ id }" label="当前阶段" hint="只标记当前位置，不自动完成任务。">
              <TpSelect :id="id" v-model="stageId" :options="stageOptions" :disabled="busy || picker.busy.value || !versionId" />
            </TpField>
          </template>
        </fieldset>
        <p v-if="picker.busy.value" role="status" class="tp-caption">正在读取流程与版本…</p>
        <div v-if="picker.error.value" role="alert" class="studio-notice lifecycle-error">
          <span>{{ picker.error.value }}</span>
          <TpButton size="sm" :disabled="picker.busy.value" @click="picker.load(base.flow_version_id ?? '', base.stage_id ?? '')">重试读取流程</TpButton>
        </div>
      </section>

      <section class="lifecycle-section" aria-labelledby="project-plan-settings">
        <h3 id="project-plan-settings" class="tp-subheading">个人规划</h3>
        <fieldset :disabled="busy" class="lifecycle-section__fields">
          <TpField
            v-slot="{ id }"
            label="规划方式"
            :hint="draft.planning_mode === 'none' ? '仍按已知截止、任务和产物提醒，不推测个人效率。' : '记录时间安排或已有约定，作为后续计划的依据。'"
          >
            <TpSelect
              :id="id"
              v-model="draft.planning_mode"
              :disabled="busy"
              :options="[
                { value: 'none', label: '暂不规划' },
                { value: 'personal', label: '个人规划' },
              ]"
            />
          </TpField>
          <Transition name="tp-swap" v-bind="panelMotionHooks">
            <TpField v-if="draft.planning_mode === 'personal'" v-slot="{ id }" label="个人规划" optional>
              <textarea :id="id" v-model="draft.plan_note" class="tp-input" rows="3" :readonly="busy" />
            </TpField>
          </Transition>
          <details class="lifecycle-artifacts" :open="!!base.existing_artifacts || undefined">
            <summary>登记已有进度与完成产物（可选）</summary>
            <TpField v-slot="{ id }" label="已有产物" optional hint="每行一项。登记事实不会自动完成任务。">
              <textarea :id="id" v-model="draft.existing_artifacts" class="tp-input" rows="3" :readonly="busy" />
            </TpField>
          </details>
        </fieldset>
      </section>

      <Transition name="tp-swap" v-bind="panelMotionHooks"
        ><p v-if="error" :key="error" role="alert" class="studio-notice lifecycle-error">{{ error }}</p></Transition
      >
      <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="notice" :key="notice" role="status" class="lifecycle-notice">{{ notice }}</p></Transition>
      <div class="screen-actions lifecycle-actions">
        <TpButton type="submit" variant="primary" :loading="busy" :disabled="busy || picker.busy.value || mustReload">保存项目</TpButton>
        <TpButton v-if="mustReload" :disabled="busy" @click="reload">载入最新项目</TpButton>
        <TpButton variant="ghost" @click="close">取消</TpButton>
      </div>
    </form>
  </section>
</template>

<style scoped>
.lifecycle-settings {
  overflow: hidden;
}
.lifecycle-settings__head {
  padding: 20px 24px;
  border-bottom: 1px solid var(--tp-line);
}
.lifecycle-settings__head p {
  margin-top: 4px;
}
.lifecycle-settings__form,
.lifecycle-section__fields {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}
.lifecycle-settings__form {
  padding: 24px;
}
.lifecycle-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--tp-line);
}
.lifecycle-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  padding: 0;
  margin: 0;
  border: 0;
  min-width: 0;
}
.lifecycle-section__fields {
  padding: 0;
  margin: 0;
  border: 0;
}
.lifecycle-settings textarea {
  width: 100%;
  resize: vertical;
}
.lifecycle-artifacts {
  padding-top: 4px;
}
.lifecycle-artifacts > summary {
  display: flex;
  min-height: 36px;
  align-items: center;
  color: var(--tp-text-muted);
  font-size: 13px;
  font-weight: 600;
}
.lifecycle-artifacts > .tp-field {
  margin-top: 12px;
}
.lifecycle-error {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  border-color: var(--tp-danger);
  color: var(--tp-danger-content);
}
.lifecycle-notice {
  color: var(--tp-success-content);
  font-size: 13px;
}
.lifecycle-actions {
  padding-top: 4px;
}
@media (max-width: 700px) {
  .lifecycle-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 480px) {
  .lifecycle-settings__head,
  .lifecycle-settings__form {
    padding: 20px;
  }
}
</style>
