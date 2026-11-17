<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { PhX } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { BackendServices } from "@/services";
import { asApiError } from "@/services/errors";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { PreviewHighlight } from "@/workspace/editor";
import { compatibleFormatTargets, formatCandidateCurrent, formatFieldLabel, formatValueLabel } from "../formatting/formatPresentation";
import type { CopilotAnchor, CopilotPanelProps } from "../writing-assistant/copilotPanel";
import { FORMAT_GROUP, formatHighlights, formatStatusView } from "./formatPanel";

/**
 * 写作页副驾 · 安全格式：依据已绑定的模板与要求（逐条可核验来源），明确选择目标段落生成格式候选，
 * 逐项接受 / 拒绝后采纳（钤印），可撤销；纸面标出受影响段落。只改白名单属性（标题级别、对齐）。
 */
const props = defineProps<CopilotPanelProps>();
const emit = defineEmits<{ overlays: [group: string, highlights: PreviewHighlight[]]; focus: [anchor: CopilotAnchor]; changed: []; close: [] }>();
type Service = BackendServices["formatRevisions"];
type Context = Awaited<ReturnType<Service["context"]>>;
type Candidate = Awaited<ReturnType<Service["get"]>>;
type Pending =
  | { operation: "create"; input: Parameters<Service["create"]>[2] }
  | { operation: "decide"; target: string; input: Parameters<Service["decide"]>[3] }
  | { operation: "apply"; target: string; input: Parameters<Service["apply"]>[3] }
  | { operation: "undo"; target: string; input: Parameters<Service["undo"]>[3] };

const context = shallowRef<Context>();
const contextError = ref("");
const candidates = shallowRef<Candidate[]>([]);
const total = ref(0);
const activeId = ref("");
const selectedRule = ref("");
const selectedTargets = ref<string[]>([]);
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const pending = shallowRef<Pending>();
const stamp = ref(0);
let request: AbortController | undefined;
let generation = 0;
let disposed = false;

const api = computed(() => props.services.formatRevisions);
const documentId = computed(() => props.document?.id ?? "");
const version = computed(() => props.document?.version ?? 0);
const rules = computed(() => (context.value?.rules ?? []).filter((item) => !(context.value?.content_schema_version === 2 && item.field === "templateWeight")));
const rule = computed(() => rules.value.find((item) => item.id === selectedRule.value));
const targets = computed(() => compatibleFormatTargets(context.value?.targets ?? [], rule.value));
const candidate = computed(() => candidates.value.find((item) => item.id === activeId.value));
const accepted = computed(() => candidate.value?.decisions.filter((item) => item.decision === "accept").length ?? 0);
const undecided = computed(() => candidate.value?.decisions.filter((item) => item.decision === "pending").length ?? 0);
const idle = computed(() => !busy.value && !loading.value && !pending.value);
const canDecide = computed(() => !!candidate.value && formatCandidateCurrent(candidate.value, version.value, props.eligible) && idle.value);
const canGenerate = computed(
  () => props.eligible && !!context.value && context.value.document_version === version.value && !!rule.value && selectedTargets.value.length > 0 && idle.value,
);
const ruleOptions = computed(() =>
  rules.value.map((item) => ({ value: item.id, label: `${formatFieldLabel(item.field)} → ${formatValueLabel(item.field, item.value)}` })),
);

function publish() {
  emit(
    "overlays",
    FORMAT_GROUP,
    formatHighlights({ context: context.value, rule: rule.value, selected: selectedTargets.value, candidate: candidate.value, version: version.value }),
  );
}
function decisionOf(patchId: string) {
  return candidate.value?.decisions.find((item) => item.patch_id === patchId)?.decision ?? "pending";
}
function toggle(anchorId: string, checked: boolean) {
  selectedTargets.value = checked ? [...new Set([...selectedTargets.value, anchorId])] : selectedTargets.value.filter((item) => item !== anchorId);
}
function focusNode(node: string | null | undefined) {
  if (node) emit("focus", { node });
}
async function refresh() {
  request?.abort();
  const document = props.document;
  context.value = undefined;
  candidates.value = [];
  if (!document) return;
  const current = ++generation;
  const controller = new AbortController();
  request = controller;
  loading.value = true;
  contextError.value = error.value = "";
  const [contextResult, listResult] = await Promise.allSettled([
    api.value.context(props.project.id, document.id, controller.signal),
    api.value.list(props.project.id, document.id, { limit: 20, offset: 0 }, controller.signal),
  ]);
  if (disposed || controller.signal.aborted || current !== generation) return;
  if (contextResult.status === "fulfilled") {
    context.value = contextResult.value;
    if (!rules.value.some((item) => item.id === selectedRule.value)) selectedRule.value = "";
  } else contextError.value = asApiError(contextResult.reason).message;
  if (listResult.status === "fulfilled") {
    candidates.value = listResult.value.items;
    total.value = listResult.value.total;
    if (!candidates.value.some((item) => item.id === activeId.value)) activeId.value = candidates.value[0]?.id ?? "";
  } else error.value = asApiError(listResult.reason).message;
  loading.value = false;
  publish();
}
async function more() {
  if (!props.document || loading.value) return;
  try {
    const page = await api.value.list(props.project.id, props.document.id, { limit: 20, offset: candidates.value.length });
    if (disposed) return;
    const seen = new Set(candidates.value.map((item) => item.id));
    candidates.value = [...candidates.value, ...page.items.filter((item) => !seen.has(item.id))];
    total.value = page.total;
  } catch (problem) {
    if (!disposed) error.value = asApiError(problem).message;
  }
}
function send(action: Pending) {
  const p = props.project.id;
  const d = documentId.value;
  if (action.operation === "create") return api.value.create(p, d, action.input);
  if (action.operation === "decide") return api.value.decide(p, d, action.target, action.input);
  if (action.operation === "apply") return api.value.apply(p, d, action.target, action.input);
  return api.value.undo(p, d, action.target, action.input);
}
async function run(action: Pending) {
  if (busy.value) return;
  pending.value = action;
  busy.value = true;
  error.value = notice.value = "";
  try {
    const receipt = await send(action);
    if (disposed) return;
    pending.value = undefined;
    activeId.value = receipt.candidate_id;
    if (action.operation === "apply" || action.operation === "undo") {
      if (action.operation === "apply") stamp.value++;
      notice.value = `${action.operation === "apply" ? "格式已采纳" : "格式已撤销"}，保存为正式稿 v${receipt.result_version}；正文正在重新载入。`;
      emit("changed");
    } else {
      if (action.operation === "create") selectedTargets.value = [];
      notice.value = action.operation === "create" ? "格式候选已生成，正文尚未改动。" : "";
      await refresh();
    }
  } catch (problem) {
    if (disposed) return;
    const issue = asApiError(problem);
    if (issue.status !== undefined && issue.status < 500 && issue.code !== "INVALID_RESPONSE") pending.value = undefined;
    error.value = pending.value ? `${issue.message} 结果尚未核实，请使用原命令确认。` : issue.message;
  } finally {
    if (!disposed) busy.value = false;
  }
}
async function recover() {
  const action = pending.value;
  if (!action || busy.value) return;
  busy.value = true;
  try {
    const receipt = await api.value.command(props.project.id, documentId.value, action.input.command_id);
    if (disposed) return;
    pending.value = undefined;
    error.value = "";
    activeId.value = receipt.candidate_id;
    if (receipt.result_version) emit("changed");
    else await refresh();
  } catch (problem) {
    if (disposed) return;
    const issue = asApiError(problem);
    error.value = issue.status === 404 ? "服务端没有这次命令的记录，可重试同一命令，不会重复写入。" : issue.message;
  } finally {
    if (!disposed) busy.value = false;
  }
}
function create() {
  const basis = context.value;
  if (!basis || !canGenerate.value) return;
  void run({
    operation: "create",
    input: {
      command_id: crypto.randomUUID(),
      base_version: version.value,
      binding_version_id: basis.binding_version_id,
      source_guard_digest: basis.source_guard_digest,
      selections: [{ rule_id: selectedRule.value, target_anchor_ids: [...selectedTargets.value] }],
    },
  });
}
function decide(patchId: string, choice: "accept" | "reject") {
  const current = candidate.value;
  if (!current || !canDecide.value) return;
  void run({
    operation: "decide",
    target: current.id,
    input: { command_id: crypto.randomUUID(), expected_revision: current.revision, decisions: [{ patch_id: patchId, decision: choice }] },
  });
}
function apply() {
  const current = candidate.value;
  if (!current || !canDecide.value || !accepted.value || undecided.value) return;
  void run({
    operation: "apply",
    target: current.id,
    input: { command_id: crypto.randomUUID(), expected_revision: current.revision, expected_document_version: version.value },
  });
}
function undo() {
  const current = candidate.value;
  if (!current?.application_command_id || current.status !== "applied" || !props.eligible || !idle.value) return;
  void run({ operation: "undo", target: current.application_command_id, input: { command_id: crypto.randomUUID(), expected_document_version: version.value } });
}

watch(selectedRule, () => (selectedTargets.value = []));
watch([selectedTargets, activeId, selectedRule], publish, { deep: true });
watch(
  () => [props.project.id, props.document?.id, props.document?.version],
  () => void refresh(),
  { immediate: true },
);
onScopeDispose(() => {
  disposed = true;
  ++generation;
  request?.abort();
  emit("overlays", FORMAT_GROUP, []);
});
</script>

<template>
  <section class="copilot-panel" aria-label="安全格式" :aria-busy="loading || busy">
    <header class="copilot-panel__head">
      <h2 class="tp-subheading">安全格式</h2>
      <TpButton size="sm" variant="ghost" icon-only label="收起安全格式" @click="$emit('close')"><TpIcon :icon="PhX" /></TpButton>
    </header>
    <p v-if="!document" class="tp-caption">还没有正式稿。导入原件后再检查格式。</p>
    <p v-if="document && !eligible" class="studio-notice">正文有未保存修改或不是最新版本。保存后再生成、决定或采纳格式候选。</p>
    <p v-if="loading" role="status" class="tp-caption">正在读取格式依据…</p>
    <p v-if="contextError" role="alert" class="studio-notice">{{ contextError }}</p>

    <template v-if="context">
      <p class="tp-caption copilot-panel__basis">
        依据：正文 v{{ context.document_version }} · 来源绑定 v{{ context.binding_version }} ·
        {{ context.template_parse_version_id ? "模板已绑定" : "未绑定模板" }} · {{ context.requirement_parse_version_ids.length }} 份要求
      </p>
      <p v-if="!rules.length" class="tp-caption">绑定的模板与要求中没有可核验的格式规则。</p>
      <TpSelect v-else v-model="selectedRule" :options="ruleOptions" placeholder="选择一条格式规则" :disabled="!idle" />
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <div v-if="rule" :key="rule.id" class="format-basis">
          <strong>{{ formatFieldLabel(rule.field) }} → {{ formatValueLabel(rule.field, rule.value) }}</strong>
          <p>{{ rule.evidence }}</p>
        </div>
      </Transition>
      <fieldset v-if="rule" class="format-targets" :disabled="!eligible || !idle">
        <legend class="tp-label">范围（{{ selectedTargets.length }}/{{ targets.length }}）</legend>
        <p v-if="!targets.length" class="tp-caption">没有与该规则兼容、且原件允许修改的段落。</p>
        <div v-for="target in targets" :key="target.anchor_id" class="format-target">
          <label
            ><input
              type="checkbox"
              class="checkbox checkbox-sm"
              :checked="selectedTargets.includes(target.anchor_id)"
              @change="toggle(target.anchor_id, ($event.target as HTMLInputElement).checked)"
            /><span>{{ target.title || "空白段落" }}</span></label
          ><TpButton v-if="target.node_id" size="sm" variant="ghost" :label="`在纸面定位：${target.title}`" @click="focusNode(target.node_id)">定位</TpButton>
        </div>
      </fieldset>
      <div v-if="rule" class="screen-actions">
        <TpButton variant="primary" :disabled="!canGenerate" :loading="busy && pending?.operation === 'create'" @click="create">生成格式候选</TpButton>
      </div>
    </template>

    <div v-if="pending && !busy" class="screen-actions">
      <TpButton size="sm" @click="recover">检查命令结果</TpButton><TpButton size="sm" variant="ghost" @click="run(pending)">重试同一命令</TpButton>
    </div>

    <section v-if="candidates.length" class="format-history" aria-label="格式候选历史">
      <h3 class="tp-label">候选与历史</h3>
      <TransitionGroup tag="ul" name="tp-list" v-bind="listMotionHooks" class="format-history__list tp-list-group">
        <li v-for="item in candidates" :key="item.id">
          <button type="button" class="format-history__row" :aria-pressed="activeId === item.id" @click="activeId = item.id">
            <TpStatus size="sm" :tone="formatStatusView(item, version).tone" :label="formatStatusView(item, version).label" />
            <span class="tp-caption">基于 v{{ item.base_version }} · {{ item.patches.length }} 项</span>
          </button>
        </li>
      </TransitionGroup>
      <TpButton v-if="candidates.length < total" size="sm" variant="ghost" @click="more">更早的候选</TpButton>
    </section>

    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <article v-if="candidate" :key="candidate.id" class="format-candidate">
        <header class="format-candidate__head">
          <span class="tp-caption">候选 r{{ candidate.revision }}</span>
          <TpSeal v-if="candidate.status === 'applied'" text="已采纳" :stamp="stamp" />
        </header>
        <p v-if="candidate.status === 'ready' && !formatCandidateCurrent(candidate, version, true)" class="studio-notice">
          正文或格式依据已变化，此候选已过期，不能采纳。请刷新依据后重新生成。
        </p>
        <TransitionGroup tag="ol" name="tp-list" v-bind="listMotionHooks" class="format-candidate__patches tp-list-group">
          <li v-for="patch in candidate.patches" :key="patch.id" class="format-patch" :data-decision="decisionOf(patch.id)">
            <button type="button" class="format-patch__target" :disabled="!patch.node_id" @click="focusNode(patch.node_id)">
              {{ context?.targets.find((item) => item.anchor_id === patch.anchor_id)?.title || formatFieldLabel(patch.field) }}
            </button>
            <p class="format-patch__diff">
              <span>{{ formatValueLabel(patch.field, patch.before) }}</span><span aria-label="改为">→</span
              ><span>{{ formatValueLabel(patch.field, patch.after) }}</span>
            </p>
            <div v-if="candidate.status === 'ready'" class="format-patch__choices" role="group" :aria-label="`${formatFieldLabel(patch.field)}的决定`">
              <TpButton
                size="sm"
                :variant="decisionOf(patch.id) === 'accept' ? 'tonal' : 'ghost'"
                :aria-pressed="decisionOf(patch.id) === 'accept'"
                :disabled="!canDecide || decisionOf(patch.id) === 'accept'"
                @click="decide(patch.id, 'accept')"
                >接受</TpButton
              ><TpButton
                size="sm"
                :variant="decisionOf(patch.id) === 'reject' ? 'tonal' : 'ghost'"
                :aria-pressed="decisionOf(patch.id) === 'reject'"
                :disabled="!canDecide || decisionOf(patch.id) === 'reject'"
                @click="decide(patch.id, 'reject')"
                >拒绝</TpButton
              >
            </div>
          </li>
        </TransitionGroup>
        <div class="screen-actions">
          <TpButton
            v-if="candidate.status === 'ready'"
            variant="seal"
            :disabled="!canDecide || !accepted || !!undecided"
            :loading="busy && pending?.operation === 'apply'"
            @click="apply"
            >采纳已接受（{{ accepted }}）</TpButton
          ><TpButton v-if="candidate.status === 'applied'" :disabled="!eligible || !idle || candidate.base_version + 1 !== version" @click="undo"
            >撤销此次格式</TpButton
          >
        </div>
        <p v-if="candidate.status === 'ready' && undecided" class="tp-caption">还有 {{ undecided }} 项未决定，逐项决定后才能采纳。</p>
      </article>
    </Transition>
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
      ><p v-if="error" :key="error" role="alert" class="studio-notice">{{ error }}</p>
      <p v-else-if="notice" :key="notice" role="status" class="tp-caption">{{ notice }}</p></Transition
    >
  </section>
</template>

<style scoped>
.copilot-panel {
  display: grid;
  align-content: start;
  gap: 14px;
  min-width: 0;
  padding: 16px;
}
.copilot-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.copilot-panel__basis {
  overflow-wrap: anywhere;
}
.format-basis {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border-left: 3px solid var(--tp-pencil);
  border-radius: var(--tp-radius-s);
  background: var(--tp-pencil-soft);
  font-size: 13px;
  line-height: 1.7;
}
.format-basis p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--tp-text-muted);
}
.format-targets {
  display: grid;
  gap: 2px;
  max-height: 240px;
  overflow: auto;
  margin: 0;
  padding: 8px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
}
.format-target {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.format-target label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  padding: 6px 4px;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.format-history {
  display: grid;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--tp-line);
}
.format-history__list,
.format-candidate__patches {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.format-history__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--tp-radius-s);
  background: none;
  color: var(--tp-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.format-history__row:hover {
  background: var(--tp-surface-sunken);
}
.format-history__row[aria-pressed="true"] {
  border-color: var(--tp-pencil-line);
  background: var(--tp-pencil-soft);
}
.format-history__row:focus-visible,
.format-patch__target:focus-visible {
  outline: 2px solid var(--tp-focus);
  outline-offset: 2px;
}
.format-candidate {
  display: grid;
  gap: 10px;
}
.format-candidate__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.format-patch {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px dashed var(--tp-pencil-line);
  border-radius: var(--tp-radius-s);
  background: var(--tp-pencil-soft);
}
.format-patch[data-decision="accept"] {
  border-style: solid;
  border-color: var(--tp-pencil);
}
.format-patch[data-decision="reject"] {
  background: var(--tp-surface);
  opacity: 0.72;
}
.format-patch__target {
  padding: 0;
  border: 0;
  background: none;
  color: var(--tp-text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.format-patch__target:disabled {
  cursor: default;
}
.format-patch__diff {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 13px;
}
.format-patch__diff span:first-child {
  color: var(--tp-text-muted);
  text-decoration: line-through;
}
.format-patch__diff span:last-child {
  color: var(--tp-pencil);
  font-weight: 600;
}
.format-patch__choices {
  display: flex;
  gap: 6px;
}
</style>
