<script setup lang="ts">
import { PhSignOut } from "@phosphor-icons/vue";
import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import { themes, type ThemeId } from "@/design/tokens";
import { asApiError } from "@/services/errors";
import { workspaceAccess, type WorkspaceProfile, type WorkspaceSession } from "@/services/workspace";
import { useAppearanceStore } from "@/stores/appearance";
import { mergeProfileDraft, profileDraft } from "./workspaceProfile";

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
    else readError.value = "无法读取最新偏好，请重试。";
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
    <div class="screen-page workspace-page">
      <header class="screen-heading workspace-heading"><h1 class="tp-display">账户与偏好</h1></header>

      <div class="screen-columns">
        <section class="screen-panel">
          <header class="screen-panel__head"><h2 class="tp-subheading">个人偏好</h2></header>
          <form class="studio-body studio-stack" :aria-busy="busy || undefined" @submit.prevent="save" @keydown.esc="cancel">
            <Transition name="tp-swap" mode="out-in">
              <p v-if="reading" role="status" class="tp-caption">正在读取偏好…</p>
              <div v-else-if="readError" class="screen-actions">
                <p role="alert" class="tp-caption">{{ readError }}</p>
                <TpButton size="sm" :disabled="busy" @click="readAccount">重试</TpButton>
              </div>
            </Transition>
            <TpField v-slot="{ id, invalid, describedby }" label="显示名称" :error="nameError">
              <input
                :id="id"
                v-model="draft.display_name"
                class="tp-input"
                :readonly="busy"
                :aria-invalid="invalid || undefined"
                :aria-describedby="invalid ? describedby : undefined"
                @input="nameError = ''"
              />
            </TpField>
            <label class="studio-check">
              <input v-model="draft.notifications_enabled" type="checkbox" class="checkbox checkbox-primary checkbox-sm" :disabled="busy" />接收主动建议
            </label>
            <div class="studio-form-grid">
              <TpField v-slot="{ id }" label="静默开始"><TpDatePicker :id="id" v-model="draft.quiet_start" type="time" required :disabled="busy" /></TpField>
              <TpField v-slot="{ id }" label="静默结束"><TpDatePicker :id="id" v-model="draft.quiet_end" type="time" required :disabled="busy" /></TpField>
            </div>
            <p v-if="timeError" role="alert" class="tp-caption">{{ timeError }}</p>
            <label class="studio-check">
              <input v-model="draft.show_deferred" type="checkbox" class="checkbox checkbox-primary checkbox-sm" :disabled="busy" />显示已延后的建议
            </label>

            <Transition name="tp-swap">
              <div v-if="conflict" class="studio-notice studio-stack">
                <p role="alert">偏好已在其他会话中更新。当前输入仍保留。</p>
                <dl v-if="latest" class="studio-facts" aria-label="服务端最新偏好">
                  <dt>显示名称</dt>
                  <dd>{{ latest.display_name }}</dd>
                  <dt>主动建议</dt>
                  <dd>{{ latest.notifications_enabled ? "接收" : "关闭" }}</dd>
                  <dt>静默时段</dt>
                  <dd>{{ latest.quiet_start }}–{{ latest.quiet_end }}</dd>
                  <dt>延后建议</dt>
                  <dd>{{ latest.show_deferred ? "显示" : "隐藏" }}</dd>
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
            <Transition name="tp-swap" mode="out-in">
              <p v-if="error" :key="error" role="alert" class="studio-notice">{{ error }}</p>
              <p v-else-if="message" :key="message" role="status" class="tp-caption">{{ message }}</p>
            </Transition>
            <div class="screen-actions">
              <TpButton type="submit" variant="primary" :disabled="!dirty || busy || conflict" :loading="busy && !conflict">保存偏好</TpButton>
              <TpButton v-if="dirty && !conflict" variant="ghost" :disabled="busy" @click="cancel()">取消修改</TpButton>
            </div>
          </form>
        </section>

        <aside class="studio-stack">
          <section class="screen-panel">
            <header class="screen-panel__head"><h2 class="tp-subheading">外观</h2></header>
            <div class="studio-body studio-stack">
              <TpField v-slot="{ id }" label="主题">
                <TpSelect :id="id" :model-value="appearance.theme" :options="themeOptions" @update:model-value="appearance.setTheme($event)" />
              </TpField>
              <label class="studio-check">
                <input
                  :checked="appearance.motion === 'reduced'"
                  type="checkbox"
                  class="checkbox checkbox-primary checkbox-sm"
                  @change="appearance.toggleMotion"
                />减少动效
              </label>
            </div>
          </section>
          <section class="screen-panel">
            <header class="screen-panel__head"><h2 class="tp-subheading">当前会话</h2></header>
            <div class="studio-body studio-stack">
              <dl class="studio-facts">
                <dt>到期时间</dt>
                <dd><time :datetime="session.expires_at">{{ expiry }}</time></dd>
              </dl>
              <Transition name="tp-swap"><p v-if="exitError" role="alert" class="studio-notice">{{ exitError }}</p></Transition>
              <div class="screen-actions">
                <TpButton :disabled="exiting" :loading="exiting" @click="$emit('exit')"><TpIcon :icon="PhSignOut" />退出工作区</TpButton>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  </Transition>
</template>
