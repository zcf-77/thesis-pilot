<script setup lang="ts">
import { onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpState from "@/components/ui/TpState.vue";
import TpTabs from "@/components/ui/TpTabs.vue";
import { listMotionHooks } from "@/design/motion";
import type { BackendServices, NotificationEventRead, NotificationRead, NotificationTransition, ProjectRead } from "@/services";
import { asApiError } from "@/services/errors";
import { accountRoute, inboxRoute, inboxTabs, type InboxTab } from "../workspaceRoutes";
import InboxNotice from "./InboxNotice.vue";
import { formatInboxTime, inboxEventLabel, inboxTarget, type InboxAction } from "./inboxModel";

const props = defineProps<{ services: BackendServices; project: ProjectRead }>();
const emit = defineEmits<{ unread: [projectId: string, count: number] }>();
const route = useRoute();
const router = useRouter();
const PAGE = 50;
const UNCERTAIN = new Set(["REQUEST_TIMEOUT", "NETWORK_ERROR"]);
const RELOAD = new Set(["NOTICE_VERSION_CONFLICT", "NOTICE_TRANSITION_INVALID", "NOTICE_NOT_FOUND"]);
const tabs: { value: InboxTab; label: string }[] = [
  { value: "active", label: "待留意" },
  { value: "snoozed", label: "已延后" },
  { value: "dismissed", label: "已忽略" },
  { value: "history", label: "操作记录" },
];
const parseTab = (value: unknown): InboxTab => ((inboxTabs as readonly unknown[]).includes(value) ? (value as InboxTab) : "active");
const tab = ref<InboxTab>(parseTab(route.query.tab));
const items = shallowRef<NotificationRead[]>([]);
const total = ref(0);
const history = shallowRef<NotificationEventRead[]>([]);
const historyTotal = ref(0);
const loaded = ref(false);
const loading = ref(false);
const listError = ref("");
const actionError = ref("");
const busyId = ref("");
/** 网络不确定时保留命令编号，重试同一操作由服务端按幂等返回原结果。 */
const commands = new Map<string, string>();
let request: AbortController | undefined;
let mutation: AbortController | undefined;
let disposed = false;

async function load(more = false) {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const current = tab.value;
  loading.value = true;
  listError.value = "";
  try {
    if (current === "history") {
      const page = await props.services.notifications.events(props.project.id, { limit: PAGE, offset: more ? history.value.length : 0 }, controller.signal);
      if (controller.signal.aborted) return;
      history.value = more ? [...history.value, ...page.items] : page.items;
      historyTotal.value = page.total;
    } else {
      const page = await props.services.notifications.list(
        props.project.id,
        { tab: current, limit: PAGE, offset: more ? items.value.length : 0 },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      items.value = more ? [...items.value, ...page.items] : page.items;
      total.value = page.total;
      emit("unread", props.project.id, page.unread_count);
    }
    loaded.value = true;
  } catch (error) {
    if (!controller.signal.aborted) listError.value = asApiError(error).message;
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}

async function mutate(notice: NotificationRead, input: Omit<NotificationTransition, "command_id" | "expected_version"> | { text: string }): Promise<boolean> {
  const key = `${notice.id}:${notice.version}:${JSON.stringify(input)}`;
  const commandId = commands.get(key) ?? crypto.randomUUID();
  commands.set(key, commandId);
  mutation?.abort();
  const controller = new AbortController();
  mutation = controller;
  busyId.value = notice.id;
  actionError.value = "";
  try {
    const base = { command_id: commandId, expected_version: notice.version };
    if ("text" in input) await props.services.notifications.addProgressNote(props.project.id, notice.id, { ...base, text: input.text }, controller.signal);
    else await props.services.notifications.transition(props.project.id, notice.id, { ...base, ...input }, controller.signal);
    commands.delete(key);
    if (!disposed) await load();
    return true;
  } catch (error) {
    if (controller.signal.aborted || disposed) return false;
    const issue = asApiError(error);
    if (!UNCERTAIN.has(issue.code)) commands.delete(key);
    actionError.value = issue.message;
    if (RELOAD.has(issue.code)) void load();
    return false;
  } finally {
    if (mutation === controller) busyId.value = "";
  }
}

async function run(notice: NotificationRead, action: InboxAction): Promise<boolean> {
  if (busyId.value) return false;
  if (action.kind === "view") {
    if ((notice.status === "unread" || notice.status === "snoozed") && !(await mutate(notice, { action: "read" }))) return false;
    if (!disposed) void router.push(inboxTarget(notice, props.project.id, props.services.sourceKey));
    return true;
  }
  if (action.kind === "note") return mutate(notice, { text: action.text });
  if (action.kind === "snooze") {
    const ok = await mutate(notice, { action: "snooze", snooze_until: action.until });
    if (ok && tab.value === "active") tab.value = "snoozed";
    return ok;
  }
  return mutate(notice, { action: action.kind });
}

watch(
  () => route.query.tab,
  (value) => {
    tab.value = parseTab(value);
  },
);
watch(tab, (value) => {
  actionError.value = "";
  if (parseTab(route.query.tab) !== value) void router.replace(inboxRoute(props.project.id, value));
  void load();
});
onMounted(async () => {
  try {
    await props.services.notifications.refresh(props.project.id);
  } catch {
    // 派生失败不阻止查看已保存的提醒；列表读取会给出可重试的错误。
  }
  if (!disposed) await load();
});
onScopeDispose(() => {
  disposed = true;
  request?.abort();
  mutation?.abort();
});
</script>

<template>
  <div class="screen-page inbox-page" :aria-busy="loading || undefined">
    <header class="screen-heading">
      <div>
        <p class="tp-label">Inbox · 只在需要时，轻轻提醒</p>
        <h1 class="tp-display mt-3">收件箱</h1>
        <p class="screen-lead">建议有依据，决定有余地。按自己的节奏处理。</p>
      </div>
      <RouterLink class="tp-btn tp-btn--outline" :to="accountRoute">提醒偏好</RouterLink>
    </header>
    <TpTabs v-model="tab" :tabs="tabs" label="建议分类" />
    <Transition name="tp-swap">
      <p v-if="actionError" :key="actionError" role="alert" class="studio-notice">{{ actionError }}</p>
    </Transition>
    <div v-if="!loaded && loading" class="screen-panel studio-body workspace-loading" role="status">
      <span class="tp-btn__spinner" aria-hidden="true" />正在读取收件箱…
    </div>
    <TpState v-else-if="listError && !loaded" class="screen-panel" kind="error" title="无法读取收件箱" :desc="listError" retryable @retry="load()" />
    <Transition v-else name="tp-swap" mode="out-in">
      <div v-if="tab === 'history'" key="history" class="studio-stack">
        <TransitionGroup name="tp-list" tag="div" v-bind="listMotionHooks" class="tp-list-group screen-panel studio-body studio-stack">
          <article v-for="event in history" :key="event.id" class="studio-history-row">
            <p class="tp-caption">{{ formatInboxTime(event.created_at) }} · {{ event.actor === "system" ? "系统" : "我" }}</p>
            <h3 class="tp-subheading mt-2">{{ inboxEventLabel[event.action] }} · {{ event.notification_title }}</h3>
            <p v-if="event.note" class="studio-copy inbox-note">{{ event.note }}</p>
            <p v-else-if="event.snooze_until" class="studio-copy">延后至 {{ formatInboxTime(event.snooze_until) }}</p>
            <RouterLink :to="inboxTarget(event, project.id, services.sourceKey)" class="studio-link">打开关联内容 ↗</RouterLink>
          </article>
          <p v-if="!history.length" key="empty-history" class="tp-caption">当前项目还没有新的操作记录。</p>
        </TransitionGroup>
        <TpButton v-if="history.length < historyTotal" variant="ghost" :disabled="loading" @click="load(true)">加载更早的记录</TpButton>
      </div>
      <div v-else key="notices" class="studio-stack">
        <TransitionGroup name="tp-list" tag="div" v-bind="listMotionHooks" class="tp-list-group studio-grid">
          <InboxNotice
            v-for="notice in items"
            :key="notice.id"
            :notice="notice"
            :busy="busyId === notice.id || loading"
            :run="(action) => run(notice, action)"
          />
          <section v-if="!items.length" key="empty-notifications" class="studio-empty">
            <h2 class="tp-subheading">这一栏暂时没有建议</h2>
            <p class="tp-caption mt-3">查看其他分类，或继续专注当前的工作。</p>
          </section>
        </TransitionGroup>
        <TpButton v-if="items.length < total" variant="ghost" :disabled="loading" @click="load(true)">加载更多提醒</TpButton>
      </div>
    </Transition>
    <Transition name="tp-swap">
      <p v-if="listError && loaded" :key="listError" role="alert" class="studio-notice">
        {{ listError }} <TpButton variant="ghost" size="sm" @click="load()">重新读取</TpButton>
      </p>
    </Transition>
  </div>
</template>

<style scoped>
.inbox-note {
  white-space: pre-wrap;
}
.studio-empty {
  grid-column: 1 / -1;
}
</style>
