<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { RouterLink } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { BackendServices, ProjectRead, StageCommandRead, StageConfirm, StageConfirmationRead, StageProgressRead } from "@/services";
import { asApiError } from "@/services/errors";
import { flowsRoute, materialsRoute, projectsRoute, tasksRoute } from "../workspaceRoutes";

const props = defineProps<{ services: BackendServices; project: ProjectRead; workspaceId: string; progress: StageProgressRead }>();
const emit = defineEmits<{ changed: [result: StageCommandRead]; reload: [] }>();

type Pending =
  | { kind: "confirm"; input: StageConfirm }
  | { kind: "revoke"; id: string; input: { command_id: string; expected_project_version: number; note: string } };
const RELOAD = new Set([
  "STAGE_VERSION_CONFLICT",
  "STAGE_NOT_CURRENT",
  "STAGE_EVIDENCE_STALE",
  "STAGE_DOCUMENT_STALE",
  "STAGE_ALREADY_CONFIRMED",
  "STAGE_REVOKE_CONFLICT",
  "STAGE_PREREQUISITE_UNCONFIRMED",
  "STAGE_NEXT_INVALID",
  "STAGE_CONFIRMATION_NOT_FOUND",
  "STAGE_COMMAND_CONFLICT",
]);
const UNKNOWN = new Set(["NETWORK_ERROR", "REQUEST_TIMEOUT", "INVALID_RESPONSE"]);

const note = ref("");
const verified = ref(false);
const chosenNext = ref("");
const evidence = ref<string[]>([]);
const busy = ref(false);
const error = ref<{ code: string; message: string }>();
const unknown = ref(false);
const pending = shallowRef<Pending>();
const lastResult = shallowRef<StageCommandRead>();
const stamp = ref(0);
const storageError = ref("");
const history = shallowRef<StageConfirmationRead[]>([]);
const historyTotal = ref(0);
const historyError = ref("");
const historyLoading = ref(false);
let mutation: AbortController | undefined;
let historyRequest: AbortController | undefined;
let restoring = false;

const current = computed(() => props.progress.current);
const stageKey = computed(() => `${props.progress.flow_version_id ?? ""}:${props.progress.stage_id ?? ""}`);
const draftKey = computed(
  () => "thesispilot.stage-confirmation-draft.v1:" + JSON.stringify([props.services.sourceKey, props.workspaceId, props.project.id, stageKey.value]),
);
const nextOptions = computed(() => current.value?.next_stages ?? []);
const nextChoice = computed(() => (nextOptions.value.some((item) => item.id === chosenNext.value) ? chosenNext.value : (nextOptions.value[0]?.id ?? "")));
const nextName = computed(() => nextOptions.value.find((item) => item.id === nextChoice.value)?.name);
const canConfirm = computed(() => !!current.value && !current.value.confirmed && current.value.prerequisites_met);
const ready = computed(() => canConfirm.value && verified.value && !!note.value.trim() && !busy.value && !unknown.value);
const revocableName = computed(() => {
  const id = props.progress.revocable_id;
  if (!id) return undefined;
  return (
    props.progress.stages.find((stage) => stage.confirmation_id === id)?.name ?? (current.value?.confirmation_id === id ? current.value.stage.name : undefined)
  );
});

function taskLink(id: string) {
  return { ...(tasksRoute(props.project.id) as object), query: { task: id } };
}
function materialLink(id: string) {
  return { ...(materialsRoute(props.project.id) as object), query: { material: id } };
}
function deliverableLink(item: NonNullable<typeof current.value>["deliverables"][number]) {
  if (item.task_ids[0]) return taskLink(item.task_ids[0]);
  if (item.material_ids[0]) return materialLink(item.material_ids[0]);
  return tasksRoute(props.project.id);
}
const deliverableText: Record<string, string> = { confirmed_task: "已有学生确认的任务", material: "已有资料 · 待核验", none: "尚未关联依据" };

function persist() {
  if (restoring) return;
  try {
    localStorage.setItem(
      draftKey.value,
      JSON.stringify({
        note: note.value,
        verified: verified.value,
        next: chosenNext.value,
        evidence: evidence.value,
        pending: pending.value,
        unknown: unknown.value,
      }),
    );
    storageError.value = "";
  } catch {
    storageError.value = "本机草稿保存失败，当前输入仍留在页面，请保持页面打开。";
  }
}
function restore() {
  restoring = true;
  note.value = "";
  verified.value = false;
  chosenNext.value = "";
  pending.value = undefined;
  unknown.value = false;
  const candidates = new Set(props.progress.evidence_candidates.map((item) => item.task_id));
  evidence.value = [...new Set((current.value?.deliverables ?? []).flatMap((item) => item.task_ids))].filter((id) => candidates.has(id));
  try {
    const raw = localStorage.getItem(draftKey.value);
    if (raw) {
      const saved = JSON.parse(raw) as { note?: string; verified?: boolean; next?: string; evidence?: string[]; pending?: Pending; unknown?: boolean };
      note.value = typeof saved.note === "string" ? saved.note : "";
      verified.value = saved.verified === true;
      chosenNext.value = typeof saved.next === "string" ? saved.next : "";
      if (Array.isArray(saved.evidence)) evidence.value = saved.evidence.filter((id) => candidates.has(id));
      if (saved.pending && saved.unknown) {
        pending.value = saved.pending;
        unknown.value = true;
      }
    }
  } catch {
    storageError.value = "本机草稿无法读取，已保留原始内容。";
  }
  restoring = false;
}
function clearDraft() {
  try {
    localStorage.removeItem(draftKey.value);
  } catch {
    // The committed record is on the server; a stale local draft is harmless.
  }
}
watch(stageKey, restore, { immediate: true });
watch([note, verified, chosenNext, evidence], persist, { deep: true });

async function loadHistory() {
  historyRequest?.abort();
  const controller = new AbortController();
  historyRequest = controller;
  historyLoading.value = true;
  historyError.value = "";
  try {
    const page = await props.services.stageConfirmations.history(props.project.id, { limit: 20, offset: 0 }, controller.signal);
    if (controller.signal.aborted) return;
    history.value = page.items;
    historyTotal.value = page.total;
  } catch (issue) {
    if (!controller.signal.aborted) historyError.value = asApiError(issue).message;
  } finally {
    if (!controller.signal.aborted) historyLoading.value = false;
  }
}
async function moreHistory() {
  if (historyLoading.value) return;
  historyLoading.value = true;
  try {
    const page = await props.services.stageConfirmations.history(props.project.id, { limit: 20, offset: history.value.length });
    const seen = new Set(history.value.map((item) => item.id));
    history.value = [...history.value, ...page.items.filter((item) => !seen.has(item.id))];
    historyTotal.value = page.total;
  } catch (issue) {
    historyError.value = asApiError(issue).message;
  } finally {
    historyLoading.value = false;
  }
}
watch(() => props.progress.project_version, loadHistory, { immediate: true });

async function run(command: Pending) {
  mutation?.abort();
  const controller = new AbortController();
  mutation = controller;
  pending.value = command;
  busy.value = true;
  error.value = undefined;
  try {
    const result =
      command.kind === "confirm"
        ? await props.services.stageConfirmations.confirm(props.project.id, command.input, controller.signal)
        : await props.services.stageConfirmations.revoke(props.project.id, command.id, command.input, controller.signal);
    if (controller.signal.aborted) return;
    pending.value = undefined;
    unknown.value = false;
    if (command.kind === "confirm") clearDraft();
    lastResult.value = result;
    if (result.confirmation.kind === "confirm") stamp.value += 1;
    emit("changed", result);
  } catch (issue) {
    if (controller.signal.aborted) return;
    const failure = asApiError(issue);
    if (UNKNOWN.has(failure.code)) {
      unknown.value = true;
      persist();
    } else pending.value = undefined;
    error.value = { code: failure.code, message: failure.message };
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
function confirmStage() {
  const stage = current.value;
  if (!ready.value || !stage || !props.progress.flow_version_id) return;
  void run({
    kind: "confirm",
    input: {
      command_id: crypto.randomUUID(),
      expected_project_version: props.progress.project_version,
      flow_version_id: props.progress.flow_version_id,
      stage_id: stage.stage.id,
      document_version: props.progress.document?.version ?? null,
      evidence: props.progress.evidence_candidates
        .filter((item) => evidence.value.includes(item.task_id))
        .map((item) => ({ task_id: item.task_id, version: item.version })),
      note: note.value,
      next_stage_id: nextChoice.value || null,
    },
  });
}
function revoke() {
  const id = props.progress.revocable_id;
  if (!id || busy.value || unknown.value) return;
  void run({ kind: "revoke", id, input: { command_id: crypto.randomUUID(), expected_project_version: props.progress.project_version, note: "" } });
}
function retry() {
  if (pending.value && !busy.value) void run(pending.value);
}
function reloadLatest() {
  mutation?.abort();
  busy.value = false;
  pending.value = undefined;
  unknown.value = false;
  error.value = undefined;
  persist();
  emit("reload");
}
function onNoteKey(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === "Enter") {
    event.preventDefault();
    confirmStage();
  } else if (event.key === "Escape") {
    note.value = "";
    verified.value = false;
  }
}
function when(value: string) {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}
onScopeDispose(() => {
  mutation?.abort();
  historyRequest?.abort();
});
</script>

<template>
  <section class="screen-panel studio-body today-stage" aria-labelledby="today-stage-title">
    <div class="studio-row">
      <p class="tp-label">本阶段的完成条件</p>
      <RouterLink class="studio-link" :to="flowsRoute">查看流程</RouterLink>
    </div>
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <div v-if="progress.binding !== 'ready' || !current" key="binding" class="today-stage__unbound">
        <h3 id="today-stage-title" class="tp-subheading mt-3">{{ progress.binding === "unbound" ? "尚未绑定毕设流程" : "当前阶段不在绑定流程中" }}</h3>
        <p class="studio-copy">
          {{
            progress.binding === "unbound"
              ? "绑定流程与当前阶段后，这里会列出完成条件与所需产物。"
              : `流程 v${progress.flow_version ?? "?"} 中找不到当前阶段，阶段进度暂时无法判断。`
          }}
        </p>
        <RouterLink class="tp-btn tp-btn--outline tp-btn--sm mt-4" :to="projectsRoute">打开项目设置</RouterLink>
      </div>
      <div v-else :key="stageKey" class="today-stage__body">
        <h3 id="today-stage-title" class="tp-subheading mt-3">{{ current.stage.name }} · {{ current.stage.conditions.join("；") }}</h3>
        <p v-if="current.stage.description" class="studio-copy">{{ current.stage.description }}</p>
        <p class="studio-copy">所需产物：{{ current.stage.deliverables.join("、") }}</p>
        <TransitionGroup name="tp-list" tag="div" v-bind="listMotionHooks" class="tp-list-group today-deliverables">
          <RouterLink v-for="item in current.deliverables" :key="item.name" :to="deliverableLink(item)" :data-status="item.status"
            ><span>{{ item.name }}</span><small>{{ deliverableText[item.status] }} ↗</small></RouterLink
          >
        </TransitionGroup>
        <div v-if="current.prerequisites.length" class="today-prereq">
          <span class="tp-caption">前置阶段</span>
          <TpStatus
            v-for="item in current.prerequisites"
            :key="item.stage_id"
            size="sm"
            :tone="item.confirmed ? 'success' : 'warning'"
            :label="`${item.name} · ${item.confirmed ? '已确认' : '尚无确认记录'}`"
          />
        </div>

        <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
          <div v-if="current.confirmed" key="confirmed" class="today-stage__done">
            <TpSeal text="已确认" :stamp="stamp" />
            <p class="studio-copy">此阶段已由你核对确认{{ nextOptions.length ? "" : "，没有尚待开始且前置满足的阶段" }}。</p>
          </div>
          <p v-else-if="!current.prerequisites_met" key="blocked" class="tp-caption mt-3">前置阶段确认后才能完成此阶段；当前位置不等于已完成证明。</p>
          <form v-else key="form" class="today-stage__form" @submit.prevent="confirmStage">
            <TpField v-slot="field" label="本次完成依据" required>
              <input
                :id="field.id"
                v-model="note"
                class="tp-input"
                maxlength="2000"
                placeholder="记录核对的产物、版本或线下进展"
                :disabled="busy || unknown"
                @keydown="onNoteKey"
              />
            </TpField>
            <fieldset v-if="progress.evidence_candidates.length" class="today-evidence">
              <legend class="tp-caption">作为依据的已确认任务</legend>
              <label v-for="item in progress.evidence_candidates" :key="item.task_id" class="studio-check">
                <input v-model="evidence" type="checkbox" class="tp-checkbox" :value="item.task_id" :disabled="busy || unknown" />{{ item.title }}
                <small class="tp-mono">v{{ item.version }}</small>
              </label>
            </fieldset>
            <p v-else class="tp-caption">暂无学生已确认的任务，可在说明中记录线下依据。</p>
            <TpField v-if="nextOptions.length > 1" v-slot="field" label="接下来进入">
              <TpSelect
                :id="field.id"
                v-model="chosenNext"
                :options="nextOptions.map((stage) => ({ value: stage.id, label: stage.name }))"
                :disabled="busy || unknown"
              />
            </TpField>
            <p v-else class="tp-caption">{{ nextName ? `确认后进入：${nextName}` : "这是最后一个阶段，确认后保持当前位置。" }}</p>
            <label class="studio-check"
              ><input v-model="verified" type="checkbox" class="tp-checkbox" :disabled="busy || unknown" />已核对本阶段及前置条件</label
            >
            <div class="screen-actions">
              <TpButton type="submit" variant="seal" :disabled="!ready" :loading="busy && pending?.kind === 'confirm'">我已核对，完成此阶段</TpButton>
            </div>
          </form>
        </Transition>
      </div>
    </Transition>

    <Transition name="tp-swap" mode="out-in">
      <div v-if="error" :key="error.code + (unknown ? ':unknown' : '')" role="alert" class="today-stage__alert">
        <p class="tp-caption">{{ unknown ? "提交结果未知：连接中断，服务端可能已记录。重试会使用同一操作标识，不会重复确认。" : error.message }}</p>
        <div class="screen-actions">
          <TpButton v-if="unknown" size="sm" variant="tonal" :loading="busy" @click="retry">重试提交</TpButton>
          <TpButton v-if="unknown || RELOAD.has(error.code)" size="sm" variant="outline" :disabled="busy" @click="reloadLatest">载入最新</TpButton>
        </div>
      </div>
      <div v-else-if="lastResult" :key="lastResult.confirmation.id" role="status" class="today-stage__notice">
        <TpSeal v-if="lastResult.confirmation.kind === 'confirm' && !current?.confirmed" text="已确认" :stamp="stamp" />
        <p class="tp-caption">
          {{
            lastResult.confirmation.kind === "confirm"
              ? `已记录“${lastResult.confirmation.stage_name}”的确认依据。${lastResult.confirmation.next_stage_id ? "进入" + lastResult.confirmation.resulting_stage_name + "。" : ""}`
              : `已撤销“${lastResult.confirmation.stage_name}”的确认，回到${lastResult.confirmation.resulting_stage_name}。`
          }}
        </p>
      </div>
    </Transition>
    <p v-if="storageError" class="tp-caption">{{ storageError }}</p>

    <div v-if="progress.revocable_id && revocableName" class="screen-actions">
      <TpButton size="sm" variant="ghost" :loading="busy && pending?.kind === 'revoke'" :disabled="busy || unknown" @click="revoke"
        >撤销“{{ revocableName }}”的确认</TpButton
      >
    </div>

    <details v-if="historyTotal || historyError" class="today-phase-history tp-disclosure">
      <summary>查看阶段确认记录（{{ historyTotal }}）</summary>
      <p v-if="historyError" role="alert" class="tp-caption">{{ historyError }} <TpButton size="sm" variant="ghost" @click="loadHistory">重试</TpButton></p>
      <TransitionGroup name="tp-list" tag="div" class="tp-list-group" v-bind="listMotionHooks">
        <article v-for="item in history" :key="item.id" :data-kind="item.kind">
          <div class="studio-row">
            <b>{{ item.kind === "confirm" ? `确认 ${item.stage_name}` : `撤销 ${item.stage_name} 的确认` }}</b>
            <TpStatus v-if="item.revoked_by_id" size="sm" tone="neutral" label="已撤销" />
          </div>
          <p v-if="item.note">{{ item.note }}</p>
          <p v-if="item.evidence.length">依据：{{ item.evidence.map((task) => `${task.title} v${task.version}`).join("、") }}</p>
          <small
            >{{ when(item.created_at) }} ·
            {{ item.kind === "confirm" ? (item.document_version ? `正文 v${item.document_version}` : "尚无正式稿") : `回到 ${item.resulting_stage_name}` }}
            {{ item.kind === "confirm" && item.next_stage_id ? `· 进入 ${item.resulting_stage_name}` : "" }}</small
          >
        </article>
      </TransitionGroup>
      <TpButton v-if="history.length < historyTotal" size="sm" variant="ghost" :loading="historyLoading" @click="moreHistory">载入更早记录</TpButton>
    </details>
  </section>
</template>

<style scoped>
.today-stage {
  display: grid;
  gap: 12px;
}
.today-deliverables {
  display: grid;
  gap: 8px;
  margin: 12px 0 6px;
}
.today-deliverables a {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  border-bottom: 1px dashed var(--tp-line);
  padding-bottom: 8px;
  font-size: 12px;
}
.today-deliverables a:hover {
  color: var(--tp-accent);
}
.today-deliverables small {
  color: var(--tp-text-muted);
}
.today-deliverables a[data-status="confirmed_task"] small {
  color: var(--tp-success);
}
.today-prereq {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.today-stage__form {
  display: grid;
  gap: 12px;
  margin-top: 12px;
}
.today-evidence {
  display: grid;
  gap: 6px;
  border: 0;
  margin: 0;
  padding: 0;
}
.today-evidence legend {
  margin-bottom: 6px;
}
.today-stage__done,
.today-stage__notice {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.today-stage__alert {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--tp-danger);
  border-radius: var(--tp-radius-s);
  background: var(--tp-danger-soft);
}
.today-stage__alert .tp-caption {
  color: var(--tp-danger-content);
}
.today-phase-history {
  margin-top: 8px;
  font-size: 12px;
  color: var(--tp-text-muted);
}
.today-phase-history article {
  display: grid;
  gap: 4px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--tp-line);
}
.today-phase-history article[data-kind="revoke"] b {
  color: var(--tp-text-muted);
}
</style>
