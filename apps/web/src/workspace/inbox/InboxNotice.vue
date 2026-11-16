<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import TpField from "@/components/ui/TpField.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { NotificationRead } from "@/services";
import type { Tone } from "@/design/tone";
import { formatInboxTime, inboxKindLabel, tomorrowMorning, type InboxAction } from "./inboxModel";

const props = defineProps<{ notice: NotificationRead; busy: boolean; run: (action: InboxAction) => Promise<boolean> }>();
const form = ref<"" | "note" | "snooze">("");
const text = ref("");
const until = ref("");
const formError = ref("");
const noteField = ref<HTMLElement>();

const open = computed(() => props.notice.status === "unread" || props.notice.status === "read");
const status = computed<{ tone: Tone; label: string }>(() => {
  const n = props.notice;
  if (n.status === "unread") return { tone: "info", label: "未读" };
  if (n.status === "snoozed") return { tone: "ghost", label: "已延后" };
  if (n.status === "dismissed") return { tone: "ghost", label: "已忽略" };
  return { tone: "ghost", label: "已读" };
});
const expired = computed(() => !!props.notice.snooze_until && Date.parse(props.notice.snooze_until) <= Date.now());
const delivery = computed(() =>
  props.notice.delivery === "quiet" ? "静默时段内记录，未计入未读" : props.notice.delivery === "muted" ? "主动建议关闭期间记录，未计入未读" : "",
);

async function openNote() {
  form.value = "note";
  formError.value = "";
  await nextTick();
  noteField.value?.querySelector("textarea")?.focus();
}
function openSnooze() {
  form.value = "snooze";
  formError.value = "";
  until.value = tomorrowMorning(new Date());
}
function close() {
  form.value = "";
  formError.value = "";
}
async function saveNote() {
  if (!text.value.trim()) {
    formError.value = "请先写下线下进展。";
    return;
  }
  if (await props.run({ kind: "note", text: text.value })) {
    text.value = "";
    close();
  }
}
async function saveSnooze() {
  const time = Date.parse(until.value);
  if (!until.value || Number.isNaN(time) || time <= Date.now()) {
    formError.value = "请选择晚于现在的时间。";
    return;
  }
  if (await props.run({ kind: "snooze", until: new Date(time).toISOString() })) close();
}
function noteKeys(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) {
    event.preventDefault();
    void saveNote();
  }
}
</script>

<template>
  <article class="screen-panel studio-body studio-stack inbox-notice" :data-status="notice.status" :aria-busy="busy || undefined">
    <div class="studio-row">
      <span class="tp-label">{{ inboxKindLabel[notice.kind] }} · {{ formatInboxTime(notice.created_at) }}</span>
      <TpStatus :tone="status.tone" :label="status.label" size="sm" />
    </div>
    <h2 class="tp-title">{{ notice.title }}</h2>
    <dl class="studio-facts">
      <dt>触发</dt>
      <dd>{{ notice.trigger }}</dd>
      <dt>依据</dt>
      <dd>
        <ul class="inbox-basis">
          <li v-for="(item, index) in notice.basis" :key="index">{{ item }}</li>
        </ul>
      </dd>
      <dt>不确定</dt>
      <dd>{{ notice.uncertainty }}</dd>
      <template v-if="delivery">
        <dt>记录</dt>
        <dd>{{ delivery }}</dd>
      </template>
      <template v-if="notice.snooze_until">
        <dt>延后至</dt>
        <dd>{{ formatInboxTime(notice.snooze_until) }}<span v-if="expired"> · 已到期，可放回待留意</span></dd>
      </template>
    </dl>
    <ul v-if="notice.progress_notes.length" class="studio-notice inbox-notes">
      <li v-for="(note, index) in notice.progress_notes" :key="index">
        <span class="tp-caption">我的补充 · {{ formatInboxTime(note.created_at) }}</span>
        <p>{{ note.text }}</p>
      </li>
    </ul>
    <Transition name="tp-swap" mode="out-in">
      <form v-if="form === 'note'" key="note" ref="noteField" class="studio-stack" @submit.prevent="saveNote" @keydown="noteKeys">
        <TpField v-slot="{ id }" label="线下进展" hint="Ctrl 或 ⌘ + Enter 保存，Esc 取消" :error="formError">
          <textarea :id="id" v-model="text" class="tp-input" rows="3" maxlength="2000" :disabled="busy" @input="formError = ''" />
        </TpField>
        <div class="screen-actions">
          <TpButton type="submit" variant="primary" size="sm" :loading="busy" :disabled="busy">保存补充</TpButton>
          <TpButton variant="ghost" size="sm" :disabled="busy" @click="close">取消</TpButton>
        </div>
      </form>
      <form v-else-if="form === 'snooze'" key="snooze" class="studio-stack" @submit.prevent="saveSnooze" @keydown.esc.prevent="close">
        <TpField v-slot="{ id }" label="延后到" :error="formError">
          <TpDatePicker :id="id" v-model="until" type="datetime-local" required :disabled="busy" @update:model-value="formError = ''" />
        </TpField>
        <p class="tp-caption">到期后回到待留意；不改动任务、反馈或计划。</p>
        <div class="screen-actions">
          <TpButton type="submit" variant="primary" size="sm" :loading="busy" :disabled="busy">保存延后时间</TpButton>
          <TpButton variant="ghost" size="sm" :disabled="busy" @click="close">取消</TpButton>
        </div>
      </form>
    </Transition>
    <div v-if="!form" class="screen-actions">
      <TpButton variant="primary" size="sm" :disabled="busy" @click="run({ kind: 'view' })">查看并处理</TpButton>
      <template v-if="open">
        <TpButton variant="outline" size="sm" :disabled="busy" @click="openNote">补充线下进展</TpButton>
        <TpButton variant="ghost" size="sm" :disabled="busy" @click="openSnooze">延后</TpButton>
        <TpButton variant="ghost" size="sm" :disabled="busy" @click="run({ kind: 'dismiss' })">忽略</TpButton>
      </template>
      <TpButton v-else variant="outline" size="sm" :disabled="busy" @click="run({ kind: 'restore' })">放回待留意</TpButton>
    </div>
  </article>
</template>

<style scoped>
.inbox-notice[data-status="unread"] {
  box-shadow: inset 3px 0 0 var(--tp-accent);
}
.inbox-basis {
  display: grid;
  gap: 2px;
}
.inbox-notes {
  display: grid;
  gap: 12px;
}
.inbox-notes p {
  margin-top: 4px;
  white-space: pre-wrap;
}
</style>
