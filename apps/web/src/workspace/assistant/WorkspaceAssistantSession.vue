<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import AssistantComposer from "@/components/domain/AssistantComposer.vue";
import AssistantMessage from "@/components/domain/AssistantMessage.vue";
import type { BackendServices } from "@/services";
import { ApiError, asApiError } from "@/services/errors";
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
  type CapturedAssistantSelection,
} from "./assistantDrafts";

const props = defineProps<{
  services: BackendServices;
  projectId: string;
  workspaceId: string;
  sessionId: string;
  sessionRevision?: number;
  currentVersion: number;
  eligible: boolean;
  captureSelection: () => CapturedAssistantSelection;
  initialRunId?: string;
}>();
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
  // 资料页“加入助手上下文”交来的文献作为初始选择，发起前仍可在上下文中调整。
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
const active = computed(() => selectedRun.value?.status === "queued" || selectedRun.value?.status === "running");
const anyActive = computed(() => runs.value?.items.some((run) => ["queued", "running"].includes(run.status)) ?? false);
const runLabels: Record<string, string> = { queued: "排队中", running: "执行中", succeeded: "已完成", failed: "失败", cancelled: "已取消" };
const scope = { sourceKey: props.services.sourceKey, workspaceId: props.workspaceId, projectId: props.projectId, sessionId: props.sessionId };
let loadRequest: AbortController | undefined;
let actionRequest: AbortController | undefined;
let pollRequest: AbortController | undefined;
let contextRequest: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
function stop() {
  disposed = true;
  loadRequest?.abort();
  actionRequest?.abort();
  pollRequest?.abort();
  contextRequest?.abort();
  if (timer) clearTimeout(timer);
}
function close() {
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
    draftError.value = "本机草稿暂未保存，输入仍在此面板；它不是已发送消息。";
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
  error.value = "";
  try {
    captured.value = structuredClone(props.captureSelection());
    notice.value = "已固定当前保存版本的选区。发送前会再次核对版本和范围。";
  } catch (problem) {
    error.value = problem instanceof Error ? problem.message : "无法取得选区，请重新选择已保存文字。";
  }
}
async function load(messageOffset?: number, runOffset = 0) {
  loadRequest?.abort();
  const controller = new AbortController();
  loadRequest = controller;
  loading.value = true;
  error.value = "";
  const results = await Promise.allSettled([
    props.services.assistantSessions.get(props.projectId, props.sessionId, controller.signal),
    props.services.assistantSessions.messages(props.projectId, props.sessionId, { offset: messageOffset ?? 0, limit: 20 }, controller.signal),
    props.services.assistantSessions.runs(props.projectId, props.sessionId, { offset: runOffset, limit: 20 }, controller.signal),
  ]);
  if (controller.signal.aborted) return;
  const failures: string[] = [];
  if (results[0].status === "fulfilled") session.value = results[0].value;
  else failures.push(asApiError(results[0].reason).message);
  if (results[1].status === "fulfilled") {
    messages.value = results[1].value;
    if (messageOffset === undefined && results[1].value.total > 20) {
      try {
        const latest = await props.services.assistantSessions.messages(
          props.projectId,
          props.sessionId,
          { offset: Math.floor((results[1].value.total - 1) / 20) * 20, limit: 20 },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        messages.value = latest;
      } catch (problem) {
        if (!controller.signal.aborted) failures.push(asApiError(problem).message);
      }
    }
  } else failures.push(asApiError(results[1].reason).message);
  if (controller.signal.aborted) return;
  if (results[2].status === "fulfilled") {
    runs.value = results[2].value;
    if (props.initialRunId && !selectedRun.value) void inspectRun(props.initialRunId);
    else if (!selectedRun.value && results[2].value.items[0]) {
      selectedRun.value = results[2].value.items[0];
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
  if (runUpdateAllowed(selectedRun.value, next)) selectedRun.value = next;
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
    if (!controller.signal.aborted) {
      acceptRun(run);
      schedule();
    }
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) checking.value = false;
  }
}
async function refreshRun() {
  if (!selectedRun.value || checking.value) return;
  const current = selectedRun.value;
  pollRequest?.abort();
  const controller = new AbortController();
  pollRequest = controller;
  checking.value = true;
  try {
    const latest = await props.services.assistantSessions.run(props.projectId, current.id, controller.signal);
    if (controller.signal.aborted || selectedRun.value?.id !== current.id) return;
    acceptRun(latest);
    if (["queued", "running"].includes(current.status) && !["queued", "running"].includes(latest.status)) {
      void load();
      emit("updated");
    }
    schedule();
  } catch (problem) {
    if (!controller.signal.aborted) error.value = `运行状态暂不可读：${asApiError(problem).message}`;
  } finally {
    if (!controller.signal.aborted) checking.value = false;
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
    error.value = "请先使用当前已保存的非空选区。";
    return;
  }
  if (!context.value.ready || !context.value.agentVersionId) {
    error.value = "请展开并核对配置与资料上下文，选择固定的内容助手配置版本。";
    return;
  }
  if (context.value.requiredBindingId && context.value.bindingVersionId !== context.value.requiredBindingId) {
    error.value = "项目已有来源绑定，请明确选择当前固定绑定版本。";
    return;
  }
  if (!contextConfirmed.value) {
    error.value = "请确认本次固定上下文，未选资料不会发送。";
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
      throw new Error("固定选区已过期，请保存正文后重新取选区。");
    const materials = context.value.sources.filter((item) => item.anchorIds.length);
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
    if (controller.signal.aborted) return;
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
  if (!command || busy.value) return;
  const controller = new AbortController();
  actionRequest = controller;
  busy.value = true;
  error.value = "";
  try {
    const receipt = await props.services.assistantSessions.createRun(props.projectId, props.sessionId, command.command, controller.signal);
    if (controller.signal.aborted) return;
    confirmJobRequest(command.scope, command.command.command_id);
    pending.value = undefined;
    session.value = receipt.session;
    selectedRun.value = receipt.run;
    runContext.value = undefined;
    try {
      clearAssistantDraftIfUnchanged(window.localStorage, scope, command.command.input.goal);
    } catch {}
    if (goal.value.trim() === command.command.input.goal) goal.value = "";
    notice.value = "消息与固定上下文已由服务端保存，正文不会自动改写。";
    void load();
    schedule();
    emit("updated");
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      if (issue.status !== undefined && issue.status < 500 && issue.code !== "INVALID_RESPONSE") {
        confirmJobRequest(command.scope, command.command.command_id);
        pending.value = undefined;
      }
      error.value = pending.value ? "发送结果未知，固定请求已保留；请使用原请求确认，避免重复消息或模型调用。" : issue.message;
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
async function runAction(kind: "cancel" | "retry") {
  if (!selectedRun.value || busy.value) return;
  if (!pendingAction.value) {
    const key = "thesispilot.pending-assistant-action:" + JSON.stringify([props.services.sourceKey, props.projectId, selectedRun.value.id, kind]);
    pendingAction.value = { kind, runId: selectedRun.value.id, commandId: beginJobRequest(key), scope: key };
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
    if (controller.signal.aborted) return;
    confirmJobRequest(command.scope, command.commandId);
    pendingAction.value = undefined;
    if ("run" in result) {
      session.value = result.session;
      selectedRun.value = result.run;
    } else acceptRun(result);
    notice.value =
      command.kind === "cancel" ? "取消结果以当前服务端状态为准；离开面板不会取消远端任务。" : "已使用原固定输入创建重试运行，未新增重复用户消息。";
    void load();
    schedule();
    emit("updated");
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      if (issue.status !== undefined && issue.status < 500 && issue.code !== "INVALID_RESPONSE") {
        confirmJobRequest(command.scope, command.commandId);
        pendingAction.value = undefined;
      }
      error.value = pendingAction.value ? "操作结果未知，请使用原操作请求确认。" : issue.message;
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
async function readContext() {
  if (!selectedRun.value) return;
  contextRequest?.abort();
  const controller = new AbortController();
  contextRequest = controller;
  contextLoading.value = true;
  try {
    const result = await props.services.assistantSessions.context(props.projectId, selectedRun.value.id, controller.signal);
    if (!controller.signal.aborted) runContext.value = result;
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) contextLoading.value = false;
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
onScopeDispose(stop);
</script>

<template>
  <section class="assistant-session screen-panel studio-body studio-stack" :aria-label="`内容助手会话：${session?.title ?? sessionId}`">
    <header class="studio-row">
      <div>
        <h3 class="tp-heading">{{ session?.title ?? "正在读取会话…" }}</h3>
        <p class="tp-caption">内容修订 · {{ session?.archived ? "已归档" : "持久会话" }}</p>
      </div>
      <TpButton size="sm" variant="ghost" @click="close">收起此会话</TpButton>
    </header>
    <p class="tp-caption">本轮仅处理已保存的非空选区，不提供全文、问答或其他专业能力。</p>
    <p v-if="loading" role="status" class="tp-caption">正在读取会话与运行…</p>
    <section class="assistant-messages studio-stack" aria-label="服务端会话消息">
      <p v-if="messages && !messages.items.length" class="tp-caption">还没有已发送消息；下方本机草稿不会出现在这里。</p>
      <TransitionGroup tag="div" name="tp-list" v-bind="listMotionHooks" class="studio-stack tp-list-group"
        ><AssistantMessage
          v-for="message in messages?.items"
          :key="message.id"
          :role="message.role"
          agent="content"
          :time="new Date(message.created_at).toLocaleTimeString('zh-CN')"
          ><div class="assistant-message-content">{{ message.content }}</div></AssistantMessage
        ></TransitionGroup
      >
    </section>
    <div v-if="messages && messages.total > 20" class="screen-actions">
      <TpButton size="sm" :disabled="loading || messages.offset === 0" @click="load(Math.max(0, messages.offset - 20))">更早消息</TpButton
      ><TpButton size="sm" :disabled="loading || messages.offset + messages.items.length >= messages.total" @click="load(messages.offset + 20)"
        >更新消息</TpButton
      >
    </div>
    <div class="screen-actions">
      <TpButton size="sm" :disabled="!eligible || busy || anyActive || !!pending" @click="capture">使用当前已保存选区</TpButton
      ><TpButton size="sm" variant="ghost" :aria-expanded="contextOpen" :disabled="busy || anyActive || !!pending" @click="contextOpen = !contextOpen"
        >选择配置与资料上下文</TpButton
      >
    </div>
    <p v-if="!eligible" class="studio-notice">请先保存正式稿并在同一段落选择非空文字；来源核对失败时不能发起内容修订。</p>
    <blockquote v-if="captured" class="assistant-selection">正式稿 v{{ captured.document_version }}：{{ captured.selection.text }}</blockquote>
    <Transition name="tp-swap" v-bind="panelMotionHooks"
      ><AssistantContextPicker v-if="contextOpen" v-model="context" :services="services" :project-id="projectId" :disabled="busy || anyActive || !!pending"
    /></Transition>
    <p class="tp-caption">本机草稿：未发送，不是正式会话消息。{{ draftSaved ? "已保留" : "尚未保留" }}</p>
    <p class="tp-caption">
      本次范围：{{ captured ? `正式稿 v${captured.document_version} 的明确选区` : "尚未固定选区" }} ·
      {{ context.sources.filter((item) => item.anchorIds.length).length }} 份资料 · {{ context.literature.length }} 篇文献 ·
      {{ context.bindingVersion ? `来源绑定 v${context.bindingVersion}` : "未包含模板与要求绑定" }}
    </p>
    <label class="assistant-context-confirm"
      ><input
        v-model="contextConfirmed"
        type="checkbox"
        class="checkbox checkbox-sm"
        :disabled="busy || anyActive || !!pending || !context.ready"
      />我已确认本次固定上下文</label
    >
    <p v-if="draftError" role="alert" class="studio-notice">{{ draftError }}</p>
    <AssistantComposer
      v-model="goal"
      :running="active"
      :disabled="!eligible || busy || anyActive || !!pendingAction || !!session?.archived"
      :draft-persisted="draftSaved"
      label="内容修订目标（本机草稿）"
      send-label="发送选区修订"
      placeholder="说明希望如何改进选区，保留事实与引用…"
      @send="send"
      @cancel="runAction('cancel')"
    />
    <div v-if="pending" class="screen-actions"><TpButton size="sm" :disabled="busy" @click="confirmSend">使用原请求确认发送</TpButton></div>
    <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="error" :key="error" role="alert" class="studio-notice">{{ error }}</p></Transition>
    <p v-if="notice" role="status" class="tp-caption">{{ notice }}</p>
    <section v-if="runs?.items.length || selectedRun" class="studio-stack assistant-run" aria-label="内容助手运行">
      <TpField v-if="runs?.items.length" v-slot="{ id }" label="查看内容助手运行"
        ><TpSelect
          :id="id"
          :model-value="selectedRun?.id"
          :disabled="busy || checking || !!pendingAction"
          :options="
            runs.items.map((run) => ({
              value: run.id,
              label: `${runLabels[run.status] ?? run.status} · v${run.document_version} · ${new Date(run.created_at).toLocaleTimeString('zh-CN')}`,
            }))
          "
          @update:model-value="inspectRun" /></TpField
      ><template v-if="selectedRun"
        ><p role="status" class="tp-caption">{{ runLabels[selectedRun.status] ?? selectedRun.status }} · 固定正式稿 v{{ selectedRun.document_version }}</p>
        <p v-if="selectedRun.error_code" role="alert" class="studio-notice">
          {{ asApiError(new ApiError(selectedRun.error_code)).message }}（{{ selectedRun.error_code }}）
        </p>
        <div class="screen-actions">
          <TpButton v-if="active" size="sm" :disabled="busy" @click="runAction('cancel')">取消内容助手运行</TpButton
          ><TpButton v-else-if="selectedRun.status === 'failed' || selectedRun.status === 'cancelled'" size="sm" :disabled="busy" @click="runAction('retry')"
            >重试固定输入</TpButton
          ><TpButton v-if="pendingAction" size="sm" :disabled="busy" @click="runAction(pendingAction.kind)">使用原操作请求确认</TpButton
          ><TpButton size="sm" variant="ghost" :disabled="checking" @click="refreshRun">刷新运行状态</TpButton
          ><TpButton size="sm" variant="ghost" :disabled="contextLoading" @click="readContext">查看本次固定上下文</TpButton>
        </div>
        <Transition name="tp-swap" v-bind="panelMotionHooks"
          ><section v-if="runContext" class="assistant-input-snapshot studio-stack" aria-label="本次固定上下文">
            <p class="tp-caption">
              正文 v{{ runContext.input.document_version }} · 配置 {{ runContext.input.agent_config_version_id.slice(0, 8) }} ·
              {{ runContext.input.source_binding_version_id ? "来源绑定 " + runContext.input.source_binding_version_id.slice(0, 8) : "未包含来源绑定" }}
            </p>
            <blockquote>{{ runContext.input.selection.text }}</blockquote>
            <p>修订目标：{{ runContext.input.goal }}</p>
            <p v-for="source in runContext.input.material_sources" :key="source.parse_version_id" class="tp-caption">
              固定解析 {{ source.parse_version_id.slice(0, 8) }} · {{ source.anchor_ids.length }} 个明确锚点
            </p>
            <p v-for="item in runContext.input.literature_entries ?? []" :key="item.entry_id" class="tp-caption">
              项目文献 {{ item.entry_id.slice(0, 8) }} · 条目 v{{ item.entry_version }}
            </p>
          </section></Transition
        ><AssistantSuggestionReview
          v-if="selectedRun.candidate_id"
          :services="services"
          :project-id="projectId"
          :document-id="selectedRun.document_id"
          :candidate-id="selectedRun.candidate_id"
          :current-version="currentVersion"
      /></template>
      <div v-if="runs && runs.total > 20" class="screen-actions">
        <TpButton size="sm" :disabled="loading || runs.offset === 0" @click="load(messages?.offset, Math.max(0, runs.offset - 20))">上一页运行</TpButton
        ><TpButton size="sm" :disabled="loading || runs.offset + runs.items.length >= runs.total" @click="load(messages?.offset, runs.offset + 20)"
          >下一页运行</TpButton
        >
      </div>
    </section>
  </section>
</template>

<style scoped>
.assistant-session {
  min-width: 0;
}
.assistant-context-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.assistant-messages {
  max-height: 400px;
  overflow: auto;
}
.assistant-message-content,
.assistant-selection {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
  font-size: 13px;
}
.assistant-selection {
  margin: 0;
  max-height: 160px;
  overflow: auto;
  padding: 12px;
  border-left: 3px solid var(--tp-pencil);
  background: var(--tp-pencil-soft);
}
.assistant-run {
  border-top: 1px solid var(--tp-line);
  padding-top: 16px;
}
.assistant-input-snapshot {
  padding: 12px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.assistant-input-snapshot blockquote {
  margin: 0;
  white-space: pre-wrap;
}
</style>
