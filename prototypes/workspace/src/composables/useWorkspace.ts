import { computed, onBeforeUnmount, ref } from "vue";
import { useEditor, type JSONContent } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { demoDocument, demoTitle } from "../fixtures/demoThesis";
import { prototypeAssistant, type AssistantService } from "../services/prototypeAssistant";
import type {
  AgentRole,
  AssistantMode,
  ChatMessage,
  OutlineItem,
  PanelLayout,
  ReviewReportData,
  RevisionCandidate,
  SelectionContext,
} from "../types";

const storageKey = "thesis-pilot:workspace-prototype:v1";

export function useWorkspace(service: AssistantService = prototypeAssistant) {
  const title = ref(demoTitle);
  const version = ref(1);
  const saved = ref("浏览器样稿");
  const error = ref("");
  const toast = ref("");
  const activeSection = ref("1 绪论");
  const selection = ref<SelectionContext | null>(null);
  const assistantOpen = ref(false);
  const focused = ref(false);
  const outlineOpen = ref(window.matchMedia("(min-width: 761px)").matches);
  const mode = ref<AssistantMode>("combined");
  const layout = ref<PanelLayout>("single");
  const role = ref<AgentRole>("writing");
  const secondRole = ref<AgentRole>("literature");
  const messages = ref<Record<AgentRole, ChatMessage[]>>({
    all: [],
    literature: [],
    writing: [],
    format: [],
    progress: [],
    review: [],
  });
  const candidate = ref<RevisionCandidate | null>(null);
  const report = ref<ReviewReportData | null>(null);
  const completed = ref<string[]>([]);
  const reminder = ref<string | null>(null);
  const deferredReminder = ref<string | null>(null);
  const outline = ref<OutlineItem[]>([]);
  const wordCount = ref(0);
  const busy = ref(false);
  let requestId = 0;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let initial: JSONContent | string = demoDocument;

  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const stored = JSON.parse(raw);
      if (
        stored?.schema !== 1 ||
        stored.document?.type !== "doc" ||
        !Array.isArray(stored.document.content) ||
        !Number.isSafeInteger(stored.version) ||
        stored.version < 1 ||
        !Array.isArray(stored.completed) ||
        stored.completed.some((item: unknown) => typeof item !== "string")
      )
        throw new Error("invalid draft");
      // Only nodes created by this prototype are restorable; reject unknown structures.
      const nodes = new Set([
        "doc",
        "paragraph",
        "text",
        "heading",
        "bulletList",
        "orderedList",
        "listItem",
        "blockquote",
        "hardBreak",
        "horizontalRule",
        "codeBlock",
        "table",
        "tableRow",
        "tableHeader",
        "tableCell",
      ]);
      const marks = new Set(["bold", "italic", "strike", "code", "link", "underline"]);
      const valid = (node: JSONContent): boolean =>
        nodes.has(node.type ?? "") &&
        (!node.marks || node.marks.every((mark) => marks.has(mark.type))) &&
        (!node.content || node.content.every(valid));
      if (!valid(stored.document)) throw new Error("unknown document node");
      initial = stored.document;
      version.value = stored.version;
      completed.value = stored.completed;
      saved.value = "已恢复浏览器样稿";
    }
  } catch {
    error.value =
      "浏览器样稿无法读取，已打开示例。原存储未覆盖；继续编辑前请导出或清理损坏的浏览器数据。";
    saved.value = "样稿恢复失败";
  }
  const restoreFailed = ref(Boolean(error.value));

  function notify(message: string) {
    toast.value = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.value = "";
    }, 4000);
  }

  function persist() {
    if (!editor.value || restoreFailed.value) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          schema: 1,
          document: editor.value.getJSON(),
          version: version.value,
          completed: completed.value,
        }),
      );
      saved.value = "已存入此浏览器";
    } catch {
      saved.value = "保存失败";
      error.value = "浏览器存储不可用。当前编辑仍在页面内，请勿关闭页面。";
    }
  }

  function refreshDocument() {
    if (!editor.value) return;
    const entries: OutlineItem[] = [];
    editor.value.state.doc.descendants((node, position) => {
      if (node.type.name === "heading")
        entries.push({
          id: `heading-${position}`,
          title: node.textContent,
          level: node.attrs.level,
          position: position + 1,
        });
    });
    outline.value = entries;
    wordCount.value = editor.value.getText().replace(/\s/g, "").length;
  }

  function captureSelection() {
    if (!editor.value) return;
    const { from, to, $from, $to } = editor.value.state.selection;
    const heading = [...outline.value].reverse().find((item) => item.position <= from);
    if (heading) activeSection.value = heading.title;
    if (from === to) {
      selection.value = null;
      return;
    }
    const sameParagraph = $from.parent === $to.parent && $from.parent.type.name === "paragraph";
    let plainText = sameParagraph;
    editor.value.state.doc.nodesBetween(from, to, (node) => {
      if (node.isInline && (!node.isText || node.marks.length > 0)) plainText = false;
    });
    selection.value = {
      from,
      to,
      text: editor.value.state.doc.textBetween(from, to, "\n"),
      version: version.value,
      plainText,
    };
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
      TableKit.configure({ table: { resizable: false } }),
    ],
    content: initial,
    editorProps: {
      attributes: { class: "paper-content", "aria-label": "论文正文", spellcheck: "false" },
    },
    onCreate: () => {
      refreshDocument();
    },
    onUpdate: () => {
      version.value += 1;
      refreshDocument();
      captureSelection();
      persist();
    },
    onSelectionUpdate: () => {
      captureSelection();
    },
  });

  const stale = computed(() =>
    Boolean(candidate.value && candidate.value.baseVersion !== version.value),
  );
  const selectionText = computed(() => selection.value?.text ?? "");
  const currentChapter = computed(() => {
    const position = editor.value?.state.selection.from ?? 1;
    return (
      [...outline.value].reverse().find((item) => item.level === 1 && item.position <= position)
        ?.title ?? "1 绪论"
    );
  });

  function openAssistant(nextRole?: AgentRole) {
    focused.value = false;
    assistantOpen.value = true;
    if (nextRole && nextRole !== "all") {
      mode.value = "specialist";
      role.value = nextRole;
    } else if (nextRole === "all") {
      mode.value = "combined";
    }
  }

  async function send(agent: AgentRole, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const context = selectionText.value;
    messages.value[agent].push({ id: crypto.randomUUID(), author: "student", text: trimmed });
    const response = await service.reply(agent, trimmed, context);
    messages.value[agent].push({ id: crypto.randomUUID(), author: "assistant", text: response });
  }

  async function revise() {
    const scope = selection.value;
    if (!scope || !editor.value) {
      error.value = "请先在正文中选中需要润色的文字。";
      return;
    }
    if (!scope.plainText) {
      error.value =
        "本轮小样只支持单个段落内未加格式的纯文本选区；跨段、带格式或复杂对象保持原样。";
      return;
    }
    if (scope.version !== version.value) {
      error.value = "选区已过期，请重新选择。";
      return;
    }
    error.value = "";
    const id = ++requestId;
    busy.value = true;
    const result = await service.revise(scope.text);
    if (id !== requestId) return;
    busy.value = false;
    if (result.proposed === scope.text) {
      error.value = "这段文字没有可演示的措辞替换。可选中研究背景中“系统可以根据…”这一段体验修订。";
      return;
    }
    candidate.value = {
      id: crypto.randomUUID(),
      original: scope.text,
      proposed: result.proposed,
      reason: result.reason,
      from: scope.from,
      to: scope.to,
      baseVersion: scope.version,
      status: "pending",
    };
    report.value = null;
    openAssistant();
  }

  function accept() {
    const item = candidate.value;
    const instance = editor.value;
    if (!item || item.status !== "pending" || !instance) return;
    if (
      item.baseVersion !== version.value ||
      instance.state.doc.textBetween(item.from, item.to) !== item.original
    ) {
      error.value = "正文已变化，请重新选择后生成。";
      return;
    }
    const protectedTokens = (text: string) =>
      text.match(/\[[^\]]*\]|\d+(?:\.\d+)?%?|[=+×÷]/g) ?? [];
    if (
      JSON.stringify(protectedTokens(item.original)) !==
      JSON.stringify(protectedTokens(item.proposed))
    ) {
      error.value = "候选改变了数字、引用或公式符号，已拒绝应用。";
      return;
    }
    instance
      .chain()
      .focus()
      .insertContentAt({ from: item.from, to: item.to }, { type: "text", text: item.proposed })
      .run();
    item.status = "accepted";
    selection.value = null;
    notify("修改已采纳，可在工具栏撤销");
  }

  function reject() {
    ++requestId;
    busy.value = false;
    if (candidate.value?.status === "pending") candidate.value.status = "rejected";
    error.value = "";
    notify("已保留原文");
  }

  async function runReview() {
    report.value = await service.review(version.value);
    candidate.value = null;
    error.value = "";
    openAssistant("review");
  }

  function locate(section: string) {
    const item = outline.value.find((entry) => entry.title === section);
    if (!item || !editor.value) {
      notify("该段落已变化，请在目录中重新定位");
      return;
    }
    editor.value.chain().focus().setTextSelection(item.position).scrollIntoView().run();
    activeSection.value = section;
  }

  function completeChapter() {
    const chapter = currentChapter.value;
    if (completed.value.includes(chapter)) {
      notify("本章已标记完成");
      return;
    }
    completed.value.push(chapter);
    reminder.value = chapter;
    persist();
  }

  function deferReminder() {
    deferredReminder.value = reminder.value;
    reminder.value = null;
    notify("建议已收起，可从进度面板查看");
  }

  function downloadReport() {
    if (!report.value) return;
    const result = report.value;
    const text = `# 论文评审示例报告\n\n本报告为交互原型固定样例，不是实际 AI 评审。\n基础版本：${result.version}\n参考分：${result.score}/100（示例量表）\n\n${result.issues.map((issue) => `## ${issue.title}\n位置：${issue.section}\n依据：${issue.evidence}\n建议：${issue.detail}`).join("\n\n")}\n\n未检查：${result.unchecked.join("、")}`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "论文评审示例报告.md";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  onBeforeUnmount(() => {
    ++requestId;
    clearTimeout(toastTimer);
  });
  return {
    title,
    editor,
    version,
    saved,
    error,
    toast,
    activeSection,
    selectionText,
    selection,
    assistantOpen,
    focused,
    outlineOpen,
    mode,
    layout,
    role,
    secondRole,
    messages,
    candidate,
    stale,
    report,
    completed,
    reminder,
    deferredReminder,
    outline,
    wordCount,
    busy,
    currentChapter,
    openAssistant,
    send,
    revise,
    accept,
    reject,
    runReview,
    locate,
    completeChapter,
    deferReminder,
    downloadReport,
    notify,
  };
}
