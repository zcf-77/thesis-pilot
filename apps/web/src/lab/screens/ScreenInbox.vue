<script setup lang="ts">
import { listMotionHooks } from "@/design/motion";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import { computed, ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpTabs from "@/components/ui/TpTabs.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { usePreviewWorkspaceStore } from "../state/previewWorkspace";
import { useInboxState, receiveNotification, updateSuggestion, appendInboxHistory, type InboxSuggestion } from "../state/inboxState";
import { projectNotificationPolicy } from "../services/eventService";
const workspace = usePreviewWorkspaceStore();
const state = useInboxState();
const router = useRouter();
const route = useRoute();
const tab = ref("active");
const snoozeId = ref("");
const snoozeUntil = ref("");
const offlineId = ref("");
const offlineText = ref("");
const message = ref("");
const scenario = ref("no-edit");
const overdueDays = ref(5);
const tabs = [
  { value: "active", label: "待留意" },
  { value: "snoozed", label: "已延后" },
  { value: "dismissed", label: "已忽略" },
  { value: "history", label: "操作记录" },
];
watch(
  () => route.query.tab,
  (value) => {
    if (typeof value === "string" && tabs.some((t) => t.value === value)) tab.value = value;
  },
  { immediate: true },
);
const visible = computed(() => state.value.suggestions.filter((s) => (tab.value === "active" ? ["unread", "read"].includes(s.state) : s.state === tab.value)));
const events = computed(() =>
  [...(state.value.history ?? []), ...workspace.events.filter((e) => e.projectId === workspace.activeId)].sort(
    (a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0),
  ),
);
const formatTime = (value: string) => (Number.isNaN(Date.parse(value)) ? value : new Date(value).toLocaleString("zh-CN"));
function setState(s: InboxSuggestion, status: InboxSuggestion["state"]) {
  updateSuggestion(state.value, s, status);
}
function view(s: InboxSuggestion) {
  setState(s, "read");
  void router.push(s.route);
}
function supply(s: InboxSuggestion) {
  if (!offlineText.value.trim()) return;
  s.offline.push(offlineText.value.trim());
  s.state = "read";
  appendInboxHistory(state.value, "补充线下进展", offlineText.value.trim(), s.id, s.route);
  offlineId.value = "";
  offlineText.value = "";
}
function openSnooze(s: InboxSuggestion) {
  snoozeId.value = s.id;
  const next = new Date(Date.now() + 86400000);
  next.setMinutes(next.getMinutes() - next.getTimezoneOffset());
  snoozeUntil.value = next.toISOString().slice(0, 16);
  message.value = "";
}
function snooze(s: InboxSuggestion) {
  if (!snoozeUntil.value || Date.parse(snoozeUntil.value) <= Date.now()) {
    message.value = "请选择未来的延后截止时间。";
    return;
  }
  message.value = updateSuggestion(state.value, s, "snoozed", snoozeUntil.value);
  if (!message.value) {
    snoozeId.value = "";
    tab.value = "snoozed";
  }
}
function trigger() {
  const key = scenario.value;
  const title =
    key === "overdue" ? "留意任务的延期情况" : key === "chapter" ? "章节完成，安排一次自查" : key === "stage" ? "阶段完成，看看下一步" : "补充最近的工作进展";
  const result = receiveNotification(
    state.value,
    {
      id: crypto.randomUUID(),
      projectId: workspace.current.id,
      type: key === "chapter" ? "task-confirmed" : key === "stage" ? "stage-completed" : key === "overdue" ? "overdue" : "no-edit",
      objectId: "preview:" + key,
      sourceVersion: workspace.current.document.version,
      overdueDays: overdueDays.value,
      title,
      detail: "这是由你触发的事件预览，可查看关联内容、补充线下产物或稍后处理。",
      basis: "自制测试事件 · 当前正文 v" + workspace.current.document.version + (key === "overdue" ? ` · 模拟延期 ${overdueDays.value} 天` : ""),
      uncertainty: "没有观察到编辑，不代表没有工作。",
      route: key === "chapter" ? "/screens/review" : key === "stage" ? "/screens/today" : "/screens/plan",
    },
    projectNotificationPolicy(workspace.current, workspace),
  );
  message.value = result.message;
  if (result.action === "created") tab.value = "active";
}
</script>
<template>
  <div class="screen-page">
    <header class="screen-heading">
      <div>
        <p class="tp-label">Inbox · 只在需要时，轻轻提醒</p>
        <h1 class="tp-display mt-3">收件箱</h1>
        <p class="screen-lead">建议有依据，决定有余地。按自己的节奏处理。</p>
      </div>
      <RouterLink class="tp-btn tp-btn--outline" to="/screens/account">提醒偏好</RouterLink>
    </header>
    <TpTabs v-model="tab" :tabs="tabs" label="建议分类" />
    <Transition name="tp-swap" mode="out-in">
      <TransitionGroup
        key="history"
        name="tp-list"
        tag="div"
        v-bind="listMotionHooks"
        v-if="tab === 'history'"
        class="tp-list-group screen-panel studio-body studio-stack"
      >
        <article v-for="event in events" :key="event.id" class="studio-history-row">
          <p class="tp-caption">{{ formatTime(event.at) }}</p>
          <h3 class="tp-subheading mt-2">{{ event.title }}</h3>
          <p class="studio-copy">{{ event.detail }}</p>
          <RouterLink :to="event.route" class="studio-link">打开关联内容 ↗</RouterLink>
        </article>
        <p key="empty-history" v-if="!events.length" class="tp-caption">当前项目还没有新的操作记录。</p>
      </TransitionGroup>
      <TransitionGroup key="suggestions" name="tp-list" tag="div" v-bind="listMotionHooks" v-else class="tp-list-group studio-grid">
        <article v-for="item in visible" :key="item.id" class="screen-panel studio-body studio-stack">
          <div class="studio-row">
            <span class="tp-label">{{ formatTime(item.at) }}</span
            ><TpStatus
              :tone="item.state === 'unread' ? 'info' : 'ghost'"
              :label="item.state === 'unread' ? '未读' : item.state === 'snoozed' ? '已延后' : item.state === 'dismissed' ? '已忽略' : '已读'"
            />
          </div>
          <h2 class="tp-title">{{ item.title }}</h2>
          <p class="studio-copy">{{ item.detail }}</p>
          <dl class="studio-facts">
            <dt>依据</dt>
            <dd>{{ item.basis }}</dd>
            <dt>不确定</dt>
            <dd>{{ item.uncertainty }}</dd>
            <template v-if="item.occurrences && item.occurrences > 1"
              ><dt>合并</dt>
              <dd>同一对象的 {{ item.occurrences }} 条事件，最近更新 {{ formatTime(item.lastMergedAt ?? item.at) }}</dd></template
            >
            <template v-if="item.snoozedUntil"
              ><dt>延后至</dt>
              <dd>{{ formatTime(item.snoozedUntil) }}<span v-if="Date.parse(item.snoozedUntil) <= Date.now()"> · 已到期，可放回待留意</span></dd></template
            >
          </dl>
          <ul v-if="item.offline.length" class="studio-notice">
            <li v-for="(note, i) in item.offline" :key="i">我的补充：{{ note }}</li>
          </ul>
          <Transition name="tp-swap" mode="out-in">
            <form :key="'offline:' + item.id" v-if="offlineId === item.id" class="studio-stack" @submit.prevent="supply(item)" @keydown.esc="offlineId = ''">
              <TpField v-slot="{ id }" label="线下进展"><input :id="id" v-model="offlineText" class="tp-input" /></TpField>
              <div class="screen-actions">
                <TpButton type="submit" variant="primary">保存补充</TpButton><TpButton variant="ghost" @click="offlineId = ''">取消</TpButton>
              </div>
            </form>
          </Transition>
          <Transition name="tp-swap" mode="out-in">
            <form :key="'snooze:' + item.id" v-if="snoozeId === item.id" class="studio-stack" @submit.prevent="snooze(item)" @keydown.esc="snoozeId = ''">
              <TpField v-slot="{ id }" label="延后截止时间"><TpDatePicker :id="id" v-model="snoozeUntil" type="datetime-local" required /></TpField>
              <p class="tp-caption">保留这条建议与依据；到期可自行放回，不会自动修改计划。</p>
              <div class="screen-actions">
                <TpButton type="submit" variant="primary">保存延后时间</TpButton><TpButton variant="ghost" @click="snoozeId = ''">取消</TpButton>
              </div>
            </form>
          </Transition>
          <div class="screen-actions">
            <TpButton variant="primary" @click="view(item)">查看并处理</TpButton
            ><template v-if="tab === 'active'"
              ><TpButton @click="offlineId = item.id">补充线下进展</TpButton><TpButton variant="ghost" @click="openSnooze(item)">延后</TpButton
              ><TpButton variant="ghost" @click="setState(item, 'dismissed')">忽略</TpButton></template
            ><TpButton v-else @click="setState(item, 'unread')">放回待留意</TpButton>
          </div>
        </article>
        <section key="empty-notifications" v-if="!visible.length" class="studio-empty">
          <h2 class="tp-subheading">这一栏暂时没有建议</h2>
          <p class="tp-caption mt-3">查看其他分类，或继续专注当前的工作。</p>
        </section>
      </TransitionGroup>
    </Transition>
    <Transition name="tp-swap" mode="out-in">
      <p :key="message" v-if="message" role="status" class="studio-notice">{{ message }}</p>
    </Transition>
    <details class="screen-panel studio-body">
      <summary class="tp-caption">预览场景 · 主动提醒的去重与静默</summary>
      <div class="screen-actions mt-4">
        <TpField v-slot="{ id }" label="预览事件"
          ><TpSelect
            :id="id"
            v-model="scenario"
            :options="[
              { value: 'no-edit', label: '无可观察编辑' },
              { value: 'overdue', label: '明显延期' },
              { value: 'chapter', label: '章节完成' },
              { value: 'stage', label: '阶段完成' },
            ]"
        /></TpField>
        <Transition name="tp-swap">
          <TpField v-if="scenario === 'overdue'" v-slot="{ id }" label="模拟延期天数"
            ><input :id="id" v-model.number="overdueDays" type="number" min="0" class="tp-input"
          /></TpField>
        </Transition>
        <TpButton @click="trigger">触发同类事件预览</TpButton>
      </div>
    </details>
  </div>
</template>
