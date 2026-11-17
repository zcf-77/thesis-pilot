<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { PhX } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { BackendServices } from "@/services";
import { asApiError } from "@/services/errors";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { PreviewHighlight } from "@/workspace/editor";
import WorkspaceAssistantSession from "../assistant/WorkspaceAssistantSession.vue";
import type { CapturedAssistantSelection } from "../assistant/assistantDrafts";
import { CANDIDATE_GROUP, STATUS_VIEW } from "./candidateReview";
import { nodeSelectionOf, selectionUsable, type CopilotAnchor, type CopilotPanelProps } from "./copilotPanel";
import WritingCandidateReview from "./WritingCandidateReview.vue";

/**
 * 写作页副驾 · 内容助手：固定纸面选区与上下文发起内容修订运行，审阅服务端候选（纸面铅笔差异、逐片段决定、
 * 采纳所选、放弃、撤销）。候选只在学生采纳后写入正文，采纳成功后通知写作页重载新版本。
 */
const props = defineProps<CopilotPanelProps>();
const emit = defineEmits<{ overlays: [group: string, highlights: PreviewHighlight[]]; focus: [anchor: CopilotAnchor]; changed: []; close: [] }>();
type SessionPage = Awaited<ReturnType<BackendServices["assistantSessions"]["list"]>>;
type CandidatePage = Awaited<ReturnType<BackendServices["revisions"]["list"]>>;
type View = "sessions" | "candidates";

const view = ref<View>("sessions");
const sessions = shallowRef<SessionPage>();
const sessionId = ref("");
const creating = ref(false);
const title = ref("");
const candidates = shallowRef<CandidatePage>();
const candidateId = ref("");
const loading = ref(false);
const busy = ref(false);
const error = ref("");
let request: AbortController | undefined;
let disposed = false;

const usable = computed(() => selectionUsable(props.selection));
const sessionOptions = computed(() =>
  (sessions.value?.items ?? []).map((item) => ({ value: item.id, label: item.archived ? `${item.title}（已归档）` : item.title })),
);

/** 会话发送前固定的选区：只接受已保存最新版本上的同段非空选区。 */
function captureSelection(): CapturedAssistantSelection {
  if (!props.document) throw new Error("还没有可用的正式稿。");
  if (!props.eligible) throw new Error("请先保存正文；只能对已保存的最新版本发起修订。");
  if (!selectionUsable(props.selection)) throw new Error("请在纸面上同一段落内选择非空文字。");
  return { document_id: props.document.id, document_version: props.document.version, selection: nodeSelectionOf(props.selection) };
}

async function loadSessions(prefer?: string) {
  const controller = new AbortController();
  request?.abort();
  request = controller;
  loading.value = true;
  error.value = "";
  try {
    const page = await props.services.assistantSessions.list(props.project.id, { offset: 0, limit: 50, include_archived: false }, controller.signal);
    if (controller.signal.aborted || disposed) return;
    sessions.value = page;
    const keep = prefer ?? sessionId.value;
    sessionId.value = page.items.some((item) => item.id === keep) ? keep : (page.items[0]?.id ?? "");
  } catch (problem) {
    if (!controller.signal.aborted && !disposed) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted && !disposed) loading.value = false;
  }
}
async function loadCandidates() {
  const document = props.document;
  if (!document) {
    candidates.value = undefined;
    return;
  }
  try {
    const page = await props.services.revisions.list(props.project.id, document.id, { offset: 0, limit: 20 });
    if (disposed || props.document?.id !== document.id) return;
    candidates.value = page;
    if (!page.items.some((item) => item.id === candidateId.value)) candidateId.value = page.items[0]?.id ?? "";
  } catch (problem) {
    if (!disposed) error.value = asApiError(problem).message;
  }
}
async function createSession() {
  const name = title.value.trim();
  if (!name || busy.value) return;
  if (Array.from(name).length > 200) {
    error.value = "会话名称最多 200 个字符。";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const created = await props.services.assistantSessions.create(props.project.id, { title: name, role: "content" });
    if (disposed) return;
    title.value = "";
    creating.value = false;
    await loadSessions(created.id);
  } catch (problem) {
    if (!disposed) error.value = asApiError(problem).message;
  } finally {
    if (!disposed) busy.value = false;
  }
}
function cancelCreate() {
  creating.value = false;
  title.value = "";
}
function forward(group: string, highlights: PreviewHighlight[]) {
  emit("overlays", group, highlights);
}
function onChanged() {
  emit("changed");
  void loadCandidates();
}

watch(
  () => props.project.id,
  () => {
    sessionId.value = "";
    void loadSessions();
  },
  { immediate: true },
);
watch(
  () => [props.document?.id, props.document?.version],
  () => void loadCandidates(),
  { immediate: true },
);
watch(view, () => emit("overlays", CANDIDATE_GROUP, []));
onScopeDispose(() => {
  disposed = true;
  request?.abort();
  emit("overlays", CANDIDATE_GROUP, []);
});
</script>

<template>
  <section class="copilot-panel" aria-label="内容助手" :aria-busy="loading || busy">
    <header class="copilot-panel__head">
      <h2 class="tp-subheading">内容助手</h2>
      <TpButton size="sm" variant="ghost" icon-only label="收起内容助手" @click="$emit('close')"><TpIcon :icon="PhX" /></TpButton>
    </header>

    <div class="copilot-panel__selection" :data-empty="!usable || undefined">
      <template v-if="usable && selection && document">
        <blockquote>{{ selection.text }}</blockquote>
        <span class="tp-caption">正式稿 v{{ document.version }} · 段内第 {{ selection.start + 1 }}–{{ selection.end }} 字</span>
      </template>
      <p v-else class="tp-caption">在纸面上选择同一段落中的文字，助手只处理明确选中的内容。</p>
    </div>
    <p v-if="!eligible" class="studio-notice">正文有未保存修改或不是最新版本。保存后再发起修订或采纳候选。</p>

    <TpSegmented
      v-model="view"
      label="内容助手视图"
      :options="[
        { value: 'sessions', label: '会话' },
        { value: 'candidates', label: `候选${candidates?.total ? ` ${candidates.total}` : ''}` },
      ]"
    />

    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <div v-if="view === 'sessions'" key="sessions" class="copilot-panel__body">
        <div class="copilot-panel__picker">
          <TpSelect
            v-if="sessionOptions.length && !creating"
            v-model="sessionId"
            class="copilot-panel__select"
            :options="sessionOptions"
            placeholder="选择会话"
            :disabled="loading || busy"
          />
          <input
            v-if="creating || !sessionOptions.length"
            v-model="title"
            class="tp-input copilot-panel__select"
            maxlength="200"
            placeholder="新会话名称，回车创建"
            aria-label="新会话名称"
            :readonly="busy"
            @keydown.enter.prevent="createSession"
            @keydown.esc.prevent="cancelCreate"
          />
          <TpButton v-if="!creating && sessionOptions.length" size="sm" variant="ghost" :disabled="busy" @click="creating = true">新建会话</TpButton>
          <TpButton v-else size="sm" variant="primary" :disabled="busy || !title.trim()" :loading="busy" @click="createSession">创建</TpButton>
        </div>
        <p v-if="loading && !sessions" role="status" class="tp-caption">正在读取会话…</p>
        <WorkspaceAssistantSession
          v-if="sessionId && document"
          :key="sessionId"
          :services="services"
          :project-id="project.id"
          workspace-id="writing"
          :session-id="sessionId"
          :current-version="document.version"
          :eligible="eligible && usable"
          :capture-selection="captureSelection"
          @updated="loadCandidates"
          @close="sessionId = ''"
        >
          <template #review="{ candidateId: id, documentId }">
            <WritingCandidateReview
              :services="services"
              :project-id="project.id"
              :document-id="documentId"
              :candidate-id="id"
              :current-version="document.version"
              :eligible="eligible"
              @overlays="forward"
              @focus="$emit('focus', $event)"
              @changed="onChanged"
            />
          </template>
        </WorkspaceAssistantSession>
        <p v-else-if="!document" class="tp-caption">还没有正式稿。导入或新建正文后再使用内容助手。</p>
      </div>

      <div v-else key="candidates" class="copilot-panel__body">
        <p v-if="!candidates?.items.length" class="tp-caption">当前正文还没有内容候选。</p>
        <TransitionGroup tag="ul" name="tp-list" v-bind="listMotionHooks" class="copilot-panel__list tp-list-group">
          <li v-for="item in candidates?.items" :key="item.id">
            <button type="button" class="copilot-panel__row" :aria-pressed="candidateId === item.id" @click="candidateId = item.id">
              <TpStatus size="sm" :tone="STATUS_VIEW[item.status].tone" :label="STATUS_VIEW[item.status].label" />
              <span class="tp-caption">基于 v{{ item.base_version }} · {{ new Date(item.created_at).toLocaleString("zh-CN") }}</span>
            </button>
          </li>
        </TransitionGroup>
        <WritingCandidateReview
          v-if="candidateId && document"
          :key="candidateId"
          :services="services"
          :project-id="project.id"
          :document-id="document.id"
          :candidate-id="candidateId"
          :current-version="document.version"
          :eligible="eligible"
          @overlays="forward"
          @focus="$emit('focus', $event)"
          @changed="onChanged"
        />
      </div>
    </Transition>
    <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="error" :key="error" role="alert" class="studio-notice">{{ error }}</p></Transition>
  </section>
</template>

<style scoped>
.copilot-panel {
  display: grid;
  align-content: start;
  gap: 14px;
  min-width: 0;
  padding: 16px;
}
.copilot-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.copilot-panel__selection {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border-left: 3px solid var(--tp-pencil);
  border-radius: var(--tp-radius-s);
  background: var(--tp-pencil-soft);
}
.copilot-panel__selection[data-empty] {
  border-left-color: var(--tp-line);
  background: var(--tp-surface-sunken);
}
.copilot-panel__selection blockquote {
  margin: 0;
  max-height: 120px;
  overflow: auto;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.copilot-panel__body {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.copilot-panel__picker {
  display: flex;
  align-items: center;
  gap: 8px;
}
.copilot-panel__select {
  flex: 1;
  min-width: 0;
}
.copilot-panel__list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.copilot-panel__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--tp-radius-s);
  background: none;
  color: var(--tp-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.copilot-panel__row:hover {
  background: var(--tp-surface-sunken);
}
.copilot-panel__row[aria-pressed="true"] {
  border-color: var(--tp-pencil-line);
  background: var(--tp-pencil-soft);
}
.copilot-panel__row:focus-visible {
  outline: 2px solid var(--tp-focus);
  outline-offset: 2px;
}
/* 副驾坞内的会话卡片去掉外层卡片边框，避免双重描边。 */
.copilot-panel__body :deep(.assistant-session) {
  padding: 0;
  border: 0;
  background: none;
  box-shadow: none;
}
</style>
