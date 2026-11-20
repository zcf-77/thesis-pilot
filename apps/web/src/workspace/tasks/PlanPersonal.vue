<script setup lang="ts">
import { nextTick, onScopeDispose, ref, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import type { BackendServices, ProjectRead } from "@/services";
import { asApiError } from "@/services/errors";

const props = defineProps<{ services: BackendServices; project: ProjectRead; disabled?: boolean }>();
const emit = defineEmits<{ updated: [project: ProjectRead] }>();

const open = ref(false);
const mode = ref<ProjectRead["planning_mode"]>("none");
const note = ref("");
const busy = ref(false);
const error = ref("");
const conflict = ref(false);
const form = ref<HTMLFormElement>();
const trigger = ref<InstanceType<typeof TpButton>>();
let request: AbortController | undefined;

function begin() {
  mode.value = props.project.planning_mode;
  note.value = props.project.plan_note;
  error.value = "";
  conflict.value = false;
  open.value = true;
  void nextTick(() => form.value?.querySelector<HTMLElement>("[role=radio][aria-checked=true], button")?.focus());
}
function close() {
  if (busy.value) return;
  open.value = false;
  error.value = "";
  void nextTick(() => (trigger.value?.$el as HTMLElement | undefined)?.focus());
}
async function save() {
  if (busy.value) return;
  const base = props.project;
  const text = mode.value === "personal" ? note.value.trim() : "";
  if (base.planning_mode === mode.value && base.plan_note === text) return close();
  request?.abort();
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  error.value = "";
  try {
    const latest = await props.services.projects.update(
      base.id,
      { expected_version: base.version, planning_mode: mode.value, plan_note: text },
      controller.signal,
    );
    if (controller.signal.aborted) return;
    emit("updated", latest);
    busy.value = false;
    close();
  } catch (issue) {
    if (controller.signal.aborted) return;
    const problem = asApiError(issue);
    conflict.value = problem.code === "PROJECT_VERSION_CONFLICT";
    error.value = problem.message;
  } finally {
    if (request === controller) busy.value = false;
  }
}
async function reloadProject() {
  try {
    const latest = await props.services.projects.get(props.project.id);
    emit("updated", latest);
    conflict.value = false;
    error.value = "已载入最新设置，当前输入仍保留。";
  } catch (issue) {
    error.value = asApiError(issue).message;
  }
}
watch(
  () => props.project.id,
  () => {
    request?.abort();
    open.value = false;
    busy.value = false;
  },
);
onScopeDispose(() => request?.abort());
</script>

<template>
  <section class="screen-panel plan-planning" aria-label="个人规划" :aria-busy="busy || undefined">
    <div class="plan-planning__intro">
      <div>
        <h2 class="tp-subheading">个人规划</h2>
        <Transition name="tp-swap" mode="out-in">
          <p :key="`${project.planning_mode}:${project.plan_note}`" class="tp-caption mt-1 plan-planning__note">
            {{ project.planning_mode === "personal" ? project.plan_note || "尚未填写可用时间。" : "按任务与截止时间安排，不推测个人效率。" }}
          </p>
        </Transition>
      </div>
      <TpButton v-if="!open" ref="trigger" size="sm" variant="ghost" :disabled="disabled" @click="begin">
        {{ project.planning_mode === "personal" ? "编辑规划" : "设置个人规划" }}
      </TpButton>
    </div>
    <Transition name="tp-swap">
      <form v-if="open" ref="form" class="plan-form mt-4" aria-label="个人规划" @submit.prevent="save" @keydown.esc.prevent="close">
        <TpSegmented
          v-model="mode"
          label="规划方式"
          :options="[
            { value: 'none', label: '暂不规划' },
            { value: 'personal', label: '填写规划' },
          ]"
        />
        <Transition name="tp-swap">
          <TpField v-if="mode === 'personal'" v-slot="field" label="可用时间与安排" optional hint="作为 AI 调整候选的参考，不会自动移动任务。">
            <textarea
              :id="field.id"
              v-model="note"
              class="tp-input"
              rows="3"
              maxlength="2000"
              :aria-describedby="field.describedby"
              placeholder="例如每周三、周六安排实验，周日整理写作。"
              @keydown.enter.ctrl.prevent="save"
              @keydown.enter.meta.prevent="save"
            />
          </TpField>
        </Transition>
        <Transition name="tp-swap">
          <p v-if="error" :key="error" class="plan-planning__error" :role="conflict ? 'alert' : 'status'">{{ error }}</p>
        </Transition>
        <div class="screen-actions">
          <TpButton type="submit" variant="primary" size="sm" :loading="busy" :disabled="conflict">保存规划</TpButton>
          <TpButton v-if="conflict" size="sm" @click="reloadProject">载入最新设置</TpButton>
          <TpButton size="sm" variant="ghost" :disabled="busy" @click="close">取消</TpButton>
          <span class="tp-caption">Esc 取消{{ mode === "personal" ? " · Ctrl+Enter 保存" : "" }}</span>
        </div>
      </form>
    </Transition>
  </section>
</template>

<style scoped>
.plan-planning {
  padding: 16px 20px;
}
.plan-planning__intro {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.plan-planning__intro > div {
  min-width: 0;
}
.plan-planning__note {
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.plan-form {
  display: grid;
  gap: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--tp-line);
}
.plan-form .screen-actions {
  align-items: center;
  flex-wrap: wrap;
}
.plan-planning__error {
  padding: 10px 14px;
  border-left: 2px solid var(--tp-warning);
  background: var(--tp-surface-sunken);
  font-size: 13px;
}
@media (max-width: 700px) {
  .plan-planning {
    padding: 16px;
  }
  .plan-planning__intro {
    align-items: flex-start;
    flex-wrap: wrap;
  }
}
</style>
