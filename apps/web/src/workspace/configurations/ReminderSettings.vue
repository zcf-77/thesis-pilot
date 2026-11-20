<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef } from "vue";
import { RouterLink } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { BackendServices, ReminderSettingsRead } from "@/services";
import { asApiError } from "@/services/errors";
import { panelMotionHooks } from "@/lab/components/integration/motion";
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
  notice.value = "已载入最新版本，输入仍保留；请核对后保存。";
}
function revert() {
  if (saved.value) fill(saved.value);
  error.value = "";
  notice.value = "";
  conflict.value = false;
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
    <form
      v-else-if="saved"
      class="screen-panel settings-form"
      aria-labelledby="reminder-title"
      novalidate
      :aria-busy="busy || undefined"
      @submit.prevent="save"
      @keydown.esc.prevent="revert"
    >
      <div class="settings-section-heading">
        <div>
          <h2 id="reminder-title" class="tp-heading">提醒参数</h2>
          <p class="tp-caption">当前 v{{ saved.version }}；只影响后续提醒。</p>
        </div>
        <TpStatus :tone="enabled ? 'success' : 'neutral'" :label="enabled ? '已启用' : '已停用'" />
      </div>
      <label class="settings-checkbox"><input v-model="enabled" class="tp-checkbox" type="checkbox" :disabled="busy" />启用事件提醒</label>
      <div class="reminder-settings__grid">
        <TpField v-slot="f" label="同类事件冷却时间（小时）" hint="1—168；冷却内不重复提醒同一对象的同类事件。">
          <input
            :id="f.id"
            v-model="cooldown"
            class="tp-input"
            inputmode="numeric"
            autocomplete="off"
            :aria-describedby="f.describedby"
            :disabled="busy"
            @input="error = ''"
          />
        </TpField>
        <TpField v-slot="f" label="明显延期阈值（天）" hint="1—30；超过期限且仍未确认时才提醒。">
          <input
            :id="f.id"
            v-model="overdue"
            class="tp-input"
            inputmode="numeric"
            autocomplete="off"
            :aria-describedby="f.describedby"
            :disabled="busy"
            @input="error = ''"
          />
        </TpField>
      </div>
      <p class="settings-hint">未观察到编辑不等于没有工作；线下进展可在收件箱补充。</p>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <p v-if="error" :key="error" class="settings-errors" role="alert">{{ error }}</p>
        <p v-else-if="notice" :key="notice" class="reminder-settings__notice" role="status">{{ notice }}</p>
      </Transition>
      <div class="screen-actions settings-actions">
        <TpButton type="submit" variant="primary" :loading="busy" :disabled="!dirty || conflict || busy">保存提醒参数</TpButton>
        <TpButton v-if="conflict" :disabled="busy" @click="reloadLatest">载入最新版本并保留输入</TpButton>
        <TpButton v-if="dirty" variant="ghost" :disabled="busy" @click="revert">还原</TpButton>
        <RouterLink :to="accountRoute" class="settings-link">通知静默偏好</RouterLink>
      </div>
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
  padding: 16px;
}
.settings-form {
  display: grid;
  gap: 16px;
  padding: 16px;
}
.settings-section-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--tp-line);
}
.settings-section-heading h2 {
  margin-bottom: 4px;
}
.settings-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  font-size: 14px;
  cursor: pointer;
}
.reminder-settings__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.settings-hint {
  margin: 0;
  color: var(--tp-text-muted);
  font-size: 13px;
}
.settings-errors,
.reminder-settings__notice {
  margin: 0;
  padding: 8px 12px;
  background: var(--tp-surface-sunken);
  font-size: 13px;
}
.settings-errors {
  border-left: 2px solid var(--tp-danger);
}
.reminder-settings__notice {
  border-left: 2px solid var(--tp-success);
}
.settings-actions {
  align-items: center;
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px solid var(--tp-line);
}
.settings-link {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  margin-left: auto;
  font-size: 13px;
  text-decoration: underline;
  text-underline-offset: 4px;
}
@media (max-width: 700px) {
  .settings-form {
    padding: 14px;
  }
  .reminder-settings__grid {
    grid-template-columns: 1fr;
  }
  .settings-link {
    margin-left: 0;
  }
}
</style>
