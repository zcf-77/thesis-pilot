<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, type RouteLocationNamedRaw, type RouteLocationRaw } from "vue-router";
import { PhCheck, PhClock, PhGitBranch } from "@phosphor-icons/vue";
import EvidenceChip from "@/components/domain/EvidenceChip.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { FeedbackItemSummary, TaskRead, TaskSummary } from "@/services";
import { listMotionHooks } from "@/design/motion";
import { feedbackRoute, materialsRoute, versionRoute } from "../workspaceRoutes";
import { activeEvidence, reviewReasonLabel, shortDate, statusFor, type EvidenceItem } from "./taskBoard";

const props = defineProps<{
  task: TaskRead;
  index: number;
  count: number;
  items: readonly TaskSummary[];
  successors: readonly TaskSummary[];
  successorNote?: string;
  feedbackNote?: string;
  feedback: readonly FeedbackItemSummary[];
  pastEvidence: readonly EvidenceItem[];
  chapterLabel?: string;
  sourceKey: string;
  disabled: boolean;
  busy: boolean;
  hasDraft: boolean;
  stamp: boolean;
}>();
const reason = defineModel<string>("reason", { required: true });
const emit = defineEmits<{
  edit: [];
  move: [offset: -1 | 1];
  select: [id: string];
  status: [status: "todo" | "doing" | "verify"];
  confirm: [];
  rework: [];
  reopen: [];
  unlink: [key: string];
  restore: [item: EvidenceItem];
}>();
const checked = ref(false);
const archivedOpen = ref(false);
watch(
  () => [props.task.id, props.task.version],
  () => {
    checked.value = false;
  },
);
watch(
  () => props.task.id,
  () => {
    archivedOpen.value = false;
  },
);
const status = computed(() => statusFor(props.task));
const content = computed(() => props.task.content);
const evidence = computed(() => activeEvidence(props.task));
const dependencies = computed(() =>
  (content.value.depends_on ?? []).map((id) => {
    const summary = props.items.find((item) => item.id.toLowerCase() === id.toLowerCase());
    return { id, title: summary?.title ?? "已不在当前任务表中", ready: summary?.status === "confirmed" && !summary.needs_review, summary };
  }),
);
const dateLine = computed(() => {
  const { start_date: start, due_date: due } = content.value;
  if (start && due) return `${shortDate(start)} — ${shortDate(due)}`;
  if (due) return `截止 ${shortDate(due)}`;
  if (start) return `${shortDate(start)} 开始`;
  return "未设期限";
});
const isArchived = computed(() => !!content.value.archived);
const confirmed = computed(() => props.task.status === "confirmed");
function evidenceLink(item: EvidenceItem): RouteLocationRaw {
  return item.reference.kind === "document"
    ? versionRoute({ source: props.sourceKey, projectId: props.task.project_id, documentId: item.reference.document_id, version: item.reference.version })
    : materialsRoute(props.task.project_id, item.reference.material_id);
}
function feedbackLink(item: FeedbackItemSummary): RouteLocationRaw {
  return { ...(feedbackRoute(props.task.project_id) as RouteLocationNamedRaw), query: { batch: item.batch_id, item: item.id } };
}
const chip = (item: EvidenceItem) => ({
  id: item.key,
  kind: item.reference.kind === "document" ? ("document" as const) : ("file" as const),
  label: item.label,
  stale: item.stale,
});
</script>

<template>
  <section class="screen-panel plan-detail" aria-label="任务详情内容" tabindex="-1">
    <div class="plan-detail__top">
      <div class="plan-detail__status">
        <TpStatus :tone="status.tone" :label="status.label" size="sm" />
        <span v-if="isArchived" class="plan-tag">已归档</span>
      </div>
      <span class="tp-caption" aria-label="当前排序位置">{{ index + 1 }} / {{ count }}</span>
    </div>
    <h2 class="tp-heading plan-detail__title">{{ content.title }}</h2>
    <p class="plan-detail__date">
      <TpIcon :icon="PhClock" :size="15" /><span>{{ dateLine }}</span>
      <span v-if="content.hard_deadline" class="plan-tag">硬截止 {{ shortDate(content.hard_deadline) }}</span>
    </p>
    <div class="screen-actions plan-detail__actions">
      <TpButton data-task-edit size="sm" :disabled="disabled" @click="emit('edit')">{{ hasDraft ? "继续编辑" : "编辑任务" }}</TpButton>
      <span class="plan-detail__reorder" role="group" aria-label="调整任务顺序">
        <TpButton size="sm" variant="ghost" :label="`上移任务 ${content.title}`" :disabled="disabled || index === 0" @click="emit('move', -1)">上移</TpButton>
        <TpButton size="sm" variant="ghost" :label="`下移任务 ${content.title}`" :disabled="disabled || index >= count - 1" @click="emit('move', 1)"
          >下移</TpButton
        >
      </span>
    </div>
    <p v-if="hasDraft" class="tp-caption plan-detail__draft" role="status">有未保存输入。</p>
    <div v-if="feedback.length || feedbackNote" class="plan-detail__links">
      <RouterLink v-for="(item, position) in feedback" :key="item.id" class="plan-link tp-caption" :to="feedbackLink(item)">
        导师反馈{{ feedback.length > 1 ? ` ${position + 1}` : "" }} ↗
      </RouterLink>
      <p v-if="feedbackNote" class="tp-caption" role="alert">{{ feedbackNote }}</p>
    </div>
    <p v-if="chapterLabel" class="tp-caption plan-detail__chapter">{{ chapterLabel }}</p>
    <p v-if="task.needs_review" class="plan-review" role="status">{{ task.review_reasons.map(reviewReasonLabel).join("；") }}</p>

    <div class="plan-detail__section">
      <h3 class="tp-label">验收条件</h3>
      <p class="plan-detail__text">{{ content.acceptance }}</p>
      <template v-if="content.description">
        <h3 class="tp-label plan-gap">补充说明</h3>
        <p class="plan-detail__text tp-caption">{{ content.description }}</p>
      </template>
    </div>

    <div v-if="dependencies.length || successors.length || successorNote" class="plan-detail__section">
      <template v-if="dependencies.length">
        <h3 class="tp-label">前置任务</h3>
        <ul class="plan-deps">
          <li v-for="dependency in dependencies" :key="dependency.id">
            <TpIcon :icon="dependency.ready ? PhCheck : PhGitBranch" :size="14" :class="dependency.ready ? 'text-ok-content' : 'text-warn-content'" />
            <button v-if="dependency.summary" type="button" class="plan-link" :disabled="disabled" @click="emit('select', dependency.summary.id)">
              {{ dependency.title }}
            </button>
            <span v-else>{{ dependency.title }}</span><span class="tp-caption">{{ dependency.ready ? "已确认" : "未就绪" }}</span>
          </li>
        </ul>
      </template>
      <template v-if="successors.length">
        <h3 class="tp-label" :class="{ 'plan-gap': dependencies.length }">后续任务</h3>
        <ul class="plan-deps">
          <li v-for="item in successors" :key="item.id">
            <TpIcon :icon="PhGitBranch" :size="14" /><button type="button" class="plan-link" :disabled="disabled" @click="emit('select', item.id)">
              {{ item.title }}
            </button>
          </li>
        </ul>
      </template>
      <p v-if="successorNote" class="tp-caption plan-gap" role="status">{{ successorNote }}</p>
    </div>

    <div class="plan-detail__section">
      <h3 class="tp-label">产物证据</h3>
      <Transition name="tp-swap" mode="out-in">
        <TransitionGroup v-if="evidence.length" key="list" name="tp-list" tag="div" v-bind="listMotionHooks" class="plan-evidence tp-list-group">
          <div v-for="item in evidence" :key="item.key" class="plan-evidence-row">
            <RouterLink :to="evidenceLink(item)"><EvidenceChip :evidence="chip(item)" /></RouterLink>
            <TpButton variant="ghost" size="sm" :label="`解除关联：${item.label}`" :disabled="disabled || isArchived" @click="emit('unlink', item.key)"
              >解除</TpButton
            >
          </div>
        </TransitionGroup>
        <div v-else key="empty" class="tp-ghost plan-no-evidence">
          <span>尚未关联证据</span><TpButton size="sm" variant="ghost" :disabled="disabled || isArchived" @click="emit('edit')">编辑并关联</TpButton>
        </div>
      </Transition>
      <p v-if="evidence.some((item) => item.stale)" class="plan-overdue tp-caption plan-gap">证据版本已变化，请复核。</p>
      <template v-if="pastEvidence.length">
        <button
          type="button"
          class="plan-disclosure tp-caption"
          :aria-expanded="archivedOpen"
          aria-controls="past-task-evidence"
          @click="archivedOpen = !archivedOpen"
        >
          历史关联（{{ pastEvidence.length }}）<span aria-hidden="true">{{ archivedOpen ? "−" : "+" }}</span>
        </button>
        <Transition name="tp-swap">
          <TransitionGroup v-if="archivedOpen" id="past-task-evidence" name="tp-list" tag="div" v-bind="listMotionHooks" class="plan-evidence tp-list-group">
            <div v-for="item in pastEvidence" :key="item.key" class="plan-evidence-row">
              <RouterLink :to="evidenceLink(item)"><EvidenceChip :evidence="{ ...chip(item), stale: false }" /></RouterLink>
              <TpButton variant="ghost" size="sm" :label="`恢复关联：${item.label}`" :disabled="disabled || isArchived" @click="emit('restore', item)"
                >恢复</TpButton
              >
            </div>
          </TransitionGroup>
        </Transition>
      </template>
    </div>

    <div class="plan-detail__section plan-decide">
      <h3 class="tp-label">学生决定</h3>
      <p v-if="isArchived" class="tp-caption plan-gap">先在编辑中取消归档，再更改状态。</p>
      <Transition v-else name="tp-swap" mode="out-in">
        <div v-if="!confirmed" key="open" class="plan-decide__body">
          <div class="screen-actions" role="group" aria-label="任务工作状态">
            <TpButton
              v-for="option in ['todo', 'doing', 'verify'] as const"
              :key="option"
              size="sm"
              variant="ghost"
              :aria-pressed="task.status === option"
              :disabled="disabled || task.status === option"
              @click="emit('status', option)"
              >{{ option === "todo" ? "待开始" : option === "doing" ? "进行中" : "待核验" }}</TpButton
            >
          </div>
          <label class="plan-check"><input v-model="checked" class="tp-checkbox" type="checkbox" :disabled="disabled" />我已核对验收条件与证据</label>
          <TpButton variant="seal" size="sm" :loading="busy" :disabled="disabled || !checked || task.needs_review" @click="emit('confirm')"
            >确认任务完成</TpButton
          >
          <p v-if="task.needs_review" class="tp-caption">处理以上缺口后才能确认。</p>
        </div>
        <div v-else key="confirmed" class="plan-decide__body">
          <div class="plan-confirmed">
            <TpSeal text="学生已确认" :animate="stamp" /><span class="tp-caption">{{ task.updated_at.slice(0, 16).replace("T", " ") }}</span>
          </div>
          <TpField v-slot="{ id }" label="返工原因">
            <input
              :id="id"
              v-model="reason"
              class="tp-input"
              maxlength="2000"
              :disabled="disabled"
              placeholder="说明需要补做的内容"
              @keydown.enter.prevent="reason.trim() && emit('rework')"
            />
          </TpField>
          <div class="screen-actions">
            <TpButton size="sm" :disabled="disabled || !reason.trim()" @click="emit('rework')">记录返工</TpButton>
            <TpButton size="sm" variant="ghost" :disabled="disabled" @click="emit('reopen')">重新打开</TpButton>
          </div>
        </div>
      </Transition>
    </div>
  </section>
</template>

<style scoped>
.plan-detail {
  padding: 20px;
  outline-offset: 2px;
}
.plan-detail__top,
.plan-detail__status,
.plan-detail__reorder,
.plan-confirmed {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.plan-detail__top {
  justify-content: space-between;
  color: var(--tp-text-muted);
}
.plan-detail__title {
  margin-top: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.plan-detail__actions {
  justify-content: space-between;
  margin-top: 16px;
}
.plan-detail__draft,
.plan-detail__chapter {
  margin-top: 8px;
}
.plan-detail__links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 12px;
}
.plan-link {
  min-height: 28px;
  text-align: left;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.plan-link:disabled {
  opacity: 0.6;
  text-decoration: none;
}
.plan-detail__date {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--tp-text-muted);
  font-size: 12px;
  margin-top: 8px;
}
.plan-tag {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid var(--tp-line-strong);
  border-radius: var(--tp-radius-xs);
  font-size: 12px;
  color: var(--tp-text-muted);
}
.plan-review {
  margin-top: 12px;
  padding: 8px 12px;
  border-left: 2px solid var(--tp-warning);
  background: var(--tp-warning-soft);
  color: var(--tp-warning-content);
  font-size: 13px;
}
.plan-detail__section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--tp-line);
}
.plan-detail__text {
  margin-top: 8px;
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.plan-gap {
  margin-top: 12px;
}
.plan-deps {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}
.plan-deps li {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
  font-size: 12px;
}
.plan-deps li > svg {
  flex-shrink: 0;
}
.plan-deps li > .tp-caption {
  margin-left: auto;
  white-space: nowrap;
}
.plan-evidence {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}
.plan-evidence-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  gap: 8px;
}
.plan-evidence-row > a {
  display: flex;
  flex: 1;
  min-width: 0;
}
.plan-evidence :deep(.tp-evi) {
  height: auto;
  min-height: 28px;
  padding-block: 3px;
  white-space: normal;
  flex-wrap: wrap;
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.plan-no-evidence {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  margin-top: 12px;
  font-size: 13px;
}
.plan-overdue {
  color: var(--tp-warning-content);
}
.plan-disclosure {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  min-height: 36px;
  margin-top: 8px;
  text-align: left;
}
.plan-decide__body {
  display: grid;
  gap: 12px;
  margin-top: 12px;
  justify-items: start;
}
.plan-decide__body > :deep(.tp-field) {
  width: 100%;
}
.plan-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-height: 36px;
  font-size: 13px;
  line-height: 1.7;
}
.plan-check input {
  flex-shrink: 0;
  margin-top: 4px;
}
@media (max-width: 700px) {
  .plan-detail {
    padding: 16px;
  }
  .plan-detail__actions {
    align-items: flex-start;
  }
}
</style>
