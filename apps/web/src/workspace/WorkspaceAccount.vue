<script setup lang="ts">
import { PhSignOut } from "@phosphor-icons/vue";
import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import { RouterLink } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { themes, type ThemeId } from "@/design/tokens";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { asApiError } from "@/services/errors";
import { workspaceAccess, type WorkspaceProfile, type WorkspaceSession } from "@/services/workspace";
import { useAppearanceStore } from "@/stores/appearance";
import { mergeProfileDraft, profileDraft } from "./workspaceProfile";
import { projectsRoute } from "./workspaceRoutes";

const props = defineProps<{ session: WorkspaceSession; exiting: boolean; exitError: string }>();
const emit = defineEmits<{ exit: []; profileSaved: [profile: WorkspaceProfile] }>();
const appearance = useAppearanceStore();
const themeOptions = Object.values(themes).map((theme) => ({ value: theme.id as ThemeId, label: theme.name }));
const base = shallowRef(props.session.profile);
const draft = ref(profileDraft(base.value));
const busy = ref(false);
const reading = ref(true);
const conflict = ref(false);
const latest = shallowRef<WorkspaceProfile>();
const message = ref("");
const error = ref("");
const readError = ref("");
const nameError = ref("");
const timeError = ref("");
const expiry = computed(() => new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(props.session.expires_at)));
const dirty = computed(() => {
  const previous = profileDraft(base.value);
  return (Object.keys(previous) as (keyof typeof previous)[]).some((key) => draft.value[key] !== previous[key]);
});
const statusLabel = computed(() =>
  conflict.value ? "偏好有更新" : reading.value ? "正在读取" : readError.value ? "读取失败" : dirty.value ? "有未保存修改" : "偏好已同步",
);
const statusTone = computed(() => (conflict.value || dirty.value ? "warning" : reading.value ? "ghost" : readError.value ? "danger" : "success"));
const quietSummary = computed(() => {
  const start = draft.value.quiet_start;
  const end = draft.value.quiet_end;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end)) return "";
  if (start === end) return "开始与结束相同，不启用静默时段。";
  const range = start < end ? `每天 ${start}–${end}` : `每天 ${start} 至次日 ${end}`;
  return `${range}静默；已有建议仍会保留。`;
});
let request: AbortController | undefined;

function loadProfile(profile: WorkspaceProfile) {
  base.value = profile;
  draft.value = profileDraft(profile);
  conflict.value = false;
  latest.value = undefined;
  error.value = "";
  nameError.value = "";
  timeError.value = "";
}

watch(
  () => props.session.profile,
  (profile) => {
    if (!dirty.value && !busy.value && !conflict.value && profile.version > base.value.version) loadProfile(profile);
  },
);
watch(draft, () => (message.value = ""), { deep: true, flush: "sync" });

function cancel(event?: KeyboardEvent) {
  if (busy.value || event?.isComposing) return;
  loadProfile(props.session.profile);
}

async function readAccount() {
  if (busy.value) return;
  const controller = new AbortController();
  request = controller;
  reading.value = true;
  busy.value = true;
  readError.value = "";
  try {
    const latestSession = await workspaceAccess.getSession(controller.signal);
    if (controller.signal.aborted) return;
    if (latestSession.workspace_id !== props.session.workspace_id) {
      window.dispatchEvent(new Event("tp:workspace-session-required"));
      return;
    }
    const profile = latestSession.profile.version >= props.session.profile.version ? latestSession.profile : props.session.profile;
    if (!dirty.value && !conflict.value) loadProfile(profile);
    emit("profileSaved", profile);
  } catch (failure) {
    if (controller.signal.aborted) return;
    if (asApiError(failure).code === "WORKSPACE_SESSION_REQUIRED") window.dispatchEvent(new Event("tp:workspace-session-required"));
    else readError.value = "无法读取最新偏好，当前内容未改变，请重试。";
  } finally {
    if (!controller.signal.aborted) {
      reading.value = false;
      busy.value = false;
    }
  }
}

async function retrieveLatest(signal: AbortSignal) {
  try {
    const session = await workspaceAccess.getSession(signal);
    if (signal.aborted) return;
    if (session.workspace_id !== props.session.workspace_id || session.profile.version <= base.value.version) {
      error.value = "未能取得更新后的偏好，请重试读取。";
      return;
    }
    latest.value = session.profile;
    emit("profileSaved", session.profile);
  } catch (failure) {
    if (signal.aborted) return;
    if (asApiError(failure).code === "WORKSPACE_SESSION_REQUIRED") window.dispatchEvent(new Event("tp:workspace-session-required"));
    else error.value = "未能读取最新偏好，当前输入仍保留。";
  }
}

async function retryLatest() {
  if (busy.value) return;
  const controller = new AbortController();
  request = controller;
  error.value = "";
  busy.value = true;
  try {
    await retrieveLatest(controller.signal);
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

function useLatest(keepDraft: boolean) {
  if (!latest.value || busy.value) return;
  const newest = latest.value;
  const merged = keepDraft ? mergeProfileDraft(profileDraft(base.value), draft.value, newest) : profileDraft(newest);
  loadProfile(newest);
  draft.value = merged;
}

async function save() {
  if (!dirty.value || busy.value || conflict.value || props.exiting) return;
  const displayName = draft.value.display_name.trim();
  nameError.value = "";
  timeError.value = "";
  error.value = "";
  if (!displayName || Array.from(displayName).length > 80) {
    nameError.value = "请输入 1 至 80 个字符的显示名称。";
    return;
  }
  const clockTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!clockTime.test(draft.value.quiet_start) || !clockTime.test(draft.value.quiet_end)) {
    timeError.value = "请输入有效的静默时间，格式为 HH:mm。";
    return;
  }

  const controller = new AbortController();
  request = controller;
  busy.value = true;
  try {
    const saved = await workspaceAccess.updateProfile({ ...draft.value, display_name: displayName, expected_version: base.value.version }, controller.signal);
    if (controller.signal.aborted) return;
    if (saved.id !== base.value.id || saved.version !== base.value.version + 1) {
      error.value = "未能确认偏好已保存。当前输入仍保留，请重试。";
      return;
    }
    loadProfile(saved);
    readError.value = "";
    emit("profileSaved", saved);
    message.value = "偏好已保存。";
  } catch (failure) {
    if (controller.signal.aborted) return;
    const problem = asApiError(failure);
    if (problem.code === "WORKSPACE_PROFILE_CONFLICT") {
      conflict.value = true;
      await retrieveLatest(controller.signal);
    } else if (problem.code === "WORKSPACE_SESSION_REQUIRED") window.dispatchEvent(new Event("tp:workspace-session-required"));
    else error.value = "未能确认偏好已保存。当前输入仍保留，请重试。";
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

onMounted(() => void readAccount());
onScopeDispose(() => request?.abort());
</script>

<template>
  <Transition appear name="tp-page">
    <div class="screen-page workspace-page account-page">
      <header class="screen-heading">
        <div>
          <h1 class="tp-display">账户与偏好</h1>
          <p class="screen-lead">管理个人资料、提醒方式与外观。</p>
        </div>
        <Transition name="tp-swap" v-bind="panelMotionHooks" mode="out-in">
          <TpStatus :key="statusLabel" :tone="statusTone" :label="statusLabel" />
        </Transition>
      </header>

      <div class="screen-columns account-layout">
        <form class="screen-panel account-preferences" :aria-busy="busy || undefined" @submit.prevent="save" @keydown.esc="cancel">
          <Transition name="tp-swap" v-bind="panelMotionHooks" mode="out-in">
            <div v-if="reading" role="status" class="account-readstate"><span class="tp-btn__spinner" aria-hidden="true" />正在读取偏好…</div>
            <div v-else-if="readError" class="account-readstate account-readstate--error">
              <p role="alert">{{ readError }}</p>
              <TpButton size="sm" :disabled="busy" @click="readAccount">重试读取</TpButton>
            </div>
          </Transition>

          <section class="account-section" aria-labelledby="account-profile">
            <div class="account-section__head"><h2 id="account-profile" class="tp-heading">个人资料</h2></div>
            <TpField v-slot="{ id, invalid, describedby }" label="显示名称" :error="nameError">
              <input
                :id="id"
                v-model="draft.display_name"
                class="tp-input"
                :readonly="busy"
                maxlength="80"
                :aria-invalid="invalid || undefined"
                :aria-describedby="invalid ? describedby : undefined"
                @input="nameError = ''"
              />
            </TpField>
          </section>

          <section class="account-section" aria-labelledby="account-notifications">
            <div class="account-section__head"><h2 id="account-notifications" class="tp-heading">通知</h2></div>
            <label class="studio-check account-choice">
              <input v-model="draft.notifications_enabled" type="checkbox" class="tp-checkbox" :disabled="busy" />
              <span><b>接收主动建议</b><small>关闭不会删除已有建议。</small></span>
            </label>
            <div class="studio-form-grid account-time-grid">
              <TpField v-slot="{ id }" label="静默开始"><TpDatePicker :id="id" v-model="draft.quiet_start" type="time" required :disabled="busy" /></TpField>
              <TpField v-slot="{ id }" label="静默结束"><TpDatePicker :id="id" v-model="draft.quiet_end" type="time" required :disabled="busy" /></TpField>
            </div>
            <p v-if="timeError" role="alert" class="account-inline-error">{{ timeError }}</p>
            <Transition name="tp-swap" v-bind="panelMotionHooks" mode="out-in">
              <p v-if="quietSummary" :key="quietSummary" class="tp-caption account-quiet-summary">{{ quietSummary }}</p>
            </Transition>
            <div class="account-deferred">
              <label class="studio-check account-choice">
                <input v-model="draft.show_deferred" type="checkbox" class="tp-checkbox" :disabled="busy" />
                <span><b>在待留意中显示已延后建议</b><small>关闭后仍可在收件箱的“已延后”分类查看。</small></span>
              </label>
              <RouterLink class="studio-link" :to="projectsRoute">选择项目查看延后建议</RouterLink>
            </div>
          </section>

          <Transition name="tp-swap" v-bind="panelMotionHooks">
            <div v-if="conflict" class="account-conflict">
              <p role="alert"><strong>偏好已在其他会话中更新。</strong>当前输入仍保留。</p>
              <dl v-if="latest" class="studio-facts" aria-label="服务端最新偏好">
                <dt>显示名称</dt>
                <dd>{{ latest.display_name }}</dd>
                <dt>主动建议</dt>
                <dd>{{ latest.notifications_enabled ? "接收" : "关闭" }}</dd>
                <dt>静默时段</dt>
                <dd>{{ latest.quiet_start }}–{{ latest.quiet_end }}</dd>
                <dt>延后建议</dt>
                <dd>{{ latest.show_deferred ? "在待留意中显示" : "仅在已延后分类查看" }}</dd>
              </dl>
              <div class="screen-actions">
                <template v-if="latest">
                  <TpButton size="sm" :disabled="busy" @click="useLatest(true)">保留我的修改</TpButton>
                  <TpButton size="sm" variant="ghost" :disabled="busy" @click="useLatest(false)">使用最新偏好</TpButton>
                </template>
                <TpButton v-else size="sm" :loading="busy" :disabled="busy" @click="retryLatest">重新读取最新偏好</TpButton>
              </div>
            </div>
          </Transition>
          <Transition name="tp-swap" v-bind="panelMotionHooks" mode="out-in">
            <p v-if="error" :key="error" role="alert" class="studio-notice account-error">{{ error }}</p>
            <p v-else-if="message" :key="message" role="status" class="account-saved">{{ message }}</p>
          </Transition>
          <div class="screen-actions account-actions">
            <TpButton type="submit" variant="primary" :disabled="!dirty || busy || conflict" :loading="busy && !conflict">保存偏好</TpButton>
            <TpButton v-if="dirty && !conflict" variant="ghost" :disabled="busy" @click="cancel()">取消修改</TpButton>
          </div>
        </form>

        <aside class="studio-stack account-side">
          <section class="screen-panel studio-body studio-stack" aria-labelledby="account-appearance">
            <div><h2 id="account-appearance" class="tp-heading">外观</h2></div>
            <TpField v-slot="{ id }" label="主题">
              <TpSelect :id="id" :model-value="appearance.theme" :options="themeOptions" @update:model-value="appearance.setTheme($event)" />
            </TpField>
            <label class="studio-check account-choice">
              <input :checked="appearance.motion === 'reduced'" type="checkbox" class="tp-checkbox" @change="appearance.toggleMotion" />
              <span><b>减少动效</b><small>保留状态反馈，去除位移与缩放。</small></span>
            </label>
          </section>
          <section class="screen-panel studio-body studio-stack" aria-labelledby="account-session">
            <div><h2 id="account-session" class="tp-heading">当前会话</h2></div>
            <dl class="studio-facts">
              <dt>到期时间</dt>
              <dd><time :datetime="session.expires_at">{{ expiry }}</time></dd>
            </dl>
            <p class="tp-caption">退出不会删除正文与资料，再次解锁即可继续。</p>
            <Transition name="tp-swap" v-bind="panelMotionHooks"
              ><p v-if="exitError" role="alert" class="studio-notice account-error">{{ exitError }}</p></Transition
            >
            <div class="screen-actions">
              <TpButton :disabled="exiting" :loading="exiting" @click="$emit('exit')"><TpIcon :icon="PhSignOut" />退出工作区</TpButton>
            </div>
          </section>
        </aside>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.account-layout {
  grid-template-columns: minmax(0, 1fr) 320px;
}
.account-preferences {
  overflow: hidden;
}
.account-readstate {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  min-height: 44px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--tp-line);
  color: var(--tp-text-muted);
  font-size: 13px;
}
.account-readstate .tp-btn__spinner {
  position: static;
  flex: none;
}
.account-readstate--error {
  color: var(--tp-danger-content);
}
.account-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px;
}
.account-section + .account-section {
  border-top: 1px solid var(--tp-line);
}
.account-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.account-choice {
  align-items: flex-start;
  min-height: 36px;
}
.account-choice .tp-checkbox {
  margin-top: 3px;
}
.account-choice b {
  font-weight: 600;
}
.account-choice small {
  margin-top: 4px;
}
.account-quiet-summary {
  padding-left: 30px;
}
.account-deferred {
  padding-top: 16px;
  border-top: 1px solid var(--tp-line);
}
.account-deferred .studio-link {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  margin-left: 30px;
}
.account-inline-error {
  color: var(--tp-danger-content);
  font-size: 12px;
}
.account-conflict {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 0 24px 20px;
  padding: 16px 20px;
  border: 1px solid var(--tp-warning);
  border-radius: var(--tp-radius-m);
  background: var(--tp-warning-soft);
  color: var(--tp-warning-content);
  font-size: 13px;
  line-height: 1.75;
}
.account-error {
  margin: 0 24px 20px;
  border-color: var(--tp-danger);
  color: var(--tp-danger-content);
}
.account-saved {
  margin: 0 24px 20px;
  color: var(--tp-success-content);
  font-size: 13px;
}
.account-actions {
  padding: 20px 24px;
  border-top: 1px solid var(--tp-line);
}
.account-side .studio-copy {
  margin: 0;
}
@media (max-width: 1100px) {
  .account-layout {
    grid-template-columns: minmax(0, 1fr) 280px;
  }
}
@media (max-width: 960px) {
  .account-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 640px) {
  .account-time-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 480px) {
  .account-section,
  .account-actions {
    padding: 20px;
  }
  .account-readstate {
    padding-inline: 20px;
  }
  .account-conflict,
  .account-error,
  .account-saved {
    margin-inline: 20px;
  }
}
</style>
