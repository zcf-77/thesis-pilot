<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { PhArrowLeft, PhCheck, PhX } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import DiffText from "@/components/domain/DiffText.vue";
import type { BackendServices, RevisionRead } from "@/services";
import type { RevisionCheck, RevisionDecision, RevisionNodePatch } from "@/services/contracts/api.generated";
import { ApiError, asApiError } from "@/services/errors";
import { isNodePatch, isNodeSelection } from "@/services/revisionProtectionV2";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { PreviewHighlight } from "@/workspace/editor";
import type { CopilotAnchor } from "./copilotPanel";
import { candidateHighlights, candidateHint, CANDIDATE_GROUP, CHECK_LABELS, hunkSegments, STATUS_VIEW } from "./candidateReview";

/** 候选只发出带版本与命令标识的意图；接受片段不等于采纳，正文仅在 apply 成功后改变。 */
const props = defineProps<{
  services: BackendServices;
  projectId: string;
  documentId: string;
  candidateId: string;
  currentVersion: number;
  eligible: boolean;
}>();
const emit = defineEmits<{
  overlays: [group: string, highlights: PreviewHighlight[]];
  focus: [anchor: CopilotAnchor];
  changed: [];
  settled: [];
  renew: [];
}>();
type Operation = "decide" | "apply" | "cancel" | "undo";
type Pending = { operation: Operation; target: string; owner: string; input: Record<string, unknown> & { command_id: string } };

const candidate = shallowRef<RevisionRead>();
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const pending = shallowRef<Pending>();
const stamp = ref(0);
const checksOpen = ref(false);
let request: AbortController | undefined;
let disposed = false;
let operationSequence = 0;

const v2 = computed(() => !!candidate.value && isNodeSelection(candidate.value.selection));
const stale = computed(() => !!candidate.value && candidate.value.base_version !== props.currentVersion);
const reviewing = computed(() => !!candidate.value && ["ready", "invalid"].includes(candidate.value.status));
const writable = computed(() => props.eligible && !busy.value && !loading.value && !pending.value);
const decisions = computed(() => new Map(candidate.value?.decisions.map((item) => [item.patch_id, item.decision]) ?? []));
const accepted = computed(() => [...decisions.value.values()].filter((value) => value === "accepted").length);
const undecided = computed(() => [...decisions.value.values()].filter((value) => value === "pending").length);
const failing = computed(() => candidate.value?.checks.filter((check) => check.result !== "pass") ?? []);
const passed = computed(() => candidate.value?.checks.filter((check) => check.result === "pass").length ?? 0);
const patches = computed(() => (candidate.value?.patches ?? []).filter(isNodePatch));
const status = computed(() => {
  if (candidate.value && reviewing.value && stale.value) return { label: "已过期", tone: "stale" as const };
  return candidate.value ? STATUS_VIEW[candidate.value.status] : undefined;
});
const hint = computed(() => (candidate.value ? candidateHint(candidate.value, props.currentVersion, props.eligible) : null));
const generationError = computed(() => {
  const code = candidate.value?.generation_error_code;
  return code ? asApiError(new ApiError(code)).message : "这次生成没有产生可用候选，正文保持不变。";
});

function segmentsOf(patch: RevisionNodePatch) {
  const selection = candidate.value?.selection;
  return selection && isNodeSelection(selection)
    ? hunkSegments(selection, patch)
    : [
        { t: "del" as const, text: patch.before },
        { t: "ins" as const, text: patch.after },
      ];
}
function decisionOf(patchId: string) {
  return decisions.value.get(patchId) ?? "pending";
}
function checkResult(check: RevisionCheck) {
  return check.result === "pass" ? "通过" : check.result === "unsupported" ? "暂不支持" : "未通过";
}
function publish() {
  const value = candidate.value;
  emit("overlays", CANDIDATE_GROUP, value && v2.value && !stale.value ? candidateHighlights(value) : []);
}
async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  loading.value = true;
  error.value = "";
  try {
    const result = await props.services.revisions.get(props.projectId, props.documentId, props.candidateId, controller.signal);
    if (controller.signal.aborted || disposed) return;
    candidate.value = result;
    publish();
  } catch (problem) {
    if (!controller.signal.aborted && !disposed) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted && !disposed) loading.value = false;
  }
}
function patchBlocked(patch: RevisionNodePatch) {
  return candidate.value?.checks.some((check) => check.result !== "pass" && (!check.patch_id || check.patch_id === patch.id)) ?? true;
}
function locate(check: RevisionCheck) {
  const selection = candidate.value?.selection;
  if (!selection || !isNodeSelection(selection)) return;
  emit("focus", check.start != null && check.end != null ? { node: selection.node_id, start: check.start, end: check.end } : { node: selection.node_id });
}
function focusPatch(patch: RevisionNodePatch) {
  const selection = candidate.value?.selection;
  if (selection && isNodeSelection(selection)) emit("focus", { node: selection.node_id, start: patch.start, end: patch.end });
}
async function send(command: Pending) {
  const api = props.services.revisions;
  const { operation, target, input } = command;
  if (operation === "decide") return api.decide(props.projectId, props.documentId, target, input as Parameters<typeof api.decide>[3]);
  if (operation === "apply") return api.apply(props.projectId, props.documentId, target, input as Parameters<typeof api.apply>[3]);
  if (operation === "cancel") return api.cancel(props.projectId, props.documentId, target, input as Parameters<typeof api.cancel>[3]);
  return api.undo(props.projectId, props.documentId, target, input as Parameters<typeof api.undo>[3]);
}
async function run(command: Pending) {
  if (busy.value) return;
  const sequence = operationSequence;
  pending.value = command;
  busy.value = true;
  error.value = notice.value = "";
  try {
    const receipt = await send(command);
    // 即使用户已切换候选，已经确认的写入仍须通知写作页刷新；其余提示不得串到新候选。
    if (command.operation === "apply" || command.operation === "undo") emit("changed");
    if (disposed || sequence !== operationSequence || props.candidateId !== command.owner) return;
    pending.value = undefined;
    if (command.operation === "apply") {
      stamp.value++;
      notice.value = `已采纳为正式稿 v${receipt.result_version}，正在载入新正文。`;
    } else if (command.operation === "undo") {
      notice.value = `已撤销此次采纳，正式稿 v${receipt.result_version} 恢复采纳前内容。`;
    } else if (command.operation === "cancel") notice.value = "候选已放弃，正文保持不变。";
    await load();
    if (!disposed && sequence === operationSequence) emit("settled");
  } catch (problem) {
    if (disposed || sequence !== operationSequence || props.candidateId !== command.owner) return;
    const issue = asApiError(problem);
    // 明确的业务拒绝不会落库；网络或响应异常时结果未知，只能沿用原命令核实。
    if (issue.status !== undefined && issue.status < 500 && issue.code !== "INVALID_RESPONSE") pending.value = undefined;
    error.value = pending.value ? `${issue.message} 结果尚未核实，请使用原命令确认。` : issue.message;
    if (issue.status === 409) await load();
  } finally {
    if (!disposed && sequence === operationSequence) busy.value = false;
  }
}
function decide(patchId: string, choice: RevisionDecision["decision"]) {
  const value = candidate.value;
  if (!value || !writable.value || !reviewing.value || stale.value) return;
  const next = value.patches.map((patch) => ({ patch_id: patch.id, decision: patch.id === patchId ? choice : decisionOf(patch.id) }));
  void run({
    operation: "decide",
    target: value.id,
    owner: value.id,
    input: { command_id: crypto.randomUUID(), expected_revision: value.revision, decisions: next },
  });
}
function apply() {
  const value = candidate.value;
  if (!value || !writable.value || !accepted.value || stale.value || !value.applicable) return;
  void run({
    operation: "apply",
    target: value.id,
    owner: value.id,
    input: { command_id: crypto.randomUUID(), expected_revision: value.revision, expected_document_version: props.currentVersion },
  });
}
function cancel() {
  const value = candidate.value;
  if (!value || !writable.value) return;
  void run({ operation: "cancel", target: value.id, owner: value.id, input: { command_id: crypto.randomUUID() } });
}
function undo() {
  const value = candidate.value;
  if (!value?.application_command_id || !writable.value) return;
  void run({
    operation: "undo",
    target: value.application_command_id,
    owner: value.id,
    input: { command_id: crypto.randomUUID(), expected_document_version: props.currentVersion },
  });
}

watch(
  () => [props.projectId, props.documentId, props.candidateId],
  () => {
    operationSequence++;
    candidate.value = undefined;
    pending.value = undefined;
    busy.value = false;
    notice.value = "";
    checksOpen.value = false;
    void load();
  },
  { immediate: true },
);
watch(() => props.currentVersion, publish);
onScopeDispose(() => {
  disposed = true;
  operationSequence++;
  request?.abort();
  emit("overlays", CANDIDATE_GROUP, []);
});
defineExpose({ reload: load });
</script>

<template>
  <section class="candidate-review" aria-label="候选审阅" :aria-busy="loading || busy">
    <div v-if="loading && !candidate" class="candidate-review__loading" role="status"><span />正在读取候选…</div>
    <template v-if="candidate">
      <header class="candidate-review__head">
        <div>
          <TpStatus size="sm" :tone="status?.tone" :label="status?.label ?? candidate.status" :live="candidate.status === 'generating'" />
          <span class="tp-caption">{{ candidate.producer === "model_run" ? "AI 候选" : "修订候选" }} · 基于正文 v{{ candidate.base_version }}</span>
        </div>
        <TpSeal v-if="candidate.status === 'applied'" class="candidate-review__seal" text="已采纳" size="md" :stamp="stamp" />
      </header>

      <div class="candidate-review__goal">
        <span class="tp-label">修改目标</span>
        <p>{{ candidate.goal }}</p>
      </div>

      <p v-if="!v2" class="candidate-review__state">此候选来自旧版正文结构，只能查看；请在当前正文中重新选择文字。</p>
      <div v-else-if="stale && reviewing" class="candidate-review__state is-stale" role="status">
        <p>正文已更新到 v{{ currentVersion }}，此候选不能直接覆盖新稿。候选与新稿都会保留。</p>
        <TpButton size="sm" variant="outline" @click="$emit('renew')"><TpIcon :icon="PhArrowLeft" :size="14" />返回对话重新选择</TpButton>
      </div>
      <p v-else-if="candidate.status === 'failed'" class="candidate-review__state is-error" role="alert">{{ generationError }}</p>

      <section v-if="candidate.checks.length" class="candidate-review__checks" aria-label="程序检查">
        <div class="candidate-review__check-summary">
          <span :data-blocked="failing.length > 0 || undefined">
            {{ failing.length ? `${failing.length} 项检查需要处理` : `${passed} 项程序检查通过` }}
          </span>
          <TpButton size="sm" variant="ghost" :aria-expanded="checksOpen" @click="checksOpen = !checksOpen">检查详情</TpButton>
        </div>
        <ul v-if="failing.length" class="candidate-review__failures">
          <li v-for="(check, index) in failing" :key="`${check.rule}:${check.patch_id ?? index}`">
            <button type="button" :data-result="check.result" :disabled="!v2" @click="locate(check)">
              <strong>{{ CHECK_LABELS[check.rule] }} · {{ checkResult(check) }}</strong>
              <span>{{ check.detail }}</span>
            </button>
          </li>
        </ul>
        <Transition name="tp-swap" v-bind="panelMotionHooks">
          <ul v-if="checksOpen" class="candidate-review__all-checks">
            <li v-for="(check, index) in candidate.checks" :key="`all:${check.rule}:${check.patch_id ?? index}`" :data-result="check.result">
              <span>{{ CHECK_LABELS[check.rule] }}</span><strong>{{ checkResult(check) }}</strong>
              <p>{{ check.detail }}</p>
            </li>
          </ul>
        </Transition>
      </section>

      <TransitionGroup tag="ol" name="tp-list" v-bind="listMotionHooks" class="candidate-review__hunks tp-list-group">
        <li
          v-for="(patch, index) in patches"
          :key="patch.id"
          class="candidate-review__hunk"
          :data-decision="decisionOf(patch.id)"
          :data-blocked="patchBlocked(patch) || undefined"
        >
          <div class="candidate-review__hunk-head">
            <span class="tp-label">片段 {{ index + 1 }}</span>
            <span class="tp-caption">
              {{
                decisionOf(patch.id) === "accepted"
                  ? "已接受，尚未写入"
                  : decisionOf(patch.id) === "rejected"
                    ? "已拒绝"
                    : patchBlocked(patch)
                      ? "检查未通过"
                      : "待决定"
              }}
            </span>
          </div>
          <button type="button" class="candidate-review__diff" :aria-label="`在纸面定位片段 ${index + 1}`" @click="focusPatch(patch)">
            <DiffText :segments="segmentsOf(patch)" :decision="decisionOf(patch.id)" />
          </button>
          <div v-if="reviewing && v2" class="candidate-review__choices" role="group" :aria-label="`片段 ${index + 1} 的决定`">
            <TpButton
              size="sm"
              :variant="decisionOf(patch.id) === 'accepted' ? 'tonal' : 'ghost'"
              :aria-pressed="decisionOf(patch.id) === 'accepted'"
              :disabled="!writable || stale || patchBlocked(patch) || decisionOf(patch.id) === 'accepted'"
              @click="decide(patch.id, 'accepted')"
              ><TpIcon :icon="PhCheck" :size="14" />接受</TpButton
            >
            <TpButton
              size="sm"
              :variant="decisionOf(patch.id) === 'rejected' ? 'tonal' : 'ghost'"
              :aria-pressed="decisionOf(patch.id) === 'rejected'"
              :disabled="!writable || decisionOf(patch.id) === 'rejected'"
              @click="decide(patch.id, 'rejected')"
              ><TpIcon :icon="PhX" :size="14" />拒绝</TpButton
            >
            <TpButton v-if="decisionOf(patch.id) !== 'pending'" size="sm" variant="ghost" :disabled="!writable" @click="decide(patch.id, 'pending')"
              >改回待定</TpButton
            >
          </div>
        </li>
      </TransitionGroup>
      <p v-if="!patches.length && candidate.status === 'generating'" class="candidate-review__pending" role="status">正在生成候选，完成后可逐片段审阅。</p>
      <p v-if="reviewing && undecided" class="tp-caption">{{ undecided }} 项仍未决定；可以先只采纳已接受的片段。</p>

      <div class="candidate-review__actions">
        <template v-if="reviewing && v2">
          <TpButton
            variant="seal"
            :disabled="!writable || stale || !accepted || !candidate.applicable"
            :loading="busy && pending?.operation === 'apply'"
            @click="apply"
            >采纳所选（{{ accepted }}）</TpButton
          >
          <TpButton variant="ghost" :disabled="!writable" @click="cancel">放弃候选</TpButton>
        </template>
        <TpButton
          v-if="candidate.status === 'applied' && candidate.application_command_id"
          :disabled="!writable || candidate.result_version !== currentVersion"
          @click="undo"
          >撤销采纳</TpButton
        >
        <TpButton v-if="pending && !busy" size="sm" variant="outline" @click="run(pending)">使用原命令确认</TpButton>
      </div>
      <p v-if="hint === 'ineligible'" class="tp-caption">正文有未保存修改或不是最新版本，保存后才能决定或采纳。</p>
      <p v-else-if="hint === 'moved'" class="tp-caption">采纳后正文已有新版本；请在版本历史中比较后恢复。</p>
      <p v-else-if="reviewing" class="tp-caption">候选尚未写入正文，只有「采纳所选」会生成新版本。</p>
    </template>
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <p v-if="error" :key="error" role="alert" class="candidate-review__state is-error">{{ error }}</p>
      <p v-else-if="notice" :key="notice" role="status" class="candidate-review__notice">{{ notice }}</p>
    </Transition>
  </section>
</template>

<style scoped>
.candidate-review {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 14px 0 2px;
  border-top: 1px solid var(--tp-pencil-line);
}
.candidate-review__loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--tp-text-muted);
  font-size: 12.5px;
}
.candidate-review__loading span {
  width: 12px;
  height: 12px;
  border: 1px dashed var(--tp-pencil-line);
  border-radius: 50%;
}
.candidate-review__head,
.candidate-review__head > div,
.candidate-review__hunk-head,
.candidate-review__check-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.candidate-review__head {
  justify-content: space-between;
}
.candidate-review__seal {
  margin-left: auto;
}
.candidate-review__goal {
  display: grid;
  gap: 3px;
}
.candidate-review__goal p {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.65;
}
.candidate-review__state {
  display: grid;
  justify-items: start;
  gap: 8px;
  margin: 0;
  padding: 8px 10px;
  border-left: 2px solid var(--tp-line-strong);
  background: var(--tp-surface-sunken);
  color: var(--tp-text-muted);
  font-size: 12.5px;
  line-height: 1.6;
}
.candidate-review__state p {
  margin: 0;
}
.candidate-review__state.is-stale {
  border-left-color: var(--tp-stale);
  background: var(--tp-stale-soft);
}
.candidate-review__state.is-error {
  border-left-color: var(--tp-danger);
  background: var(--tp-danger-soft);
  color: var(--tp-danger-content);
}
.candidate-review__checks {
  display: grid;
  gap: 6px;
}
.candidate-review__check-summary {
  justify-content: space-between;
  min-height: 30px;
  color: var(--tp-text-muted);
  font-size: 12px;
}
.candidate-review__check-summary [data-blocked] {
  color: var(--tp-danger-content);
  font-weight: 600;
}
.candidate-review__failures,
.candidate-review__all-checks {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.candidate-review__failures button {
  display: grid;
  gap: 2px;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-left: 2px solid var(--tp-danger);
  border-radius: 0 var(--tp-radius-s) var(--tp-radius-s) 0;
  background: var(--tp-danger-soft);
  color: var(--tp-danger-content);
  font: inherit;
  font-size: 12px;
  line-height: 1.55;
  text-align: left;
  cursor: pointer;
}
.candidate-review__failures button[data-result="unsupported"] {
  border-left-color: var(--tp-warning);
  background: var(--tp-warning-soft);
  color: var(--tp-warning-content);
}
.candidate-review__failures button:disabled {
  cursor: default;
}
.candidate-review__failures span,
.candidate-review__all-checks p {
  overflow-wrap: anywhere;
}
.candidate-review__all-checks {
  padding: 6px 0;
  border-top: 1px solid var(--tp-line);
}
.candidate-review__all-checks li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 8px;
  padding: 5px 0;
  color: var(--tp-text-muted);
  font-size: 11.5px;
  line-height: 1.55;
}
.candidate-review__all-checks li[data-result="pass"] strong {
  color: var(--tp-success-content);
}
.candidate-review__all-checks li:not([data-result="pass"]) strong {
  color: var(--tp-danger-content);
}
.candidate-review__all-checks p {
  grid-column: 1 / -1;
  margin: 0;
}
.candidate-review__hunks {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.candidate-review__hunk {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px dashed var(--tp-pencil-line);
  border-radius: var(--tp-radius-s);
  background: var(--tp-pencil-soft);
}
.candidate-review__hunk[data-decision="accepted"] {
  border-style: solid;
  border-color: var(--tp-pencil);
}
.candidate-review__hunk[data-decision="rejected"] {
  background: var(--tp-surface);
  opacity: 0.72;
}
.candidate-review__hunk[data-blocked] {
  border-color: var(--tp-warning);
}
.candidate-review__hunk-head {
  justify-content: space-between;
}
.candidate-review__diff {
  padding: 0;
  border: 0;
  background: none;
  color: var(--tp-text);
  font: inherit;
  font-size: 13px;
  line-height: 1.8;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.candidate-review__diff:focus-visible,
.candidate-review__failures button:focus-visible {
  outline: 2px solid var(--tp-focus);
  outline-offset: 2px;
}
.candidate-review__choices,
.candidate-review__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.candidate-review__actions {
  padding-top: 2px;
}
.candidate-review__pending,
.candidate-review__notice {
  margin: 0;
  color: var(--tp-text-muted);
  font-size: 12.5px;
  line-height: 1.6;
}
.candidate-review__notice {
  color: var(--tp-success-content);
}
@media (max-width: 420px) {
  .candidate-review__head {
    align-items: flex-start;
  }
  .candidate-review__head > div {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }
  .candidate-review__choices .tp-btn,
  .candidate-review__actions .tp-btn {
    min-height: 36px;
  }
}
</style>
