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
import { activeEvidence, shortDate, statusFor, type EvidenceItem } from "./taskBoard";

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
  return "";
});
const isArchived = computed(() => !!content.value.archived);
const confirmed = computed(() => props.task.status === "confirmed");
function evidenceLink(item: EvidenceItem): RouteLocationRaw {
  return item.reference.kind === "document"
    ? versionRoute({ source: props.sourceKey, projectId: props.task.project_id, documentId: item.reference.document_id, version: item.reference.version })
    : materialsRoute(props.task.project_id);
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
  <section class="screen-panel plan-detail" aria-label="任务详情内容">
    <div class="plan-detail__top">
      <p class="tp-label">任务详情</p>
      <span class="tp-mono">#{{ index + 1 }} · v{{ task.version }}</span>
    </div>
    <div class="plan-detail__status">
      <TpStatus :tone="status.tone" :label="status.label" size="sm" /><span v-if="isArchived" class="plan-tag">已归档</span>
    </div>
    <h2 class="tp-heading plan-detail__title">{{ content.title }}</h2>
    <div class="screen-actions plan-detail__actions">
      <TpButton size="sm" :disabled="disabled" @click="emit('edit')">{{ hasDraft ? "继续编辑" : "编辑任务" }}</TpButton
      ><TpButton size="sm" variant="ghost" :label="`上移任务 ${content.title}`" :disabled="disabled || index === 0" @click="emit('move', -1)">上移</TpButton
      ><TpButton size="sm" variant="ghost" :label="`下移任务 ${content.title}`" :disabled="disabled || index >= count - 1" @click="emit('move', 1)"
        >下移</TpButton
      >
    </div>
    <p v-if="hasDraft" class="tp-caption plan-detail__draft">有未保存的编辑输入，保存后才会进入正式任务。</p>
    <RouterLink v-for="(item, position) in feedback" :key="item.id" class="plan-link tp-caption plan-source-link" :to="feedbackLink(item)"
      >查看导师反馈原文{{ feedback.length > 1 ? ` ${position + 1}` : "" }} ↗</RouterLink
    >
    <p v-if="feedbackNote" class="tp-caption plan-source-link">{{ feedbackNote }}</p>
    <p v-if="dateLine || content.hard_deadline" class="plan-detail__date">
      <TpIcon :icon="PhClock" :size="15" /><span v-if="dateLine">{{ dateLine }}</span
      ><span v-if="content.hard_deadline" class="plan-tag">硬截止 {{ shortDate(content.hard_deadline) }}</span>
    </p>
    <p v-if="chapterLabel" class="tp-caption plan-detail__chapter">{{ chapterLabel }}</p>
    <p v-if="task.needs_review" class="plan-review" role="status">需复核：{{ task.review_reasons.join("；") }}</p>

    <div class="plan-detail__section">
      <p class="tp-label">完成标准</p>
      <p class="plan-detail__text">{{ content.acceptance }}</p>
      <p v-if="content.description" class="plan-detail__text tp-caption">{{ content.description }}</p>
    </div>

    <div v-if="dependencies.length || successors.length || successorNote" class="plan-detail__section">
      <template v-if="dependencies.length">
        <p class="tp-label">前置条件</p>
        <ul class="plan-deps">
          <li v-for="dependency in dependencies" :key="dependency.id">
            <TpIcon :icon="dependency.ready ? PhCheck : PhGitBranch" :size="14" :class="dependency.ready ? 'text-ok-content' : 'text-warn-content'" /><button
              v-if="dependency.summary"
              type="button"
              class="plan-link"
              :disabled="disabled"
              @click="emit('select', dependency.summary.id)"
            >
              {{ dependency.title }}</button
            ><span v-else>{{ dependency.title }}</span><span class="tp-caption">{{ dependency.ready ? "已确认" : "未就绪" }}</span>
          </li>
        </ul>
      </template>
      <template v-if="successors.length">
        <p class="tp-label" :class="{ 'plan-gap': dependencies.length }">后续任务</p>
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
      <p class="tp-label">关联产物 · 具体到版本</p>
      <Transition name="tp-swap" mode="out-in">
        <TransitionGroup v-if="evidence.length" key="list" name="tp-list" tag="div" v-bind="listMotionHooks" class="plan-evidence tp-list-group">
          <div v-for="item in evidence" :key="item.key" class="plan-evidence-row">
            <RouterLink :to="evidenceLink(item)"><EvidenceChip :evidence="chip(item)" /></RouterLink
            ><TpButton variant="ghost" size="sm" :label="`解除关联：${item.label}`" :disabled="disabled || isArchived" @click="emit('unlink', item.key)"
              >解除</TpButton
            >
          </div>
        </TransitionGroup>
        <p v-else key="empty" class="tp-ghost plan-no-evidence">尚未关联产物<br /><span class="tp-caption">在编辑任务中选择正文选区或材料锚点。</span></p>
      </Transition>
      <p v-if="evidence.some((item) => item.stale)" class="plan-overdue tp-caption plan-gap">正文或材料已变化，请复核旧版本证据。</p>
      <template v-if="pastEvidence.length">
        <button type="button" class="plan-disclosure tp-caption" :aria-expanded="archivedOpen" @click="archivedOpen = !archivedOpen">
          历史关联（{{ pastEvidence.length }}）· {{ archivedOpen ? "收起" : "展开" }}
        </button>
        <Transition name="tp-swap">
          <TransitionGroup v-if="archivedOpen" name="tp-list" tag="div" v-bind="listMotionHooks" class="plan-evidence tp-list-group">
            <div v-for="item in pastEvidence" :key="item.key" class="plan-evidence-row">
              <RouterLink :to="evidenceLink(item)"><EvidenceChip :evidence="{ ...chip(item), stale: false }" /></RouterLink
              ><TpButton variant="ghost" size="sm" :label="`恢复关联：${item.label}`" :disabled="disabled || isArchived" @click="emit('restore', item)"
                >恢复</TpButton
              >
            </div>
          </TransitionGroup>
        </Transition>
      </template>
    </div>

    <div class="plan-detail__section plan-decide">
      <p class="tp-label">由你核验并决定</p>
      <p v-if="isArchived" class="tp-caption plan-gap">已归档任务需先在编辑中取消归档，才能更改状态或确认。</p>
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
          <label class="plan-check"><input v-model="checked" class="tp-checkbox" type="checkbox" :disabled="disabled" />我已核对任务标准与关联证据</label>
          <TpButton variant="seal" size="sm" :loading="busy" :disabled="disabled || !checked || task.needs_review" @click="emit('confirm')"
            >确认任务完成</TpButton
          >
          <p v-if="task.needs_review" class="tp-caption">补齐有效证据、确认前置任务后才能确认完成。</p>
        </div>
        <div v-else key="confirmed" class="plan-decide__body">
          <TpSeal text="学生已确认" :animate="stamp" />
          <p class="tp-caption">{{ task.updated_at.slice(0, 16).replace("T", " ") }}</p>
          <TpField v-slot="{ id }" label="返工原因"
            ><input :id="id" v-model="reason" class="tp-input" maxlength="2000" :disabled="disabled" @keydown.enter.prevent="reason.trim() && emit('rework')"
          /></TpField>
          <div class="screen-actions">
            <TpButton size="sm" :disabled="disabled || !reason.trim()" @click="emit('rework')">记录返工</TpButton
            ><TpButton size="sm" variant="ghost" :disabled="disabled" @click="emit('reopen')">重新打开</TpButton>
          </div>
        </div>
      </Transition>
      <p class="tp-caption plan-gap">确认只代表你的完成判断，不代表论文质量或导师认可。</p>
    </div>
  </section>
</template>

<style scoped>
.plan-detail {
  padding: 24px;
}
.plan-detail__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  color: var(--tp-text-muted);
}
.plan-detail__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.plan-detail__title {
  margin-top: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.plan-detail__actions {
  margin-top: 12px;
}
.plan-detail__draft,
.plan-detail__chapter {
  margin-top: 8px;
}
.plan-source-link {
  display: inline-block;
  margin-top: 12px;
  margin-right: 12px;
}
.plan-link {
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
  margin-top: 12px;
}
.plan-tag {
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border: 1px solid var(--tp-line-strong);
  border-radius: var(--tp-radius-xs);
  font-size: 12px;
  line-height: 20px;
  color: var(--tp-text-muted);
}
.plan-review {
  margin-top: 12px;
  color: var(--tp-warning-content);
  background: var(--tp-warning-soft);
  padding: 8px 12px;
  border-radius: var(--tp-radius-s);
  font-size: 13px;
}
.plan-detail__section {
  margin-top: 24px;
  padding-top: 20px;
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
  gap: 12px;
  margin-top: 12px;
}
.plan-deps li {
  display: flex;
  gap: 8px;
  align-items: center;
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
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.plan-evidence-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 8px;
}
.plan-evidence-row > a {
  min-width: 0;
  max-width: 100%;
}
.plan-evidence :deep(.tp-evi) {
  white-space: normal;
  flex-wrap: wrap;
  overflow-wrap: anywhere;
}
.plan-no-evidence {
  padding: 16px;
  margin-top: 12px;
  line-height: 1.8;
}
.plan-overdue {
  color: var(--tp-warning-content);
}
.plan-disclosure {
  display: block;
  margin-top: 12px;
  text-align: left;
  text-decoration: underline;
  text-underline-offset: 4px;
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
  font-size: 13px;
  line-height: 1.7;
}
.plan-check input {
  flex-shrink: 0;
  margin-top: 4px;
}
@media (max-width: 700px) {
  .plan-detail {
    padding: 20px;
  }
}
</style>
