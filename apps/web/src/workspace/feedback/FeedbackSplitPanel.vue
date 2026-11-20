<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { RouterLink } from "vue-router";
import { PhArrowCounterClockwise, PhCheck, PhSparkle } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { AIConfigRead, BackendServices, FeedbackSplitRead, FeedbackSuggestionRead, ProjectRead, SuggestionDecision } from "@/services";
import { asApiError } from "@/services/errors";
import TaskContentForm from "../tasks/TaskContentForm.vue";
import { copy, emptyTask, taskDraftError, type FeedbackDraft } from "../tasks/taskFeedbackDraft";
import { configurationsRoute, jobRoute } from "../workspaceRoutes";
import FeedbackInterpretationFields from "./FeedbackInterpretationFields.vue";
import { formatTime } from "./feedbackPresentation";
import {
  adoptable,
  adoptedItems,
  decision,
  draftFromSuggestion,
  isActiveSplit,
  splitCounts,
  splitStatusLabel,
  splitStatusText,
  suggestionHistoryLabels,
  suggestionTone,
} from "./feedbackSplitView";

type TaskOption = { id: string; title: string; archived: boolean };
const props = defineProps<{ services: BackendServices; project: ProjectRead; batchId: string; tasks: TaskOption[]; disabled?: boolean }>();
const emit = defineEmits<{ changed: [itemIds: string[]]; highlight: [range: { from: number; to: number } | undefined]; openItem: [itemId: string] }>();
const POLL_MS = 1500;

const split = shallowRef<FeedbackSplitRead>();
const agents = shallowRef<AIConfigRead[]>([]);
const agent = ref("");
const loaded = ref(false);
const busy = ref(false);
const error = ref("");
const announcement = ref("");
const chosen = ref<string[]>([]);
const editing = ref("");
const draft = ref<FeedbackDraft>();
const linkMode = ref("none");
const stamped = ref("");
let createCommand: string | undefined;
let decideCommand: { key: string; id: string } | undefined;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let loadRequest: AbortController | undefined;
let generation = 0;

const active = computed(() => isActiveSplit(split.value));
const counts = computed(() => splitCounts(split.value));
const suggestions = computed(() => (split.value?.status === "succeeded" ? split.value.suggestions : []));
const selectable = computed(() => suggestions.value.filter(adoptable));
const allChosen = computed(() => selectable.value.length > 0 && selectable.value.every((value) => chosen.value.includes(value.id)));
const locked = computed(() => props.disabled || busy.value);
const agentOptions = computed(() => agents.value.map((item) => ({ value: item.current_version_id, label: `${item.name} · v${item.version}` })));
const taskOptions = computed(() => [
  { value: "", label: "选择已有任务" },
  ...props.tasks.map((task) => ({ value: task.id, label: `${task.title}${task.archived ? "（已归档）" : ""}`, disabled: task.archived })),
]);

async function pages<T>(read: (offset: number) => Promise<{ items: T[]; total: number }>, signal: AbortSignal) {
  const result: T[] = [];
  for (let offset = 0; !signal.aborted;) {
    const page = await read(offset);
    result.push(...page.items);
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  }
  return result;
}

function reset() {
  clearTimeout(pollTimer);
  loadRequest?.abort();
  split.value = undefined;
  chosen.value = [];
  editing.value = "";
  draft.value = undefined;
  error.value = "";
  createCommand = decideCommand = undefined;
  loaded.value = false;
}

async function load() {
  const token = ++generation;
  loadRequest?.abort();
  const controller = new AbortController();
  loadRequest = controller;
  const { signal } = controller;
  const [latest, configs] = await Promise.allSettled([
    props.services.feedbackSplits.list(props.project.id, props.batchId, { limit: 1, offset: 0 }, signal),
    pages((offset) => props.services.aiConfigs.list({ kind: "agent", offset, limit: 100 }, signal), signal),
  ]);
  if (signal.aborted || token !== generation) return;
  const failures: string[] = [];
  if (latest.status === "fulfilled") split.value = latest.value.items[0];
  else failures.push(`整理记录读取失败：${asApiError(latest.reason).message}`);
  if (configs.status === "fulfilled")
    agents.value = configs.value.filter((item) => item.enabled && item.content.kind === "agent" && item.content.role === "content");
  else failures.push(`整理智能体读取失败：${asApiError(configs.reason).message}`);
  if (!agents.value.some((item) => item.current_version_id === agent.value)) agent.value = agents.value[0]?.current_version_id ?? "";
  error.value = failures.join("；");
  loaded.value = true;
  schedulePoll();
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const target = split.value;
  if (!target || !isActiveSplit(target)) return;
  const token = generation;
  pollTimer = setTimeout(async () => {
    try {
      const next = await props.services.feedbackSplits.get(props.project.id, target.id);
      if (token !== generation || split.value?.id !== next.id) return;
      // 轮询响应按任务状态排序：旧的进行中响应不能覆盖已结束的状态。
      if (!isActiveSplit(split.value) && isActiveSplit(next)) return;
      split.value = next;
      if (!isActiveSplit(next))
        announcement.value =
          next.status === "succeeded" ? `已整理出 ${next.suggestions.length} 条建议，逐条决定后才会成为解释项。` : splitStatusLabel[next.status];
    } catch {
      // 轮询尽力而为；下一次轮询或返回本页会恢复。
    }
    schedulePoll();
  }, POLL_MS);
}

async function run(action: () => Promise<FeedbackSplitRead>, done?: (value: FeedbackSplitRead) => void) {
  if (locked.value) return;
  const token = generation;
  busy.value = true;
  error.value = "";
  try {
    const value = await action();
    if (token !== generation) return;
    split.value = value;
    done?.(value);
    schedulePoll();
  } catch (problem) {
    if (token !== generation) return;
    const issue = asApiError(problem);
    error.value = issue.message;
    if (issue.status === 409 || issue.status === 404) void load();
  } finally {
    if (token === generation) busy.value = false;
  }
}

function start() {
  if (!agent.value) return;
  const command = (createCommand ??= crypto.randomUUID());
  void run(
    async () =>
      (await props.services.feedbackSplits.create(props.project.id, props.batchId, { command_id: command, agent_config_version_id: agent.value })).split,
    () => {
      createCommand = undefined;
      chosen.value = [];
      announcement.value = "已固定原文与智能体版本，开始整理。";
    },
  );
}
const cancel = () =>
  split.value &&
  run(
    () => props.services.feedbackSplits.cancel(props.project.id, split.value!.id),
    () => (announcement.value = "已取消整理，没有产生建议。"),
  );
const retry = () =>
  split.value &&
  run(
    async () => (await props.services.feedbackSplits.retry(props.project.id, split.value!.id, { command_id: crypto.randomUUID() })).split,
    () => (announcement.value = "已按原输入重新整理。"),
  );

function decide(decisions: SuggestionDecision[], message: string) {
  const current = split.value;
  if (!current) return;
  const key = JSON.stringify(decisions);
  // 网络未确认时重复提交沿用同一命令编号，服务端按原回执重放，不会重复采纳。
  if (decideCommand?.key !== key) decideCommand = { key, id: crypto.randomUUID() };
  const command = decideCommand.id;
  void run(
    () => props.services.feedbackSplits.decide(props.project.id, current.id, { command_id: command, decisions }),
    (value) => {
      decideCommand = undefined;
      const created = adoptedItems(current, value);
      const itemsChanged = value.suggestions.some(
        (item) => (current.suggestions.find((old) => old.id === item.id)?.state === "adopted") !== (item.state === "adopted"),
      );
      stamped.value = created.length === 1 ? (value.suggestions.find((item) => item.feedback_item_id === created[0])?.id ?? "") : "";
      chosen.value = chosen.value.filter((id) => value.suggestions.some((item) => item.id === id && adoptable(item)));
      editing.value = "";
      announcement.value = message;
      if (itemsChanged) emit("changed", created);
    },
  );
}

const adopt = (value: FeedbackSuggestionRead) => decide([decision(value, "adopt")], "已采纳 1 条建议为解释项；尚未关联证据，也不代表导师认可。");
const reject = (value: FeedbackSuggestionRead) => decide([decision(value, "reject")], "已拒绝这条建议，原文与已有解释不变。");
const undo = (value: FeedbackSuggestionRead) =>
  decide([decision(value, "undo")], value.state === "adopted" ? "已撤销采纳，对应解释项已撤回并保留历史。" : "已撤销拒绝，建议恢复待决定。");
function adoptChosen() {
  const values = selectable.value.filter((value) => chosen.value.includes(value.id));
  if (values.length)
    decide(
      values.map((value) => decision(value, "adopt")),
      `已采纳所选 ${values.length} 条建议为解释项。`,
    );
}
function toggleAll() {
  chosen.value = allChosen.value ? [] : selectable.value.map((value) => value.id);
}

function beginEdit(value: FeedbackSuggestionRead) {
  if (locked.value) return;
  editing.value = value.id;
  draft.value = draftFromSuggestion(value);
  linkMode.value = "none";
  error.value = "";
}
function changeLink(next: string, value: FeedbackSuggestionRead) {
  if (!draft.value) return;
  if (next !== "existing") draft.value.task_id = null;
  draft.value.new_task = next === "new" ? (draft.value.new_task ?? { ...emptyTask(), title: value.task_title ?? "" }) : null;
}
function cancelEdit() {
  editing.value = "";
  draft.value = undefined;
}
function saveEdit(value: FeedbackSuggestionRead) {
  const content = draft.value;
  if (!content || locked.value) return;
  if (!content.interpretation.trim()) return void (error.value = "请填写你的理解。");
  if (linkMode.value === "existing" && !content.task_id) return void (error.value = "请选择要关联的任务。");
  if (content.new_task) {
    const issue = taskDraftError(content.new_task);
    if (issue) return void (error.value = issue);
  }
  decide([decision(value, "adopt", copy(content))], "已按你的修改采纳为解释项。");
}
function onFormKeydown(event: KeyboardEvent, value: FeedbackSuggestionRead) {
  if (event.isComposing || event.defaultPrevented) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancelEdit();
  } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    saveEdit(value);
  }
}

watch(
  () => [props.project.id, props.batchId],
  () => {
    reset();
    void load();
  },
  { immediate: true },
);
let activatedOnce = false;
onActivated(() => {
  // The feedback page is cached by the shell; agents added in 配置台 and runs finished elsewhere appear on return.
  if (activatedOnce && !editing.value) void load();
  activatedOnce = true;
});
onBeforeUnmount(() => {
  generation += 1;
  clearTimeout(pollTimer);
  loadRequest?.abort();
  emit("highlight", undefined);
});
defineExpose({ reload: load });
</script>

<template>
  <section class="feedback-split" aria-label="意见整理建议">
    <header class="feedback-split__head">
      <div class="feedback-split__title">
        <TpIcon :icon="PhSparkle" :size="16" />
        <h2 class="tp-subheading">拆解建议</h2>
        <span v-if="split?.status === 'succeeded'" class="tp-caption">{{ counts.total }} 条 · 待决定 {{ counts.pending }} · 已采纳 {{ counts.adopted }}</span>
      </div>
      <div v-if="!active" class="feedback-split__start">
        <template v-if="agents.length">
          <TpSelect v-if="agents.length > 1" v-model="agent" class="feedback-split__agent" aria-label="整理智能体" :disabled="locked" :options="agentOptions" />
          <TpButton variant="pencil" size="sm" :loading="busy && !split" :disabled="locked || !agent" @click="start">{{
            split ? "重新整理意见建议" : "整理意见建议"
          }}</TpButton>
        </template>
        <p v-else-if="loaded" class="tp-caption">需要可用的内容助手。<RouterLink class="feedback-link" :to="configurationsRoute">去配置台添加 ↗</RouterLink></p>
      </div>
    </header>

    <Transition name="tp-swap" mode="out-in">
      <div
        v-if="split && split.status !== 'succeeded'"
        :key="`${split.id}:${split.status}`"
        class="feedback-split__banner"
        :class="active ? 'tp-pencil' : 'tp-ghost'"
        role="region"
        aria-label="反馈整理状态"
      >
        <TpStatus :tone="split.status === 'failed' ? 'danger' : active ? 'info' : 'ghost'" :label="splitStatusLabel[split.status]" :live="active" size="sm" />
        <p>{{ splitStatusText(split) }}</p>
        <div class="screen-actions">
          <TpButton v-if="active" variant="ghost" size="sm" :disabled="locked" @click="cancel">取消整理</TpButton>
          <TpButton v-else variant="outline" size="sm" :loading="busy" :disabled="locked" @click="retry"
            ><TpIcon :icon="PhArrowCounterClockwise" :size="14" />按原输入重试</TpButton
          >
        </div>
      </div>
    </Transition>

    <details v-if="split" class="feedback-split__details tp-disclosure">
      <summary>拆解详情</summary>
      <dl>
        <dt>内容助手</dt>
        <dd>{{ split.agent_name }} · <span class="tp-mono">{{ split.agent_config_version_id }}</span></dd>
        <dt>执行</dt>
        <dd>第 {{ Math.max(split.attempt, 1) }} 次 · {{ formatTime(split.updated_at) }}</dd>
        <dt v-if="split.requested_model">模型</dt>
        <dd v-if="split.requested_model" class="tp-mono">{{ split.requested_model }} → {{ split.response_model ?? "尚未返回" }}</dd>
      </dl>
      <RouterLink :to="jobRoute(project.id, split.job_id, services.sourceKey)" class="feedback-link">查看执行任务 ↗</RouterLink>
    </details>

    <template v-if="split?.status === 'succeeded'">
      <p v-if="split.note" class="feedback-split__note tp-pencil-text">{{ split.note }}</p>
      <p v-if="!suggestions.length" class="feedback-split__empty tp-ghost">没有识别出可对应的建议。原文保留，可手动整理。</p>
      <div v-else class="feedback-split__toolbar">
        <label v-if="selectable.length" class="feedback-check"
          ><input type="checkbox" class="checkbox checkbox-sm" :checked="allChosen" :disabled="locked" @change="toggleAll" /><span>选择全部待决定</span></label
        >
        <span v-else class="tp-caption">{{ counts.stale ? `${counts.stale} 条已过期` : "全部建议已决定" }}</span>
        <TpButton v-if="selectable.length" variant="seal" size="sm" :disabled="locked || !chosen.length" @click="adoptChosen"
          ><TpIcon :icon="PhCheck" :size="14" />采纳所选（{{ chosen.length }}）</TpButton
        >
      </div>
      <TransitionGroup tag="ol" name="tp-list" class="tp-list-group feedback-split__list" aria-label="拆解建议" v-bind="listMotionHooks">
        <li
          v-for="(value, index) in suggestions"
          :key="value.id"
          class="feedback-split__card"
          :class="suggestionTone(value)"
          :aria-label="`拆解建议 ${index + 1}`"
          @mouseenter="emit('highlight', value.source_range)"
          @mouseleave="emit('highlight', undefined)"
          @focusin="emit('highlight', value.source_range)"
        >
          <div class="feedback-split__meta">
            <label v-if="adoptable(value)" class="feedback-check"
              ><input v-model="chosen" type="checkbox" class="checkbox checkbox-sm" :value="value.id" :disabled="locked" /><span class="tp-mono"
                >建议 {{ index + 1 }}</span
              ></label
            >
            <span v-else class="tp-mono">建议 {{ index + 1 }}</span>
            <TpStatus v-if="value.state === 'pending' && value.stale" tone="stale" label="已过期" size="sm" />
            <TpStatus v-else-if="value.state === 'pending' && value.ambiguous" tone="ghost" label="有歧义，待明确" size="sm" />
            <TpStatus v-else-if="value.state === 'pending' && value.certainty === 'uncertain'" tone="ghost" label="不确定" size="sm" />
            <TpStatus v-else-if="value.state === 'rejected'" tone="ghost" label="你已拒绝" size="sm" />
            <TpSeal v-if="value.state === 'adopted'" text="你已采纳" :animate="stamped === value.id" />
          </div>
          <blockquote class="feedback-split__quote">
            <span class="tp-caption">对应原文</span>
            <p>{{ value.source_range.text }}</p>
          </blockquote>
          <p class="feedback-split__reason" :class="{ 'tp-pencil-text': value.state === 'pending' }">{{ value.interpretation }}</p>
          <p v-if="value.task_title" class="feedback-split__task"><span>建议任务</span>{{ value.task_title }}</p>
          <p v-if="value.state === 'pending' && value.stale" class="feedback-stale" role="status">{{ value.stale_reasons.join("、") }}。可拒绝后手动整理。</p>

          <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
            <form
              v-if="editing === value.id && draft"
              key="edit"
              class="feedback-split__edit studio-stack"
              aria-label="修改后采纳"
              @submit.prevent="saveEdit(value)"
              @keydown="onFormKeydown($event, value)"
            >
              <FeedbackInterpretationFields v-model="draft" :disabled="locked" />
              <TpField v-slot="{ id }" label="任务关联方式"
                ><TpSelect
                  :id="id"
                  v-model="linkMode"
                  :disabled="locked"
                  :options="[
                    { value: 'none', label: '暂不关联任务' },
                    { value: 'existing', label: '关联已有任务' },
                    { value: 'new', label: '同时创建新任务' },
                  ]"
                  @update:model-value="changeLink($event, value)"
              /></TpField>
              <TpField v-if="linkMode === 'existing'" v-slot="{ id }" label="关联已有任务"
                ><TpSelect
                  :id="id"
                  :model-value="draft.task_id ?? ''"
                  :disabled="locked"
                  :options="taskOptions"
                  @update:model-value="draft.task_id = $event || null"
              /></TpField>
              <section v-if="linkMode === 'new' && draft.new_task" class="studio-stack" aria-label="建议关联的新任务">
                <TaskContentForm v-model="draft.new_task" :services="services" :project-id="project.id" :tasks="tasks" :disabled="locked" />
              </section>
              <footer class="feedback-form-footer">
                <p class="tp-caption">Ctrl / ⌘ + Enter 采纳 · Esc 取消</p>
                <div>
                  <TpButton variant="ghost" :disabled="locked" @click="cancelEdit">取消</TpButton
                  ><TpButton type="submit" variant="seal" :loading="busy" :disabled="locked">按修改采纳</TpButton>
                </div>
              </footer>
            </form>
            <div v-else key="actions" class="screen-actions feedback-split__actions">
              <template v-if="value.state === 'pending'">
                <TpButton v-if="!value.stale" variant="seal" size="sm" :disabled="locked" @click="adopt(value)">采纳</TpButton
                ><TpButton v-if="!value.stale" variant="outline" size="sm" :disabled="locked" @click="beginEdit(value)">修改后采纳</TpButton
                ><TpButton variant="ghost" size="sm" :disabled="locked" @click="reject(value)">拒绝</TpButton>
              </template>
              <template v-else>
                <TpButton v-if="value.state === 'adopted' && value.feedback_item_id" variant="ghost" size="sm" @click="emit('openItem', value.feedback_item_id)"
                  >查看解释项</TpButton
                ><TpButton variant="ghost" size="sm" :disabled="locked" @click="undo(value)"
                  ><TpIcon :icon="PhArrowCounterClockwise" :size="14" />{{ value.state === "adopted" ? "撤销采纳" : "撤销拒绝" }}</TpButton
                >
              </template>
            </div>
          </Transition>
          <details class="feedback-split__item-details tp-disclosure">
            <summary>本条详情<span v-if="value.history.length"> · {{ value.history.length }} 次决定</span></summary>
            <p class="tp-mono">原文 UTF-16 {{ value.source_range.from }}–{{ value.source_range.to }} · 建议 v{{ value.version }}</p>
            <ol v-if="value.history.length" aria-label="建议决定记录">
              <li v-for="entry in value.history" :key="`${entry.version}:${entry.created_at}`">
                <b>{{ suggestionHistoryLabels[entry.action] ?? entry.action }}</b>
                <span class="tp-caption">v{{ entry.version }} · {{ formatTime(entry.created_at) }}</span>
                <p v-if="entry.reason">{{ entry.reason }}</p>
              </li>
            </ol>
          </details>
        </li>
      </TransitionGroup>
    </template>
    <p v-if="error" class="feedback-stale" role="alert">{{ error }}</p>
    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
  </section>
</template>

<style scoped>
.feedback-split {
  display: grid;
  gap: 16px;
  margin: 0 32px 24px;
  padding-top: 24px;
  border-top: 1px solid var(--tp-line);
}
.feedback-split__head,
.feedback-split__title,
.feedback-split__start {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.feedback-split__head {
  justify-content: space-between;
}
.feedback-split__agent {
  min-width: min(200px, 100%);
}
.feedback-split__banner {
  display: grid;
  justify-items: start;
  gap: 8px;
  padding: 16px 20px;
  line-height: 1.7;
}
.feedback-split__details {
  color: var(--tp-text-muted);
  font-size: 12px;
  line-height: 1.7;
}
.feedback-split__details summary,
.feedback-split__item-details summary {
  width: fit-content;
  cursor: pointer;
  color: var(--tp-text);
}
.feedback-split__details dl {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 4px 16px;
  margin-block: 12px;
}
.feedback-split__details dd {
  min-width: 0;
  overflow-wrap: anywhere;
}
.feedback-split__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.feedback-split__note {
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.feedback-split__empty {
  padding: 16px 20px;
}
.feedback-split__list {
  display: grid;
  gap: 12px;
  padding: 0;
  list-style: none;
}
.feedback-split__card {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 16px 20px;
}
.feedback-split__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.feedback-split__meta .tp-seal {
  margin-left: auto;
}
.feedback-split__quote {
  margin: 0;
  padding: 4px 12px;
  border-left: 2px solid var(--tp-line-strong);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.feedback-split__quote p {
  margin-top: 4px;
  line-height: 1.7;
}
.feedback-split__reason {
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.feedback-split__reason.tp-pencil-text {
  font-family: var(--tp-font-hand);
  font-size: 15px;
}
.feedback-split__task {
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.feedback-split__task > span {
  margin-right: 8px;
  color: var(--tp-text-muted);
  font-size: 12px;
}
.feedback-split__edit {
  padding-top: 16px;
  border-top: 1px dashed var(--tp-pencil-line);
}
.feedback-split__item-details {
  padding-top: 8px;
  border-top: 1px solid var(--tp-line);
  color: var(--tp-text-muted);
  font-size: 12px;
}
.feedback-split__item-details > p {
  margin-top: 12px;
  overflow-wrap: anywhere;
}
.feedback-split__item-details ol {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}
.feedback-split__item-details li {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}
.feedback-split__item-details li p {
  flex-basis: 100%;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.feedback-check {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 28px;
  font-size: 13px;
}
.feedback-stale {
  color: var(--tp-text-muted);
  font-size: 13px;
  line-height: 1.7;
}
.feedback-form-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.feedback-form-footer > div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
@media (max-width: 720px) {
  .feedback-split {
    margin: 0 16px 20px;
  }
  .feedback-split__card,
  .feedback-split__banner {
    padding: 16px;
  }
  .feedback-split__start,
  .feedback-split__agent {
    width: 100%;
  }
  .feedback-split__details dl {
    grid-template-columns: minmax(0, 1fr);
  }
  .feedback-split__details dd {
    margin-bottom: 8px;
  }
}
</style>
