<script setup lang="ts">
import { listMotionHooks } from "@/design/motion";

import { computed, nextTick, onActivated, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, RouterLink } from "vue-router";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, Extension, Mark, useEditor } from "@tiptap/vue-3";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  PhArrowUUpLeft,
  PhArrowUUpRight,
  PhListBullets,
  PhLockKey,
  PhSparkle,
  PhTable,
  PhTextB,
  PhClockCounterClockwise,
  PhExport,
  PhUploadSimple,
  PhSlidersHorizontal,
  PhSidebarSimple,
  PhX,
} from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpTabs from "@/components/ui/TpTabs.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpState from "@/components/ui/TpState.vue";
import ContextScope, { type ScopeItem } from "@/components/domain/ContextScope.vue";
import RevisionCard from "@/components/domain/RevisionCard.vue";
import VersionTimeline from "@/components/domain/VersionTimeline.vue";
import AssistantComposer from "@/components/domain/AssistantComposer.vue";
import type { AgentKind, HunkDecision, VersionView } from "@/domain/types";
import { agents } from "@/domain/vocab";
import { usePreviewModule, usePreviewWorkspaceStore } from "../state/previewWorkspace";
import { allChecksPass, textToHtml, validateTextPatches, validateCitationAppend, type TextPatch } from "../state/writingGuards";
import {
  archiveWritingCandidate,
  copyWritingValue,
  emptyWritingContext,
  type WritingState,
  type WritingSession as Session,
  type WritingRequest,
  type WritingRevision,
  type WritingSource,
} from "../state/writingState";
import { boundLibraryRequirements, libraryLiteratureSnapshot, useLibraryState } from "../state/libraryState";
import { usePlanState } from "../state/planState";
import WritingOutline from "../components/WritingOutline.vue";
import { StableChapterIds, collectChapters, captureEditor } from "../state/editorAdapter";
import { assistantPreview, prepareTextPatches, captureFormatIntent, reconcileWritingContext, citationSourcesCurrent } from "../services/writingAssistant";
import { captureWritingConstraints, writingConstraintBasis, writingConstraintAdvice } from "../services/writingConstraints";
import { thesisWordCount } from "../services/libraryService";
import { captureBusinessConfig, useSettingsState } from "../state/settingsState";
import { startProjectJob } from "../state/jobState";

const workspace = usePreviewWorkspaceStore();
const library = useLibraryState();
const plan = usePlanState();
const settings = useSettingsState();
const route = useRoute();
const projectId = workspace.current.id;
const agentKinds: AgentKind[] = ["general", "lit", "content", "format", "progress", "review"];
const state = usePreviewModule<WritingState>("writing", () => ({
  sessions: agentKinds.map((kind) => ({ kind, draft: "", messages: [], status: "idle", error: "", lastPrompt: "", context: emptyWritingContext(), steps: [] })),
  selectedAgent: "content",
  companion: "lit",
  multi: false,
  materialIds: [],
  decisions: [],
  candidate: null,
  patches: [],
  beforeHtml: "",
  selection: { from: 0, to: 0, text: "", valid: false },
  goal: "表达更清楚，保留事实与引用",
  replacement: "",
  history: [],
  revisionKind: "text",
}));
const panel = ref<"assistant" | "revision" | "history" | "objects">("assistant");
const mobileView = ref("paper");
const cursor = ref(1);
const includeChapter = ref(true);
const copilotCollapsed = ref(false);
const copilotWidth = ref(392);
const bubble = ref<{ top: number; left: number } | null>(null);
const selectedHistory = ref<WritingRevision | null>(null);
const partialNext = ref(false);
const candidateFailure = ref("");
const candidateScenario = ref("normal");
const formatChanges = computed({
  get: () => state.value.formatChanges ?? [],
  set: (items) => {
    state.value.formatChanges = items;
  },
});
const expertKinds: AgentKind[] = ["content", "lit", "format", "progress", "review"];
const lastExpert = ref<AgentKind>(state.value.selectedAgent === "general" ? "content" : state.value.selectedAgent);
const agentMode = computed({
  get: () => (state.value.selectedAgent === "general" ? "general" : "expert"),
  set: (mode: string) => {
    state.value.selectedAgent = mode === "general" ? "general" : lastExpert.value;
  },
});
function openPanel(value: typeof panel.value) {
  panel.value = value;
  copilotCollapsed.value = false;
  mobileView.value = "assistant";
}
function suspendSessionInteractions(element: Element) {
  element.setAttribute("inert", "");
  element.setAttribute("aria-hidden", "true");
}
function restoreSessionInteractions(element: Element) {
  element.removeAttribute("inert");
  element.removeAttribute("aria-hidden");
}
const ownedState = state.value;
for (const session of ownedState.sessions) {
  session.context ??= emptyWritingContext();
  session.steps ??= [];
  if (session.status === "running") session.status = "cancelled";
}
ownedState.history ??= [];
if (ownedState.candidate?.status === "generating") ownedState.candidate.status = "cancelled";
const boundRequirements = computed(() => boundLibraryRequirements(library.value, workspace.current.requirementVersion));
const requirementLabel = computed(() => (workspace.current.requirementVersion > 0 ? `要求 v${workspace.current.requirementVersion}` : "要求未绑定"));
const templateLabel = computed(() => (workspace.current.templateVersion > 0 ? `模板 v${workspace.current.templateVersion}` : "模板未绑定"));
const scopeOpen = ref(false);
const notice = ref("");
const objectNotice = ref("");
const importedText = ref("");
const importName = ref("");
const compareVersion = ref<number | null>(null);
const restoreTarget = ref<number | null>(null);
const failNext = ref(false);
let mutationCause = "手动编辑";
let applying = false;
let generation = 0;
let generationTimer: ReturnType<typeof setTimeout> | undefined;
const sessionTokens = new Map<AgentKind, number>();
const sessionTimers = new Map<AgentKind, ReturnType<typeof setTimeout>>();
const sessionJobs = new Map<AgentKind, ReturnType<typeof startProjectJob>>();
let revisionJob: ReturnType<typeof startProjectJob> | undefined;
const HeadingFormat = Extension.create({
  name: "safeHeadingFormat",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          templateAlign: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-template-align"),
            renderHTML: (attrs: Record<string, unknown>) =>
              ["left", "center"].includes(String(attrs.templateAlign))
                ? { "data-template-align": attrs.templateAlign, style: `text-align:${attrs.templateAlign}` }
                : {},
          },
          templateWeight: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-template-weight"),
            renderHTML: (attrs: Record<string, unknown>) =>
              ["600", "700"].includes(String(attrs.templateWeight))
                ? { "data-template-weight": attrs.templateWeight, style: `font-weight:${attrs.templateWeight}` }
                : {},
          },
        },
      },
    ];
  },
});
const AiLock = Mark.create({
  name: "aiLock",
  parseHTML: () => [{ tag: 'span[data-ai-lock="true"]' }],
  renderHTML: () => ["span", { "data-ai-lock": "true", class: "write-locked", title: "AI 锁定；本人仍可手动编辑" }, 0],
});
const AutomaticProtection = Extension.create({
  name: "writingProtectionMarks",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("writing-protection"),
        props: {
          decorations(editorState) {
            const marks: Decoration[] = [];
            editorState.doc.descendants((node, position) => {
              if (!node.isText || !node.text) return;
              for (const match of node.text.matchAll(/\[[^\]\r\n]+\]|[-+−]?\p{N}+(?:[.,]\p{N}+)*(?:[eE][-+−]?\p{N}+)?(?:\s*[%％])?/gu)) {
                const from = position + (match.index ?? 0);
                marks.push(
                  Decoration.inline(from, from + match[0].length, { class: "tp-protect", "data-kind": match[0].startsWith("[") ? "citation" : "number" }),
                );
              }
            });
            const c = state.value.candidate;
            if (c && c.status === "pending" && c.baseVersion === workspace.current.document.version && state.value.revisionKind !== "format") {
              for (const patch of state.value.patches) {
                const hunk = c.hunks.find((h) => h.id === patch.id);
                if (hunk?.decision === "rejected" || patch.to > editorState.doc.content.size) continue;
                marks.push(Decoration.inline(patch.from, patch.to, { class: "write-diff-before", title: "待审阅原文，尚未修改" }));
                marks.push(
                  Decoration.widget(
                    patch.to,
                    () => {
                      const span = document.createElement("span");
                      span.className = "write-diff-after";
                      span.textContent = patch.after;
                      span.setAttribute("contenteditable", "false");
                      span.setAttribute("aria-label", "候选文字，尚未写入：" + patch.after);
                      return span;
                    },
                    { key: c.id + patch.id + hunk?.decision },
                  ),
                );
              }
            }
            return DecorationSet.create(editorState.doc, marks);
          },
        },
      }),
    ];
  },
});
const editor = useEditor({
  extensions: [StarterKit, TableKit.configure({ table: { resizable: false } }), AiLock, AutomaticProtection, StableChapterIds, HeadingFormat],
  content: workspace.current.document.html,
  editorProps: { attributes: { class: "tp-prose", "aria-label": "论文正文编辑区", spellcheck: "false" } },
  onUpdate: ({ editor: e }) => {
    if (workspace.current.id !== projectId) return;
    workspace.saveDocument(e.getHTML(), mutationCause, captureEditor(e));
    mutationCause = "手动编辑";
    if (!applying && state.value.candidate && ["pending", "invalid", "generating"].includes(state.value.candidate.status)) {
      state.value.candidate.status = "expired";
      state.value.candidate.currentVersion = workspace.current.document.version;
      generation++;
      archiveWritingCandidate(state.value);
    }
    updateSelection();
  },
  onSelectionUpdate: () => updateSelection(),
});
function updateSelection() {
  const e = editor.value;
  if (!e) return;
  const { from, to, $from, $to, empty } = e.state.selection;
  cursor.value = from;
  let supportedInline = true;
  let marks: string | undefined;
  if (!empty)
    e.state.doc.nodesBetween(from, to, (node) => {
      if (!node.isInline) return;
      if (!node.isText) supportedInline = false;
      const signature = JSON.stringify(node.marks.map((mark) => [mark.type.name, mark.attrs]));
      if (marks !== undefined && marks !== signature) supportedInline = false;
      marks = signature;
    });
  state.value.selection = {
    from,
    to,
    text: empty ? "" : e.state.doc.textBetween(from, to, "\n"),
    valid: !empty && $from.sameParent($to) && $from.parent.isTextblock && supportedInline,
  };
  const session = state.value.sessions.find((x) => x.kind === state.value.selectedAgent);
  if (session?.context) {
    session.context.selection = copyWritingValue(state.value.selection);
    session.context.selectionVersion = workspace.current.document.version;
    const chapter = collectChapters(e.state.doc)
      .filter((entry) => entry.title !== workspace.current.title && entry.position < from)
      .at(-1);
    session.context.chapter = chapter ? { id: chapter.id, title: chapter.title } : undefined;
  }
  if (!empty && e.isFocused) {
    const rect = e.view.coordsAtPos(from);
    bubble.value = { top: Math.max(70, rect.top - 44), left: Math.min(window.innerWidth - 238, Math.max(12, rect.left)) };
  } else bubble.value = null;
}
const currentSession = computed(() => state.value.sessions.find((s) => s.kind === state.value.selectedAgent)!);
const visibleSessions = computed(() =>
  state.value.multi ? state.value.sessions.filter((s) => s.kind === state.value.selectedAgent || s.kind === state.value.companion) : [currentSession.value],
);
const words = computed(() => thesisWordCount(workspace.current.document.html));
const chapters = computed(() => collectChapters(editor.value?.state.doc));
const currentChapter = computed(() => {
  const actual = chapters.value.filter((entry) => entry.title !== workspace.current.title);
  return actual.filter((entry) => entry.position < cursor.value).at(-1) ?? actual[0];
});
const nextTask = computed(() => plan.value.tasks.filter((task) => task.status !== "confirmed").sort((a, b) => a.deadline.localeCompare(b.deadline))[0]);
const scope = computed<ScopeItem[]>(() => [
  { id: "version", kind: "version", label: `正文 v${workspace.current.document.version}`, fixed: true },
  ...(includeChapter.value && currentChapter.value ? [{ id: "chapter", kind: "chapter" as const, label: currentChapter.value.title }] : []),
  ...(state.value.selection.text ? [{ id: "selection", kind: "selection" as const, label: `选区 ${state.value.selection.text.length} 字` }] : []),
  ...state.value.materialIds.map((id) => {
    const material = library.value.materials.find((m) => m.id === id);
    const literature = library.value.literature.find((l) => l.id === id);
    return {
      id,
      kind: "material" as const,
      label: material
        ? `${material.name} v${material.version}`
        : literature
          ? `${literature.title} · ${literature.coverage.fulltext ? "全文节选" : literature.coverage.abstract ? "摘要" : "题录"}`
          : `${id} · 来源不可用`,
    };
  }),
]);
const versions = computed<VersionView[]>(() =>
  [...workspace.current.document.history].reverse().map((v) => ({
    v: v.version,
    at: v.at,
    summary: v.cause,
    cause: v.cause.includes("采纳") ? "adopt" : v.cause.includes("恢复") ? "restore" : v.cause.includes("导入") ? "import" : "manual",
    words: v.html.replace(/<[^>]*>/g, "").length,
    current: v.version === workspace.current.document.version,
  })),
);
const comparison = computed(() => workspace.current.document.history.find((v) => v.version === compareVersion.value));
const plain = (html: string) => {
  const element = document.createElement("template");
  element.innerHTML = html;
  return element.content.textContent ?? "";
};

function selectParagraph() {
  const e = editor.value;
  if (!e) return;
  const { $from } = e.state.selection;
  if (!$from.parent.isTextblock || !$from.parent.textContent) {
    notice.value = "请先把光标放在有文字的段落里。";
    return;
  }
  e.chain().focus().setTextSelection({ from: $from.start(), to: $from.end() }).run();
}
function locate(position: number) {
  includeChapter.value = true;
  mobileView.value = "paper";
  editor.value
    ?.chain()
    .focus()
    .setTextSelection(position + 1)
    .scrollIntoView()
    .run();
}
function locked(from: number, to: number) {
  let found = false;
  if (!editor.value || from < 0 || to > editor.value.state.doc.content.size) return true;
  editor.value.state.doc.nodesBetween(from, to, (node) => {
    if (node.marks.some((mark) => mark.type.name === "aiLock")) found = true;
  });
  return found;
}
function checksFor(patches: TextPatch[]) {
  const c = state.value.candidate;
  const s = state.value.selection;
  const from = c ? Number(c.id.split(":")[1]) : s.from;
  let context = { from: 0, text: "" };
  let unsupported = !editor.value;
  try {
    const start = editor.value!.state.doc.resolve(from);
    context = { from: start.start(), text: start.parent.textBetween(0, start.parent.content.size, "", "\ufffc") };
    unsupported = !start.parent.isTextblock;
  } catch {
    unsupported = true;
  }
  const input = {
    baseVersion: c?.baseVersion ?? workspace.current.document.version,
    currentVersion: workspace.current.document.version,
    selectionFrom: from,
    selectionTo: c ? Number(c.id.split(":")[2]) : s.to,
    patches,
    context,
    textAt: (from: number, to: number) => {
      try {
        return editor.value?.state.doc.textBetween(from, to, "\n") ?? "";
      } catch {
        return "";
      }
    },
    locked,
    unsupported: unsupported || (c ? c.scope.includes("不支持") : !s.valid),
  };
  if (state.value.revisionKind === "citation") {
    const sources = state.value.request?.sources ?? [];
    const verified = citationSourcesCurrent(
      sources,
      library.value.literature.flatMap((item) => {
        const snapshot = libraryLiteratureSnapshot(item);
        return snapshot ? [snapshot] : [];
      }),
    );
    return validateCitationAppend(input, state.value.citationText ?? "", verified);
  }
  return validateTextPatches(input);
}
function saveContext(session: Session) {
  session.context = copyWritingValue({
    materialIds: state.value.materialIds,
    selection: state.value.selection,
    goal: state.value.goal,
    replacement: state.value.replacement,
    includeChapter: includeChapter.value,
    selectionVersion: session.context?.selectionVersion,
    chapter: session.context?.chapter,
  });
}
function sourceSnapshot(ids: string[]): WritingSource[] {
  return ids.map((id) => {
    const fixed = library.value.contextSources?.find((source) => source.id === id);
    if (fixed) {
      const material = library.value.materials.find((item) => item.id === id && !item.removed);
      const literature = library.value.literature.find((item) => item.id === id);
      if (fixed.verify !== "verified" || (!material && literature?.verify !== "verified")) throw new Error("固定来源已不可用，请重新核实后选择。");
      if (material && !material.versions.some((version) => version.version === fixed.version)) throw new Error("固定资料版本不可用，请重新选择。");
      return {
        id,
        version: fixed.version,
        title: fixed.title,
        text: fixed.text,
        verify: fixed.verify,
        coverage: fixed.position || (fixed.coverage.fulltext ? "全文节选" : fixed.coverage.abstract ? "摘要" : "题录"),
      };
    }
    const material = library.value.materials.find((item) => item.id === id && !item.removed);
    if (material) {
      const version = material.versions.find((v) => v.version === material.version);
      if (!version) throw new Error("资料版本不可用，请重新选择来源。");
      return { id, version: material.version, title: material.name, text: version.extracted, verify: "provided", coverage: "已取得提取文本" };
    }
    const item = library.value.literature.find((entry) => entry.id === id);
    if (!item || item.verify !== "verified") throw new Error("来源尚未核实，不能用于提问或引用；请先在资料空间补充核验。");
    const snapshot = libraryLiteratureSnapshot(item);
    if (!snapshot) throw new Error("来源题录缺失，请补充核实后重新选择。");
    return {
      id,
      version: item.version ?? 1,
      title: item.title,
      text: snapshot.text,
      verify: item.verify,
      coverage: item.fullText ? "全文节选" : item.abstractText ? "摘要" : "题录",
    };
  });
}
function captureRequest(session: Session, prompt: string): WritingRequest {
  if (session.kind === state.value.selectedAgent) saveContext(session);
  const ctx = reconcileWritingContext(
    session.context ?? emptyWritingContext(),
    workspace.current.document.version,
    (from, to) => {
      try {
        return editor.value?.state.doc.textBetween(from, to, "\n") ?? "";
      } catch {
        return "";
      }
    },
    (position) => {
      const chapter = chapters.value.filter((entry) => entry.title !== workspace.current.title && entry.position < position).at(-1);
      return chapter ? { id: chapter.id, title: chapter.title } : undefined;
    },
  );
  session.context = copyWritingValue(ctx);
  const config = captureBusinessConfig(settings.value, session.kind);
  if (config.errors.length) throw new Error(config.errors.join("；"));
  return copyWritingValue({
    id: crypto.randomUUID(),
    projectId,
    agent: session.kind,
    prompt,
    version: workspace.current.document.version,
    requirementVersion: workspace.current.requirementVersion,
    templateVersion: workspace.current.templateVersion,
    constraints: captureWritingConstraints(library.value, {
      requirementVersion: workspace.current.requirementVersion,
      templateVersion: workspace.current.templateVersion,
      documentVersion: workspace.current.document.version,
      html: workspace.current.document.html,
    }),
    chapter: ctx.includeChapter ? (ctx.chapter?.title ?? "") : "",
    chapterId: ctx.includeChapter ? ctx.chapter?.id : undefined,
    selection: ctx.selection,
    sources: sourceSnapshot(ctx.materialIds),
    config: config.snapshot,
    at: new Date().toLocaleString("zh-CN"),
  });
}

function generateCandidate() {
  const s = state.value.selection;
  notice.value = "";
  candidateFailure.value = "";
  if (!s.text || !s.valid) {
    notice.value = "先选中同一段落中格式一致的文字。跨段、跨表格单元格、混合格式和复杂对象暂不支持自动修订。";
    openPanel("revision");
    return;
  }
  if (state.value.candidate?.status === "generating") return;
  let request: WritingRequest;
  try {
    request = captureRequest(currentSession.value, state.value.goal || "审阅本次文字调整");
  } catch (error) {
    notice.value = error instanceof Error ? error.message : "请求上下文不可用";
    return;
  }
  const citation = state.value.revisionKind === "citation" ? library.value.citationRequest : null;
  if (citation && citation.baseVersion !== workspace.current.document.version) {
    notice.value = "引用请求基于旧版本，请返回资料空间重新准备；正文未变。";
    return;
  }
  archiveWritingCandidate(state.value);
  state.value.request = request;
  state.value.revisionKind = citation ? "citation" : "text";
  state.value.citationText = citation?.text ?? "";
  const replacement = citation ? `${s.text}\n${citation.text}` : state.value.replacement;
  const patches = prepareTextPatches(request, replacement);
  state.value.patches = patches;
  state.value.beforeHtml = editor.value?.getHTML() ?? "";
  state.value.candidate = {
    id: `candidate:${s.from}:${s.to}:${Date.now()}`,
    agent: state.value.selectedAgent,
    goal: state.value.goal || "审阅本次文字调整",
    scope: `实际选区 · ${s.text.length} 字${citation ? " · 追加已核实引用" : ""}`,
    baseVersion: workspace.current.document.version,
    currentVersion: workspace.current.document.version,
    status: "generating",
    hunks: [],
    checks: [],
    basis: [
      "本地确定性模拟；正式文字仅在采纳后写入",
      ...writingConstraintBasis(request),
      `本次约束处理：${writingConstraintAdvice(request, request.agent)}`,
      ...request.sources.map((source) => `${source.title} v${source.version} · ${source.coverage}`),
      ...request.config.map((config) => `${config.name} v${config.version}`),
    ],
  };
  currentSession.value.messages.push({
    id: crypto.randomUUID(),
    role: "student",
    text: request.prompt,
    at: new Date().toLocaleTimeString("zh-CN"),
    version: request.version,
  });
  openPanel("assistant");
  const scenario = candidateScenario.value;
  candidateScenario.value = "normal";
  const token = ++generation;
  revisionJob = startProjectJob(
    workspace.current,
    {
      title: citation ? "引用候选" : "选区修订",
      kind: "生成",
      route: "/screens/write",
      input: `正文 v${request.version} · ${s.text.length} 字选区`,
      snapshot: { version: request.version, requirementVersion: request.requirementVersion, config: request.config },
      sourceId: "writing-revision",
    },
    { cancel: cancelCandidate, retry: generateCandidate },
  );
  generationTimer = setTimeout(() => {
    if (token !== generation || workspace.current.id !== projectId || state.value.candidate?.status !== "generating" || !revisionJob?.isActive()) return;
    const c = state.value.candidate;
    if (scenario !== "normal") {
      c.status = "invalid";
      candidateFailure.value = scenario === "timeout" ? "模拟请求超时，输入已保留，可以重新生成。" : "模拟返回结构不完整，已拒绝应用；请重新生成。";
      c.checks = [{ id: "range", label: "服务结果", result: "fail", detail: candidateFailure.value }];
      revisionJob.finish("failed", candidateFailure.value);
    } else {
      c.checks = checksFor(patches);
      c.hunks = patches.map((p) => ({
        id: p.id,
        decision: "pending",
        segments: [
          { t: "del", text: p.before },
          { t: "ins", text: p.after },
        ],
        reason: citation ? "仅在原选区末尾新增已核实来源，原段落与受保护内容完整保留。" : `针对“${request.prompt}”调整表达，原数字和引用由程序保护。`,
        blocked: allChecksPass(c.checks)
          ? undefined
          : c.checks
              .filter((check) => check.result !== "pass")
              .map((check) => check.label)
              .join("、") + "未通过",
      }));
      c.status = allChecksPass(c.checks) ? "pending" : "invalid";
      revisionJob.finish(c.status === "pending" ? "done" : "failed", c.status === "pending" ? "候选已生成，等待逐项审阅。" : "保护检查未通过，正文保持不变。");
    }
    archiveWritingCandidate(state.value);
  }, 500);
}
function cancelCandidate() {
  generation++;
  if (generationTimer) clearTimeout(generationTimer);
  if (state.value.candidate) state.value.candidate.status = "cancelled";
  revisionJob?.cancel();
  archiveWritingCandidate(state.value);
}
function decide(id: string, decision: HunkDecision) {
  const h = state.value.candidate?.hunks.find((h) => h.id === id);
  if (h && ["pending", "invalid"].includes(state.value.candidate?.status ?? "") && (decision !== "accepted" || !h.blocked)) {
    h.decision = decision;
    archiveWritingCandidate(state.value);
  }
}
function rejectAll() {
  if (state.value.candidate) {
    state.value.candidate.status = "rejected";
    state.value.decisions.unshift({ at: new Date().toLocaleString("zh-CN"), action: "拒绝候选，正文不变", version: workspace.current.document.version });
    archiveWritingCandidate(state.value);
  }
}
function adopt() {
  if (state.value.revisionKind === "format") {
    adoptFormat();
    return;
  }
  const c = state.value.candidate;
  const e = editor.value;
  if (!c || !e || c.status !== "pending" || !workspace.sessionActive) return;
  if (state.value.request?.projectId !== projectId) {
    c.status = "expired";
    notice.value = "这是恢复副本中的历史请求，请在当前项目重新生成后审阅。";
    return;
  }
  const accepted = state.value.patches.filter((p) => c.hunks.some((h) => h.id === p.id && h.decision === "accepted"));
  c.checks = checksFor(accepted);
  if (!allChecksPass(c.checks)) {
    c.status = c.baseVersion !== workspace.current.document.version ? "expired" : "invalid";
    c.currentVersion = workspace.current.document.version;
    return;
  }
  let tr = e.state.tr;
  for (const p of [...accepted].sort((a, b) => b.from - a.from)) tr = tr.replaceWith(p.from, p.to, e.schema.text(p.after, e.state.doc.resolve(p.from).marks()));
  applying = true;
  mutationCause = "采纳修订候选";
  e.view.dispatch(tr);
  c.status = "adopted";
  c.resultVersion = workspace.current.document.version;
  applying = false;
  state.value.decisions.unshift({ at: new Date().toLocaleString("zh-CN"), action: `采纳 ${accepted.length} 处文字修订`, version: c.resultVersion });
  archiveWritingCandidate(state.value);
  workspace.recordEvent("已采纳修订", `正文 v${c.baseVersion} → v${c.resultVersion}`, "/screens/write?version=" + c.resultVersion);
}
function undoAdoption() {
  const c = state.value.candidate;
  if (!c || c.status !== "adopted") return;
  if (state.value.request?.projectId !== projectId) {
    notice.value = "恢复副本仅保留原项目采纳历史；请在版本页比较并恢复，不直接撤销原项目请求。";
    openPanel("history");
    return;
  }
  if (workspace.current.document.version !== c.resultVersion) {
    notice.value = "采纳后正文已有新编辑，直接撤销会覆盖它。请在版本历史中比较后选择恢复。";
    panel.value = "history";
    compareVersion.value = c.baseVersion;
    return;
  }
  applying = true;
  mutationCause = "撤销采纳并保留历史";
  editor.value?.commands.setContent(state.value.beforeHtml);
  applying = false;
  c.status = "cancelled";
  state.value.decisions.unshift({ at: new Date().toLocaleString("zh-CN"), action: "撤销采纳", version: workspace.current.document.version });
  archiveWritingCandidate(state.value);
}
function restoreVersion(version: number) {
  compareVersion.value = version;
  restoreTarget.value = version;
}
function confirmRestore() {
  const target = workspace.current.document.history.find((v) => v.version === restoreTarget.value);
  if (!target) return;
  mutationCause = `恢复 v${target.version} 为新版本`;
  editor.value?.commands.setContent(target.html);
  restoreTarget.value = null;
  notice.value = "已恢复为新版本，原有历史全部保留。";
}
function toggleLock() {
  if (!state.value.selection.text) {
    notice.value = "先选中需要保护的文字。";
    return;
  }
  editor.value?.chain().focus().toggleMark("aiLock").run();
}
function removeScope(id: string) {
  if (id === "selection") editor.value?.commands.setTextSelection(state.value.selection.from);
  else if (id === "chapter") includeChapter.value = false;
  else state.value.materialIds = state.value.materialIds.filter((x) => x !== id);
}

function send(session: Session, text: string, frozen?: WritingRequest) {
  if (session.status === "running" || !workspace.sessionActive || !text.trim()) return;
  let request: WritingRequest;
  try {
    request = frozen ? copyWritingValue(frozen) : captureRequest(session, text);
  } catch (error) {
    session.status = "failed";
    session.error = error instanceof Error ? error.message : "上下文不可用";
    return;
  }
  const failed = failNext.value;
  const partial = partialNext.value;
  failNext.value = false;
  partialNext.value = false;
  session.lastPrompt = text;
  session.lastRequest = request;
  session.draft = "";
  session.status = "running";
  session.error = "";
  session.steps =
    session.kind === "general"
      ? ["content", "lit", "review"].map((kind, index) => ({
          id: `${request.id}-${kind}`,
          agent: kind as AgentKind,
          title: ["表达与选区", "来源与引用", "检查范围"][index]!,
          status: "running",
          result: "正在检查固定输入…",
        }))
      : [];
  session.messages.push({ id: crypto.randomUUID(), role: "student", text, at: new Date().toLocaleTimeString("zh-CN"), version: request.version });
  const token = (sessionTokens.get(session.kind) ?? 0) + 1;
  sessionTokens.set(session.kind, token);
  const job = startProjectJob(
    workspace.current,
    {
      title: agents[session.kind].name + "会话",
      kind: "生成",
      route: `/screens/write?agent=${session.kind}`,
      sourceId: `writing-session-${session.kind}`,
      input: `正文 v${request.version} · ${request.sources.length}项资料`,
      snapshot: {
        version: request.version,
        sourceVersions: request.sources.map((source) => ({ id: source.id, version: source.version })),
        config: request.config,
      },
    },
    { cancel: () => stop(session), retry: () => retry(session) },
  );
  sessionJobs.set(session.kind, job);
  sessionTimers.set(
    session.kind,
    setTimeout(() => {
      if (sessionTokens.get(session.kind) !== token || session.status !== "running" || !job.isActive()) return;
      if (workspace.current.id !== projectId) {
        stop(session);
        return;
      }
      if (failed) {
        session.status = "failed";
        session.error = "模拟服务暂不可用，已保留提问、上下文快照和正文，可以按原输入重试。";
        for (const step of session.steps ?? []) {
          step.status = "failed";
          step.result = session.error;
        }
        job.finish("failed", session.error);
        return;
      }
      const result = assistantPreview(request, partial);
      session.status = "idle";
      session.steps = result.steps;
      session.messages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        text: result.text,
        at: new Date().toLocaleTimeString("zh-CN"),
        version: request.version,
      });
      job.finish(
        partial && session.kind === "general" ? "partial" : "done",
        partial ? "专业子任务部分完成，可分别重试；正文未改动。" : "回复已生成；正文与计划未改动。",
      );
    }, 700),
  );
}
function stop(session: Session) {
  sessionTokens.set(session.kind, (sessionTokens.get(session.kind) ?? 0) + 1);
  clearTimeout(sessionTimers.get(session.kind));
  session.status = "cancelled";
  for (const step of session.steps ?? []) if (["running", "waiting"].includes(step.status)) step.status = "cancelled";
  sessionJobs.get(session.kind)?.cancel();
}
function retry(session: Session) {
  if (!session.lastRequest) {
    send(session, session.lastPrompt);
    return;
  }
  notice.value = `将沿用原请求的正文 v${session.lastRequest.version} 与来源快照；如需使用新稿，请重新提问。`;
  send(session, session.lastPrompt, session.lastRequest);
}
function retryStep(session: Session, id: string) {
  const step = session.steps?.find((entry) => entry.id === id);
  if (!step || !session.lastRequest || step.status !== "failed") return;
  const request = { ...copyWritingValue(session.lastRequest), agent: step.agent };
  const job = startProjectJob(workspace.current, {
    title: step.title + " · 重试",
    kind: "生成",
    route: "/screens/write?agent=general",
    sourceId: step.id,
    input: `固定正文 v${request.version}`,
    snapshot: { version: request.version, config: request.config },
  });
  const result = assistantPreview(request);
  step.status = "done";
  step.result = result.text;
  job.finish("done", "该专业子任务已重新检查，其他子任务结果保持。");
}
function prepareFormatCandidate() {
  const request = library.value.formatRequest;
  const e = editor.value;
  if (!request || !e) return;
  if (request.baseVersion !== workspace.current.document.version) {
    notice.value = "标题格式请求基于旧正文，请从模板重新发起；正文未变。";
    return;
  }
  const material = library.value.materials.find((m) => m.id === request.materialId && !m.removed);
  if (!material?.versions.some((v) => v.version === request.templateVersion)) {
    notice.value = "模板依据版本不可用，未生成格式候选。";
    return;
  }
  let captured: WritingRequest;
  try {
    captured = captureFormatIntent(state.value.sessions, (session) => captureRequest(session, request.label));
  } catch (error) {
    notice.value = String(error);
    return;
  }
  const requestFormat = request as typeof request & { align?: string; fontWeight?: string };
  const align = requestFormat.align === "center" ? "center" : "left";
  const weight = requestFormat.fontWeight === "600" ? "600" : "700";
  let previousLevel = 1;
  const changes: typeof formatChanges.value = [];
  e.state.doc.descendants((node, position) => {
    if (node.type.name !== "heading") return;
    const level = Number(node.attrs.level);
    const nextLevel = node.textContent === workspace.current.title ? 1 : Math.max(2, Math.min(level, previousLevel + 1));
    previousLevel = nextLevel;
    if (nextLevel !== level || node.attrs.templateAlign !== align || node.attrs.templateWeight !== weight)
      changes.push({
        position,
        title: node.textContent,
        level,
        nextLevel,
        align: String(node.attrs.templateAlign || "继承"),
        nextAlign: align,
        weight: String(node.attrs.templateWeight || "继承"),
        nextWeight: weight,
      });
  });
  if (!changes.length) {
    notice.value = "当前标题已符合本次支持的格式，无需新增版本。";
    return;
  }
  archiveWritingCandidate(state.value);
  formatChanges.value = changes;
  state.value.beforeHtml = e.getHTML();
  state.value.patches = [];
  state.value.request = captured;
  state.value.revisionKind = "format";
  const blocked = changes.some((change) => locked(change.position + 1, change.position + 1 + change.title.length));
  state.value.candidate = {
    id: `format:0:0:${Date.now()}`,
    agent: "format",
    goal: request.label,
    scope: `${changes.length} 个标题 · 保留原文`,
    baseVersion: request.baseVersion,
    currentVersion: request.baseVersion,
    status: blocked ? "invalid" : "pending",
    hunks: changes.map((change, i) => ({
      id: `format-${i}`,
      decision: "pending",
      segments: [
        { t: "eq", text: change.title + "：" },
        { t: "del", text: `H${change.level} / ${change.align} / ${change.weight}` },
        { t: "ins", text: `H${change.nextLevel} / ${change.nextAlign} / ${change.nextWeight}` },
      ],
      reason: "只调整受支持标题层级、对齐和字重；文字、数字、引用与复杂分页保持。",
      blocked: blocked ? "包含锁定标题，请手动核对" : undefined,
    })),
    checks: [
      { id: "version", label: "基础版本", result: "pass" },
      { id: "lock", label: "锁定内容", result: blocked ? "fail" : "pass" },
    ],
    basis: [
      `${material.name} v${request.templateVersion}`,
      request.sourceText,
      ...writingConstraintBasis(captured),
      `本次约束处理：${writingConstraintAdvice(captured, "format")}`,
    ],
  };
  state.value.selectedAgent = "format";
  openPanel("assistant");
  archiveWritingCandidate(state.value);
}
function adoptFormat() {
  const e = editor.value;
  const c = state.value.candidate;
  if (!e || !c || c.status !== "pending" || !workspace.sessionActive) return;
  if (state.value.request?.projectId !== projectId) {
    c.status = "expired";
    notice.value = "请在当前项目重新准备格式候选。";
    return;
  }
  if (c.baseVersion !== workspace.current.document.version) {
    c.status = "expired";
    c.currentVersion = workspace.current.document.version;
    return;
  }
  const accepted = formatChanges.value.filter((_change, i) => c.hunks[i]?.decision === "accepted");
  if (!accepted.length) return;
  if (
    accepted.some((change) => {
      const n = e.state.doc.nodeAt(change.position);
      return !n || n.type.name !== "heading" || n.textContent !== change.title || locked(change.position + 1, change.position + 1 + change.title.length);
    })
  ) {
    c.status = "invalid";
    notice.value = "标题或锁定状态已改变，请重新审阅。";
    return;
  }
  let tr = e.state.tr;
  for (const change of accepted) {
    const n = e.state.doc.nodeAt(change.position)!;
    tr = tr.setNodeMarkup(change.position, undefined, {
      ...n.attrs,
      level: change.nextLevel,
      templateAlign: change.nextAlign,
      templateWeight: change.nextWeight,
    });
  }
  applying = true;
  mutationCause = "采纳模板标题格式候选";
  e.view.dispatch(tr);
  applying = false;
  c.status = "adopted";
  c.resultVersion = workspace.current.document.version;
  state.value.decisions.unshift({ at: new Date().toLocaleString("zh-CN"), action: `采纳 ${accepted.length} 个标题格式`, version: c.resultVersion });
  archiveWritingCandidate(state.value);
}
async function readImport(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  objectNotice.value = "";
  importedText.value = "";
  importName.value = file.name;
  if (!/\.txt$/i.test(file.name)) {
    objectNotice.value = "当前只支持 UTF-8 纯文本导入。DOCX/PDF、图片及公式请先保留原件到资料页；当前正文未变。";
    input.value = "";
    return;
  }
  if (file.size > 1024 * 1024) {
    objectNotice.value = "文本超过 1 MB，请缩小文件；当前正文未变。";
    input.value = "";
    return;
  }
  try {
    importedText.value = await file.text();
    if (importedText.value.includes("\uFFFD")) {
      importedText.value = "";
      objectNotice.value = "文件可能不是 UTF-8，请转换编码后重试；当前正文未变。";
    }
  } catch {
    objectNotice.value = "读取失败，请重新选择文件；当前正文未变。";
  }
  input.value = "";
}
function importText() {
  if (!importedText.value.trim()) return;
  mutationCause = `导入纯文本：${importName.value}`;
  editor.value?.commands.setContent(textToHtml(importedText.value));
  importedText.value = "";
  objectNotice.value = "已导入为新版本，原正文可从历史恢复。";
}
async function readQuery() {
  if (route.path !== "/screens/write") return;
  if (agentKinds.includes(String(route.query.agent) as AgentKind)) {
    state.value.selectedAgent = String(route.query.agent) as AgentKind;
    await nextTick();
  } else if (route.query.citation) {
    state.value.selectedAgent = "lit";
    await nextTick();
  }
  const materials = String(route.query.materials ?? "")
    .split(",")
    .filter(Boolean);
  if (materials.length) state.value.materialIds = [...new Set(materials)];
  if (route.query.citation) {
    state.value.revisionKind = "citation";
    state.value.replacement = String(route.query.citation);
    state.value.goal = "审阅引用建议，先核实来源";
    panel.value = "revision";
    notice.value = "已接收引用草稿。请先选中要修订的位置；来源和引用标记仍须核验，不会自动写入正文。";
  }
  if (route.query.intent === "format") {
    state.value.selectedAgent = "format";
    await nextTick();
    if (!state.value.candidate || state.value.revisionKind !== "format" || state.value.candidate.baseVersion !== library.value.formatRequest?.baseVersion)
      prepareFormatCandidate();
  }
  if (route.query.panel === "versions") openPanel("history");
  if (route.query.goal) {
    state.value.goal = String(route.query.goal);
    panel.value = "revision";
  }
  if (route.query.version) {
    const version = Number(route.query.version);
    if (workspace.current.document.history.some((v) => v.version === version)) {
      compareVersion.value = version;
      restoreTarget.value = null;
      panel.value = "history";
    } else notice.value = `正文 v${version} 的历史快照在本预览中不可用，未替换当前正文。`;
  }
  await nextTick();
  const chapter = String(route.query.chapter ?? "");
  if (chapter && chapter !== "整篇论文") {
    const found =
      chapters.value.find((c) => c.id === route.query.chapterId) ?? chapters.value.find((c) => c.title.includes(chapter) || chapter.includes(c.title));
    if (found) locate(found.position);
    else if (!route.query.version) notice.value = `未在当前稿找到“${chapter}”，可从目录选择实际章节。`;
  }
}
watch(() => route.fullPath, readQuery, { immediate: true });
onActivated(() => {
  if (editor.value && editor.value.getHTML() !== workspace.current.document.html)
    editor.value.commands.setContent(workspace.current.document.html, { emitUpdate: false });
  const candidate = state.value.candidate;
  if (candidate && ["pending", "invalid", "generating"].includes(candidate.status) && candidate.baseVersion !== workspace.current.document.version) {
    candidate.status = "expired";
    candidate.currentVersion = workspace.current.document.version;
    generation++;
  }
  updateSelection();
  void readQuery();
});
watch(
  () => workspace.sessionActive,
  (active) => editor.value?.setEditable(active),
);
watch(
  () => state.value.selectedAgent,
  (selected, previous) => {
    const old = state.value.sessions.find((session) => session.kind === previous);
    if (old) saveContext(old);
    const next = state.value.sessions.find((session) => session.kind === selected)!;
    const context = next.context ?? emptyWritingContext();
    state.value.materialIds = [...context.materialIds];
    state.value.selection = copyWritingValue(context.selection);
    state.value.goal = context.goal;
    state.value.replacement = context.replacement;
    includeChapter.value = context.includeChapter;
    if (selected !== "general") lastExpert.value = selected;
    if (state.value.companion === selected) state.value.companion = agentKinds.find((k) => k !== selected)!;
  },
);
watch(
  () => [state.value.materialIds, state.value.goal, state.value.replacement, includeChapter.value],
  () => saveContext(currentSession.value),
  { deep: true },
);
watch(
  () => state.value.candidate,
  () => {
    archiveWritingCandidate(state.value);
    if (editor.value && !editor.value.isDestroyed) editor.value.view.dispatch(editor.value.state.tr.setMeta("candidate-view", Date.now()));
  },
  { deep: true },
);
function resizeCopilot(event: PointerEvent) {
  const start = event.clientX;
  const width = copilotWidth.value;
  const move = (e: PointerEvent) => {
    copilotWidth.value = Math.max(320, Math.min(480, width + start - e.clientX));
  };
  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end, { once: true });
}
function dismissOverlay() {
  mobileView.value = "paper";
  bubble.value = null;
  editor.value?.commands.focus();
}
onBeforeUnmount(() => {
  generation++;
  if (generationTimer) clearTimeout(generationTimer);
  for (const timer of sessionTimers.values()) clearTimeout(timer);
  for (const session of ownedState.sessions) if (session.status === "running") stop(session);
  revisionJob?.cancel();
  if (ownedState.candidate?.status === "generating") ownedState.candidate.status = "cancelled";
});
</script>

<template>
  <div class="screen-page write-screen" @keydown.esc="dismissOverlay">
    <header class="screen-heading write-accessible-heading"><h1>论文写作台</h1></header>
    <div class="write-mobile-switch">
      <TpSegmented
        v-model="mobileView"
        label="写作工作区视图"
        :options="[
          { value: 'outline', label: '章节目录' },
          { value: 'paper', label: '论文正文' },
          { value: 'assistant', label: '写作副驾' },
        ]"
      />
    </div>
    <Transition mode="out-in" name="tp-swap">
      <p :key="notice" v-if="notice" class="write-notice" role="status">
        {{ notice }} <button type="button" class="write-text-action" @click="notice = ''">收起</button>
      </p>
    </Transition>
    <Transition name="tp-pop">
      <div
        v-if="bubble"
        class="write-selection-bubble"
        :style="{ top: bubble.top + 'px', left: bubble.left + 'px' }"
        role="toolbar"
        aria-label="选区就地操作"
        @mousedown.prevent
      >
        <button
          type="button"
          @click="
            openPanel('revision');
            bubble = null;
          "
        >
          <TpIcon :icon="PhSparkle" :size="14" />请 AI 起草
        </button>
        <button
          type="button"
          @click="
            toggleLock();
            bubble = null;
          "
        >
          <TpIcon :icon="PhLockKey" :size="14" />锁定选区
        </button>
      </div>
    </Transition>
    <button v-if="mobileView !== 'paper'" class="write-drawer-backdrop" aria-label="关闭写作抽屉" @click="dismissOverlay" />
    <div
      class="write-layout"
      :class="{ 'is-collapsed': copilotCollapsed, 'has-two-assistants': state.multi }"
      :data-view="mobileView"
      :style="{ '--copilot-width': copilotWidth + 'px' }"
    >
      <aside class="write-outline screen-panel">
        <WritingOutline
          :doc="editor?.state.doc"
          :cursor="cursor"
          :title="workspace.current.title"
          :version="workspace.current.document.version"
          :tasks="plan.tasks"
          :requirements="boundRequirements"
          :words="words"
          @select="locate"
          @close="mobileView = 'paper'"
        />
      </aside>
      <section class="write-desk" aria-label="论文编辑">
        <div class="tp-paper write-paper">
          <div class="tp-toolbar write-toolbar" role="toolbar" aria-label="正文格式">
            <button class="tp-tool" type="button" aria-label="撤销编辑" :disabled="!editor?.can().undo()" @click="editor?.chain().focus().undo().run()">
              <TpIcon :icon="PhArrowUUpLeft" />
            </button>
            <button class="tp-tool" type="button" aria-label="重做编辑" :disabled="!editor?.can().redo()" @click="editor?.chain().focus().redo().run()">
              <TpIcon :icon="PhArrowUUpRight" /></button
            ><span class="tp-tool-sep" />
            <button
              v-for="level in [1, 2, 3] as const"
              :key="level"
              type="button"
              class="tp-tool"
              :aria-label="level + ' 级标题'"
              :aria-pressed="editor?.isActive('heading', { level })"
              @click="editor?.chain().focus().toggleHeading({ level }).run()"
            >
              H{{ level }}
            </button>
            <button
              type="button"
              class="tp-tool"
              aria-label="加粗"
              :aria-pressed="editor?.isActive('bold')"
              @click="editor?.chain().focus().toggleBold().run()"
            >
              <TpIcon :icon="PhTextB" />
            </button>
            <button
              type="button"
              class="tp-tool"
              aria-label="无序列表"
              :aria-pressed="editor?.isActive('bulletList')"
              @click="editor?.chain().focus().toggleBulletList().run()"
            >
              <TpIcon :icon="PhListBullets" />
            </button>
            <button type="button" class="tp-tool" aria-label="有序列表" @click="editor?.chain().focus().toggleOrderedList().run()">1.</button>
            <button
              type="button"
              class="tp-tool"
              aria-label="插入表格"
              @click="editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()"
            >
              <TpIcon :icon="PhTable" />
            </button>
            <button type="button" class="tp-tool" aria-label="锁定选区供 AI 保护" :aria-pressed="editor?.isActive('aiLock')" @click="toggleLock">
              <TpIcon :icon="PhLockKey" />
            </button>
            <TpButton size="sm" variant="ghost" @click="openPanel('objects')">更多对象</TpButton>
            <span class="write-toolbar-spacer" />
            <TpButton
              size="sm"
              variant="ghost"
              icon-only
              :label="copilotCollapsed ? '展开副驾' : '收起副驾'"
              @click="
                copilotCollapsed = !copilotCollapsed;
                mobileView = 'assistant';
              "
              ><TpIcon :icon="PhSidebarSimple"
            /></TpButton>
            <TpButton size="sm" variant="ghost" icon-only label="版本历史" @click="openPanel('history')"><TpIcon :icon="PhClockCounterClockwise" /></TpButton>
            <RouterLink class="tp-tool" aria-label="导出论文" title="导出论文" to="/screens/export"><TpIcon :icon="PhExport" /></RouterLink>
            <TpButton size="sm" variant="pencil" @click="openPanel('revision')"><TpIcon :icon="PhSparkle" />修订设置</TpButton>
          </div>
          <div class="write-paper-meta">
            <span>{{ currentChapter?.title || "毕业论文 · 开始写作" }}</span>
            <RouterLink v-if="nextTask" :to="'/screens/plan?task=' + nextTask.id" class="write-task-note" :title="nextTask.title"
              ><span>下一项 · {{ nextTask.deadline }}</span><b>{{ nextTask.title }}</b></RouterLink
            >
          </div>
          <EditorContent :editor="editor" class="write-editor" />
          <p v-if="state.candidate && ['pending', 'invalid'].includes(state.candidate.status) && state.revisionKind !== 'format'" class="write-diff-legend">
            <del>原文</del><ins>候选</ins>铅笔差异仅供审阅；采纳前正文保持不变。
          </p>
          <footer class="write-paper-status">
            <span>{{ words }} 字 · {{ state.selection.text ? "已选 " + state.selection.text.length + " 字" : "尚未选择文字" }}</span
            ><TpButton size="sm" variant="ghost" @click="selectParagraph">选中当前段落</TpButton>
          </footer>
        </div>
      </section>
      <aside class="write-copilot screen-panel" aria-label="写作副驾">
        <button
          class="write-resize"
          type="button"
          aria-label="调整副驾宽度，左右方向键"
          @pointerdown.prevent="resizeCopilot"
          @keydown.left.prevent="copilotWidth = Math.min(480, copilotWidth + 16)"
          @keydown.right.prevent="copilotWidth = Math.max(320, copilotWidth - 16)"
        />
        <header class="write-copilot-head">
          <h2 class="tp-label">副驾</h2>
          <TpSegmented
            v-model="agentMode"
            label="AI 模式"
            :options="[
              { value: 'general', label: '综合' },
              { value: 'expert', label: '专业' },
            ]"
          />
          <button class="write-close-drawer" type="button" aria-label="关闭副驾抽屉" @click="dismissOverlay"><TpIcon :icon="PhX" :size="18" /></button>
        </header>
        <Transition name="tp-swap">
          <nav v-if="agentMode === 'expert'" class="write-experts" aria-label="专业助手">
            <button
              v-for="kind in expertKinds"
              :key="kind"
              type="button"
              :class="{ 'is-active': state.selectedAgent === kind }"
              :aria-pressed="state.selectedAgent === kind"
              :aria-label="agents[kind].name"
              :title="agents[kind].name"
              @click="
                state.selectedAgent = kind;
                openPanel('assistant');
              "
            >
              <span class="tp-avatar tp-avatar--sm" :data-agent="kind">{{ agents[kind].short }}</span
              ><span v-if="state.selectedAgent === kind">{{ agents[kind].name }}</span>
            </button>
          </nav>
        </Transition>
        <TpTabs
          v-model="panel"
          :tabs="[
            { value: 'assistant', label: '副驾' },
            { value: 'revision', label: '审阅' },
            { value: 'history', label: '版本' },
            { value: 'objects', label: '对象' },
          ]"
          label="写作侧栏"
        />
        <div class="write-side-body" :class="{ 'is-conversation': panel === 'assistant' }">
          <ContextScope :items="scope" @remove="removeScope" @adjust="scopeOpen = !scopeOpen" />
          <Transition name="tp-swap">
            <div v-if="scopeOpen" class="write-inset">
              <div class="studio-row"><b>{{ workspace.current.short }}</b><span>{{ templateLabel }} · {{ requirementLabel }}</span></div>
              <p class="tp-caption">
                在正文选择范围；资料从资料页加入。<template v-if="workspace.current.requirementVersion > 0"
                  >所有助手共用本项目要求版本，{{ boundRequirements.filter((r) => r.enabled).length }} 条适用要求。</template
                ><template v-else>要求未绑定，不能判定是否符合论文规范；选区与内容保护仍生效。</template>
              </p>
              <label class="write-checkbox"><input v-model="includeChapter" type="checkbox" class="checkbox checkbox-primary checkbox-sm" />包含当前章节</label>
              <label class="write-checkbox"><input v-model="state.multi" type="checkbox" class="checkbox checkbox-primary checkbox-sm" />双助手会话</label>
              <TpField v-if="state.multi" v-slot="{ id }" label="同时打开"
                ><TpSelect
                  :id="id"
                  v-model="state.companion"
                  :options="agentKinds.filter((kind) => kind !== state.selectedAgent).map((kind) => ({ value: kind, label: agents[kind].name }))"
              /></TpField>
              <RouterLink class="write-text-action" to="/screens/library">选择项目资料 ↗</RouterLink
              ><TpButton variant="ghost" size="sm" @click="state.materialIds = []">清空资料范围</TpButton>
            </div>
          </Transition>
          <Transition name="tp-swap" mode="out-in"
            ><div :key="panel" class="write-panel-content">
              <template v-if="panel === 'assistant'">
                <Transition
                  @before-leave="suspendSessionInteractions"
                  @before-enter="restoreSessionInteractions"
                  @leave-cancelled="restoreSessionInteractions"
                  @enter-cancelled="restoreSessionInteractions"
                  name="tp-swap"
                  mode="out-in"
                  ><div :key="visibleSessions.map((session) => session.kind).join(':')" class="write-sessions" :class="{ 'is-multi': state.multi }">
                    <section v-for="session in visibleSessions" :key="session.kind" class="write-session" :aria-label="agents[session.kind].name + '会话'">
                      <header v-if="state.multi">
                        <span class="tp-avatar tp-avatar--sm" :data-agent="session.kind">{{ agents[session.kind].short }}</span
                        ><b>{{ agents[session.kind].name }}</b><TpStatus tone="neutral" label="预览" size="sm" />
                      </header>
                      <button
                        v-if="state.multi && session.kind !== state.selectedAgent"
                        type="button"
                        class="write-text-action"
                        @click="
                          state.selectedAgent = session.kind;
                          scopeOpen = true;
                        "
                      >
                        调整此助手的独立范围
                      </button>
                      <div class="write-messages" aria-live="polite">
                        <div v-if="!session.messages.length" class="write-welcome">
                          <span class="tp-avatar" :data-agent="session.kind">{{ agents[session.kind].short }}</span>
                          <h3>{{ agents[session.kind].name }}</h3>
                          <p>选中一段，写下你的修改想法。</p>
                          <span>建议会留在这里，审阅采纳后才写入正文。</span
                          ><TpButton size="sm" variant="pencil" @click="openPanel('revision')">开始修订选区</TpButton>
                        </div>
                        <TransitionGroup name="tp-list" tag="div" class="tp-list-group write-message-log" v-bind="listMotionHooks">
                          <article v-for="message in session.messages" :key="message.id" :class="['write-message', message.role]">
                            <span class="tp-label">{{ message.role === "student" ? "我" : agents[session.kind].name }} · v{{ message.version }}</span>
                            <p>{{ message.text }}</p>
                          </article>
                        </TransitionGroup>
                        <Transition name="tp-swap">
                          <p v-if="session.status === 'running'" class="tp-caption">正在生成预览回复，正文不会改变…</p>
                        </Transition>
                        <Transition name="tp-swap">
                          <p v-if="session.status === 'cancelled'" class="tp-caption">本次已取消，正文与已有消息保留。</p>
                        </Transition>
                        <Transition name="tp-swap" mode="out-in">
                          <TransitionGroup
                            key="boundary-first"
                            name="tp-list"
                            tag="div"
                            v-bind="listMotionHooks"
                            v-if="session.steps?.length"
                            class="write-step-list tp-list-group"
                            aria-label="专业子任务"
                          >
                            <article v-for="step in session.steps" :key="step.id">
                              <header>
                                <b>{{ step.title }}</b
                                ><TpStatus
                                  :tone="step.status === 'failed' ? 'danger' : step.status === 'done' ? 'success' : 'neutral'"
                                  :label="
                                    step.status === 'done' ? '已完成' : step.status === 'failed' ? '待重试' : step.status === 'cancelled' ? '已取消' : '进行中'
                                  "
                                  size="sm"
                                />
                              </header>
                              <p>{{ step.result }}</p>
                              <TpButton v-if="step.status === 'failed'" size="sm" variant="outline" @click="retryStep(session, step.id)"
                                >重试此专业任务</TpButton
                              >
                            </article>
                          </TransitionGroup>
                        </Transition>
                        <details v-if="session.lastRequest" class="write-scenario tp-disclosure">
                          <summary>本次输入快照 · v{{ session.lastRequest.version }}</summary>
                          <p>
                            {{ session.lastRequest.chapter || "未限定章节" }} · 模板 v{{ session.lastRequest.templateVersion }} · 要求 v{{
                              session.lastRequest.requirementVersion
                            }}
                          </p>
                          <p v-for="source in session.lastRequest.sources" :key="source.id">
                            {{ source.title }} · v{{ source.version }} · {{ source.coverage }}
                          </p>
                          <p v-for="config in session.lastRequest.config" :key="config.id">{{ config.name }} v{{ config.version }}</p>
                          <details class="tp-disclosure">
                            <summary>绑定要求与模板依据</summary>
                            <p v-for="(basis, index) in writingConstraintBasis(session.lastRequest)" :key="index">{{ basis }}</p>
                          </details>
                        </details>
                        <p v-if="candidateFailure && state.candidate?.agent === session.kind" class="write-notice" role="alert">{{ candidateFailure }}</p>
                        <Transition name="tp-swap" mode="out-in">
                          <RevisionCard
                            key="boundary-first"
                            v-if="state.candidate && state.candidate.agent === session.kind"
                            :candidate="state.candidate"
                            @decide="decide"
                            @adopt="adopt"
                            @reject-all="rejectAll"
                            @cancel="cancelCandidate"
                            @regenerate="state.revisionKind === 'format' ? prepareFormatCandidate() : generateCandidate()"
                            @undo="undoAdoption"
                          />
                        </Transition>
                      </div>
                      <Transition name="tp-swap">
                        <div v-if="session.status === 'failed'" class="write-notice" role="alert">
                          {{ session.error }}<TpButton size="sm" @click="retry(session)">重试本次提问</TpButton>
                        </div>
                      </Transition>
                      <AssistantComposer
                        v-model="session.draft"
                        :running="session.status === 'running'"
                        placeholder="继续说明你想怎么改…"
                        @send="(text) => send(session, text)"
                        @cancel="stop(session)"
                        ><template #tools
                          ><button type="button" class="write-text-action" @click="openPanel('revision')">修改选区</button></template
                        ></AssistantComposer
                      >
                    </section>
                  </div></Transition
                >
                <footer class="write-copilot-foot">
                  <span>{{ workspace.current.short }} · v{{ workspace.current.document.version }}</span
                  ><button type="button" aria-label="副驾更多设置" :aria-expanded="scopeOpen" @click="scopeOpen = !scopeOpen">
                    <TpIcon :icon="PhSlidersHorizontal" :size="14" /></button
                  ><span>本地预览</span>
                </footer>
                <details v-if="scopeOpen" class="write-scenario tp-disclosure">
                  <summary>预览场景</summary>
                  <label class="write-checkbox"
                    ><input v-model="failNext" type="checkbox" class="checkbox checkbox-primary checkbox-sm" />下一次请求演示失败</label
                  ><label class="write-checkbox"
                    ><input v-model="partialNext" type="checkbox" class="checkbox checkbox-primary checkbox-sm" />综合助手的文献子任务失败</label
                  >
                  <p>固定行为预览，不调用外部模型。</p>
                  <div class="write-related">
                    <RouterLink to="/screens/library">文献与资料 ↗</RouterLink><RouterLink to="/screens/plan">计划与证据 ↗</RouterLink
                    ><RouterLink to="/screens/review">仅评审 ↗</RouterLink>
                  </div>
                </details>
              </template>
              <template v-else-if="panel === 'revision'">
                <div class="write-revision-form">
                  <p v-if="state.revisionKind === 'citation'" class="write-notice">引用追加模式：保留所选原文，在末尾追加资料页准备的核实引文。</p>
                  <TpField v-slot="{ id }" label="修改目标"><input :id="id" v-model="state.goal" class="tp-input" /></TpField
                  ><TpField v-slot="{ id }" label="候选文字" hint="可留空查看确定性文字预览；不会直接改正文。">
                    <textarea :id="id" v-model="state.replacement" class="tp-input" rows="3" placeholder="填写希望替换选区的文字，或查看预览建议" />
                  </TpField>
                  <p class="write-selection-text">{{ state.selection.text || "在正文中选择同一段落的文字后继续。" }}</p>
                  <details class="write-scenario tp-disclosure">
                    <summary>修订异常场景</summary>
                    <label
                      >本次模拟结果<TpSelect
                        v-model="candidateScenario"
                        aria-label="修订模拟结果"
                        :options="[
                          { value: 'normal', label: '正常结果' },
                          { value: 'timeout', label: '请求超时' },
                          { value: 'invalid', label: '返回结构无效' },
                        ]"
                    /></label>
                  </details>
                  <TpButton variant="pencil" :disabled="state.candidate?.status === 'generating'" @click="generateCandidate"
                    ><TpIcon :icon="PhSparkle" />生成修订预览</TpButton
                  >
                </div>
                <Transition name="tp-swap" mode="out-in">
                  <RevisionCard
                    key="boundary-first"
                    v-if="state.candidate"
                    :candidate="state.candidate"
                    @decide="decide"
                    @adopt="adopt"
                    @reject-all="rejectAll"
                    @cancel="cancelCandidate"
                    @regenerate="state.revisionKind === 'format' ? prepareFormatCandidate() : generateCandidate()"
                    @undo="undoAdoption"
                  />
                  <TpState
                    key="boundary-last"
                    v-else
                    kind="empty"
                    title="先有建议，再作决定"
                    desc="生成预览后，差异和程序检查会出现在这里。选中片段还不会生效，采纳后才写入正文。"
                  />
                </Transition>
                <details v-if="state.decisions.length" class="write-scenario tp-disclosure">
                  <summary>修订决定记录（{{ state.decisions.length }}）</summary>
                  <p v-for="(decision, i) in state.decisions" :key="i">{{ decision.at }} · {{ decision.action }} · v{{ decision.version }}</p>
                </details>
              </template>
              <template v-else-if="panel === 'history'">
                <p class="tp-caption">每次恢复都形成新版本，已有历史不会删除。</p>
                <details v-if="state.history?.length" class="write-scenario tp-disclosure">
                  <summary>完整修订历史（{{ state.history.length }}）</summary>
                  <TransitionGroup name="tp-list" tag="div" class="tp-list-group" v-bind="listMotionHooks">
                    <button v-for="item in state.history" :key="item.candidate.id" type="button" class="write-history-item" @click="selectedHistory = item">
                      {{ item.candidate.goal
                      }}<small
                        >v{{ item.candidate.baseVersion }} → {{ item.candidate.resultVersion ? "v" + item.candidate.resultVersion : "未写入" }} ·
                        {{ item.candidate.status }}</small
                      >
                    </button>
                  </TransitionGroup>
                </details>
                <Transition mode="out-in" name="tp-swap">
                  <section :key="selectedHistory.candidate.id" v-if="selectedHistory" class="write-inset">
                    <h3>{{ selectedHistory.candidate.goal }}</h3>
                    <p class="tp-caption">{{ selectedHistory.at }} · 原候选与决定快照</p>
                    <div v-for="hunk in selectedHistory.candidate.hunks" :key="hunk.id">
                      <p
                        v-for="(segment, index) in hunk.segments"
                        :key="index"
                        :class="segment.t === 'del' ? 'history-delete' : segment.t === 'ins' ? 'history-insert' : ''"
                      >
                        {{ segment.text }}
                      </p>
                      <small>{{ hunk.decision }} · {{ hunk.reason }}</small>
                    </div>
                    <p v-for="basis in selectedHistory.candidate.basis" :key="basis" class="tp-caption">{{ basis }}</p>
                    <p v-for="check in selectedHistory.candidate.checks" :key="check.id" class="tp-caption">{{ check.label }}：{{ check.result }}</p>
                    <TpButton size="sm" variant="ghost" @click="selectedHistory = null">收起修订详情</TpButton>
                  </section>
                </Transition>
                <VersionTimeline
                  :versions="versions"
                  @compare="
                    (v) => {
                      compareVersion = v;
                      restoreTarget = null;
                    }
                  "
                  @restore="restoreVersion"
                />
                <Transition mode="out-in" name="tp-swap">
                  <section :key="comparison.version" v-if="comparison" class="write-inset">
                    <h3>v{{ comparison.version }} 与当前稿</h3>
                    <span class="tp-label">所选版本</span>
                    <p class="write-compare">{{ plain(comparison.html) }}</p>
                    <span class="tp-label">当前版本 v{{ workspace.current.document.version }}</span>
                    <p class="write-compare">{{ plain(workspace.current.document.html) }}</p>
                    <div class="screen-actions">
                      <TpButton v-if="restoreTarget !== null" variant="seal" @click="confirmRestore">恢复为新版本</TpButton
                      ><TpButton
                        size="sm"
                        variant="ghost"
                        @click="
                          compareVersion = null;
                          restoreTarget = null;
                        "
                        >关闭对比</TpButton
                      >
                    </div>
                  </section>
                </Transition>
              </template>
              <template v-else>
                <h2 class="write-section-title">文档对象与支持范围</h2>
                <p class="tp-caption">支持输入与基础排版。复杂对象保持明确边界。</p>
                <div class="write-object-list">
                  <div>
                    <b>表格、列表、标题</b><span>可在正文中真实编辑</span
                    ><TpButton size="sm" @click="editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()">插入表格</TpButton
                    ><TpButton size="sm" :disabled="!editor?.can().addRowAfter()" @click="editor?.chain().focus().addRowAfter().run()">增加行</TpButton
                    ><TpButton size="sm" :disabled="!editor?.can().addColumnAfter()" @click="editor?.chain().focus().addColumnAfter().run()">增加列</TpButton>
                  </div>
                  <div>
                    <b>图注、参考文献文字</b><span>作为普通文字编辑，不自动核实来源</span
                    ><TpButton size="sm" @click="editor?.chain().focus().insertContent('<p>图注：请填写实际图示名称与来源。</p>').run()">插入图注文字</TpButton>
                  </div>
                  <div>
                    <b>图片、公式、页码、页眉页脚</b><span>当前未接入安全编辑与分页；不会自动转换或丢弃对象。</span
                    ><RouterLink class="write-text-action" to="/screens/library">保留原件到资料 ↗</RouterLink>
                  </div>
                  <div><b>目录</b><span>左侧目录来自实际标题；不伪造分页目录。</span></div>
                </div>
                <TpField v-slot="{ id }" label="导入已有论文" hint="当前支持 UTF-8 TXT，最多 1 MB；预览后决定导入。"
                  ><label class="tp-file-control" :for="id">
                    <span class="tp-file-control__button"><TpIcon :icon="PhUploadSimple" :size="16" />选择文稿</span>
                    <span class="tp-file-control__text">{{ importName || "选择 UTF-8 文本，保留现有正文" }}</span>
                    <input
                      :id="id"
                      type="file"
                      accept=".txt,.docx,.pdf"
                      class="tp-file-control__input"
                      aria-label="导入已有论文"
                      @change="readImport"
                    /> </label
                ></TpField>
                <Transition mode="out-in" name="tp-swap">
                  <p :key="objectNotice" v-if="objectNotice" class="write-notice" role="status">{{ objectNotice }}</p>
                </Transition>
                <Transition name="tp-swap">
                  <div v-if="importedText" class="write-inset">
                    <h3>{{ importName }}</h3>
                    <p class="write-compare">{{ importedText.slice(0, 1000) }}{{ importedText.length > 1000 ? "…" : "" }}</p>
                    <p class="tp-caption">导入将形成新版本，原正文保留在历史中。</p>
                    <div class="screen-actions">
                      <TpButton variant="primary" @click="importText">导入为新版本</TpButton
                      ><TpButton variant="ghost" @click="importedText = ''">取消导入</TpButton>
                    </div>
                  </div>
                </Transition>
              </template>
            </div></Transition
          >
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.write-screen {
  gap: 12px;
}
.write-accessible-heading {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.write-mobile-switch,
.write-drawer-backdrop,
.write-close-drawer {
  display: none;
}
.write-layout {
  display: grid;
  grid-template-columns: 208px minmax(320px, 1fr) var(--copilot-width, 392px);
  gap: 18px;
  align-items: stretch;
  min-height: calc(100dvh - 150px);
}
.write-layout > * {
  min-width: 0;
}
.write-layout.is-collapsed {
  grid-template-columns: 208px minmax(0, 1fr);
}
.write-layout.is-collapsed .write-copilot {
  display: none;
}
.write-outline {
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--tp-line-strong);
  box-shadow: var(--tp-shadow-1);
}
.write-desk {
  min-width: 0;
}
.write-paper {
  overflow: hidden;
  min-height: 100%;
  border: 1px solid var(--tp-line-strong);
  box-shadow: var(--tp-shadow-2);
}
.write-toolbar {
  flex-wrap: wrap;
  gap: 3px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--tp-line);
}
.write-toolbar-spacer {
  flex: 1;
}
.write-paper-meta {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 24px 32px 0;
  font-size: 11px;
  color: var(--tp-text-muted);
}
.write-task-note {
  max-width: 180px;
  padding: 8px 12px;
  border-left: 2px solid var(--tp-accent);
  background: var(--tp-accent-soft);
  color: var(--tp-accent-soft-content);
  font-size: 10px;
  line-height: 1.6;
  border-radius: var(--tp-radius-s);
}
.write-task-note b {
  display: block;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}
.write-editor {
  padding: 18px 36px 32px;
  min-height: 610px;
}
.write-editor :deep(.tiptap) {
  min-height: 500px;
  outline: none;
  overflow-wrap: anywhere;
}
.write-editor :deep(.tp-prose) {
  font-size: 17px;
  line-height: 2;
  max-width: 44em;
  margin: auto;
}
.write-editor :deep(.tp-prose h1) {
  font-size: 25px;
  line-height: 1.55;
  margin: 18px 0 30px;
}
.write-editor :deep(.tp-prose h2) {
  font-size: 23px;
  line-height: 1.6;
  margin-top: 28px;
}
.write-editor :deep(.tp-prose h3) {
  font-size: 19px;
  line-height: 1.6;
}
.write-editor :deep(.write-locked) {
  background: var(--tp-warning-soft);
  border-bottom: 2px solid var(--tp-warning);
}
.write-editor :deep(.write-diff-before) {
  text-decoration: line-through;
  text-decoration-color: var(--tp-text-muted);
  background: var(--tp-surface-sunken);
  color: var(--tp-text-muted);
}
.write-editor :deep(.write-diff-after) {
  font-family: var(--tp-font-prose);
  color: var(--tp-pencil-content);
  background: var(--tp-pencil-soft);
  border-bottom: 2px dotted var(--tp-pencil-line);
  user-select: none;
}
.write-diff-legend {
  display: flex;
  gap: 12px;
  padding: 12px 24px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--tp-text-muted);
  flex-wrap: wrap;
}
.write-diff-legend ins {
  color: var(--tp-pencil-content);
}
.write-paper-status {
  padding: 10px 16px;
  border-top: 1px solid var(--tp-line);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  color: var(--tp-text-muted);
  font-size: 11px;
}
.write-copilot {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0;
  border: 1px solid var(--tp-line-strong);
  box-shadow: var(--tp-shadow-1);
  min-height: 700px;
}
.write-resize {
  position: absolute;
  left: -9px;
  top: 0;
  bottom: 0;
  width: 16px;
  cursor: col-resize;
  z-index: 3;
  background: transparent;
}
.write-resize:focus-visible {
  outline: 2px solid var(--tp-accent);
}
.write-copilot-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 12px;
}
.write-copilot-head h2 {
  font-size: 13px;
}
.write-experts {
  display: flex;
  gap: 7px;
  align-items: center;
  padding: 0 14px 14px;
  border-bottom: 1px solid var(--tp-line);
}
.write-experts button {
  display: flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--tp-radius-m);
  padding: 5px;
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}
.write-experts button.is-active {
  background: var(--tp-surface-sunken);
  border-color: var(--tp-line-strong);
}
.write-experts button:hover {
  background: var(--tp-accent-soft);
}
.write-copilot :deep(.tp-tabs) {
  padding: 0 12px;
}
.write-copilot :deep(.tp-tabs__tab) {
  padding: 10px 11px;
  font-size: 11px;
}
.write-side-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  min-width: 0;
}
.write-side-body :deep(.tp-scope) {
  flex-wrap: wrap;
  padding: 10px;
}
.write-panel-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.write-message-log {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.write-side-body :deep(.tp-chip) {
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  font-size: 10px;
}
.write-checkbox {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}
.write-sessions {
  display: grid;
  gap: 18px;
  flex: 1;
  min-width: 0;
}
.write-session {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.write-session > header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.write-session > header > :last-child {
  margin-left: auto;
}
.write-sessions.is-multi .write-session + .write-session {
  border-top: 1px solid var(--tp-line);
  padding-top: 18px;
}
.write-messages {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 630px;
  min-height: 220px;
  overflow: auto;
  scrollbar-width: thin;
  flex: 1;
}
.write-welcome {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 36px 14px;
  font-family: var(--tp-font-prose);
  line-height: 1.8;
  font-size: 17px;
}
.write-welcome h3 {
  font-size: 19px;
  font-weight: 650;
}
.write-welcome > span:not(.tp-avatar) {
  font-family: var(--tp-font-body);
  font-size: 12px;
  color: var(--tp-text-muted);
}
.write-message {
  padding: 12px 14px;
  border-radius: var(--tp-radius-m);
  font-size: 12px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.write-message.student {
  align-self: flex-end;
  background: var(--tp-surface-sunken);
  max-width: 92%;
}
.write-message.assistant {
  background: var(--tp-pencil-soft);
  border: 1px dashed var(--tp-pencil-line);
}
.write-message p {
  white-space: pre-wrap;
  margin-top: 6px;
}
.write-copilot-foot {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 10px;
  color: var(--tp-text-faint);
}
.write-copilot-foot > span:first-child {
  margin-right: auto;
}
.write-related {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: var(--tp-accent);
}
.write-notice {
  padding: 10px 14px;
  border: 1px solid var(--tp-line);
  background: var(--tp-surface-sunken);
  border-radius: var(--tp-radius-m);
  font-size: 12px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.write-text-action {
  color: var(--tp-accent);
  text-decoration: underline;
  text-underline-offset: 4px;
  font-size: 11px;
}
.write-scenario {
  font-size: 11px;
  color: var(--tp-text-muted);
  line-height: 1.8;
}
.write-scenario summary {
  cursor: pointer;
}
.write-scenario > :not(summary) {
  margin-top: 10px;
}
.write-inset {
  padding: 14px;
  border: 1px solid var(--tp-line);
  background: var(--tp-surface-sunken);
  border-radius: var(--tp-radius-m);
  display: grid;
  gap: 12px;
  min-width: 0;
  font-size: 12px;
  line-height: 1.8;
}
.write-revision-form {
  display: grid;
  gap: 12px;
}
.write-selection-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 110px;
  overflow: auto;
  padding: 12px;
  border-left: 2px solid var(--tp-line-strong);
  font-size: 12px;
  color: var(--tp-text-muted);
}
.write-compare {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.8;
}
.write-section-title {
  font-size: 15px;
  font-weight: 650;
}
.write-object-list {
  display: grid;
  gap: 16px;
}
.write-object-list > div {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--tp-line);
  font-size: 13px;
}
.write-object-list b,
.write-object-list span {
  flex-basis: 100%;
}
.write-object-list span {
  color: var(--tp-text-muted);
  line-height: 1.8;
}
.write-copilot :deep(.tp-rev__foot) {
  flex-wrap: wrap;
}
.write-copilot :deep(.tp-rev__goal) {
  font-size: 15px;
}
.write-copilot :deep(.tp-hunk) {
  grid-template-columns: 20px minmax(0, 1fr);
}
.write-copilot :deep(.tp-hunk__act) {
  grid-column: 2;
}
.write-copilot :deep(.tp-vt__item) {
  grid-template-columns: 20px minmax(0, 1fr);
}
.write-copilot :deep(.tp-vt__item > :last-child) {
  grid-column: 2;
}
.write-selection-bubble {
  position: fixed;
  display: flex;
  gap: 4px;
  align-items: center;
  background: var(--tp-surface);
  border: 1px solid var(--tp-line-strong);
  border-radius: var(--tp-radius-m);
  padding: 5px;
  box-shadow: var(--tp-shadow-2);
  z-index: 45;
}
.write-selection-bubble button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  font-size: 12px;
}
.write-selection-bubble button:hover {
  background: var(--tp-accent-soft);
}
.write-step-list {
  display: grid;
  gap: 10px;
}
.write-step-list article {
  padding: 12px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  font-size: 11px;
  line-height: 1.8;
}
.write-step-list header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.write-step-list p {
  margin: 8px 0;
  white-space: pre-wrap;
}
.write-history-item {
  display: grid;
  gap: 4px;
  text-align: left;
  width: 100%;
  padding: 10px;
  border-bottom: 1px solid var(--tp-line);
}
.history-delete {
  background: var(--tp-surface-sunken);
  text-decoration: line-through;
  color: var(--tp-text-muted);
}
.history-insert {
  background: var(--tp-pencil-soft);
  color: var(--tp-pencil-content);
}
@media (min-width: 960px) {
  .write-layout {
    height: max(620px, calc(100dvh - 118px));
    min-height: 0;
  }
  .write-desk,
  .write-outline,
  .write-copilot {
    min-height: 0;
    height: 100%;
  }
  .write-paper {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .write-toolbar,
  .write-paper-meta,
  .write-paper-status,
  .write-diff-legend {
    flex-shrink: 0;
  }
  .write-editor {
    flex: 1;
    min-height: 0;
    overflow: auto;
    scrollbar-width: thin;
  }
  .write-editor :deep(.tiptap) {
    min-height: 100%;
  }
  .write-side-body {
    min-height: 0;
    overflow: auto;
  }
  .write-sessions {
    min-height: 0;
    grid-template-rows: minmax(0, 1fr);
  }
  .write-session {
    min-height: 0;
  }
  .write-messages {
    min-height: 100px;
    max-height: none;
  }
  .write-session :deep(.tp-composer) {
    flex-shrink: 0;
  }
}
@media (min-width: 1440px) {
  .write-layout.has-two-assistants {
    grid-template-columns: 190px minmax(320px, 1fr) minmax(540px, calc(var(--copilot-width) + 170px));
  }
  .write-layout.has-two-assistants.is-collapsed {
    grid-template-columns: 208px minmax(0, 1fr);
  }
  .write-sessions.is-multi {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
  }
  .write-sessions.is-multi .write-session + .write-session {
    border-top: 0;
    border-left: 1px solid var(--tp-line);
    padding-top: 0;
    padding-left: 12px;
  }
  .write-sessions.is-multi .write-welcome {
    padding: 20px 6px;
  }
  .write-sessions.is-multi :deep(.tp-composer__input) {
    min-height: 80px;
  }
}
@media (min-width: 960px) and (max-width: 1199px) {
  .write-layout {
    height: max(620px, calc(100dvh - 180px));
    grid-template-columns: 156px minmax(270px, 1fr) 320px;
    gap: 12px;
  }
  .write-layout.is-collapsed {
    grid-template-columns: 180px minmax(0, 1fr);
  }
  .write-editor {
    padding: 16px 22px;
  }
  .write-paper-meta {
    padding: 20px 22px 0;
  }
  .write-task-note {
    max-width: 130px;
  }
  .write-experts {
    gap: 4px;
    padding-left: 10px;
    padding-right: 10px;
  }
  .write-experts button {
    font-size: 10px;
    padding: 3px;
  }
  .write-side-body {
    padding: 12px;
  }
  .write-resize {
    display: none;
  }
}
@media (max-width: 959px) {
  .write-mobile-switch {
    display: block;
  }
  .write-layout,
  .write-layout.is-collapsed {
    display: block;
    min-height: auto;
  }
  .write-outline,
  .write-copilot,
  .write-layout.is-collapsed .write-copilot {
    display: none;
  }
  .write-layout[data-view="outline"] .write-outline,
  .write-layout[data-view="assistant"] .write-copilot {
    display: flex;
    position: fixed;
    z-index: 42;
    top: 72px;
    bottom: 16px;
    right: 12px;
    width: min(440px, calc(100vw - 24px));
    min-height: 0;
    max-height: calc(100dvh - 90px);
    overflow: auto;
    background: var(--tp-surface);
  }
  .write-layout[data-view="outline"] .write-outline {
    width: min(300px, calc(100vw - 24px));
    left: 12px;
    right: auto;
  }
  .write-drawer-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: var(--tp-overlay);
    z-index: 41;
  }
  .write-close-drawer {
    display: block;
  }
  .write-resize {
    display: none;
  }
  .write-side-body {
    flex: 1;
  }
  .write-messages {
    max-height: calc(100dvh - 380px);
  }
  .write-editor {
    min-height: 550px;
    padding: 22px;
  }
  .write-paper-meta {
    padding: 20px 22px 0;
  }
  .write-editor :deep(.tp-prose) {
    font-size: 16px;
  }
  .write-editor :deep(.tp-prose h1) {
    font-size: 23px;
  }
  .write-copilot {
    border-radius: var(--tp-radius-l);
  }
  .write-toolbar {
    padding: 8px;
    gap: 2px;
  }
  .write-toolbar :deep(.tp-btn) {
    font-size: 10px;
  }
  .write-task-note {
    max-width: 140px;
  }
  .write-paper-status {
    font-size: 10px;
  }
  .write-selection-bubble {
    z-index: 46;
  }
}
</style>
