<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import { PhArrowDown, PhCrosshair, PhSlidersHorizontal, PhX } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import AssistantComposer from "@/components/domain/AssistantComposer.vue";
import AssistantMessage from "@/components/domain/AssistantMessage.vue";
import type { BackendServices } from "@/services";
import { ApiError, asApiError } from "@/services/errors";
import { selectionText } from "@/services/revisionProtectionV2";
import { beginJobRequest, confirmJobRequest } from "@/lab/components/integration/jobsRequests";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import AssistantContextPicker, { type AssistantContextDraft } from "./AssistantContextPicker.vue";
import { assistantLiteratureScope, useAssistantLiterature } from "../writing-citations/assistantLiterature";
import AssistantSuggestionReview from "./AssistantSuggestionReview.vue";
import {
  clearAssistantDraftIfUnchanged,
  readAssistantDraft,
  runUpdateAllowed,
  selectionStillCurrent,
  writeAssistantDraft,
  type AssistantDraftScope,
  type CapturedAssistantSelection,
} from "./assistantDrafts";
import { formatAssistantTime, isNearMessageBottom, messageScrollPositions, RUN_VIEW, runIsActive, scrollTopAfterEarlierMessages } from "./assistantView";

const props = withDefaults(
  defineProps<{
    services: BackendServices;
    projectId: string;
    workspaceId: string;
    sessionId: string;
    sessionRevision?: number;
    currentVersion: number;
    eligible: boolean;
    captureSelection: () => CapturedAssistantSelection;
    initialRunId?: string;
    closable?: boolean;
  }>(),
  { closable: true },
);
const emit = defineEmits<{ close: []; updated: [] }>();
type Session = Awaited<ReturnType<BackendServices["assistantSessions"]["get"]>>;
type Messages = Awaited<ReturnType<BackendServices["assistantSessions"]["messages"]>>;
type Runs = Awaited<ReturnType<BackendServices["assistantSessions"]["runs"]>>;
type Run = Awaited<ReturnType<BackendServices["assistantSessions"]["run"]>>;
type RunContext = Awaited<ReturnType<BackendServices["assistantSessions"]["context"]>>;
type CreateCommand = Parameters<BackendServices["assistantSessions"]["createRun"]>[2];

const session = shallowRef<Session>();
const messages = shallowRef<Messages>();
const runs = shallowRef<Runs>();
const selectedRun = shallowRef<Run>();
const runContext = shallowRef<RunContext>();
const goal = ref("");
const draftSaved = ref(false);
const draftError = ref("");
const captured = shallowRef<CapturedAssistantSelection>();
const context = ref<AssistantContextDraft>({
  agentVersionId: "",
  bindingVersionId: null,
  bindingVersion: null,
  requiredBindingId: null,
  ready: false,
  sources: [],
  // 资料页交来的文献只是初始选择；发送仍使用明确固定的条目版本。
  literature: useAssistantLiterature(() => assistantLiteratureScope(props.services.sourceKey, props.projectId)).items.value.map((item) => ({ ...item })),
});
const contextOpen = ref(false);
const contextConfirmed = ref(false);
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const checking = ref(false);
const contextLoading = ref(false);
const pending = shallowRef<{ command: CreateCommand; scope: string }>();
const pendingAction = shallowRef<{ kind: "cancel" | "retry"; runId: string; commandId: string; scope: string }>();
const root = ref<HTMLElement>();
const messagesElement = ref<HTMLElement>();
const newReplyAvailable = ref(false);
const nearBottom = ref(true);
let hasRenderedMessages = false;
const scope: AssistantDraftScope = {
  sourceKey: props.services.sourceKey,
  workspaceId: props.workspaceId,
  projectId: props.projectId,
  sessionId: props.sessionId,
};
const scrollKey = JSON.stringify([scope.sourceKey, scope.workspaceId, scope.projectId, scope.sessionId]);
const scrollPositions = messageScrollPositions;
let loadRequest: AbortController | undefined;
let actionRequest: AbortController | undefined;
let pollRequest: AbortController | undefined;
let contextRequest: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;

const activeRun = computed(() => runs.value?.items.find(runIsActive) ?? (runIsActive(selectedRun.value) ? selectedRun.value : undefined));
const active = computed(() => !!activeRun.value);
const anyActive = computed(() => active.value);
const statusRun = computed(() => activeRun.value ?? selectedRun.value);
const capturedStale = computed(() => !!captured.value && captured.value.document_version !== props.currentVersion);
const selectedMaterials = computed(() => context.value.sources.filter((item) => item.anchorIds.length));
const contextSummary = computed(() => {
  const parts = [captured.value ? `正文 v${captured.value.document_version}` : "未固定选区"];
  parts.push(context.value.agentVersionId ? "配置已选" : "待选配置");
  if (selectedMaterials.value.length) parts.push(`${selectedMaterials.value.length} 份资料`);
  if (context.value.literature.length) parts.push(`${context.value.literature.length} 篇文献`);
  return parts.join(" · ");
});
const runOptions = computed(() =>
  (runs.value?.items ?? []).map((run) => ({
    value: run.id,
    label: `${RUN_VIEW[run.status].label} · 正文 v${run.document_version} · ${formatAssistantTime(run.created_at)}`,
  })),
);

function stop() {
  disposed = true;
  loadRequest?.abort();
  actionRequest?.abort();
  pollRequest?.abort();
  contextRequest?.abort();
  if (timer) clearTimeout(timer);
}
function close() {
  rememberScroll();
  stop();
  emit("close");
}
function saveDraft() {
  try {
    writeAssistantDraft(window.localStorage, scope, goal.value);
    draftSaved.value = true;
    draftError.value = "";
  } catch {
    draftSaved.value = false;
    draftError.value = "本机草稿暂未保存；输入仍保留在当前面板，尚未发送。";
  }
}
watch(goal, saveDraft);
watch(
  [context, captured],
  () => {
    contextConfirmed.value = false;
  },
  { deep: true },
);
function capture() {
  if (busy.value || anyActive.value || pending.value || session.value?.archived) return;
  error.value = "";
  try {
    captured.value = structuredClone(props.captureSelection());
    notice.value = "已固定当前选区与正文版本。";
  } catch (problem) {
    error.value = problem instanceof Error ? problem.message : "无法取得选区，请重新选择已保存文字。";
  }
}
function prepareRevision() {
  if (disposed) return;
  captured.value = undefined;
  contextConfirmed.value = false;
  contextOpen.value = true;
  notice.value = "请在当前正文中重新选择文字，再核对本次上下文。";
  void nextTick(() => root.value?.querySelector<HTMLTextAreaElement>("textarea")?.focus());
}
function rememberScroll() {
  const element = messagesElement.value;
  if (!element) return;
  nearBottom.value = isNearMessageBottom(element.scrollTop, element.scrollHeight, element.clientHeight);
  scrollPositions.set(scrollKey, element.scrollTop);
}
function scrollToLatest() {
  const element = messagesElement.value;
  if (!element) return;
  element.scrollTop = element.scrollHeight;
  newReplyAvailable.value = false;
  nearBottom.value = true;
  rememberScroll();
}
async function syncMessageScroll(previous?: { offset: number; top: number; height: number }, previousIds?: Set<string>) {
  await nextTick();
  const element = messagesElement.value;
  if (!element || disposed) return;
  const currentIds = new Set(messages.value?.items.map((item) => item.id) ?? []);
  if (previous && messages.value) {
    element.scrollTop =
      messages.value.offset < previous.offset ? scrollTopAfterEarlierMessages(previous.top, previous.height, element.scrollHeight) : previous.top;
    newReplyAvailable.value = false;
  } else if (!hasRenderedMessages) {
    element.scrollTop = scrollPositions.get(scrollKey) ?? element.scrollHeight;
    newReplyAvailable.value = false;
  } else if (nearBottom.value) {
    element.scrollTop = element.scrollHeight;
    newReplyAvailable.value = false;
  } else if (previousIds && [...currentIds].some((id) => !previousIds.has(id))) {
    newReplyAvailable.value = true;
  }
  hasRenderedMessages = true;
  rememberScroll();
}

async function load(messageOffset?: number, runOffset = 0) {
  loadRequest?.abort();
  const controller = new AbortController();
  loadRequest = controller;
  const previousIds = new Set(messages.value?.items.map((item) => item.id) ?? []);
  const previous =
    messageOffset !== undefined && messages.value && messagesElement.value
      ? { offset: messages.value.offset, top: messagesElement.value.scrollTop, height: messagesElement.value.scrollHeight }
      : undefined;
  loading.value = true;
  error.value = "";
  const results = await Promise.allSettled([
    props.services.assistantSessions.get(props.projectId, props.sessionId, controller.signal),
    props.services.assistantSessions.messages(props.projectId, props.sessionId, { offset: messageOffset ?? 0, limit: 20 }, controller.signal),
    props.services.assistantSessions.runs(props.projectId, props.sessionId, { offset: runOffset, limit: 20 }, controller.signal),
  ]);
  if (controller.signal.aborted || disposed) return;
  const failures: string[] = [];
  if (results[0].status === "fulfilled") session.value = results[0].value;
  else failures.push(asApiError(results[0].reason).message);
  if (results[1].status === "fulfilled") {
    let nextMessages = results[1].value;
    if (messageOffset === undefined && nextMessages.total > 20) {
      try {
        nextMessages = await props.services.assistantSessions.messages(
          props.projectId,
          props.sessionId,
          { offset: Math.floor((nextMessages.total - 1) / 20) * 20, limit: 20 },
          controller.signal,
        );
      } catch (problem) {
        if (!controller.signal.aborted) failures.push(asApiError(problem).message);
      }
    }
    if (controller.signal.aborted || disposed) return;
    messages.value = nextMessages;
    void syncMessageScroll(previous, previousIds);
  } else failures.push(asApiError(results[1].reason).message);
  if (results[2].status === "fulfilled") {
    runs.value = results[2].value;
    if (props.initialRunId && !selectedRun.value) void inspectRun(props.initialRunId);
    else if (!selectedRun.value && results[2].value.items[0]) {
      acceptRun(results[2].value.items[0]);
      schedule();
    } else if (selectedRun.value) {
      const latest = results[2].value.items.find((item) => item.id === selectedRun.value!.id);
      if (latest) acceptRun(latest);
    }
  } else failures.push(asApiError(results[2].reason).message);
  error.value = failures.join(" ");
  loading.value = false;
}
function acceptRun(next: Run) {
  if (next.session_id !== props.sessionId || next.project_id !== props.projectId) throw new ApiError("INVALID_RESPONSE");
  if (selectedRun.value?.id !== next.id) runContext.value = undefined;
  if (runUpdateAllowed(selectedRun.value, next)) selectedRun.value = next;
  if (runs.value) {
    const items = runs.value.items.map((item) => (item.id === next.id && runUpdateAllowed(item, next) ? next : item));
    runs.value = { ...runs.value, items };
  }
}
function schedule() {
  if (timer) clearTimeout(timer);
  if (!disposed && active.value) timer = setTimeout(() => void refreshRun(), 1200);
}
async function inspectRun(id: string) {
  pollRequest?.abort();
  const controller = new AbortController();
  pollRequest = controller;
  checking.value = true;
  runContext.value = undefined;
  try {
    const run = await props.services.assistantSessions.run(props.projectId, id, controller.signal);
    if (!controller.signal.aborted && !disposed) {
      acceptRun(run);
      schedule();
    }
  } catch (problem) {
    if (!controller.signal.aborted && !disposed) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted && !disposed) checking.value = false;
  }
}
async function refreshRun() {
  const current = activeRun.value ?? selectedRun.value;
  if (!current || checking.value || disposed) return;
  pollRequest?.abort();
  const controller = new AbortController();
  pollRequest = controller;
  checking.value = true;
  try {
    const latest = await props.services.assistantSessions.run(props.projectId, current.id, controller.signal);
    if (controller.signal.aborted || disposed || (activeRun.value?.id ?? selectedRun.value?.id) !== current.id) return;
    acceptRun(latest);
    if (runIsActive(current) && !runIsActive(latest)) {
      void load();
      emit("updated");
    }
    schedule();
  } catch (problem) {
    if (!controller.signal.aborted && !disposed) error.value = `运行状态暂不可读：${asApiError(problem).message}`;
  } finally {
    if (!controller.signal.aborted && !disposed) checking.value = false;
  }
}
async function send() {
  if (busy.value || anyActive.value || session.value?.archived) return;
  if (pending.value) {
    await confirmSend();
    return;
  }
  error.value = "";
  notice.value = "";
  if (!captured.value) {
    try {
      captured.value = structuredClone(props.captureSelection());
    } catch (problem) {
      error.value = problem instanceof Error ? problem.message : "请先使用当前已保存的非空选区。";
      return;
    }
  }
  if (!context.value.ready || !context.value.agentVersionId) {
    contextOpen.value = true;
    error.value = "请选择本次使用的内容助手版本与资料范围。";
    return;
  }
  if (context.value.requiredBindingId && context.value.bindingVersionId !== context.value.requiredBindingId) {
    contextOpen.value = true;
    error.value = "项目已有来源绑定，请选择当前固定绑定版本。";
    return;
  }
  if (!contextConfirmed.value) {
    contextOpen.value = true;
    error.value = "请核对本次固定上下文；未选资料不会发送。";
    return;
  }
  if (!goal.value.trim() || Array.from(goal.value).length > 2000) {
    error.value = "请输入 1 至 2000 个字符的修订目标。";
    return;
  }
  try {
    const current = props.captureSelection();
    if (
      !selectionStillCurrent(captured.value, { documentId: current.document_id, version: current.document_version, dirty: false, selection: current.selection })
    )
      throw new Error("固定选区已过期，请保存正文后重新选择。");
    const materials = selectedMaterials.value;
    if (materials.length > 10 || materials.some((item) => item.anchorIds.length > 20)) throw new Error("最多选择 10 份资料，每份最多 20 个来源锚点。");
    const input = {
      ...structuredClone(captured.value),
      goal: goal.value.trim(),
      agent_config_version_id: context.value.agentVersionId,
      source_binding_version_id: context.value.bindingVersionId,
      material_sources: materials.map((item) => ({
        material_id: item.materialId,
        original_version_id: item.originalId,
        parse_version_id: item.parseId,
        anchor_ids: [...item.anchorIds],
      })),
      literature_entries: context.value.literature.map((item) => ({ entry_id: item.entryId, entry_version: item.version })),
    };
    const controller = new AbortController();
    actionRequest = controller;
    busy.value = true;
    const latest = await props.services.assistantSessions.get(props.projectId, props.sessionId, controller.signal);
    if (controller.signal.aborted || disposed) return;
    session.value = latest;
    const key = "thesispilot.pending-assistant-run:" + JSON.stringify([props.services.sourceKey, props.projectId, props.sessionId, latest.version, input]);
    pending.value = { scope: key, command: { command_id: beginJobRequest(key), expected_session_version: latest.version, purpose: "content_revision", input } };
    busy.value = false;
    await confirmSend();
  } catch (problem) {
    if (!disposed) error.value = problem instanceof Error ? problem.message : "无法创建本次运行。";
  } finally {
    if (!disposed) busy.value = false;
  }
}
async function confirmSend() {
  const command = pending.value;
  if (!command || busy.value || disposed) return;
  const controller = new AbortController();
  actionRequest = controller;
  busy.value = true;
  error.value = "";
  try {
    const receipt = await props.services.assistantSessions.createRun(props.projectId, props.sessionId, command.command, controller.signal);
    if (controller.signal.aborted || disposed) return;
    confirmJobRequest(command.scope, command.command.command_id);
    pending.value = undefined;
    session.value = receipt.session;
    acceptRun(receipt.run);
    selectedRun.value = receipt.run;
    runContext.value = undefined;
    try {
      clearAssistantDraftIfUnchanged(window.localStorage, scope, command.command.input.goal);
    } catch {}
    if (goal.value.trim() === command.command.input.goal) goal.value = "";
    notice.value = "消息已保存，正在等待候选；正文尚未改动。";
    void load();
    schedule();
    emit("updated");
  } catch (problem) {
    if (!controller.signal.aborted && !disposed) {
      const issue = asApiError(problem);
      if (issue.status !== undefined && issue.status < 500 && issue.code !== "INVALID_RESPONSE") {
        confirmJobRequest(command.scope, command.command.command_id);
        pending.value = undefined;
      }
      error.value = pending.value ? "发送结果未知，固定请求已保留；请使用原请求确认，避免重复消息或模型调用。" : issue.message;
    }
  } finally {
    if (!controller.signal.aborted && !disposed) busy.value = false;
  }
}
async function runAction(kind: "cancel" | "retry") {
  const target = kind === "cancel" ? (activeRun.value ?? selectedRun.value) : selectedRun.value;
  if (!target || busy.value || disposed) return;
  if (!pendingAction.value) {
    const key = "thesispilot.pending-assistant-action:" + JSON.stringify([props.services.sourceKey, props.projectId, target.id, kind]);
    pendingAction.value = { kind, runId: target.id, commandId: beginJobRequest(key), scope: key };
  }
  const command = pendingAction.value;
  const controller = new AbortController();
  actionRequest = controller;
  busy.value = true;
  error.value = "";
  try {
    const result =
      command.kind === "cancel"
        ? await props.services.assistantSessions.cancel(props.projectId, command.runId, { command_id: command.commandId }, controller.signal)
        : await props.services.assistantSessions.retry(props.projectId, command.runId, { command_id: command.commandId }, controller.signal);
    if (controller.signal.aborted || disposed) return;
    confirmJobRequest(command.scope, command.commandId);
    pendingAction.value = undefined;
    if ("run" in result) {
      session.value = result.session;
      acceptRun(result.run);
      selectedRun.value = result.run;
    } else acceptRun(result);
    notice.value =
      command.kind === "cancel"
        ? selectedRun.value?.status === "cancelled"
          ? "运行已取消；迟到结果不会生成候选或改写正文。"
          : "取消请求已核对，当前状态以服务端为准。"
        : "已沿用原固定输入创建重试运行，没有新增重复消息。";
    void load();
    schedule();
    emit("updated");
  } catch (problem) {
    if (!controller.signal.aborted && !disposed) {
      const issue = asApiError(problem);
      if (issue.status !== undefined && issue.status < 500 && issue.code !== "INVALID_RESPONSE") {
        confirmJobRequest(command.scope, command.commandId);
        pendingAction.value = undefined;
      }
      error.value = pendingAction.value ? "操作结果未知，请使用原操作请求确认。" : issue.message;
    }
  } finally {
    if (!controller.signal.aborted && !disposed) busy.value = false;
  }
}
async function readContext() {
  if (!selectedRun.value || disposed) return;
  contextRequest?.abort();
  const controller = new AbortController();
  contextRequest = controller;
  contextLoading.value = true;
  try {
    const result = await props.services.assistantSessions.context(props.projectId, selectedRun.value.id, controller.signal);
    if (!controller.signal.aborted && !disposed && selectedRun.value.id === result.run_id) runContext.value = result;
  } catch (problem) {
    if (!controller.signal.aborted && !disposed) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted && !disposed) contextLoading.value = false;
  }
}
onMounted(() => {
  try {
    goal.value = readAssistantDraft(window.localStorage, scope)?.text ?? "";
    draftSaved.value = true;
  } catch {
    draftSaved.value = false;
    draftError.value = "本机草稿无法读取，不会作为已发送消息。";
  }
  void load();
});
watch(
  () => props.initialRunId,
  (id) => {
    if (id && id !== selectedRun.value?.id) void inspectRun(id);
  },
);
watch(
  () => props.sessionRevision,
  (value, previous) => {
    if (value !== previous && session.value && value !== session.value.version) void load();
  },
);
onScopeDispose(() => {
  rememberScroll();
  stop();
});
defineExpose({ prepareRevision, reload: load });
</script>

<template>
  <section ref="root" class="assistant-session" :aria-label="`内容助手会话：${session?.title ?? sessionId}`" :aria-busy="loading || busy">
    <header v-if="closable || session?.archived" class="assistant-session__head">
      <div>
        <h3 class="tp-subheading">{{ session?.title ?? "正在读取会话…" }}</h3>
        <TpStatus v-if="session?.archived" tone="ghost" size="sm" label="已归档 · 只读" />
      </div>
      <TpButton v-if="closable" size="sm" variant="ghost" icon-only label="收起此会话" @click="close"><TpIcon :icon="PhX" :size="15" /></TpButton>
    </header>
    <p v-if="loading && !session" role="status" class="tp-caption">正在读取会话与运行…</p>

    <section class="assistant-dialogue" aria-label="当前对话">
      <div v-if="messages && messages.total > 20" class="assistant-pagination">
        <TpButton size="sm" variant="ghost" :disabled="loading || messages.offset === 0" @click="load(Math.max(0, messages.offset - 20))">更早消息</TpButton>
        <span class="tp-caption">{{ messages.offset + 1 }}–{{ messages.offset + messages.items.length }} / {{ messages.total }}</span>
        <TpButton size="sm" variant="ghost" :disabled="loading || messages.offset + messages.items.length >= messages.total" @click="load(messages.offset + 20)"
          >较新消息</TpButton
        >
      </div>
      <div ref="messagesElement" class="assistant-messages" tabindex="0" aria-label="会话消息" @scroll.passive="rememberScroll">
        <p v-if="messages && !messages.items.length" class="assistant-messages__empty">说明希望如何修改选区，回复与候选会保存在这里。</p>
        <TransitionGroup tag="div" name="tp-list" v-bind="listMotionHooks" class="assistant-messages__list tp-list-group">
          <AssistantMessage
            v-for="message in messages?.items"
            :key="message.id"
            :role="message.role"
            agent="content"
            :time="formatAssistantTime(message.created_at)"
          >
            <div class="assistant-message-content">{{ message.content }}</div>
          </AssistantMessage>
        </TransitionGroup>
      </div>
      <Transition name="tp-swap" v-bind="panelMotionHooks">
        <button v-if="newReplyAvailable" type="button" class="assistant-new-reply" @click="scrollToLatest">
          查看新回复<TpIcon :icon="PhArrowDown" :size="14" />
        </button>
      </Transition>
    </section>

    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <section v-if="statusRun" :key="statusRun.id" class="assistant-run" :data-status="statusRun.status" aria-label="本次运行">
        <header class="assistant-run__head">
          <div>
            <TpStatus :tone="RUN_VIEW[statusRun.status].tone" :label="RUN_VIEW[statusRun.status].label" :live="runIsActive(statusRun)" size="sm" />
            <span v-if="statusRun.source_run_id" class="tp-caption">重试运行</span>
          </div>
          <span class="tp-caption">正文 v{{ statusRun.document_version }} · {{ formatAssistantTime(statusRun.created_at) }}</span>
        </header>
        <p v-if="statusRun.status === 'queued'" class="assistant-run__summary">请求已保存，等待执行。</p>
        <p v-else-if="statusRun.status === 'running'" class="assistant-run__summary">正在生成候选，正文尚未改动。</p>
        <p v-else-if="statusRun.status === 'failed'" class="assistant-run__error" role="alert">
          {{ statusRun.error_code ? asApiError(new ApiError(statusRun.error_code)).message : "生成失败，正文保持不变。" }}
        </p>
        <p v-else-if="statusRun.status === 'cancelled'" class="assistant-run__summary">本次运行已取消，可沿用原固定输入重试。</p>
        <p v-else-if="!statusRun.candidate_id" class="assistant-run__summary">运行已完成，但没有可审阅的候选。</p>
        <details v-if="statusRun.error_code" class="assistant-technical">
          <summary>错误详情</summary>
          <code>{{ statusRun.error_code }}</code>
        </details>
        <div class="assistant-run__actions">
          <TpButton v-if="activeRun" size="sm" variant="outline" :disabled="busy" @click="runAction('cancel')">取消运行</TpButton>
          <TpButton
            v-else-if="selectedRun && ['failed', 'cancelled'].includes(selectedRun.status)"
            size="sm"
            variant="outline"
            :disabled="busy"
            @click="runAction('retry')"
            >重试固定输入</TpButton
          >
          <TpButton v-if="pendingAction" size="sm" variant="outline" :disabled="busy" @click="runAction(pendingAction.kind)">使用原操作请求确认</TpButton>
          <TpButton size="sm" variant="ghost" :loading="checking" :disabled="checking" @click="refreshRun">刷新状态</TpButton>
          <TpButton size="sm" variant="ghost" :loading="contextLoading" :disabled="contextLoading" @click="readContext">固定输入</TpButton>
        </div>

        <details v-if="runs?.items.length" class="assistant-run-history">
          <summary>运行历史 <span>{{ runs.total }}</span></summary>
          <TpField v-slot="{ id }" label="选择运行">
            <TpSelect
              :id="id"
              :model-value="selectedRun?.id"
              :disabled="busy || checking || !!pendingAction"
              :options="runOptions"
              @update:model-value="inspectRun"
            />
          </TpField>
          <div v-if="runs.total > 20" class="assistant-run-history__pages">
            <TpButton size="sm" variant="ghost" :disabled="loading || runs.offset === 0" @click="load(messages?.offset, Math.max(0, runs.offset - 20))"
              >上一页</TpButton
            >
            <TpButton
              size="sm"
              variant="ghost"
              :disabled="loading || runs.offset + runs.items.length >= runs.total"
              @click="load(messages?.offset, runs.offset + 20)"
              >下一页</TpButton
            >
          </div>
        </details>

        <Transition name="tp-swap" v-bind="panelMotionHooks">
          <section v-if="runContext" class="assistant-input-snapshot" aria-label="本次固定输入">
            <span class="tp-label">本次固定输入 · 正文 v{{ runContext.input.document_version }}</span>
            <p><strong>目标</strong>{{ runContext.input.goal }}</p>
            <blockquote>{{ selectionText(runContext.input.selection) }}</blockquote>
            <p class="tp-caption">
              {{ runContext.input.material_sources?.length ?? 0 }} 份资料 · {{ runContext.input.literature_entries?.length ?? 0 }} 篇文献 ·
              {{ runContext.input.source_binding_version_id ? "已固定模板与要求绑定" : "未包含模板与要求绑定" }}
            </p>
            <details class="assistant-technical">
              <summary>来源与配置标识</summary>
              <dl>
                <div>
                  <dt>内容配置</dt>
                  <dd>{{ runContext.input.agent_config_version_id }}</dd>
                </div>
                <div>
                  <dt>来源绑定</dt>
                  <dd>{{ runContext.input.source_binding_version_id ?? "未包含" }}</dd>
                </div>
                <div v-for="(source, index) in runContext.input.material_sources ?? []" :key="source.parse_version_id">
                  <dt>资料 {{ index + 1 }}</dt>
                  <dd>{{ source.parse_version_id }} · {{ source.anchor_ids.length }} 个来源锚点</dd>
                </div>
                <div v-for="(item, index) in runContext.input.literature_entries ?? []" :key="item.entry_id">
                  <dt>文献 {{ index + 1 }}</dt>
                  <dd>{{ item.entry_id }} · 条目 v{{ item.entry_version }}</dd>
                </div>
              </dl>
            </details>
          </section>
        </Transition>
      </section>
    </Transition>

    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <div v-if="selectedRun?.candidate_id" :key="selectedRun.candidate_id" class="assistant-candidate">
        <slot name="review" :candidate-id="selectedRun.candidate_id" :document-id="selectedRun.document_id">
          <AssistantSuggestionReview
            :services="services"
            :project-id="projectId"
            :document-id="selectedRun.document_id"
            :candidate-id="selectedRun.candidate_id"
            :current-version="currentVersion"
          />
        </slot>
      </div>
    </Transition>

    <section class="assistant-compose" aria-label="发起内容修订">
      <div class="assistant-context-bar">
        <TpButton
          size="sm"
          variant="ghost"
          :aria-expanded="contextOpen"
          :disabled="busy || anyActive || !!pending || !!session?.archived"
          @click="contextOpen = !contextOpen"
        >
          <TpIcon :icon="PhSlidersHorizontal" :size="15" />上下文
        </TpButton>
        <span class="tp-caption" :title="contextSummary">{{ contextSummary }}</span>
        <TpStatus size="sm" :tone="contextConfirmed ? 'success' : 'warning'" :label="contextConfirmed ? '已核对' : '待核对'" />
      </div>
      <div v-if="captured" class="assistant-selection" :data-stale="capturedStale || undefined">
        <TpIcon :icon="PhCrosshair" :size="15" />
        <p>{{ selectionText(captured.selection) }}</p>
        <span v-if="capturedStale" class="tp-caption">当前正文为 v{{ currentVersion }}，请重新选择</span>
      </div>
      <div class="assistant-compose__tools">
        <TpButton size="sm" variant="ghost" :disabled="!eligible || busy || anyActive || !!pending || !!session?.archived" @click="capture">
          <TpIcon :icon="PhCrosshair" :size="14" />{{ captured ? "更新为当前选区" : "使用当前选区" }}
        </TpButton>
        <span v-if="!eligible && !captured" class="tp-caption">选择已保存的同段文字后可发送</span>
      </div>
      <Transition name="tp-swap" v-bind="panelMotionHooks">
        <div v-if="contextOpen" class="assistant-context-panel">
          <AssistantContextPicker
            v-model="context"
            :services="services"
            :project-id="projectId"
            :disabled="busy || anyActive || !!pending || !!session?.archived"
          />
          <label class="assistant-context-confirm">
            <input
              v-model="contextConfirmed"
              type="checkbox"
              class="checkbox checkbox-sm"
              :disabled="busy || anyActive || !!pending || !context.ready || !!session?.archived"
            />
            已核对本次版本与资料范围
          </label>
        </div>
      </Transition>
      <p v-if="draftError" role="alert" class="assistant-compose__error">{{ draftError }}</p>
      <AssistantComposer
        v-model="goal"
        :running="active"
        :disabled="!session || !eligible || busy || anyActive || !!pendingAction || !!session?.archived"
        :draft-persisted="draftSaved"
        label="内容修订目标（本机草稿）"
        send-label="发送选区修订"
        placeholder="说明希望如何改进选区，保留事实与引用…"
        @send="send"
        @cancel="runAction('cancel')"
      />
      <div v-if="pending" class="assistant-compose__pending">
        <span>发送结果尚未核实，输入与固定请求均已保留。</span>
        <TpButton size="sm" variant="outline" :disabled="busy" @click="confirmSend">使用原请求确认发送</TpButton>
      </div>
    </section>

    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <p v-if="error" :key="error" role="alert" class="assistant-session__error">{{ error }}</p>
    </Transition>
    <Transition name="tp-swap" v-bind="panelMotionHooks"
      ><p v-if="notice" :key="notice" role="status" class="assistant-session__notice">{{ notice }}</p></Transition
    >
  </section>
</template>

<style scoped>
.assistant-session {
  display: grid;
  gap: 14px;
  min-width: 0;
  color: var(--tp-text);
}
.assistant-session__head,
.assistant-session__head > div,
.assistant-run__head,
.assistant-run__head > div,
.assistant-pagination,
.assistant-run__actions,
.assistant-compose__tools,
.assistant-context-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.assistant-session__head {
  justify-content: space-between;
  min-height: 32px;
}
.assistant-session__head h3 {
  margin: 0;
  overflow-wrap: anywhere;
}
.assistant-dialogue {
  position: relative;
  min-width: 0;
  border-block: 1px solid var(--tp-line);
}
.assistant-pagination {
  justify-content: space-between;
  min-height: 32px;
  border-bottom: 1px solid var(--tp-line);
}
.assistant-messages {
  min-height: 112px;
  max-height: min(36vh, 340px);
  overflow: auto;
  overscroll-behavior: contain;
  padding: 12px 4px;
  scrollbar-width: thin;
}
.assistant-messages:focus-visible {
  outline: 2px solid var(--tp-focus);
  outline-offset: -2px;
}
.assistant-messages__list {
  display: grid;
  gap: 16px;
}
.assistant-messages__empty {
  margin: 0;
  padding: 12px 0;
  color: var(--tp-text-muted);
  font-size: 12.5px;
  line-height: 1.7;
}
.assistant-message-content {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.8;
}
.assistant-new-reply {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  padding: 4px 10px;
  border: 1px solid var(--tp-pencil-line);
  border-radius: var(--tp-radius-m);
  background: var(--tp-surface-raised);
  box-shadow: var(--tp-shadow-2);
  color: var(--tp-pencil-content);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.assistant-new-reply:focus-visible {
  outline: 2px solid var(--tp-focus);
  outline-offset: 2px;
}
.assistant-run {
  display: grid;
  gap: 8px;
  padding-left: 12px;
  border-left: 2px solid var(--tp-line-strong);
}
.assistant-run[data-status="running"],
.assistant-run[data-status="queued"] {
  border-left-color: var(--tp-info);
}
.assistant-run[data-status="failed"] {
  border-left-color: var(--tp-danger);
}
.assistant-run[data-status="cancelled"] {
  border-left-style: dashed;
  border-left-color: var(--tp-ghost-line);
}
.assistant-run__head {
  justify-content: space-between;
  flex-wrap: wrap;
}
.assistant-run__summary,
.assistant-run__error {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 12.5px;
  line-height: 1.6;
}
.assistant-run__summary {
  color: var(--tp-text-muted);
}
.assistant-run__error {
  color: var(--tp-danger-content);
}
.assistant-run__actions {
  flex-wrap: wrap;
  gap: 2px;
}
.assistant-run-history,
.assistant-technical {
  color: var(--tp-text-muted);
  font-size: 11.5px;
}
.assistant-run-history summary,
.assistant-technical summary {
  width: fit-content;
  min-height: 28px;
  padding: 5px 0;
  cursor: pointer;
}
.assistant-run-history summary span {
  margin-left: 4px;
  font-variant-numeric: tabular-nums;
}
.assistant-run-history :deep(.tp-field) {
  margin-top: 4px;
}
.assistant-run-history__pages {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}
.assistant-technical code {
  font-family: var(--tp-font-mono);
  overflow-wrap: anywhere;
}
.assistant-input-snapshot {
  display: grid;
  gap: 8px;
  padding: 10px 0;
  border-top: 1px solid var(--tp-line);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.assistant-input-snapshot p {
  margin: 0;
  white-space: pre-wrap;
}
.assistant-input-snapshot p strong {
  display: block;
  margin-bottom: 2px;
}
.assistant-input-snapshot blockquote {
  max-height: 140px;
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
  color: var(--tp-text-muted);
  line-height: 1.7;
}
.assistant-input-snapshot dl {
  display: grid;
  gap: 6px;
  margin: 0;
}
.assistant-input-snapshot dl div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
}
.assistant-input-snapshot dd {
  margin: 0;
  font-family: var(--tp-font-mono);
  overflow-wrap: anywhere;
}
.assistant-candidate {
  min-width: 0;
}
.assistant-compose {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.assistant-context-bar {
  min-width: 0;
}
.assistant-context-bar > .tp-caption {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.assistant-selection {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px 8px;
  padding-left: 10px;
  border-left: 2px solid var(--tp-pencil-line);
  color: var(--tp-pencil-content);
}
.assistant-selection[data-stale] {
  border-left-color: var(--tp-stale);
  color: var(--tp-stale);
}
.assistant-selection p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font-size: 12.5px;
  line-height: 1.65;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.assistant-selection > .tp-caption {
  grid-column: 2;
}
.assistant-compose__tools {
  flex-wrap: wrap;
  min-height: 30px;
}
.assistant-context-panel {
  display: grid;
  gap: 12px;
  padding-block: 8px 12px;
  border-block: 1px solid var(--tp-line);
}
.assistant-context-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  color: var(--tp-text);
  font-size: 12.5px;
  cursor: pointer;
}
.assistant-compose__pending {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--tp-warning-content);
  font-size: 12px;
  line-height: 1.6;
}
.assistant-compose__error,
.assistant-session__error {
  margin: 0;
  padding: 8px 10px;
  border-left: 2px solid var(--tp-danger);
  background: var(--tp-danger-soft);
  color: var(--tp-danger-content);
  font-size: 12.5px;
  line-height: 1.6;
}
.assistant-session__notice {
  margin: 0;
  color: var(--tp-success-content);
  font-size: 12.5px;
  line-height: 1.6;
}
@media (max-width: 420px) {
  .assistant-messages {
    max-height: 38vh;
  }
  .assistant-run__actions .tp-btn,
  .assistant-compose__tools .tp-btn,
  .assistant-context-bar .tp-btn,
  .assistant-pagination .tp-btn {
    min-height: 36px;
  }
  .assistant-run__head {
    align-items: flex-start;
  }
  .assistant-input-snapshot dl div {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}
</style>
