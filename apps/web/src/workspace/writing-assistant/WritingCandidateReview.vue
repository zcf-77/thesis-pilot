<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import DiffText from "@/components/domain/DiffText.vue";
import type { BackendServices, RevisionRead } from "@/services";
import type { RevisionCheck, RevisionDecision, RevisionNodePatch } from "@/services/contracts/api.generated";
import { asApiError } from "@/services/errors";
import { isNodePatch, isNodeSelection } from "@/services/revisionProtectionV2";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { PreviewHighlight } from "@/workspace/editor";
import type { CopilotAnchor } from "./copilotPanel";
import { candidateHighlights, candidateHint, CANDIDATE_GROUP, CHECK_LABELS, hunkSegments, STATUS_VIEW } from "./candidateReview";

/**
 * 一条内容候选的审阅：纸面画出逐片段差异，逐片段接受 / 拒绝，采纳已接受片段（钤印），放弃候选，撤销采纳。
 * 写入均为带命令编号的服务端命令；结果未知时保留原命令，确认前不发新命令。
 */
const props = defineProps<{
  services: BackendServices;
  projectId: string;
  documentId: string;
  candidateId: string;
  currentVersion: number;
  eligible: boolean;
}>();
const emit = defineEmits<{ overlays: [group: string, highlights: PreviewHighlight[]]; focus: [anchor: CopilotAnchor]; changed: []; settled: [] }>();
type Operation = "decide" | "apply" | "cancel" | "undo";
type Pending = { operation: Operation; target: string; input: Record<string, unknown> & { command_id: string } };

const candidate = shallowRef<RevisionRead>();
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const pending = shallowRef<Pending>();
const stamp = ref(0);
let request: AbortController | undefined;
let disposed = false;

const v2 = computed(() => !!candidate.value && isNodeSelection(candidate.value.selection));
const stale = computed(() => !!candidate.value && candidate.value.base_version !== props.currentVersion);
const reviewing = computed(() => !!candidate.value && ["ready", "invalid"].includes(candidate.value.status));
const writable = computed(() => props.eligible && !busy.value && !loading.value && !pending.value);
const decisions = computed(() => new Map(candidate.value?.decisions.map((item) => [item.patch_id, item.decision]) ?? []));
const accepted = computed(() => [...decisions.value.values()].filter((value) => value === "accepted").length);
const failing = computed(() => candidate.value?.checks.filter((check) => check.result !== "pass" && check.rule !== "version") ?? []);
const patches = computed(() => (candidate.value?.patches ?? []).filter(isNodePatch));
function segmentsOf(patch: RevisionNodePatch) {
  const selection = candidate.value?.selection;
  return selection && isNodeSelection(selection)
    ? hunkSegments(selection, patch)
    : [
        { t: "del" as const, text: patch.before },
        { t: "ins" as const, text: patch.after },
      ];
}
const status = computed(() => (candidate.value ? STATUS_VIEW[candidate.value.status] : undefined));
const hint = computed(() => (candidate.value ? candidateHint(candidate.value, props.currentVersion, props.eligible) : null));

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
  pending.value = command;
  busy.value = true;
  error.value = notice.value = "";
  try {
    const receipt = await send(command);
    if (disposed) return;
    pending.value = undefined;
    if (command.operation === "apply") {
      stamp.value++;
      notice.value = `已采纳为正式稿 v${receipt.result_version}；正文正在重新载入。`;
      emit("changed");
    } else if (command.operation === "undo") {
      notice.value = `已撤销此次采纳，正式稿 v${receipt.result_version} 恢复采纳前内容。`;
      emit("changed");
    } else if (command.operation === "cancel") notice.value = "候选已放弃，正文保持不变。";
    await load();
    emit("settled");
  } catch (problem) {
    if (disposed) return;
    const issue = asApiError(problem);
    // 明确的业务拒绝不会落库，可以发新命令；网络或响应异常时结果未知，保留原命令确认。
    if (issue.status !== undefined && issue.status < 500 && issue.code !== "INVALID_RESPONSE") pending.value = undefined;
    error.value = pending.value ? `${issue.message} 结果尚未核实，请使用原命令确认。` : issue.message;
    if (issue.status === 409) await load();
  } finally {
    if (!disposed) busy.value = false;
  }
}
function decide(patchId: string, choice: RevisionDecision["decision"]) {
  const value = candidate.value;
  if (!value || !writable.value || !reviewing.value) return;
  const next = value.patches.map((patch) => ({ patch_id: patch.id, decision: patch.id === patchId ? choice : (decisions.value.get(patch.id) ?? "pending") }));
  void run({ operation: "decide", target: value.id, input: { command_id: crypto.randomUUID(), expected_revision: value.revision, decisions: next } });
}
function apply() {
  const value = candidate.value;
  if (!value || !writable.value || !accepted.value) return;
  void run({
    operation: "apply",
    target: value.id,
    input: { command_id: crypto.randomUUID(), expected_revision: value.revision, expected_document_version: props.currentVersion },
  });
}
function cancel() {
  const value = candidate.value;
  if (!value || !writable.value) return;
  void run({ operation: "cancel", target: value.id, input: { command_id: crypto.randomUUID() } });
}
function undo() {
  const value = candidate.value;
  if (!value?.application_command_id || !writable.value) return;
  void run({
    operation: "undo",
    target: value.application_command_id,
    input: { command_id: crypto.randomUUID(), expected_document_version: props.currentVersion },
  });
}
function retry() {
  if (pending.value) void run(pending.value);
}

watch(
  () => [props.projectId, props.documentId, props.candidateId],
  () => {
    candidate.value = undefined;
    pending.value = undefined;
    notice.value = "";
    void load();
  },
  { immediate: true },
);
watch(() => props.currentVersion, publish);
onScopeDispose(() => {
  disposed = true;
  request?.abort();
  emit("overlays", CANDIDATE_GROUP, []);
});
defineExpose({ reload: load });
</script>

<template>
  <section class="candidate-review" aria-label="候选审阅" :aria-busy="loading || busy">
    <p v-if="loading && !candidate" role="status" class="tp-caption">正在读取候选…</p>
    <template v-if="candidate">
      <header class="candidate-review__head">
        <TpStatus size="sm" :tone="status?.tone" :label="status?.label ?? candidate.status" :live="candidate.status === 'generating'" />
        <span class="tp-caption">基于 v{{ candidate.base_version }}<template v-if="stale"> · 当前 v{{ currentVersion }}</template></span>
        <TpSeal v-if="candidate.status === 'applied'" class="candidate-review__seal" text="已采纳" size="md" :stamp="stamp" />
      </header>
      <p v-if="!v2" class="studio-notice">此候选来自旧版正文结构，只能查看；请在当前正文中重新选择文字。</p>
      <p v-else-if="stale && reviewing" class="studio-notice">正文已更新到 v{{ currentVersion }}，此候选已过期，不能采纳。请重新选择文字发起新候选。</p>
      <ul v-if="failing.length" class="candidate-review__checks">
        <li v-for="check in failing" :key="check.rule">
          <button type="button" class="candidate-review__check" :data-result="check.result" @click="locate(check)">
            <strong>{{ CHECK_LABELS[check.rule] }}</strong><span>{{ check.result === "unsupported" ? "暂不支持" : "未通过" }} · {{ check.detail }}</span>
          </button>
        </li>
      </ul>
      <TransitionGroup tag="ol" name="tp-list" v-bind="listMotionHooks" class="candidate-review__hunks tp-list-group">
        <li
          v-for="(patch, index) in patches"
          :key="patch.id"
          class="candidate-review__hunk"
          :data-decision="decisions.get(patch.id) ?? 'pending'"
          :data-blocked="patchBlocked(patch) || undefined"
        >
          <button type="button" class="candidate-review__diff" :aria-label="`在纸面定位片段 ${index + 1}`" @click="focusPatch(patch)">
            <DiffText
              :segments="segmentsOf(patch)"
              :decision="decisions.get(patch.id) === 'accepted' ? 'accepted' : decisions.get(patch.id) === 'rejected' ? 'rejected' : 'pending'"
            />
          </button>
          <div v-if="reviewing && v2" class="candidate-review__choices" role="group" :aria-label="`片段 ${index + 1} 的决定`">
            <TpButton
              size="sm"
              :variant="decisions.get(patch.id) === 'accepted' ? 'tonal' : 'ghost'"
              :aria-pressed="decisions.get(patch.id) === 'accepted'"
              :disabled="!writable || stale || patchBlocked(patch) || decisions.get(patch.id) === 'accepted'"
              @click="decide(patch.id, 'accepted')"
              >接受</TpButton
            ><TpButton
              size="sm"
              :variant="decisions.get(patch.id) === 'rejected' ? 'tonal' : 'ghost'"
              :aria-pressed="decisions.get(patch.id) === 'rejected'"
              :disabled="!writable || decisions.get(patch.id) === 'rejected'"
              @click="decide(patch.id, 'rejected')"
              >拒绝</TpButton
            ><TpButton v-if="decisions.get(patch.id) !== 'pending'" size="sm" variant="ghost" :disabled="!writable" @click="decide(patch.id, 'pending')"
              >改回待定</TpButton
            >
          </div>
        </li>
      </TransitionGroup>
      <p v-if="!patches.length && candidate.status === 'generating'" class="tp-caption">候选生成中，完成后在此逐片段审阅。</p>
      <div class="screen-actions">
        <template v-if="reviewing && v2">
          <TpButton variant="seal" :disabled="!writable || stale || !accepted" :loading="busy && pending?.operation === 'apply'" @click="apply"
            >采纳所选（{{ accepted }}）</TpButton
          ><TpButton variant="ghost" :disabled="!writable" @click="cancel">放弃候选</TpButton>
        </template>
        <TpButton
          v-if="candidate.status === 'applied' && candidate.application_command_id"
          :disabled="!writable || candidate.result_version !== currentVersion"
          @click="undo"
          >撤销采纳</TpButton
        >
        <TpButton v-if="pending && !busy" size="sm" @click="retry">使用原命令确认</TpButton>
      </div>
      <p v-if="hint === 'ineligible'" class="tp-caption">正文有未保存修改或不是最新版本，保存后才能决定或采纳。</p>
      <p v-else-if="hint === 'moved'" class="tp-caption">采纳后正文已有新版本，撤销请在版本历史中比较后恢复。</p>
    </template>
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
      ><p v-if="error" :key="error" role="alert" class="studio-notice">{{ error }}</p>
      <p v-else-if="notice" :key="notice" role="status" class="tp-caption">{{ notice }}</p></Transition
    >
  </section>
</template>

<style scoped>
.candidate-review {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.candidate-review__head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.candidate-review__seal {
  margin-left: auto;
}
.candidate-review__checks {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.candidate-review__check {
  display: grid;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--tp-line);
  border-left: 3px solid var(--tp-danger);
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface);
  color: var(--tp-text);
  font: inherit;
  font-size: 12px;
  line-height: 1.6;
  text-align: left;
  cursor: pointer;
}
.candidate-review__check[data-result="unsupported"] {
  border-left-color: var(--tp-warning);
}
.candidate-review__check:focus-visible,
.candidate-review__diff:focus-visible {
  outline: 2px solid var(--tp-focus);
  outline-offset: 2px;
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
.candidate-review__choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
