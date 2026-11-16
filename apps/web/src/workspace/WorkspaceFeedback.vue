<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import type { BackendServices, ProjectRead } from "@/services";
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
  textareaTextRange,
  writeDraft,
  type FeedbackDraft,
} from "./tasks/taskFeedbackDraft";

const props = defineProps<{ services: BackendServices; project: ProjectRead; workspaceId?: string }>();
type Batch = Awaited<ReturnType<BackendServices["feedback"]["get"]>>;
type Summary = Awaited<ReturnType<BackendServices["feedback"]["list"]>>["items"][number];
type Item = Awaited<ReturnType<BackendServices["feedback"]["item"]>>;
type ItemSummary = Awaited<ReturnType<BackendServices["feedback"]["items"]>>["items"][number];
type History = Awaited<ReturnType<BackendServices["feedback"]["versions"]>>;
type TaskSummary = Awaited<ReturnType<BackendServices["tasks"]["list"]>>["items"][number];
const batches = shallowRef<Summary[]>([]);
const batch = shallowRef<Batch>();
const items = shallowRef<ItemSummary[]>([]);
const tasks = shallowRef<TaskSummary[]>([]);
const original = ref("");
const originalOpen = ref(false);
const itemOpen = ref(false);
const selected = shallowRef<Item>();
const draft = ref<FeedbackDraft>({
  source_range: { from: 0, to: 1, text: "" },
  interpretation: "",
  certainty: "uncertain",
  correction: "",
  source_checked: false,
  task_id: null,
  new_task: null,
  evidence: [],
});
const linkMode = ref("none");
const reason = ref("");
const range = ref<{ from: number; to: number; text: string }>();
const history = shallowRef<History>();
const viewing = ref<number>();
const actionName: Record<string, string> = { create: "人工新增", update: "人工纠正", processed: "学生已处理", reopen: "撤销学生处理" };
const loading = ref(false);
const detailLoading = ref(false);
const busy = ref(false);
const error = ref("");
const listError = ref("");
const storageError = ref("");
const notice = ref("");
const mustReload = ref(false);
const unknown = ref(false);
const pending = shallowRef<{ kind: "batch" | "itemCreate" | "itemUpdate" | "decide"; batchId?: string; id?: string; input: unknown }>();
const originalKey = computed(() => draftKey(props.services.sourceKey, props.workspaceId ?? "workspace", props.project.id, "feedback-original", "new"));
const itemKey = computed(() =>
  draftKey(props.services.sourceKey, props.workspaceId ?? "workspace", props.project.id, "feedback-item", selected.value?.id ?? batch.value?.id ?? "new"),
);
let listRequest: AbortController | undefined;
let detailRequest: AbortController | undefined;
let mutationRequest: AbortController | undefined;
let restoring = false;

async function allTasks(signal: AbortSignal) {
  const result: TaskSummary[] = [];
  for (let offset = 0; !signal.aborted;) {
    const page = await props.services.tasks.list(props.project.id, { offset, limit: 100 }, signal);
    result.push(...page.items);
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  }
  return result;
}
async function load() {
  listRequest?.abort();
  const controller = new AbortController();
  listRequest = controller;
  loading.value = true;
  listError.value = "";
  const results = await Promise.allSettled([
    (async () => {
      const result: Summary[] = [];
      for (let offset = 0; !controller.signal.aborted;) {
        const page = await props.services.feedback.list(props.project.id, { offset, limit: 100 }, controller.signal);
        result.push(...page.items);
        offset += page.items.length;
        if (!page.items.length || offset >= page.total) break;
      }
      return result;
    })(),
    allTasks(controller.signal),
  ]);
  if (controller.signal.aborted) return;
  const failures: string[] = [];
  if (results[0].status === "fulfilled") batches.value = results[0].value;
  else failures.push(`反馈：${asApiError(results[0].reason).message}`);
  if (results[1].status === "fulfilled") tasks.value = results[1].value;
  else failures.push(`任务选项：${asApiError(results[1].reason).message}`);
  listError.value = failures.join("；");
  loading.value = false;
}
async function inspectBatch(id: string, internal = false) {
  if (!internal && (busy.value || unknown.value)) return;
  if (!internal) persist();
  detailRequest?.abort();
  const controller = new AbortController();
  detailRequest = controller;
  detailLoading.value = true;
  error.value = "";
  try {
    const source = await props.services.feedback.get(props.project.id, id, controller.signal);
    const result: ItemSummary[] = [];
    for (let offset = 0; !controller.signal.aborted;) {
      const page = await props.services.feedback.items(props.project.id, id, { offset, limit: 100 }, controller.signal);
      result.push(...page.items);
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) break;
    }
    if (!controller.signal.aborted) {
      batch.value = source;
      items.value = result;
      selected.value = undefined;
      itemOpen.value = false;
      range.value = undefined;
      history.value = undefined;
    }
  } catch (issue) {
    if (!controller.signal.aborted) error.value = asApiError(issue).message;
  } finally {
    if (!controller.signal.aborted) detailLoading.value = false;
  }
}
function captureRange(event: Event) {
  const field = event.target as HTMLTextAreaElement;
  range.value = batch.value ? textareaTextRange(batch.value.original_text, field.selectionStart, field.selectionEnd) : undefined;
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
    if (itemOpen.value)
      writeDraft(itemKey.value, {
        content: draft.value,
        baseVersion: selected.value?.version,
        reason: reason.value,
        linkMode: linkMode.value,
        pending: pending.value?.kind !== "batch" ? pending.value : undefined,
        unknown: pending.value?.kind !== "batch" && unknown.value,
      });
    storageError.value = "";
  } catch {
    storageError.value = "本机草稿保存失败，输入仍在当前页面，请保持页面打开。";
  }
}
function showOriginal() {
  if (busy.value || unknown.value) return;
  restoring = true;
  original.value = "";
  try {
    const saved = readDraft<{ text: string; pending?: typeof pending.value; unknown?: boolean }>(originalKey.value);
    if (typeof saved?.text === "string") original.value = saved.text;
    pending.value = saved?.pending;
    unknown.value = !!saved?.unknown;
  } catch (issue) {
    storageError.value = String(issue);
  }
  restoring = false;
  originalOpen.value = true;
}
function restoreItem() {
  restoring = true;
  try {
    const saved = readDraft<{
      content: FeedbackDraft;
      baseVersion?: number;
      reason?: string;
      linkMode?: string;
      pending?: typeof pending.value;
      unknown?: boolean;
    }>(itemKey.value);
    if (saved?.content?.source_range && Array.isArray(saved.content.evidence)) {
      draft.value = saved.content;
      reason.value = saved.reason ?? "";
      linkMode.value = saved.linkMode ?? "none";
      pending.value = saved.pending;
      unknown.value = !!saved.unknown;
      mustReload.value = !!selected.value && saved.baseVersion !== selected.value.version;
    }
  } catch (issue) {
    storageError.value = String(issue);
  }
  restoring = false;
}
async function openItem(id?: string) {
  if (!batch.value || busy.value || unknown.value) return;
  if (!id && !range.value) {
    error.value = "请在反馈原文中明确选择一段文字，再创建人工解释。";
    return;
  }
  persist();
  error.value = "";
  mustReload.value = false;
  history.value = undefined;
  reason.value = "";
  pending.value = undefined;
  if (id) {
    detailRequest?.abort();
    const controller = new AbortController();
    detailRequest = controller;
    detailLoading.value = true;
    try {
      const result = await props.services.feedback.item(props.project.id, id, controller.signal);
      if (controller.signal.aborted) return;
      selected.value = result;
      draft.value = normalizeFeedback(selected.value.content);
    } catch (issue) {
      if (!controller.signal.aborted) error.value = asApiError(issue).message;
      return;
    } finally {
      if (!controller.signal.aborted) detailLoading.value = false;
    }
  } else {
    selected.value = undefined;
    draft.value = {
      source_range: copy(range.value!),
      interpretation: "",
      certainty: "uncertain",
      correction: "",
      source_checked: false,
      task_id: null,
      new_task: null,
      evidence: [],
    };
  }
  linkMode.value = draft.value.new_task ? "new" : draft.value.task_id ? "existing" : "none";
  itemOpen.value = true;
  restoreItem();
}
function changeLink(mode: string) {
  if (mode !== "existing") draft.value.task_id = null;
  draft.value.new_task = mode === "new" ? (draft.value.new_task ?? emptyTask()) : null;
}
async function execute() {
  const command = pending.value;
  if (!command || busy.value) return;
  const projectId = props.project.id;
  const oldKey = command.kind === "batch" ? originalKey.value : itemKey.value;
  const controller = new AbortController();
  mutationRequest = controller;
  busy.value = true;
  error.value = "";
  unknown.value = true;
  persist();
  try {
    let result: Item | undefined;
    let createdBatch: Batch | undefined;
    if (command.kind === "batch")
      createdBatch = await props.services.feedback.create(projectId, command.input as Parameters<BackendServices["feedback"]["create"]>[1], controller.signal);
    if (command.kind === "itemCreate")
      result = await props.services.feedback.createItem(
        projectId,
        command.batchId!,
        command.input as Parameters<BackendServices["feedback"]["createItem"]>[2],
        controller.signal,
      );
    if (command.kind === "itemUpdate")
      result = await props.services.feedback.updateItem(
        projectId,
        command.id!,
        command.input as Parameters<BackendServices["feedback"]["updateItem"]>[2],
        controller.signal,
      );
    if (command.kind === "decide")
      result = await props.services.feedback.decide(
        projectId,
        command.id!,
        command.input as Parameters<BackendServices["feedback"]["decide"]>[2],
        controller.signal,
      );
    if (controller.signal.aborted) return;
    restoring = true;
    pending.value = undefined;
    unknown.value = false;
    mustReload.value = false;
    if (createdBatch) {
      originalOpen.value = false;
      original.value = "";
    }
    const targetBatch = createdBatch?.id ?? batch.value?.id;
    await load();
    if (controller.signal.aborted) return;
    if (targetBatch) await inspectBatch(targetBatch, true);
    if (controller.signal.aborted) return;
    if (result) {
      selected.value = result;
      draft.value = normalizeFeedback(result.content);
      linkMode.value = result.content.task_id ? "existing" : "none";
      itemOpen.value = true;
      history.value = undefined;
      reason.value = "";
    }
    try {
      localStorage.removeItem(oldKey);
    } catch {
      /* The confirmed service receipt is authoritative. */
    }
    restoring = false;
    notice.value = createdBatch ? "反馈原文已不可变保存，请人工选择范围并解释。" : "已保存学生处理记录；这不代表导师认可。";
  } catch (issue) {
    restoring = false;
    if (controller.signal.aborted) return;
    const problem = asApiError(issue);
    unknown.value = problem.status === undefined || problem.status >= 500 || problem.code === "INVALID_RESPONSE";
    mustReload.value = problem.status === 409;
    error.value = unknown.value ? "操作结果尚未确认，原输入及命令已保留。请确认原请求结果后继续。" : `${problem.message}（${problem.code}）`;
    if (!unknown.value) pending.value = undefined;
    persist();
  } finally {
    restoring = false;
    if (!controller.signal.aborted) busy.value = false;
  }
}
async function saveOriginal() {
  if (!original.value.trim()) {
    error.value = "请粘贴导师反馈原文。";
    return;
  }
  pending.value = { kind: "batch", input: { command_id: crypto.randomUUID(), expected_version: 0, original_text: original.value } };
  await execute();
}
async function saveItem() {
  if (!batch.value || busy.value || unknown.value || mustReload.value) return;
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
  if (linkMode.value === "existing" && !draft.value.task_id) {
    error.value = "请选择要关联的任务。";
    return;
  }
  pending.value = selected.value
    ? {
        kind: "itemUpdate",
        id: selected.value.id,
        input: { command_id: crypto.randomUUID(), expected_version: selected.value.version, content: copy(draft.value) },
      }
    : { kind: "itemCreate", batchId: batch.value.id, input: { command_id: crypto.randomUUID(), expected_version: 0, content: copy(draft.value) } };
  await execute();
}
async function decide(action: "processed" | "reopen") {
  if (!selected.value || busy.value || unknown.value || mustReload.value) return;
  if (JSON.stringify(draft.value) !== JSON.stringify(normalizeFeedback(selected.value.content))) {
    error.value = "请先保存当前解释，再对已保存版本作决定。";
    return;
  }
  pending.value = {
    kind: "decide",
    id: selected.value.id,
    input: { command_id: crypto.randomUUID(), expected_version: selected.value.version, action, reason: reason.value },
  };
  await execute();
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
    notice.value = "已读取新版，当前输入草稿保留，请核对后保存。";
  } catch (issue) {
    error.value = asApiError(issue).message;
  }
}
async function loadHistory() {
  if (!selected.value) return;
  const projectId = props.project.id;
  const id = selected.value.id;
  try {
    const result = await props.services.feedback.versions(projectId, id, { offset: 0, limit: 100 });
    if (props.project.id !== projectId || selected.value?.id !== id) return;
    history.value = result;
    viewing.value = history.value.items[0]?.version;
  } catch (issue) {
    error.value = asApiError(issue).message;
  }
}
watch([draft, original, reason, linkMode, pending, unknown], persist, { deep: true });
watch(
  () => props.project.id,
  () => {
    listRequest?.abort();
    detailRequest?.abort();
    mutationRequest?.abort();
    batches.value = [];
    batch.value = undefined;
    items.value = [];
    selected.value = undefined;
    originalOpen.value = false;
    itemOpen.value = false;
    pending.value = undefined;
    unknown.value = false;
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
  <main class="workspace-page studio-stack" aria-label="正式导师反馈">
    <header class="screen-heading">
      <div>
        <p class="tp-label">{{ project.name }} · 人工定位与解释</p>
        <h1 class="tp-display">导师反馈</h1>
        <p class="tp-caption">保留不可变原文，人工核对后关联任务与证据。学生处理不等于导师认可。</p>
      </div>
      <TpButton variant="primary" :disabled="busy || unknown" @click="showOriginal">粘贴导师反馈</TpButton>
    </header>
    <div class="screen-actions">
      <TpButton size="sm" :disabled="loading || busy" @click="load">刷新反馈与任务</TpButton><span class="tp-caption">{{ batches.length }} 份原文</span>
    </div>
    <p v-if="loading || detailLoading" role="status">正在读取导师反馈…</p>
    <p v-if="notice" role="status" class="studio-notice">{{ notice }}</p>
    <p v-if="listError || error || storageError" role="alert" class="studio-notice">{{ listError || error || storageError }}</p>
    <div v-if="unknown" class="screen-actions"><TpButton :loading="busy" @click="execute">确认原请求结果</TpButton></div>
    <Transition name="tp-expand" v-bind="panelMotionHooks"
      ><section
        v-if="originalOpen"
        class="tp-card feedback-panel studio-stack"
        aria-label="反馈原文录入"
        @keydown.esc="!busy && !unknown && (originalOpen = false)"
      >
        <h2 class="tp-heading">保存原始反馈</h2>
        <TpField v-slot="{ id }" label="导师反馈原文" required hint="保存后原文不可修改；解释和纠正另建版本。">
          <textarea :id="id" v-model="original" class="tp-input" rows="5" maxlength="10000" :disabled="busy || unknown" />
        </TpField>
        <div class="screen-actions">
          <TpButton variant="primary" :loading="busy" :disabled="unknown" @click="saveOriginal">保存反馈原文</TpButton
          ><TpButton
            :disabled="busy || unknown"
            @click="
              persist();
              originalOpen = false;
            "
            >取消并保留原文草稿</TpButton
          >
        </div>
      </section></Transition
    >
    <p v-if="!loading && !listError && !batches.length" class="studio-notice">暂无导师反馈，先粘贴合成演示意见或你有权保存的反馈。</p>
    <TransitionGroup tag="div" name="tp-list" v-bind="listMotionHooks" class="feedback-batches"
      ><TpButton
        v-for="source in batches"
        :key="source.id"
        :variant="batch?.id === source.id ? 'tonal' : 'outline'"
        :disabled="busy || unknown || detailLoading"
        :label="`查看反馈原文 ${source.preview}`"
        @click="inspectBatch(source.id)"
        >{{ source.preview }} · {{ source.item_count }} 条解释</TpButton
      ></TransitionGroup
    >
    <section v-if="batch" class="tp-card feedback-panel studio-stack" aria-label="反馈原文与解释">
      <h2 class="tp-heading">原文 · {{ batch.created_at }}</h2>
      <TpField v-slot="{ id }" label="只读导师反馈原文" hint="在原文中明确选择一段文字；相同句子以位置区分。">
        <textarea
          :id="id"
          class="tp-input feedback-original"
          rows="5"
          readonly
          :value="batch.original_text"
          :disabled="busy || unknown"
          @select="captureRange"
          @keyup="captureRange"
          @mouseup="captureRange"
        />
      </TpField>
      <p v-if="range" class="tp-caption">UTF-16 {{ range.from }}–{{ range.to }}：{{ range.text }}</p>
      <div class="screen-actions">
        <TpButton size="sm" :disabled="busy || unknown" @click="range = exactTextRange(batch.original_text, 0, batch.original_text.length)"
          >选择整份原文</TpButton
        ><TpButton :disabled="busy || unknown || !range" @click="openItem()">为选区建立人工解释</TpButton>
      </div>
      <p v-if="!items.length" class="tp-caption">尚无人工解释；系统未自动拆解或替导师作判断。</p>
      <TransitionGroup tag="div" name="tp-list" v-bind="listMotionHooks" class="studio-stack"
        ><article v-for="item in items" :key="item.id" class="feedback-item">
          <div>
            <strong>{{ item.preview }}</strong>
            <p class="tp-caption">
              {{ item.status === "processed" ? "学生已处理" : "待处理" }} · {{ item.certainty === "uncertain" ? "歧义 / 缺材料" : "人工已明确" }} · v{{
                item.version
              }}
            </p>
            <p v-if="item.needs_review" class="feedback-review">需复核：{{ item.review_reasons.join("；") }}</p>
          </div>
          <TpButton size="sm" :disabled="busy || unknown" :label="`查看反馈解释 ${item.preview}`" @click="openItem(item.id)">查看 / 纠正</TpButton>
        </article></TransitionGroup
      >
    </section>
    <Transition name="tp-expand" v-bind="panelMotionHooks"
      ><section
        v-if="itemOpen && batch"
        class="tp-card feedback-panel studio-stack"
        aria-label="人工反馈解释"
        @keydown.esc="!busy && !unknown && (itemOpen = false)"
      >
        <div class="screen-heading">
          <h2 class="tp-heading">{{ selected ? `解释与纠正 · v${selected.version}` : "新增人工解释" }}</h2>
          <TpButton
            variant="ghost"
            :disabled="busy || unknown"
            @click="
              persist();
              itemOpen = false;
            "
            >取消并保留解释草稿</TpButton
          >
        </div>
        <blockquote class="feedback-quote">
          {{ draft.source_range.text }}<small class="tp-caption">不可变原文 UTF-16 {{ draft.source_range.from }}–{{ draft.source_range.to }}</small>
        </blockquote>
        <TpButton
          v-if="range"
          size="sm"
          :disabled="busy || unknown"
          @click="
            draft.source_range = copy(range);
            draft.source_checked = false;
          "
          >将当前原文选区用于此解释</TpButton
        >
        <TpField v-slot="{ id }" label="人工解释" required>
          <textarea :id="id" v-model="draft.interpretation" class="tp-input" rows="3" maxlength="4000" :disabled="busy || unknown" />
        </TpField>
        <TpField v-slot="{ id }" label="解释确定性"
          ><TpSelect
            :id="id"
            v-model="draft.certainty"
            :disabled="busy || unknown"
            :options="[
              { value: 'uncertain', label: '有歧义 / 缺少材料，待核对' },
              { value: 'certain', label: '人工已明确' },
            ]"
        /></TpField>
        <TpField v-slot="{ id }" label="纠正 / 澄清说明">
          <textarea :id="id" v-model="draft.correction" class="tp-input" rows="2" maxlength="4000" :disabled="busy || unknown" />
        </TpField>
        <label class="feedback-check"
          ><input v-model="draft.source_checked" type="checkbox" class="checkbox checkbox-sm" :disabled="busy || unknown" />我已核对本条解释与原文范围</label
        >
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
            :options="[
              { value: '', label: '选择已有任务' },
              ...tasks.map((task) => ({
                value: task.id,
                label: `${task.title}${task.archived ? '（已归档）' : ''}`,
                disabled: task.archived && task.id !== draft.task_id,
              })),
            ]"
            @update:model-value="draft.task_id = $event || null"
        /></TpField>
        <Transition name="tp-expand" v-bind="panelMotionHooks"
          ><section v-if="linkMode === 'new' && draft.new_task" class="studio-stack" aria-label="反馈关联新任务">
            <h3 class="tp-subheading">原子创建关联任务</h3>
            <TaskContentForm v-model="draft.new_task" :services="services" :project-id="project.id" :tasks="tasks" :disabled="busy || unknown" /></section
        ></Transition>
        <EvidencePicker v-model="draft.evidence" :services="services" :project-id="project.id" :disabled="busy || unknown" />
        <p v-if="selected?.needs_review" role="status" class="feedback-review">旧证据需要复核：{{ selected.review_reasons.join("；") }}</p>
        <div class="screen-actions">
          <TpButton variant="primary" :loading="busy" :disabled="unknown || mustReload" @click="saveItem">保存人工解释</TpButton
          ><TpButton v-if="mustReload" @click="reloadBase">载入最新版本并保留输入</TpButton>
        </div>
        <template v-if="selected"
          ><hr />
          <TpField v-slot="{ id }" label="处理 / 撤销说明">
            <textarea :id="id" v-model="reason" class="tp-input" rows="2" maxlength="2000" :disabled="busy || unknown" />
          </TpField>
          <p class="tp-caption">决定针对已保存解释及证据。学生已处理仅表示学生决定。</p>
          <div class="screen-actions">
            <TpButton
              v-if="selected.status === 'open'"
              variant="seal"
              :disabled="
                busy ||
                unknown ||
                mustReload ||
                selected.needs_review ||
                !selected.content.source_checked ||
                (selected.content.certainty === 'uncertain' && !selected.content.correction?.trim()) ||
                JSON.stringify(draft) !== JSON.stringify(normalizeFeedback(selected.content))
              "
              @click="decide('processed')"
              >学生标记已处理</TpButton
            ><TpButton v-else :disabled="busy || unknown || mustReload" @click="decide('reopen')">撤销学生处理</TpButton
            ><TpButton variant="ghost" :disabled="busy" @click="loadHistory">查看反馈历史</TpButton>
          </div></template
        >
        <Transition name="tp-expand" v-bind="panelMotionHooks"
          ><section v-if="history" aria-label="反馈历史" class="studio-stack">
            <h3 class="tp-subheading">不可变纠正与处理历史</h3>
            <p v-if="history.total > history.items.length" class="tp-caption">显示最近 {{ history.items.length }} / {{ history.total }} 条。</p>
            <article v-for="entry in history.items" :key="entry.version">
              <TpButton size="sm" variant="ghost" @click="viewing = viewing === entry.version ? undefined : entry.version"
                >v{{ entry.version }} · {{ actionName[entry.action] ?? entry.action }} · {{ entry.reason || "无附加说明" }}</TpButton
              >
              <div v-if="viewing === entry.version" class="feedback-history">
                <blockquote>{{ entry.snapshot.content.source_range.text }}</blockquote>
                <p>{{ entry.snapshot.content.interpretation }}</p>
                <p>纠正：{{ entry.snapshot.content.correction || "无" }}</p>
                <p>{{ entry.snapshot.status === "processed" ? "学生已处理" : "待处理" }} · {{ entry.created_at }}</p>
                <p v-for="snapshot in entry.snapshot.evidence_snapshots" :key="snapshot.fingerprint">
                  {{ snapshot.label }}{{ snapshot.stale ? "（旧证据）" : "" }}
                </p>
              </div>
            </article>
          </section></Transition
        >
      </section></Transition
    >
  </main>
</template>

<style scoped>
.feedback-panel {
  padding: 24px;
}
.feedback-batches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.feedback-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--tp-line);
}
.feedback-check {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}
.feedback-quote {
  margin: 0;
  border-left: 3px solid var(--tp-ink);
  padding: 12px 16px;
  background: var(--tp-surface-sunken);
  white-space: pre-wrap;
}
.feedback-quote small {
  display: block;
  margin-top: 8px;
}
.feedback-original {
  font-family: var(--tp-font-body);
}
.feedback-review {
  padding: 8px 12px;
  color: var(--tp-warning-content);
  background: var(--tp-warning-soft);
  font-size: 13px;
}
.feedback-history {
  background: var(--tp-surface-sunken);
  padding: 12px;
  font-size: 13px;
  white-space: pre-wrap;
}
</style>
