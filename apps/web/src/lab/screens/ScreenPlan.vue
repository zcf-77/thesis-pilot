<script setup lang="ts">
import { listMotionHooks } from "@/design/motion";

import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { PhArrowRight, PhCalendarBlank, PhCheck, PhClock, PhFlagPennant, PhGitBranch, PhMagnifyingGlass, PhSparkle } from "@phosphor-icons/vue";
import StageRoute from "@/components/domain/StageRoute.vue";
import ProjectNotice from "../components/ProjectNotice.vue";
import EvidenceChip from "@/components/domain/EvidenceChip.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import TpState from "@/components/ui/TpState.vue";
import { taskStatus } from "@/domain/vocab";
import { usePreviewWorkspaceStore } from "../state/previewWorkspace";
import { projectStageProgress, type StageProgressState } from "../state/projectProgress";
import {
  applyPlan,
  associateDocument,
  associateMaterial,
  changeTaskStatus,
  confirmTask,
  isStaleEvidence,
  moveTask,
  proposePlan,
  saveTask,
  savePersonalPlanning,
  setEvidenceArchived,
  undoPlanChange,
  usePlanState,
  validatePlan,
  type PlanEvidence,
  type PlanTask,
  type TaskDraft,
} from "../state/planState";
import { useLibraryState } from "../state/libraryState";
import { useSettingsState } from "../state/settingsState";
import { localDate, shiftDate } from "../services/planService";
import { startProjectJob } from "../state/jobState";

const workspace = usePreviewWorkspaceStore();
const state = usePlanState();
const library = useLibraryState();
const settings = useSettingsState();
const confirmedStageIds = computed(() =>
  ((workspace.current.modules.stageProgress as StageProgressState | undefined)?.confirmations ?? [])
    .filter((item) => item.workflowVersion === workspace.current.workflowVersion)
    .map((item) => item.stageId),
);
const stages = computed(
  () => projectStageProgress(settings.value.workflowHistory, workspace.current.workflowVersion, workspace.current.stage, confirmedStageIds.value).stages,
);
const materialId = ref("");
const materialVersions = computed(() => Object.fromEntries(library.value.materials.filter((item) => !item.removed).map((item) => [item.id, item.version])));
const staleEvidence = (evidence: PlanEvidence) => isStaleEvidence(evidence, workspace.current.document.version, materialVersions.value);
const route = useRoute();
const filter = ref("active");
const selectedId = ref("t1");
const preview = ref(false);
const adopted = computed(() => state.value.candidate?.status === "adopted");
const planVersion = computed(() => state.value.version);
const taskItems = computed(() => state.value.tasks);
const visibleTasks = computed(() =>
  taskItems.value.filter((task) => filter.value === "all" || (filter.value === "verify" ? task.status === "verify" : task.status !== "confirmed")),
);
const selected = computed(() => taskItems.value.find((task) => task.id === selectedId.value));
const windowStart = ref(localDate());
const windowEnd = computed(() => shiftDate(windowStart.value, 13));
const dateOffset = (date: string) => Math.max(0, Math.min(13, Math.round((Date.parse(date) - Date.parse(windowStart.value)) / 86400000)));
const shortDate = (date: string) => date.slice(5).replace("-", ".");
const schedule = computed(() =>
  taskItems.value
    .filter((task) => {
      const change = preview.value ? state.value.candidate?.changes.find((item) => item.id === task.id) : undefined;
      return (
        (task.start <= windowEnd.value && task.deadline >= windowStart.value) ||
        (!!change && change.start <= windowEnd.value && change.deadline >= windowStart.value)
      );
    })
    .map((task) => {
      const change = state.value.candidate?.changes.find((item) => item.id === task.id);
      return {
        id: task.id,
        title: task.chapter || task.title,
        start: dateOffset(task.start),
        end: Math.max(dateOffset(task.start) + 1, dateOffset(task.deadline) + 1),
        nextStart: dateOffset(change?.start || task.start),
        nextEnd: Math.max(dateOffset(change?.start || task.start) + 1, dateOffset(change?.deadline || task.deadline) + 1),
        before: shortDate(task.start) + " — " + shortDate(task.deadline),
        after: shortDate(change?.start || task.start) + " — " + shortDate(change?.deadline || task.deadline),
        changed: !!change,
        beforeVisible: task.start <= windowEnd.value && task.deadline >= windowStart.value,
        afterVisible: !!change && change.start <= windowEnd.value && change.deadline >= windowStart.value,
      };
    }),
);
const proposalRows = computed(() =>
  (state.value.candidate?.changes ?? []).map((change) => ({
    id: change.id,
    title: taskItems.value.find((task) => task.id === change.id)?.title || "任务已不存在",
    before: shortDate(change.previousStart) + " — " + shortDate(change.previousDeadline),
    after: shortDate(change.start) + " — " + shortDate(change.deadline),
  })),
);
const days = computed(() =>
  Array.from({ length: 14 }, (_, i) => {
    const iso = shiftDate(windowStart.value, i);
    return { iso, date: Number(iso.slice(8)), weekend: [0, 6].includes(new Date(iso + "T00:00:00Z").getUTCDay()) };
  }),
);
const todayOffset = computed(() => Math.round((Date.parse(localDate()) - Date.parse(windowStart.value)) / 86400000));
const generating = computed(() => state.value.generation?.status === "running");
const generationScenario = ref("normal");
let generationTimer: ReturnType<typeof setTimeout> | undefined;
let generationJob: ReturnType<typeof startProjectJob> | undefined;
let generationState: typeof state.value | undefined;
const hasValidEvidence = (task: PlanTask) =>
  task.evidence.some((evidence) => !evidence.archived) && task.evidence.filter((evidence) => !evidence.archived).every((evidence) => !staleEvidence(evidence));
const confirmedTasks = computed(() => taskItems.value.filter((task) => task.status === "confirmed"));
const validConfirmed = computed(() => confirmedTasks.value.filter(hasValidEvidence));
const reviewRequiredCount = computed(() => confirmedTasks.value.length - validConfirmed.value.length);
const progress = computed(() => `${validConfirmed.value.length} / ${taskItems.value.length}`);
const draft = ref<TaskDraft | null>(null);
const form = ref<HTMLFormElement>();
let editTrigger: HTMLElement | null = null;
const errors = ref<string[]>([]);
const notice = ref("");
const checked = ref(false);
const reworkReason = ref("");
const planningOpen = ref(false);
const planningDraft = ref("");
const planningMode = ref<"none" | "personal">("none");
const historyOpen = ref(false);
const activeEvidence = computed(() => selected.value?.evidence.filter((item) => !item.archived) ?? []);
const archivedEvidence = computed(() => selected.value?.evidence.filter((item) => item.archived) ?? []);
const dependencies = computed(
  () => selected.value?.dependencies.map((id) => taskItems.value.find((task) => task.id === id)).filter((task): task is PlanTask => !!task) ?? [],
);
const successors = computed(() => taskItems.value.filter((task) => task.dependencies.includes(selected.value?.id || "")));
const planErrors = computed(() => validatePlan(taskItems.value, workspace.current.deadline));
const candidateStale = computed(
  () =>
    state.value.candidate?.status === "expired" || (state.value.candidate?.status === "pending" && state.value.candidate.baseVersion !== state.value.version),
);
watch(selectedId, () => {
  checked.value = false;
  notice.value = "";
  reworkReason.value = "";
});
watch(
  () => workspace.activeId,
  () => {
    cancelProposal();
    selectedId.value = state.value.tasks[0]?.id ?? "";
    windowStart.value = localDate();
    draft.value = null;
  },
);
onBeforeUnmount(cancelProposal);
watch(
  () => route.query.task,
  (id) => {
    if (typeof id === "string") {
      selectedId.value = id;
      filter.value = "all";
      const target = taskItems.value.find((task) => task.id === id);
      if (target) windowStart.value = target.start;
      else notice.value = "该任务不存在或不属于当前项目，请从任务清单重新选择。";
    }
  },
  { immediate: true },
);
function beginEdit(task?: PlanTask) {
  editTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  errors.value = [];
  notice.value = "";
  draft.value = task
    ? {
        id: task.id,
        title: task.title,
        acceptance: task.acceptance,
        start: task.start,
        deadline: task.deadline,
        dependencies: [...task.dependencies],
        chapter: task.chapter,
        hardDeadline: task.hardDeadline,
        baseVersion: state.value.version,
      }
    : {
        id: crypto.randomUUID(),
        title: "",
        acceptance: "",
        start: localDate(),
        deadline: workspace.current.deadline,
        chapter: "",
        dependencies: [],
        hardDeadline: false,
        baseVersion: state.value.version,
      };
  void nextTick(() => form.value?.querySelector("input")?.focus());
}
function cancelEdit() {
  draft.value = null;
  errors.value = [];
  void nextTick(() => editTrigger?.focus());
}
function submitTask() {
  if (!draft.value) return;
  errors.value = saveTask(state.value, draft.value, workspace.current.deadline);
  if (errors.value.length) return;
  selectedId.value = draft.value.id;
  filter.value = "all";
  draft.value = null;
  notice.value = "任务已保存，依赖和日期校验通过。";
  void nextTick(() => editTrigger?.focus());
}
function cancelProposal() {
  if (generationTimer) clearTimeout(generationTimer);
  const job = generationJob;
  generationJob = undefined;
  job?.cancel();
  if (generationState?.generation?.status === "running") generationState.generation.status = "cancelled";
}
function showProposal() {
  if (generating.value) return;
  const target = state.value;
  const project = workspace.current;
  const baseVersion = target.version;
  const snapshot = JSON.parse(JSON.stringify(target)) as typeof target;
  target.generation = { id: crypto.randomUUID(), status: "running", error: "", baseVersion };
  generationState = target;
  errors.value = [];
  generationJob = startProjectJob(
    project,
    {
      title: "计划调整建议",
      kind: "计划",
      route: "/screens/plan",
      input: `计划 v${baseVersion} · ${target.tasks.length} 项任务`,
      sourceId: "plan-proposal",
      snapshot: { planVersion: baseVersion, deadline: project.deadline },
    },
    { cancel: cancelProposal, retry: showProposal },
  );
  const job = generationJob;
  generationTimer = setTimeout(() => {
    if (!job.isActive() || target.generation?.status !== "running") return;
    if (generationScenario.value === "timeout") {
      target.generation.status = "failed";
      target.generation.error = "模拟规划请求超时，原计划保留；可重新生成。";
      job.finish("failed", target.generation.error);
      return;
    }
    const candidate = proposePlan(snapshot, project.deadline);
    if (target.version !== baseVersion) candidate.status = "expired";
    target.candidate = candidate;
    target.generation.status = "done";
    job.finish(
      candidate.errors?.length ? "partial" : "done",
      candidate.errors?.join("；") || `已生成 ${candidate.changes.length} 项可审阅调整，正式计划未修改。`,
    );
    if (project.id === workspace.activeId) {
      preview.value = true;
      errors.value = candidate.errors ?? [];
    }
  }, 550);
}
function adoptPlan() {
  errors.value = applyPlan(state.value, workspace.current.deadline);
  if (!errors.value.length) {
    preview.value = false;
    workspace.recordEvent("计划调整已采纳", `计划 v${state.value.version}，由学生决定。`, "/screens/plan");
  }
}
function undoPlan() {
  errors.value = undoPlanChange(state.value, workspace.current.deadline);
  if (!errors.value.length) preview.value = false;
}
function keepPlan() {
  preview.value = false;
  if (state.value.candidate?.status === "pending") state.value.candidate.status = "rejected";
  errors.value = [];
}
function dueFor(task: PlanTask) {
  return `${shortDate(task.start)} — ${shortDate(task.deadline)}`;
}
function statusFor(task: PlanTask) {
  return task.status === "confirmed" && !hasValidEvidence(task) ? { tone: "warning" as const, label: "已确认 · 需复核" } : taskStatus[task.status];
}
function linkDocument() {
  if (selected.value) {
    associateDocument(state.value, selected.value, workspace.current.document.version);
    checked.value = false;
    notice.value = "当前正文版本已关联，旧证据保留在历史关联中。";
  }
}
function confirmSelected() {
  if (!selected.value) return;
  const error = confirmTask(state.value, selected.value.id, workspace.current.document.version, checked.value, materialVersions.value);
  notice.value = error || "已记录你的完成确认，进度已更新。";
  if (!error) workspace.recordEvent("任务已由学生确认", selected.value.title, "/screens/plan?task=" + selected.value.id);
}
function linkMaterial() {
  const material = library.value.materials.find((item) => item.id === materialId.value);
  if (!selected.value || !material) return;
  associateMaterial(state.value, selected.value, material);
  checked.value = false;
  notice.value = "资料版本已关联，更新后需重新复核。";
}
function updateStatus(status: "todo" | "doing" | "verify") {
  if (selected.value) notice.value = changeTaskStatus(state.value, selected.value, status, reworkReason.value) || "状态已更新，记录已保留。";
}
function openPlanning() {
  planningDraft.value = state.value.planning;
  planningMode.value = state.value.planningMode;
  planningOpen.value = true;
}
function savePlanning() {
  savePersonalPlanning(state.value, planningMode.value, planningDraft.value);
  workspace.current.planning = planningMode.value === "personal" ? planningDraft.value : "";
  planningOpen.value = false;
}
</script>

<template>
  <div class="screen-page plan-screen">
    <header class="screen-heading">
      <div>
        <p class="tp-label">Planning · 一步一步，走到答辩</p>
        <h1 class="tp-display mt-3">计划与进度</h1>
        <p class="screen-lead">看清接下来的一步，也留出从容修改的时间。</p>
      </div>
      <div class="plan-summary">
        <span class="tp-label">学生已确认 · 有效证据</span>
        <span class="tp-num">{{ progress }}</span>
        <span class="tp-caption">任务进度，不代表论文质量</span>
        <span v-if="reviewRequiredCount" class="tp-caption">另有 {{ reviewRequiredCount }} 项已确认任务需复核</span>
        <TpButton variant="primary" size="sm" @click="beginEdit()">新增任务</TpButton>
      </div>
    </header>
    <ProjectNotice />

    <section class="screen-panel plan-route" aria-label="毕业论文阶段">
      <div class="plan-route__intro">
        <span class="tp-label">你的毕设航线 · 流程 v{{ workspace.current.workflowVersion }}</span
        ><RouterLink class="tp-caption plan-link" to="/screens/today">当前 · {{ workspace.current.stage }} · 查看要求 ↗</RouterLink>
      </div>
      <div v-if="stages.length" class="plan-route__scroll"><StageRoute :stages="stages" /></div>
      <p v-else class="tp-ghost plan-no-evidence">
        未找到项目绑定的流程 v{{ workspace.current.workflowVersion }}，当前无法展示阶段要求。<RouterLink to="/screens/settings" class="plan-link"
          >查看流程配置 ↗</RouterLink
        >
      </p>
      <p v-if="stages.length && !stages.some((stage) => stage.state === 'current')" class="tp-caption mt-3">当前阶段不在绑定流程中，请核对项目设置后继续。</p>
    </section>

    <section class="screen-panel plan-planning" aria-label="个人规划">
      <div class="plan-planning__intro">
        <div>
          <p class="tp-label">个人规划</p>
          <p class="tp-subheading mt-2">{{ state.planningMode === "personal" ? "按你的节奏安排" : "先做好下一步，也可以暂不规划" }}</p>
          <p class="tp-caption mt-2">
            {{
              state.planningMode === "personal" ? state.planning || "已选择个人规划，时间偏好可随时补充。" : "当前仅依据任务、产物与截止时间，不推测你的效率。"
            }}
          </p>
        </div>
        <TpButton size="sm" @click="openPlanning">{{ state.planningMode === "personal" ? "编辑规划" : "设置个人规划" }}</TpButton>
      </div>
      <Transition name="tp-swap">
        <form v-if="planningOpen" class="plan-form mt-4" @submit.prevent="savePlanning" @keydown.esc.prevent="planningOpen = false">
          <TpSegmented
            v-model="planningMode"
            label="规划方式"
            :options="[
              { value: 'none', label: '暂不规划' },
              { value: 'personal', label: '填写规划' },
            ]"
          />
          <TpField v-if="planningMode === 'personal'" v-slot="field" label="可用时间与安排" optional hint="只记录你的安排，不自动移动任务。">
            <textarea :id="field.id" v-model="planningDraft" class="tp-input" rows="3" placeholder="例如每周三、周六安排实验，周日整理写作。" />
          </TpField>
          <div class="screen-actions">
            <TpButton type="submit" variant="primary" size="sm">保存规划</TpButton
            ><TpButton size="sm" variant="ghost" @click="planningOpen = false">取消</TpButton>
          </div>
        </form>
      </Transition>
    </section>

    <Transition name="tp-swap">
      <div v-if="errors.length" class="tp-ghost plan-errors" role="alert">
        <p class="tp-subheading">当前操作未保存</p>
        <ul>
          <li v-for="error in errors" :key="error">{{ error }}</li>
        </ul>
        <p class="tp-caption">原任务与硬截止保持不变，请修改冲突条件后重试。</p>
      </div>
    </Transition>
    <Transition mode="out-in" name="tp-swap">
      <p :key="notice" v-if="notice" class="plan-notice" role="status">{{ notice }}</p>
    </Transition>
    <p v-if="route.query.task && !taskItems.some((task) => task.id === route.query.task)" class="tp-ghost plan-no-evidence">
      当前项目中未找到关联任务，可从任务清单重新选择。
    </p>

    <div class="screen-columns plan-columns">
      <div class="plan-main">
        <section class="screen-panel plan-calendar" aria-labelledby="plan-calendar-title">
          <header class="screen-panel__head plan-calendar__heading">
            <div>
              <p class="tp-label">{{ windowStart.slice(0, 7) }} · 近期安排</p>
              <h2 id="plan-calendar-title" class="tp-heading mt-1">把时间留给重要的事</h2>
            </div>
            <span class="tp-mono plan-version">计划 v{{ planVersion }}</span>
          </header>
          <div class="plan-calendar__meta">
            <span><TpIcon :icon="PhCalendarBlank" :size="15" />{{ shortDate(windowStart) }} — {{ shortDate(windowEnd) }}</span
            ><span class="plan-legend"
              ><i />{{ adopted ? "已采纳计划" : "当前计划" }}<template v-if="preview"><i class="is-pencil" />调整候选</template></span
            >
          </div>
          <div class="screen-actions plan-window-controls">
            <TpButton size="sm" variant="ghost" @click="windowStart = shiftDate(windowStart, -14)">前两周</TpButton>
            <TpDatePicker v-model="windowStart" class="plan-window-date" type="date" aria-label="时间线开始日期" @change="windowStart ||= localDate()" />
            <TpButton size="sm" variant="ghost" @click="windowStart = localDate()">本周</TpButton>
            <TpButton size="sm" variant="ghost" @click="windowStart = shiftDate(windowStart, 14)">后两周</TpButton>
          </div>
          <div class="plan-calendar__scroll" tabindex="0" aria-label="两周任务时间轴，可横向滚动">
            <div class="plan-grid" :class="{ 'is-preview': preview }">
              <div class="plan-grid__dates">
                <span class="tp-label">任务</span>
                <div>
                  <span v-for="day in days" :key="day.iso" class="tp-mono" :class="{ 'is-today': day.iso === localDate(), 'is-weekend': day.weekend }">{{
                    day.date
                  }}</span>
                </div>
              </div>
              <TransitionGroup name="tp-list" tag="div" class="tp-list-group" v-bind="listMotionHooks">
                <div v-for="item in schedule" :key="item.id" class="plan-grid__row">
                  <button type="button" class="plan-grid__label" @click="selectedId = item.id">{{ item.title }}</button>
                  <div class="plan-grid__lane">
                    <span v-for="day in days" :key="day.date" class="plan-grid__cell" :class="{ 'is-weekend': day.weekend }" />
                    <button
                      v-if="item.beforeVisible"
                      type="button"
                      class="plan-bar"
                      :class="{ 'is-original': preview }"
                      :style="{ '--start': item.start, '--end': item.end }"
                      :aria-label="`${item.title}，${adopted ? item.after : item.before}，查看任务`"
                      @click="selectedId = item.id"
                    >
                      <span>{{ adopted ? item.after : item.before }}</span>
                    </button>
                    <Transition name="tp-swap">
                      <span
                        v-if="preview && item.changed && item.afterVisible"
                        class="plan-bar is-candidate"
                        :style="{ '--start': item.nextStart, '--end': item.nextEnd }"
                        >{{ item.after }}</span
                      >
                    </Transition>
                  </div>
                </div>
              </TransitionGroup>
              <div
                v-if="todayOffset >= 0 && todayOffset < 14"
                class="plan-grid__today"
                :style="{ left: `calc(108px + (100% - 108px) * ${todayOffset + 0.5} / 14)` }"
                aria-hidden="true"
              >
                <span>今天</span>
              </div>
            </div>
          </div>
          <p class="tp-caption plan-window-note">
            {{
              schedule.length
                ? `显示本窗口全部 ${schedule.length} 项任务；可翻页，或从任务详情定位其他月份。`
                : "当前两周窗口没有安排，完整任务与日期可在下方清单查看。"
            }}
          </p>
          <footer class="plan-calendar__footer">
            <TpIcon :icon="PhFlagPennant" :size="15" /><span>论文提交 <b class="tp-mono">{{ workspace.current.deadline }}</b></span
            ><span class="tp-caption">硬截止保持不变</span>
          </footer>
        </section>

        <section :class="adopted ? 'tp-ink' : 'tp-pencil'" class="plan-proposal" aria-label="计划调整建议">
          <div class="plan-proposal__intro">
            <span class="tp-avatar tp-avatar--sm" data-agent="progress">程</span>
            <div>
              <p class="tp-label">进度助手 · {{ adopted ? "你的决定" : "等你决定" }}</p>
              <h2 class="tp-subheading mt-1">
                {{ adopted ? `调整已记入计划 v${state.candidate?.resultVersion}` : "让任务依赖与可用时间对齐" }}
              </h2>
            </div>
            <TpSeal v-if="adopted" text="已采纳" />
          </div>
          <p class="plan-proposal__body">
            {{
              adopted
                ? `已调整 ${state.candidate?.changes.length ?? 0} 项任务；论文硬截止保持不变。`
                : "依据当前任务时长、前置关系和项目截止模拟排期。所有调整先交给你审阅，确认前不会改变正式计划。"
            }}
          </p>
          <div class="plan-generation-status" role="status">
            <Transition mode="out-in" name="tp-swap">
              <p :key="state.generation?.status" class="tp-caption">
                {{
                  generating
                    ? "正在核对依赖与日期…"
                    : state.generation?.status === "failed" || state.generation?.status === "cancelled"
                      ? state.generation.error || "已取消生成，原计划保留。"
                      : "先预览建议，再决定是否调整正式计划。"
                }}
              </p>
            </Transition>
          </div>
          <details class="plan-simulation tp-disclosure">
            <summary class="tp-caption">模拟场景</summary>
            <TpSelect
              v-model="generationScenario"
              class="plan-generation-select"
              aria-label="计划生成模拟场景"
              :options="[
                { value: 'normal', label: '正常计算' },
                { value: 'timeout', label: '请求超时' },
              ]"
            />
          </details>
          <Transition mode="out-in" name="tp-swap">
            <div
              :key="state.generation?.id ?? state.candidate?.input?.at ?? state.candidate?.baseVersion"
              class="plan-proposal-preview"
              v-if="preview && !adopted"
            >
              <div class="plan-proposal__changes">
                <div v-for="item in proposalRows" :key="item.id">
                  <span>{{ item.title }}</span><s class="tp-mono">{{ item.before }}</s><TpIcon :icon="PhArrowRight" :size="14" /><b class="tp-mono">{{
                    item.after
                  }}</b>
                </div>
              </div>
              <p class="tp-caption">依据：计划 v{{ state.candidate?.baseVersion }}。未观察到完成证据，不代表你没有进展。</p>
              <p v-for="reason in state.candidate?.reasons" :key="reason" class="tp-caption mt-2">{{ reason }}</p>
              <p v-if="candidateStale" class="plan-overdue mt-3" role="alert">计划已变化，当前候选已过期。请重新生成再审阅。</p>
              <p v-if="!state.candidate?.changes.length" class="tp-ghost plan-no-evidence">
                {{ state.candidate?.errors?.join("；") || "当前没有需要移动的任务，可以保留原计划。" }}
              </p>
            </div>
          </Transition>
          <div class="plan-proposal__actions">
            <Transition name="tp-swap" mode="out-in"
              ><div :key="adopted ? 'adopted' : preview ? 'preview' : 'idle'" class="plan-proposal-action-content">
                <template v-if="generating"
                  ><span class="tp-caption">当前计划保持不变</span><TpButton variant="ghost" size="sm" @click="cancelProposal">取消生成</TpButton></template
                >
                <template v-else-if="adopted"
                  ><span class="tp-caption" role="status">本页演示状态已更新</span><TpButton variant="ghost" size="sm" @click="undoPlan">撤销本次采纳</TpButton
                  ><TpButton variant="pencil" size="sm" :disabled="generating" @click="showProposal">重新计算调整</TpButton></template
                >
                <template v-else-if="preview"
                  ><span class="tp-caption">采纳前，当前计划保持不变</span><TpButton variant="ghost" size="sm" @click="keepPlan">暂时保留原计划</TpButton
                  ><TpButton v-if="candidateStale" variant="pencil" size="sm" @click="showProposal">重新生成调整</TpButton
                  ><TpButton v-else variant="seal" size="sm" :disabled="!state.candidate?.changes.length" @click="adoptPlan">采纳这份调整</TpButton></template
                >
                <template v-else
                  ><span class="tp-caption">候选基于当前计划 v{{ planVersion }}</span
                  ><TpButton variant="pencil" size="sm" :disabled="generating" @click="showProposal"
                    >查看调整<TpIcon :icon="PhArrowRight" :size="14" /></TpButton
                ></template></div
            ></Transition>
          </div>
        </section>

        <section class="screen-panel plan-tasks" aria-labelledby="plan-tasks-title">
          <header class="screen-panel__head plan-tasks__heading">
            <h2 id="plan-tasks-title" class="tp-heading">任务清单</h2>
            <TpSegmented
              v-model="filter"
              label="任务筛选"
              :options="[
                { value: 'active', label: '未完成' },
                { value: 'verify', label: '待核验' },
                { value: 'all', label: '全部' },
              ]"
            />
          </header>
          <Transition name="tp-swap">
            <form v-if="draft" ref="form" class="plan-form plan-task-form" aria-label="任务编辑" @submit.prevent="submitTask" @keydown.esc.prevent="cancelEdit">
              <div class="plan-form__heading">
                <h3 class="tp-subheading">{{ taskItems.some((task) => task.id === draft?.id) ? "编辑任务" : "新增任务" }}</h3>
                <span class="tp-caption">Enter 保存 · Esc 取消</span>
              </div>
              <TpField v-slot="field" label="任务目标" required><input :id="field.id" v-model="draft.title" class="tp-input" maxlength="200" /></TpField>
              <TpField v-slot="field" label="验收条件" required>
                <textarea :id="field.id" v-model="draft.acceptance" class="tp-input" rows="2" maxlength="2000" />
              </TpField>
              <div class="plan-form__grid">
                <TpField v-slot="field" label="开始日期" required><TpDatePicker :id="field.id" v-model="draft.start" type="date" /></TpField
                ><TpField v-slot="field" label="截止日期" required
                  ><TpDatePicker
                    :id="field.id"
                    v-model="draft.deadline"
                    type="date"
                    :disabled="!!taskItems.find((task) => task.id === draft?.id)?.hardDeadline"
                /></TpField>
              </div>
              <TpField v-slot="field" label="关联章节" optional
                ><input :id="field.id" v-model="draft.chapter" class="tp-input" placeholder="例如第 3 章"
              /></TpField>
              <label class="plan-check"
                ><input
                  class="tp-checkbox"
                  v-model="draft.hardDeadline"
                  type="checkbox"
                  :disabled="!!taskItems.find((task) => task.id === draft?.id)?.hardDeadline"
                />固定该任务截止日期</label
              >
              <fieldset class="plan-dependency-picker">
                <legend class="tp-label">前置任务（可多选）</legend>
                <label v-for="task in taskItems.filter((item) => item.id !== draft?.id)" :key="task.id" class="plan-check"
                  ><input class="tp-checkbox" v-model="draft.dependencies" type="checkbox" :value="task.id" />{{ task.title }}</label
                >
                <p v-if="taskItems.length === 0" class="tp-caption">这是第一个任务，无需设置依赖。</p>
              </fieldset>
              <div class="screen-actions">
                <TpButton type="submit" variant="primary" size="sm">保存任务</TpButton><TpButton variant="ghost" size="sm" @click="cancelEdit">取消</TpButton>
              </div>
            </form>
          </Transition>
          <TransitionGroup name="tp-list" tag="div" v-bind="listMotionHooks" class="plan-task-list tp-list-group">
            <button
              v-for="task in visibleTasks"
              :key="task.id"
              type="button"
              class="plan-task"
              :class="{ 'is-selected': selectedId === task.id }"
              :aria-pressed="selectedId === task.id"
              @click="selectedId = task.id"
            >
              <span class="plan-task__marker" :class="{ 'is-confirmed': task.status === 'confirmed' }"
                ><TpIcon v-if="task.status === 'confirmed'" :icon="PhCheck" :size="12" /><TpIcon
                  v-else-if="task.status === 'verify'"
                  :icon="PhMagnifyingGlass"
                  :size="12"
              /></span>
              <span class="plan-task__text"
                ><b>{{ task.title }}</b
                ><span class="tp-caption"
                  >{{ task.chapter ?? "中期检查" }}<template v-if="dueFor(task)"> · {{ dueFor(task) }}</template
                  ><span v-if="task.deadline < localDate() && task.status !== 'confirmed'" class="plan-overdue"> · 已延期</span></span
                ></span
              >
              <TpStatus size="sm" :tone="statusFor(task).tone" :label="statusFor(task).label" />
            </button>
          </TransitionGroup>
          <TpState
            v-if="!visibleTasks.length"
            :kind="taskItems.length ? 'noresult' : 'empty'"
            :title="taskItems.length ? '这里暂时没有任务' : '从一项具体任务开始'"
            :desc="taskItems.length ? '切换全部任务，查看已确认项目。' : '写下目标、验收条件和期限，再关联实际产物。'"
            ><TpButton v-if="taskItems.length" size="sm" @click="filter = 'all'">查看全部任务</TpButton
            ><TpButton v-else variant="primary" size="sm" @click="beginEdit()">创建第一项任务</TpButton></TpState
          >
          <p class="plan-tasks__footer tp-caption">{{ visibleTasks.length }} 项任务 · 选择任务查看依据与前置条件</p>
        </section>
        <section class="screen-panel plan-history">
          <button class="plan-history__toggle" type="button" :aria-expanded="historyOpen" @click="historyOpen = !historyOpen">
            <span class="tp-subheading">计划历史</span><span class="tp-caption">{{ state.history.length }} 条记录 · {{ historyOpen ? "收起" : "展开" }}</span>
          </button>
          <Transition name="tp-swap">
            <div v-if="historyOpen" class="plan-history__body">
              <Transition name="tp-swap" mode="out-in">
                <p key="boundary-first" v-if="!state.history.length" class="tp-caption">还没有本次预览的变更记录。</p>
                <TransitionGroup key="boundary-last" class="tp-list-group" name="tp-list" tag="ol" v-bind="listMotionHooks" v-else>
                  <li v-for="item in state.history" :key="item.id">
                    <b>v{{ item.version }} · {{ item.summary }}</b><span class="tp-caption">{{ item.at }}</span>
                    <details class="tp-disclosure" v-if="item.snapshot">
                      <summary class="plan-link tp-caption">查看当时任务安排</summary>
                      <ul class="plan-snapshot">
                        <li v-for="task in item.snapshot" :key="task.id">
                          <span>{{ task.title }}</span
                          ><span class="tp-caption">{{ task.start }} — {{ task.deadline }} · {{ taskStatus[task.status].label }}</span>
                        </li>
                      </ul>
                    </details>
                  </li>
                </TransitionGroup>
              </Transition>
            </div>
          </Transition>
        </section>
      </div>

      <Transition mode="out-in" name="tp-swap">
        <aside :key="selected.id" v-if="selected" class="plan-aside" aria-label="任务详情">
          <section class="screen-panel plan-detail" aria-live="polite">
            <div class="plan-detail__top">
              <p class="tp-label">任务详情</p>
              <span class="tp-mono">{{ selected.id.toUpperCase() }}</span>
            </div>
            <TpStatus :tone="statusFor(selected).tone" :label="statusFor(selected).label" size="sm" />
            <h2 class="tp-heading plan-detail__title">{{ selected.title }}</h2>
            <div class="screen-actions mt-3">
              <TpButton size="sm" @click="beginEdit(selected)">编辑任务</TpButton
              ><TpButton size="sm" variant="ghost" :disabled="taskItems[0]?.id === selected.id" @click="moveTask(state, selected.id, -1)">上移</TpButton
              ><TpButton size="sm" variant="ghost" :disabled="taskItems.at(-1)?.id === selected.id" @click="moveTask(state, selected.id, 1)">下移</TpButton>
            </div>
            <TpButton size="sm" variant="ghost" @click="windowStart = selected.start">定位到时间线</TpButton>
            <RouterLink
              v-for="feedbackId in [...new Set([...(selected.feedbackIds ?? []), ...(selected.feedbackId ? [selected.feedbackId] : [])])]"
              :key="feedbackId"
              class="plan-source-link tp-caption"
              :to="'/screens/feedback?feedback=' + feedbackId"
              >查看导师反馈 {{ feedbackId }} 原文 ↗</RouterLink
            >
            <p v-if="dueFor(selected)" class="plan-detail__date">
              <TpIcon :icon="PhClock" :size="15" />{{ dueFor(selected) }}<span v-if="selected.hardDeadline">· 硬截止</span>
            </p>
            <div class="plan-detail__section">
              <p class="tp-label">完成标准</p>
              <p class="mt-2">
                {{ selected.acceptance ?? (selected.id === "t5" ? "按当前模板整理参考文献，并逐条核对来源。" : "保留提交产物及本人确认记录。") }}
              </p>
            </div>
            <div v-if="dependencies.length || successors.length" class="plan-detail__section">
              <p class="tp-label">前置条件</p>
              <ul class="plan-deps">
                <li v-for="dependency in dependencies" :key="dependency.id">
                  <TpIcon
                    :icon="dependency.status === 'confirmed' ? PhCheck : PhGitBranch"
                    :size="14"
                    :class="dependency.status === 'confirmed' ? 'text-ok-content' : 'text-warn-content'"
                  /><button type="button" class="plan-link" @click="selectedId = dependency.id">{{ dependency.title }}</button
                  ><span class="tp-caption">{{ dependency.status === "confirmed" ? "已确认" : "未就绪" }}</span>
                </li>
              </ul>
              <template v-if="successors.length"
                ><p class="tp-label mt-4">后续任务</p>
                <ul class="plan-deps">
                  <li v-for="task in successors" :key="task.id">
                    <TpIcon :icon="PhGitBranch" :size="14" /><button type="button" class="plan-link" @click="selectedId = task.id">{{ task.title }}</button>
                  </li>
                </ul></template
              >
            </div>
            <div class="plan-detail__section">
              <p class="tp-label">关联产物 · 具体到版本</p>
              <Transition name="tp-swap" mode="out-in">
                <TransitionGroup
                  key="boundary-first"
                  name="tp-list"
                  tag="div"
                  v-bind="listMotionHooks"
                  v-if="activeEvidence.length"
                  class="plan-evidence tp-list-group"
                >
                  <div v-for="evidence in activeEvidence" :key="evidence.id" class="plan-evidence-row">
                    <RouterLink :to="evidence.route || '/screens/library'"
                      ><EvidenceChip :evidence="{ ...evidence, stale: staleEvidence(evidence) }" /></RouterLink
                    ><TpButton
                      variant="ghost"
                      size="sm"
                      :label="'解除关联：' + evidence.label"
                      @click="
                        setEvidenceArchived(state, selected, evidence.id, true);
                        checked = false;
                      "
                      >解除</TpButton
                    >
                  </div>
                </TransitionGroup>
                <p key="boundary-last" v-else class="tp-ghost plan-no-evidence">
                  尚未关联产物<br /><span class="tp-caption">完成后可关联正文或文件作为依据。</span>
                </p>
              </Transition>
              <p v-if="activeEvidence.some(staleEvidence)" class="plan-overdue tp-caption mt-3">正文或资料已变化，请复核旧版本证据。</p>
              <TpButton class="mt-3" size="sm" @click="linkDocument">关联当前正文 v{{ workspace.current.document.version }}</TpButton>
              <TpField v-slot="field" label="关联项目资料" class="mt-3"
                ><TpSelect
                  :id="field.id"
                  v-model="materialId"
                  :options="[
                    { value: '', label: '选择已有资料版本' },
                    ...library.materials
                      .filter((item) => item.linked && !item.removed)
                      .map((material) => ({ value: material.id, label: `${material.name} · v${material.version}` })),
                  ]"
              /></TpField>
              <div class="screen-actions mt-2">
                <TpButton size="sm" :disabled="!materialId" @click="linkMaterial">关联所选资料</TpButton
                ><RouterLink to="/screens/library" class="plan-link tp-caption">管理资料 ↗</RouterLink>
              </div>
              <details v-if="archivedEvidence.length" class="mt-3 tp-disclosure">
                <summary class="tp-caption">历史关联（{{ archivedEvidence.length }}）</summary>
                <div class="plan-evidence">
                  <TransitionGroup name="tp-list" tag="div" class="tp-list-group plan-archived-evidence" v-bind="listMotionHooks">
                    <div v-for="evidence in archivedEvidence" :key="evidence.id" class="plan-evidence-row">
                      <RouterLink :to="evidence.route || '/screens/write'"><EvidenceChip :evidence="evidence" /></RouterLink
                      ><TpButton
                        variant="ghost"
                        size="sm"
                        :label="'恢复关联：' + evidence.label"
                        @click="
                          setEvidenceArchived(state, selected, evidence.id, false);
                          checked = false;
                        "
                        >恢复</TpButton
                      >
                    </div>
                  </TransitionGroup>
                </div>
              </details>
            </div>
            <div class="plan-detail__section plan-decide">
              <p class="tp-label">由你核验并决定</p>
              <template v-if="selected.status !== 'confirmed'"
                ><div class="screen-actions mt-3">
                  <TpButton size="sm" variant="ghost" :disabled="selected.status === 'todo'" @click="updateStatus('todo')">待开始</TpButton
                  ><TpButton size="sm" variant="ghost" :disabled="selected.status === 'doing'" @click="updateStatus('doing')">进行中</TpButton
                  ><TpButton size="sm" variant="ghost" :disabled="selected.status === 'verify'" @click="updateStatus('verify')">待核验</TpButton>
                </div>
                <label class="plan-check mt-3"><input class="tp-checkbox" v-model="checked" type="checkbox" />我已核对任务标准与关联证据</label
                ><TpButton variant="seal" size="sm" class="mt-3" :disabled="!checked" @click="confirmSelected">确认任务完成</TpButton></template
              ><template v-else
                ><TpSeal class="mt-3" text="学生已确认" />
                <p class="tp-caption mt-2">{{ selected.confirmedAt || "初始样例确认记录" }}</p>
                <TpField v-slot="field" class="mt-3" label="返工原因"
                  ><input :id="field.id" v-model="reworkReason" class="tp-input" placeholder="例如补充实验后重新核验" /></TpField
                ><TpButton size="sm" class="mt-3" @click="updateStatus('doing')">记录返工</TpButton></template
              >
              <p class="tp-caption mt-3">确认只代表你的完成判断，不代表论文质量或导师认可。</p>
            </div>
            <details class="plan-detail__section tp-disclosure">
              <summary class="tp-label">任务处理记录（{{ selected.history.length }}）</summary>
              <TransitionGroup name="tp-list" tag="ol" v-bind="listMotionHooks" class="plan-task-history tp-list-group">
                <li v-for="item in selected.history" :key="item.id">
                  <b>{{ item.summary }}</b><span class="tp-caption">{{ item.at }} · v{{ item.version }}</span>
                </li>
                <li v-if="!selected.history.length" key="empty-history" class="tp-caption">暂无本次预览的处理记录。</li>
              </TransitionGroup>
            </details>
          </section>
          <div class="plan-note">
            <TpIcon :icon="PhSparkle" :size="18" />
            <div>
              <p class="tp-subheading">每一步，都有依据。</p>
              <p class="tp-caption mt-2">已有产物只是完成的线索。任务是否完成，由你核验后决定。</p>
            </div>
          </div>
          <div class="plan-deadline">
            <div>
              <p class="tp-label">论文提交截止</p>
              <h3 class="tp-subheading mt-2">论文提交</h3>
            </div>
            <div>
              <span class="tp-num">{{ shortDate(workspace.current.deadline) }}</span>
              <p class="tp-caption">调整计划时保持固定</p>
            </div>
          </div>
          <div v-if="planErrors.length" class="tp-ghost plan-errors">
            <p class="tp-label">计划存在约束冲突</p>
            <ul>
              <li v-for="error in planErrors" :key="error">{{ error }}</li>
            </ul>
            <RouterLink to="/screens/projects" class="plan-link">查看项目截止条件 ↗</RouterLink>
          </div>
        </aside>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.plan-window-controls {
  padding: 0 24px 16px;
  gap: 8px;
  flex-wrap: wrap;
}
.plan-window-date {
  width: 155px;
  min-width: 0;
}
.plan-simulation {
  margin-bottom: 12px;
}
.plan-generation-select {
  max-width: 220px;
  margin-top: 8px;
}
.plan-summary {
  display: grid;
  gap: 4px;
  text-align: right;
  flex-shrink: 0;
}
.plan-planning {
  padding: 20px 24px;
}
.plan-planning__intro,
.plan-form__heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.plan-planning__intro > div {
  min-width: 0;
}
.plan-form {
  display: grid;
  gap: 16px;
}
.plan-task-form {
  padding: 24px;
  border-top: 1px solid var(--tp-line);
  background: var(--tp-surface-sunken);
}
.plan-form__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
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
  accent-color: var(--tp-accent);
}
.plan-dependency-picker {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.plan-dependency-picker legend {
  margin-bottom: 12px;
}
.plan-errors {
  padding: 20px;
  display: grid;
  gap: 12px;
  overflow-wrap: anywhere;
}
.plan-errors ul {
  display: grid;
  gap: 8px;
  list-style: disc;
  padding-left: 20px;
}
.plan-notice {
  padding: 12px 16px;
  border-left: 2px solid var(--tp-info);
  background: var(--tp-surface-sunken);
  font-size: 13px;
}
.plan-source-link {
  display: inline-block;
  margin-top: 12px;
}
.plan-link {
  text-align: left;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.plan-history__toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  padding: 20px 24px;
  text-align: left;
}
.plan-history__body {
  padding: 0 24px 24px;
}
.plan-history ol,
.plan-task-history {
  display: grid;
  gap: 16px;
}
.plan-history li,
.plan-task-history li {
  display: grid;
  gap: 4px;
  font-size: 13px;
}
.plan-task-history {
  margin-top: 16px;
}
.plan-snapshot {
  display: grid;
  gap: 12px;
  margin-top: 12px;
  padding: 16px;
  background: var(--tp-surface-sunken);
  border-radius: var(--tp-radius-s);
}
.plan-evidence a {
  max-width: 100%;
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
}
.plan-evidence :deep(.tp-evi) {
  white-space: normal;
  flex-wrap: wrap;
}
.plan-decide .tp-seal {
  width: fit-content;
}
.plan-summary > .tp-num {
  font-size: 32px;
  line-height: 1.2;
}
.plan-route {
  padding: 20px 24px 24px;
}
.plan-route__intro {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 24px;
}
.plan-route__scroll {
  overflow-x: auto;
}
.plan-route__scroll > * {
  min-width: 540px;
}
.plan-columns {
  align-items: start;
}
.plan-main {
  display: grid;
  gap: 24px;
  min-width: 0;
}
.plan-calendar {
  overflow: hidden;
}
.plan-calendar__heading {
  align-items: center;
}
.plan-version {
  white-space: nowrap;
  color: var(--tp-text-muted);
}
.plan-calendar__meta {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px 24px 20px;
  color: var(--tp-text-muted);
  font-size: 12px;
}
.plan-calendar__meta > span,
.plan-legend {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.plan-legend i {
  width: 16px;
  height: 8px;
  border-radius: var(--tp-radius-xs);
  background: var(--tp-ink);
}
.plan-legend i.is-pencil {
  background: var(--tp-pencil-soft);
  border: 1px dashed var(--tp-pencil-line);
}
.plan-calendar__scroll {
  overflow-x: auto;
  padding: 0 24px 20px;
}
.plan-grid {
  position: relative;
  min-width: 570px;
}
.plan-grid__dates,
.plan-grid__row {
  display: grid;
  grid-template-columns: 108px 1fr;
  align-items: center;
}
.plan-grid__dates {
  height: 32px;
}
.plan-grid__dates > div {
  display: grid;
  grid-template-columns: repeat(14, minmax(0, 1fr));
  text-align: center;
}
.plan-grid__dates .tp-mono {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  margin: auto;
  color: var(--tp-text-muted);
}
.plan-grid__dates .is-today {
  background: var(--tp-accent-soft);
  color: var(--tp-accent-soft-content);
  border-radius: 50%;
  font-weight: 700;
}
.plan-grid__dates .is-weekend:not(.is-today) {
  color: var(--tp-text-faint);
}
.plan-grid__row {
  min-height: 56px;
}
.plan-grid__label {
  font-size: 12px;
  text-align: left;
  width: fit-content;
}
.plan-grid__label:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.plan-grid__lane {
  height: 56px;
  position: relative;
  display: grid;
  grid-template-columns: repeat(14, minmax(0, 1fr));
}
.plan-grid__cell {
  border-left: 1px solid var(--tp-line);
}
.plan-grid__cell.is-weekend {
  background: var(--tp-surface-sunken);
}
.plan-bar {
  position: absolute;
  top: 15px;
  left: calc(var(--start) / 14 * 100% + 2px);
  width: calc((var(--end) - var(--start)) / 14 * 100% - 4px);
  height: 26px;
  border-radius: var(--tp-radius-xs);
  border: 1px solid var(--tp-ink);
  background: var(--tp-ink);
  color: var(--tp-surface);
  font-family: var(--tp-font-mono);
  font-size: 10px;
  line-height: 24px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  z-index: 1;
}
.plan-bar.is-original {
  top: 8px;
  height: 16px;
  line-height: 14px;
  background: transparent;
  border-style: dashed;
  border-color: var(--tp-ghost-line);
  color: var(--tp-text-muted);
}
.plan-bar.is-candidate {
  top: 28px;
  height: 22px;
  line-height: 20px;
  border-style: dashed;
  border-color: var(--tp-pencil-line);
  background: var(--tp-pencil-soft);
  color: var(--tp-pencil-content);
}
.plan-grid__today {
  position: absolute;
  top: 32px;
  bottom: 0;
  left: calc(108px + (100% - 108px) * 5.5 / 14);
  border-left: 1px dashed var(--tp-accent);
  pointer-events: none;
  z-index: 2;
}
.plan-grid__today span {
  position: absolute;
  top: -29px;
  left: -13px;
  font-size: 10px;
  color: var(--tp-accent-soft-content);
  opacity: 0;
}
.plan-calendar__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border-top: 1px solid var(--tp-line);
}
.plan-calendar__footer > .tp-caption {
  margin-left: auto;
}
.plan-window-note {
  padding: 0 24px 16px;
}
.plan-proposal {
  padding: 20px;
}
.plan-proposal__intro {
  display: flex;
  gap: 12px;
  align-items: center;
}
.plan-proposal__intro > div {
  flex: 1;
}
.plan-proposal__body {
  margin: 12px 0 16px;
  color: var(--tp-text-muted);
}
.plan-generation-status {
  min-height: 36px;
  margin-bottom: 8px;
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
.plan-proposal__changes {
  display: grid;
  gap: 12px;
  margin: 16px 0;
  padding: 16px 0;
  border-block: 1px dashed var(--tp-pencil-line);
}
.plan-proposal__changes > div {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.plan-proposal__changes > div > span {
  margin-right: auto;
  min-width: 100px;
}
.plan-proposal__changes s {
  color: var(--tp-text-muted);
}
.plan-proposal > .tp-caption,
.plan-proposal-preview > .tp-caption {
  margin-bottom: 16px;
}
.plan-tasks__heading {
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.plan-task-list {
  border-top: 1px solid var(--tp-line);
}
.plan-task {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  text-align: left;
  border-bottom: 1px solid var(--tp-line);
  border-left: 3px solid transparent;
  transition: background-color var(--tp-dur-fast) var(--tp-ease-standard);
}
.plan-task:hover {
  background: var(--tp-surface-sunken);
}
.plan-task.is-selected {
  border-left-color: var(--tp-accent);
  background: var(--tp-surface-sunken);
}
.plan-task__marker {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  border: 1px solid var(--tp-line-strong);
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--tp-text-muted);
}
.plan-task__marker.is-confirmed {
  color: var(--tp-seal);
  border-color: var(--tp-seal);
}
.plan-task__text {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 4px;
}
.plan-task__text b {
  font-size: 14px;
  font-weight: 600;
}
.plan-overdue {
  color: var(--tp-warning-content);
}
.plan-tasks__footer {
  padding: 12px 24px;
}
.plan-aside {
  display: grid;
  gap: 24px;
  min-width: 0;
}
.plan-detail {
  padding: 24px;
}
.plan-detail__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  color: var(--tp-text-muted);
}
.plan-detail__title {
  margin-top: 12px;
  line-height: 1.5;
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
.plan-detail__section {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--tp-line);
}
.plan-detail__section > p:not(.tp-label) {
  font-size: 13px;
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
.plan-archived-evidence {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}
.plan-no-evidence {
  padding: 16px;
  margin-top: 12px;
  line-height: 1.8;
}
.plan-note {
  display: flex;
  gap: 12px;
  padding: 0 4px;
  color: var(--tp-text-muted);
}
.plan-note > svg {
  flex-shrink: 0;
  margin-top: 3px;
}
.plan-note .tp-subheading {
  font-size: 14px;
  color: var(--tp-text);
}
.plan-deadline {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 4px 0;
  border-top: 1px solid var(--tp-line);
}
.plan-deadline > div:last-child {
  text-align: right;
}
.plan-deadline .tp-num {
  font-size: 32px;
  line-height: 1.2;
}
.plan-deadline .tp-num > span {
  color: var(--tp-text-faint);
  padding: 0 2px;
}
@media (max-width: 700px) {
  .plan-summary {
    text-align: left;
  }
  .plan-summary > .tp-num {
    font-size: 32px;
  }
  .plan-planning {
    padding: 16px;
  }
  .plan-planning__intro,
  .plan-form__heading {
    flex-wrap: wrap;
  }
  .plan-task-form {
    padding: 16px;
  }
  .plan-form__grid {
    grid-template-columns: 1fr;
  }
  .plan-route {
    padding: 16px;
  }
  .plan-route__intro {
    flex-wrap: wrap;
  }
  .plan-calendar__meta,
  .plan-calendar__scroll {
    padding-left: 16px;
    padding-right: 16px;
  }
  .plan-calendar__heading {
    align-items: start;
  }
  .plan-calendar__heading .tp-heading {
    font-size: 18px;
  }
  .plan-task {
    padding: 16px 12px;
    gap: 8px;
    flex-wrap: wrap;
  }
  .plan-task__text {
    flex-basis: calc(100% - 40px);
  }
  .plan-task > .tp-status {
    margin-left: 28px;
  }
  .plan-proposal {
    padding: 16px;
  }
  .plan-proposal__intro {
    align-items: start;
  }
  .plan-proposal__intro > .tp-seal {
    flex-shrink: 0;
  }
  .plan-proposal-action-content > .tp-caption {
    flex-basis: 100%;
  }
  .plan-detail {
    padding: 20px;
  }
  .plan-proposal__changes > div > span {
    flex-basis: 100%;
  }
}
</style>
