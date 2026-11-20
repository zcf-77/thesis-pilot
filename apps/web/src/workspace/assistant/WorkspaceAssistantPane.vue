<script setup lang="ts">
import { nextTick, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import { PhCaretDown, PhPlus, PhX } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { BackendServices } from "@/services";
import { asApiError } from "@/services/errors";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import WorkspaceAssistantSession from "./WorkspaceAssistantSession.vue";
import type { CapturedAssistantSelection } from "./assistantDrafts";

const props = defineProps<{
  services: BackendServices;
  projectId: string;
  workspaceId: string;
  currentVersion: number;
  eligible: boolean;
  captureSelection: () => CapturedAssistantSelection;
  initialSessionId?: string;
  initialRunId?: string;
}>();
const emit = defineEmits<{ close: [] }>();
type Session = Awaited<ReturnType<BackendServices["assistantSessions"]["get"]>>;
type Page = Awaited<ReturnType<BackendServices["assistantSessions"]["list"]>>;
const page = shallowRef<Page>();
const title = ref("");
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const uncertain = ref(false);
const openIds = ref<string[]>([]);
const selectedRun = ref<Record<string, string>>({});
const includeArchived = ref(false);
const editing = shallowRef<Session>();
const newTitle = ref("");
const editError = ref("");
const editConflict = ref(false);
const creating = ref(false);
const catalogOpen = ref(true);
const createInput = ref<HTMLInputElement>();
const editInput = ref<HTMLInputElement>();
let request: AbortController | undefined;
let mutation: AbortController | undefined;
let openRequest: AbortController | undefined;
const panelStorageKey = () => "thesispilot.assistant-panels.v1:" + JSON.stringify([props.services.sourceKey, props.workspaceId, props.projectId]);

async function load(offset = page.value?.offset ?? 0) {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const projectId = props.projectId;
  loading.value = true;
  error.value = "";
  try {
    const result = await props.services.assistantSessions.list(projectId, { offset, limit: 20, include_archived: includeArchived.value }, controller.signal);
    if (!controller.signal.aborted && props.projectId === projectId) page.value = result;
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}
function open(sessionId: string, runId?: string, priority = false) {
  if (!openIds.value.includes(sessionId)) {
    if (openIds.value.length >= 2) {
      if (priority) openIds.value.shift();
      else {
        notice.value = "已打开两个会话。先收起一个，再打开其他会话；各自草稿仍会保留。";
        return;
      }
    }
    openIds.value.push(sessionId);
  }
  if (runId) selectedRun.value = { ...selectedRun.value, [sessionId]: runId };
}
function beginCreate() {
  creating.value = true;
  void nextTick(() => createInput.value?.focus());
}
async function create() {
  if (busy.value || uncertain.value) return;
  error.value = "";
  if (!title.value.trim() || Array.from(title.value.trim()).length > 200) {
    error.value = "请输入 1 至 200 个字符的会话名称。";
    return;
  }
  const controller = new AbortController();
  mutation = controller;
  busy.value = true;
  try {
    const created = await props.services.assistantSessions.create(props.projectId, { title: title.value.trim(), role: "content" }, controller.signal);
    if (controller.signal.aborted) return;
    title.value = "";
    creating.value = false;
    await load(0);
    if (controller.signal.aborted) return;
    open(created.id);
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      uncertain.value = issue.status === undefined || issue.status >= 500 || issue.code === "INVALID_RESPONSE";
      error.value = uncertain.value ? "创建结果未知。请先刷新并核对会话列表，再决定是否重新创建。" : issue.message;
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
function edit(session: Session) {
  editing.value = session;
  newTitle.value = session.title;
  editError.value = "";
  editConflict.value = false;
  void nextTick(() => editInput.value?.focus());
}
function cancelEdit() {
  editing.value = undefined;
  editError.value = "";
  editConflict.value = false;
}
async function saveSession(archived?: boolean) {
  if (!editing.value || busy.value || editConflict.value) return;
  if (!newTitle.value.trim() || Array.from(newTitle.value.trim()).length > 200) {
    editError.value = "请输入 1 至 200 个字符的会话名称。";
    return;
  }
  const controller = new AbortController();
  mutation = controller;
  busy.value = true;
  try {
    await props.services.assistantSessions.update(
      props.projectId,
      editing.value.id,
      { expected_version: editing.value.version, title: newTitle.value.trim(), ...(archived === undefined ? {} : { archived }) },
      controller.signal,
    );
    if (controller.signal.aborted) return;
    editing.value = undefined;
    notice.value = archived === undefined ? "会话名称已保存。" : archived ? "会话已归档，消息与运行继续保留。" : "会话已恢复。";
    await load();
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      editConflict.value = issue.status === 409 || issue.status === undefined || issue.status >= 500 || issue.code === "INVALID_RESPONSE";
      editError.value = editConflict.value ? `${issue.message} 输入已保留，请载入最新会话后重新编辑。` : issue.message;
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
async function reloadSession() {
  if (!editing.value) return;
  const controller = new AbortController();
  mutation?.abort();
  mutation = controller;
  busy.value = true;
  try {
    const latest = await props.services.assistantSessions.get(props.projectId, editing.value.id, controller.signal);
    if (!controller.signal.aborted) edit(latest);
  } catch (problem) {
    if (!controller.signal.aborted) editError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
async function openLinked() {
  if (!props.initialRunId && !props.initialSessionId) return;
  openRequest?.abort();
  const controller = new AbortController();
  openRequest = controller;
  try {
    if (props.initialRunId) {
      const run = await props.services.assistantSessions.run(props.projectId, props.initialRunId, controller.signal);
      if (!controller.signal.aborted) open(run.session_id, run.id, true);
    } else if (props.initialSessionId) {
      const session = await props.services.assistantSessions.get(props.projectId, props.initialSessionId, controller.signal);
      if (!controller.signal.aborted) open(session.id, undefined, true);
    }
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  }
}
function restorePanels() {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(panelStorageKey()) ?? "[]");
    openIds.value = Array.isArray(stored)
      ? [...new Set(stored.filter((id): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id)))].slice(0, 2)
      : [];
  } catch {
    openIds.value = [];
    notice.value = "上次面板位置无法恢复；可从会话目录重新打开，本机草稿仍分别保留。";
  }
}
function close() {
  request?.abort();
  mutation?.abort();
  openRequest?.abort();
  emit("close");
}
watch(
  openIds,
  () => {
    try {
      window.localStorage.setItem(panelStorageKey(), JSON.stringify(openIds.value));
    } catch {
      notice.value = "面板位置未能保留，各会话的本机草稿仍分别存储。";
    }
  },
  { deep: true },
);
watch(includeArchived, () => void load(0));
watch(
  () => [props.initialRunId, props.initialSessionId],
  () => void openLinked(),
);
watch(
  () => [props.projectId, props.workspaceId],
  () => {
    openIds.value = [];
    selectedRun.value = {};
    cancelEdit();
    restorePanels();
    void load(0);
    void openLinked();
  },
);
onMounted(() => {
  restorePanels();
  void load(0);
  void openLinked();
});
onScopeDispose(() => {
  request?.abort();
  mutation?.abort();
  openRequest?.abort();
});
</script>

<template>
  <section class="assistant-workspace" aria-label="内容助手工作区">
    <header class="assistant-workspace__head">
      <div>
        <h2 class="tp-heading">内容助手</h2>
        <p class="tp-caption">{{ openIds.length ? `已打开 ${openIds.length} 个独立会话` : "选择一个会话继续" }}</p>
      </div>
      <div class="assistant-workspace__actions">
        <TpButton size="sm" variant="primary" :disabled="busy" @click="beginCreate"><TpIcon :icon="PhPlus" :size="14" />新建会话</TpButton>
        <TpButton size="sm" variant="ghost" icon-only label="收起内容助手" @click="close"><TpIcon :icon="PhX" :size="15" /></TpButton>
      </div>
    </header>

    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <form v-if="creating" class="assistant-create" aria-label="新建内容助手会话" @submit.prevent="create">
        <TpField v-slot="{ id }" label="会话名称">
          <input
            :id="id"
            ref="createInput"
            v-model="title"
            class="tp-input"
            maxlength="200"
            autocomplete="off"
            :readonly="busy"
            @keydown.esc.prevent="creating = false"
          />
        </TpField>
        <div class="assistant-workspace__actions">
          <TpButton type="submit" size="sm" variant="primary" :loading="busy" :disabled="busy || uncertain || !title.trim()">创建会话</TpButton>
          <TpButton size="sm" variant="ghost" :disabled="busy" @click="creating = false">取消</TpButton>
        </div>
      </form>
    </Transition>

    <section class="assistant-catalog" aria-label="内容助手会话目录">
      <button type="button" class="assistant-catalog__toggle" :aria-expanded="catalogOpen" @click="catalogOpen = !catalogOpen">
        <span>会话目录 <span>{{ page?.total ?? 0 }}</span></span
        ><TpIcon :icon="PhCaretDown" :size="14" />
      </button>
      <Transition name="tp-swap" v-bind="panelMotionHooks">
        <div v-if="catalogOpen" class="assistant-catalog__body">
          <div class="assistant-catalog__tools">
            <label><input v-model="includeArchived" type="checkbox" class="checkbox checkbox-sm" />包含已归档</label>
            <TpButton size="sm" variant="ghost" :disabled="loading" @click="load()">刷新</TpButton>
          </div>
          <p v-if="loading && !page" role="status" class="tp-caption">正在读取会话…</p>
          <p v-else-if="page && !page.total" class="assistant-catalog__empty">还没有内容会话。</p>
          <TransitionGroup tag="ul" name="tp-list" v-bind="listMotionHooks" class="assistant-session-list tp-list-group">
            <li v-for="session in page?.items" :key="session.id" :data-open="openIds.includes(session.id) || undefined">
              <button type="button" class="assistant-session-list__open" :aria-pressed="openIds.includes(session.id)" @click="open(session.id)">
                <span>{{ session.title }}</span>
                <TpStatus v-if="session.archived" tone="ghost" size="sm" label="已归档" />
                <span v-else class="tp-caption">正文会话</span>
              </button>
              <TpButton size="sm" variant="ghost" :label="`编辑会话：${session.title}`" @click="edit(session)">编辑</TpButton>
            </li>
          </TransitionGroup>
          <div v-if="page && page.total > 20" class="assistant-catalog__pages">
            <TpButton size="sm" variant="ghost" :disabled="loading || page.offset === 0" @click="load(Math.max(0, page.offset - 20))">上一页</TpButton>
            <span class="tp-caption">{{ page.offset + 1 }}–{{ page.offset + page.items.length }} / {{ page.total }}</span>
            <TpButton size="sm" variant="ghost" :disabled="loading || page.offset + page.items.length >= page.total" @click="load(page.offset + 20)"
              >下一页</TpButton
            >
          </div>
        </div>
      </Transition>
    </section>

    <div v-if="uncertain" class="assistant-workspace__recover">
      <TpButton size="sm" variant="outline" :disabled="loading" @click="load(0)">核对创建结果</TpButton>
      <TpButton
        size="sm"
        variant="ghost"
        :disabled="loading"
        @click="
          uncertain = false;
          error = '';
        "
        >已核对，继续创建</TpButton
      >
    </div>

    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <form v-if="editing" class="assistant-edit" aria-label="编辑内容助手会话" @submit.prevent="saveSession()">
        <TpField v-slot="{ id }" label="会话名称" :error="editError">
          <input :id="id" ref="editInput" v-model="newTitle" class="tp-input" maxlength="200" :readonly="busy" @keydown.esc.prevent="cancelEdit" />
        </TpField>
        <div class="assistant-workspace__actions">
          <TpButton size="sm" type="submit" variant="primary" :disabled="busy || editConflict">保存名称</TpButton>
          <TpButton size="sm" :disabled="busy || editConflict" @click="saveSession(!editing.archived)">{{
            editing.archived ? "恢复会话" : "归档会话"
          }}</TpButton>
          <TpButton v-if="editConflict" size="sm" variant="outline" :disabled="busy" @click="reloadSession">载入最新会话</TpButton>
          <TpButton size="sm" variant="ghost" @click="cancelEdit">取消</TpButton>
        </div>
      </form>
    </Transition>

    <Transition name="tp-swap" v-bind="panelMotionHooks"
      ><p v-if="error" :key="error" role="alert" class="assistant-workspace__error">{{ error }}</p></Transition
    >
    <Transition name="tp-swap" v-bind="panelMotionHooks"
      ><p v-if="notice" :key="notice" role="status" class="assistant-workspace__notice">{{ notice }}</p></Transition
    >

    <TransitionGroup tag="div" name="tp-list" v-bind="listMotionHooks" class="assistant-panels tp-list-group">
      <WorkspaceAssistantSession
        v-for="id in openIds"
        :key="`${projectId}:${id}`"
        :services="services"
        :project-id="projectId"
        :workspace-id="workspaceId"
        :session-id="id"
        :session-revision="page?.items.find((item) => item.id === id)?.version"
        :current-version="currentVersion"
        :eligible="eligible"
        :capture-selection="captureSelection"
        :initial-run-id="selectedRun[id]"
        @close="openIds = openIds.filter((item) => item !== id)"
        @updated="load()"
      />
    </TransitionGroup>
  </section>
</template>

<style scoped>
.assistant-workspace {
  display: grid;
  gap: 16px;
  min-width: 0;
  color: var(--tp-text);
}
.assistant-workspace__head,
.assistant-workspace__actions,
.assistant-catalog__tools,
.assistant-catalog__pages,
.assistant-workspace__recover {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.assistant-workspace__head {
  justify-content: space-between;
}
.assistant-workspace__head h2,
.assistant-workspace__head p {
  margin: 0;
}
.assistant-create,
.assistant-edit {
  display: grid;
  gap: 12px;
  padding-block: 12px;
  border-block: 1px solid var(--tp-line);
}
.assistant-catalog {
  border-block: 1px solid var(--tp-line);
}
.assistant-catalog__toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 40px;
  padding: 8px 0;
  border: 0;
  background: transparent;
  color: var(--tp-text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.assistant-catalog__toggle[aria-expanded="true"] > .tp-icon {
  transform: rotate(180deg);
}
.assistant-catalog__toggle > span > span {
  margin-left: 4px;
  color: var(--tp-text-muted);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.assistant-catalog__toggle:focus-visible,
.assistant-session-list__open:focus-visible {
  outline: 2px solid var(--tp-focus);
  outline-offset: 2px;
}
.assistant-catalog__body {
  padding-bottom: 8px;
}
.assistant-catalog__tools,
.assistant-catalog__pages {
  justify-content: space-between;
}
.assistant-catalog__tools label {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  color: var(--tp-text-muted);
  font-size: 12px;
  cursor: pointer;
}
.assistant-catalog__empty {
  margin: 8px 0;
  color: var(--tp-text-muted);
  font-size: 12.5px;
}
.assistant-session-list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}
.assistant-session-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  border-top: 1px solid var(--tp-line);
}
.assistant-session-list__open {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  min-height: 40px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--tp-radius-s);
  background: transparent;
  color: var(--tp-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.assistant-session-list__open > span:first-child {
  min-width: 0;
  overflow-wrap: anywhere;
}
.assistant-session-list__open:hover,
.assistant-session-list li[data-open] .assistant-session-list__open {
  background: var(--tp-surface-sunken);
}
.assistant-workspace__error {
  margin: 0;
  padding: 8px 10px;
  border-left: 2px solid var(--tp-danger);
  background: var(--tp-danger-soft);
  color: var(--tp-danger-content);
  font-size: 12.5px;
}
.assistant-workspace__notice {
  margin: 0;
  color: var(--tp-success-content);
  font-size: 12.5px;
}
.assistant-panels {
  display: grid;
  align-items: start;
  gap: 16px;
}
.assistant-panels > .assistant-session {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-m);
  background: var(--tp-surface-raised);
}
@media (min-width: 1600px) {
  .assistant-panels:has(> :nth-child(2)) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .assistant-workspace__head {
    align-items: flex-start;
  }
  .assistant-workspace__head > div:first-child {
    min-width: 0;
  }
  .assistant-workspace__actions .tp-btn,
  .assistant-catalog__tools .tp-btn,
  .assistant-session-list > li > .tp-btn {
    min-height: 36px;
  }
}
</style>
