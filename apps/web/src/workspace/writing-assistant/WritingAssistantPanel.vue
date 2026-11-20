<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, shallowRef, watch } from "vue";
import { PhArrowRight, PhPlus, PhX } from "@phosphor-icons/vue";
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
import { candidateNeedsReview, reconcileCandidateChoice } from "../assistant/assistantView";
import type { CapturedAssistantSelection } from "../assistant/assistantDrafts";
import { CANDIDATE_GROUP, STATUS_VIEW } from "./candidateReview";
import { nodeSelectionOf, selectionUsable, type CopilotAnchor, type CopilotPanelProps } from "./copilotPanel";
import WritingCandidateReview from "./WritingCandidateReview.vue";

/** 内容副驾只编排会话与候选；所有正文写入仍由候选审阅中的受控命令完成。 */
const props = defineProps<CopilotPanelProps>();
const emit = defineEmits<{ overlays: [group: string, highlights: PreviewHighlight[]]; focus: [anchor: CopilotAnchor]; changed: []; close: [] }>();
type SessionPage = Awaited<ReturnType<BackendServices["assistantSessions"]["list"]>>;
type CandidatePage = Awaited<ReturnType<BackendServices["revisions"]["list"]>>;
type View = "conversation" | "review";

const view = ref<View>("conversation");
const sessions = shallowRef<SessionPage>();
const sessionId = ref("");
const creating = ref(false);
const title = ref("");
const candidates = shallowRef<CandidatePage>();
const candidateId = ref("");
const incomingCandidateId = ref("");
const loading = ref(false);
const candidatesLoading = ref(false);
const busy = ref(false);
const error = ref("");
const titleInput = ref<HTMLInputElement>();
const newSessionTrigger = ref<HTMLElement>();
const sessionComponent = ref<InstanceType<typeof WorkspaceAssistantSession>>();
let request: AbortController | undefined;
let candidateRequest: AbortController | undefined;
let disposed = false;

const usable = computed(() => selectionUsable(props.selection));
const sessionOptions = computed(() =>
  (sessions.value?.items ?? []).map((item) => ({ value: item.id, label: item.archived ? `${item.title}（已归档）` : item.title })),
);
const reviewCount = computed(() => (candidates.value?.items ?? []).filter((item) => candidateNeedsReview(item, props.document?.version ?? -1)).length);
const selectedCandidate = computed(() => candidates.value?.items.find((item) => item.id === candidateId.value));
const selectedStale = computed(() => !!selectedCandidate.value && selectedCandidate.value.base_version !== (props.document?.version ?? -1));
const viewOptions = computed(() => [
  { value: "conversation" as const, label: "当前对话" },
  { value: "review" as const, label: reviewCount.value ? `候选审阅 · ${reviewCount.value}` : "候选审阅" },
]);

/** 发送前只接受已保存最新版本上的同段非空选区。 */
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
  candidateRequest?.abort();
  if (!document) {
    candidates.value = undefined;
    candidateId.value = "";
    return;
  }
  const controller = new AbortController();
  candidateRequest = controller;
  candidatesLoading.value = true;
  const previous = candidates.value;
  try {
    const page = await props.services.revisions.list(props.project.id, document.id, { offset: 0, limit: 20 }, controller.signal);
    if (controller.signal.aborted || disposed || props.document?.id !== document.id) return;
    const arrived = previous
      ? page.items.find((item) => !previous.items.some((old) => old.id === item.id) && candidateNeedsReview(item, props.document?.version ?? -1))
      : undefined;
    candidates.value = page;
    candidateId.value = reconcileCandidateChoice(candidateId.value, page.items);
    if (arrived && arrived.id !== candidateId.value) incomingCandidateId.value = arrived.id;
  } catch (problem) {
    if (!controller.signal.aborted && !disposed) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted && !disposed) candidatesLoading.value = false;
  }
}

function beginCreate() {
  creating.value = true;
  error.value = "";
  void nextTick(() => titleInput.value?.focus());
}
function cancelCreate() {
  if (!sessionOptions.value.length) return;
  creating.value = false;
  void nextTick(() => newSessionTrigger.value?.querySelector<HTMLButtonElement>("button")?.focus());
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
    view.value = "conversation";
  } catch (problem) {
    if (!disposed) error.value = asApiError(problem).message;
  } finally {
    if (!disposed) busy.value = false;
  }
}
function openCandidate(id: string) {
  candidateId.value = id;
  incomingCandidateId.value = "";
  view.value = "review";
}
function prepareRevision() {
  view.value = "conversation";
  incomingCandidateId.value = "";
  void nextTick(() => sessionComponent.value?.prepareRevision());
}
function forward(group: string, highlights: PreviewHighlight[]) {
  emit("overlays", group, highlights);
}
function onChanged() {
  emit("changed");
  void loadCandidates();
}
function onSessionUpdated() {
  void loadCandidates();
}

watch(
  () => props.project.id,
  () => {
    sessionId.value = "";
    candidateId.value = "";
    incomingCandidateId.value = "";
    candidates.value = undefined;
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
  candidateRequest?.abort();
  emit("overlays", CANDIDATE_GROUP, []);
});
</script>

<template>
  <section class="writing-assistant" aria-label="内容助手" :aria-busy="loading || busy">
    <header class="writing-assistant__head">
      <div class="writing-assistant__identity"><h2 class="tp-subheading">内容助手</h2></div>
      <span ref="newSessionTrigger">
        <TpButton v-if="sessionOptions.length && !creating" size="sm" variant="ghost" :disabled="busy" @click="beginCreate">
          <TpIcon :icon="PhPlus" :size="14" />新建会话
        </TpButton>
      </span>
    </header>

    <TpSelect
      v-if="sessionOptions.length && !creating"
      v-model="sessionId"
      class="writing-assistant__session-select"
      :options="sessionOptions"
      aria-label="当前内容会话"
      placeholder="选择会话"
      :disabled="loading || busy"
    />

    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <form v-if="creating || !sessionOptions.length" key="create" class="writing-assistant__create" @submit.prevent="createSession">
        <label class="tp-label" for="assistant-session-title">新会话名称</label>
        <input
          id="assistant-session-title"
          ref="titleInput"
          v-model="title"
          class="tp-input"
          maxlength="200"
          placeholder="例如：第三章润色"
          autocomplete="off"
          :readonly="busy"
          @keydown.esc.prevent="cancelCreate"
        />
        <div class="writing-assistant__create-actions">
          <TpButton type="submit" size="sm" variant="primary" :disabled="busy || !title.trim()" :loading="busy">创建会话</TpButton>
          <TpButton v-if="sessionOptions.length" size="sm" variant="ghost" :disabled="busy" @click="cancelCreate">
            <TpIcon :icon="PhX" :size="14" />取消
          </TpButton>
        </div>
      </form>
    </Transition>

    <p v-if="loading && !sessions" role="status" class="tp-caption">正在读取会话…</p>
    <p v-else-if="sessions && !sessions.items.length && !creating" class="tp-caption">建立一个会话，开始整理当前段落的修改目标。</p>

    <template v-if="sessionId && document">
      <TpSegmented v-model="view" label="内容助手工作区" :options="viewOptions" />

      <Transition name="tp-swap" v-bind="panelMotionHooks">
        <button
          v-if="incomingCandidateId"
          :key="incomingCandidateId"
          type="button"
          class="writing-assistant__incoming"
          @click="openCandidate(incomingCandidateId)"
        >
          <span>新候选已就绪</span><span>立即审阅<TpIcon :icon="PhArrowRight" :size="14" /></span>
        </button>
      </Transition>

      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <div v-if="view === 'conversation'" key="conversation" class="writing-assistant__body">
          <section class="writing-assistant__selection" :data-empty="!usable || undefined" aria-label="当前纸面选区">
            <div>
              <span class="tp-label">当前选区</span>
              <span v-if="usable && selection" class="tp-caption">正式稿 v{{ document.version }} · {{ selection.end - selection.start }} 字</span>
            </div>
            <p v-if="usable && selection" :title="selection.text">{{ selection.text }}</p>
            <p v-else class="tp-caption">在正文中选择同一段落的文字。</p>
          </section>
          <p v-if="!eligible" class="writing-assistant__notice" role="status">先保存当前正文，再发起或采纳修订。</p>

          <WorkspaceAssistantSession
            ref="sessionComponent"
            :key="`${project.id}:${sessionId}`"
            :services="services"
            :project-id="project.id"
            workspace-id="writing"
            :session-id="sessionId"
            :current-version="document.version"
            :eligible="eligible && usable"
            :capture-selection="captureSelection"
            :closable="false"
            @updated="onSessionUpdated"
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
                @settled="onSessionUpdated"
                @renew="prepareRevision"
              />
            </template>
          </WorkspaceAssistantSession>
        </div>

        <div v-else key="review" class="writing-assistant__body writing-assistant__review-view">
          <Transition name="tp-swap" v-bind="panelMotionHooks">
            <p v-if="candidatesLoading && !candidates" role="status" class="tp-caption">正在读取候选…</p>
            <div v-else-if="!candidates?.items.length" key="empty" class="writing-assistant__empty">
              <p>还没有需要审阅的候选。</p>
              <TpButton size="sm" variant="pencil" @click="prepareRevision">回到当前对话</TpButton>
            </div>
            <WritingCandidateReview
              v-else-if="candidateId"
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
              @settled="onSessionUpdated"
              @renew="prepareRevision"
            />
          </Transition>

          <details v-if="candidates?.items.length" class="writing-assistant__history">
            <summary>全部候选 <span>{{ candidates.total }}</span></summary>
            <TransitionGroup tag="ul" name="tp-list" v-bind="listMotionHooks" class="writing-assistant__candidate-list tp-list-group">
              <li v-for="item in candidates.items" :key="item.id">
                <button type="button" class="writing-assistant__candidate-row" :aria-pressed="candidateId === item.id" @click="openCandidate(item.id)">
                  <TpStatus
                    size="sm"
                    :tone="item.base_version !== document.version && ['ready', 'invalid'].includes(item.status) ? 'stale' : STATUS_VIEW[item.status].tone"
                    :label="item.base_version !== document.version && ['ready', 'invalid'].includes(item.status) ? '已过期' : STATUS_VIEW[item.status].label"
                  />
                  <span>基于 v{{ item.base_version }}</span>
                  <time :datetime="item.created_at">{{ new Date(item.created_at).toLocaleDateString("zh-CN") }}</time>
                </button>
              </li>
            </TransitionGroup>
          </details>
          <p v-if="selectedStale" class="tp-caption">旧候选保留用于核对，不会覆盖当前正文。</p>
        </div>
      </Transition>
    </template>
    <p v-else-if="!document && sessions?.items.length" class="tp-caption">创建或导入正式稿后，即可使用内容助手。</p>

    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <p v-if="error" :key="error" role="alert" class="writing-assistant__notice is-error">{{ error }}</p>
    </Transition>
  </section>
</template>

<style scoped>
.writing-assistant {
  display: grid;
  align-content: start;
  gap: 12px;
  min-width: 0;
  color: var(--tp-text);
}
.writing-assistant__head,
.writing-assistant__create-actions,
.writing-assistant__selection > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.writing-assistant__identity {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.writing-assistant__identity h2 {
  flex: none;
  margin: 0;
}
.writing-assistant__identity p {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.writing-assistant__session-select {
  width: 100%;
}
.writing-assistant__create {
  display: grid;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--tp-line);
}
.writing-assistant__create-actions {
  justify-content: flex-start;
}
.writing-assistant__body {
  display: grid;
  gap: 14px;
  min-width: 0;
}
.writing-assistant__selection {
  display: grid;
  gap: 6px;
  padding: 0 0 12px 12px;
  border-bottom: 1px solid var(--tp-line);
  border-left: 2px solid var(--tp-pencil-line);
}
.writing-assistant__selection[data-empty] {
  border-left-color: var(--tp-line-strong);
}
.writing-assistant__selection p {
  display: -webkit-box;
  max-height: 5.4em;
  margin: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.8;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.writing-assistant__selection[data-empty] p {
  color: var(--tp-text-muted);
}
.writing-assistant__notice {
  margin: 0;
  padding: 8px 10px;
  border-left: 2px solid var(--tp-warning);
  background: var(--tp-warning-soft);
  color: var(--tp-warning-content);
  font-size: 12.5px;
  line-height: 1.6;
}
.writing-assistant__notice.is-error {
  border-left-color: var(--tp-danger);
  background: var(--tp-danger-soft);
  color: var(--tp-danger-content);
}
.writing-assistant__incoming {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 36px;
  padding: 8px 0;
  border: 0;
  border-bottom: 1px dashed var(--tp-pencil-line);
  background: transparent;
  color: var(--tp-pencil-content);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.writing-assistant__incoming > span:last-child {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
}
.writing-assistant__incoming:focus-visible,
.writing-assistant__candidate-row:focus-visible {
  outline: 2px solid var(--tp-focus);
  outline-offset: 2px;
}
.writing-assistant__empty {
  display: grid;
  justify-items: start;
  gap: 12px;
  padding: 16px 0;
  color: var(--tp-text-muted);
  font-size: 13px;
}
.writing-assistant__empty p {
  margin: 0;
}
.writing-assistant__history {
  border-top: 1px solid var(--tp-line);
  color: var(--tp-text-muted);
  font-size: 12px;
}
.writing-assistant__history summary {
  padding: 12px 0 4px;
  cursor: pointer;
}
.writing-assistant__history summary span {
  margin-left: 4px;
  font-variant-numeric: tabular-nums;
}
.writing-assistant__candidate-list {
  display: grid;
  gap: 2px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}
.writing-assistant__candidate-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--tp-radius-s);
  background: transparent;
  color: var(--tp-text-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.writing-assistant__candidate-row:hover {
  background: var(--tp-surface-sunken);
}
.writing-assistant__candidate-row[aria-pressed="true"] {
  border-color: var(--tp-pencil-line);
  background: var(--tp-pencil-soft);
  color: var(--tp-pencil-content);
}
.writing-assistant__body :deep(.assistant-session) {
  padding: 0;
  border: 0;
  background: none;
  box-shadow: none;
}
@media (max-width: 420px) {
  .writing-assistant__identity {
    display: grid;
    gap: 0;
  }
  .writing-assistant__candidate-row {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .writing-assistant__candidate-row time {
    display: none;
  }
}
</style>
