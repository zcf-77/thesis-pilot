<script setup lang="ts">
import { computed, onActivated, onScopeDispose, ref, shallowRef, watch } from "vue";
import { RouterLink } from "vue-router";
import { PhArrowRight, PhPencilSimple, PhWarningCircle } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import type { AIConfigRead, BackendServices, PlanAdjustmentItem, PlanAdjustmentRead, ProjectRead } from "@/services";
import { ApiError, asApiError } from "@/services/errors";
import { configurationsRoute } from "../workspaceRoutes";
import { adjustmentStatus, adjustmentSummary, isActiveAdjustment, rangeLabel, selectableItems } from "./planView";

const props = defineProps<{ services: BackendServices; project: ProjectRead; planVersion: number; disabled?: boolean }>();
const emit = defineEmits<{ preview: [items: PlanAdjustmentItem[] | undefined]; changed: []; select: [taskId: string] }>();

type Command =
  | { kind: "create"; input: { command_id: string; agent_config_version_id: string } }
  | { kind: "decide"; id: string; input: { command_id: string; action: "adopt" | "keep"; accepted_item_ids: string[] } }
  | { kind: "revert"; id: string; input: { command_id: string } }
  | { kind: "cancel"; id: string };

const POLL_MS = 1500;
const failure = (code: string) => new ApiError(code).message;
const agents = shallowRef<AIConfigRead[]>([]);
const agent = ref("");
const agentsLoaded = ref(false);
const adjustment = shallowRef<PlanAdjustmentRead>();
const loading = ref(false);
const loadError = ref("");
const selected = ref<string[]>([]);
const pending = shallowRef<Command>();
const unknown = ref(false);
const busy = ref(false);
const error = ref("");
const stamp = ref(0);

const state = computed(() => adjustment.value?.state);
const items = computed(() => adjustment.value?.proposal?.items ?? []);
const choosable = computed(() => selectableItems(adjustment.value));
const agentOptions = computed(() => agents.value.map((item) => ({ value: item.current_version_id, label: `${item.name} · v${item.version}` })));
const canGenerate = computed(() => !!agent.value && !busy.value && !unknown.value && !props.disabled && !isActiveAdjustment(adjustment.value));
const material = computed(() =>
  state.value === "adopted"
    ? "tp-ink"
    : state.value === "expired"
      ? "tp-stale"
      : state.value === "pending" || isActiveAdjustment(adjustment.value)
        ? "tp-pencil"
        : "tp-ghost",
);
const shownItems = computed(() =>
  state.value === "adopted" ? items.value.filter((item) => adjustment.value?.decision?.accepted_item_ids.includes(item.id)) : items.value,
);
const heading = computed(() => {
  switch (state.value) {
    case undefined:
      return "计划调整";
    case "queued":
    case "running":
      return "正在生成调整候选";
    case "pending":
      return "审阅调整候选";
    case "expired":
      return "调整候选已过期";
    case "adopted":
      return `已采纳 · 计划 v${adjustment.value?.decision?.plan_version}`;
    case "kept":
      return "已保留原计划";
    case "reverted":
      return "已撤销这次采纳";
    case "failed":
      return "未能生成调整候选";
    case "cancelled":
      return "已取消生成";
  }
  return "";
});

let loadRequest: AbortController | undefined;
let pollRequest: AbortController | undefined;
let mutationRequest: AbortController | undefined;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

function show(value: PlanAdjustmentRead | undefined, fresh = false) {
  const previous = adjustment.value;
  adjustment.value = value;
  if (fresh || previous?.id !== value?.id || (previous?.state !== "pending" && value?.state === "pending"))
    selected.value = selectableItems(value).map((item) => item.id);
  emit("preview", value && (value.state === "pending" || value.state === "expired") ? value.proposal?.items : undefined);
  schedulePoll();
}
function schedulePoll() {
  clearTimeout(pollTimer);
  const current = adjustment.value;
  if (!isActiveAdjustment(current)) return;
  const token = generation;
  pollTimer = setTimeout(async () => {
    pollRequest?.abort();
    const controller = new AbortController();
    pollRequest = controller;
    try {
      const next = await props.services.plans.adjustment(props.project.id, current!.id, controller.signal);
      // Later polls and newer candidates win; a slow response never rewinds the panel.
      if (controller.signal.aborted || token !== generation || adjustment.value?.id !== next.id) return;
      show(next);
    } catch {
      if (!controller.signal.aborted && token === generation) schedulePoll();
    }
  }, POLL_MS);
}

async function pages<T>(read: (offset: number) => Promise<{ items: T[]; total: number }>) {
  const result: T[] = [];
  for (let offset = 0; ;) {
    const page = await read(offset);
    result.push(...page.items);
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) return result;
  }
}

async function load(quiet = false) {
  loadRequest?.abort();
  const controller = new AbortController();
  loadRequest = controller;
  const { signal } = controller;
  const token = ++generation;
  if (!quiet) loading.value = true;
  loadError.value = "";
  const projectId = props.project.id;
  const [latest, configs] = await Promise.allSettled([
    props.services.plans.adjustments(projectId, { limit: 1 }, signal),
    pages((offset) => props.services.aiConfigs.list({ kind: "agent", offset, limit: 100 }, signal)),
  ]);
  if (signal.aborted || token !== generation) return;
  const failures: string[] = [];
  if (latest.status === "fulfilled") show(latest.value.items[0]);
  else failures.push(`计划调整：${asApiError(latest.reason).message}`);
  if (configs.status === "fulfilled") {
    agents.value = configs.value.filter((item) => item.enabled && item.content.kind === "agent" && item.content.role === "progress");
    agentsLoaded.value = true;
    if (!agents.value.some((item) => item.current_version_id === agent.value)) agent.value = agents.value[0]?.current_version_id ?? "";
  } else failures.push(`进度智能体：${asApiError(configs.reason).message}`);
  loadError.value = failures.join("；");
  loading.value = false;
}

async function execute(command = pending.value) {
  if (!command || busy.value) return;
  const projectId = props.project.id;
  const token = generation;
  mutationRequest?.abort();
  const controller = new AbortController();
  mutationRequest = controller;
  pending.value = command;
  busy.value = true;
  unknown.value = true;
  error.value = "";
  try {
    const plans = props.services.plans;
    let result: PlanAdjustmentRead;
    if (command.kind === "create") result = (await plans.createAdjustment(projectId, command.input, controller.signal)).adjustment;
    else if (command.kind === "decide") result = await plans.decide(projectId, command.id, command.input, controller.signal);
    else if (command.kind === "revert") result = await plans.revert(projectId, command.id, command.input, controller.signal);
    else result = await plans.cancel(projectId, command.id, controller.signal);
    if (controller.signal.aborted || token !== generation) return;
    pending.value = undefined;
    unknown.value = false;
    show(result, command.kind === "create");
    if (command.kind === "decide" && command.input.action === "adopt") stamp.value++;
    if ((command.kind === "decide" && command.input.action === "adopt") || command.kind === "revert") emit("changed");
  } catch (issue) {
    if (controller.signal.aborted || token !== generation) return;
    const problem = asApiError(issue);
    unknown.value = command.kind !== "cancel" && (problem.status === undefined || problem.status >= 500 || problem.code === "INVALID_RESPONSE");
    if (!unknown.value) pending.value = undefined;
    error.value = unknown.value ? "操作结果尚未确认，原请求已保留。请确认原请求结果后继续。" : problem.message;
    // The server's current state decides what is shown next; re-read instead of guessing.
    if (["PLAN_CANDIDATE_STALE", "PLAN_ALREADY_DECIDED", "PLAN_REVERT_STALE", "PLAN_ADJUSTMENT_BUSY", "PLAN_REVERT_UNAVAILABLE"].includes(problem.code))
      void load(true);
  } finally {
    if (mutationRequest === controller) busy.value = false;
  }
}

function generate() {
  if (!canGenerate.value) return;
  void execute({ kind: "create", input: { command_id: crypto.randomUUID(), agent_config_version_id: agent.value } });
}
function cancel() {
  if (adjustment.value) void execute({ kind: "cancel", id: adjustment.value.id });
}
function decide(action: "adopt" | "keep") {
  const current = adjustment.value;
  if (!current || busy.value || unknown.value) return;
  const accepted = action === "adopt" ? choosable.value.map((item) => item.id).filter((id) => selected.value.includes(id)) : [];
  if (action === "adopt" && !accepted.length) return void (error.value = "请至少勾选一项调整再采纳。");
  void execute({ kind: "decide", id: current.id, input: { command_id: crypto.randomUUID(), action, accepted_item_ids: accepted } });
}
function revert() {
  const current = adjustment.value;
  if (current && !busy.value && !unknown.value) void execute({ kind: "revert", id: current.id, input: { command_id: crypto.randomUUID() } });
}
const count = computed(() => choosable.value.filter((item) => selected.value.includes(item.id)).length);

watch(
  () => props.project.id,
  () => {
    for (const request of [loadRequest, pollRequest, mutationRequest]) request?.abort();
    clearTimeout(pollTimer);
    generation++;
    adjustment.value = undefined;
    pending.value = undefined;
    unknown.value = false;
    busy.value = false;
    error.value = "";
    emit("preview", undefined);
    void load();
  },
  { immediate: true },
);
/** Returning to the cached page re-reads the latest candidate; a pending command stays untouched. */
let activated = false;
onActivated(() => {
  if (!activated) return void (activated = true);
  if (!busy.value && !unknown.value) void load(true);
});
onScopeDispose(() => {
  for (const request of [loadRequest, pollRequest, mutationRequest]) request?.abort();
  clearTimeout(pollTimer);
});
defineExpose({ reload: () => load(true) });
</script>

<template>
  <section
    :class="[material, { 'is-idle': !adjustment && !loading && !loadError }]"
    class="plan-proposal"
    aria-labelledby="plan-proposal-title"
    :aria-busy="loading || isActiveAdjustment(adjustment)"
  >
    <div class="plan-proposal__intro">
      <span class="tp-avatar tp-avatar--sm" data-agent="progress" aria-hidden="true">程</span>
      <div>
        <p class="tp-label">进度助手</p>
        <h2 id="plan-proposal-title" class="tp-subheading mt-1">{{ heading }}</h2>
      </div>
      <TpSeal v-if="state === 'adopted'" text="已采纳" :stamp="stamp" />
      <TpStatus
        v-else-if="state"
        size="sm"
        :tone="adjustmentStatus[state].tone"
        :label="adjustmentStatus[state].label"
        :live="isActiveAdjustment(adjustment)"
      />
      <TpButton v-if="!adjustment && !loading" variant="pencil" size="sm" :disabled="!canGenerate" @click="generate">
        <TpIcon :icon="PhPencilSimple" />请 AI 提出调整
      </TpButton>
    </div>

    <Transition name="tp-swap" mode="out-in">
      <p v-if="adjustment || loading" :key="`${adjustment?.id}:${state}:${loading}`" class="plan-proposal__body" role="status">
        <template v-if="loading && !adjustment">正在读取调整状态…</template>
        <template v-else-if="adjustment">{{ adjustmentSummary(adjustment) }}</template>
      </p>
    </Transition>

    <Transition name="tp-swap">
      <p v-if="state === 'failed' && adjustment?.error_code" class="plan-proposal__issue" role="alert">
        {{ failure(adjustment.error_code) }}<span class="tp-mono">（{{ adjustment.error_code }}）</span>
      </p>
    </Transition>
    <Transition name="tp-swap">
      <p v-if="loadError" class="plan-proposal__issue" role="alert">{{ loadError }}<TpButton size="sm" variant="ghost" @click="load()">重新读取</TpButton></p>
    </Transition>

    <Transition name="tp-swap" mode="out-in">
      <div v-if="adjustment?.proposal && shownItems.length" :key="adjustment.id + state" class="plan-proposal__review">
        <p v-if="adjustment.proposal.summary" class="plan-proposal__summary">{{ adjustment.proposal.summary }}</p>
        <TransitionGroup tag="ul" name="tp-list" class="plan-proposal__changes tp-list-group" aria-label="调整候选条目" v-bind="listMotionHooks">
          <li v-for="item in shownItems" :key="item.id" :class="{ 'is-blocked': item.blocked }">
            <label class="plan-proposal__check">
              <input
                v-if="state === 'pending'"
                v-model="selected"
                class="tp-checkbox"
                type="checkbox"
                :value="item.id"
                :disabled="item.blocked || busy || unknown || disabled"
                :aria-label="`${item.blocked ? '不可采纳' : '采纳'}：${item.title}`"
              />
              <button v-if="item.task_id" type="button" class="plan-proposal__task" @click="emit('select', item.task_id)">{{ item.title }}</button>
              <span v-else class="plan-proposal__task">{{ item.title }}</span>
            </label>
            <span class="plan-proposal__dates">
              <s class="tp-mono">{{ rangeLabel(item.before.start_date, item.before.due_date) }}</s><TpIcon :icon="PhArrowRight" :size="14" />
              <b class="tp-mono">{{ rangeLabel(item.after.start_date, item.after.due_date) }}</b>
            </span>
            <span class="tp-caption plan-proposal__reason">{{ item.reason }}</span>
            <ul v-if="item.violations.length" class="plan-proposal__violations">
              <li v-for="violation in item.violations" :key="violation.code + violation.message">
                <TpIcon :icon="PhWarningCircle" :size="13" />{{ violation.message }}
              </li>
            </ul>
          </li>
        </TransitionGroup>
        <p v-for="note in adjustment.proposal.notes" :key="note" class="tp-caption">{{ note }}</p>
        <details class="tp-disclosure plan-proposal__provenance">
          <summary class="tp-caption">依据与来源</summary>
          <p class="tp-caption">
            计划 v{{ adjustment.base_plan_version }} · {{ adjustment.task_count }} 项任务 · {{ adjustment.agent_name }}
            <template v-if="adjustment.response_model"> · {{ adjustment.response_model }}</template>
          </p>
        </details>
      </div>
    </Transition>

    <Transition name="tp-swap">
      <div v-if="error" class="plan-proposal__issue" role="alert">
        <span>{{ error }}</span><TpButton v-if="unknown" size="sm" :loading="busy" @click="execute()">确认原请求结果</TpButton>
      </div>
    </Transition>

    <div
      v-if="
        !isActiveAdjustment(adjustment) && state !== 'pending' && state !== 'adopted' && (agentOptions.length > 1 || (agentsLoaded && !agentOptions.length))
      "
      class="plan-proposal__agent"
    >
      <TpField v-if="agentOptions.length > 1" v-slot="field" label="进度智能体">
        <TpSelect :id="field.id" v-model="agent" :aria-describedby="field.describedby" :options="agentOptions" :disabled="busy" />
      </TpField>
      <p v-else class="tp-caption">没有可用的进度智能体。<RouterLink :to="configurationsRoute" class="plan-link">去配置台添加</RouterLink></p>
    </div>

    <div v-if="adjustment" class="plan-proposal__actions">
      <Transition name="tp-swap" mode="out-in">
        <div :key="state ?? 'idle'" class="plan-proposal-action-content">
          <template v-if="isActiveAdjustment(adjustment)">
            <span class="tp-caption">正式计划未变</span><TpButton variant="ghost" size="sm" :loading="busy" @click="cancel">取消生成</TpButton>
          </template>
          <template v-else-if="state === 'pending'">
            <TpButton variant="ghost" size="sm" :disabled="busy || unknown || disabled" @click="decide('keep')">保留原计划</TpButton>
            <TpButton variant="seal" size="sm" :loading="busy" :disabled="!count || unknown || disabled" @click="decide('adopt')"
              >采纳所选（{{ count }}）</TpButton
            >
          </template>
          <template v-else-if="state === 'expired'">
            <span class="tp-caption">当前计划 v{{ planVersion }}</span
            ><TpButton variant="ghost" size="sm" :disabled="busy || unknown || disabled" @click="decide('keep')">保留原计划</TpButton>
            <TpButton variant="pencil" size="sm" :loading="busy" :disabled="!canGenerate" @click="generate"
              ><TpIcon :icon="PhPencilSimple" />基于当前计划重新生成</TpButton
            >
          </template>
          <template v-else-if="state === 'adopted'">
            <TpButton variant="ghost" size="sm" :loading="busy" :disabled="unknown || disabled" @click="revert">撤销本次采纳</TpButton>
            <TpButton variant="pencil" size="sm" :disabled="!canGenerate" @click="generate"><TpIcon :icon="PhPencilSimple" />重新计算调整</TpButton>
          </template>
          <template v-else>
            <span class="tp-caption">当前计划 v{{ planVersion }}</span>
            <TpButton variant="pencil" size="sm" :loading="busy" :disabled="!canGenerate" @click="generate"
              ><TpIcon :icon="PhPencilSimple" />重新生成调整</TpButton
            >
          </template>
        </div>
      </Transition>
    </div>
  </section>
</template>

<style scoped>
.plan-proposal {
  padding: 16px 20px;
  display: grid;
  gap: 12px;
  border: var(--tp-border-w) solid var(--tp-outline);
  border-radius: var(--tp-radius-m);
  background: var(--tp-surface);
}
.plan-proposal.is-idle {
  padding-block: 12px;
  border-color: var(--tp-line);
  background: transparent;
}
.plan-proposal__intro {
  display: flex;
  gap: 12px;
  align-items: center;
  min-width: 0;
}
.plan-proposal__intro > div {
  flex: 1;
  min-width: 0;
}
.plan-proposal__body {
  color: var(--tp-text-muted);
  font-size: 13px;
}
.plan-proposal__summary {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.plan-proposal__review {
  display: grid;
  gap: 8px;
}
.plan-proposal__changes {
  display: grid;
  margin: 4px 0;
}
.plan-proposal__changes > li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px 16px;
  align-items: center;
  padding-block: 12px;
  border-bottom: 1px dashed var(--tp-pencil-line);
}
.plan-proposal__changes > li:first-child {
  border-top: 1px dashed var(--tp-pencil-line);
}
.plan-proposal__changes > li.is-blocked {
  color: var(--tp-text-muted);
}
.plan-proposal__check {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 32px;
}
.plan-proposal__check input {
  flex-shrink: 0;
}
.plan-proposal__task {
  min-height: 28px;
  text-align: left;
  overflow-wrap: anywhere;
}
button.plan-proposal__task:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.plan-proposal__dates {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.plan-proposal__dates s {
  color: var(--tp-text-muted);
}
.is-blocked .plan-proposal__dates b {
  text-decoration: line-through;
  color: var(--tp-text-muted);
}
.plan-proposal__reason,
.plan-proposal__violations {
  grid-column: 1 / -1;
  padding-left: 24px;
}
.plan-proposal__violations {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--tp-warning-content);
}
.plan-proposal__violations li {
  display: flex;
  gap: 6px;
  align-items: flex-start;
}
.plan-proposal__violations li > svg {
  margin-top: 3px;
}
.plan-proposal__issue {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 14px;
  border-left: 2px solid var(--tp-danger);
  background: var(--tp-surface-sunken);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.plan-proposal__agent {
  max-width: 360px;
}
.plan-proposal__provenance {
  justify-self: start;
}
.plan-proposal__provenance > p {
  padding-top: 8px;
  overflow-wrap: anywhere;
}
.plan-proposal-action-content {
  display: flex;
  align-items: center;
  justify-content: end;
  flex-wrap: wrap;
  gap: 8px;
}
.plan-proposal-action-content > .tp-caption {
  margin-right: auto;
}
.plan-link {
  text-decoration: underline;
  text-underline-offset: 4px;
}
@media (max-width: 700px) {
  .plan-proposal {
    padding: 16px;
  }
  .plan-proposal__intro {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .plan-proposal__intro > .tp-btn {
    margin-left: 44px;
  }
  .plan-proposal__changes > li {
    grid-template-columns: minmax(0, 1fr);
  }
  .plan-proposal__dates {
    padding-left: 24px;
    white-space: normal;
    flex-wrap: wrap;
  }
}
</style>
