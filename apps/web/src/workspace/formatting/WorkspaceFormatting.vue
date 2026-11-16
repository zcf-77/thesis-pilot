<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import type { BackendServices } from "@/services";
import { asApiError } from "@/services/errors";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { compatibleFormatTargets, formatCandidateCurrent, formatFieldLabel, formatValueLabel } from "./formatPresentation";

type Service = BackendServices["formatRevisions"];
type Context = Awaited<ReturnType<Service["context"]>>;
type Candidate = Awaited<ReturnType<Service["get"]>>;
type Command = Awaited<ReturnType<Service["command"]>>;
type StoredCommand =
  | { operation: "create"; input: Parameters<Service["create"]>[2] }
  | { operation: "decide"; target: string; input: Parameters<Service["decide"]>[3] }
  | { operation: "apply"; target: string; input: Parameters<Service["apply"]>[3] }
  | { operation: "undo"; target: string; input: Parameters<Service["undo"]>[3] };
const props = defineProps<{
  services: BackendServices;
  projectId: string;
  documentId: string;
  version: number;
  eligible: boolean;
  open: boolean;
}>();
const emit = defineEmits<{ changed: []; busy: [value: boolean]; close: []; history: [] }>();
const context = shallowRef<Context>();
const candidates = shallowRef<Candidate[]>([]);
const loading = ref(false);
const mutating = ref(false);
const error = ref("");
const notice = ref("");
const selectedRule = ref("");
const selectedTargets = ref<string[]>([]);
const activeId = ref("");
const pending = ref("");
const pendingAction = shallowRef<StoredCommand>();
const historyLoading = ref(false);
const historyError = ref("");
const offset = ref(0);
const hasMore = ref(false);
let request: AbortController | undefined;
let generation = 0;
let disposed = false;
const pendingKey = computed(() => `thesispilot.format-command.v1:${JSON.stringify([props.services.sourceKey, props.projectId, props.documentId])}`);
const api = computed(() => props.services.formatRevisions);
const rule = computed(() => context.value?.rules.find((item) => item.id === selectedRule.value));
const targets = computed(() => compatibleFormatTargets(context.value?.targets ?? [], rule.value));
const candidate = computed(() => candidates.value.find((item) => item.id === activeId.value));
const accepted = computed(() => candidate.value?.decisions.filter((item) => item.decision === "accept").length ?? 0);
const canDecide = computed(
  () => !!candidate.value && formatCandidateCurrent(candidate.value, props.version, props.eligible) && !mutating.value && !pending.value,
);
const canGenerate = computed(
  () =>
    props.eligible &&
    !!context.value &&
    context.value.document_version === props.version &&
    !!rule.value &&
    selectedTargets.value.length > 0 &&
    !mutating.value &&
    !pending.value,
);
const ruleOptions = computed(() =>
  (context.value?.rules ?? []).map((item) => ({ value: item.id, label: `${formatFieldLabel(item.field)} → ${formatValueLabel(item.field, item.value)}` })),
);

function rememberPending(action?: StoredCommand) {
  pendingAction.value = action;
  pending.value = action?.input.command_id ?? "";
  try {
    if (action) window.sessionStorage.setItem(pendingKey.value, JSON.stringify(action));
    else window.sessionStorage.removeItem(pendingKey.value);
  } catch {}
}
function decision(patchId: string) {
  const choice = candidate.value?.decisions.find((item) => item.patch_id === patchId)?.decision;
  return choice === "pending" ? undefined : choice;
}
function toggleTarget(anchor: string, checked: boolean) {
  selectedTargets.value = checked ? [...new Set([...selectedTargets.value, anchor])] : selectedTargets.value.filter((item) => item !== anchor);
}
async function refresh() {
  request?.abort();
  const current = ++generation;
  const controller = new AbortController();
  request = controller;
  loading.value = true;
  error.value = "";
  historyError.value = "";
  historyLoading.value = false;
  selectedTargets.value = [];
  try {
    const results = await Promise.allSettled([
      api.value.context(props.projectId, props.documentId, controller.signal),
      api.value.list(props.projectId, props.documentId, { limit: 20, offset: 0 }, controller.signal),
    ]);
    if (disposed || controller.signal.aborted || current !== generation) return;
    const [contextResult, listResult] = results;
    context.value = undefined;
    if (contextResult.status === "fulfilled") {
      context.value = contextResult.value;
      if (!contextResult.value.rules.some((item) => item.id === selectedRule.value)) selectedRule.value = "";
    } else error.value = asApiError(contextResult.reason).message;
    if (listResult.status === "fulfilled") {
      candidates.value = listResult.value.items;
      offset.value = listResult.value.items.length;
      hasMore.value = offset.value < listResult.value.total;
      if (!candidates.value.some((item) => item.id === activeId.value)) activeId.value = candidates.value[0]?.id ?? "";
    } else historyError.value = asApiError(listResult.reason).message;
  } finally {
    if (!disposed && current === generation) loading.value = false;
  }
}
async function moreHistory() {
  if (historyLoading.value || !hasMore.value) return;
  const current = generation;
  historyLoading.value = true;
  historyError.value = "";
  try {
    const page = await api.value.list(props.projectId, props.documentId, { limit: 20, offset: offset.value }, request?.signal);
    if (disposed || current !== generation) return;
    const seen = new Set(candidates.value.map((item) => item.id));
    candidates.value = [...candidates.value, ...page.items.filter((item) => !seen.has(item.id))];
    offset.value += page.items.length;
    hasMore.value = offset.value < page.total;
  } catch (problem) {
    if (!disposed && current === generation) historyError.value = asApiError(problem).message;
  } finally {
    if (!disposed && current === generation) historyLoading.value = false;
  }
}
async function finishCommand(command: Command) {
  rememberPending();
  activeId.value = command.candidate_id;
  if (command.operation === "apply" || command.operation === "undo") {
    notice.value = `格式${command.operation === "apply" ? "采纳" : "撤销"}已保存为正式稿 v${command.result_version}，正在重新核对正文与来源。`;
    emit("changed");
  } else {
    notice.value = command.operation === "create" ? "格式候选已生成；尚未改写正文。" : "审阅决定已保存；正文仅在采纳后改变。";
    await refresh();
  }
}
function execute(action: StoredCommand): Promise<Command> {
  if (action.operation === "create") return api.value.create(props.projectId, props.documentId, action.input);
  if (action.operation === "decide") return api.value.decide(props.projectId, props.documentId, action.target, action.input);
  if (action.operation === "apply") return api.value.apply(props.projectId, props.documentId, action.target, action.input);
  return api.value.undo(props.projectId, props.documentId, action.target, action.input);
}
async function command(action: StoredCommand, retry = false) {
  if (mutating.value || (!!pending.value && !retry)) return;
  rememberPending(action);
  mutating.value = true;
  emit("busy", true);
  error.value = notice.value = "";
  try {
    const result = await execute(action);
    if (!disposed) await finishCommand(result);
  } catch (problem) {
    if (disposed) return;
    const issue = asApiError(problem);
    error.value = issue.message;
    if (
      !["NETWORK_ERROR", "REQUEST_TIMEOUT", "INVALID_RESPONSE", "REQUEST_CANCELLED", "HTTP_ERROR"].includes(issue.code) &&
      ((issue.status !== undefined && issue.status < 500) || /^(FORMAT_|DOCUMENT_|PROJECT_)/.test(issue.code))
    )
      rememberPending();
    if (pending.value) error.value += " 命令结果尚未核实，请先检查此次命令结果。";
  } finally {
    if (!disposed) {
      mutating.value = false;
      emit("busy", false);
    }
  }
}
function create() {
  const basis = context.value;
  if (!basis || !canGenerate.value) return;
  const selections = [{ rule_id: selectedRule.value, target_anchor_ids: [...selectedTargets.value] }];
  void command({
    operation: "create",
    input: {
      command_id: crypto.randomUUID(),
      base_version: props.version,
      binding_version_id: basis.binding_version_id,
      source_guard_digest: basis.source_guard_digest,
      selections,
    },
  });
}
function decide(patchId: string, choice: "accept" | "reject") {
  const current = candidate.value;
  if (!current || !canDecide.value) return;
  void command({
    operation: "decide",
    target: current.id,
    input: { command_id: crypto.randomUUID(), expected_revision: current.revision, decisions: [{ patch_id: patchId, decision: choice }] },
  });
}
function apply() {
  const current = candidate.value;
  if (!current || !canDecide.value || !accepted.value) return;
  void command({
    operation: "apply",
    target: current.id,
    input: { command_id: crypto.randomUUID(), expected_revision: current.revision, expected_document_version: props.version },
  });
}
function undo() {
  const current = candidate.value;
  if (!current?.application_command_id || current.status !== "applied" || !props.eligible) return;
  void command({
    operation: "undo",
    target: current.application_command_id,
    input: { command_id: crypto.randomUUID(), expected_document_version: props.version },
  });
}
async function recover() {
  if (!pending.value || mutating.value) return;
  mutating.value = true;
  emit("busy", true);
  try {
    const result = await api.value.command(props.projectId, props.documentId, pending.value);
    if (!disposed) {
      error.value = "";
      await finishCommand(result);
    }
  } catch (problem) {
    if (!disposed) {
      const issue = asApiError(problem);
      error.value = issue.message;
      if (issue.status === 404) notice.value = "服务端暂未查到命令，仍保留原命令编号；可重试同一命令，服务端幂等校验避免重复写入。";
    }
  } finally {
    if (!disposed) {
      mutating.value = false;
      emit("busy", false);
    }
  }
}
watch(selectedRule, () => (selectedTargets.value = []));
watch(
  () => [props.open, props.version, props.documentId, props.projectId],
  () => {
    if (props.open) void refresh();
  },
  { immediate: true },
);
try {
  const raw = window.sessionStorage.getItem(pendingKey.value);
  if (raw) {
    const stored = JSON.parse(raw) as StoredCommand;
    if (
      ["create", "decide", "apply", "undo"].includes(stored.operation) &&
      typeof stored.input?.command_id === "string" &&
      (stored.operation === "create" || typeof stored.target === "string")
    ) {
      pendingAction.value = stored;
      pending.value = stored.input.command_id;
    }
  }
} catch {
  error.value = "本机待核实格式命令记录无法读取，请保留现场并重新读取正式版本核对。";
}
onScopeDispose(() => {
  disposed = true;
  ++generation;
  request?.abort();
  emit("busy", false);
});
</script>

<template>
  <Transition name="tp-swap" v-bind="panelMotionHooks">
    <section v-if="open" class="format-panel studio-stack" aria-label="安全格式面板" :aria-busy="loading || mutating">
      <div class="studio-row format-panel__heading">
        <h2 class="tp-heading">安全格式</h2>
        <TpButton size="sm" :disabled="mutating" @click="$emit('close')">收起格式面板</TpButton>
      </div>
      <p class="tp-caption">依据已固定的模板与要求检查格式。逐项审阅后采纳，只改变指定属性，文字、引用、公式和锁定对象保持保护。</p>
      <div class="screen-actions">
        <TpButton size="sm" :loading="loading" :disabled="mutating || !!pending" @click="refresh">刷新格式依据</TpButton
        ><TpButton size="sm" @click="$emit('history')">查看正式版本历史</TpButton>
      </div>
      <p v-if="!eligible" class="studio-notice">请先保存正文并完成来源核对。候选仍保留，保存后重新检查固定版本。</p>
      <p v-if="loading" role="status" class="tp-caption">正在读取固定格式依据与候选历史…</p>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
        ><p v-if="error" :key="error" class="studio-notice" role="alert">{{ error }}</p>
        <p v-else-if="notice" :key="notice" class="tp-caption" role="status">{{ notice }}</p></Transition
      >
      <div v-if="pending" class="screen-actions">
        <TpButton size="sm" :loading="mutating" @click="recover">检查此次命令结果</TpButton
        ><TpButton v-if="pendingAction" size="sm" :disabled="mutating" @click="command(pendingAction, true)">重试同一格式命令</TpButton
        ><span class="tp-caption">未核实结果前暂停新命令，避免重复采纳。</span>
      </div>
      <template v-if="context">
        <p class="tp-caption format-panel__basis">
          正文 v{{ context.document_version }} · 绑定 v{{ context.binding_version }} · 模板解析 {{ context.template_parse_version_id ?? "未绑定" }} · 要求解析
          {{ context.requirement_parse_version_ids.join("、") || "未绑定" }}
        </p>
        <p v-if="!context.rules.length" class="studio-notice">固定模板与要求中暂无可核验的格式规则。请到资料页绑定含明确格式要求的已解析版本后重新检查。</p>
        <label v-else class="studio-stack"
          ><span class="tp-label">格式规则</span
          ><TpSelect v-model="selectedRule" :options="ruleOptions" placeholder="选择一条有明确来源的规则" :disabled="loading || mutating || !!pending"
        /></label>
        <div v-if="rule" class="format-panel__evidence">
          <strong>{{ formatFieldLabel(rule.field) }}：{{ formatValueLabel(rule.field, rule.value) }}</strong>
          <p>{{ rule.evidence }}</p>
          <p class="tp-caption">来源解析 {{ rule.parse_version_id }} · 锚点 {{ rule.anchor_id }}</p>
        </div>
        <fieldset v-if="rule" class="format-panel__targets" :disabled="!eligible || loading || mutating || !!pending">
          <legend class="tp-label">明确选择本次目标范围（不会默认全选）</legend>
          <p v-if="!targets.length" class="tp-caption">当前来源中没有兼容且可授权的目标；未知或锁定对象不可修改。</p>
          <label v-for="target in targets" :key="target.anchor_id" class="format-panel__target"
            ><input
              type="checkbox"
              class="checkbox checkbox-sm"
              :checked="selectedTargets.includes(target.anchor_id)"
              @change="toggleTarget(target.anchor_id, ($event.target as HTMLInputElement).checked)"
            /><span>{{ target.title || "空白段落" }}<small class="tp-caption">{{ target.anchor_id }}</small></span></label
          >
        </fieldset>
        <div class="screen-actions">
          <TpButton variant="pencil" :disabled="!canGenerate" :loading="mutating" @click="create">生成格式候选</TpButton
          ><span class="tp-caption">已选 {{ selectedTargets.length }} 个明确目标；确定性规则，无模型调用。</span>
        </div>
      </template>
      <div class="format-panel__history">
        <h3 class="tp-subheading">格式候选与决定历史</h3>
        <p v-if="!loading && !candidates.length" class="tp-caption">尚无格式候选。</p>
        <div class="screen-actions">
          <TpButton
            v-for="item in candidates"
            :key="item.id"
            size="sm"
            :variant="activeId === item.id ? 'tonal' : 'ghost'"
            :aria-pressed="activeId === item.id"
            @click="activeId = item.id"
            >v{{ item.base_version }} · {{ item.status === "ready" ? "待审阅" : item.status === "applied" ? "已采纳" : "已撤销" }} ·
            {{ item.id.slice(0, 6) }}</TpButton
          >
        </div>
        <p v-if="historyError" role="alert" class="studio-notice">{{ historyError }}</p>
        <TpButton v-if="hasMore" size="sm" :loading="historyLoading" @click="moreHistory">加载更早格式候选</TpButton>
      </div>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <article v-if="candidate" :key="candidate.id" class="format-panel__candidate studio-stack">
          <div class="studio-row">
            <h3 class="tp-subheading">逐项格式差异</h3>
            <span class="tp-caption">基础正文 v{{ candidate.base_version }} · 候选 r{{ candidate.revision }}</span>
          </div>
          <p v-if="candidate.status === 'ready' && (!candidate.applicable || candidate.base_version !== version)" class="studio-notice">
            此候选已过期或依据已变化。建议保留供核对，请刷新格式依据并重新生成；旧候选不会覆盖正文。
          </p>
          <p v-if="!candidate.patches.length" class="tp-caption">所选目标已符合规则，无需修改。</p>
          <div v-for="patch in candidate.patches" :key="patch.id" class="format-panel__patch">
            <strong>{{ formatFieldLabel(patch.field) }} · {{ patch.anchor_id }}</strong>
            <p class="format-panel__diff">
              <span>{{ formatValueLabel(patch.field, patch.before) }}</span><span aria-label="改为">→</span
              ><span>{{ formatValueLabel(patch.field, patch.after) }}</span>
            </p>
            <p class="tp-caption">依据：{{ patch.evidence }}</p>
            <div class="screen-actions">
              <TpButton size="sm" :disabled="!canDecide || decision(patch.id) === 'accept'" @click="decide(patch.id, 'accept')">{{
                decision(patch.id) === "accept" ? "已接受此项" : "接受此项"
              }}</TpButton
              ><TpButton size="sm" variant="ghost" :disabled="!canDecide || decision(patch.id) === 'reject'" @click="decide(patch.id, 'reject')">{{
                decision(patch.id) === "reject" ? "已拒绝此项" : "拒绝此项"
              }}</TpButton
              ><span v-if="!decision(patch.id)" class="tp-caption">尚未决定</span>
            </div>
          </div>
          <div class="screen-actions">
            <TpButton v-if="candidate.status === 'ready'" variant="seal" :disabled="!canDecide || !accepted" :loading="mutating" @click="apply"
              >采纳已接受格式（{{ accepted }} 项）</TpButton
            ><TpButton v-if="candidate.status === 'applied'" :disabled="!eligible || mutating || !!pending" :loading="mutating" @click="undo"
              >撤销此次格式</TpButton
            ><span v-if="candidate.status === 'undone'" class="tp-caption">此次格式已撤销，历史版本继续保留。</span>
          </div>
        </article>
      </Transition>
    </section>
  </Transition>
</template>

<style scoped>
.format-panel {
  border: 1px solid var(--tp-pencil-line);
  background: var(--tp-surface);
  border-radius: var(--tp-radius-m);
  padding: 18px;
}
.format-panel__heading {
  justify-content: space-between;
}
.format-panel__basis {
  overflow-wrap: anywhere;
}
.format-panel__evidence,
.format-panel__patch {
  display: grid;
  gap: 8px;
  border: 1px dashed var(--tp-pencil-line);
  background: var(--tp-pencil-soft);
  border-radius: var(--tp-radius-s);
  padding: 12px;
}
.format-panel__targets {
  display: grid;
  gap: 8px;
  max-height: 260px;
  overflow: auto;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  padding: 12px;
}
.format-panel__target {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px;
}
.format-panel__target small {
  display: block;
  overflow-wrap: anywhere;
}
.format-panel__diff {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.format-panel__diff span:first-child {
  text-decoration: line-through;
  color: var(--tp-text-muted);
}
.format-panel__diff span:last-child {
  font-weight: 600;
  color: var(--tp-pencil);
}
.format-panel__history {
  display: grid;
  gap: 10px;
  border-top: 1px solid var(--tp-line);
  padding-top: 14px;
}
</style>
