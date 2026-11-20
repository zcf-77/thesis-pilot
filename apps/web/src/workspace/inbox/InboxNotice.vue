<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import TpField from "@/components/ui/TpField.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { NotificationRead } from "@/services";
import type { Tone } from "@/design/tone";
import { formatInboxTime, inboxKindLabel, tomorrowMorning, type InboxAction } from "./inboxModel";

const props = defineProps<{ notice: NotificationRead; busy: boolean; run: (action: InboxAction) => Promise<boolean> }>();
const form = ref<"" | "note" | "snooze">("");
const text = ref("");
const until = ref("");
const formError = ref("");
const noteField = ref<HTMLElement>();
let formVersion = 0;

const open = computed(() => props.notice.status === "unread" || props.notice.status === "read");
const status = computed<{ tone: Tone; label: string }>(() => {
  const n = props.notice;
  if (n.status === "unread") return { tone: "info", label: "未读" };
  if (n.status === "snoozed") return { tone: "ghost", label: "已延后" };
  if (n.status === "dismissed") return { tone: "ghost", label: "已忽略" };
  return { tone: "neutral", label: "已读" };
});
const objectLabel = computed(() => ({ task: "任务", feedback_item: "导师反馈", project: "项目", job: "后台任务" })[props.notice.object.type]);
const expired = computed(() => !!props.notice.snooze_until && Date.parse(props.notice.snooze_until) <= Date.now());
const delivery = computed(() =>
  props.notice.delivery === "quiet" ? "静默时段内记录，未计入未读" : props.notice.delivery === "muted" ? "主动建议关闭期间记录，未计入未读" : "",
);

async function openNote() {
  const version = ++formVersion;
  form.value = "note";
  formError.value = "";
  await nextTick();
  // Closing and reopening before the DOM update must not let an old callback focus a stale form.
  if (version === formVersion && form.value === "note") noteField.value?.querySelector("textarea")?.focus();
}
function openSnooze() {
  formVersion += 1;
  form.value = "snooze";
  formError.value = "";
  until.value = tomorrowMorning(new Date());
}
function close() {
  formVersion += 1;
  form.value = "";
  formError.value = "";
}
function cancelForm() {
  if (!props.busy) close();
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
    cancelForm();
  } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) {
    event.preventDefault();
    void saveNote();
  }
}
</script>

<template>
  <article class="screen-panel inbox-notice" :data-status="notice.status" :aria-busy="busy || undefined">
    <div class="inbox-notice__layout">
      <div class="inbox-notice__content">
        <div>
          <p class="tp-label">{{ inboxKindLabel[notice.kind] }}</p>
          <h2 class="tp-subheading inbox-notice__title">{{ notice.title }}</h2>
        </div>
        <p class="tp-caption inbox-notice__object">关联{{ objectLabel }} · 来源 v{{ notice.object.source_version }}</p>
        <p class="inbox-notice__reason"><span class="tp-label">触发原因</span><span>{{ notice.trigger }}</span></p>
        <details class="tp-disclosure inbox-notice__details">
          <summary>依据与不确定性</summary>
          <dl class="studio-facts">
            <dt>依据</dt>
            <dd>
              <ul class="inbox-basis">
                <li v-for="(item, index) in notice.basis" :key="index">{{ item }}</li>
              </ul>
            </dd>
            <dt>不确定</dt>
            <dd>{{ notice.uncertainty }}</dd>
          </dl>
        </details>
      </div>

      <aside class="inbox-notice__side">
        <div class="inbox-notice__status">
          <TpStatus :tone="status.tone" :label="status.label" size="sm" />
          <time class="tp-caption" :datetime="notice.created_at">{{ formatInboxTime(notice.created_at) }}</time>
        </div>
        <p v-if="delivery" class="tp-caption">{{ delivery }}</p>
        <p v-if="notice.snooze_until" class="tp-caption inbox-notice__snooze">
          延后至 {{ formatInboxTime(notice.snooze_until) }}<span v-if="expired"> · 已到期，可放回待留意</span>
        </p>
        <div v-if="!form" class="inbox-notice__next">
          <p class="tp-label">下一步</p>
          <div class="screen-actions">
            <TpButton variant="primary" size="sm" :disabled="busy" @click="run({ kind: 'view' })">查看并处理</TpButton>
            <template v-if="open">
              <TpButton variant="outline" size="sm" :disabled="busy" @click="openNote">补充线下进展</TpButton>
              <TpButton variant="ghost" size="sm" :disabled="busy" @click="openSnooze">延后</TpButton>
              <TpButton variant="ghost" size="sm" :disabled="busy" @click="run({ kind: 'dismiss' })">忽略</TpButton>
            </template>
            <TpButton v-else variant="outline" size="sm" :disabled="busy" @click="run({ kind: 'restore' })">放回待留意</TpButton>
          </div>
        </div>
      </aside>
    </div>

    <section v-if="notice.progress_notes.length" class="inbox-notice__notes" aria-label="线下进展补充">
      <p class="tp-label">我的补充</p>
      <ul>
        <li v-for="(note, index) in notice.progress_notes" :key="index">
          <time class="tp-caption" :datetime="note.created_at">{{ formatInboxTime(note.created_at) }}</time>
          <p>{{ note.text }}</p>
        </li>
      </ul>
    </section>

    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <form v-if="form === 'note'" key="note" ref="noteField" class="studio-stack inbox-notice__form" @submit.prevent="saveNote" @keydown="noteKeys">
        <TpField v-slot="{ id }" label="线下进展" hint="Ctrl 或 ⌘ + Enter 保存，Esc 取消" :error="formError">
          <textarea :id="id" v-model="text" class="tp-input" rows="3" maxlength="2000" :disabled="busy" @input="formError = ''" />
        </TpField>
        <div class="screen-actions">
          <TpButton type="submit" variant="primary" size="sm" :loading="busy" :disabled="busy">保存补充</TpButton>
          <TpButton variant="ghost" size="sm" :disabled="busy" @click="close">取消</TpButton>
        </div>
      </form>
      <form v-else-if="form === 'snooze'" key="snooze" class="studio-stack inbox-notice__form" @submit.prevent="saveSnooze" @keydown.esc.prevent="cancelForm">
        <TpField v-slot="{ id }" label="延后到" :error="formError">
          <TpDatePicker :id="id" v-model="until" type="datetime-local" required :disabled="busy" @update:model-value="formError = ''" />
        </TpField>
        <p class="tp-caption">到期后回到待留意；不改动关联对象。</p>
        <div class="screen-actions">
          <TpButton type="submit" variant="primary" size="sm" :loading="busy" :disabled="busy">保存延后时间</TpButton>
          <TpButton variant="ghost" size="sm" :disabled="busy" @click="close">取消</TpButton>
        </div>
      </form>
    </Transition>
  </article>
</template>

<style scoped>
.inbox-notice {
  min-width: 0;
  overflow: hidden;
}
.inbox-notice__layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 320px);
  gap: 24px;
  padding: 24px;
}
.inbox-notice__content {
  display: grid;
  align-content: start;
  gap: 12px;
  min-width: 0;
}
.inbox-notice__title {
  margin-top: 8px;
  overflow-wrap: anywhere;
  font-size: 18px;
}
.inbox-notice__object {
  color: var(--tp-text-muted);
}
.inbox-notice__reason {
  display: grid;
  gap: 4px;
  max-width: 64em;
  line-height: 1.75;
  overflow-wrap: anywhere;
}
.inbox-notice__details {
  margin-top: 4px;
  border-top: 1px solid var(--tp-line);
  padding-top: 8px;
}
.inbox-notice__details .studio-facts {
  margin-top: 12px;
}
.inbox-basis {
  display: grid;
  gap: 4px;
}
.inbox-notice__side {
  display: grid;
  align-content: start;
  gap: 16px;
  min-width: 0;
  padding-left: 24px;
  border-left: 1px solid var(--tp-line);
}
.inbox-notice__status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.inbox-notice__status time {
  color: var(--tp-text-muted);
  font-variant-numeric: tabular-nums;
}
.inbox-notice__snooze {
  color: var(--tp-text-muted);
}
.inbox-notice__next {
  display: grid;
  gap: 8px;
}
.inbox-notice__next .screen-actions {
  align-items: stretch;
  gap: 8px;
}
.inbox-notice__notes {
  margin: 0 24px;
  padding: 20px 0 24px;
  border-top: 1px solid var(--tp-line);
}
.inbox-notice__notes ul {
  display: grid;
  gap: 16px;
  margin-top: 12px;
}
.inbox-notice__notes li + li {
  padding-top: 12px;
  border-top: 1px dashed var(--tp-line);
}
.inbox-notice__notes time {
  color: var(--tp-text-muted);
}
.inbox-notice__notes li p {
  margin-top: 4px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.inbox-notice__form {
  margin: 0 24px;
  padding: 20px 0 24px;
  border-top: 1px solid var(--tp-line);
}
@media (max-width: 800px) {
  .inbox-notice__layout {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .inbox-notice__side {
    padding: 20px 0 0;
    border-top: 1px solid var(--tp-line);
    border-left: 0;
  }
  .inbox-notice__next .screen-actions {
    align-items: center;
  }
}
@media (max-width: 600px) {
  .inbox-notice__layout {
    padding: 20px;
  }
  .inbox-notice__notes,
  .inbox-notice__form {
    margin: 0 20px;
  }
  .inbox-notice__status {
    justify-content: flex-start;
  }
}
</style>
