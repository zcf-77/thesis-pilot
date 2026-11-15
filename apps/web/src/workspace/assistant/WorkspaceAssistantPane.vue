<script setup lang="ts">
import { onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
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
let request: AbortController | undefined;
let mutation: AbortController | undefined;
let openRequest: AbortController | undefined;
const panelStorageKey = "thesispilot.assistant-panels.v1:" + JSON.stringify([props.services.sourceKey, props.workspaceId, props.projectId]);
async function load(offset = page.value?.offset ?? 0) {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  loading.value = true;
  error.value = "";
  try {
    const result = await props.services.assistantSessions.list(
      props.projectId,
      { offset, limit: 20, include_archived: includeArchived.value },
      controller.signal,
    );
    if (!controller.signal.aborted) page.value = result;
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
        notice.value = "已打开两个独立面板，请先收起其中一个，再打开其他会话。草稿会继续保留。";
        return;
      }
    }
    openIds.value.push(sessionId);
  }
  if (runId) selectedRun.value = { ...selectedRun.value, [sessionId]: runId };
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
    await load(0);
    if (controller.signal.aborted) return;
    open(created.id);
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      uncertain.value = issue.status === undefined || issue.status >= 500 || issue.code === "INVALID_RESPONSE";
      error.value = uncertain.value ? "创建结果未知，请刷新并核对会话列表，再决定是否重新创建。" : issue.message;
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
      window.localStorage.setItem(panelStorageKey, JSON.stringify(openIds.value));
    } catch {
      notice.value = "面板位置未能保留，本机会话草稿仍分别存储。";
    }
  },
  { deep: true },
);
watch(includeArchived, () => void load(0));
watch(
  () => [props.initialRunId, props.initialSessionId],
  () => void openLinked(),
);
onMounted(() => {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(panelStorageKey) ?? "[]");
    if (Array.isArray(stored))
      openIds.value = [...new Set(stored.filter((id): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id)))].slice(0, 2);
  } catch {
    notice.value = "上次面板位置无法恢复，请从会话目录打开；本机草稿仍独立保留。";
  }
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
  <section class="assistant-workspace studio-stack" aria-label="内容助手工作区">
    <header class="studio-row">
      <h2 class="tp-heading">内容助手</h2>
      <TpButton size="sm" variant="ghost" @click="close">收起内容助手</TpButton>
    </header>
    <p class="tp-caption">真实运行仅生成选区修订候选。会话保存在服务端，未发送草稿只保留在本机。</p>
    <section class="screen-panel studio-body studio-stack" aria-label="内容助手会话目录">
      <form class="studio-stack" @submit.prevent="create">
        <TpField v-slot="{ id }" label="会话名称"><input :id="id" v-model="title" class="tp-input" maxlength="200" :readonly="busy" /></TpField
        ><TpButton type="submit" size="sm" variant="primary" :loading="busy" :disabled="busy || uncertain">创建内容助手会话</TpButton>
      </form>
      <div class="screen-actions">
        <TpButton size="sm" variant="ghost" :disabled="loading" @click="load()">刷新会话列表</TpButton
        ><label class="assistant-archive-filter"><input v-model="includeArchived" type="checkbox" class="checkbox checkbox-sm" />包含归档会话</label>
      </div>
      <p v-if="loading" role="status" class="tp-caption">正在读取会话目录…</p>
      <p v-if="page && !page.total" class="tp-caption">还没有内容助手会话。</p>
      <TransitionGroup tag="ul" name="tp-list" v-bind="listMotionHooks" class="assistant-session-list tp-list-group"
        ><li v-for="session in page?.items" :key="session.id">
          <TpButton size="sm" variant="ghost" :label="`打开会话：${session.title}`" @click="open(session.id)"
            >{{ session.title }}{{ session.archived ? "（已归档）" : "" }}</TpButton
          ><TpButton size="sm" variant="ghost" :label="`编辑会话：${session.title}`" @click="edit(session)">编辑</TpButton>
        </li></TransitionGroup
      >
      <div v-if="page && page.total > 20" class="screen-actions">
        <TpButton size="sm" :disabled="loading || page.offset === 0" @click="load(Math.max(0, page.offset - 20))">上一页会话</TpButton
        ><TpButton size="sm" :disabled="loading || page.offset + page.items.length >= page.total" @click="load(page.offset + 20)">下一页会话</TpButton>
      </div>
      <div v-if="uncertain" class="screen-actions">
        <TpButton size="sm" :disabled="loading || (!!error && !uncertain)" @click="load(0)">核对创建结果</TpButton
        ><TpButton
          size="sm"
          :disabled="loading"
          @click="
            uncertain = false;
            error = '';
          "
          >已核对，继续创建</TpButton
        >
      </div>
    </section>
    <Transition name="tp-swap" v-bind="panelMotionHooks"
      ><form v-if="editing" class="screen-panel studio-body studio-stack" aria-label="编辑内容助手会话" @submit.prevent="saveSession()">
        <TpField v-slot="{ id }" label="修改会话名称"><input :id="id" v-model="newTitle" class="tp-input" maxlength="200" :readonly="busy" /></TpField>
        <p v-if="editError" role="alert" class="studio-notice">{{ editError }}</p>
        <div class="screen-actions">
          <TpButton size="sm" type="submit" :disabled="busy || editConflict">保存会话信息</TpButton
          ><TpButton size="sm" :disabled="busy || editConflict" @click="saveSession(!editing.archived)">{{
            editing.archived ? "恢复会话" : "归档会话"
          }}</TpButton
          ><TpButton v-if="editConflict" size="sm" :disabled="busy" @click="reloadSession">载入最新会话</TpButton
          ><TpButton size="sm" variant="ghost" @click="editing = undefined">取消编辑会话</TpButton>
        </div>
      </form></Transition
    >
    <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="error" :key="error" role="alert" class="studio-notice">{{ error }}</p></Transition>
    <p v-if="notice" role="status" class="tp-caption">{{ notice }}</p>
    <TransitionGroup tag="div" name="tp-list" v-bind="listMotionHooks" class="assistant-panels studio-stack tp-list-group"
      ><WorkspaceAssistantSession
        v-for="id in openIds"
        :key="id"
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
    /></TransitionGroup>
  </section>
</template>

<style scoped>
.assistant-workspace {
  min-width: 0;
}
.assistant-session-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.assistant-session-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--tp-line);
}
.assistant-session-list li > :first-child {
  min-width: 0;
  text-align: left;
  overflow-wrap: anywhere;
}
.assistant-archive-filter {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
}
.assistant-panels {
  align-items: start;
}
@media (min-width: 1600px) {
  .assistant-panels {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
