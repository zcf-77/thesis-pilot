<script setup lang="ts">
import { computed, nextTick, onActivated, onScopeDispose, ref, shallowRef, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { PhArrowBendDownRight, PhArrowCounterClockwise, PhCheck, PhFileText, PhPaperclip, PhQuestion, PhQuotes } from "@phosphor-icons/vue";
import EvidenceChip from "@/components/domain/EvidenceChip.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import type { BackendServices, ProjectRead } from "@/services";
import type { DocumentEvidence } from "@/services/contracts/api.generated";
import { asApiError } from "@/services/errors";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import EvidencePicker from "./tasks/EvidencePicker.vue";
import TaskContentForm from "./tasks/TaskContentForm.vue";
import {
  copy,
  draftKey,
  emptyTask,
  exactTextRange,
  normalizeFeedback,
  readDraft,
  taskDraftError,
  writeDraft,
  type FeedbackDraft,
} from "./tasks/taskFeedbackDraft";
import FeedbackEntryForm from "./feedback/FeedbackEntryForm.vue";
import FeedbackInterpretationFields from "./feedback/FeedbackInterpretationFields.vue";
import FeedbackOriginal from "./feedback/FeedbackOriginal.vue";
import FeedbackSplitPanel from "./feedback/FeedbackSplitPanel.vue";
import {
  batchKey,
  buildInbox,
  evidenceExcerpt,
  evidenceView,
  filterInbox,
  firstLine,
  formatTime,
  historyActions,
  inboxCounts,
  itemKey,
  rebaseSelection,
  resolveFeedbackLink,
  sameEvidence,
  type FeedbackFilter,
} from "./feedback/feedbackPresentation";
import type { SourceRange } from "./feedback/feedbackSelection";
import { tasksRoute, writingRoute } from "./workspaceRoutes";

const props = defineProps<{ services: BackendServices; project: ProjectRead; workspaceId?: string }>();
const route = useRoute();
type Batch = Awaited<ReturnType<BackendServices["feedback"]["get"]>>;
type Summary = Awaited<ReturnType<BackendServices["feedback"]["list"]>>["items"][number];
type Item = Awaited<ReturnType<BackendServices["feedback"]["item"]>>;
type ItemSummary = Awaited<ReturnType<BackendServices["feedback"]["items"]>>["items"][number];
type History = Awaited<ReturnType<BackendServices["feedback"]["versions"]>>;
type HistoryEntry = History["items"][number];
type TaskSummary = Awaited<ReturnType<BackendServices["tasks"]["list"]>>["items"][number];
type Mode = "none" | "create" | "interpretation" | "task" | "evidence";
type Pending = { kind: "batch" | "itemCreate" | "itemUpdate" | "decide"; batchId?: string; id?: string; input: unknown };

const maxFeedbackLength = 10_000;
const blankDraft = (source_range: SourceRange = { from: 0, to: 1, text: "" }): FeedbackDraft => ({
  source_range,
  interpretation: "",
  certainty: "uncertain",
  correction: "",
  source_checked: false,
  task_id: null,
  new_task: null,
  evidence: [],
});

const batches = shallowRef<Summary[]>([]);
const itemsByBatch = shallowRef(new Map<string, ItemSummary[]>());
const failedBatches = shallowRef(new Set<string>());
const tasks = shallowRef<TaskSummary[]>([]);
const originals = new Map<string, Batch>();
const filter = ref<FeedbackFilter>("all");
const selectedKey = ref("");
const batch = shallowRef<Batch>();
const selected = shallowRef<Item>();
const draft = ref<FeedbackDraft>(blankDraft());
const mode = ref<Mode>("none");
const linkMode = ref("none");
const taskChoice = ref("");
const reason = ref("");
const range = ref<SourceRange>();
const history = shallowRef<History>();
const historyLoading = ref(false);
const excerptOpen = ref(false);
const original = ref("");
const originalOpen = ref(false);
const entryError = ref("");
const entryTrigger = ref<HTMLElement>();
const loaded = ref(false);
const loading = ref(false);
const detailLoading = ref(false);
const busy = ref(false);
const rebasing = ref(false);
const error = ref("");
const listError = ref("");
const storageError = ref("");
const notice = ref("");
const mustReload = ref(false);
const unknown = ref(false);
const stampedId = ref("");
const pending = shallowRef<Pending>();
const linkQuery = shallowRef<{ batch?: string; item?: string }>();
const splitHighlight = shallowRef<{ from: number; to: number }>();

const entries = computed(() => buildInbox(batches.value, itemsByBatch.value, failedBatches.value));
const visible = computed(() => filterInbox(entries.value, filter.value));
const counts = computed(() => inboxCounts(entries.value));
const entry = computed(() => entries.value.find((value) => value.key === selectedKey.value));
const originalKey = computed(() => draftKey(props.services.sourceKey, props.workspaceId ?? "workspace", props.project.id, "feedback-original", "new"));
const itemDraftId = computed(() => (mode.value === "create" || pending.value?.kind === "itemCreate" ? batch.value?.id : selected.value?.id));
const itemDraftKey = computed(() =>
  itemDraftId.value ? draftKey(props.services.sourceKey, props.workspaceId ?? "workspace", props.project.id, "feedback-item", itemDraftId.value) : undefined,
);
const saved = computed(() => (selected.value ? normalizeFeedback(selected.value.content) : undefined));
const dirty = computed(() => !!saved.value && JSON.stringify(draft.value) !== JSON.stringify(saved.value));
const canAct = computed(() => !!selected.value && mode.value === "none" && !dirty.value && !busy.value && !unknown.value && !mustReload.value);
const reasons = computed(() => selected.value?.review_reasons ?? []);
const unclear = computed(() => reasons.value.includes("不确定解释尚未纠正"));
const title = computed(() => firstLine(selected.value?.content.interpretation ?? "", 40));
const linkedTask = computed(() => tasks.value.find((task) => task.id === selected.value?.content.task_id));
const snapshots = computed(() => selected.value?.evidence_snapshots ?? []);
const hasStaleDocument = computed(() => snapshots.value.some((value) => value.stale && value.reference.kind === "document"));
const highlight = computed(() => {
  const value = mode.value === "create" ? draft.value.source_range : (splitHighlight.value ?? selected.value?.content.source_range);
  return value && batch.value && value.to - value.from < batch.value.original_text.length ? value : undefined;
});
const cardTone = computed(() => (mode.value === "interpretation" ? "tp-pencil" : unclear.value ? "tp-ghost" : "tp-ink"));
const decisionHint = computed(() =>
  mode.value !== "none" || dirty.value
    ? "请先保存或取消当前编辑，再记录处理结果。"
    : selected.value?.needs_review
      ? `先完成：${reasons.value.join("、")}。`
      : "标记已处理不会改变正文，也不代表导师已认可。",
);
const taskOptions = computed(() => [
  { value: "", label: "选择当前项目任务" },
  ...tasks.value
    .filter((task) => task.id !== selected.value?.content.task_id)
    .map((task) => ({ value: task.id, label: `${task.title}${task.archived ? "（已归档）" : ""}`, disabled: task.archived })),
]);
const createTaskOptions = computed(() => [
  { value: "", label: "选择已有任务" },
  ...tasks.value.map((task) => ({
    value: task.id,
    label: `${task.title}${task.archived ? "（已归档）" : ""}`,
    disabled: task.archived && task.id !== draft.value.task_id,
  })),
]);

let listRequest: AbortController | undefined;
let detailRequest: AbortController | undefined;
let mutationRequest: AbortController | undefined;
let restoring = false;

async function allPages<T>(fetchPage: (offset: number) => Promise<{ items: T[]; total: number }>, signal: AbortSignal) {
  const result: T[] = [];
  for (let offset = 0; !signal.aborted;) {
    const page = await fetchPage(offset);
    result.push(...page.items);
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  }
  return result;
}

/** silent：回到缓存页面时静默重读，不显示读取态；读取失败时保留已显示的反馈。 */
async function load(silent = false) {
  listRequest?.abort();
  const controller = new AbortController();
  listRequest = controller;
  const { signal } = controller;
  const projectId = props.project.id;
  if (!silent) {
    loading.value = true;
    listError.value = "";
  }
  const results = await Promise.allSettled([
    allPages((offset) => props.services.feedback.list(projectId, { offset, limit: 100 }, signal), signal),
    allPages((offset) => props.services.tasks.list(projectId, { offset, limit: 100 }, signal), signal),
  ]);
  if (signal.aborted) return;
  const failures: string[] = [];
  if (results[0].status === "fulfilled") {
    const list = results[0].value;
    const pages = await Promise.allSettled(
      list.map((source) =>
        source.item_count ? allPages((offset) => props.services.feedback.items(projectId, source.id, { offset, limit: 100 }, signal), signal) : [],
      ),
    );
    if (signal.aborted) return;
    const map = new Map<string, ItemSummary[]>();
    const failed = new Set<string>();
    pages.forEach((page, index) => {
      if (page.status === "fulfilled") map.set(list[index]!.id, page.value);
      else failed.add(list[index]!.id);
    });
    if (failed.size) failures.push(`${failed.size} 次反馈的解释项读取失败，原文与已保存解释不受影响`);
    batches.value = list;
    itemsByBatch.value = map;
    failedBatches.value = failed;
  } else failures.push(`反馈读取失败：${asApiError(results[0].reason).message}，已保存的反馈不受影响`);
  if (results[1].status === "fulfilled") tasks.value = results[1].value;
  else failures.push(`任务选项读取失败：${asApiError(results[1].reason).message}`);
  if (!silent || !failures.length || !loaded.value) listError.value = failures.length ? `${failures.join("；")}。可重新读取。` : "";
  loading.value = false;
  loaded.value = true;
}

function resetDetail() {
  mode.value = "none";
  range.value = undefined;
  history.value = undefined;
  excerptOpen.value = false;
  mustReload.value = false;
  reason.value = "";
  taskChoice.value = "";
  error.value = "";
}

async function select(key: string, internal = false) {
  if (!internal && (busy.value || unknown.value || key === selectedKey.value)) return;
  if (!internal) persist();
  detailRequest?.abort();
  const previous = selectedKey.value === key ? selected.value : undefined;
  const kept = history.value;
  selectedKey.value = key;
  resetDetail();
  const target = entries.value.find((value) => value.key === key);
  if (!target) {
    batch.value = undefined;
    selected.value = undefined;
    return;
  }
  const controller = new AbortController();
  detailRequest = controller;
  detailLoading.value = true;
  try {
    const [source, item] = await Promise.all([
      originals.get(target.batchId) ?? props.services.feedback.get(props.project.id, target.batchId, controller.signal),
      target.itemId ? props.services.feedback.item(props.project.id, target.itemId, controller.signal) : undefined,
    ]);
    if (controller.signal.aborted) return;
    originals.set(source.id, source);
    batch.value = source;
    // 重读同一条目且版本未变时保留已展开的处理历史。
    if (item && kept && previous?.id === item.id && previous.version === item.version && !history.value) history.value = kept;
    selected.value = item;
    draft.value = item ? normalizeFeedback(item.content) : blankDraft();
    if (item) restoreItem();
    else restoreCreate();
  } catch (issue) {
    if (!controller.signal.aborted) error.value = `反馈详情读取失败：${asApiError(issue).message}。原文不受影响，可重新选择这条意见。`;
  } finally {
    if (!controller.signal.aborted) detailLoading.value = false;
  }
}

function persist() {
  if (restoring) return;
  try {
    if (originalOpen.value || pending.value?.kind === "batch")
      writeDraft(originalKey.value, {
        text: original.value,
        pending: pending.value?.kind === "batch" ? pending.value : undefined,
        unknown: pending.value?.kind === "batch" && unknown.value,
      });
    const itemPending = pending.value && pending.value.kind !== "batch" ? pending.value : undefined;
    if (itemDraftKey.value && (mode.value !== "none" || itemPending))
      writeDraft(itemDraftKey.value, {
        content: draft.value,
        baseVersion: mode.value === "create" ? undefined : selected.value?.version,
        reason: reason.value,
        linkMode: linkMode.value,
        mode: mode.value,
        pending: itemPending,
        unknown: !!itemPending && unknown.value,
      });
    storageError.value = "";
  } catch {
    storageError.value = "本机草稿保存失败，输入仍在当前页面，请保持页面打开。";
  }
}

type SavedItem = { content: FeedbackDraft; baseVersion?: number; reason?: string; linkMode?: string; mode?: Mode; pending?: Pending; unknown?: boolean };
function readItemDraft(): SavedItem | undefined {
  if (!itemDraftKey.value) return;
  try {
    const value = readDraft<SavedItem>(itemDraftKey.value);
    return value?.content?.source_range && Array.isArray(value.content.evidence) ? value : undefined;
  } catch (issue) {
    storageError.value = String(issue);
  }
}
function inferMode(value: FeedbackDraft, base: FeedbackDraft): Mode {
  if (value.new_task) return "task";
  if (!sameEvidence(value.evidence, base.evidence)) return "evidence";
  return "interpretation";
}
function restoreItem() {
  const value = readItemDraft();
  if (!value || !saved.value) return;
  const changed = JSON.stringify(value.content) !== JSON.stringify(saved.value);
  if (!changed && !value.pending) return;
  restoring = true;
  draft.value = value.content;
  reason.value = value.reason ?? "";
  pending.value = value.pending;
  unknown.value = !!value.unknown;
  mustReload.value = value.baseVersion !== selected.value?.version;
  mode.value = value.mode && value.mode !== "create" ? value.mode : value.pending ? "none" : inferMode(value.content, saved.value);
  restoring = false;
}
function restoreCreate(source?: SourceRange) {
  const previous = mode.value;
  mode.value = "create";
  const value = readItemDraft();
  if (!value) {
    mode.value = previous;
    return false;
  }
  restoring = true;
  draft.value = value.content;
  if (source && (source.from !== value.content.source_range.from || source.to !== value.content.source_range.to)) {
    draft.value.source_range = copy(source);
    draft.value.source_checked = false;
  }
  linkMode.value = value.linkMode ?? "none";
  pending.value = value.pending;
  unknown.value = !!value.unknown;
  restoring = false;
  return true;
}

async function openEntry() {
  if (busy.value || unknown.value) return;
  if (originalOpen.value) return;
  restoring = true;
  original.value = "";
  try {
    const value = readDraft<{ text: string; pending?: Pending; unknown?: boolean }>(originalKey.value);
    if (typeof value?.text === "string") original.value = value.text;
    pending.value = value?.pending;
    unknown.value = !!value?.unknown;
  } catch (issue) {
    storageError.value = String(issue);
  }
  restoring = false;
  entryError.value = "";
  originalOpen.value = true;
}
async function closeEntry() {
  if (busy.value || unknown.value) return;
  persist();
  originalOpen.value = false;
  entryError.value = "";
  await nextTick();
  entryTrigger.value?.querySelector("button")?.focus();
}

function startCreate(whole = false) {
  if (!batch.value || busy.value || unknown.value) return;
  const source = whole ? exactTextRange(batch.value.original_text, 0, batch.value.original_text.length) : range.value;
  if (!source) {
    error.value = "请先在原文中选择一段文字，再建立解释。";
    return;
  }
  persist();
  error.value = "";
  mustReload.value = false;
  if (!restoreCreate(source)) {
    draft.value = blankDraft(copy(source));
    linkMode.value = "none";
    pending.value = undefined;
    mode.value = "create";
  }
  range.value = undefined;
}
function beginMode(next: Exclude<Mode, "none" | "create">) {
  if (!canAct.value) return;
  error.value = "";
  if (next === "task") {
    draft.value.task_id = null;
    draft.value.new_task = emptyTask();
  }
  mode.value = next;
}
function discardDraft() {
  if (!itemDraftKey.value) return;
  try {
    localStorage.removeItem(itemDraftKey.value);
  } catch {
    /* Nothing to discard when storage is unavailable. */
  }
}
function cancelEdit() {
  if (busy.value || unknown.value) return;
  discardDraft();
  restoring = true;
  mode.value = "none";
  pending.value = undefined;
  mustReload.value = false;
  error.value = "";
  draft.value = saved.value ? copy(saved.value) : blankDraft();
  restoring = false;
}
function onFormKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.defaultPrevented) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancelEdit();
  } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void saveItem();
  }
}
function changeLink(next: string) {
  if (next !== "existing") draft.value.task_id = null;
  draft.value.new_task = next === "new" ? (draft.value.new_task ?? emptyTask()) : null;
}

async function execute() {
  const command = pending.value;
  if (!command || busy.value) return;
  const projectId = props.project.id;
  const oldKey = command.kind === "batch" ? originalKey.value : itemDraftKey.value;
  const controller = new AbortController();
  mutationRequest = controller;
  busy.value = true;
  error.value = "";
  unknown.value = true;
  persist();
  try {
    let result: Item | undefined;
    let createdBatch: Batch | undefined;
    const feedback = props.services.feedback;
    if (command.kind === "batch") createdBatch = await feedback.create(projectId, command.input as Parameters<typeof feedback.create>[1], controller.signal);
    if (command.kind === "itemCreate")
      result = await feedback.createItem(projectId, command.batchId!, command.input as Parameters<typeof feedback.createItem>[2], controller.signal);
    if (command.kind === "itemUpdate")
      result = await feedback.updateItem(projectId, command.id!, command.input as Parameters<typeof feedback.updateItem>[2], controller.signal);
    if (command.kind === "decide")
      result = await feedback.decide(projectId, command.id!, command.input as Parameters<typeof feedback.decide>[2], controller.signal);
    if (controller.signal.aborted) return;
    restoring = true;
    pending.value = undefined;
    unknown.value = false;
    mustReload.value = false;
    mode.value = "none";
    if (createdBatch) {
      originalOpen.value = false;
      original.value = "";
    }
    try {
      if (oldKey) localStorage.removeItem(oldKey);
    } catch {
      /* The confirmed service receipt is authoritative. */
    }
    restoring = false;
    if (command.kind === "decide" && result?.status === "processed") stampedId.value = result.id;
    // 先显示服务端回执的新版本，避免重读期间仍显示旧版本，让随后的展开被新版本替换收起。
    if (result && selected.value?.id === result.id) {
      selected.value = result;
      draft.value = normalizeFeedback(result.content);
      history.value = undefined;
    }
    const target = createdBatch ? batchKey(createdBatch.id) : result ? itemKey(result.id) : selectedKey.value;
    await load();
    if (controller.signal.aborted) return;
    if (!visible.value.some((value) => value.key === target)) filter.value = "all";
    await select(target, true);
    notice.value = createdBatch
      ? "反馈原文已保存。在原文中选择一段文字，建立你的解释。"
      : command.kind === "decide"
        ? result?.status === "processed"
          ? "已记录你的处理声明；这不代表导师已认可。"
          : "已撤销处理声明，证据与历史保留。"
        : `已保存解释 v${result?.version}。`;
  } catch (issue) {
    restoring = false;
    if (controller.signal.aborted) return;
    const problem = asApiError(issue);
    unknown.value = problem.status === undefined || problem.status >= 500 || problem.code === "INVALID_RESPONSE";
    mustReload.value = problem.status === 409 && problem.code !== "FEEDBACK_REVIEW_REQUIRED";
    error.value = unknown.value
      ? "操作结果尚未确认，原输入及命令已保留。请确认原请求结果后继续。"
      : `${problem.message}（${problem.code}）你的输入仍保留在本页，可调整后重试。`;
    if (!unknown.value) {
      pending.value = undefined;
      if (mode.value === "none" && saved.value && !mustReload.value) draft.value = copy(saved.value);
    }
    persist();
  } finally {
    restoring = false;
    if (!controller.signal.aborted) busy.value = false;
  }
}

async function saveOriginal() {
  if (busy.value || unknown.value) return;
  if (!original.value.trim()) {
    entryError.value = "请先粘贴导师反馈，不能只包含空格或换行。";
    return;
  }
  if (original.value.length > maxFeedbackLength) {
    entryError.value = "一次最多录入 10,000 个字符。内容已完整保留在输入框，请缩短后保存。";
    return;
  }
  entryError.value = "";
  pending.value = { kind: "batch", input: { command_id: crypto.randomUUID(), expected_version: 0, original_text: original.value } };
  await execute();
}
async function saveItem() {
  if (!batch.value || busy.value || unknown.value || mustReload.value) return;
  const creating = mode.value === "create";
  if (!creating && !selected.value) return;
  if (!draft.value.source_range.text || !draft.value.interpretation.trim()) {
    error.value = "请保留精确原文选区并填写人工解释。";
    return;
  }
  if (draft.value.new_task) {
    const issue = taskDraftError(draft.value.new_task);
    if (issue) {
      error.value = issue;
      return;
    }
  }
  if (creating && linkMode.value === "existing" && !draft.value.task_id) {
    error.value = "请选择要关联的任务。";
    return;
  }
  pending.value = creating
    ? { kind: "itemCreate", batchId: batch.value.id, input: { command_id: crypto.randomUUID(), expected_version: 0, content: copy(draft.value) } }
    : {
        kind: "itemUpdate",
        id: selected.value!.id,
        input: { command_id: crypto.randomUUID(), expected_version: selected.value!.version, content: copy(draft.value) },
      };
  await execute();
}
async function applyChange(change: (value: FeedbackDraft) => void) {
  if (!canAct.value) return;
  const next = copy(draft.value);
  change(next);
  draft.value = next;
  await saveItem();
}
const linkTask = () => applyChange((value) => ((value.task_id = taskChoice.value || null), (value.new_task = null)));
const unlinkTask = () => applyChange((value) => (value.task_id = null));
const removeEvidence = (index: number) => applyChange((value) => value.evidence.splice(index, 1));
const restoreEvidence = (entry: HistoryEntry) => applyChange((value) => (value.evidence = copy(entry.snapshot.content.evidence ?? [])));
const canRestore = (entry: HistoryEntry) => {
  const evidence = entry.snapshot.content.evidence;
  if (!evidence?.length || sameEvidence(evidence, selected.value?.content.evidence)) return false;
  const newer = history.value?.items.filter((value) => value.version > entry.version) ?? [];
  return !newer.some((value) => sameEvidence(value.snapshot.content.evidence, evidence));
};

async function rebaseEvidence() {
  if (!canAct.value || !selected.value) return;
  const projectId = props.project.id;
  const itemId = selected.value.id;
  rebasing.value = true;
  error.value = "";
  try {
    const current = await props.services.documents.current(projectId);
    const next = copy(draft.value.evidence);
    for (const [index, snapshot] of snapshots.value.entries()) {
      const reference = next[index];
      if (!snapshot.stale || reference?.kind !== "document") continue;
      const old =
        reference.document_id === current.id ? await props.services.documents.version(projectId, reference.document_id, reference.version) : undefined;
      const selection = old && rebaseSelection(old.content.json, current.content.json, reference.selection);
      if (!selection) {
        error.value = `证据 ${index + 1} 所在段落在正文 v${current.version} 中已改动，无法逐字对应。原证据保留，请通过“选择具体片段或资料”重新选择。`;
        return;
      }
      next[index] = { ...reference, version: current.version, selection } satisfies DocumentEvidence;
    }
    if (props.project.id !== projectId || selected.value?.id !== itemId) return;
    const unique = next.filter((value, index) => next.findIndex((other) => JSON.stringify(other) === JSON.stringify(value)) === index);
    await applyChange((value) => (value.evidence = unique));
  } catch (issue) {
    error.value = `当前正文读取失败：${asApiError(issue).message}。证据未改动，可稍后重试。`;
  } finally {
    rebasing.value = false;
  }
}

async function decide(action: "processed" | "reopen") {
  if (!selected.value || !canAct.value) return;
  pending.value = {
    kind: "decide",
    id: selected.value.id,
    input: { command_id: crypto.randomUUID(), expected_version: selected.value.version, action, reason: reason.value },
  };
  await execute();
}
/** 采纳/撤销拆解建议会增减正式解释项：重读索引，并定位到新采纳的第一条。 */
async function onSplitChanged(itemIds: string[]) {
  splitHighlight.value = undefined;
  await load();
  if (itemIds[0] && entries.value.some((value) => value.key === itemKey(itemIds[0]!))) {
    if (!visible.value.some((value) => value.key === itemKey(itemIds[0]!))) filter.value = "all";
    await select(itemKey(itemIds[0]), true);
  }
}
function openSplitItem(itemId: string) {
  const key = itemKey(itemId);
  if (!entries.value.some((value) => value.key === key)) return;
  if (!visible.value.some((value) => value.key === key)) filter.value = "all";
  void select(key);
}
async function reloadBase() {
  if (!selected.value) {
    await load();
    mustReload.value = false;
    return;
  }
  try {
    selected.value = await props.services.feedback.item(props.project.id, selected.value.id);
    mustReload.value = false;
    pending.value = undefined;
    error.value = "";
    if (mode.value === "none") draft.value = normalizeFeedback(selected.value.content);
    notice.value = "已读取新版，当前输入草稿保留，请核对后保存。";
  } catch (issue) {
    error.value = asApiError(issue).message;
  }
}
async function loadHistory(event: Event) {
  if (!(event.target as HTMLDetailsElement).open || !selected.value || historyLoading.value) return;
  const projectId = props.project.id;
  const id = selected.value.id;
  historyLoading.value = true;
  try {
    const result = await props.services.feedback.versions(projectId, id, { offset: 0, limit: 100 });
    if (props.project.id === projectId && selected.value?.id === id) history.value = result;
  } catch (issue) {
    error.value = `处理历史读取失败：${asApiError(issue).message}。`;
  } finally {
    historyLoading.value = false;
  }
}

/**
 * 证据复核状态随正文版本由服务端计算，不改变解释版本：同版本直接替换详情；已有新版时，
 * 未在编辑才载入新版，编辑中保留原基础版本，保存时由版本校验提示冲突。
 */
async function refreshSelected() {
  const current = selected.value;
  if (!current) return;
  const projectId = props.project.id;
  try {
    const latest = await props.services.feedback.item(projectId, current.id);
    if (props.project.id !== projectId || selected.value !== current || busy.value || latest.version < current.version) return;
    if (latest.version === current.version) selected.value = latest;
    else if (mode.value === "none" && !dirty.value && !pending.value && !unknown.value) {
      selected.value = latest;
      draft.value = normalizeFeedback(latest.content);
      history.value = undefined;
    }
  } catch {
    /* 静默重读失败时保留当前显示的详情，可重新选择或手动重新读取。 */
  }
}
/** 外壳缓存本页；返回时静默重读反馈、任务选项与当前详情，正在编辑的表单、草稿和待确认命令保持不动。 */
let activated = false;
onActivated(async () => {
  if (!activated) {
    activated = true;
    return;
  }
  if (busy.value || unknown.value || rebasing.value) return;
  await load(true);
  await refreshSelected();
});

watch([draft, original, reason, linkMode, pending, unknown, mode], persist, { deep: true });
const linkId = (value: unknown) => (typeof value === "string" && value ? value.toLowerCase() : undefined);
async function applyLink() {
  const query = linkQuery.value;
  if (!query || !loaded.value || busy.value || unknown.value) return;
  linkQuery.value = undefined;
  const key = resolveFeedbackLink(entries.value, query);
  if (!key) return;
  if (!filterInbox(entries.value, filter.value).some((value) => value.key === key)) filter.value = "all";
  if (key !== selectedKey.value) {
    persist();
    void select(key, true);
  }
  await nextTick();
  document.querySelector(`[data-feedback-entry="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" });
}
watch(
  () => [route.query.batch, route.query.item],
  ([batchId, itemId]) => {
    const query = { batch: linkId(batchId), item: linkId(itemId) };
    linkQuery.value = query.batch || query.item ? query : undefined;
    void applyLink();
  },
  { immediate: true },
);
watch(visible, (list) => {
  if (busy.value) return;
  if (linkQuery.value && loaded.value) {
    void applyLink();
    return;
  }
  if (list.some((value) => value.key === selectedKey.value)) return;
  // 重读后当前条目只是不再符合筛选时，正在编辑的表单留在原处。
  if (mode.value !== "none" && entries.value.some((value) => value.key === selectedKey.value)) return;
  void select(list[0]?.key ?? "", true);
});
watch(
  () => props.project.id,
  () => {
    listRequest?.abort();
    detailRequest?.abort();
    mutationRequest?.abort();
    originals.clear();
    batches.value = [];
    itemsByBatch.value = new Map();
    failedBatches.value = new Set();
    batch.value = undefined;
    selected.value = undefined;
    selectedKey.value = "";
    originalOpen.value = false;
    mode.value = "none";
    pending.value = undefined;
    unknown.value = false;
    loaded.value = false;
    void load();
  },
  { immediate: true },
);
onScopeDispose(() => {
  persist();
  listRequest?.abort();
  detailRequest?.abort();
  mutationRequest?.abort();
});
</script>

<template>
  <section class="screen-page workspace-page feedback-page" aria-label="正式导师反馈">
    <header class="screen-heading">
      <div>
        <p class="tp-label feedback-eyebrow">FEEDBACK / 每条意见，都有回音</p>
        <h1 class="tp-display">导师反馈</h1>
        <p class="screen-lead">原话留在这里，修改落到具体处。</p>
      </div>
      <div class="feedback-heading-actions">
        <div class="feedback-counts" aria-label="反馈处理概览">
          <div><b class="tp-num">{{ counts.pending }}</b><span>待处理</span></div>
          <div><b class="tp-num">{{ counts.unclear }}</b><span>待明确</span></div>
          <div><b class="tp-num">{{ counts.handled }}</b><span>已处理</span></div>
        </div>
        <div ref="entryTrigger">
          <TpButton variant="primary" :aria-expanded="originalOpen" aria-controls="feedback-entry" :disabled="busy || unknown" @click="openEntry"
            >录入反馈</TpButton
          >
        </div>
      </div>
    </header>

    <Transition name="tp-swap" v-bind="panelMotionHooks"
      ><FeedbackEntryForm
        v-if="originalOpen"
        v-model="original"
        :busy="busy"
        :disabled="unknown"
        :error="entryError"
        @input="entryError = ''"
        @save="saveOriginal"
        @cancel="closeEntry"
    /></Transition>

    <Transition name="tp-swap"
      ><p v-if="listError || error || storageError" :key="listError + error + storageError" role="alert" class="studio-notice feedback-alert">
        <span>{{ [listError, error, storageError].filter(Boolean).join(" ") }}</span
        ><TpButton v-if="listError" size="sm" variant="ghost" :disabled="loading" @click="load()">重新读取反馈</TpButton
        ><TpButton v-if="unknown" size="sm" :loading="busy" @click="execute">确认原请求结果</TpButton
        ><TpButton v-if="mustReload" size="sm" @click="reloadBase">载入最新版本并保留输入</TpButton>
      </p></Transition
    >

    <div class="feedback-toolbar">
      <TpSegmented
        v-model="filter"
        label="筛选导师反馈"
        :options="[
          { value: 'all', label: '全部意见' },
          { value: 'pending', label: '待处理' },
          { value: 'handled', label: '已处理' },
        ]"
      />
      <p class="tp-caption">
        <TpIcon :icon="PhPaperclip" :size="14" />{{ batches.length }} 次反馈 · 原文与历史版本一并保留<TpButton
          size="sm"
          variant="ghost"
          :loading="loading"
          :disabled="busy"
          @click="load()"
          >刷新</TpButton
        >
      </p>
    </div>

    <div class="feedback-layout">
      <aside class="feedback-inbox" aria-label="导师意见列表">
        <div class="feedback-inbox__head"><span class="tp-label">意见索引</span><span class="tp-mono">{{ visible.length }} 条</span></div>
        <div v-if="!loaded && loading" class="feedback-skeleton" aria-hidden="true"><span v-for="index in 3" :key="index" /></div>
        <TransitionGroup name="tp-list" tag="div" class="tp-list-group feedback-inbox-list" v-bind="listMotionHooks">
          <button
            v-for="value in visible"
            :key="value.key"
            type="button"
            class="feedback-item"
            :data-feedback-entry="value.key"
            :class="{ 'is-selected': selectedKey === value.key }"
            :aria-pressed="selectedKey === value.key"
            :aria-label="`查看反馈 ${value.number} ${value.title}`"
            :disabled="busy || unknown"
            @click="select(value.key)"
          >
            <span class="feedback-item__meta"
              ><span class="tp-mono">{{ value.number }}</span><span>{{ value.kind === "batch" ? "文字录入" : value.date }}</span></span
            >
            <strong>{{ value.title }}</strong>
            <span class="tp-caption">{{ value.summary }}</span>
            <span class="feedback-item__state"
              ><TpIcon :icon="value.handled ? PhCheck : value.state === 'unclear' ? PhQuestion : PhFileText" :size="13" />{{ value.stateLabel }}</span
            >
          </button>
        </TransitionGroup>
        <p v-if="loaded && entries.length && !visible.length" class="feedback-empty tp-caption">当前筛选下暂无意见。</p>
        <div v-if="batch" class="feedback-inbox__note">
          <span class="feedback-monogram">文</span>
          <div>
            <b>文字录入</b>
            <p class="tp-caption">导师姓名与反馈时间未记录</p>
          </div>
        </div>
      </aside>

      <Transition name="tp-swap" mode="out-in">
        <article v-if="entry && batch && batch.id === entry.batchId" :key="entry.key" class="screen-panel feedback-reading" aria-label="反馈阅读区">
          <header class="feedback-reading__head">
            <div class="feedback-reading__label">
              <TpIcon :icon="PhQuotes" :size="18" /><span class="tp-label">导师原话</span><TpStatus tone="ghost" label="论文版本未指定" size="sm" />
            </div>
            <span class="tp-mono">录入时间 {{ formatTime(batch.created_at) }}</span>
          </header>
          <FeedbackOriginal :text="batch.original_text" :highlight="highlight" :disabled="busy || unknown" @select="range = $event" />
          <div class="feedback-original__foot"><span>粘贴文字 · {{ entry.number }}</span><span>原文完整保留</span></div>
          <div class="feedback-range">
            <Transition name="tp-swap" mode="out-in">
              <div v-if="range" key="range" class="screen-actions">
                <span class="tp-caption">已选原文 UTF-16 {{ range.from }}–{{ range.to }} · {{ Array.from(range.text).length }} 字</span>
                <TpButton v-if="mode !== 'interpretation'" size="sm" variant="primary" :disabled="busy || unknown" @click="startCreate()"
                  >为选区建立解释</TpButton
                ><TpButton size="sm" variant="ghost" @click="range = undefined">取消选区</TpButton>
              </div>
              <div v-else key="hint" class="screen-actions">
                <span class="tp-caption">在原文中拖选一段文字，为它建立解释。</span>
                <TpButton
                  size="sm"
                  variant="ghost"
                  :disabled="busy || unknown"
                  @click="range = exactTextRange(batch.original_text, 0, batch.original_text.length)"
                  >选择整份原文</TpButton
                >
              </div>
            </Transition>
          </div>
          <FeedbackSplitPanel
            :key="batch.id"
            :services="services"
            :project="project"
            :batch-id="batch.id"
            :tasks="tasks"
            :disabled="busy || unknown"
            @changed="onSplitChanged"
            @highlight="splitHighlight = $event"
            @open-item="openSplitItem"
          />

          <Transition name="tp-swap" mode="out-in">
            <form
              v-if="mode === 'create'"
              key="create"
              class="feedback-create studio-stack"
              aria-label="新增人工解释"
              @submit.prevent="saveItem"
              @keydown="onFormKeydown"
            >
              <div class="feedback-section-label"><TpIcon :icon="PhArrowBendDownRight" :size="16" /><span class="tp-label">新增人工解释</span></div>
              <FeedbackInterpretationFields v-model="draft" :disabled="busy || unknown" />
              <TpField v-slot="{ id }" label="任务关联方式"
                ><TpSelect
                  :id="id"
                  v-model="linkMode"
                  :disabled="busy || unknown"
                  :options="[
                    { value: 'none', label: '暂不关联任务' },
                    { value: 'existing', label: '关联已有任务' },
                    { value: 'new', label: '同时创建新任务' },
                  ]"
                  @update:model-value="changeLink"
              /></TpField>
              <TpField v-if="linkMode === 'existing'" v-slot="{ id }" label="关联已有任务"
                ><TpSelect
                  :id="id"
                  :model-value="draft.task_id ?? ''"
                  :disabled="busy || unknown"
                  :options="createTaskOptions"
                  @update:model-value="draft.task_id = $event || null"
              /></TpField>
              <Transition name="tp-swap" v-bind="panelMotionHooks"
                ><section v-if="linkMode === 'new' && draft.new_task" class="studio-stack" aria-label="反馈关联新任务">
                  <h3 class="tp-subheading">同时创建的任务</h3>
                  <TaskContentForm v-model="draft.new_task" :services="services" :project-id="project.id" :tasks="tasks" :disabled="busy || unknown" /></section
              ></Transition>
              <EvidencePicker v-model="draft.evidence" :services="services" :project-id="project.id" :disabled="busy || unknown" />
              <footer class="feedback-form-footer">
                <p class="tp-caption">Ctrl / ⌘ + Enter 保存 · Esc 取消</p>
                <div>
                  <TpButton variant="ghost" :disabled="busy || unknown" @click="cancelEdit">取消</TpButton
                  ><TpButton type="submit" variant="primary" :loading="busy" :disabled="unknown || mustReload">保存解释</TpButton>
                </div>
              </footer>
            </form>

            <section v-else-if="entry.state === 'failed'" key="failed" class="feedback-recorded tp-ghost" role="alert">
              <TpStatus tone="danger" label="解释项读取失败" size="sm" />
              <p>这次反馈的解释项没有读取成功。原文与已保存的解释不受影响。</p>
              <TpButton :loading="loading" @click="load()">重新读取反馈</TpButton>
            </section>

            <section v-else-if="!selected" key="recorded" class="feedback-recorded tp-ghost" aria-label="文字录入状态">
              <TpStatus tone="neutral" label="原文已录入" size="sm" />
              <h2 class="tp-heading">尚未整理</h2>
              <p>在上方原文中选择一段文字，建立你的解释；也可以把整份原文作为一条来整理。</p>
              <p class="tp-caption">导师姓名、反馈时间与针对的论文版本均未记录。</p>
              <div class="screen-actions"><TpButton variant="primary" :disabled="busy || unknown" @click="startCreate(true)">手动整理</TpButton></div>
            </section>

            <div v-else :key="`item-${selected.id}`" class="feedback-detail">
              <section class="feedback-interpretation" :class="cardTone" aria-label="当前意见解释">
                <div class="feedback-section-label">
                  <TpIcon :icon="unclear ? PhQuestion : PhArrowBendDownRight" :size="16" /><span class="tp-label">{{
                    unclear ? "这一处，还需要你判断" : "你的理解"
                  }}</span
                  ><TpVersion :v="selected.version" /><TpSeal v-if="selected.status === 'processed'" text="已处理" :animate="false" />
                </div>
                <Transition name="tp-swap" mode="out-in">
                  <form
                    v-if="mode === 'interpretation'"
                    key="edit"
                    class="feedback-edit"
                    aria-label="编辑理解"
                    @submit.prevent="saveItem"
                    @keydown="onFormKeydown"
                  >
                    <FeedbackInterpretationFields v-model="draft" :range="range" :disabled="busy || unknown" />
                    <footer class="feedback-form-footer">
                      <p class="tp-caption">Ctrl / ⌘ + Enter 保存 · Esc 取消</p>
                      <div>
                        <TpButton variant="ghost" :disabled="busy || unknown" @click="cancelEdit">取消</TpButton
                        ><TpButton type="submit" variant="primary" :loading="busy" :disabled="unknown || mustReload">保存理解</TpButton>
                      </div>
                    </footer>
                  </form>
                  <div v-else key="view">
                    <h2 class="tp-heading">{{ title }}</h2>
                    <blockquote class="feedback-segment">
                      <span class="tp-caption"
                        >对应原文 UTF-16 {{ selected.content.source_range.from }}–{{ selected.content.source_range.to }} · 原文范围保持不变</span
                      >
                      <p>{{ selected.content.source_range.text }}</p>
                    </blockquote>
                    <p v-if="selected.content.interpretation.trim() !== title.replace(/…$/, '')" class="feedback-suggestion">
                      {{ selected.content.interpretation }}
                    </p>
                    <p v-if="selected.content.correction?.trim()" class="feedback-suggestion"><b>澄清：</b>{{ selected.content.correction }}</p>
                    <p class="tp-caption feedback-checked">{{ selected.content.source_checked ? "你已核对解释与原文范围" : "尚未核对解释与原文范围" }}</p>
                    <p v-if="selected.needs_review" class="feedback-stale tp-ghost" role="status">需复核：{{ reasons.join("；") }}</p>
                    <TpButton class="feedback-edit-trigger" variant="outline" size="sm" :disabled="!canAct" @click="beginMode('interpretation')"
                      >编辑理解</TpButton
                    >
                  </div>
                </Transition>
              </section>

              <section class="feedback-task-link" aria-label="关联计划任务">
                <div>
                  <p class="tp-label">让修改有下一步</p>
                  <h3 class="tp-subheading">关联计划任务</h3>
                </div>
                <div v-if="selected.content.task_id" class="screen-actions">
                  <RouterLink class="feedback-link" :to="tasksRoute(project.id, selected.content.task_id!)"
                    >{{ linkedTask?.title ?? "已关联任务" }} · 打开任务 ↗</RouterLink
                  ><TpStatus v-if="linkedTask?.archived" tone="warning" label="已归档" size="sm" /><TpButton
                    variant="ghost"
                    size="sm"
                    :disabled="!canAct"
                    @click="unlinkTask"
                    >解除任务关联</TpButton
                  >
                </div>
                <p v-else class="tp-caption">关联不会改变任务状态。你可以选已有任务，也可以新建任务。</p>
                <Transition name="tp-swap" mode="out-in">
                  <form
                    v-if="mode === 'task' && draft.new_task"
                    key="task"
                    class="feedback-edit"
                    aria-label="新建关联任务"
                    @submit.prevent="saveItem"
                    @keydown="onFormKeydown"
                  >
                    <TaskContentForm v-model="draft.new_task" :services="services" :project-id="project.id" :tasks="tasks" :disabled="busy || unknown" />
                    <footer class="feedback-form-footer">
                      <p class="tp-caption">Ctrl / ⌘ + Enter 保存 · Esc 取消</p>
                      <div>
                        <TpButton variant="ghost" :disabled="busy || unknown" @click="cancelEdit">取消</TpButton
                        ><TpButton type="submit" variant="primary" :loading="busy" :disabled="unknown || mustReload">创建并关联任务</TpButton>
                      </div>
                    </footer>
                  </form>
                  <div v-else key="link" class="feedback-link-actions">
                    <label class="feedback-task-select"
                      ><span class="tp-caption">已有任务</span
                      ><TpSelect v-model="taskChoice" aria-label="选择已有任务" :disabled="!canAct" :options="taskOptions"
                    /></label>
                    <TpButton :disabled="!taskChoice || !canAct" @click="linkTask">关联已有任务</TpButton
                    ><TpButton variant="ghost" :disabled="!canAct" @click="beginMode('task')">新建关联任务</TpButton>
                  </div>
                </Transition>
              </section>

              <section class="feedback-evidence" aria-label="关联修改证据">
                <header>
                  <div>
                    <p class="tp-label">从意见到修改</p>
                    <h3 class="tp-subheading">关联的修改证据</h3>
                  </div>
                  <TpStatus :tone="snapshots.length ? 'neutral' : 'ghost'" :label="snapshots.length ? `${snapshots.length} 份证据` : '尚缺证据'" size="sm" />
                </header>
                <TransitionGroup name="tp-list" tag="div" class="feedback-evidence__chips tp-list-group" v-bind="listMotionHooks">
                  <div v-for="(snapshot, index) in snapshots" :key="JSON.stringify(snapshot.reference)" class="screen-actions">
                    <EvidenceChip :evidence="evidenceView(snapshot, index)" /><TpButton
                      size="sm"
                      variant="ghost"
                      :label="`解除证据 ${index + 1}`"
                      :disabled="!canAct"
                      @click="removeEvidence(index)"
                      >解除</TpButton
                    >
                  </div>
                </TransitionGroup>
                <p v-if="snapshots.some((value) => value.stale)" class="feedback-stale tp-ghost" role="status">
                  正文或资料已更新，当前证据基于旧版本。旧记录已保留，请核对实际修改后更新证据。
                </p>
                <p class="tp-caption">
                  {{ snapshots.length ? "核对修改内容与这条意见是否一致，再记录你的处理结果。" : "还没有关联修改证据。选择正文片段或资料锚点作为依据。" }}
                </p>
                <TpButton
                  v-if="snapshots.length"
                  class="feedback-excerpt-toggle"
                  variant="ghost"
                  size="sm"
                  :aria-expanded="excerptOpen"
                  @click="excerptOpen = !excerptOpen"
                  ><TpIcon :icon="PhFileText" :size="14" />{{ excerptOpen ? "收起修改摘录" : "查看修改摘录" }}</TpButton
                >
                <Transition name="tp-swap">
                  <blockquote v-if="excerptOpen && snapshots.length" class="feedback-excerpt">
                    <span class="tp-label">已关联版本 · 修改摘录</span>
                    <p>{{ evidenceExcerpt(snapshots) }}</p>
                  </blockquote>
                </Transition>
                <Transition name="tp-swap" mode="out-in">
                  <form
                    v-if="mode === 'evidence'"
                    key="pick"
                    class="feedback-edit"
                    aria-label="选择修改证据"
                    @submit.prevent="saveItem"
                    @keydown="onFormKeydown"
                  >
                    <EvidencePicker v-model="draft.evidence" :services="services" :project-id="project.id" :disabled="busy || unknown" />
                    <footer class="feedback-form-footer">
                      <p class="tp-caption">Ctrl / ⌘ + Enter 保存 · Esc 取消</p>
                      <div>
                        <TpButton variant="ghost" :disabled="busy || unknown" @click="cancelEdit">取消</TpButton
                        ><TpButton type="submit" variant="primary" :loading="busy" :disabled="unknown || mustReload">保存证据关联</TpButton>
                      </div>
                    </footer>
                  </form>
                  <div v-else key="actions" class="screen-actions feedback-source-actions">
                    <TpButton v-if="hasStaleDocument" size="sm" :loading="rebasing" :disabled="!canAct" @click="rebaseEvidence">更新为当前正文证据</TpButton
                    ><TpButton size="sm" :variant="hasStaleDocument ? 'ghost' : 'outline'" :disabled="!canAct" @click="beginMode('evidence')"
                      >选择具体片段或资料</TpButton
                    ><RouterLink class="feedback-link" :to="writingRoute(project.id)">查看当前正文 ↗</RouterLink>
                  </div>
                </Transition>
              </section>

              <footer class="feedback-decision">
                <Transition name="tp-swap" mode="out-in">
                  <div v-if="selected.status === 'processed'" key="processed" class="feedback-decision__state">
                    <TpSeal text="你已标记处理" :animate="stampedId === selected.id" />
                    <p class="tp-caption">这是你的处理声明，不代表导师已认可。</p>
                  </div>
                  <div v-else key="open" class="feedback-decision__state">
                    <p class="tp-caption">{{ decisionHint }}</p>
                  </div>
                </Transition>
                <div class="feedback-decision__actions">
                  <TpField v-slot="{ id }" label="处理说明" optional>
                    <input :id="id" v-model="reason" class="tp-input" maxlength="2000" :disabled="busy || unknown" />
                  </TpField>
                  <TpButton v-if="selected.status === 'processed'" variant="ghost" :disabled="!canAct" @click="decide('reopen')"
                    ><TpIcon :icon="PhArrowCounterClockwise" />撤销处理声明</TpButton
                  ><TpButton v-else variant="seal" :disabled="!canAct || selected.needs_review" @click="decide('processed')"
                    ><TpIcon :icon="PhCheck" />标记已处理</TpButton
                  >
                </div>
              </footer>

              <details :key="selected.version" class="feedback-history" @toggle="loadHistory">
                <summary>处理历史 <span class="tp-mono">{{ selected.version }}</span></summary>
                <p v-if="historyLoading" role="status" class="tp-caption">正在读取处理历史…</p>
                <TransitionGroup v-if="history" class="tp-list-group" name="tp-list" tag="ol" v-bind="listMotionHooks" aria-label="反馈历史">
                  <li v-for="value in history.items" :key="value.version">
                    <div>
                      <b>v{{ value.version }} · {{ historyActions[value.action] ?? value.action }}</b
                      ><span class="tp-caption">{{ formatTime(value.created_at) }}</span>
                    </div>
                    <p>{{ value.snapshot.content.interpretation }}</p>
                    <p v-if="value.reason">说明：{{ value.reason }}</p>
                    <div v-if="value.snapshot.evidence_snapshots.length" class="feedback-evidence__chips">
                      <EvidenceChip
                        v-for="(snapshot, index) in value.snapshot.evidence_snapshots"
                        :key="JSON.stringify(snapshot.reference)"
                        :evidence="evidenceView(snapshot, index)"
                      />
                    </div>
                    <TpButton v-if="canRestore(value)" size="sm" variant="ghost" :disabled="!canAct" @click="restoreEvidence(value)">恢复这次证据关联</TpButton>
                  </li>
                </TransitionGroup>
                <p v-if="history && history.total > history.items.length" class="tp-caption">显示最近 {{ history.items.length }} / {{ history.total }} 条。</p>
              </details>
            </div>
          </Transition>
        </article>

        <div v-else-if="detailLoading || (!loaded && loading)" key="loading" class="screen-panel feedback-reading feedback-loading" role="status">
          <span class="tp-caption">正在读取导师反馈…</span>
        </div>

        <div v-else-if="loaded && !entries.length && !listError" key="empty" class="screen-panel feedback-empty-state">
          <TpIcon :icon="PhQuotes" :size="32" />
          <h2 class="tp-heading">还没有导师反馈</h2>
          <p class="tp-caption">粘贴导师的文字反馈，原话会完整保留，之后再逐条整理与处理。</p>
          <TpButton variant="primary" :disabled="busy || unknown" @click="openEntry">录入第一条反馈</TpButton>
        </div>

        <div v-else-if="loaded && entries.length && !visible.length" key="filtered" class="screen-panel feedback-empty-state">
          <TpIcon :icon="PhQuotes" :size="32" />
          <h2 class="tp-heading">这里暂时没有意见</h2>
          <p class="tp-caption">切换到全部意见，查看保留的原文和处理记录。</p>
          <div class="screen-actions">
            <TpButton variant="outline" @click="filter = 'all'">查看全部意见</TpButton
            ><TpButton variant="primary" :disabled="busy || unknown" @click="openEntry">录入反馈</TpButton>
          </div>
        </div>
        <div v-else key="idle" class="screen-panel feedback-empty-state">
          <TpIcon :icon="PhQuotes" :size="32" />
          <p class="tp-caption">从左侧选择一条意见查看原话。</p>
        </div>
      </Transition>
    </div>
    <p class="feedback-notice tp-caption" role="status" aria-live="polite">{{ notice }}</p>
  </section>
</template>

<style scoped>
.feedback-page {
  max-width: 1280px;
}
.feedback-eyebrow {
  margin-bottom: 12px;
}
.feedback-heading-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 32px;
}
.feedback-counts {
  display: flex;
  gap: 32px;
  flex-shrink: 0;
}
.feedback-counts > div {
  display: grid;
  gap: 4px;
  min-width: 52px;
}
.feedback-counts b {
  font-size: 32px;
  line-height: 1.2;
}
.feedback-counts span {
  font-size: 12px;
  color: var(--tp-text-muted);
}
.feedback-alert {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.feedback-alert > span {
  flex: 1 1 280px;
}
.feedback-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--tp-line);
}
.feedback-toolbar > p {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.feedback-layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 32px;
  align-items: start;
}
.feedback-inbox {
  min-width: 0;
}
.feedback-inbox__head {
  display: flex;
  justify-content: space-between;
  padding: 0 12px 16px;
  color: var(--tp-text-muted);
}
.feedback-skeleton {
  display: grid;
  gap: 8px;
}
.feedback-skeleton span {
  height: 104px;
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
}
.feedback-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  padding: 20px 16px;
  text-align: left;
  border: 1px solid transparent;
  border-left: 3px solid transparent;
  border-radius: var(--tp-radius-s);
  transition: background-color var(--tp-dur-fast) var(--tp-ease-standard);
}
.feedback-item + .feedback-item {
  margin-top: 4px;
}
.feedback-item:hover:not(:disabled) {
  background: var(--tp-surface-sunken);
}
.feedback-item:disabled {
  cursor: default;
}
.feedback-item.is-selected {
  background: var(--tp-surface);
  border-color: var(--tp-outline);
  border-left-color: var(--tp-accent);
}
.feedback-item__meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--tp-text-muted);
}
.feedback-item strong {
  font-size: 15px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.feedback-item__state {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--tp-text-muted);
}
.feedback-inbox__note {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px 12px;
  margin-top: 16px;
  border-top: 1px solid var(--tp-line);
  font-size: 12px;
}
.feedback-monogram {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--tp-line-strong);
  border-radius: var(--tp-radius-s);
  font-family: var(--tp-font-prose);
  font-size: 18px;
}
.feedback-reading {
  min-width: 0;
  overflow: hidden;
  padding: 0;
}
.feedback-reading__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 24px 32px 0;
  color: var(--tp-text-muted);
}
.feedback-reading__label {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.feedback-original__foot {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 0 32px 12px;
  font-size: 11px;
  color: var(--tp-text-muted);
}
.feedback-range {
  margin: 0 32px 24px;
  min-height: 32px;
}
.feedback-interpretation {
  margin: 0 32px;
  padding: 20px 24px;
}
.feedback-create {
  margin: 0 32px 32px;
  padding: 20px 24px;
  border-top: 1px solid var(--tp-line);
}
.feedback-recorded {
  display: grid;
  justify-items: start;
  gap: 12px;
  margin: 0 32px 32px;
  padding: 24px;
}
.feedback-section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.feedback-section-label .tp-seal {
  margin-left: auto;
}
.feedback-section-label .tp-label {
  color: inherit;
}
.feedback-segment {
  margin: 16px 0;
  padding: 12px 16px;
  border-left: 2px solid var(--tp-line-strong);
  background: var(--tp-surface);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.feedback-segment p {
  margin-top: 8px;
  line-height: 1.7;
}
.feedback-suggestion {
  margin-top: 12px;
  line-height: 1.8;
  color: var(--tp-text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.feedback-checked {
  margin-top: 12px;
}
.feedback-edit {
  display: grid;
  gap: 16px;
  margin-top: 8px;
}
.feedback-edit :deep(.tp-input),
.feedback-create :deep(.tp-input) {
  width: 100%;
}
.feedback-edit :deep(textarea),
.feedback-create :deep(textarea) {
  min-height: 80px;
  height: auto;
  resize: vertical;
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
  gap: 8px;
  margin-left: auto;
}
.feedback-edit-trigger {
  margin-top: 16px;
}
.feedback-stale {
  padding: 16px;
  margin: 12px 0;
  font-size: 12px;
  line-height: 1.7;
}
.feedback-task-link {
  display: grid;
  gap: 16px;
  margin: 24px 32px 0;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--tp-line);
}
.feedback-task-link h3,
.feedback-evidence h3 {
  margin-top: 8px;
}
.feedback-link-actions {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 8px;
}
.feedback-task-select {
  display: grid;
  flex: 1 1 220px;
  min-width: 0;
  gap: 8px;
}
.feedback-task-select :deep(.tp-select) {
  width: 100%;
  min-width: 0;
}
.feedback-link {
  color: var(--tp-accent);
  font-size: 12px;
  text-decoration: underline;
  text-underline-offset: 4px;
  overflow-wrap: anywhere;
}
.feedback-evidence {
  padding: 24px 32px;
}
.feedback-evidence header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.feedback-evidence__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.feedback-excerpt-toggle {
  margin-top: 8px;
  margin-left: -8px;
}
.feedback-excerpt {
  margin-top: 12px;
  padding: 16px 20px;
  background: var(--tp-surface-sunken);
  border-left: 2px solid var(--tp-line-strong);
}
.feedback-excerpt p {
  margin-top: 8px;
  font-family: var(--tp-font-prose);
  line-height: 1.9;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.feedback-source-actions {
  margin-top: 16px;
  gap: 12px;
}
.feedback-decision {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 20px;
  padding: 20px 32px;
  border-top: 1px solid var(--tp-line);
}
.feedback-decision__state {
  display: grid;
  justify-items: start;
  gap: 8px;
  flex: 1 1 240px;
}
.feedback-decision__state .tp-caption {
  font-size: 11px;
}
.feedback-decision__actions {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 8px;
}
.feedback-decision__actions .tp-input {
  width: 220px;
}
.feedback-history {
  padding: 20px 32px;
  border-top: 1px solid var(--tp-line);
}
.feedback-history summary {
  cursor: pointer;
  font-size: 13px;
}
.feedback-history summary span {
  margin-left: 8px;
  color: var(--tp-text-muted);
}
.feedback-history ol {
  margin-top: 20px;
  display: grid;
  gap: 20px;
}
.feedback-history li > div:first-child {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: baseline;
}
.feedback-history p {
  font-size: 12px;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--tp-text-muted);
  margin-top: 8px;
}
.feedback-history .feedback-evidence__chips {
  margin-top: 8px;
}
.feedback-empty {
  padding: 24px 12px;
}
.feedback-empty-state,
.feedback-loading {
  display: grid;
  justify-items: center;
  gap: 20px;
  padding: 64px 32px;
  text-align: center;
}
.feedback-notice {
  min-height: 20px;
}
@media (max-width: 1150px) {
  .feedback-layout {
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 24px;
  }
  .feedback-reading__head {
    padding: 24px 24px 0;
  }
  .feedback-original__foot,
  .feedback-range {
    margin-right: 24px;
    margin-left: 24px;
  }
  .feedback-interpretation {
    margin: 0 24px;
    padding: 20px;
  }
  .feedback-create,
  .feedback-recorded {
    margin-right: 24px;
    margin-left: 24px;
  }
  .feedback-evidence,
  .feedback-decision,
  .feedback-history {
    padding: 24px;
  }
  .feedback-task-link {
    margin-right: 24px;
    margin-left: 24px;
  }
}
@media (max-width: 760px) {
  .feedback-heading-actions {
    width: 100%;
    gap: 24px;
    justify-content: space-between;
  }
  .feedback-counts {
    gap: 24px;
  }
  .feedback-toolbar {
    flex-direction: column;
    align-items: start;
  }
  .feedback-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .feedback-inbox-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .feedback-inbox__head {
    padding: 0 0 8px;
  }
  .feedback-inbox__note {
    display: none;
  }
  .feedback-item {
    padding: 16px 12px;
  }
  .feedback-item + .feedback-item {
    margin-top: 0;
  }
  .feedback-item strong {
    font-size: 14px;
  }
  .feedback-item .tp-caption {
    font-size: 11px;
  }
  .feedback-reading__head {
    padding: 20px 20px 0;
  }
  .feedback-original__foot,
  .feedback-range {
    margin: 0 20px 16px;
  }
  .feedback-interpretation {
    margin: 0 16px;
    padding: 16px;
  }
  .feedback-interpretation h2 {
    font-size: 18px;
  }
  .feedback-create,
  .feedback-recorded {
    margin: 0 16px 20px;
    padding: 16px;
  }
  .feedback-evidence,
  .feedback-decision,
  .feedback-history {
    padding: 20px;
  }
  .feedback-task-link {
    margin-right: 20px;
    margin-left: 20px;
  }
  .feedback-decision__actions,
  .feedback-decision__actions .tp-input {
    width: 100%;
  }
}
</style>
