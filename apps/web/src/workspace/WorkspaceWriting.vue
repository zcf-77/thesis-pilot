<script setup lang="ts">
import { PhArrowsClockwise, PhCaretDown, PhDownloadSimple, PhList, PhSidebarSimple, PhWarning, PhX } from "@phosphor-icons/vue";
import { useMediaQuery } from "@vueuse/core";
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, onScopeDispose, ref, shallowRef, triggerRef, watch } from "vue";
import { useRoute } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpDialog from "@/components/ui/TpDialog.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpMenu from "@/components/ui/TpMenu.vue";
import TpSaveIndicator from "@/components/ui/TpSaveIndicator.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import WritingDrawer from "@/lab/components/WritingDrawer.vue";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { ServiceJobsState } from "@/lab/state/serviceJobs";
import { ApiError, asApiError, type BackendServices, type ProjectRead } from "@/services";
import {
  DocsEditor,
  DocsEngineError,
  DocsSnapshotError,
  createDocsSnapshot,
  describeBlocked,
  loadDocsEngine,
  parseDocsSnapshot,
  protectionsFromRanges,
  toProtectedRanges,
  PROTECTION_DISPLAY,
  type BlockedEvent,
  type DocsModel,
  type DocsPreviewContext,
  type DocsProtection,
  type EditorSelection,
  type EditorViewState,
  type PreviewHighlight,
  type ProtectedRange,
} from "./editor";
import { createId } from "@muffin-office/vue/docs-editor/core";
import { insertPageBreak, insertTable, sourceTextOnly } from "./writing/commands";
import { provideWritingContext } from "./writing/context";
import { createDocsDocumentController, isBlankLegacy } from "./writing/docsDocument";
import { legacyDraftFile, readLegacyDrafts, type LegacyDraft } from "./writing/legacyDrafts";
import { pageInView } from "./writing/pageView";
import { HISTORY_PANEL_ID, availablePanels, type WritingAnchor, type WritingPanelDefinition, type WritingSelection } from "./writing/panels";
import { WRITING_PANELS } from "./writing/registry";
import { dehydrateResources, hydrateResources } from "./writing/resources";
import { chapterAt, countText, lockAt, readStructure, styleOptions, styleValue, type StyleValue, type WritingStructure } from "./writing/structure";
import { diffVersions } from "./writing/versionDiff";
import WritingCopilot from "./writing/WritingCopilot.vue";
import WritingHistoryPanel, { type HistoryPreview } from "./writing/WritingHistoryPanel.vue";
import WritingOutline from "./writing/WritingOutline.vue";
import WritingRibbon, { type RibbonAction, type RibbonTab } from "./writing/WritingRibbon.vue";
import WritingSelectionBubble from "./writing/WritingSelectionBubble.vue";
import WritingStatusBar from "./writing/WritingStatusBar.vue";
import { jobRoute, writingAnchorLink } from "./workspaceRoutes";
import "@/lab/screens/screens.css";

const props = withDefaults(
  defineProps<{
    services: BackendServices;
    jobs: ServiceJobsState;
    workspaceId: string;
    project: ProjectRead;
    historyLink?: { source: string; projectId: string; documentId: string; version: string };
    active?: boolean;
    /** 副驾面板注册表；缺省为协调者登记的 WRITING_PANELS。 */
    panels?: readonly WritingPanelDefinition[];
  }>(),
  { active: true, panels: () => WRITING_PANELS },
);
const emit = defineEmits<{
  openVersion: [link: { source: string; projectId: string; documentId: string; version: number }];
  closeVersion: [];
  openProjects: [];
  /** 正式稿版本变化（保存、采纳、恢复、升级后重载）：外壳据此刷新顶栏进度。 */
  documentVersion: [version: number];
}>();

type EditorHandle = InstanceType<typeof DocsEditor>;
const route = useRoute();
const controller = createDocsDocumentController(props.services, {
  sourceKey: props.services.sourceKey,
  projectId: props.project.id,
  localProjectId: props.workspaceId,
});
const state = controller.state;
const compact = useMediaQuery("(max-width: 959px)");
const wide = useMediaQuery("(min-width: 1440px)");
/** 960—1279：目录与副驾不同时常驻，否则纸面过窄；打开副驾时目录让位，收起副驾即恢复。 */
const roomy = useMediaQuery("(min-width: 1280px)");
const visible = ref(true);
const live = computed(() => props.active && visible.value);
const title = computed(() => props.project.title.trim() || props.project.name);

/* ── 版本深链 ── */
const requestedVersion = computed(() => {
  const value = props.historyLink?.version;
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const version = Number(value);
  return Number.isSafeInteger(version) ? version : undefined;
});
const invalidLink = computed(() => {
  const link = props.historyLink;
  return (
    !!link && (link.source !== props.services.sourceKey || link.projectId !== props.project.id || !link.documentId || requestedVersion.value === undefined)
  );
});
const wrongDocument = computed(() => {
  const link = props.historyLink;
  return !!link && (state.phase === "empty" || (!!state.document && link.documentId !== state.document.id));
});
const linkError = computed(() => invalidLink.value || wrongDocument.value);

/* ── 内核与正文载入 ── */
const engineError = ref("");
const editor = ref<EditorHandle>();
const editorModel = shallowRef<DocsModel>();
const editorContext = shallowRef<DocsPreviewContext>();
const baseProtections = shallowRef<DocsProtection[]>([]);
const ranges = shallowRef<ProtectedRange[]>([]);
const openedRevision = ref(-1);
const opening = ref(false);
let openToken = 0;
/** 本次打开时换成字节的图片资源 → 原引用；生成快照前换回。 */
let resourceUris: ReadonlyMap<string, string> = new Map();
const fetchResource = (sha256: string) => props.services.documents.resource(props.project.id, sha256);

async function openModel(model: DocsModel) {
  const engine = await loadDocsEngine();
  return engine.open(model);
}

async function openSnapshot() {
  const revision = state.loadRevision;
  const snapshot = state.snapshot;
  if (!live.value || state.phase !== "ready" || state.schema !== 2 || !snapshot || openedRevision.value === revision) return;
  const token = ++openToken;
  opening.value = true;
  engineError.value = "";
  try {
    const hydrated = await hydrateResources(snapshot.model, fetchResource);
    const opened = await openModel(hydrated.model);
    if (token !== openToken || revision !== state.loadRevision) return;
    cancelCapture();
    resourceUris = hydrated.uris;
    editorContext.value = opened.context;
    editorModel.value = opened.model;
    // 换稿后旧选区（已选字数、副驾引用的段内区间）属于上一版本，不再沿用。
    selection.value = null;
    panelSelection.value = null;
    bubble.value = null;
    viewPage.value = 0;
    baseProtections.value = snapshot.protections;
    ranges.value = toProtectedRanges(snapshot.protections);
    overlayGroups.value = {};
    structure.value = readStructure(opened.model);
    captureError.value = "";
    openedRevision.value = revision;
  } catch (error) {
    if (token === openToken) engineError.value = error instanceof DocsEngineError ? error.message : "暂时无法打开正文，已保存的版本不受影响；请重试。";
  } finally {
    if (token === openToken) opening.value = false;
  }
}

/* ── 原件保护（DOCX 导入的正文只允许改映射文字） ── */
type SourcePhase = "loading" | "free" | "source" | "error";
const sourcePhase = ref<SourcePhase>("loading");
const sourceEditable = shallowRef<ReadonlySet<string>>(new Set());
const sourceError = ref("");
let sourceRequest: AbortController | undefined;
async function loadSource() {
  sourceRequest?.abort();
  sourceError.value = "";
  sourceEditable.value = new Set();
  const document = state.document;
  if (!document || state.schema !== 2 || !live.value) {
    sourcePhase.value = "loading";
    return;
  }
  sourcePhase.value = "loading";
  const request = (sourceRequest = new AbortController());
  try {
    const source = await props.services.documentSources.current(props.project.id, document.id, document.version, request.signal);
    if (request.signal.aborted) return;
    const contract = source.guard_contract as Record<string, unknown>;
    const nodes = contract.editable_nodes;
    if (contract.guard_version !== "source-model-v2" || !Array.isArray(nodes) || !nodes.every((node) => typeof node === "string"))
      throw new ApiError("DOCUMENT_SOURCE_GUARD_INVALID");
    sourceEditable.value = new Set(nodes as string[]);
    sourcePhase.value = "source";
  } catch (problem) {
    if (request.signal.aborted) return;
    const issue = asApiError(problem);
    if (issue.code === "DOCUMENT_SOURCE_NOT_FOUND") sourcePhase.value = "free";
    else {
      sourcePhase.value = "error";
      sourceError.value = `原件保护尚未核对，正文暂时只读。${issue.message}`;
    }
  }
}
const beforeTransaction = computed(() => (sourcePhase.value === "source" ? sourceTextOnly(sourceEditable.value) : undefined));

/* ── 编辑状态 ── */
const blockingOperations = new Set(["check", "load-latest", "recover", "upgrade", "create-blank"]);
const loaded = computed(() => state.phase === "ready" && state.schema === 2 && openedRevision.value === state.loadRevision && !!editorModel.value);
const editable = computed(
  () =>
    live.value &&
    loaded.value &&
    !linkError.value &&
    !blockingOperations.has(state.operation ?? "") &&
    (sourcePhase.value === "free" || sourcePhase.value === "source"),
);
const viewState = shallowRef<EditorViewState>();
const selection = shallowRef<EditorSelection | null>(null);
const pagination = ref({ pages: 0, current: 0, complete: true });
/** 光标所在页；内核在选区变化时更新 currentPage，分页事件只在排版时携带。 */
const cursorPage = computed(() => viewState.value?.currentPage || pagination.value.current);
/** 视口所见页：滚动离开光标页后跟随视口；0 表示尚未测量。 */
const viewPage = ref(0);
const paperElement = ref<HTMLElement>();
let pageFrame = 0;
const structure = shallowRef<WritingStructure>({ chapters: [], words: 0, topOf: new Map() });
const showProtected = ref(true);
const zoom = ref<number | "fit-width">("fit-width");
const ribbonTab = ref<RibbonTab>("home");
const captureError = ref("");
const blockedNotice = ref("");
let blockedTimer: ReturnType<typeof setTimeout> | undefined;

const singleSelection = computed<WritingSelection | null>(() => {
  const current = selection.value;
  if (!current || current.collapsed || current.segments.length !== 1) return null;
  const segment = current.segments[0]!;
  return segment.end > segment.start ? { node: segment.node, start: segment.start, end: segment.end, text: segment.text } : null;
});
/** 面板拿到的选区：最近一次单段选区或折叠光标（start === end、text 为空），焦点移到面板时保留。 */
const panelSelection = shallowRef<WritingSelection | null>(null);
const currentChapter = computed(() => chapterAt(structure.value, selection.value?.focus.node));
const selectionWords = computed(() => (selection.value && !selection.value.collapsed ? countText(selection.value.text) : undefined));
const currentLock = computed(() => {
  const range = singleSelection.value;
  if (range) return lockAt(currentRanges(), range.node, range.start, range.end);
  const focus = selection.value?.collapsed ? selection.value.focus : undefined;
  return focus ? lockAt(currentRanges(), focus.node, focus.offset, focus.offset) : undefined;
});
const lockState = computed(() => {
  if (currentLock.value) return { available: true, locked: true, reason: "" };
  if (!selection.value || selection.value.collapsed) return { available: false, locked: false, reason: "先在正文中选择要锁定的文字" };
  if (!singleSelection.value) return { available: false, locked: false, reason: "锁定只能落在同一段内" };
  return { available: true, locked: false, reason: "" };
});
const styles = computed(() => styleOptions(editorContext.value, viewState.value?.format ?? null));
const currentStyle = computed(() => styleValue(editorContext.value, viewState.value?.format ?? null));
const tableAbility = ref({ insertRow: false, deleteRow: false });

function currentRanges(): readonly ProtectedRange[] {
  void viewState.value;
  return editor.value?.controller.protected ?? ranges.value;
}

/* ── 草稿捕获：编辑即标记未保存，快照稍后在空闲时生成 ── */
let captureTimer: ReturnType<typeof setTimeout> | undefined;
let captureDirty = false;
let structureTimer: ReturnType<typeof setTimeout> | undefined;

function cancelCapture() {
  clearTimeout(captureTimer);
  clearTimeout(structureTimer);
  captureDirty = false;
}

function lostMessage(ids: readonly string[]) {
  const kinds = new Set(ids.map((id) => baseProtections.value.find((item) => item.id === id)?.kind).filter((kind) => !!kind));
  const labels = [...kinds].map((kind) => PROTECTION_DISPLAY[kind!].label).join("、") || "受保护内容";
  return `${labels}已无法在正文中定位，本次编辑不能保存。草稿保持上一次可保存的状态；请撤销最近的修改后再保存。`;
}

function capture(): boolean {
  clearTimeout(captureTimer);
  if (!captureDirty) return !captureError.value;
  const handle = editor.value;
  if (!handle || !loaded.value) return false;
  const readback = protectionsFromRanges(baseProtections.value, handle.controller.protected);
  if (readback.lost.length) {
    captureError.value = lostMessage(readback.lost);
    return false;
  }
  try {
    const snapshot = createDocsSnapshot(dehydrateResources(handle.getModel(), resourceUris), readback.protections);
    if (!controller.edit(snapshot)) throw new Error(state.error || "暂时无法保留草稿。");
    captureDirty = false;
    captureError.value = "";
    return true;
  } catch (error) {
    captureError.value = error instanceof DocsSnapshotError || error instanceof Error ? error.message : "暂时无法保留草稿。";
    return false;
  }
}

function scheduleCapture(delay = 260) {
  captureDirty = true;
  clearTimeout(captureTimer);
  captureTimer = setTimeout(capture, delay);
}

function refreshStructure() {
  const handle = editor.value;
  if (handle && loaded.value) structure.value = readStructure(handle.getModel());
}

function onTransaction() {
  if (!editable.value) return;
  controller.touch();
  scheduleCapture();
  clearTimeout(structureTimer);
  structureTimer = setTimeout(refreshStructure, 220);
}

function onViewState(value: EditorViewState) {
  viewState.value = value;
  const handle = editor.value;
  tableAbility.value =
    handle && value.format?.inTable
      ? { insertRow: handle.can("table.insertRowBelow"), deleteRow: handle.can("table.deleteRow") }
      : { insertRow: false, deleteRow: false };
}

function onSelection(value: EditorSelection | null) {
  selection.value = value;
  if (value && !value.collapsed && value.segments.length === 1 && singleSelection.value) panelSelection.value = singleSelection.value;
  else if (value?.collapsed) panelSelection.value = { node: value.focus.node, start: value.focus.offset, end: value.focus.offset, text: "" };
  scheduleBubble();
}

function onBlocked(event: BlockedEvent) {
  const message =
    event.kind === "host" && sourcePhase.value === "source"
      ? "此原件只允许修改已映射段落中的文字，章节、格式与结构保持原样。正文保持不变；如需更大改动，请在原文档中修改后重新导入。"
      : describeBlocked(event);
  blockedNotice.value = message;
  clearTimeout(blockedTimer);
  blockedTimer = setTimeout(() => (blockedNotice.value = ""), 4200);
}

/* ── 保存 ── */
const lastSaveFailed = ref(false);
const saveState = computed(() => {
  if (state.operation === "save") return "saving" as const;
  if (lastSaveFailed.value && state.dirty && !state.issue) return "failed" as const;
  return state.dirty || captureDirty ? ("dirty" as const) : ("saved" as const);
});
const savedAt = computed(() => {
  const value = state.savedAt ?? state.document?.updated_at;
  return value ? new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : undefined;
});
const canSave = computed(() => editable.value && state.dirty && !state.issue && !state.operation);

async function save() {
  if (state.issue === "conflict" && state.latest && !state.operation) {
    conflictOpen.value = true;
    return;
  }
  if (!editable.value || state.operation || state.issue) return;
  if (!capture()) return;
  if (!state.dirty) return;
  const saved = await controller.save();
  lastSaveFailed.value = !saved && !state.issue && !!state.error;
  // 冲突对话只回应学生的保存操作；载入时恢复出的冲突草稿由冲突条承载，不打断。
  if (state.issue === "conflict" && state.latest && live.value) conflictOpen.value = true;
}

function download(file: { filename: string; mime: string; content: string } | null) {
  if (!file) return;
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── 冲突 ── */
const conflictOpen = ref(false);
watch(
  () => state.issue,
  (issue) => {
    if (issue !== "conflict") conflictOpen.value = false;
  },
);
async function loadLatest() {
  conflictOpen.value = false;
  cancelCapture();
  await controller.loadLatestPreservingDraft();
}
async function saveMine() {
  conflictOpen.value = false;
  if (!capture()) return;
  await controller.saveOverLatest();
}

/* ── 叠加层与定位 ── */
const overlayGroups = shallowRef<Record<string, PreviewHighlight[]>>({});
const overlays = computed(() => Object.values(overlayGroups.value).flat());
const flashChapter = ref<string>();
let flashTimer: ReturnType<typeof setTimeout> | undefined;
function setOverlays(group: string, highlights: readonly PreviewHighlight[]) {
  const next = { ...overlayGroups.value };
  if (highlights.length) next[group] = highlights.map((item) => ({ ...item, group }));
  else delete next[group];
  overlayGroups.value = next;
}
function clearOverlays(group?: string) {
  if (group) setOverlays(group, []);
  else overlayGroups.value = {};
}
async function focusAnchor(anchor: WritingAnchor, target: EditorHandle | undefined = editor.value): Promise<boolean> {
  if (!target) return false;
  const status = await target.scrollToAnchor(anchor);
  if (status !== "found") return false;
  if (target === editor.value) {
    // 定位后的常驻“当前项”标记由荧光叠加取代：用一个不存在的锚点清除它（不滚动），荧光 1.4 秒后褪去。
    void target.scrollToAnchor({ node: "" });
    setOverlays("__locate", [{ id: `locate-${anchor.node}`, group: "__locate", tone: "mark", anchor }]);
    if (structure.value.chapters.some((chapter) => chapter.id === anchor.node)) flashChapter.value = anchor.node;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      clearOverlays("__locate");
      flashChapter.value = undefined;
    }, 1400);
  }
  return true;
}

/* ── 面板与副驾坞 ── */
const outlineVisible = ref(true);
const outlineOpen = ref(false);
const copilotStorageKey = "thesispilot.writing-copilot.v1:" + JSON.stringify([props.services.sourceKey, props.workspaceId, props.project.id]);
const copilotPinned = ref(false);
try {
  if (typeof window !== "undefined") copilotPinned.value = window.localStorage.getItem(copilotStorageKey) === "open";
} catch {}
const copilotDrawer = ref(false);
const copilotWidth = ref(376);
const hasDocument = computed(() => state.phase === "ready" && state.schema === 2 && !!state.document);
const panelList = computed(() => availablePanels(props.panels, hasDocument.value));
const copilotTabs = computed(() => [
  ...panelList.value.filter((panel) => panel.order < 90).map((panel) => ({ value: panel.id, label: panel.label })),
  ...(state.phase === "ready" && state.document ? [{ value: HISTORY_PANEL_ID, label: "版本" }] : []),
  ...panelList.value.filter((panel) => panel.order >= 90).map((panel) => ({ value: panel.id, label: panel.label })),
]);
const activePanel = ref<string>(HISTORY_PANEL_ID);
const activeDefinition = computed(() => panelList.value.find((panel) => panel.id === activePanel.value));
const copilotAvailable = computed(() => copilotTabs.value.length > 0 && !linkError.value);
const copilotShown = computed(() => copilotAvailable.value && (compact.value ? copilotDrawer.value : wide.value || copilotPinned.value));
const outlineSuppressed = computed(() => !compact.value && !roomy.value && copilotShown.value);
const draftPanel = computed(() => panelList.value.find((panel) => panel.drafts));
const panelEligible = computed(
  () => controller.eligible() && loaded.value && !captureError.value && !captureDirty && (sourcePhase.value === "free" || sourcePhase.value === "source"),
);
const panelDocument = computed(() =>
  hasDocument.value && state.confirmed && state.document ? { id: state.document.id, version: state.document.version, snapshot: state.confirmed } : null,
);
const copilotButton = ref<HTMLElement>();
const outlineButton = ref<HTMLElement>();

watch(
  copilotTabs,
  (tabs) => {
    if (!tabs.some((tab) => tab.value === activePanel.value)) activePanel.value = tabs[0]?.value ?? HISTORY_PANEL_ID;
  },
  { immediate: true },
);
watch(copilotPinned, (value) => {
  try {
    window.localStorage.setItem(copilotStorageKey, value ? "open" : "closed");
  } catch {}
});

function openPanel(id: string) {
  if (!copilotTabs.value.some((tab) => tab.value === id)) return;
  activePanel.value = id;
  if (compact.value) copilotDrawer.value = true;
  else if (!wide.value) copilotPinned.value = true;
}
function closeCopilot() {
  if (compact.value) copilotDrawer.value = false;
  else copilotPinned.value = false;
}
function toggleCopilot() {
  if (compact.value) copilotDrawer.value = !copilotDrawer.value;
  else copilotPinned.value = !copilotPinned.value;
}
async function reload() {
  cancelCapture();
  await controller.checkLatest();
}

provideWritingContext({
  document: panelDocument,
  selection: panelSelection,
  eligible: panelEligible,
  focus: (anchor) => focusAnchor(anchor),
  setOverlays,
  clearOverlays,
  reload,
  openPanel,
  model: () => (loaded.value ? (editor.value?.getModel() ?? null) : null),
});

/* ── 选区气泡 ── */
const bubble = shallowRef<{ top: number; left: number } | null>(null);
const deskElement = ref<HTMLElement>();
let pointerDown = false;
let bubbleFrame = 0;
function scheduleBubble() {
  cancelAnimationFrame(bubbleFrame);
  bubbleFrame = requestAnimationFrame(placeBubble);
}
function placeBubble() {
  const current = selection.value;
  if (!live.value || !editable.value || pointerDown || !current || current.collapsed || preview.value) {
    bubble.value = null;
    return;
  }
  const native = window.getSelection();
  const host = deskElement.value;
  if (!native?.rangeCount || !host || !host.contains(native.anchorNode)) {
    bubble.value = null;
    return;
  }
  const rect = native.getRangeAt(0).getBoundingClientRect();
  const bounds = host.getBoundingClientRect();
  if (!rect.width && !rect.height) return void (bubble.value = null);
  if (rect.top < bounds.top + 40 || rect.top > bounds.bottom - 8) return void (bubble.value = null);
  const left = Math.min(Math.max(rect.left + rect.width / 2, bounds.left + 120), bounds.right - 120);
  bubble.value = { top: rect.top, left };
}
const bubbleLock = computed(() => (currentLock.value ? ("unlock" as const) : singleSelection.value ? ("lock" as const) : null));
const bubbleNote = computed(() => (!singleSelection.value && !currentLock.value ? "跨段选区不能锁定或起草，请在同一段内选择" : undefined));
function bubbleDraft() {
  const panel = draftPanel.value;
  if (!panel) return;
  if (singleSelection.value) panelSelection.value = singleSelection.value;
  bubble.value = null;
  openPanel(panel.id);
}

/* ── 锁定 ── */
function lockSelection() {
  const range = singleSelection.value;
  const handle = editor.value;
  if (!range || !handle || !editable.value || currentLock.value) return;
  const protection: DocsProtection = { id: createId(), kind: "lock", anchor: { node: range.node, start: range.start, end: range.end } };
  baseProtections.value = [...baseProtections.value, protection];
  ranges.value = [...handle.controller.protected, ...toProtectedRanges([protection])];
  bubble.value = null;
  controller.touch();
  scheduleCapture(0);
}
function unlockSelection() {
  const lock = currentLock.value;
  const handle = editor.value;
  if (!lock || !handle || !editable.value) return;
  baseProtections.value = baseProtections.value.filter((item) => item.id !== lock.id);
  ranges.value = handle.controller.protected.filter((item: ProtectedRange) => item.id !== lock.id);
  bubble.value = null;
  controller.touch();
  scheduleCapture(0);
}

/* ── 功能区 ── */
const lastInspection = ref<{ id: string; version: number }>();
const inspectionError = ref("");
async function inspectDocument() {
  const saved = state.document;
  if (!live.value || !saved || state.schema !== 2 || state.operation || props.jobs.action.value) return;
  inspectionError.value = "";
  const accepted = await props.jobs.inspectDocument(saved.id, saved.version);
  if (!live.value) return;
  if (accepted) lastInspection.value = { id: accepted.id, version: saved.version };
  else inspectionError.value = props.jobs.actionError.value;
}
const inspection = computed(() => ({
  busy: props.jobs.action.value?.type === "inspect-document",
  disabled: !hasDocument.value || !!props.jobs.action.value || !!state.operation,
  error: inspectionError.value || undefined,
  link: lastInspection.value
    ? { to: jobRoute(props.project.id, lastInspection.value.id, props.services.sourceKey), label: `查看正式稿 v${lastInspection.value.version} 的结构检查` }
    : undefined,
}));

function applyStyle(value: StyleValue) {
  const handle = editor.value;
  if (!handle) return;
  const format = viewState.value?.format;
  const body = editorContext.value?.docs.bodyStyle;
  if (value === "p") {
    handle.exec("heading", 0);
    if (body && typeof format?.style === "string" && format.style !== body) handle.exec("style", body);
  } else if (value.startsWith("h")) handle.exec("heading", Number(value.slice(1)));
  else {
    if (format?.heading) handle.exec("heading", 0);
    handle.exec("style", value.slice(2));
  }
  handle.focus();
}

function onRibbon(action: RibbonAction) {
  const handle = editor.value;
  switch (action.type) {
    case "outline":
      outlineVisible.value = !outlineVisible.value;
      return;
    case "protections":
      showProtected.value = !showProtected.value;
      return;
    case "zoom":
      zoom.value = action.zoom;
      return;
    case "inspect":
      void inspectDocument();
      return;
    case "lock":
      lockSelection();
      return;
    case "unlock":
      unlockSelection();
      return;
  }
  if (!handle || !editable.value) return;
  switch (action.type) {
    case "undo":
      handle.undo();
      break;
    case "redo":
      handle.redo();
      break;
    case "mark":
      handle.exec(action.mark);
      break;
    case "align":
      handle.exec("align", action.align);
      break;
    case "indent":
      handle.exec("indent");
      break;
    case "outdent":
      handle.exec("outdent");
      break;
    case "clear":
      handle.exec("clearFormatting");
      break;
    case "style":
      applyStyle(action.value);
      return;
    case "table":
      insertTable(handle.controller);
      break;
    case "page-break":
      insertPageBreak(handle.controller);
      break;
    case "row-above":
      handle.exec("table.insertRowAbove");
      break;
    case "row-below":
      handle.exec("table.insertRowBelow");
      break;
    case "row-delete":
      handle.exec("table.deleteRow");
      break;
  }
  handle.focus();
}
const zoomLabel = computed(() => (zoom.value === "fit-width" ? "适应页宽" : `${Math.round(zoom.value * 100)}%`));

/* ── 目录 ── */
/** 目录可用：可编辑正文，或旧版结构的只读预览（目录定位到只读纸面）。 */
const outlineReady = computed(() => loaded.value || (state.schema === 1 && !!legacy.value));
function selectChapter(id: string) {
  const go = () => (state.schema === 1 ? focusAnchor({ node: id }, previewEditor.value) : focusAnchor({ node: id }));
  if (compact.value) {
    outlineOpen.value = false;
    void nextTick(go);
  } else void go();
}

/* ── 历史版本与旧版结构的只读纸面 ── */
const preview = shallowRef<(HistoryPreview & { model: DocsModel; context: DocsPreviewContext }) | null>(null);
const previewLoading = ref(false);
const previewError = ref("");
const previewEditor = ref<EditorHandle>();
let previewRequest: AbortController | undefined;

async function readVersion(version: number, signal: AbortSignal) {
  const document = state.document!;
  const result = await props.services.documents.versionAsV2(props.project.id, document.id, version, signal);
  if (result.project_id !== props.project.id || result.document_id !== document.id || result.version !== version || result.content.schema_version !== 2)
    throw new ApiError("INVALID_RESPONSE");
  let snapshot;
  try {
    snapshot = parseDocsSnapshot(result.content.json);
  } catch {
    throw new ApiError("INVALID_RESPONSE");
  }
  const opened = await openModel((await hydrateResources(snapshot.model, fetchResource)).model);
  return {
    version,
    source: result.source,
    createdAt: result.created_at,
    converted: !!result.converted,
    snapshot,
    model: opened.model,
    context: opened.context,
  };
}

async function loadPreview() {
  previewRequest?.abort();
  previewError.value = "";
  const version = requestedVersion.value;
  const document = state.document;
  if (version === undefined || !document || !live.value || linkError.value) {
    preview.value = null;
    previewLoading.value = false;
    return;
  }
  if (preview.value?.version === version) return;
  preview.value = null;
  openPanel(HISTORY_PANEL_ID);
  const request = (previewRequest = new AbortController());
  previewLoading.value = true;
  try {
    const result = await readVersion(version, request.signal);
    if (request === previewRequest) preview.value = result;
  } catch (cause) {
    if (request !== previewRequest) return;
    previewError.value = cause instanceof DocsEngineError ? cause.message : asApiError(cause).message;
  } finally {
    if (request === previewRequest) previewLoading.value = false;
  }
}
const versionDiff = computed(() => (preview.value && state.confirmed ? diffVersions(preview.value.model, state.confirmed.model) : null));
const previewOverlays = computed<PreviewHighlight[]>(() =>
  (versionDiff.value?.rows ?? []).flatMap((row) =>
    row.before
      ? [{ id: `diff-${row.key}`, group: "history", tone: row.kind === "removed" ? ("delete" as const) : ("comment" as const), anchor: { node: row.before } }]
      : [],
  ),
);
function compareVersion(version: number) {
  if (!state.document) return;
  emit("openVersion", { source: props.services.sourceKey, projectId: props.project.id, documentId: state.document.id, version });
}
function closePreview() {
  previewRequest?.abort();
  preview.value = null;
  if (props.historyLink) emit("closeVersion");
}
function locateDiff(row: { before?: string; after?: string }) {
  if (preview.value && row.before) void focusAnchor({ node: row.before }, previewEditor.value);
  else if (row.after) void focusAnchor({ node: row.after });
}
async function restored() {
  cancelCapture();
  await controller.checkLatest();
  closePreview();
}

/** 旧版结构（v1）：只读纸面 + 升级入口。 */
const legacy = shallowRef<{ version: number; model: DocsModel; context: DocsPreviewContext; snapshot: ReturnType<typeof parseDocsSnapshot> } | null>(null);
const legacyError = ref("");
const legacyDrafts = shallowRef<LegacyDraft[]>([]);
let legacyRequest: AbortController | undefined;
async function loadLegacy() {
  legacyRequest?.abort();
  legacyError.value = "";
  const document = state.document;
  if (!document || state.schema !== 1 || !live.value || isBlankLegacy(document)) {
    legacy.value = null;
    return;
  }
  if (legacy.value?.version === document.version) return;
  const request = (legacyRequest = new AbortController());
  try {
    const result = await readVersion(document.version, request.signal);
    if (request === legacyRequest) {
      legacy.value = { version: result.version, model: result.model, context: result.context, snapshot: result.snapshot };
      structure.value = readStructure(result.model);
    }
  } catch (cause) {
    if (request === legacyRequest) legacyError.value = cause instanceof DocsEngineError ? cause.message : asApiError(cause).message;
  }
  const scope = { sourceKey: props.services.sourceKey, projectId: props.project.id, localProjectId: props.workspaceId, documentId: document.id };
  legacyDrafts.value = await readLegacyDrafts(scope);
}
function downloadLegacyDrafts() {
  const document = state.document;
  if (!document) return;
  download(
    legacyDraftFile(
      { sourceKey: props.services.sourceKey, projectId: props.project.id, localProjectId: props.workspaceId, documentId: document.id },
      legacyDrafts.value,
    ),
  );
}
const readonlyPaper = computed(() => preview.value ?? (state.schema === 1 ? legacy.value : null));
const upgradeLosses = computed(() => state.upgrade?.loss_report ?? []);

/* ── 深链定位：?chapterId= / ?anchor=节点ID[@起-止]（评审、指令面板；格式见 workspaceRoutes） ── */
const linkTarget = computed<WritingAnchor | undefined>(() => {
  const { anchor, chapterId } = writingAnchorLink(route.query);
  return anchor ?? (chapterId ? { node: chapterId } : undefined);
});
const linkNotice = ref("");
let handledLink = "";
async function followLink() {
  const target = linkTarget.value;
  const key = route.fullPath;
  if (!target || !live.value || !loaded.value || handledLink === key) return;
  handledLink = key;
  await nextTick();
  linkNotice.value = (await focusAnchor(target)) ? "" : "链接指向的位置已不在当前正文中，可能已被修改或删除。";
}

/* ── 高度：写作台锁定到视口，纸面在桌面内滚动 ── */
const root = ref<HTMLElement>();
const deskHeight = ref("calc(100dvh - 160px)");
function measure() {
  const element = root.value;
  if (!element || !live.value) return;
  const top = element.getBoundingClientRect().top + window.scrollY;
  const main = element.closest("main");
  const bottom = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 16;
  deskHeight.value = `${Math.max(420, window.innerHeight - top - bottom)}px`;
}
let resizeObserver: ResizeObserver | undefined;
onMounted(() => {
  measure();
  window.addEventListener("resize", measure);
  const bar = document.querySelector(".screens-topbar");
  if (bar && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(bar);
  }
  document.addEventListener("visibilitychange", flushOnHide);
  window.addEventListener("pagehide", flushCapture);
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", measure);
  resizeObserver?.disconnect();
  document.removeEventListener("visibilitychange", flushOnHide);
  window.removeEventListener("pagehide", flushCapture);
});
function flushCapture() {
  if (captureDirty) capture();
}
function flushOnHide() {
  if (document.visibilityState === "hidden") flushCapture();
}

/* ── 生命周期与数据 ── */
watch(
  [live, invalidLink],
  ([available, invalid]) => {
    if (!available || invalid) {
      controller.pause();
      return;
    }
    void controller.load();
  },
  { immediate: true, flush: "sync" },
);
watch([() => state.loadRevision, live, () => state.phase, () => state.schema], () => void openSnapshot(), { immediate: true });
// 项目向导等入口新建的空白稿仍是旧版结构且没有内容：直接升级，不让学生面对“旧版结构”说明。
watch(
  () => [state.document, live.value] as const,
  ([document, available]) => {
    if (available && !state.operation && isBlankLegacy(document)) void controller.upgrade();
  },
  { immediate: true },
);
watch(
  () => [state.document?.id, state.document?.version, state.schema, live.value] as const,
  () => {
    void loadSource();
    void loadLegacy();
  },
  { immediate: true },
);
watch([requestedVersion, () => state.document?.id, live, linkError], () => void loadPreview(), { immediate: true });
watch([linkTarget, loaded, live], () => void followLink(), { immediate: true });
watch(
  () => state.document?.version,
  (version, previous) => {
    // 含从无到有（空项目创建或导入正式稿）：顶栏此前显示“正文未创建”，同样需要刷新。
    if (version !== undefined && version !== previous) emit("documentVersion", version);
  },
);
watch(
  () => route.query.panel,
  (panel) => {
    if (typeof panel === "string") openPanel(panel);
  },
  { immediate: true },
);
watch([live, compact], () => void nextTick(measure));
watch(
  compact,
  (value) => {
    // 窄屏若继续缩放整张 A4，正文字号会过小；默认 100%，学生仍可主动选择“适应页宽”。
    if (value && zoom.value === "fit-width") zoom.value = 1;
    if (!value) {
      outlineOpen.value = false;
      copilotDrawer.value = false;
    }
  },
  { immediate: true },
);
watch(editable, (value) => {
  if (!value) bubble.value = null;
});

onActivated(() => {
  visible.value = true;
  void nextTick(measure);
});
onDeactivated(() => {
  flushCapture();
  visible.value = false;
  outlineOpen.value = false;
  copilotDrawer.value = false;
  bubble.value = null;
});
onScopeDispose(() => {
  flushCapture();
  controller.dispose();
  sourceRequest?.abort();
  previewRequest?.abort();
  legacyRequest?.abort();
  clearTimeout(captureTimer);
  clearTimeout(structureTimer);
  clearTimeout(blockedTimer);
  clearTimeout(flashTimer);
  cancelAnimationFrame(bubbleFrame);
  cancelAnimationFrame(pageFrame);
});

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && bubble.value) {
    bubble.value = null;
    event.stopPropagation();
  }
}
function onDeskPointer(down: boolean) {
  pointerDown = down;
  if (down) bubble.value = null;
  else scheduleBubble();
}
function onDeskScroll(event: Event) {
  if (bubble.value) scheduleBubble();
  if (event.target instanceof Node && paperElement.value?.contains(event.target)) schedulePage();
}

/* ── 状态栏页码：光标页在视口内时显示光标页，滚动离开后显示视口所见页 ── */
function schedulePage() {
  cancelAnimationFrame(pageFrame);
  pageFrame = requestAnimationFrame(placePage);
}
function placePage() {
  const paper = paperElement.value;
  const viewport = paper?.querySelector<HTMLElement>(".mo-docs-editor__viewport");
  if (!paper || !viewport) return void (viewPage.value = 0);
  const pages = paper.querySelectorAll<HTMLElement>(".doc-pages [data-testid='doc-page']");
  const view = viewport.getBoundingClientRect();
  viewPage.value = pageInView(pages.length, (index) => pages[index]!.getBoundingClientRect(), view.top, view.bottom, cursorPage.value);
}
function onPagination(value: { pages: number; current: number; complete: boolean }) {
  pagination.value = { pages: value.pages, current: value.current, complete: value.complete };
  schedulePage();
}
watch(cursorPage, schedulePage);
watch(editor, () => triggerRef(viewState));
</script>

<template>
  <section
    v-if="live"
    ref="root"
    class="workspace-writing"
    :class="{
      'has-outline': !compact && outlineVisible && outlineReady && !outlineSuppressed,
      'has-copilot': !compact && copilotShown,
      'is-compact': compact,
    }"
    :style="{ '--writing-height': deskHeight, '--copilot-width': copilotWidth + 'px' }"
    @keydown.ctrl.s.prevent="save"
    @keydown.meta.s.prevent="save"
    @keydown="onKeydown"
  >
    <h1 class="workspace-writing__sr">论文写作台</h1>
    <TpState v-if="linkError" class="workspace-writing__full" kind="error" title="无法打开版本链接" desc="这个链接与当前服务、项目或正文不匹配，或版本号无效。">
      <div class="screen-actions">
        <TpButton variant="primary" @click="emit('closeVersion')">返回写作</TpButton>
        <TpButton variant="ghost" @click="emit('openProjects')">查看项目</TpButton>
      </div>
    </TpState>
    <template v-else>
      <WritingDrawer :compact="compact" :open="outlineOpen" label="章节目录" @dismiss="outlineOpen = false" @closed="live && outlineButton?.focus()">
        <aside
          v-show="compact || (outlineVisible && outlineReady && !outlineSuppressed)"
          class="workspace-writing__outline"
          :class="{ 'tp-drawer': compact }"
          aria-label="章节目录"
        >
          <WritingOutline
            :chapters="structure.chapters"
            :current="currentChapter?.id"
            :words="structure.words"
            :compact="compact"
            :flash="flashChapter"
            @select="selectChapter"
            @close="outlineOpen = false"
          />
        </aside>
      </WritingDrawer>

      <div class="workspace-writing__bench">
        <header class="writing-docbar">
          <button
            v-if="compact && outlineReady"
            ref="outlineButton"
            class="tp-tool writing-docbar__icon"
            type="button"
            aria-label="打开章节目录"
            @click="outlineOpen = true"
          >
            <TpIcon :icon="PhList" :size="18" />
          </button>
          <button
            v-else-if="outlineSuppressed && outlineVisible && outlineReady"
            class="tp-tool writing-docbar__icon"
            type="button"
            aria-label="显示章节目录"
            title="显示章节目录（收起副驾）"
            @click="closeCopilot"
          >
            <TpIcon :icon="PhList" :size="18" />
          </button>
          <div class="writing-docbar__title">
            <p class="writing-docbar__name" :title="title">{{ title }}</p>
            <div class="writing-docbar__meta">
              <Transition name="tp-swap" mode="out-in">
                <TpVersion v-if="state.document" :key="state.document.version" :v="state.document.version" prefix="正式稿 " />
              </Transition>
              <TpStatus v-if="state.schema === 1 && !isBlankLegacy(state.document)" tone="ghost" size="sm" label="旧版结构 · 只读" />
              <TpStatus v-else-if="sourcePhase === 'source'" tone="neutral" size="sm" label="原件保护" />
              <TpSaveIndicator v-if="hasDocument" :state="saveState" :at="saveState === 'saved' ? savedAt : undefined" @retry="save" />
            </div>
          </div>
          <div class="writing-docbar__actions">
            <TpMenu v-if="state.drafts.length && hasDocument" align="end">
              <template #trigger="{ toggle }">
                <TpButton size="sm" variant="ghost" :disabled="!!state.operation" :aria-label="`本机草稿（${state.drafts.length}）`" @click="toggle"
                  >草稿 {{ state.drafts.length }}<TpIcon :icon="PhCaretDown" :size="13"
                /></TpButton>
              </template>
              <button
                v-for="draft in state.drafts"
                :key="draft.id"
                type="button"
                class="tp-menu__item"
                role="menuitem"
                @click="controller.recoverDraft(draft.id)"
              >
                恢复基于 v{{ draft.baseVersion }} 的草稿 · {{ new Date(draft.updatedAt).toLocaleString("zh-CN", { hour12: false }) }}
              </button>
            </TpMenu>
            <TpButton v-if="state.draftStatus === 'error'" size="sm" variant="ghost" @click="download(controller.downloadDraft())">
              <TpIcon :icon="PhDownloadSimple" :size="15" />下载草稿
            </TpButton>
            <TpButton
              v-if="hasDocument"
              size="sm"
              :variant="state.dirty && !state.issue ? 'primary' : 'ghost'"
              :disabled="!canSave"
              :loading="state.operation === 'save'"
              @click="save"
              >保存</TpButton
            >
            <button
              v-if="copilotAvailable && !wide"
              ref="copilotButton"
              class="tp-tool writing-docbar__icon"
              type="button"
              :aria-label="copilotShown ? '收起副驾' : '展开副驾'"
              :aria-pressed="copilotShown"
              :title="copilotShown ? '收起副驾' : '展开副驾'"
              @click="toggleCopilot"
            >
              <TpIcon :icon="PhSidebarSimple" :size="18" />
            </button>
          </div>
        </header>

        <TransitionGroup name="tp-list" tag="div" class="workspace-writing__notices tp-list-group">
          <div v-if="state.issue === 'conflict' && state.latest" key="conflict" class="writing-notice is-warning" role="status">
            <TpIcon :icon="PhWarning" :size="16" />
            <p>正式稿已有更新的 v{{ state.latest.version }}，当前编辑基于 v{{ state.baseVersion }}，暂不能直接保存。</p>
            <div class="writing-notice__actions">
              <TpButton size="sm" variant="outline" :disabled="!!state.operation" @click="loadLatest">载入 v{{ state.latest.version }}</TpButton>
              <TpButton size="sm" variant="ghost" :disabled="!!state.operation" @click="conflictOpen = true">处理冲突</TpButton>
            </div>
          </div>
          <div v-else-if="state.issue === 'unknown'" key="unknown" class="writing-notice is-ghost" role="status">
            <TpIcon :icon="PhArrowsClockwise" :size="16" />
            <p>保存结果尚未确认，编辑内容已保留为本机草稿。</p>
            <div class="writing-notice__actions">
              <TpButton size="sm" variant="outline" :loading="state.operation === 'check'" @click="controller.checkLatest()">核对保存结果</TpButton>
            </div>
          </div>
          <div v-if="state.error && state.issue !== 'conflict' && hasDocument" key="error" class="writing-notice is-danger" role="alert">
            <p>{{ state.error }}</p>
          </div>
          <div v-if="captureError" key="capture" class="writing-notice is-danger" role="alert"><p>{{ captureError }}</p></div>
          <div v-if="sourceError" key="source" class="writing-notice is-danger" role="alert">
            <p>{{ sourceError }}</p>
            <div class="writing-notice__actions"><TpButton size="sm" variant="outline" @click="loadSource">重试</TpButton></div>
          </div>
          <div v-if="state.draftError" key="draft" class="writing-notice is-danger" role="alert">
            <p>{{ state.draftError }}</p>
            <div class="writing-notice__actions"><TpButton size="sm" variant="outline" @click="controller.retryDraft()">重试</TpButton></div>
          </div>
          <div v-if="upgradeLosses.length && hasDocument" key="losses" class="writing-notice is-ghost" role="status">
            <p>
              升级时有 {{ upgradeLosses.length }} 处内容无法转换，已按未解析对象锁定并保留原样：{{
                [...new Set(upgradeLosses.map((item) => item.kind))].join("、")
              }}。
            </p>
          </div>
          <div v-if="linkNotice" key="link" class="writing-notice is-ghost" role="status">
            <p>{{ linkNotice }}</p>
            <div class="writing-notice__actions">
              <TpButton size="sm" variant="ghost" icon-only label="关闭提示" @click="linkNotice = ''"><TpIcon :icon="PhX" :size="14" /></TpButton>
            </div>
          </div>
        </TransitionGroup>

        <section v-if="state.schema === 1 && state.document && !isBlankLegacy(state.document)" class="writing-upgrade" aria-labelledby="writing-upgrade-title">
          <div>
            <h2 id="writing-upgrade-title" class="tp-subheading">这份正式稿使用旧版编辑器结构</h2>
            <p class="tp-caption">
              升级后生成正式稿 v{{ state.document.version + 1 }}，原有版本全部保留；基于旧版本的候选会过期，需要重新生成。下方是只读预览。
            </p>
            <p v-if="state.error" class="writing-upgrade__error" role="alert">{{ state.error }}</p>
            <p v-if="legacyError" class="writing-upgrade__error" role="alert">{{ legacyError }}</p>
          </div>
          <div class="writing-upgrade__actions">
            <TpButton v-if="legacyDrafts.length" size="sm" variant="ghost" @click="downloadLegacyDrafts">
              <TpIcon :icon="PhDownloadSimple" :size="15" />下载 {{ legacyDrafts.length }} 份旧草稿
            </TpButton>
            <TpButton variant="primary" :loading="state.operation === 'upgrade'" :disabled="!!state.operation" @click="controller.upgrade()"
              >升级为新版编辑器</TpButton
            >
          </div>
        </section>

        <WritingRibbon
          v-if="hasDocument"
          v-model:tab="ribbonTab"
          :format="viewState?.format ?? null"
          :can-undo="!!viewState?.canUndo"
          :can-redo="!!viewState?.canRedo"
          :editable="editable && !preview"
          :text-only="sourcePhase === 'source'"
          :has-selection="!!selection"
          :style-options="styles"
          :style-value="currentStyle"
          :table="tableAbility"
          :lock="lockState"
          :inspection="inspection"
          :view="{ outline: outlineVisible, outlineToggle: !compact, protections: showProtected, zoom }"
          @action="onRibbon"
        />

        <div
          ref="deskElement"
          class="writing-desk tp-docs-editor"
          @pointerdown="onDeskPointer(true)"
          @pointerup="onDeskPointer(false)"
          @pointercancel="onDeskPointer(false)"
          @scroll.capture.passive="onDeskScroll"
        >
          <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
            <div v-if="state.phase === 'error' && !state.document" key="error" class="writing-desk__state">
              <TpState kind="error" title="无法读取正式稿" :desc="state.error" retryable @retry="controller.load()" />
            </div>
            <div v-else-if="state.phase === 'empty'" key="empty" class="writing-desk__state">
              <TpState kind="empty" title="还没有正式稿" desc="正式稿保存在服务端并保留每个版本。创建后直接在纸面上写作。">
                <TpButton variant="primary" :loading="state.operation === 'create-blank'" :disabled="!!state.operation" @click="controller.createBlank()"
                  >创建空白正式稿</TpButton
                >
                <TpButton v-for="panel in panelList.filter((item) => item.emptyAction)" :key="panel.id" variant="outline" @click="openPanel(panel.id)">{{
                  panel.emptyAction
                }}</TpButton>
              </TpState>
              <p v-if="state.error" class="writing-desk__error" role="alert">{{ state.error }}</p>
            </div>
            <div v-else-if="engineError" key="engine" class="writing-desk__state">
              <TpState kind="error" title="编辑器未能打开正文" :desc="engineError" retryable @retry="state.schema === 1 ? loadLegacy() : openSnapshot()" />
            </div>
            <div v-else-if="!loaded && !(state.schema === 1 && legacy)" key="loading" class="writing-desk__skeleton" role="status" aria-busy="true">
              <div class="writing-desk__sheet"><span /><span /><span /><span /></div>
              <p class="tp-caption">{{ opening ? "正在打开编辑器…" : "正在读取正式稿…" }}</p>
            </div>
          </Transition>

          <div
            v-if="loaded && editorModel && editorContext"
            ref="paperElement"
            class="writing-desk__paper"
            :class="{ 'is-covered': !!preview }"
            :inert="!!preview"
          >
            <DocsEditor
              ref="editor"
              :model="editorModel"
              :context="editorContext"
              :read-only="!editable"
              :zoom="zoom"
              :protected-ranges="ranges"
              :overlays="overlays"
              :show-protected="showProtected"
              :before-transaction="beforeTransaction"
              :paste="sourcePhase === 'source' ? 'plain' : 'formatted'"
              :actor="`user:${workspaceId}`"
              aria-label="论文正文编辑区"
              @transaction="onTransaction"
              @state-change="onViewState"
              @selection-change="onSelection"
              @blocked="onBlocked"
              @pagination="onPagination"
            />
          </div>

          <Transition name="tp-swap" v-bind="panelMotionHooks">
            <div
              v-if="readonlyPaper"
              :key="preview ? 'preview-' + preview.version : 'legacy'"
              class="writing-desk__readonly"
              :class="{ 'is-legacy': !preview }"
            >
              <div v-if="preview" class="writing-desk__banner">
                <TpVersion :v="preview.version" prefix="正在查看 " />
                <span>只读<template v-if="preview.converted"> · 旧版结构转换预览</template></span>
                <span v-if="versionDiff?.rows.length" class="writing-desk__legend"><i class="is-removed" />后来删去 <i class="is-changed" />后来修改</span>
                <TpButton size="sm" variant="outline" @click="closePreview">返回当前稿</TpButton>
              </div>
              <DocsEditor
                ref="previewEditor"
                :key="readonlyPaper.version"
                :model="readonlyPaper.model"
                :context="readonlyPaper.context"
                read-only
                :zoom="zoom"
                :protected-ranges="toProtectedRanges(readonlyPaper.snapshot.protections)"
                :overlays="preview ? previewOverlays : []"
                :show-protected="showProtected"
                :aria-label="preview ? `正式稿 v${preview.version} 只读预览` : '旧版结构正文只读预览'"
              />
            </div>
          </Transition>

          <Transition name="tp-swap" v-bind="panelMotionHooks">
            <p v-if="blockedNotice" :key="blockedNotice" class="writing-desk__toast" role="status">{{ blockedNotice }}</p>
          </Transition>
        </div>

        <WritingStatusBar
          v-if="hasDocument"
          :page="viewPage || cursorPage"
          :pages="pagination.pages"
          :laying="!pagination.complete"
          :words="structure.words"
          :selected="selectionWords"
          :chapter="currentChapter?.title.trim() || undefined"
          :draft="state.dirty ? state.draftStatus : 'idle'"
          :zoom="zoomLabel"
          @zoom="zoom = zoom === 'fit-width' ? 1 : 'fit-width'"
        />
      </div>

      <WritingDrawer
        v-if="copilotAvailable"
        :compact="compact"
        :open="copilotDrawer"
        label="写作副驾"
        @dismiss="copilotDrawer = false"
        @closed="live && copilotButton?.focus()"
      >
        <div v-show="compact || copilotShown" class="workspace-writing__copilot" :class="{ 'tp-drawer': compact }" :inert="!compact && !copilotShown">
          <WritingCopilot
            v-model:active="activePanel"
            v-model:width="copilotWidth"
            :tabs="copilotTabs"
            :closable="compact || !wide"
            :resizable="!compact"
            :close-label="compact ? '关闭写作副驾' : '收起副驾'"
            @close="closeCopilot"
          >
            <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
              <WritingHistoryPanel
                v-if="activePanel === HISTORY_PANEL_ID && state.document"
                key="history"
                :services="services"
                :project-id="project.id"
                :document-id="state.document.id"
                :current-version="state.document.version"
                :latest-version="state.latest?.version"
                :selected="requestedVersion"
                :preview="preview"
                :preview-error="previewError"
                :preview-loading="previewLoading"
                :diff="versionDiff"
                :eligible="panelEligible || (state.schema === 1 && !state.operation)"
                @compare="compareVersion"
                @close-compare="closePreview"
                @retry-preview="loadPreview"
                @locate="locateDiff"
                @restored="restored"
              />
              <KeepAlive v-else-if="activeDefinition">
                <component
                  :is="activeDefinition.component"
                  :key="activeDefinition.id"
                  :services="services"
                  :project="project"
                  :document="panelDocument"
                  :selection="panelSelection"
                  :eligible="panelEligible"
                  @overlays="setOverlays"
                  @focus="focusAnchor"
                  @changed="reload"
                  @close="closeCopilot"
                />
              </KeepAlive>
            </Transition>
          </WritingCopilot>
        </div>
      </WritingDrawer>

      <WritingSelectionBubble
        :position="bubble"
        :draft="!!draftPanel"
        :lock="bubbleLock"
        :note="bubbleNote"
        @draft="bubbleDraft"
        @lock="lockSelection"
        @unlock="unlockSelection"
      />

      <TpDialog
        v-model:open="conflictOpen"
        title="正式稿已在别处更新"
        :description="state.latest ? `服务端已有 v${state.latest.version}，你的编辑基于 v${state.baseVersion}。两份内容都不会丢失。` : undefined"
      >
        <ul class="writing-conflict">
          <li><b>载入最新版本</b>：你的版本保留为本机草稿，可随时从“本机草稿”恢复。</li>
          <li><b>以我的版本保存</b>：生成新的正式稿版本；最新版本的改动不会合并，仍可在版本历史中找回。</li>
        </ul>
        <template #actions>
          <TpButton variant="ghost" @click="conflictOpen = false">稍后处理</TpButton>
          <TpButton variant="outline" :disabled="!!state.operation" @click="saveMine">以我的版本保存</TpButton>
          <TpButton variant="primary" data-autofocus :disabled="!!state.operation" @click="loadLatest">载入最新版本</TpButton>
        </template>
      </TpDialog>
    </template>
  </section>
</template>

<style scoped>
.workspace-writing {
  --outline-width: 0px;
  --outline-gap: 0px;
  --copilot-track: 0px;
  --copilot-gap: 0px;
  position: relative;
  display: grid;
  grid-template-columns: var(--outline-width) var(--outline-gap) minmax(0, 1fr) var(--copilot-gap) var(--copilot-track);
  grid-template-rows: minmax(0, 1fr);
  height: var(--writing-height);
  min-height: 420px;
  transition: grid-template-columns var(--tp-dur-moderate) var(--tp-ease-standard);
}
.workspace-writing.has-outline {
  --outline-width: 200px;
  --outline-gap: 12px;
}
.workspace-writing.has-copilot {
  --copilot-track: var(--copilot-width);
  --copilot-gap: 12px;
}
:global([data-motion="reduced"] .workspace-writing) {
  transition: none;
}
.workspace-writing__sr {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  clip-path: inset(50%);
  overflow: hidden;
}
.workspace-writing__full {
  grid-column: 1 / -1;
  align-self: start;
}
.workspace-writing__outline {
  grid-column: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--tp-radius-m);
}
.workspace-writing__bench {
  grid-column: 3;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: var(--tp-border-w) solid var(--tp-line);
  border-radius: var(--tp-radius-m);
  background: var(--tp-surface-raised);
}
.workspace-writing__copilot {
  grid-column: 5;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

/* 文档栏 */
.writing-docbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 54px;
  padding: 8px 12px 8px 16px;
  border-bottom: 1px solid var(--tp-line);
}
.writing-docbar__icon {
  flex: none;
  min-width: 36px;
  height: 36px;
}
.writing-docbar__title {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}
.writing-docbar__name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--tp-font-display);
  font-weight: var(--tp-display-weight);
  letter-spacing: var(--tp-display-tracking);
  font-size: 16px;
  line-height: 1.35;
  color: var(--tp-text);
}
.writing-docbar__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  min-height: 22px;
}
.writing-docbar__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

/* 提示条 */
.workspace-writing__notices {
  display: grid;
}
.workspace-writing__notices:empty {
  display: none;
}
.writing-notice {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 18px;
  border-bottom: 1px solid var(--tp-line);
  font-size: 13px;
  line-height: 1.6;
}
.writing-notice p {
  flex: 1;
  min-width: 0;
}
.writing-notice__actions {
  display: flex;
  gap: 6px;
  flex: none;
}
.writing-notice.is-warning {
  background: var(--tp-warning-soft);
  color: var(--tp-warning-content);
}
.writing-notice.is-danger {
  background: var(--tp-danger-soft);
  color: var(--tp-danger-content);
}
.writing-notice.is-ghost {
  background: var(--tp-ghost-fill);
  color: var(--tp-text-muted);
}

/* 桌面与纸面 */
.writing-desk {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--tp-surface-sunken);
  overflow: hidden;
}
.writing-desk__paper,
.writing-desk__readonly {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
}
.writing-desk__paper.is-covered {
  visibility: hidden;
}
.writing-desk__readonly {
  z-index: 2;
  background: var(--tp-surface-sunken);
}
.writing-desk :deep(.mo-docs-editor) {
  height: 100%;
}
.writing-desk :deep(.mo-docs-editor__viewport) {
  padding: 20px 18px 56px;
  scrollbar-width: thin;
}
/* 纸面获得键盘焦点时用柔和的内描边，不在写作时一直压一圈强调色。 */
.writing-desk :deep(.mo-docs-editor__viewport:has(.doc-pages:focus-visible)) {
  outline: 2px solid color-mix(in srgb, var(--tp-focus) 38%, transparent);
  outline-offset: -2px;
}
.writing-desk :deep(.doc-paper),
.writing-desk :deep(.doc-sheet) {
  box-shadow: var(--tp-shadow-2);
}
/* 页码由状态栏显示，纸面角标不重复。 */
.writing-desk :deep(.doc-page-label) {
  display: none;
}
.writing-desk__banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--tp-line);
  background: var(--tp-surface);
  color: var(--tp-text-muted);
  font-size: 13px;
}
.writing-desk__banner > :last-child {
  margin-left: auto;
}
.writing-desk__legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.writing-desk__legend i {
  display: inline-block;
  width: 12px;
  height: 10px;
  border-radius: 2px;
}
.writing-desk__legend i.is-removed {
  background: color-mix(in srgb, var(--tp-danger) 30%, transparent);
}
.writing-desk__legend i.is-changed {
  margin-left: 6px;
  background: color-mix(in srgb, var(--tp-warning) 35%, transparent);
}
.writing-desk__state {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  padding: 24px;
  overflow: auto;
}
.writing-desk__error {
  max-width: 36em;
  color: var(--tp-danger);
  font-size: 13px;
  text-align: center;
}
.writing-upgrade {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--tp-line);
  background: var(--tp-surface);
}
.writing-upgrade > div:first-child {
  flex: 1 1 320px;
  display: grid;
  gap: 4px;
}
.writing-upgrade__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.writing-upgrade__error {
  color: var(--tp-danger);
  font-size: 13px;
}
.writing-desk__skeleton {
  position: absolute;
  inset: 0;
  display: grid;
  justify-items: center;
  align-content: start;
  gap: 16px;
  padding: 28px 24px;
}
.writing-desk__sheet {
  display: grid;
  align-content: start;
  gap: 18px;
  width: min(100%, 640px);
  aspect-ratio: 1 / 1.414;
  max-height: calc(var(--writing-height) - 180px);
  padding: 72px 64px;
  background: var(--tp-surface-raised);
  box-shadow: var(--tp-shadow-1);
}
.writing-desk__sheet span {
  height: 10px;
  border-radius: 5px;
  background: var(--tp-surface-sunken);
}
.writing-desk__sheet span:first-child {
  width: 45%;
  height: 16px;
}
.writing-desk__sheet span:nth-child(3) {
  width: 88%;
}
.writing-desk__sheet span:last-child {
  width: 62%;
}
.writing-desk__toast {
  position: absolute;
  z-index: 4;
  left: 50%;
  bottom: 16px;
  translate: -50% 0;
  width: max-content;
  max-width: min(560px, calc(100% - 32px));
  padding: 10px 14px;
  border: var(--tp-border-w) solid var(--tp-outline);
  border-radius: var(--tp-radius-m);
  background: var(--tp-surface-raised);
  box-shadow: var(--tp-shadow-3);
  color: var(--tp-text);
  font-size: 13px;
  line-height: 1.6;
}
.writing-conflict {
  display: grid;
  gap: 8px;
  padding-left: 1.2em;
  list-style: disc;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--tp-text-muted);
}
.writing-conflict b {
  color: var(--tp-text);
}

/* 写作页占满视口：外壳主区底部只留一点间距（任务托盘在窄屏仍需底部空间）。 */
:global(.screens-content.screens-content--write) {
  padding-bottom: 16px;
}
@media (max-width: 600px) {
  :global(.screens-content.screens-content--write) {
    padding-bottom: 80px;
  }
}

@media (max-width: 959px) {
  .workspace-writing {
    display: block;
  }
  .writing-docbar {
    padding: 8px 10px;
    gap: 8px;
  }
  .writing-notice {
    flex-wrap: wrap;
    padding-inline: 12px;
  }
  .writing-notice__actions {
    flex-wrap: wrap;
  }
  .workspace-writing__bench {
    height: 100%;
  }
  .workspace-writing__outline,
  .workspace-writing__copilot {
    position: fixed;
    inset-block: 12px;
    height: auto;
    overscroll-behavior: contain;
    background-color: var(--tp-canvas);
    background-image: linear-gradient(var(--tp-surface-raised), var(--tp-surface-raised));
    box-shadow: var(--tp-shadow-4);
    backdrop-filter: none;
  }
  .workspace-writing__outline {
    inset-inline: 12px auto;
    width: min(300px, calc(100vw - 24px));
  }
  .workspace-writing__copilot {
    inset-inline: auto 12px;
    width: min(440px, calc(100vw - 24px));
    border-radius: var(--tp-radius-l);
    overflow: hidden;
  }
  .workspace-writing__copilot :deep(.writing-copilot) {
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
  .workspace-writing__outline:is(.tp-drawer-enter-from *, .tp-drawer-leave-to *) {
    transform: translateX(calc(-100% - 1.5rem));
  }
  :global([data-motion="reduced"] .workspace-writing__outline:is(.tp-drawer-enter-from *, .tp-drawer-leave-to *)) {
    transform: none;
  }
  .writing-desk :deep(.mo-docs-editor__viewport) {
    padding: 14px 8px 48px;
  }
}
</style>
