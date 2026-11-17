<script setup lang="ts">
import { PhArrowUUpLeft, PhArrowUUpRight, PhClockCounterClockwise, PhList, PhListBullets, PhListNumbers, PhTable, PhTextB, PhX } from "@phosphor-icons/vue";
import { EditorState } from "@tiptap/pm/state";
import { EditorContent, useEditor, type Editor } from "@tiptap/vue-3";
import { useRoute } from "vue-router";
import { useMediaQuery } from "@vueuse/core";
import { computed, onActivated, onDeactivated, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpState from "@/components/ui/TpState.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import WritingDrawer from "@/lab/components/WritingDrawer.vue";
import WritingOutline from "@/lab/components/WritingOutline.vue";
import FormalDocumentControls from "@/lab/components/integration/FormalDocumentControls.vue";
import FormalDocumentHistory from "@/lab/components/integration/FormalDocumentHistory.vue";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { thesisWordCount } from "@/lab/services/libraryService";
import { captureEditor, loadEditor } from "@/lab/state/editorAdapter";
import { createEditorExtensions } from "@/lab/state/editorSchema";
import { createRemoteDocumentController } from "@/lab/state/remoteDocuments";
import { captureSavedAssistantSelection } from "./assistant/assistantSelection";
import WorkspaceAssistantPane from "./assistant/WorkspaceAssistantPane.vue";
import type { CapturedAssistantSelection } from "./assistant/assistantDrafts";
import type { ServiceJobsState } from "@/lab/state/serviceJobs";
import type { BackendServices, ProjectRead } from "@/services";
import { ApiError, asApiError } from "@/services/errors";
import WritingImportPanel from "./writing-import/WritingImportPanel.vue";
import WritingExportPanel from "./writing-export/WritingExportPanel.vue";
import DocumentMaterialImport from "./document-import/DocumentMaterialImport.vue";
import DocumentSourceDetails from "./document-import/DocumentSourceDetails.vue";
import DocumentSourceHistory from "./document-import/DocumentSourceHistory.vue";
import WorkspaceFormatting from "./formatting/WorkspaceFormatting.vue";
import { sourceEditablePaths } from "./document-import/importDraft";
import { createDocumentSourceGuard, sourceDocumentEditAllowed, type SourceGuardPolicy } from "./document-import/sourceGuard";
import { jobRoute } from "./workspaceRoutes";
import "@/lab/screens/screens.css";

type ManuscriptEditor = Parameters<typeof captureEditor>[0] & Pick<Editor, "isEditable">;

const props = withDefaults(
  defineProps<{
    services: BackendServices;
    jobs: ServiceJobsState;
    workspaceId: string;
    project: ProjectRead;
    historyLink?: { source: string; projectId: string; documentId: string; version: string };
    active?: boolean;
  }>(),
  { active: true },
);
const emit = defineEmits<{
  openVersion: [link: { source: string; projectId: string; documentId: string; version: number }];
  closeVersion: [];
  openProjects: [];
}>();

const controller = createRemoteDocumentController(props.services, {
  sourceKey: props.services.sourceKey,
  projectId: props.project.id,
  localProjectId: props.workspaceId,
});
const state = controller.state;
// TMP-OFFICE (wd2 e2e only, never committed)
const tmpOfficeDoc = shallowRef<{ id: string; version: number; snapshot: never } | null>(null);
void fetch(`/api/v1/projects/${props.project.id}/documents/current`, { credentials: "same-origin" })
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => { if (d && d.content.schema_version === 2) tmpOfficeDoc.value = { id: d.id, version: d.version, snapshot: d.content.json as never }; });
const tmpReload = () => window.location.reload();
const route = useRoute();
const assistantStorageKey = "thesispilot.assistant-open.v1:" + JSON.stringify([props.services.sourceKey, props.workspaceId, props.project.id]);
const assistantOpen = ref(false);
try {
  if (typeof window !== "undefined") assistantOpen.value = window.localStorage.getItem(assistantStorageKey) === "open";
} catch {}
const linkedAssistantSession = computed(() => (typeof route.query.assistantSessionId === "string" ? route.query.assistantSessionId : undefined));
const linkedAssistantRun = computed(() => (typeof route.query.assistantRunId === "string" ? route.query.assistantRunId : undefined));
const compact = useMediaQuery("(max-width: 959px)");
const visible = ref(true);
const live = computed(() => props.active && visible.value);
const outlineOpen = ref(false);
const historyOpen = ref(false);
const formattingOpen = ref(false);
const formattingBusy = ref(false);
const showingHistory = computed(() => historyOpen.value || !!props.historyLink);
const ready = ref(false);
const captureError = ref("");
const loadError = ref("");
const cursor = ref(0);
const outlineButton = ref<HTMLButtonElement>();
const historyButton = ref<HTMLButtonElement>();
const lastInspection = ref<{ id: string; version: number }>();
const inspectionError = ref("");
type DocumentSource = Awaited<ReturnType<BackendServices["documentSources"]["current"]>>;
const importOpen = ref(false);
const sourcePhase = ref<"loading" | "free" | "source" | "error">("loading");
const sourceData = shallowRef<DocumentSource>();
const sourcePaths = shallowRef<number[][]>([]);
const sourceError = ref("");
const sourceGuardError = ref("");
let sourceRequest: AbortController | undefined;
let sourceLoadBypass = false;
const jobAction = props.jobs.action;
let loadedRevision = -1;
let chapterToFocus: number | undefined;

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
const editingBlocked = computed(
  () =>
    !live.value ||
    !ready.value ||
    formattingBusy.value ||
    linkError.value ||
    sourcePhase.value === "loading" ||
    sourcePhase.value === "error" ||
    state.operation === "check" ||
    state.operation === "load-latest" ||
    state.operation === "recover",
);
const sourceGuard = createDocumentSourceGuard({
  getPolicy: (): SourceGuardPolicy =>
    sourcePhase.value === "free"
      ? { mode: "free" }
      : sourcePhase.value === "source" && state.document
        ? { mode: "source", baseline: state.document.content.json, editablePaths: sourcePaths.value }
        : { mode: sourcePhase.value === "error" ? "error" : "loading" },
  bypass: () => sourceLoadBypass,
  onReject: (message) => {
    sourceGuardError.value = message;
  },
});
const editor = useEditor({
  extensions: [...createEditorExtensions(), sourceGuard],
  editable: false,
  editorProps: { attributes: { class: "tp-prose", "aria-label": "论文正文编辑区", spellcheck: "false" } },
  onCreate: ({ editor: instance }) => loadSnapshot(instance),
  onUpdate: ({ editor: instance }) => captureEdit(instance),
  onSelectionUpdate: ({ editor: instance }) => {
    cursor.value = instance.state.selection.from;
  },
});
const words = computed(() => thesisWordCount(editor.value?.getHTML() ?? ""));
const status = computed(() => {
  if (captureError.value) return "当前编辑尚未保留";
  if (!state.dirty) return "已保存";
  if (state.operation === "save") return "正在保存正式稿…";
  if (state.draftStatus === "saved") return "草稿已保留";
  if (state.draftStatus === "pending") return "正在保留草稿…";
  return "有未保存的编辑";
});

function loadSnapshot(instance: ManuscriptEditor) {
  if (!live.value || !state.snapshot || state.phase !== "ready" || linkError.value || loadedRevision === state.loadRevision) return;
  try {
    if (sourcePhase.value === "source" && state.document && !sourceDocumentEditAllowed(state.document.content.json, state.snapshot.json, sourcePaths.value))
      throw new Error("当前草稿不符合固定来源保护，已停止载入；原件和服务端正式稿保持不变。");
    sourceLoadBypass = true;
    loadEditor(instance, state.snapshot, { emitUpdate: false });
    instance.view.updateState(EditorState.create({ schema: instance.schema, doc: instance.state.doc, plugins: instance.state.plugins }));
    loadedRevision = state.loadRevision;
    cursor.value = instance.state.selection.from;
    captureError.value = loadError.value = "";
    ready.value = true;
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "暂时无法载入正式稿。";
    ready.value = false;
  } finally {
    sourceLoadBypass = false;
  }
}

async function loadSource() {
  sourceRequest?.abort();
  sourceData.value = undefined;
  sourcePaths.value = [];
  sourceError.value = "";
  sourceGuardError.value = "";
  sourcePhase.value = "loading";
  const document = state.document;
  if (!document || !live.value) return;
  const request = new AbortController();
  sourceRequest = request;
  try {
    const source = await props.services.documentSources.current(props.project.id, document.id, document.version, request.signal);
    if (request.signal.aborted) return;
    const paths = sourceEditablePaths(source);
    if (!paths) throw new ApiError("INVALID_RESPONSE");
    sourceData.value = source;
    sourcePaths.value = paths;
    if (state.snapshot && !sourceDocumentEditAllowed(document.content.json, state.snapshot.json, paths)) {
      sourcePhase.value = "error";
      sourceError.value = "当前草稿与来源保护映射不匹配，正文保持只读；请保留草稿后核查已保存版本。";
      return;
    }
    sourcePhase.value = "source";
  } catch (problem) {
    if (request.signal.aborted) return;
    const issue = asApiError(problem);
    if (issue.code === "DOCUMENT_SOURCE_NOT_FOUND") sourcePhase.value = "free";
    else {
      sourcePhase.value = "error";
      sourceError.value = `来源保护尚未核对，正文保持只读。${issue.message}`;
    }
  }
}
async function imported() {
  importOpen.value = false;
  await controller.load();
}

function captureEdit(instance: ManuscriptEditor): boolean {
  if (editingBlocked.value || !instance.isEditable) return false;
  try {
    if (!controller.edit(captureEditor(instance))) throw new Error(state.error || "暂时无法保留草稿。");
    captureError.value = "";
    sourceGuardError.value = "";
    return true;
  } catch (error) {
    captureError.value = error instanceof Error ? error.message : "暂时无法保留草稿。";
    return false;
  }
}

function retryEditor() {
  if (!editor.value) return;
  if (ready.value) captureEdit(editor.value);
  else loadSnapshot(editor.value);
}

function save() {
  const instance = editor.value;
  if (!instance || editingBlocked.value || state.operation || !state.dirty || state.issue) return;
  if (captureEdit(instance)) void controller.save();
}

function openVersion(version: number) {
  if (!live.value || !state.document) return;
  emit("openVersion", { source: props.services.sourceKey, projectId: props.project.id, documentId: state.document.id, version });
}

async function inspectDocument() {
  const saved = state.document;
  if (!live.value || !saved || state.operation || jobAction.value) return;
  const { id, version } = saved;
  inspectionError.value = "";
  const accepted = await props.jobs.inspectDocument(id, version);
  if (!live.value) return;
  if (accepted) lastInspection.value = { id: accepted.id, version };
  else inspectionError.value = props.jobs.actionError.value;
}

function toggleHistory() {
  if (showingHistory.value) closeHistory();
  else {
    assistantOpen.value = false;
    historyOpen.value = true;
  }
}

function openAssistant() {
  closeHistory();
  assistantOpen.value = true;
}
const assistantEligible = computed(
  () => !!state.document && state.phase === "ready" && !state.dirty && !state.issue && !state.operation && !editingBlocked.value,
);
function captureAssistantSelection(): CapturedAssistantSelection {
  const document = state.document;
  const instance = editor.value;
  if (!document || !instance || !assistantEligible.value) throw new Error("请先保存当前正式稿，待来源核对完成后重新选择文字。");
  return captureSavedAssistantSelection(instance.state.doc, instance.state.selection.from, instance.state.selection.to, document.id, document.version);
}

function closeHistory() {
  historyOpen.value = false;
  if (props.historyLink) emit("closeVersion");
}

function selectChapter(position: number) {
  if (compact.value) {
    chapterToFocus = position;
    outlineOpen.value = false;
  } else moveToChapter(position);
}

function moveToChapter(position: number) {
  editor.value?.chain().focus().setTextSelection(position).scrollIntoView().run();
}

function outlineClosed() {
  if (!live.value) return;
  if (chapterToFocus === undefined) outlineButton.value?.focus();
  else moveToChapter(chapterToFocus);
  chapterToFocus = undefined;
}

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
watch([editor, () => state.loadRevision, linkError, live], ([instance]) => {
  if (instance) loadSnapshot(instance);
});
watch([editor, editingBlocked], ([instance, blocked]) => instance?.setEditable(!blocked, false), { flush: "sync" });
watch(assistantOpen, (value) => {
  try {
    window.localStorage.setItem(assistantStorageKey, value ? "open" : "closed");
  } catch {}
});
watch(
  [linkedAssistantRun, linkedAssistantSession],
  ([run, session]) => {
    if (run || session) openAssistant();
  },
  { immediate: true },
);
watch(
  () => [state.document?.id, state.document?.version, live.value],
  () => void loadSource(),
  { immediate: true, flush: "sync" },
);
onActivated(() => (visible.value = true));
onDeactivated(() => {
  visible.value = false;
  outlineOpen.value = false;
  chapterToFocus = undefined;
});
onScopeDispose(controller.dispose);
onScopeDispose(() => sourceRequest?.abort());
</script>

<template>
  <section v-if="live" class="screen-page workspace-writing" @keydown.ctrl.s.prevent="save" @keydown.meta.s.prevent="save">
    <h1 class="workspace-writing__title">论文写作台</h1>
    <TpState v-if="linkError" kind="error" title="无法打开版本链接" desc="这个链接与当前服务、项目或正文不匹配，或版本号无效。">
      <div class="screen-actions">
        <TpButton variant="primary" @click="emit('closeVersion')">返回写作</TpButton>
        <TpButton variant="ghost" @click="emit('openProjects')">查看项目</TpButton>
      </div>
    </TpState>
    <template v-else>
      <div class="workspace-writing__controls">
        <FormalDocumentControls :controller="controller" :editor-blocked="!ready || !!captureError || !!loadError" @save="save" />
        <div v-if="state.document" class="workspace-writing__status">
          <TpVersion :v="state.document.version" prefix="正式稿 " />
          <span class="tp-caption" role="status">{{ status }}</span>
          <TpButton size="sm" :aria-expanded="formattingOpen" @click="formattingOpen = !formattingOpen">安全格式</TpButton>
          <TpButton size="sm" :aria-expanded="assistantOpen" @click="assistantOpen ? (assistantOpen = false) : openAssistant()">内容助手</TpButton>
          <TpButton
            size="sm"
            variant="outline"
            :loading="jobAction?.type === 'inspect-document'"
            :disabled="!!jobAction || !!state.operation"
            @click="inspectDocument"
            >检查正文结构</TpButton
          >
        </div>
      </div>
      <div class="tmp-office-panels" data-tmp-office style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin:12px 0">
        <WritingImportPanel :services="services" :project="project" :document="tmpOfficeDoc" :selection="null" :eligible="!state.dirty" @changed="tmpReload" />
        <WritingExportPanel :services="services" :project="project" :document="tmpOfficeDoc" :selection="null" :eligible="!state.dirty" />
      </div>
      <div v-if="state.phase === 'empty' && !importOpen" class="screen-actions">
        <TpButton :disabled="!!state.operation" @click="importOpen = true">从资料导入</TpButton>
      </div>
      <Transition name="tp-swap" v-bind="panelMotionHooks"
        ><DocumentMaterialImport
          v-if="importOpen && !state.document"
          :services="services"
          :project-id="project.id"
          :disabled="state.phase !== 'empty' || !!state.operation"
          @close="importOpen = false"
          @imported="imported"
          @check-current="controller.load()"
      /></Transition>
      <WorkspaceFormatting
        v-if="state.document"
        :key="state.document.id"
        :services="services"
        :project-id="project.id"
        :document-id="state.document.id"
        :version="state.document.version"
        :eligible="assistantEligible && !showingHistory"
        :open="formattingOpen"
        @close="formattingOpen = false"
        @busy="formattingBusy = $event"
        @changed="controller.load()"
        @history="toggleHistory"
      />
      <DocumentSourceDetails
        v-if="state.document"
        :services="services"
        :project-id="project.id"
        :source="sourceData"
        :version="state.document.version"
        :loading="sourcePhase === 'loading'"
        :missing="sourcePhase === 'free'"
        :error="sourceError"
        @retry="loadSource"
      />
      <Transition name="tp-swap" v-bind="panelMotionHooks"
        ><p v-if="sourceGuardError" :key="sourceGuardError" role="alert" class="studio-notice">{{ sourceGuardError }}</p></Transition
      >
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <p v-if="inspectionError" key="inspection-error" class="studio-notice" role="alert">{{ inspectionError }}</p>
        <div v-else-if="lastInspection" :key="lastInspection.id" class="workspace-writing__inspection">
          <RouterLink :to="jobRoute(project.id, lastInspection.id, services.sourceKey)" class="studio-link">
            查看正式稿 v{{ lastInspection.version }} 的结构检查
          </RouterLink>
        </div>
      </Transition>
      <Transition name="tp-swap" v-bind="panelMotionHooks">
        <p v-if="captureError || loadError" class="studio-notice" role="alert">
          {{ captureError || loadError }}
          <TpButton size="sm" variant="outline" @click="retryEditor">重试</TpButton>
        </p>
      </Transition>
      <div
        v-if="state.phase === 'ready'"
        class="workspace-writing__layout"
        :class="{ 'has-history': showingHistory, 'has-assistant': assistantOpen && !showingHistory }"
      >
        <WritingDrawer :compact="compact" :open="outlineOpen" label="章节目录" @dismiss="outlineOpen = false" @closed="outlineClosed">
          <aside class="tp-drawer workspace-writing__outline" aria-label="章节目录">
            <WritingOutline
              :doc="editor?.state.doc"
              :cursor="cursor"
              :title="project.name"
              :version="state.baseVersion ?? 0"
              :words="words"
              :compact="compact"
              @select="selectChapter"
              @close="outlineOpen = false"
            />
          </aside>
        </WritingDrawer>
        <div class="tp-paper workspace-writing__paper">
          <div class="tp-toolbar workspace-writing__toolbar" role="toolbar" aria-label="正文格式">
            <button v-if="compact" ref="outlineButton" class="tp-tool" type="button" aria-label="打开章节目录" @click="outlineOpen = true">
              <TpIcon :icon="PhList" />
            </button>
            <button
              class="tp-tool"
              type="button"
              aria-label="撤销编辑"
              :disabled="editingBlocked || !editor?.can().undo()"
              @click="editor?.chain().focus().undo().run()"
            >
              <TpIcon :icon="PhArrowUUpLeft" />
            </button>
            <button
              class="tp-tool"
              type="button"
              aria-label="重做编辑"
              :disabled="editingBlocked || !editor?.can().redo()"
              @click="editor?.chain().focus().redo().run()"
            >
              <TpIcon :icon="PhArrowUUpRight" />
            </button>
            <span class="tp-tool-sep" />
            <button
              v-for="level in [1, 2, 3] as const"
              :key="level"
              class="tp-tool"
              type="button"
              :aria-label="level + ' 级标题'"
              :aria-pressed="editor?.isActive('heading', { level })"
              :disabled="editingBlocked || sourcePhase === 'source'"
              @click="editor?.chain().focus().toggleHeading({ level }).run()"
            >
              H{{ level }}
            </button>
            <button
              class="tp-tool"
              type="button"
              aria-label="加粗"
              :aria-pressed="editor?.isActive('bold')"
              :disabled="editingBlocked || sourcePhase === 'source'"
              @click="editor?.chain().focus().toggleBold().run()"
            >
              <TpIcon :icon="PhTextB" />
            </button>
            <button
              class="tp-tool"
              type="button"
              aria-label="无序列表"
              :aria-pressed="editor?.isActive('bulletList')"
              :disabled="editingBlocked || sourcePhase === 'source'"
              @click="editor?.chain().focus().toggleBulletList().run()"
            >
              <TpIcon :icon="PhListBullets" />
            </button>
            <button
              class="tp-tool"
              type="button"
              aria-label="有序列表"
              :aria-pressed="editor?.isActive('orderedList')"
              :disabled="editingBlocked || sourcePhase === 'source'"
              @click="editor?.chain().focus().toggleOrderedList().run()"
            >
              <TpIcon :icon="PhListNumbers" />
            </button>
            <button
              class="tp-tool"
              type="button"
              aria-label="插入表格"
              :disabled="editingBlocked || sourcePhase === 'source'"
              @click="editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()"
            >
              <TpIcon :icon="PhTable" />
            </button>
            <span class="workspace-writing__spacer" />
            <button ref="historyButton" class="tp-tool" type="button" aria-label="版本历史" :aria-expanded="showingHistory" @click="toggleHistory">
              <TpIcon :icon="PhClockCounterClockwise" />
            </button>
          </div>
          <EditorContent :editor="editor" class="workspace-writing__editor" />
        </div>
        <WritingDrawer :compact="compact" :open="showingHistory" label="版本历史" @dismiss="closeHistory" @closed="live && historyButton?.focus()">
          <Transition name="tp-swap" v-bind="panelMotionHooks">
            <aside v-if="showingHistory" class="tp-drawer workspace-writing__history" aria-label="版本历史">
              <div class="workspace-writing__history-head">
                <h2 class="tp-subheading">版本历史</h2>
                <TpButton class="workspace-writing__close" variant="ghost" icon-only label="关闭版本历史" data-drawer-close @click="closeHistory">
                  <TpIcon :icon="PhX" :size="18" />
                </TpButton>
              </div>
              <FormalDocumentHistory
                :controller="controller"
                :services="services"
                :project-id="project.id"
                :requested-version="requestedVersion"
                linked
                @compare="openVersion"
                @close="emit('closeVersion')"
              />
              <DocumentSourceHistory
                v-if="requestedVersion && state.document"
                :services="services"
                :project-id="project.id"
                :document-id="state.document.id"
                :version="requestedVersion"
              />
            </aside>
          </Transition>
        </WritingDrawer>
        <WorkspaceAssistantPane
          v-if="assistantOpen && !showingHistory && state.document"
          class="workspace-writing__assistant"
          :services="services"
          :project-id="project.id"
          :workspace-id="workspaceId"
          :current-version="state.document.version"
          :eligible="assistantEligible"
          :capture-selection="captureAssistantSelection"
          :initial-session-id="linkedAssistantSession"
          :initial-run-id="linkedAssistantRun"
          @close="assistantOpen = false"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.workspace-writing {
  gap: 16px;
}
.workspace-writing__title {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  clip-path: inset(50%);
  overflow: hidden;
}
.workspace-writing__controls {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.workspace-writing__status {
  display: flex;
  align-items: center;
  align-self: flex-start;
  gap: 12px;
  padding-block: 6px;
}
.workspace-writing__layout {
  display: grid;
  grid-template-columns: 208px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.workspace-writing__layout.has-history {
  grid-template-columns: minmax(150px, 208px) minmax(0, 1fr) minmax(260px, 34%);
}
.workspace-writing__layout.has-assistant {
  grid-template-columns: 160px minmax(360px, 1fr) minmax(420px, 48%);
}
.workspace-writing__assistant {
  max-height: calc(100dvh - 150px);
  overflow: auto;
  padding-right: 2px;
}
@media (min-width: 960px) and (max-width: 1279px) {
  .workspace-writing__layout.has-assistant {
    grid-template-columns: 160px minmax(0, 1fr);
  }
  .workspace-writing__assistant {
    grid-column: 1/-1;
    max-height: none;
  }
}
.workspace-writing__outline,
.workspace-writing__history {
  position: static;
  width: auto;
  min-width: 0;
  max-width: none;
  min-height: 0;
  max-height: none;
  border: 1px solid var(--tp-line-strong);
  border-radius: var(--tp-radius-m);
  box-shadow: var(--tp-shadow-1);
}
.workspace-writing__history {
  display: grid;
  align-content: start;
  gap: 16px;
  padding: 16px;
}
.workspace-writing__history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.workspace-writing__close {
  flex: none;
  min-inline-size: 36px;
  min-block-size: 36px;
}
.workspace-writing__paper {
  min-width: 0;
  min-height: 620px;
  overflow: hidden;
  border: 1px solid var(--tp-line-strong);
  box-shadow: var(--tp-shadow-2);
}
.workspace-writing__toolbar {
  flex-wrap: wrap;
  gap: 3px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--tp-line);
}
.workspace-writing__spacer {
  flex: 1;
}
.workspace-writing__editor {
  padding: 18px 36px 32px;
  overflow-x: auto;
}
.workspace-writing__editor :deep(.tiptap) {
  min-height: 500px;
  outline: none;
  overflow-wrap: anywhere;
}
.workspace-writing__editor :deep(.tp-prose) {
  max-width: 44em;
  margin: auto;
  font-size: 17px;
  line-height: 2;
}
.workspace-writing__editor :deep(.write-locked) {
  background: var(--tp-warning-soft);
  border-bottom: 2px solid var(--tp-warning);
}
@media (max-width: 959px) {
  .workspace-writing__layout,
  .workspace-writing__layout.has-history {
    display: block;
  }
  .workspace-writing__outline,
  .workspace-writing__history {
    position: fixed;
    inset-block: 12px;
    overscroll-behavior: contain;
    background-color: var(--tp-canvas);
    background-image: linear-gradient(var(--tp-surface-raised), var(--tp-surface-raised));
    box-shadow: var(--tp-shadow-4);
    backdrop-filter: none;
  }
  .workspace-writing__outline {
    inset-inline: 12px auto;
    width: min(300px, calc(100vw - 24px));
    overflow: hidden;
  }
  .workspace-writing__history {
    inset-inline: auto 12px;
    width: min(440px, calc(100vw - 24px));
    overflow: auto;
  }
  .workspace-writing__outline:is(.tp-drawer-enter-from *, .tp-drawer-leave-to *) {
    transform: translateX(calc(-100% - 1.5rem));
  }
  :global([data-motion="reduced"] .workspace-writing__outline:is(.tp-drawer-enter-from *, .tp-drawer-leave-to *)) {
    transform: none;
  }
  .workspace-writing__editor {
    padding: 22px;
  }
  .workspace-writing__editor :deep(.tp-prose) {
    font-size: 16px;
  }
}
</style>
