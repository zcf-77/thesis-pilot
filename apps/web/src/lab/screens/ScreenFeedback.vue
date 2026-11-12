<script setup lang="ts">
import { listMotionHooks } from "@/design/motion";

import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { PhArrowBendDownRight, PhArrowCounterClockwise, PhCheck, PhFileText, PhPaperclip, PhQuotes, PhQuestion, PhTarget } from "@phosphor-icons/vue";
import EvidenceChip from "@/components/domain/EvidenceChip.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import { recordFeedback, useFeedbackState, type FeedbackEntry, type FeedbackEvidence } from "../state/feedbackState";
import { usePreviewWorkspaceStore } from "../state/previewWorkspace";
import { addFeedbackTask, linkFeedbackToTask, usePlanState } from "../state/planState";
import { useLibraryState } from "../state/libraryState";
import { analyzeFeedback, feedbackSections, locateFeedback } from "../services/feedbackService";
import { startProjectJob } from "../state/jobState";

const feedbackState = useFeedbackState();
const entries = computed(() => feedbackState.value.entries);
const workspace = usePreviewWorkspaceStore();
const plan = usePlanState();
const library = useLibraryState();
const route = useRoute();
const filter = ref<"all" | "pending" | "handled">("all");
const selectedId = ref("F-07.1");
const sourceOpen = ref(false);
const locationDraft = ref("");
const notice = ref("");
const entryOpen = ref(false);
const entryDraft = ref("");
const entryError = ref("");
const entryInput = ref<HTMLTextAreaElement>();
const entryTrigger = ref<HTMLElement>();
const editing = ref(false);
const editError = ref("");
const interpretationDraft = ref({ suggestion: "", locate: "", task: "", acceptance: "" });
const relatedTaskId = ref("");
const taskError = ref("");
const linkError = ref("");
const evidenceVersion = ref(workspace.current.document.version);
const evidenceSectionId = ref("");
const evidenceText = ref("");
const evidenceMaterialId = ref("");
const evidenceMaterialVersion = ref(0);
const evidenceOptionsOpen = ref(false);
let splitJob: ReturnType<typeof startProjectJob> | undefined;
let requestToken = 0;
let splitTimer: ReturnType<typeof setTimeout> | undefined;
let runningEntry: FeedbackEntry | undefined;

const maxFeedbackLength = 10_000;
const filtered = computed(() => entries.value.filter((entry) => filter.value === "all" || entry.handled === (filter.value === "handled")));
const selected = computed(() => filtered.value.find((entry) => entry.id === selectedId.value));
const handledCount = computed(() => entries.value.filter((entry) => entry.handled).length);
const ambiguousCount = computed(() => entries.value.filter((entry) => entry.ambiguous).length);
const batchCount = computed(() => new Set(entries.value.map((entry) => entry.batchId)).size);
const sections = computed(() => feedbackSections(workspace.current.document.html));
const evidenceDocument = computed(() => workspace.current.document.history.find((item) => item.version === evidenceVersion.value));
const evidenceSections = computed(() => feedbackSections(evidenceDocument.value?.html ?? ""));
const evidenceSection = computed(() => evidenceSections.value.find((item) => item.id === evidenceSectionId.value));
const evidenceMaterial = computed(() => library.value.materials.find((item) => item.id === evidenceMaterialId.value && !item.removed));
const missingLocation = computed(() => !!selected.value?.locate && !locateFeedback(selected.value.locate, sections.value));
const needsReview = computed(
  () =>
    !!selected.value?.evidence.some((item) =>
      item.kind === "document"
        ? item.version !== workspace.current.document.version
        : item.materialId
          ? library.value.materials.find((material) => material.id === item.materialId && !material.removed)?.version !== item.version
          : false,
    ),
);
const splitting = computed(() => selected.value?.splitStatus === "queued" || selected.value?.splitStatus === "running");
const linkedTask = computed(() => plan.value.tasks.find((task) => task.id === selected.value?.taskId));
const canConfirm = computed(
  () =>
    !!selected.value &&
    selected.value.status === "interpreted" &&
    !selected.value.ambiguous &&
    selected.value.evidence.length > 0 &&
    selected.value.verified &&
    !needsReview.value &&
    !missingLocation.value,
);
watch(evidenceSectionId, () => {
  evidenceText.value = evidenceSection.value?.text ?? "";
});
watch(evidenceMaterialId, () => {
  evidenceMaterialVersion.value = evidenceMaterial.value?.version ?? 0;
});

async function openEntry() {
  entryOpen.value = true;
  entryError.value = "";
  await nextTick();
  entryInput.value?.focus();
}

async function closeEntry() {
  entryOpen.value = false;
  entryError.value = "";
  await nextTick();
  entryTrigger.value?.querySelector("button")?.focus();
}

function saveFeedback() {
  if (!entryOpen.value) return;
  if (!entryDraft.value.trim()) {
    entryError.value = "请先粘贴导师反馈，不能只包含空格或换行。";
    entryInput.value?.focus();
    return;
  }
  if (entryDraft.value.length > maxFeedbackLength) {
    entryError.value = "一次最多录入 10,000 个字符。内容已完整保留在输入框，请缩短后保存。";
    entryInput.value?.focus();
    return;
  }
  const id = `F-P${String(feedbackState.value.nextPastedId++).padStart(2, "0")}`;
  const firstLine =
    entryDraft.value
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? "文字反馈";
  const titleCharacters = Array.from(firstLine);
  const entry: FeedbackEntry = {
    id,
    batchId: id,
    status: "recorded",
    source: "粘贴文字",
    recordedAt: new Date().toISOString(),
    title: titleCharacters.slice(0, 28).join("") + (titleCharacters.length > 28 ? "…" : ""),
    summary: "文字录入 · 尚未拆解",
    original: entryDraft.value,
    date: "",
    locate: "",
    task: "",
    suggestion: "",
    excerpt: "",
    evidence: [],
    ambiguous: false,
    handled: false,
    verified: false,
  };
  recordFeedback(entry, "录入原文", "粘贴文字；原文逐字保留，导师姓名和针对版本未知。");
  entries.value.unshift(entry);
  filter.value = "all";
  selectedId.value = id;
  entryDraft.value = "";
  notice.value = "反馈原文已录入，尚未拆解；保存状态以页面顶部为准。";
  void closeEntry();
}

function onEntryKeydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    void closeEntry();
  } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    saveFeedback();
  }
}

function recordedTime(iso: string | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

watch(filtered, (list) => {
  if (!linkError.value && !list.some((entry) => entry.id === selectedId.value)) selectedId.value = list[0]?.id ?? "";
});
watch(selectedId, () => {
  sourceOpen.value = false;
  locationDraft.value = "";
  editing.value = false;
  relatedTaskId.value = "";
  taskError.value = "";
  evidenceVersion.value = workspace.current.document.version;
  evidenceSectionId.value = "";
  evidenceText.value = "";
  evidenceOptionsOpen.value = false;
});
watch(
  () => route.query.feedback,
  (value) => {
    if (typeof value === "string") {
      filter.value = "all";
      selectedId.value = value;
      linkError.value = entries.value.some((entry) => entry.id === value) ? "" : "这条反馈不存在或不属于当前项目，请从左侧选择实际意见。";
    } else {
      linkError.value = "";
    }
  },
  { immediate: true },
);
watch(
  () => workspace.activeId,
  () => {
    cancelSplit();
    entryOpen.value = false;
    entryDraft.value = "";
    selectedId.value = entries.value[0]?.id ?? "";
    notice.value = "";
    linkError.value = "";
  },
);
onBeforeUnmount(cancelSplit);
watch(
  feedbackState,
  (state, previous) => {
    if (previous && previous !== state) cancelSplit();
    for (const entry of state.entries) {
      if (entry !== runningEntry && (entry.splitStatus === "queued" || entry.splitStatus === "running")) {
        entry.splitStatus = "cancelled";
        recordFeedback(entry, "恢复待整理记录", "先前整理没有有效运行上下文，已保留原文，可重试。");
      }
    }
  },
  { immediate: true },
);

function markHandled() {
  if (!selected.value || !canConfirm.value) return;
  selected.value.handled = true;
  recordFeedback(selected.value, "学生已处理", "学生核对当前证据后记录；不代表导师认可。", workspace.current.document.version);
  notice.value = "已记录你的处理声明，并关联当前修改证据。";
}

function undoHandled() {
  if (!selected.value) return;
  selected.value.handled = false;
  selected.value.verified = false;
  recordFeedback(selected.value, "撤销处理声明", "保留修改证据和原处理记录。");
  notice.value = "已撤销处理声明，修改证据仍然保留。";
}

function saveLocation() {
  if (!selected.value || !locationDraft.value) return;
  const section = locateFeedback(locationDraft.value, sections.value);
  if (!section) {
    notice.value = "未找到对应正文位置，请从当前章节中选择；原意见保留。";
    return;
  }
  selected.value.locate = locationDraft.value;
  selected.value.ambiguous = false;
  selected.value.studentLocated = true;
  selected.value.title = selected.value.task || selected.value.segment?.text.trim().slice(0, 28) || selected.value.title;
  selected.value.summary = "你补充的定位 · 尚缺修改证据";
  if (!selected.value.task || selected.value.task.startsWith("待明确")) selected.value.task = `核对「${section.title}」中的原意见并补充修改证据`;
  recordFeedback(selected.value, "补充定位", locationDraft.value);
  notice.value = "已保留你补充的定位；原话未改动，尚不能标记已处理。";
}

function cancelSplit() {
  requestToken += 1;
  if (splitTimer) clearTimeout(splitTimer);
  const job = splitJob;
  splitJob = undefined;
  job?.cancel();
  if (runningEntry && ["queued", "running"].includes(runningEntry.splitStatus ?? "")) {
    runningEntry.splitStatus = "cancelled";
    recordFeedback(runningEntry, "取消整理", "保留原文，没有产生拆解项或任务。");
  }
  runningEntry = undefined;
}

function startSplit() {
  if (!selected.value || splitting.value || selected.value.status !== "recorded") return;
  cancelSplit();
  const entry = selected.value;
  const targetState = feedbackState.value;
  const projectId = workspace.activeId;
  const token = ++requestToken;
  runningEntry = entry;
  entry.splitStatus = "queued";
  entry.splitError = "";
  const sourceSections = sections.value.map((item) => ({ ...item }));
  splitJob = startProjectJob(
    workspace.current,
    {
      title: "导师反馈整理",
      kind: "反馈",
      route: "/screens/feedback?feedback=" + entry.id,
      sourceId: "feedback-" + entry.id,
      input: `正文 v${workspace.current.document.version} · ${entry.original.length} 字反馈`,
      snapshot: { feedbackId: entry.id, documentVersion: workspace.current.document.version },
    },
    { cancel: cancelSplit, retry: startSplit },
  );
  const job = splitJob;
  recordFeedback(entry, "开始原文整理", "确定性模拟按语句拆解并提出任务、验收和章节建议；所有含义仍由学生核对。");
  splitTimer = setTimeout(() => {
    if (token !== requestToken || projectId !== workspace.activeId || targetState !== feedbackState.value || !job.isActive()) return;
    entry.splitStatus = "running";
    splitTimer = setTimeout(() => {
      if (token !== requestToken || projectId !== workspace.activeId || targetState !== feedbackState.value || !job.isActive()) return;
      try {
        const parts = analyzeFeedback(entry.original, sourceSections);
        const newEntries = parts.map((proposal, index): FeedbackEntry => ({
          ...entry,
          id: `${entry.id}.${index + 1}`,
          status: "interpreted",
          origin: "mock",
          title: proposal.task.slice(0, 28),
          summary: `第 ${index + 1} 项 · 模拟建议待核对`,
          segment: proposal.segment,
          suggestion: proposal.suggestion,
          task: proposal.task,
          locate: proposal.locate,
          acceptance: proposal.acceptance,
          uncertainty: proposal.uncertainty,
          evidence: [],
          ambiguous: proposal.ambiguous,
          handled: false,
          verified: false,
          splitStatus: undefined,
          history: [
            ...(entry.history ?? []),
            {
              id: crypto.randomUUID(),
              at: new Date().toLocaleString("zh-CN"),
              action: "模拟意见拆解",
              detail: `字符范围 ${proposal.segment.start + 1}—${proposal.segment.end}；${proposal.uncertainty}`,
            },
          ],
        }));
        const index = entries.value.findIndex((item) => item.id === entry.id);
        if (index >= 0 && newEntries.length) {
          entries.value.splice(index, 1, ...newEntries);
          if (selectedId.value === entry.id) selectedId.value = newEntries[0]!.id;
          notice.value = `已按原文整理为 ${newEntries.length} 项，请逐项核对理解与任务；原文保持完整。`;
        }
        job.finish(newEntries.some((item) => item.ambiguous) ? "partial" : "done", `${newEntries.length} 条待核对建议；未创建任务或修改正文。`);
      } catch (error) {
        entry.splitStatus = "failed";
        entry.splitError = error instanceof Error ? error.message : "整理失败，原文已保留，可重试或手动整理。";
        recordFeedback(entry, "整理失败", entry.splitError);
        job.finish("failed", entry.splitError);
      }
      runningEntry = undefined;
    }, 450);
  }, 250);
}

function beginManual() {
  if (!selected.value) return;
  cancelSplit();
  const entry = selected.value;
  entry.status = "interpreted";
  entry.origin = "student";
  entry.segment = { start: 0, end: entry.original.length, text: entry.original };
  entry.suggestion = entry.original;
  entry.ambiguous = true;
  entry.summary = "手动整理 · 待核对";
  recordFeedback(entry, "手动整理", "以完整原文作为一个核对项，尚未创建任务。");
  beginEdit();
}

function beginEdit() {
  if (!selected.value) return;
  interpretationDraft.value = {
    suggestion: selected.value.suggestion,
    locate: selected.value.locate,
    task: selected.value.task,
    acceptance: selected.value.acceptance ?? "",
  };
  editing.value = true;
  editError.value = "";
}

function saveInterpretation() {
  const entry = selected.value;
  const draft = interpretationDraft.value;
  if (!entry) return;
  if (!draft.suggestion.trim() || !draft.task.trim() || !draft.locate.trim()) {
    editError.value = "请填写你的理解、章节位置与任务名称；无法确定时可以取消，继续保留待明确状态。";
    return;
  }
  recordFeedback(
    entry,
    "学生纠正",
    `原理解：${entry.suggestion}\n原位置：${entry.locate || "未知"}\n原任务：${entry.task || "未建立"}\n新理解：${draft.suggestion}\n新位置：${draft.locate}\n新任务：${draft.task}`,
  );
  entry.suggestion = draft.suggestion;
  entry.locate = draft.locate.trim();
  entry.task = draft.task.trim();
  entry.acceptance = draft.acceptance.trim();
  entry.title = entry.task;
  entry.summary = `${entry.locate} · 学生已整理`;
  entry.ambiguous = false;
  entry.origin = "student";
  entry.studentLocated = false;
  entry.verified = false;
  entry.handled = false;
  editing.value = false;
  notice.value = "已保存你的理解与任务内容；原文未改动，请重新核对证据。";
}

function createTask() {
  const entry = selected.value;
  if (!entry || entry.ambiguous || !entry.task.trim()) return;
  const result = addFeedbackTask(
    plan.value,
    {
      title: entry.task,
      chapter: entry.locate,
      feedbackId: entry.id,
      acceptance: entry.acceptance || entry.suggestion,
    },
    workspace.current.deadline,
  );
  if (!result.ok) {
    taskError.value = result.errors.join("；");
    notice.value = "任务尚未创建，反馈与计划保持不变。请调整项目约束后重试，或关联已有任务。";
    return;
  }
  const task = result.task;
  taskError.value = "";
  entry.taskId = task.id;
  linkFeedbackToTask(plan.value, entry.id, task.id);
  recordFeedback(entry, "采纳创建任务", `${task.title}（${task.id}）；任务尚未确认完成。`);
  notice.value = "任务已加入当前项目计划，尚未确认完成。";
}

function linkTask() {
  const entry = selected.value;
  const task = plan.value.tasks.find((item) => item.id === relatedTaskId.value);
  if (!entry || !task) return;
  const error = linkFeedbackToTask(plan.value, entry.id, task.id);
  if (error) {
    taskError.value = error;
    return;
  }
  recordFeedback(entry, "关联已有任务", `${entry.taskId ? `原关联 ${entry.taskId}；` : ""}${task.title}（${task.id}）`);
  entry.taskId = task.id;
  taskError.value = "";
  notice.value = "已关联计划中的任务，任务状态保持不变。";
}
function unlinkTask() {
  const entry = selected.value;
  if (!entry?.taskId) return;
  linkFeedbackToTask(plan.value, entry.id);
  recordFeedback(entry, "解除任务关联", `原关联 ${entry.taskId}；任务和历史均保留。`);
  entry.taskId = undefined;
  notice.value = "已解除关联，任务及历史保留。";
}

function preserveEvidence(entry: FeedbackEntry) {
  if (entry.evidence.length) {
    entry.previousEvidence ??= [];
    entry.previousEvidence.push({ at: new Date().toLocaleString("zh-CN"), evidence: entry.evidence.map((item) => ({ ...item })), excerpt: entry.excerpt });
  }
}
function saveEvidence(entry: FeedbackEntry, evidence: FeedbackEvidence, replace: (item: FeedbackEvidence) => boolean) {
  preserveEvidence(entry);
  entry.evidence = [...entry.evidence.filter((item) => !replace(item)), evidence];
  entry.excerpt = entry.evidence.map((item) => `${item.label} v${item.version}\n${item.excerpt ?? "原件内容请通过来源链接核对。"}`).join("\n\n");
  entry.verified = false;
  entry.handled = false;
  sourceOpen.value = true;
}
function linkDocument(useSelectedVersion = false) {
  const entry = selected.value;
  if (!entry) return;
  const version = useSelectedVersion ? evidenceVersion.value : workspace.current.document.version;
  const document = workspace.current.document.history.find((item) => item.version === version);
  if (!document) {
    notice.value = "指定正文版本不存在，未关联到其他版本。";
    return;
  }
  const parts = feedbackSections(document.html);
  const located = locateFeedback(entry.locate, parts);
  const nextBlock = located ? parts[parts.indexOf(located) + 1] : undefined;
  const section = useSelectedVersion
    ? parts.find((item) => item.id === evidenceSectionId.value)
    : ((nextBlock?.title.startsWith("正文片段") ? nextBlock : located) ?? parts.find((item) => item.title.startsWith("正文片段")) ?? parts[0]);
  const text = useSelectedVersion ? evidenceText.value.trim() : (section?.text ?? "");
  if (!section || !text.trim()) {
    notice.value = "当前正文为空，请先完成实际修改后再关联证据。";
    return;
  }
  if (!section.text.includes(text)) {
    notice.value = "摘录必须逐字来自所选版本片段，不能新增没有出处的修改证据。";
    return;
  }
  saveEvidence(
    entry,
    {
      id: crypto.randomUUID(),
      kind: "document",
      label: section.title,
      version,
      excerpt: text,
      sectionId: section.id,
      route: `/screens/write?version=${version}&chapter=${encodeURIComponent(section.title)}`,
    },
    (item) => item.kind === "document",
  );
  recordFeedback(entry, "关联正文证据", `保存正文 v${version} 的「${section.title}」具体摘录，旧证据保留。`, version);
  notice.value = "已关联实际片段，请查看摘录并核对；关联本身不代表已处理。";
}
function linkMaterialEvidence() {
  const entry = selected.value;
  const material = evidenceMaterial.value;
  const revision = material?.versions.find((item) => item.version === evidenceMaterialVersion.value);
  if (!entry || !material || !revision) {
    notice.value = "指定资料或版本不存在，未改动证据。";
    return;
  }
  const excerpt = revision.extracted || `原件：${revision.originalName}；请打开资料查看实际文件。`;
  saveEvidence(
    entry,
    {
      id: crypto.randomUUID(),
      kind: "file",
      materialId: material.id,
      label: material.name,
      version: revision.version,
      excerpt,
      route: `/screens/library?material=${material.id}&version=${revision.version}`,
    },
    (item) => item.materialId === material.id,
  );
  recordFeedback(entry, "关联资料证据", `资料 ${material.name} v${revision.version}；原件与旧证据保留。`);
  notice.value = "已关联资料版本，需核对其内容确实回应这条意见。";
}
function removeEvidence(id: string) {
  const entry = selected.value;
  if (!entry) return;
  preserveEvidence(entry);
  entry.evidence = entry.evidence.filter((item) => item.id !== id);
  entry.verified = false;
  entry.handled = false;
  entry.excerpt = entry.evidence.map((item) => item.excerpt ?? item.label).join("\n\n");
  recordFeedback(entry, "解除证据", "原件不删除，旧关联保留在历史。");
}
function restoreEvidence(index: number) {
  const entry = selected.value;
  const previous = entry?.previousEvidence?.[index];
  if (!entry || !previous) return;
  const copy = { evidence: previous.evidence.map((item) => ({ ...item })), excerpt: previous.excerpt };
  preserveEvidence(entry);
  entry.evidence = copy.evidence;
  entry.excerpt = copy.excerpt;
  entry.verified = false;
  entry.handled = false;
  recordFeedback(entry, "恢复旧证据关联", "保留指定旧版本；恢复后必须重新核验，不冒充最新证据。");
}
</script>

<template>
  <div class="screen-page feedback-page">
    <header class="screen-heading">
      <div>
        <p class="tp-label feedback-eyebrow">FEEDBACK / 每条意见，都有回音</p>
        <h1 class="tp-display">导师反馈</h1>
        <p class="screen-lead">原话留在这里，修改落到具体处。</p>
      </div>
      <div class="feedback-heading-actions">
        <div class="feedback-counts" aria-label="反馈处理概览">
          <div><b class="tp-num">{{ entries.length - handledCount }}</b><span>待处理</span></div>
          <div><b class="tp-num">{{ ambiguousCount }}</b><span>待明确</span></div>
          <div><b class="tp-num">{{ handledCount }}</b><span>已处理</span></div>
        </div>
        <div ref="entryTrigger">
          <TpButton variant="primary" :aria-expanded="entryOpen" aria-controls="feedback-entry" @click="openEntry">录入反馈</TpButton>
        </div>
      </div>
    </header>

    <Transition name="tp-swap">
      <form
        v-if="entryOpen"
        id="feedback-entry"
        class="screen-panel feedback-entry"
        aria-labelledby="feedback-entry-title"
        novalidate
        @submit.prevent="saveFeedback"
        @keydown="onEntryKeydown"
      >
        <header class="feedback-entry__head">
          <div>
            <p class="tp-label">保留导师原话</p>
            <h2 id="feedback-entry-title" class="tp-heading">粘贴反馈文字</h2>
          </div>
          <span class="tp-caption">完整保留原话，后续整理与处理分别记录</span>
        </header>
        <TpField v-slot="{ id, invalid, describedby }" label="反馈原文" required :error="entryError" hint="保留你粘贴的全部文字与换行。最多 10,000 个字符。">
          <textarea
            :id="id"
            ref="entryInput"
            v-model="entryDraft"
            class="tp-input feedback-entry__input"
            rows="6"
            :aria-invalid="invalid || undefined"
            :aria-describedby="describedby"
            placeholder="在这里粘贴导师的反馈…"
            @input="entryError = ''"
          />
        </TpField>
        <footer class="feedback-entry__footer">
          <p class="tp-caption">Enter 换行 · Ctrl / ⌘ + Enter 保存 · Esc 取消</p>
          <div><TpButton variant="ghost" @click="closeEntry">取消</TpButton><TpButton type="submit" variant="primary">保存反馈</TpButton></div>
        </footer>
      </form>
    </Transition>

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
      <p class="tp-caption"><TpIcon :icon="PhPaperclip" :size="14" />{{ batchCount }} 次反馈 · 原文与历史版本一并保留</p>
    </div>

    <div class="feedback-layout">
      <aside class="feedback-inbox" aria-label="导师意见列表">
        <div class="feedback-inbox__head"><span class="tp-label">意见索引</span><span class="tp-mono">{{ filtered.length }} 条</span></div>
        <TransitionGroup name="tp-list" tag="div" class="tp-list-group feedback-inbox-list" v-bind="listMotionHooks">
          <button
            v-for="entry in filtered"
            :key="entry.id"
            type="button"
            class="feedback-item"
            :class="{ 'is-selected': selectedId === entry.id }"
            :aria-pressed="selectedId === entry.id"
            @click="
              linkError = '';
              selectedId = entry.id;
            "
          >
            <span class="feedback-item__meta"
              ><span class="tp-mono">{{ entry.id }}</span><span>{{ entry.status === "recorded" ? "文字录入" : entry.date.slice(0, 5) }}</span></span
            >
            <strong>{{ entry.title }}</strong>
            <span class="tp-caption">{{ entry.summary }}</span>
            <span class="feedback-item__state"
              ><TpIcon :icon="entry.handled ? PhCheck : entry.ambiguous ? PhQuestion : PhFileText" :size="13" />{{
                entry.status === "recorded"
                  ? "原文已录入，尚未拆解"
                  : entry.handled
                    ? "你已标记处理"
                    : entry.ambiguous
                      ? "待补充定位"
                      : entry.evidence.length
                        ? "待核对修改证据"
                        : "待补充修改证据"
              }}</span
            >
          </button>
        </TransitionGroup>
        <p v-if="!filtered.length" class="feedback-empty tp-caption">当前筛选下暂无意见。</p>
        <div class="feedback-inbox__note">
          <span class="feedback-monogram">{{ selected?.source === "粘贴文字" ? "文" : "周" }}</span>
          <div>
            <b>{{ selected?.source === "粘贴文字" ? "文字录入" : "周老师" }}</b>
            <p class="tp-caption">{{ selected?.source === "粘贴文字" ? "保留粘贴的完整原文" : "样例导师 · 微信转述" }}</p>
          </div>
        </div>
      </aside>

      <Transition name="tp-swap" mode="out-in">
        <p :key="'feedback-state-0'" v-if="linkError" class="screen-panel feedback-reading tp-caption" role="alert">{{ linkError }}</p>
        <article :key="selected.id" v-else-if="selected" class="screen-panel feedback-reading">
          <header class="feedback-reading__head">
            <div class="feedback-reading__label">
              <TpIcon :icon="PhQuotes" :size="18" /><span class="tp-label">导师原话</span
              ><TpVersion v-if="selected.version !== undefined" :v="selected.version" prefix="针对正文 " /><TpStatus
                v-else
                tone="ghost"
                label="论文版本未指定"
                size="sm"
              />
            </div>
            <span class="tp-mono">{{ selected.recordedAt ? "录入时间 " + recordedTime(selected.recordedAt) : selected.date }}</span>
          </header>
          <blockquote class="feedback-original">{{ selected.original }}</blockquote>
          <div class="feedback-original__foot"><span>{{ selected.source }}</span><span>原文完整保留</span></div>

          <Transition name="tp-swap" mode="out-in">
            <section :key="'state-0'" v-if="selected.status === 'recorded'" class="feedback-recorded tp-ghost" aria-label="文字录入状态">
              <TpStatus tone="neutral" label="原文已录入" size="sm" />
              <h2 class="tp-heading">
                {{
                  splitting
                    ? selected.splitStatus === "queued"
                      ? "等待整理"
                      : "正在整理原文"
                    : selected.splitStatus === "failed"
                      ? "整理未完成"
                      : selected.splitStatus === "cancelled"
                        ? "已取消整理"
                        : "尚未拆解"
                }}
              </h2>
              <p v-if="selected.splitError" role="alert">{{ selected.splitError }}</p>
              <p v-else>按语句和已有章节模拟整理含义、任务与检查项。模糊位置会保留待明确；由你核对，绝不自动建立任务。</p>
              <p class="tp-caption">当前项目正文 v{{ workspace.current.document.version }} · 导师反馈时间与针对版本仍未知。</p>
              <div class="screen-actions">
                <TpButton v-if="splitting" variant="ghost" @click="cancelSplit">取消整理</TpButton>
                <template v-else>
                  <TpButton variant="primary" @click="startSplit">{{
                    selected.splitStatus === "failed" || selected.splitStatus === "cancelled" ? "重试整理" : "整理意见建议"
                  }}</TpButton>
                  <TpButton variant="outline" @click="beginManual">手动整理</TpButton>
                </template>
              </div>
            </section>

            <section
              :key="'state-1'"
              v-else
              class="feedback-interpretation"
              :class="selected.ambiguous ? 'tp-ghost' : selected.handled || selected.studentLocated || selected.origin === 'student' ? 'tp-ink' : 'tp-pencil'"
              aria-label="当前意见拆解"
            >
              <div class="feedback-section-label">
                <TpIcon :icon="selected.studentLocated ? PhTarget : selected.ambiguous ? PhQuestion : PhArrowBendDownRight" :size="16" /><span
                  class="tp-label"
                  >{{
                    selected.studentLocated
                      ? "你补充的定位 · 尚缺修改证据"
                      : selected.ambiguous
                        ? "这一处，还需要你判断"
                        : selected.origin === "student"
                          ? "你的理解与任务"
                          : selected.origin === "mock"
                            ? "模拟助手拆解 · 供你核对"
                            : "AI 拆解 · 自制样例，供你核对"
                  }}</span
                ><TpSeal v-if="selected.handled" text="已处理" :animate="false" />
              </div>
              <h2 class="tp-heading">{{ selected.title }}</h2>
              <blockquote v-if="selected.segment" class="feedback-segment">
                <span class="tp-caption"
                  >对应原文字符 {{ selected.segment.start + 1 }}—{{ selected.segment.end }} ·
                  {{
                    selected.origin === "mock" ? "模拟建议，原话逐字保留" : selected.origin === "segmented" ? "仅按段落整理，尚未理解含义" : "原文范围保持不变"
                  }}</span
                >
                <p>{{ selected.segment.text }}</p>
              </blockquote>
              <p v-if="selected.studentLocated" class="feedback-suggestion">
                你将这条意见定位至「{{ selected.locate }}」。这个位置来自你的补充，导师原话保持不变；接下来请核对原意见并补充对应修改证据。
              </p>
              <p v-else class="feedback-suggestion">{{ selected.suggestion }}</p>
              <p v-if="selected.uncertainty" class="tp-caption">{{ selected.uncertainty }}</p>
              <p v-if="missingLocation" class="tp-caption feedback-stale" role="status">
                当前正文未找到「{{ selected.locate }}」，请重新选择实际位置；原理解和证据仍保留。
              </p>
              <details v-if="selected.studentLocated" class="feedback-prior tp-pencil tp-disclosure">
                <summary>查看原 AI 拆解（补充定位前）</summary>
                <p>{{ selected.suggestion }}</p>
              </details>
              <div v-if="selected.locate" class="feedback-location">
                <TpIcon :icon="PhTarget" :size="14" />{{ selected.locate }}<span>·</span><span>{{ selected.task }}</span>
              </div>
              <form v-if="selected.ambiguous || missingLocation" class="feedback-locate-form" @submit.prevent="saveLocation">
                <label for="feedback-location">根据你掌握的上下文，补充位置</label>
                <div>
                  <TpSelect
                    id="feedback-location"
                    class="feedback-location-select"
                    v-model="locationDraft"
                    :options="[
                      { value: '', label: '选择当前正文中的位置', disabled: true },
                      ...sections.map((section) => ({ value: section.title, label: section.title })),
                    ]"
                  /><TpButton type="submit" :disabled="!locationDraft" variant="outline">保存定位</TpButton>
                </div>
              </form>
              <Transition name="tp-swap" mode="out-in">
                <form :key="'state-0'" v-if="editing" class="feedback-edit" @submit.prevent="saveInterpretation" @keydown.esc.prevent="editing = false">
                  <TpField v-slot="{ id }" label="你的理解" required>
                    <textarea :id="id" v-model="interpretationDraft.suggestion" class="tp-input" rows="3" />
                  </TpField>
                  <TpField v-slot="{ id }" label="章节或具体位置" required hint="位置由你根据正文判断；不确定时保留待明确。">
                    <input :id="id" v-model="interpretationDraft.locate" class="tp-input" placeholder="例如：3.1 总体架构" />
                  </TpField>
                  <TpField v-slot="{ id }" label="任务名称" required>
                    <input :id="id" v-model="interpretationDraft.task" class="tp-input" />
                  </TpField>
                  <TpField v-slot="{ id }" label="验收条件" optional>
                    <textarea :id="id" v-model="interpretationDraft.acceptance" class="tp-input" rows="2" />
                  </TpField>
                  <p v-if="editError" class="tp-caption" role="alert">{{ editError }}</p>
                  <div class="screen-actions">
                    <TpButton type="submit" variant="primary">保存理解与任务</TpButton><TpButton variant="ghost" @click="editing = false">取消编辑</TpButton>
                  </div>
                </form>
                <TpButton :key="'state-1'" v-else class="feedback-edit-trigger" variant="outline" size="sm" @click="beginEdit">编辑理解与任务</TpButton>
              </Transition>
            </section>
          </Transition>

          <section v-if="selected.status === 'interpreted'" class="feedback-task-link" aria-label="关联计划任务">
            <div>
              <p class="tp-label">让修改有下一步</p>
              <h3 class="tp-subheading">关联计划任务</h3>
            </div>
            <RouterLink v-if="linkedTask" class="feedback-link" :to="{ path: '/screens/plan', query: { task: linkedTask.id } }"
              >{{ linkedTask.title }} · 打开任务 ↗</RouterLink
            >
            <TpButton v-if="linkedTask" variant="ghost" size="sm" @click="unlinkTask">解除任务关联</TpButton>
            <p v-else class="tp-caption">整理和关联不会自动确认任务完成。你可以选已有任务，也可以采纳新任务。</p>
            <p v-if="taskError" class="feedback-stale tp-ghost" role="alert">{{ taskError }}</p>
            <div class="feedback-link-actions">
              <label class="feedback-task-select"
                ><span class="tp-caption">已有任务</span
                ><TpSelect
                  v-model="relatedTaskId"
                  aria-label="选择已有任务"
                  :options="[{ value: '', label: '选择当前项目任务' }, ...plan.tasks.map((task) => ({ value: task.id, label: task.title }))]"
              /></label>
              <TpButton variant="outline" :disabled="!relatedTaskId" @click="linkTask">关联已有任务</TpButton>
              <TpButton v-if="!selected.taskId" variant="seal" :disabled="selected.ambiguous || !selected.task.trim()" @click="createTask"
                >采纳并创建任务</TpButton
              >
            </div>
          </section>

          <section v-if="selected.status === 'interpreted'" class="feedback-evidence" aria-label="关联修改证据">
            <header>
              <div>
                <p class="tp-label">从意见到修改</p>
                <h3 class="tp-subheading">关联的修改证据</h3>
              </div>
              <TpStatus
                :tone="selected.evidence.length ? 'neutral' : 'ghost'"
                :label="selected.evidence.length ? `${selected.evidence.length} 份证据` : '尚缺证据'"
                size="sm"
              />
            </header>
            <Transition name="tp-swap" mode="out-in">
              <TransitionGroup
                key="boundary-first"
                name="tp-list"
                tag="div"
                v-bind="listMotionHooks"
                v-if="selected.evidence.length"
                class="feedback-evidence__chips tp-list-group"
              >
                <div v-for="item in selected.evidence" :key="item.id" class="screen-actions">
                  <EvidenceChip :evidence="item" /><RouterLink v-if="item.route" class="feedback-link tp-caption" :to="item.route">查看来源 ↗</RouterLink
                  ><TpButton size="sm" variant="ghost" @click="removeEvidence(item.id)">解除</TpButton>
                </div>
              </TransitionGroup>
            </Transition>
            <p v-if="needsReview" class="feedback-stale tp-ghost" role="status">
              正文或资料已更新，当前证据基于旧稿或旧资料。旧记录已保留，请查看实际修改后重新关联并核对。
            </p>
            <p class="tp-caption">{{ selected.evidence.length ? "核对修改内容与这条意见是否一致，再记录你的处理结果。" : selected.excerpt }}</p>
            <TpButton v-if="selected.evidence.length" variant="ghost" size="sm" :aria-expanded="sourceOpen" @click="sourceOpen = !sourceOpen"
              ><TpIcon :icon="PhFileText" :size="14" />{{ sourceOpen ? "收起修改摘录" : "查看修改摘录" }}</TpButton
            >
            <Transition name="tp-swap">
              <blockquote v-if="sourceOpen" class="feedback-excerpt">
                <span class="tp-label">已关联版本 · 修改摘录</span>
                <p>{{ selected.excerpt }}</p>
              </blockquote>
            </Transition>
            <div class="screen-actions feedback-source-actions">
              <TpButton variant="outline" size="sm" @click="linkDocument()">{{ selected.evidence.length ? "更新为当前正文证据" : "关联当前正文" }}</TpButton>
              <TpButton variant="ghost" size="sm" :aria-expanded="evidenceOptionsOpen" @click="evidenceOptionsOpen = !evidenceOptionsOpen"
                >选择具体片段或资料</TpButton
              >
              <RouterLink class="feedback-link" :to="{ path: '/screens/write', query: { chapter: selected.locate } }">查看当前正文 ↗</RouterLink>
              <RouterLink
                v-for="item in selected.evidence.filter((item) => item.kind === 'document')"
                :key="item.id"
                class="feedback-link"
                :to="{ path: '/screens/write', query: { version: String(item.version), chapter: selected.locate } }"
                >查看证据版本 v{{ item.version }} ↗</RouterLink
              >
            </div>
            <Transition name="tp-swap">
              <div v-if="evidenceOptionsOpen" class="feedback-edit feedback-evidence-picker">
                <TpField v-slot="{ id }" label="正文证据版本"
                  ><TpSelect
                    :id="id"
                    v-model="evidenceVersion"
                    @change="evidenceSectionId = ''"
                    :options="
                      workspace.current.document.history.map((version) => ({ value: version.version, label: `正文 v${version.version} · ${version.cause}` }))
                    "
                /></TpField>
                <TpField v-slot="{ id }" label="具体修改片段"
                  ><TpSelect
                    :id="id"
                    v-model="evidenceSectionId"
                    :options="[
                      { value: '', label: '选择实际片段' },
                      ...evidenceSections.map((section) => ({ value: section.id, label: `${section.title} · ${section.text.slice(0, 35)}` })),
                    ]"
                /></TpField>
                <TpField v-slot="{ id }" label="证据摘录" hint="可缩小范围；必须逐字来自所选片段。">
                  <textarea :id="id" v-model="evidenceText" class="tp-input" rows="3" />
                </TpField>
                <TpButton size="sm" variant="outline" :disabled="!evidenceSectionId || !evidenceText.trim()" @click="linkDocument(true)">关联选定片段</TpButton>
                <TpField v-slot="{ id }" label="修改资料"
                  ><TpSelect
                    :id="id"
                    v-model="evidenceMaterialId"
                    :options="[
                      { value: '', label: '选择当前项目资料' },
                      ...library.materials.filter((item) => !item.removed).map((material) => ({ value: material.id, label: material.name })),
                    ]"
                /></TpField>
                <TpField v-if="evidenceMaterial" v-slot="{ id }" label="资料证据版本"
                  ><TpSelect
                    :id="id"
                    v-model="evidenceMaterialVersion"
                    :options="evidenceMaterial.versions.map((revision) => ({ value: revision.version, label: `v${revision.version} · ${revision.reason}` }))"
                /></TpField>
                <TpButton size="sm" variant="outline" :disabled="!evidenceMaterial || !evidenceMaterialVersion" @click="linkMaterialEvidence"
                  >关联选定资料版本</TpButton
                >
              </div>
            </Transition>
          </section>

          <footer v-if="selected.status === 'interpreted'" class="feedback-decision">
            <template v-if="selected.handled">
              <div>
                <TpSeal text="你已标记处理" :animate="false" />
                <p class="tp-caption">这是你的处理声明，不代表导师已认可。</p>
              </div>
              <TpButton variant="ghost" @click="undoHandled"><TpIcon :icon="PhArrowCounterClockwise" />撤销处理声明</TpButton>
            </template>
            <template v-else>
              <div>
                <label class="feedback-verify"
                  ><input
                    v-model="selected.verified"
                    type="checkbox"
                    class="checkbox checkbox-sm"
                    :disabled="selected.ambiguous || !selected.evidence.length || needsReview || missingLocation"
                  /><span>我已核对修改与这条意见一致</span></label
                >
                <p class="tp-caption">
                  {{
                    needsReview
                      ? "旧版证据需复核，更新关联后再确认。"
                      : selected.ambiguous
                        ? "先整理理解与具体位置，再补充对应修改证据。"
                        : !selected.evidence.length
                          ? "关联修改证据后，才可以记录处理结果。"
                          : "标记已处理不会改变正文，也不代表导师已认可。"
                  }}
                </p>
              </div>
              <TpButton variant="seal" :disabled="!canConfirm" @click="markHandled"><TpIcon :icon="PhCheck" />标记已处理</TpButton>
            </template>
          </footer>
          <details class="feedback-history tp-disclosure">
            <summary>处理历史 <span class="tp-mono">{{ selected.history?.length ?? 0 }}</span></summary>
            <TransitionGroup class="tp-list-group" name="tp-list" tag="ol" v-bind="listMotionHooks">
              <li v-for="item in selected.history" :key="item.id">
                <div><b>{{ item.action }}</b><span class="tp-caption">{{ item.at }}{{ item.version ? ` · 正文 v${item.version}` : "" }}</span></div>
                <p>{{ item.detail }}</p>
              </li>
            </TransitionGroup>
            <div v-for="(snapshot, index) in selected.previousEvidence" :key="index" class="feedback-old-evidence">
              <p class="tp-label">保留的旧证据 · {{ snapshot.at }}</p>
              <div class="feedback-evidence__chips"><EvidenceChip v-for="item in snapshot.evidence" :key="item.id" :evidence="item" /></div>
              <p>{{ snapshot.excerpt }}</p>
              <TpButton size="sm" variant="ghost" @click="restoreEvidence(index)">恢复这次证据关联</TpButton>
            </div>
          </details>
        </article>
        <div :key="'feedback-state-2'" v-else class="screen-panel feedback-empty-state">
          <TpIcon :icon="PhQuotes" :size="32" />
          <h2 class="tp-heading">这里暂时没有意见</h2>
          <p class="tp-caption">试试切换到全部意见，查看保留的原文和处理记录。</p>
          <div class="screen-actions">
            <TpButton variant="outline" @click="filter = 'all'">查看全部意见</TpButton><TpButton variant="primary" @click="openEntry">录入第一条反馈</TpButton>
          </div>
        </div>
      </Transition>
    </div>
    <p class="feedback-notice tp-caption" role="status" aria-live="polite">{{ notice }}</p>
  </div>
</template>

<style scoped>
.feedback-eyebrow {
  margin-bottom: 12px;
}
.feedback-heading-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 32px;
}
.feedback-entry {
  padding: 24px 32px;
}
.feedback-entry__head,
.feedback-entry__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
}
.feedback-entry__head {
  margin-bottom: 20px;
}
.feedback-entry__head h2 {
  margin-top: 8px;
}
.feedback-entry__input {
  width: 100%;
  min-height: 180px;
  height: auto;
  resize: vertical;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.feedback-entry__footer {
  margin-top: 20px;
}
.feedback-entry__footer > div {
  display: flex;
  gap: 8px;
  margin-left: auto;
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
.feedback-item:hover {
  background: var(--tp-surface-sunken);
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
.feedback-original {
  margin: 24px 32px 16px;
  font-family: var(--tp-font-prose);
  font-size: 20px;
  line-height: 1.95;
  color: var(--tp-ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.feedback-original__foot {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 0 32px 24px;
  font-size: 11px;
  color: var(--tp-text-muted);
}
.feedback-interpretation {
  margin: 0 32px;
  padding: 20px 24px;
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
.feedback-suggestion {
  margin-top: 12px;
  line-height: 1.8;
  color: var(--tp-text);
}
.feedback-prior {
  margin-top: 16px;
  padding: 12px 16px;
  font-size: 12px;
}
.feedback-prior summary {
  cursor: pointer;
}
.feedback-prior p {
  margin-top: 8px;
  line-height: 1.8;
}
.feedback-location {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  font-size: 12px;
  color: var(--tp-text-muted);
}
.feedback-locate-form {
  margin-top: 16px;
}
.feedback-locate-form label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
}
.feedback-locate-form > div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.feedback-location-select {
  flex: 1;
  min-width: 180px;
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
.feedback-evidence h3 {
  margin-top: 8px;
}
.feedback-evidence__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.feedback-evidence > .tp-btn {
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
}
.feedback-decision {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 32px;
  border-top: 1px solid var(--tp-line);
}
.feedback-decision .tp-caption {
  margin-top: 8px;
  font-size: 11px;
}
.feedback-verify {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.feedback-verify input {
  flex-shrink: 0;
}
.feedback-empty {
  padding: 24px 12px;
}
.feedback-empty-state {
  display: grid;
  justify-items: center;
  gap: 20px;
  padding: 64px 32px;
  text-align: center;
}
.feedback-notice {
  min-height: 20px;
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
.feedback-edit {
  display: grid;
  gap: 16px;
  margin-top: 20px;
}
.feedback-edit .tp-input {
  width: 100%;
}
.feedback-edit textarea {
  min-height: 80px;
  height: auto;
  resize: vertical;
  line-height: 1.7;
}
.feedback-edit-trigger {
  margin-top: 16px;
}
.feedback-task-link {
  display: grid;
  gap: 16px;
  margin: 24px 32px 0;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--tp-line);
}
.feedback-task-link h3 {
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
.feedback-source-actions {
  margin-top: 16px;
  gap: 12px;
}
.feedback-stale {
  padding: 16px;
  margin-bottom: 16px;
  font-size: 12px;
  line-height: 1.7;
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
.feedback-history li > div {
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
.feedback-old-evidence {
  padding-top: 16px;
  margin-top: 20px;
  border-top: 1px dashed var(--tp-line);
}
@media (max-width: 1150px) {
  .feedback-layout {
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 24px;
  }
  .feedback-decision {
    align-items: start;
    flex-direction: column;
  }
  .feedback-reading__head {
    padding: 24px 24px 0;
  }
  .feedback-original {
    margin: 20px 24px 16px;
    font-size: 18px;
  }
  .feedback-original__foot {
    margin-right: 24px;
    margin-left: 24px;
  }
  .feedback-interpretation {
    margin: 0 24px;
    padding: 20px;
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
  .feedback-entry {
    padding: 20px;
  }
  .feedback-entry__head {
    align-items: start;
    flex-direction: column;
    gap: 12px;
  }
  .feedback-recorded {
    margin: 0 16px 20px;
    padding: 20px;
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
    grid-column: 1 / -1;
    padding: 0 0 8px;
  }
  .feedback-inbox__note {
    display: none;
  }
  .feedback-item {
    padding: 16px 12px;
    gap: 8px;
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
  .feedback-original {
    margin: 20px;
    font-size: 17px;
  }
  .feedback-original__foot {
    margin: 0 20px 20px;
  }
  .feedback-interpretation {
    margin: 0 16px;
    padding: 16px;
  }
  .feedback-interpretation h2 {
    font-size: 18px;
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
}
</style>
