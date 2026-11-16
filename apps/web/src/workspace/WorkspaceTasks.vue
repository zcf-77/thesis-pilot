<script setup lang="ts">
import { computed, nextTick, onActivated, onScopeDispose, ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";
import { PhSparkle } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import type { BackendServices, FeedbackItemSummary, ProjectRead, TaskRead, TaskSummary, TaskVersionPage } from "@/services";
import { asApiError } from "@/services/errors";
import TaskContentForm from "./tasks/TaskContentForm.vue";
import TaskDetail from "./tasks/TaskDetail.vue";
import TaskHistory from "./tasks/TaskHistory.vue";
import TaskList from "./tasks/TaskList.vue";
import TaskStageRoute from "./tasks/TaskStageRoute.vue";
import {
  archivedEvidence,
  boardProgress,
  detailCurrent,
  evidenceKey,
  feedbackFor,
  filterTasks,
  localToday,
  mergeDetail,
  readAll,
  shortDate,
  staleIds,
  successorsOf,
  type EvidenceItem,
  type TaskFilter,
} from "./tasks/taskBoard";
import {
  copy,
  documentTextblocks,
  draftKey,
  emptyTask,
  normalizeTask,
  readDraft,
  taskDraftError,
  writeDraft,
  type TaskContentDraft,
} from "./tasks/taskFeedbackDraft";

const props = defineProps<{ services: BackendServices; project: ProjectRead; workspaceId?: string }>();
type Command = { kind: "create" | "update" | "decide" | "reorder"; id?: string; input: unknown; source?: "editor" | "detail" };
type EditorSaved = { content: TaskContentDraft; baseVersion?: number; pending?: Command; unknown?: boolean };
type CommandSaved = { pending?: Command; unknown?: boolean };

const route = useRoute();
const today = localToday();
const items = shallowRef<TaskSummary[]>([]);
const boardVersion = ref(0);
const loading = ref(false);
const listError = ref("");
const details = shallowRef<ReadonlyMap<string, TaskRead>>(new Map());
const detailsLoading = ref(false);
const detailsFailed = ref(0);
const selectedId = ref<string>();
const selectError = ref("");
const filter = ref<TaskFilter>("open");
const editorOpen = ref(false);
const editorBase = shallowRef<TaskRead>();
const draft = ref<TaskContentDraft>(emptyTask());
const reason = ref("");
const pending = shallowRef<Command>();
const unknown = ref(false);
const busy = ref(false);
const mustReload = ref(false);
const error = ref("");
const storageError = ref("");
const notice = ref("");
const history = shallowRef<{ taskId: string; page: TaskVersionPage }>();
const historyLoading = ref(false);
const historyError = ref("");
const historyOpen = ref(false);
const feedbackItems = shallowRef<FeedbackItemSummary[]>([]);
const feedbackError = ref("");
const headings = shallowRef<ReadonlyMap<string, string>>(new Map());
const stampedId = ref<string>();
const draftTick = ref(0);
const aside = ref<HTMLElement>();
const editorForm = ref<HTMLFormElement>();
const issueBox = ref<HTMLElement>();

const progress = computed(() => boardProgress(items.value));
const progressKnown = computed(() => !!items.value.length || (!loading.value && !listError.value));
const visible = computed(() => filterTasks(items.value, filter.value));
const selected = computed(() => (selectedId.value ? details.value.get(selectedId.value) : undefined));
const selectedSummary = computed(() => items.value.find((item) => item.id === selectedId.value));
const selectedIndex = computed(() => items.value.findIndex((item) => item.id === selectedId.value));
const locked = computed(() => busy.value || unknown.value);
const disabled = computed(() => locked.value || mustReload.value || loading.value);
const successors = computed(() => (selectedId.value ? successorsOf(selectedId.value, items.value, details.value).tasks : []));
const successorNote = computed(() =>
  detailsLoading.value ? "正在核对后续任务…" : detailsFailed.value ? `有 ${detailsFailed.value} 项任务未能读取，后续任务可能不全。` : "",
);
const linkedFeedback = computed(() => (selectedId.value ? feedbackFor(selectedId.value, feedbackItems.value) : []));
const pastEvidence = computed(() =>
  selected.value && history.value?.taskId === selected.value.id ? archivedEvidence(selected.value, history.value.page.items) : [],
);
const chapters = computed(() => {
  const labels = new Map<string, string>();
  for (const [id, task] of details.value) {
    const chapter = task.content.chapter;
    if (chapter) labels.set(id, headings.value.get(chapter.chapter_id)?.slice(0, 24) ?? `章节 · 正文 v${chapter.version}`);
  }
  return labels;
});
const selectedChapter = computed(() => {
  const chapter = selected.value?.content.chapter;
  return chapter ? `关联章节：${headings.value.get(chapter.chapter_id) ?? chapter.chapter_id} · 固定在正文 v${chapter.version}` : undefined;
});
const asideVisible = computed(() => editorOpen.value || !!selectedId.value);
const editorDirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(editorBase.value ? normalizeTask(editorBase.value.content) : emptyTask()));
const issues = computed(() => [error.value, storageError.value].filter(Boolean));

const scope = (kind: string, id: string) => draftKey(props.services.sourceKey, props.workspaceId ?? "workspace", props.project.id, kind, id);
const editorKey = () => scope("task", editorBase.value?.id ?? "new");
const commandKey = (id?: string) => scope("task-command", id ?? "board");
function hasDraft(id: string) {
  void draftTick.value;
  try {
    return localStorage.getItem(scope("task", id)) !== null;
  } catch {
    return false;
  }
}
function forget(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 服务端回执为准；本机草稿清理失败不影响正式数据。 */
  }
  draftTick.value++;
}

let listRequest: AbortController | undefined;
let detailsRequest: AbortController | undefined;
let selectRequest: AbortController | undefined;
let historyRequest: AbortController | undefined;
let feedbackRequest: AbortController | undefined;
let documentRequest: AbortController | undefined;
let mutationRequest: AbortController | undefined;
let restoring = false;
let followedLink: string | undefined;

/** silent：回到缓存页面时静默重读，不显示读取态；失败时保留已显示的列表。 */
async function load(silent = false) {
  listRequest?.abort();
  const controller = new AbortController();
  listRequest = controller;
  if (!silent) {
    loading.value = true;
    listError.value = "";
  }
  try {
    const result: TaskSummary[] = [];
    let version: number | undefined;
    for (let offset = 0; !controller.signal.aborted;) {
      const page = await props.services.tasks.list(props.project.id, { offset, limit: 100 }, controller.signal);
      if (controller.signal.aborted) return;
      if (version !== undefined && version !== page.board_version) throw new Error("任务列表读取期间有变化，请刷新后重试。");
      version = page.board_version;
      result.push(...page.items);
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) break;
    }
    if (controller.signal.aborted) return;
    items.value = result;
    boardVersion.value = version ?? 0;
    afterList();
    void loadDetails();
  } catch (issue) {
    if (!controller.signal.aborted && !(silent && items.value.length))
      listError.value = issue instanceof Error && !("code" in issue) ? issue.message : asApiError(issue).message;
  } finally {
    if (listRequest === controller) loading.value = false;
  }
}
/** 深链只在首次读取或链接变化时生效，之后以用户选择为准。 */
function followLink() {
  const link = route.query.task;
  if (typeof link !== "string" || link === followedLink) return false;
  followedLink = link;
  const target = items.value.find((item) => item.id.toLowerCase() === link.toLowerCase());
  if (!target) {
    notice.value = "当前项目中未找到链接指向的任务，可从任务清单重新选择。";
    return false;
  }
  filter.value = "all";
  select(target.id, false);
  return true;
}
function afterList() {
  if (followLink()) return;
  if (editorOpen.value || locked.value) return;
  if (!selectedId.value || !items.value.some((item) => item.id === selectedId.value)) {
    const first = visible.value[0] ?? items.value[0];
    if (first) select(first.id, false);
    else selectedId.value = undefined;
  } else void ensureDetail(selectedId.value);
}
/** 列表摘要没有依赖与章节；按版本补读详情，迟到或旧版本结果不覆盖新数据。 */
async function loadDetails() {
  detailsRequest?.abort();
  const ids = staleIds(items.value, details.value);
  detailsFailed.value = 0;
  if (!ids.length) {
    detailsLoading.value = false;
    return;
  }
  const controller = new AbortController();
  detailsRequest = controller;
  detailsLoading.value = true;
  const projectId = props.project.id;
  const { results, failures } = await readAll(ids, (id) => props.services.tasks.get(projectId, id, controller.signal), controller.signal);
  if (controller.signal.aborted) return;
  let next = details.value;
  for (const task of results) next = mergeDetail(next, task);
  details.value = next;
  detailsFailed.value = failures.length;
  detailsLoading.value = false;
}
async function ensureDetail(id: string) {
  const summary = items.value.find((item) => item.id === id);
  if (summary && detailCurrent(summary, details.value.get(id))) return;
  selectRequest?.abort();
  const controller = new AbortController();
  selectRequest = controller;
  selectError.value = "";
  try {
    const task = await props.services.tasks.get(props.project.id, id, controller.signal);
    if (!controller.signal.aborted) details.value = mergeDetail(details.value, task);
  } catch (issue) {
    if (!controller.signal.aborted && selectedId.value === id) selectError.value = asApiError(issue).message;
  }
}
async function loadHistory(id: string) {
  historyRequest?.abort();
  const controller = new AbortController();
  historyRequest = controller;
  historyLoading.value = true;
  historyError.value = "";
  if (history.value?.taskId !== id) history.value = undefined;
  try {
    const page = await props.services.tasks.versions(props.project.id, id, { offset: 0, limit: 100 }, controller.signal);
    if (!controller.signal.aborted && selectedId.value === id) history.value = { taskId: id, page };
  } catch (issue) {
    if (!controller.signal.aborted) historyError.value = asApiError(issue).message;
  } finally {
    if (historyRequest === controller) historyLoading.value = false;
  }
}
async function loadFeedback() {
  feedbackRequest?.abort();
  const controller = new AbortController();
  feedbackRequest = controller;
  feedbackError.value = "";
  try {
    const result: FeedbackItemSummary[] = [];
    for (let offset = 0; !controller.signal.aborted;) {
      const batches = await props.services.feedback.list(props.project.id, { offset, limit: 100 }, controller.signal);
      for (const batch of batches.items) {
        for (let itemOffset = 0; !controller.signal.aborted;) {
          const page = await props.services.feedback.items(props.project.id, batch.id, { offset: itemOffset, limit: 100 }, controller.signal);
          result.push(...page.items.filter((item) => item.task_id));
          itemOffset += page.items.length;
          if (!page.items.length || itemOffset >= page.total) break;
        }
      }
      offset += batches.items.length;
      if (!batches.items.length || offset >= batches.total) break;
    }
    if (!controller.signal.aborted) feedbackItems.value = result;
  } catch (issue) {
    if (!controller.signal.aborted) feedbackError.value = `导师反馈关联未能读取：${asApiError(issue).message}`;
  }
}
async function loadHeadings() {
  documentRequest?.abort();
  const controller = new AbortController();
  documentRequest = controller;
  try {
    const document = await props.services.documents.current(props.project.id, controller.signal);
    if (controller.signal.aborted) return;
    headings.value = new Map(
      documentTextblocks(document.content.json)
        .filter((block) => block.chapterId)
        .map((block) => [block.chapterId!, block.text]),
    );
  } catch {
    /* 无正文或读取失败时，章节退回显示固定版本号，不影响任务操作。 */
  }
}
function refresh(silent = false) {
  void load(silent);
  void loadFeedback();
  void loadHeadings();
}
/** 外壳缓存本页；返回时静默重读列表、详情、历史与关联，编辑中的表单、草稿和待确认命令保持不动。 */
let activated = false;
onActivated(() => {
  if (!activated) {
    activated = true;
    return;
  }
  if (locked.value) return;
  refresh(true);
  if (selectedId.value && !editorOpen.value) void loadHistory(selectedId.value);
});

function persist() {
  if (restoring) return;
  try {
    if (editorOpen.value) {
      const editorCommand = pending.value && pending.value.source !== "detail" ? pending.value : undefined;
      if (!editorCommand && !editorDirty.value) forget(editorKey());
      else {
        writeDraft(editorKey(), {
          content: draft.value,
          baseVersion: editorBase.value?.version,
          pending: editorCommand,
          unknown: !!editorCommand && unknown.value,
        } satisfies EditorSaved);
        draftTick.value++;
      }
    }
    if (pending.value?.source === "detail") writeDraft(commandKey(pending.value.id), { pending: pending.value, unknown: unknown.value } satisfies CommandSaved);
    storageError.value = "";
  } catch {
    storageError.value = "本机草稿保存失败，当前输入仍留在页面，请保持页面打开。";
  }
}
function restoreCommand(id?: string) {
  try {
    const saved = readDraft<CommandSaved>(commandKey(id));
    if (saved?.pending && saved.unknown) {
      pending.value = saved.pending;
      unknown.value = true;
      error.value = "上次操作结果尚未确认，原命令已保留。请确认原请求结果后继续。";
    }
  } catch (issue) {
    storageError.value = String(issue);
  }
}
function select(id: string, scroll = true) {
  if (locked.value) return;
  if (editorOpen.value) closeEditor(false);
  if (selectedId.value !== id) {
    stampedId.value = undefined;
    reason.value = "";
    historyOpen.value = false;
  }
  selectedId.value = id;
  error.value = "";
  notice.value = "";
  mustReload.value = false;
  selectError.value = "";
  void ensureDetail(id);
  void loadHistory(id);
  restoreCommand(id);
  if (scroll && window.matchMedia?.("(max-width: 960px)").matches)
    void nextTick(() =>
      aside.value?.scrollIntoView({
        block: "start",
        behavior: document.documentElement.dataset.motion === "reduced" || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      }),
    );
}
function openEditor(task?: TaskRead) {
  if (locked.value) return;
  editorBase.value = task;
  draft.value = task ? normalizeTask(task.content) : emptyTask();
  pending.value = undefined;
  mustReload.value = false;
  error.value = "";
  notice.value = "";
  restoring = true;
  try {
    const saved = readDraft<EditorSaved>(editorKey());
    if (saved?.content?.title !== undefined && Array.isArray(saved.content.evidence)) {
      draft.value = saved.content;
      pending.value = saved.pending;
      unknown.value = !!saved.unknown;
      mustReload.value = !!task && saved.baseVersion !== task.version;
      if (unknown.value) error.value = "上次保存结果尚未确认，输入和原命令已保留。请确认原请求结果后继续。";
      else if (mustReload.value) error.value = "这份输入基于较早的任务版本，请载入最新版本后再保存。";
    }
  } catch (issue) {
    storageError.value = String(issue);
  }
  restoring = false;
  editorOpen.value = true;
  void nextTick(() => editorForm.value?.querySelector<HTMLInputElement>("input")?.focus());
}
function closeEditor(focus = true) {
  if (locked.value) return;
  persist();
  editorOpen.value = false;
  editorBase.value = undefined;
  mustReload.value = false;
  error.value = "";
  if (focus) void nextTick(() => aside.value?.querySelector<HTMLElement>("button")?.focus());
}
function revertDraft() {
  draft.value = editorBase.value ? normalizeTask(editorBase.value.content) : emptyTask();
  error.value = "";
}

async function execute() {
  const command = pending.value;
  if (!command || busy.value) return;
  const projectId = props.project.id;
  const key = command.source === "detail" ? commandKey(command.id) : editorKey();
  const controller = new AbortController();
  mutationRequest = controller;
  busy.value = true;
  error.value = "";
  unknown.value = true;
  persist();
  try {
    let result: TaskRead | undefined;
    if (command.kind === "create")
      result = await props.services.tasks.create(projectId, command.input as Parameters<BackendServices["tasks"]["create"]>[1], controller.signal);
    if (command.kind === "update")
      result = await props.services.tasks.update(projectId, command.id!, command.input as Parameters<BackendServices["tasks"]["update"]>[2], controller.signal);
    if (command.kind === "decide")
      result = await props.services.tasks.decide(projectId, command.id!, command.input as Parameters<BackendServices["tasks"]["decide"]>[2], controller.signal);
    if (command.kind === "reorder")
      await props.services.tasks.reorder(projectId, command.input as Parameters<BackendServices["tasks"]["reorder"]>[1], controller.signal);
    if (controller.signal.aborted) return;
    pending.value = undefined;
    unknown.value = false;
    mustReload.value = false;
    notice.value = "";
    forget(key);
    if (command.source !== "detail") {
      editorOpen.value = false;
      editorBase.value = undefined;
    }
    if (result) {
      details.value = mergeDetail(details.value, result);
      if (command.kind === "decide" && (command.input as { action: string }).action === "confirm") stampedId.value = result.id;
      if (selectedId.value !== result.id) {
        selectedId.value = result.id;
        historyOpen.value = false;
      }
      reason.value = "";
      void loadHistory(result.id);
    }
    await load();
  } catch (issue) {
    if (controller.signal.aborted) return;
    const problem = asApiError(issue);
    unknown.value = problem.status === undefined || problem.status >= 500 || problem.code === "INVALID_RESPONSE";
    mustReload.value = problem.status === 409 && !unknown.value;
    error.value = unknown.value ? "操作结果尚未确认，输入和原命令已保留。请确认原请求结果后继续。" : `${problem.message}（${problem.code}）`;
    if (!unknown.value) {
      pending.value = undefined;
      if (command.source === "detail") forget(key);
    }
    persist();
  } finally {
    if (mutationRequest === controller) busy.value = false;
  }
}
async function reloadBase() {
  const base = editorOpen.value ? editorBase.value : selected.value;
  try {
    if (base) {
      const latest = await props.services.tasks.get(props.project.id, base.id);
      details.value = mergeDetail(details.value, latest);
      if (editorOpen.value) {
        editorBase.value = latest;
        notice.value = `已载入最新版本 v${latest.version}，当前输入保留；请检查后再保存。`;
      }
    }
    mustReload.value = false;
    pending.value = undefined;
    error.value = "";
    if (editorOpen.value) persist();
    await load();
  } catch (issue) {
    error.value = asApiError(issue).message;
  }
}
async function save() {
  error.value = taskDraftError(draft.value, editorBase.value?.id);
  if (error.value || locked.value || mustReload.value) return;
  pending.value = editorBase.value
    ? {
        kind: "update",
        id: editorBase.value.id,
        source: "editor",
        input: { command_id: crypto.randomUUID(), expected_version: editorBase.value.version, content: copy(draft.value) },
      }
    : { kind: "create", source: "editor", input: { command_id: crypto.randomUUID(), expected_board_version: boardVersion.value, content: copy(draft.value) } };
  await execute();
}
async function update(content: TaskContentDraft) {
  const task = selected.value;
  if (!task || disabled.value) return;
  pending.value = { kind: "update", id: task.id, source: "detail", input: { command_id: crypto.randomUUID(), expected_version: task.version, content } };
  await execute();
}
function setStatus(status: TaskContentDraft["status"]) {
  if (selected.value) void update({ ...normalizeTask(selected.value.content), status });
}
function unlink(key: string) {
  if (!selected.value) return;
  const content = normalizeTask(selected.value.content);
  void update({ ...content, evidence: content.evidence.filter((item) => evidenceKey(item) !== key) });
}
function restoreEvidence(item: EvidenceItem) {
  if (!selected.value) return;
  const content = normalizeTask(selected.value.content);
  if (content.evidence.length >= 20) {
    error.value = "每项任务最多关联 20 条证据，请先解除不再需要的证据。";
    return;
  }
  void update({ ...content, evidence: [...content.evidence, copy(item.reference)] });
}
async function decide(action: "confirm" | "rework" | "reopen") {
  const task = selected.value;
  if (!task || disabled.value) return;
  if (action === "rework" && !reason.value.trim()) {
    error.value = "请先填写返工原因。";
    return;
  }
  pending.value = {
    kind: "decide",
    id: task.id,
    source: "detail",
    input: { command_id: crypto.randomUUID(), expected_version: task.version, action, reason: action === "confirm" ? "" : reason.value },
  };
  await execute();
}
async function move(offset: -1 | 1) {
  const index = selectedIndex.value;
  if (disabled.value || index < 0) return;
  const order = items.value.map((item) => item.id);
  const other = index + offset;
  if (other < 0 || other >= order.length) return;
  [order[index], order[other]] = [order[other]!, order[index]!];
  pending.value = {
    kind: "reorder",
    source: "detail",
    input: { command_id: crypto.randomUUID(), expected_board_version: boardVersion.value, task_ids: order },
  };
  await execute();
}

watch([draft, pending, unknown], persist, { deep: true });
watch(
  () => issues.value.join("\n"),
  (text) => {
    if (text) void nextTick(() => issueBox.value?.scrollIntoView({ block: "nearest" }));
  },
);
watch(
  () => route.query.task,
  (link) => {
    // 离开链接（含切到其他页面）后，再次打开同一任务链接仍需重新定位。
    if (typeof link !== "string") followedLink = undefined;
    else if (!loading.value && items.value.length && !locked.value) followLink();
  },
);
watch(
  () => props.project.id,
  () => {
    for (const request of [listRequest, detailsRequest, selectRequest, historyRequest, feedbackRequest, documentRequest, mutationRequest]) request?.abort();
    editorOpen.value = false;
    selectedId.value = undefined;
    pending.value = undefined;
    unknown.value = false;
    items.value = [];
    details.value = new Map();
    restoreCommand();
    refresh();
  },
  { immediate: true },
);
onScopeDispose(() => {
  persist();
  for (const request of [listRequest, detailsRequest, selectRequest, historyRequest, feedbackRequest, documentRequest, mutationRequest]) request?.abort();
});
</script>

<template>
  <div class="screen-page workspace-page plan-screen">
    <header class="screen-heading">
      <div>
        <p class="tp-label">Planning · 一步一步，走到答辩</p>
        <h1 class="tp-display mt-3">计划与进度</h1>
        <p class="screen-lead">看清接下来的一步，也留出从容修改的时间。</p>
      </div>
      <div class="plan-summary">
        <span class="tp-label">学生已确认 · 有效证据</span>
        <span class="tp-num" aria-label="已确认且证据有效的任务数">{{ progressKnown ? `${progress.valid} / ${progress.total}` : "— / —" }}</span>
        <span class="tp-caption">任务进度，不代表论文质量</span>
        <span v-if="progress.review" class="tp-caption plan-summary__review">另有 {{ progress.review }} 项已确认任务需复核</span>
        <TpButton variant="primary" size="sm" :disabled="locked || loading" @click="openEditor()">新增任务</TpButton>
      </div>
    </header>

    <TaskStageRoute :services="services" :project="project" />

    <Transition name="tp-swap" mode="out-in">
      <p v-if="notice" :key="notice" class="plan-notice" role="status">{{ notice }}</p>
    </Transition>
    <Transition name="tp-swap">
      <div v-if="issues.length && !asideVisible" class="tp-ghost plan-errors" role="alert">
        <p class="tp-subheading">{{ unknown ? "操作结果尚未确认" : "当前操作未保存" }}</p>
        <ul>
          <li v-for="issue in issues" :key="issue">{{ issue }}</li>
        </ul>
        <div v-if="unknown || mustReload" class="screen-actions">
          <TpButton v-if="mustReload" size="sm" @click="reloadBase">载入最新版本</TpButton
          ><TpButton v-if="unknown" size="sm" :loading="busy" @click="execute">确认原请求结果</TpButton>
        </div>
      </div>
    </Transition>

    <div class="screen-columns plan-columns" :class="{ 'plan-columns--solo': !asideVisible }">
      <div class="plan-main">
        <TaskList
          v-model:filter="filter"
          :items="visible"
          :total="items.length"
          :selected-id="editorOpen && !editorBase ? undefined : selectedId"
          :disabled="locked"
          :loading="loading"
          :error="listError"
          :today="today"
          :chapters="chapters"
          @select="select"
          @create="openEditor()"
          @retry="refresh()"
        />
        <div class="screen-actions plan-refresh">
          <TpButton size="sm" variant="ghost" :disabled="busy || loading" @click="refresh()">刷新任务</TpButton
          ><span class="tp-caption">排序版本 {{ boardVersion }}</span>
        </div>
        <TaskHistory
          v-if="selectedSummary"
          class="plan-history-slot"
          v-model:open="historyOpen"
          :task-id="selectedSummary.id"
          :title="selectedSummary.title"
          :history="history?.taskId === selectedSummary.id ? history.page : undefined"
          :loading="historyLoading"
          :error="historyError"
          @retry="loadHistory(selectedSummary.id)"
        />
      </div>

      <aside v-if="asideVisible" ref="aside" class="plan-aside" aria-label="任务详情">
        <Transition name="tp-swap">
          <div v-if="issues.length" ref="issueBox" class="tp-ghost plan-errors" role="alert">
            <p class="tp-subheading">{{ unknown ? "操作结果尚未确认" : "当前操作未保存" }}</p>
            <ul>
              <li v-for="issue in issues" :key="issue">{{ issue }}</li>
            </ul>
            <p class="tp-caption">已填写的内容保留在页面。</p>
            <div v-if="unknown || mustReload" class="screen-actions">
              <TpButton v-if="mustReload" size="sm" @click="reloadBase">{{ editorOpen ? "载入最新版本并保留输入" : "载入最新版本" }}</TpButton
              ><TpButton v-if="unknown" size="sm" :loading="busy" @click="execute">确认原请求结果</TpButton>
            </div>
          </div>
        </Transition>
        <Transition name="tp-swap" mode="out-in">
          <form
            v-if="editorOpen"
            :key="`editor:${editorBase?.id ?? 'new'}`"
            ref="editorForm"
            class="screen-panel plan-editor"
            aria-label="任务编辑器"
            novalidate
            @submit.prevent="save"
            @keydown.esc.prevent="closeEditor()"
          >
            <div class="plan-editor__heading">
              <h2 class="tp-subheading">{{ editorBase ? `编辑任务 · v${editorBase.version}` : "新增任务" }}</h2>
              <span class="tp-caption">Esc 取消</span>
            </div>
            <TaskContentForm v-model="draft" :services="services" :project-id="project.id" :task-id="editorBase?.id" :tasks="items" :disabled="locked" />
            <div class="screen-actions">
              <TpButton type="submit" variant="primary" size="sm" :loading="busy" :disabled="unknown || mustReload">保存任务</TpButton
              ><TpButton size="sm" variant="ghost" :disabled="locked" @click="closeEditor()">取消</TpButton
              ><TpButton v-if="editorDirty" size="sm" variant="ghost" :disabled="locked" @click="revertDraft">{{
                editorBase ? "还原为已保存版本" : "清空输入"
              }}</TpButton>
            </div>
          </form>
          <TaskDetail
            v-else-if="selected && selectedSummary"
            :key="selected.id"
            v-model:reason="reason"
            :task="selected"
            :index="selectedIndex"
            :count="items.length"
            :items="items"
            :successors="successors"
            :successor-note="successorNote"
            :feedback="linkedFeedback"
            :feedback-note="feedbackError"
            :past-evidence="pastEvidence"
            :chapter-label="selectedChapter"
            :source-key="services.sourceKey"
            :disabled="disabled"
            :busy="busy"
            :has-draft="hasDraft(selected.id)"
            :stamp="stampedId === selected.id"
            @edit="openEditor(selected)"
            @move="move"
            @select="select"
            @status="setStatus"
            @confirm="decide('confirm')"
            @rework="decide('rework')"
            @reopen="decide('reopen')"
            @unlink="unlink"
            @restore="restoreEvidence"
          />
          <div v-else-if="selectError" key="select-error" class="screen-panel tp-ghost plan-aside__blank" role="alert">
            <span>{{ selectError }}</span><TpButton size="sm" variant="ghost" @click="selectedId && ensureDetail(selectedId)">重新读取任务</TpButton>
          </div>
          <p v-else key="loading" class="screen-panel plan-aside__blank tp-caption" role="status">
            <span class="tp-btn__spinner" aria-hidden="true" />正在读取任务详情…
          </p>
        </Transition>
        <template v-if="!editorOpen && selected">
          <div class="plan-note">
            <TpIcon :icon="PhSparkle" :size="18" />
            <div>
              <p class="tp-subheading">每一步，都有依据。</p>
              <p class="tp-caption">已有产物只是完成的线索。任务是否完成，由你核验后决定。</p>
            </div>
          </div>
          <div v-if="project.deadline" class="plan-deadline">
            <div>
              <p class="tp-label">论文提交截止</p>
              <p class="tp-subheading">项目截止</p>
            </div>
            <div>
              <span class="tp-num">{{ shortDate(project.deadline) }}</span>
              <p class="tp-caption">{{ project.deadline.slice(0, 4) }} · 任务日期不得晚于此</p>
            </div>
          </div>
        </template>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.plan-summary {
  display: grid;
  gap: 4px;
  justify-items: end;
  text-align: right;
  flex-shrink: 0;
}
.plan-summary > .tp-num {
  font-size: 32px;
  line-height: 1.2;
}
.plan-summary > .tp-btn {
  margin-top: 8px;
}
.plan-summary__review {
  color: var(--tp-warning-content);
}
.plan-notice {
  padding: 12px 16px;
  border-left: 2px solid var(--tp-info);
  background: var(--tp-surface-sunken);
  font-size: 13px;
}
.plan-errors {
  padding: 20px;
  display: grid;
  gap: 12px;
  overflow-wrap: anywhere;
}
.plan-errors ul {
  display: grid;
  gap: 8px;
  list-style: disc;
  padding-left: 20px;
}
.plan-columns {
  align-items: start;
  grid-template-columns: minmax(0, 1fr) 360px;
}
.plan-columns--solo {
  grid-template-columns: minmax(0, 1fr);
}
.plan-main {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.plan-refresh {
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}
.plan-history-slot {
  order: 2;
}
.plan-aside {
  position: sticky;
  top: 24px;
  display: grid;
  gap: 16px;
  min-width: 0;
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  overscroll-behavior: contain;
  scroll-margin-top: 16px;
}
.plan-note {
  display: flex;
  gap: 12px;
  padding: 0 4px;
  color: var(--tp-text-muted);
}
.plan-note > svg {
  flex-shrink: 0;
  margin-top: 3px;
}
.plan-note .tp-subheading {
  font-size: 14px;
  color: var(--tp-text);
  margin-bottom: 8px;
}
.plan-deadline {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 4px 0;
  border-top: 1px solid var(--tp-line);
}
.plan-deadline .tp-subheading {
  margin-top: 8px;
}
.plan-deadline > div:last-child {
  text-align: right;
}
.plan-deadline .tp-num {
  font-size: 32px;
  line-height: 1.2;
}
.plan-editor {
  display: grid;
  gap: 16px;
  padding: 24px;
}
.plan-editor__heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.plan-editor :deep(.task-dates) {
  grid-template-columns: 1fr;
}
.plan-editor :deep(.evidence-picker) {
  padding: 12px;
}
.plan-aside__blank {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 20px;
}
@media (max-width: 1150px) {
  .plan-columns:not(.plan-columns--solo) {
    grid-template-columns: minmax(0, 1fr) 320px;
  }
}
@media (max-width: 960px) {
  .plan-columns:not(.plan-columns--solo) {
    grid-template-columns: minmax(0, 1fr);
  }
  .plan-main {
    display: contents;
  }
  .plan-aside {
    order: 1;
    position: static;
    max-height: none;
    overflow: visible;
  }
}
@media (max-width: 700px) {
  .plan-summary {
    justify-items: start;
    text-align: left;
  }
  .plan-editor {
    padding: 16px;
  }
  .plan-editor__heading {
    flex-wrap: wrap;
  }
}
</style>
