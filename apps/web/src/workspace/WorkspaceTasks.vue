<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import type { BackendServices, ProjectRead } from "@/services";
import { asApiError } from "@/services/errors";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import TaskContentForm from "./tasks/TaskContentForm.vue";
import { copy, draftKey, emptyTask, normalizeTask, readDraft, taskDraftError, writeDraft, type TaskContentDraft } from "./tasks/taskFeedbackDraft";

const props = defineProps<{ services: BackendServices; project: ProjectRead; workspaceId?: string }>();
type Task = Awaited<ReturnType<BackendServices["tasks"]["get"]>>;
type Summary = Awaited<ReturnType<BackendServices["tasks"]["list"]>>["items"][number];
type History = Awaited<ReturnType<BackendServices["tasks"]["versions"]>>;
const items = shallowRef<Summary[]>([]);
const boardVersion = ref(0);
const loading = ref(false);
const busy = ref(false);
const listError = ref("");
const error = ref("");
const notice = ref("");
const editorOpen = ref(false);
const selected = shallowRef<Task>();
const draft = ref<TaskContentDraft>(emptyTask());
const history = shallowRef<History>();
const viewing = ref<number>();
const reason = ref("");
const mustReload = ref(false);
const storageError = ref("");
const pending = shallowRef<{ kind: "create" | "update" | "decide" | "reorder"; id?: string; input: unknown }>();
const unknown = ref(false);
const scope = computed(() => draftKey(props.services.sourceKey, props.workspaceId ?? "workspace", props.project.id, "task", selected.value?.id ?? "new"));
const statusName: Record<string, string> = { todo: "待开始", doing: "进行中", verify: "待验收", confirmed: "学生已确认", rework: "返工" };
const actionName: Record<string, string> = { create: "人工新增", update: "人工编辑", confirm: "学生确认完成", rework: "标记返工", reopen: "撤销完成确认" };
let listRequest: AbortController | undefined;
let detailRequest: AbortController | undefined;
let mutationRequest: AbortController | undefined;
let restoring = false;
async function load() {
  listRequest?.abort();
  const controller = new AbortController();
  listRequest = controller;
  loading.value = true;
  listError.value = "";
  try {
    const result: Summary[] = [];
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
    if (!controller.signal.aborted) {
      items.value = result;
      boardVersion.value = version ?? 0;
    }
  } catch (issue) {
    if (!controller.signal.aborted) listError.value = issue instanceof Error ? issue.message : asApiError(issue).message;
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}
function persist() {
  if (restoring || !editorOpen.value) return;
  try {
    writeDraft(scope.value, {
      content: draft.value,
      baseVersion: selected.value?.version,
      reason: reason.value,
      pending: pending.value,
      unknown: unknown.value,
    });
    storageError.value = "";
  } catch {
    storageError.value = "本机草稿保存失败，当前输入仍留在页面，请保持页面打开。";
  }
}
function restore() {
  restoring = true;
  try {
    const saved = readDraft<{ content: TaskContentDraft; baseVersion?: number; reason?: string; pending?: typeof pending.value; unknown?: boolean }>(
      scope.value,
    );
    if (saved?.content?.title !== undefined && Array.isArray(saved.content.evidence)) {
      draft.value = saved.content;
      reason.value = saved.reason ?? "";
      pending.value = saved.pending;
      unknown.value = !!saved.unknown;
      mustReload.value = !!selected.value && saved.baseVersion !== selected.value.version;
    }
  } catch (issue) {
    storageError.value = String(issue);
  }
  restoring = false;
}
async function open(id?: string) {
  if (busy.value || unknown.value) return;
  persist();
  detailRequest?.abort();
  const controller = new AbortController();
  detailRequest = controller;
  error.value = "";
  notice.value = "";
  history.value = undefined;
  viewing.value = undefined;
  mustReload.value = false;
  reason.value = "";
  pending.value = undefined;
  if (id) {
    try {
      const result = await props.services.tasks.get(props.project.id, id, controller.signal);
      if (controller.signal.aborted) return;
      selected.value = result;
      draft.value = normalizeTask(result.content);
    } catch (issue) {
      if (!controller.signal.aborted) error.value = asApiError(issue).message;
      return;
    }
  } else {
    selected.value = undefined;
    draft.value = emptyTask();
  }
  editorOpen.value = true;
  restore();
}
async function reloadBase() {
  if (!selected.value) {
    await load();
    mustReload.value = false;
    return;
  }
  const id = selected.value.id;
  try {
    selected.value = await props.services.tasks.get(props.project.id, id);
    mustReload.value = false;
    pending.value = undefined;
    await load();
    notice.value = "已载入最新服务版本，当前输入草稿保持；请检查后再保存。";
  } catch (issue) {
    error.value = asApiError(issue).message;
  }
}
async function execute() {
  const command = pending.value;
  if (!command || busy.value) return;
  const projectId = props.project.id;
  const key = scope.value;
  const controller = new AbortController();
  mutationRequest = controller;
  busy.value = true;
  error.value = "";
  unknown.value = true;
  persist();
  try {
    let result: Task | undefined;
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
    if (result) {
      selected.value = result;
      draft.value = normalizeTask(result.content);
      history.value = undefined;
      reason.value = "";
    }
    try {
      localStorage.removeItem(key);
    } catch {
      /* Server receipt remains authoritative. */
    }
    await load();
    notice.value = command.kind === "reorder" ? "任务顺序已保存。" : "已保存至服务，版本与操作历史已保留。";
  } catch (issue) {
    if (controller.signal.aborted) return;
    const problem = asApiError(issue);
    unknown.value = problem.status === undefined || problem.status >= 500 || problem.code === "INVALID_RESPONSE";
    mustReload.value = problem.status === 409;
    error.value = unknown.value ? "操作结果尚未确认，输入和原命令已保留。请确认原请求结果后继续。" : `${problem.message}（${problem.code}）`;
    if (!unknown.value) pending.value = undefined;
    persist();
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
async function save() {
  error.value = taskDraftError(draft.value, selected.value?.id);
  if (error.value || busy.value || unknown.value || mustReload.value) return;
  pending.value = selected.value
    ? {
        kind: "update",
        id: selected.value.id,
        input: { command_id: crypto.randomUUID(), expected_version: selected.value.version, content: copy(draft.value) },
      }
    : { kind: "create", input: { command_id: crypto.randomUUID(), expected_board_version: boardVersion.value, content: copy(draft.value) } };
  await execute();
}
async function decide(action: "confirm" | "rework" | "reopen") {
  if (!selected.value || busy.value || unknown.value || mustReload.value) return;
  if (JSON.stringify(draft.value) !== JSON.stringify(normalizeTask(selected.value.content))) {
    error.value = "请先保存当前输入，再对已保存版本作决定。";
    return;
  }
  if (action === "rework" && !reason.value.trim()) {
    error.value = "请先填写返工原因。";
    return;
  }
  pending.value = {
    kind: "decide",
    id: selected.value.id,
    input: { command_id: crypto.randomUUID(), expected_version: selected.value.version, action, reason: reason.value },
  };
  await execute();
}
async function move(index: number, offset: number) {
  if (busy.value || unknown.value || loading.value) return;
  const order = items.value.map((item) => item.id);
  const other = index + offset;
  if (other < 0 || other >= order.length) return;
  [order[index], order[other]] = [order[other]!, order[index]!];
  pending.value = { kind: "reorder", input: { command_id: crypto.randomUUID(), expected_board_version: boardVersion.value, task_ids: order } };
  await execute();
}
async function loadHistory() {
  if (!selected.value) return;
  const projectId = props.project.id;
  const id = selected.value.id;
  try {
    const result = await props.services.tasks.versions(projectId, id, { offset: 0, limit: 100 });
    if (props.project.id !== projectId || selected.value?.id !== id) return;
    history.value = result;
    viewing.value = history.value.items[0]?.version;
  } catch (issue) {
    error.value = asApiError(issue).message;
  }
}
watch([draft, reason, pending, unknown], persist, { deep: true });
watch(
  () => props.project.id,
  () => {
    listRequest?.abort();
    detailRequest?.abort();
    mutationRequest?.abort();
    editorOpen.value = false;
    selected.value = undefined;
    pending.value = undefined;
    unknown.value = false;
    items.value = [];
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
  <main class="workspace-page studio-stack" aria-label="正式任务">
    <header class="screen-heading">
      <div>
        <p class="tp-label">{{ project.name }} · 人工任务</p>
        <h1 class="tp-display">任务与产物证据</h1>
        <p class="tp-caption">学生确认完成；系统核对证据与依赖，所有决定可追溯。</p>
      </div>
      <TpButton variant="primary" :disabled="busy || unknown || loading" @click="open()">新增任务</TpButton>
    </header>
    <div class="screen-actions">
      <TpButton size="sm" :disabled="busy || loading" @click="load">刷新任务</TpButton
      ><span class="tp-caption">{{ items.length }} 项 · 排序版本 {{ boardVersion }}</span>
    </div>
    <p v-if="loading" role="status">正在读取正式任务…</p>
    <p v-if="listError" role="alert" class="studio-notice">{{ listError }}</p>
    <p v-if="notice" role="status" class="studio-notice">{{ notice }}</p>
    <p v-if="error && !editorOpen" role="alert" class="studio-notice">{{ error }}</p>
    <div v-if="unknown && !editorOpen" class="screen-actions"><TpButton :loading="busy" @click="execute">确认原请求结果</TpButton></div>
    <p v-if="!loading && !listError && !items.length" class="studio-notice">暂无任务。新增任务并写明验收条件，再关联实际产物证据。</p>
    <TransitionGroup tag="ol" name="tp-list" v-bind="listMotionHooks" class="task-list studio-stack">
      <li v-for="(task, index) in items" :key="task.id" class="tp-card task-row">
        <div>
          <strong>{{ task.title }}</strong>
          <p class="tp-caption">
            {{ statusName[task.status] }} · v{{ task.version }}{{ task.due_date ? ` · ${task.due_date}` : "" }}{{ task.archived ? " · 已归档" : "" }}
          </p>
          <p v-if="task.needs_review" class="task-review">需复核：{{ task.review_reasons.join("；") }}</p>
        </div>
        <div class="screen-actions">
          <TpButton size="sm" :disabled="busy || unknown" :label="`编辑任务 ${task.title}`" @click="open(task.id)">查看 / 编辑</TpButton
          ><TpButton size="sm" variant="ghost" :label="`上移任务 ${task.title}`" :disabled="busy || unknown || index === 0" @click="move(index, -1)"
            >上移</TpButton
          ><TpButton
            size="sm"
            variant="ghost"
            :label="`下移任务 ${task.title}`"
            :disabled="busy || unknown || index === items.length - 1"
            @click="move(index, 1)"
            >下移</TpButton
          >
        </div>
      </li>
    </TransitionGroup>
    <Transition name="tp-expand" v-bind="panelMotionHooks"
      ><section v-if="editorOpen" class="tp-card task-editor studio-stack" aria-label="任务编辑器" @keydown.esc="!busy && !unknown && (editorOpen = false)">
        <div class="screen-heading">
          <h2 class="tp-heading">{{ selected ? `任务详情 · v${selected.version}` : "新增正式任务" }}</h2>
          <TpButton
            :disabled="busy || unknown"
            variant="ghost"
            @click="
              persist();
              editorOpen = false;
            "
            >取消并保留草稿</TpButton
          >
        </div>
        <p class="tp-caption">{{ selected ? statusName[selected.status] : "人工录入" }}。编辑字段不会自动确认完成；取消保留本机输入。</p>
        <p v-if="selected?.needs_review" role="status" class="task-review">旧证据需要复核：{{ selected.review_reasons.join("；") }}</p>
        <TaskContentForm v-model="draft" :services="services" :project-id="project.id" :task-id="selected?.id" :tasks="items" :disabled="busy || unknown" />
        <p v-if="error || storageError" role="alert" class="studio-notice">{{ error || storageError }}</p>
        <div class="screen-actions">
          <TpButton variant="primary" :loading="busy" :disabled="unknown || mustReload" @click="save">保存任务</TpButton
          ><TpButton v-if="mustReload" @click="reloadBase">载入最新版本并保留输入</TpButton
          ><TpButton v-if="unknown" :loading="busy" @click="execute">确认原请求结果</TpButton>
        </div>
        <template v-if="selected"
          ><hr />
          <TpField v-slot="{ id }" label="决定 / 返工原因">
            <textarea :id="id" v-model="reason" class="tp-input" rows="2" maxlength="2000" :disabled="busy || unknown" />
          </TpField>
          <p class="tp-caption">决定针对已保存版本。先保存当前修改，再进行学生确认。</p>
          <div class="screen-actions">
            <TpButton
              variant="seal"
              :disabled="
                busy ||
                unknown ||
                mustReload ||
                selected.needs_review ||
                selected.status === 'confirmed' ||
                JSON.stringify(draft) !== JSON.stringify(normalizeTask(selected.content))
              "
              @click="decide('confirm')"
              >学生确认完成</TpButton
            ><TpButton :disabled="busy || unknown || mustReload" @click="decide('rework')">标记返工</TpButton
            ><TpButton v-if="selected.status === 'confirmed'" :disabled="busy || unknown || mustReload" @click="decide('reopen')">撤销完成确认</TpButton
            ><TpButton variant="ghost" :disabled="busy" @click="loadHistory">查看任务历史</TpButton>
          </div></template
        >
        <Transition name="tp-expand" v-bind="panelMotionHooks"
          ><section v-if="history" class="studio-stack" aria-label="任务历史">
            <h3 class="tp-subheading">不可变操作历史</h3>
            <p v-if="history.total > history.items.length" class="tp-caption">当前显示最近 {{ history.items.length }} / {{ history.total }} 条。</p>
            <article v-for="entry in history.items" :key="entry.version">
              <TpButton variant="ghost" size="sm" @click="viewing = viewing === entry.version ? undefined : entry.version"
                >v{{ entry.version }} · {{ actionName[entry.action] ?? entry.action }} · {{ entry.reason || "无附加说明" }}</TpButton
              >
              <div v-if="viewing === entry.version" class="task-history">
                <strong>{{ entry.snapshot.content.title }}</strong>
                <p>{{ entry.snapshot.content.description }}</p>
                <p>验收：{{ entry.snapshot.content.acceptance }}</p>
                <p>{{ statusName[entry.snapshot.status] }} · {{ entry.created_at }}</p>
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
.task-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.task-row {
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.task-editor {
  padding: 24px;
}
.task-review {
  color: var(--tp-warning-content);
  background: var(--tp-warning-soft);
  padding: 8px 12px;
  border-radius: var(--tp-radius-s);
  font-size: 13px;
}
.task-history {
  padding: 12px;
  background: var(--tp-surface-sunken);
  border-left: 2px solid var(--tp-ink);
  font-size: 13px;
  white-space: pre-wrap;
}
</style>
