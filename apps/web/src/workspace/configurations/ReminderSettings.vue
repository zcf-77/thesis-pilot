<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef } from "vue";
import { RouterLink } from "vue-router";
import { PhSlidersHorizontal } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpState from "@/components/ui/TpState.vue";
import type { BackendServices, ReminderSettingsRead } from "@/services";
import { asApiError } from "@/services/errors";
import { accountRoute } from "../workspaceRoutes";

const props = defineProps<{ services: BackendServices }>();

const saved = shallowRef<ReminderSettingsRead>();
const enabled = ref(true);
const cooldown = ref("");
const overdue = ref("");
const loading = ref(true);
const loadError = ref("");
const busy = ref(false);
const error = ref("");
const conflict = ref(false);
const notice = ref("");
let request: AbortController | undefined;

const dirty = computed(
  () =>
    !!saved.value &&
    (enabled.value !== saved.value.enabled || cooldown.value !== String(saved.value.cooldown_hours) || overdue.value !== String(saved.value.overdue_days)),
);
function fill(value: ReminderSettingsRead) {
  saved.value = value;
  enabled.value = value.enabled;
  cooldown.value = String(value.cooldown_hours);
  overdue.value = String(value.overdue_days);
}
async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  loading.value = true;
  loadError.value = "";
  try {
    const value = await props.services.reminderSettings.get(controller.signal);
    if (!controller.signal.aborted) fill(value);
  } catch (issue) {
    if (!controller.signal.aborted) loadError.value = asApiError(issue).message;
  } finally {
    if (request === controller) loading.value = false;
  }
}
const whole = (text: string, min: number, max: number) => (/^\d{1,3}$/.test(text.trim()) && +text >= min && +text <= max ? +text : undefined);
async function save() {
  const base = saved.value;
  if (!base || busy.value) return;
  const hours = whole(cooldown.value, 1, 168);
  const days = whole(overdue.value, 1, 30);
  notice.value = "";
  if (hours === undefined || days === undefined) return void (error.value = "冷却时间须为 1—168 的整数小时，延期阈值须为 1—30 的整数天。原设置保持不变。");
  request?.abort();
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  error.value = "";
  try {
    const value = await props.services.reminderSettings.update(
      { expected_version: base.version, enabled: enabled.value, cooldown_hours: hours, overdue_days: days },
      controller.signal,
    );
    if (controller.signal.aborted) return;
    fill(value);
    conflict.value = false;
    notice.value = `提醒参数已保存为 v${value.version}，下次刷新收件箱时生效。`;
  } catch (issue) {
    if (controller.signal.aborted) return;
    const problem = asApiError(issue);
    conflict.value = problem.code === "PLAN_REMINDER_CONFLICT";
    error.value = problem.message;
  } finally {
    if (request === controller) busy.value = false;
  }
}
async function reloadLatest() {
  const draft = { enabled: enabled.value, cooldown: cooldown.value, overdue: overdue.value };
  await load();
  if (loadError.value) return;
  enabled.value = draft.enabled;
  cooldown.value = draft.cooldown;
  overdue.value = draft.overdue;
  conflict.value = false;
  error.value = "";
  notice.value = "已载入最新版本，你的输入保留在表单中，请核对后保存。";
}
function revert() {
  if (saved.value) fill(saved.value);
  error.value = "";
  notice.value = "";
}
void load();
onScopeDispose(() => request?.abort());
</script>

<template>
  <div class="reminder-settings">
    <div v-if="loading && !saved" class="screen-panel reminder-settings__loading" role="status" aria-busy="true">
      <span class="tp-btn__spinner" aria-hidden="true" />正在读取提醒参数…
    </div>
    <TpState v-else-if="loadError && !saved" class="screen-panel" kind="error" title="无法读取提醒参数" :desc="loadError" retryable @retry="load" />
    <form v-else-if="saved" class="screen-panel settings-form" aria-labelledby="reminder-title" novalidate @submit.prevent="save" @keydown.esc.prevent="revert">
      <div class="settings-section-heading">
        <div>
          <p class="tp-label">Reminder policy</p>
          <h2 id="reminder-title" class="tp-heading">提醒参数</h2>
        </div>
        <TpIcon :icon="PhSlidersHorizontal" :size="24" />
      </div>
      <label class="settings-checkbox"><input v-model="enabled" class="tp-checkbox" type="checkbox" :disabled="busy" />启用事件提醒规则</label>
      <div class="reminder-settings__grid">
        <TpField v-slot="f" label="同类事件冷却时间（小时）" hint="1—168；同一对象的同类提醒在冷却内不重复出现。"
          ><input :id="f.id" v-model="cooldown" class="tp-input" inputmode="numeric" autocomplete="off" :aria-describedby="f.describedby" :disabled="busy"
        /></TpField>
        <TpField v-slot="f" label="明显延期阈值（天）" hint="1—30；任务日期过去这么多天仍未确认，才提醒延期。"
          ><input :id="f.id" v-model="overdue" class="tp-input" inputmode="numeric" autocomplete="off" :aria-describedby="f.describedby" :disabled="busy"
        /></TpField>
      </div>
      <p class="settings-hint">没有观察到编辑不代表没有工作。学生可补充线下进展；主动提醒仍遵守账户的静默偏好。</p>
      <Transition name="tp-swap" mode="out-in">
        <p v-if="error" :key="error" class="settings-errors" role="alert">{{ error }}</p>
        <p v-else-if="notice" :key="notice" class="reminder-settings__notice" role="status">{{ notice }}</p>
      </Transition>
      <div class="screen-actions">
        <TpButton type="submit" variant="primary" :loading="busy" :disabled="!dirty || conflict">保存提醒参数</TpButton
        ><TpButton v-if="conflict" @click="reloadLatest">载入最新版本并保留输入</TpButton
        ><TpButton v-if="dirty" variant="ghost" :disabled="busy" @click="revert">还原</TpButton>
        <RouterLink :to="accountRoute" class="settings-link">查看通知静默偏好 →</RouterLink>
      </div>
      <p class="tp-caption">{{ saved.version ? `业务设置 v${saved.version}` : "尚未保存，当前为默认值" }}</p>
    </form>
  </div>
</template>

<style scoped>
.reminder-settings {
  display: grid;
  gap: 16px;
}
.reminder-settings__loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px 24px;
}
.settings-form {
  display: grid;
  gap: 16px;
  padding: 24px;
  max-width: 720px;
}
.settings-section-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  color: var(--tp-text-muted);
}
.settings-section-heading h2 {
  color: var(--tp-text);
  margin-top: 4px;
}
.settings-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.reminder-settings__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.settings-hint {
  color: var(--tp-text-muted);
  font-size: 13px;
}
.settings-errors {
  padding: 10px 14px;
  border-left: 2px solid var(--tp-danger);
  background: var(--tp-surface-sunken);
  font-size: 13px;
}
.reminder-settings__notice {
  padding: 10px 14px;
  border-left: 2px solid var(--tp-info);
  background: var(--tp-surface-sunken);
  font-size: 13px;
}
.screen-actions {
  align-items: center;
  flex-wrap: wrap;
}
.settings-link {
  margin-left: auto;
  font-size: 13px;
  text-decoration: underline;
  text-underline-offset: 4px;
}
@media (max-width: 700px) {
  .settings-form {
    padding: 16px;
  }
  .reminder-settings__grid {
    grid-template-columns: 1fr;
  }
  .settings-link {
    margin-left: 0;
  }
}
</style>
