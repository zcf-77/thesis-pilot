<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AssistantComposer from "@/components/domain/AssistantComposer.vue";
import RevisionCard from "@/components/domain/RevisionCard.vue";
import type { CandidateStatus, CandidateView, CheckView, HunkDecision } from "@/domain/types";
import { candidateStatus } from "@/domain/vocab";
import TpButton from "@/components/ui/TpButton.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import { listMotionHooks } from "@/design/motion";
import type { RevisionRead, RevisionSelection, RevisionSummary } from "../../../services/contracts/api.generated";
import type { createRemoteRevisionsController } from "../../state/remoteRevisions";
import { panelMotionHooks } from "./motion";

const props = defineProps<{
  controller: ReturnType<typeof createRemoteRevisionsController>;
  selection: RevisionSelection | null;
  eligible: boolean;
  currentVersion: number;
}>();
const emit = defineEmits<{ openVersion: [version: number] }>();
const goal = ref("");
const formError = ref("");
const state = computed(() => props.controller.state);
const busy = computed(() => state.value.busy || state.value.commandsBlocked);
const canGenerate = computed(() => props.eligible && !!props.selection && !busy.value && state.value.candidate?.status !== "generating");
const checkLabels = {
  version: "基础版本",
  range: "选区范围",
  number: "数字与单位",
  citation: "引用",
  formula: "公式",
  lock: "锁定文字",
  overlap: "修改范围",
  structure: "正文结构",
} satisfies Record<CheckView["id"], string>;
const operationLabels = {
  create: "开始修订",
  proposal: "接收候选",
  decide: "保存审阅决定",
  apply: "采纳修订",
  cancel: "取消候选",
  undo: "撤销采纳",
  revert: "恢复历史",
} as const;
const resultOrder = { pass: 0, fail: 1, unsupported: 2 } as const;
const decisionLabels = { pending: "未决定", accepted: "接受", rejected: "拒绝" } satisfies Record<HunkDecision, string>;

function status(candidate: RevisionSummary): CandidateStatus {
  switch (candidate.status) {
    case "ready":
    case "invalid":
    case "generating":
      if (candidate.base_version !== Math.max(candidate.document_version, props.currentVersion)) return "expired";
      if (candidate.status === "ready") return "pending";
      return candidate.status;
    case "applied":
      return "adopted";
    default:
      return candidate.status;
  }
}

function checks(candidate: RevisionRead): CheckView[] {
  const summary = new Map<CheckView["id"], CheckView>();
  for (const check of candidate.checks) {
    const previous = summary.get(check.rule);
    if (!previous || resultOrder[check.result] > resultOrder[previous.result])
      summary.set(check.rule, { id: check.rule, label: checkLabels[check.rule], result: check.result, detail: check.detail });
  }
  return [...summary.values()];
}

const card = computed<CandidateView | null>(() => {
  const candidate = state.value.candidate;
  if (!candidate) return null;
  const decisions = new Map(candidate.decisions.map((entry) => [entry.patch_id, entry.decision]));
  const reviewDraft = new Map(state.value.reviewDraft?.map((entry) => [entry.patch_id, entry.decision]));
  return {
    id: candidate.id,
    agent: "content",
    goal: candidate.goal,
    scope: "文字修订预览",
    baseVersion: candidate.base_version,
    currentVersion: Math.max(candidate.document_version, props.currentVersion),
    status: status(candidate),
    checks: checks(candidate),
    basis: [],
    resultVersion: candidate.result_version ?? undefined,
    hunks: candidate.patches.map((patch) => {
      const decision = decisions.get(patch.id) ?? "pending";
      const draft = reviewDraft.get(patch.id);
      const failures = candidate.checks.filter((check) => check.result !== "pass" && check.patch_id === patch.id);
      return {
        id: patch.id,
        decision,
        segments: [{ t: "del", text: patch.before }, ...(patch.after ? [{ t: "ins" as const, text: patch.after }] : [])],
        reason: draft && draft !== decision ? `本窗口待审阅决定：${decisionLabels[draft]}` : "",
        blocked: failures.map((check) => check.detail).join(" ") || undefined,
      };
    }),
  };
});
const policyChanged = computed(() => card.value?.status === "pending" && state.value.candidate?.applicable === false);
const acceptDisabled = computed(() => card.value?.status === "invalid" || policyChanged.value);
const mayAdopt = computed(() => props.eligible && !busy.value && card.value?.status === "pending" && !!state.value.candidate?.applicable);
const mayUndo = computed(
  () =>
    props.eligible &&
    !busy.value &&
    state.value.candidate?.status === "applied" &&
    !!state.value.candidate.application_command_id &&
    state.value.candidate.result_version === Math.max(state.value.candidate.document_version, props.currentVersion),
);
const error = computed(() => formError.value || state.value.error || state.value.storageError);

watch(
  () => props.controller,
  () => {
    goal.value = "";
    formError.value = "";
  },
);

function generate(value: string) {
  if (!canGenerate.value || !props.selection) return;
  const input = (value || state.value.candidate?.goal || "").trim();
  if (!input) {
    formError.value = "请输入修改目标。";
    return;
  }
  if (Array.from(input).length > 2000) {
    formError.value = "修改目标最多 2000 个字符。";
    return;
  }
  formError.value = "";
  goal.value = input;
  void props.controller.generate(props.selection, input);
}
function decide(id: string, decision: HunkDecision) {
  const candidate = state.value.candidate;
  if (!candidate || busy.value || (card.value?.status !== "pending" && card.value?.status !== "invalid")) return;
  if (decision === "accepted" && acceptDisabled.value) return;
  const existing = new Map(candidate.decisions.map((entry) => [entry.patch_id, entry.decision]));
  if (!candidate.patches.some((patch) => patch.id === id)) return;
  void props.controller.decide(
    candidate.patches.map((patch) => ({
      patch_id: patch.id,
      decision: patch.id === id ? decision : (existing.get(patch.id) ?? "pending"),
    })),
  );
}
function rejectAll() {
  const candidate = state.value.candidate;
  if (!candidate || busy.value || (card.value?.status !== "pending" && card.value?.status !== "invalid")) return;
  void props.controller.decide(candidate.patches.map((patch) => ({ patch_id: patch.id, decision: "rejected" })));
}
function adopt() {
  if (mayAdopt.value) void props.controller.apply();
}
function cancel() {
  if (state.value.canCancel) void props.controller.cancel();
}
function undo() {
  const command = state.value.candidate?.application_command_id;
  if (mayUndo.value && command) void props.controller.undo(command);
}
function formatDate(date: string) {
  return new Date(date).toLocaleString("zh-CN");
}
</script>

<template>
  <section class="studio-stack formal-revision" aria-label="正式稿修订">
    <div class="formal-revision__form">
      <p v-if="!eligible" class="tp-caption">请先按正文上方的正式稿提示操作。</p>
      <p v-else-if="!selection" class="tp-caption">请在同一个文本块中选中文字。</p>
      <p v-else class="formal-revision__selection tp-caption">{{ selection.text }}</p>
      <AssistantComposer
        v-model="goal"
        :disabled="!canGenerate"
        label="修改目标"
        placeholder="输入修改目标…"
        send-label="生成修订预览"
        :draft-persisted="false"
        @send="generate"
      />
    </div>

    <TransitionGroup tag="div" name="tp-list" v-bind="listMotionHooks" class="tp-list-group formal-revision__commands">
      <section v-for="entry in state.pendingCommands" :key="entry.id" class="studio-notice formal-revision__command">
        <p role="status">
          {{ operationLabels[entry.operation]
          }}{{ entry.status === "confirmed" ? "已确认，待核对结果" : entry.status === "not-found" ? "尚未查询到结果" : "结果待确认" }}
        </p>
        <div class="screen-actions mt-2">
          <TpButton size="sm" :disabled="state.busy" @click="controller.checkCommand(entry.id)">检查操作结果</TpButton>
          <TpButton
            v-if="entry.canRetry"
            size="sm"
            variant="ghost"
            :disabled="state.busy || (!eligible && entry.operation !== 'cancel' && entry.operation !== 'decide')"
            @click="controller.retryCommand(entry.id)"
            >继续同一次操作</TpButton
          >
        </div>
      </section>
    </TransitionGroup>
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <div v-if="error" :key="error" class="studio-notice">
        <p role="alert">{{ error }}</p>
        <TpButton
          v-if="state.candidate && state.errorCode === 'REVISION_REVIEW_CONFLICT'"
          size="sm"
          class="mt-2"
          :disabled="state.busy"
          @click="controller.select(state.candidate.id)"
          >重新读取候选</TpButton
        >
        <TpButton
          v-else-if="!state.candidate && (state.error || state.storageError)"
          size="sm"
          class="mt-2"
          :disabled="state.busy"
          @click="controller.load(state.offset)"
          >重新读取修订记录</TpButton
        >
      </div>
    </Transition>
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <div v-if="state.resultVersion && (state.outcome === 'available' || state.outcome === 'superseded')" :key="state.resultVersion" class="studio-notice">
        <p role="status">操作已形成正式稿 v{{ state.resultVersion }}，当前编辑未被覆盖。</p>
        <TpButton size="sm" variant="ghost" class="mt-2" @click="emit('openVersion', state.resultVersion)">查看结果版本</TpButton>
      </div>
    </Transition>
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <div v-if="card" :key="card.id" class="formal-revision__candidate">
        <Transition name="tp-swap" v-bind="panelMotionHooks">
          <p v-if="policyChanged" class="studio-notice" role="status">保护规则已更新，请重新选择范围并生成候选。</p>
        </Transition>
        <RevisionCard
          :candidate="card"
          :busy="busy"
          :applying="state.operation === 'apply'"
          :adopt-disabled="!mayAdopt"
          :accept-disabled="acceptDisabled"
          :regenerate-disabled="!canGenerate"
          :undo-disabled="!mayUndo"
          :cancellable="state.canCancel"
          :cancel-disabled="!state.canCancel"
          @decide="decide"
          @adopt="adopt"
          @reject-all="rejectAll"
          @cancel="cancel"
          @regenerate="generate(goal)"
          @undo="undo"
        />
        <TpButton v-if="card.status === 'expired' && state.canCancel" size="sm" variant="ghost" class="justify-self-start" @click="cancel">取消候选</TpButton>
        <TpButton
          v-if="card.status === 'adopted' && card.resultVersion && card.currentVersion !== card.resultVersion"
          size="sm"
          variant="ghost"
          @click="emit('openVersion', card.resultVersion)"
          >查看采纳版本</TpButton
        >
      </div>
      <p v-else-if="state.busy" key="loading" class="tp-caption" role="status">正在读取或提交修订…</p>
    </Transition>

    <details v-if="state.items.length" class="tp-disclosure">
      <summary>修订记录</summary>
      <TransitionGroup tag="ul" name="tp-list" v-bind="listMotionHooks" class="tp-list-group formal-revision__history">
        <li v-for="item in state.items" :key="item.id">
          <TpButton
            size="sm"
            :variant="state.candidate?.id === item.id ? 'tonal' : 'ghost'"
            :aria-pressed="state.candidate?.id === item.id"
            :disabled="state.busy"
            class="formal-revision__history-button"
            @click="controller.select(item.id)"
          >
            <TpVersion :v="item.base_version" prefix="基于 " />
            <TpStatus :label="candidateStatus[status(item)].label" :tone="candidateStatus[status(item)].tone" size="sm" />
            <span class="tp-caption">{{ formatDate(item.created_at) }}</span>
          </TpButton>
        </li>
      </TransitionGroup>
      <nav v-if="state.total > state.limit" class="screen-actions" aria-label="修订记录分页">
        <TpButton size="sm" :disabled="state.busy || state.offset === 0" @click="controller.load(Math.max(0, state.offset - state.limit))">上一页</TpButton>
        <span class="tp-caption">第 {{ Math.floor(state.offset / state.limit) + 1 }} 页</span>
        <TpButton size="sm" :disabled="state.busy || state.offset + state.limit >= state.total" @click="controller.load(state.offset + state.limit)"
          >下一页</TpButton
        >
      </nav>
    </details>
  </section>
</template>

<style scoped>
.formal-revision {
  gap: 12px;
}
.formal-revision__form,
.formal-revision__candidate,
.formal-revision__commands,
.formal-revision__history {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.formal-revision__commands:empty {
  display: none;
}
.formal-revision__selection {
  max-height: 96px;
  overflow: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.formal-revision__history {
  list-style: none;
  padding: 0;
}
.formal-revision__history-button {
  justify-content: flex-start;
  flex-wrap: wrap;
  width: 100%;
  height: auto;
  min-height: 36px;
  padding-block: 4px;
}
</style>
