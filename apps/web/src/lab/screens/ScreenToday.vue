<script setup lang="ts">
import { listMotionHooks } from "@/design/motion";
import TpSelect from "@/components/ui/TpSelect.vue";
import { computed, ref, onMounted, onBeforeUnmount, onActivated } from "vue";
import { PhArrowRight, PhNotePencil, PhPath, PhChatTeardropText, PhMagnifyingGlass } from "@phosphor-icons/vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpProgress from "@/components/ui/TpProgress.vue";
import ProjectNotice from "../components/ProjectNotice.vue";
import { usePreviewWorkspaceStore, usePreviewModule } from "../state/previewWorkspace";
import { usePlanState, isStaleEvidence } from "../state/planState";
import { useInboxState } from "../state/inboxState";
import { useSettingsState } from "../state/settingsState";
import { useFeedbackState } from "../state/feedbackState";
import { useLibraryState, boundLibraryRequirements } from "../state/libraryState";
import { thesisWordCount, wordTarget } from "../services/libraryService";
import { stageElapsed, availableNextStages, type StageProgressState } from "../state/projectProgress";
import type { WritingState } from "../state/writingState";
const workspace = usePreviewWorkspaceStore();
const plan = usePlanState();
const inbox = useInboxState();
const settings = useSettingsState();
const feedback = useFeedbackState();
const library = useLibraryState();
const phase = usePreviewModule<StageProgressState>("stageProgress", () => ({ confirmations: [] }));
const now = ref(new Date());
const phaseVerified = ref(false);
const phaseNote = ref("");
const phaseNotice = ref("");
const chosenNext = ref("");
let clock: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  clock = setInterval(() => {
    now.value = new Date();
  }, 60_000);
});
onBeforeUnmount(() => clearInterval(clock));
onActivated(() => {
  now.value = new Date();
});
const active = computed(() =>
  plan.value.tasks
    .filter((t) => t.status !== "confirmed")
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .slice(0, 3),
);
const completed = computed(() => validTasks.value.length);
const stages = computed(() =>
  (settings.value.workflowHistory.find((v) => v.version === workspace.current.workflowVersion)?.stages ?? []).filter((s) => s.enabled),
);
const currentStage = computed(() => stages.value.find((s) => s.name === workspace.current.stage));
const confirmedIds = computed(() =>
  phase.value.confirmations.filter((item) => item.workflowVersion === workspace.current.workflowVersion).map((item) => item.stageId),
);
const nextStages = computed(() => (currentStage.value ? availableNextStages(stages.value, currentStage.value.id, confirmedIds.value) : []));
const time = computed(() => stageElapsed(currentStage.value?.start, currentStage.value?.deadline || "", now.value));
const words = computed(() => thesisWordCount(workspace.current.document.html));
const target = computed(() => wordTarget(boundLibraryRequirements(library.value, workspace.current.requirementVersion)));
const wordPercent = computed(() => (target.value.target ? Math.min(100, Math.round((words.value / target.value.target) * 100)) : 0));
const materialVersions = computed(() => Object.fromEntries(library.value.materials.filter((item) => !item.removed).map((item) => [item.id, item.version])));
const validTasks = computed(() =>
  plan.value.tasks.filter(
    (task) =>
      task.status === "confirmed" &&
      task.evidence.some((e) => !e.archived) &&
      task.evidence.filter((e) => !e.archived).every((e) => !isStaleEvidence(e, workspace.current.document.version, materialVersions.value)),
  ),
);
const deliverables = computed(() =>
  (currentStage.value?.deliverables || "")
    .split(/[、，；;\n]+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => {
      const material = library.value.materials.find((item) => !item.removed && (item.name.includes(name) || item.purpose.includes(name)));
      const task = validTasks.value.find((item) => item.evidence.some((e) => e.label.includes(name)));
      return {
        name,
        status: task ? "已关联确认依据" : material ? "已有资料 · 待核验" : "尚未关联依据",
        route: task ? "/screens/plan?task=" + task.id : material ? "/screens/library?material=" + material.id : "/screens/plan",
      };
    }),
);
const decisions = computed(() => {
  const result: { id: string; title: string; detail: string; route: string }[] = [];
  const writing = workspace.current.modules.writing as WritingState | undefined;
  if (writing?.candidate && ["pending", "invalid", "expired"].includes(writing.candidate.status))
    result.push({
      id: "revision",
      title: writing.candidate.goal || "审阅文字修订",
      detail: writing.candidate.status === "pending" ? "修订候选 · 等待你的决定" : "修订候选 · 需要重新核对",
      route: "/screens/write",
    });
  if (plan.value.candidate && ["pending", "expired"].includes(plan.value.candidate.status))
    result.push({ id: "plan", title: "审阅计划调整", detail: `${plan.value.candidate.changes.length} 项调整 · 采纳后才会生效`, route: "/screens/plan" });
  for (const item of feedback.value.entries.filter((entry) => !entry.handled && (entry.ambiguous || entry.status === "recorded")))
    result.push({ id: item.id, title: item.title, detail: "导师反馈 · 待整理或澄清", route: "/screens/feedback?feedback=" + encodeURIComponent(item.id) });
  for (const item of inbox.value.suggestions.filter((entry) => entry.state === "unread"))
    result.push({ id: item.id, title: item.title, detail: "主动建议 · 查看原因与依据", route: "/screens/inbox" });
  return result;
});
const pending = computed(() => inbox.value.suggestions.filter((s) => s.state === "unread").length);
const quick = [
  { title: "继续写作", description: "回到当前正文与选区", icon: PhNotePencil, path: "/screens/write" },
  { title: "整理导师反馈", description: "粘贴原话，逐项回应", icon: PhChatTeardropText, path: "/screens/feedback" },
  { title: "查阅资料", description: "从规范到文献，依据可见", icon: PhMagnifyingGlass, path: "/screens/library" },
];
function confirmStage() {
  const stage = currentStage.value;
  if (!stage || !phaseVerified.value || confirmedIds.value.includes(stage.id)) return;
  if (!phaseNote.value.trim()) {
    phaseNotice.value = "请记录本次核对的产物或线下依据，便于之后回看。";
    return;
  }
  const record = {
    id: crypto.randomUUID(),
    stageId: stage.id,
    stageName: stage.name,
    workflowVersion: workspace.current.workflowVersion,
    documentVersion: workspace.current.document.version,
    at: new Date().toLocaleString("zh-CN"),
    evidenceTaskIds: validTasks.value.map((task) => task.id),
    note: phaseNote.value.trim(),
  };
  const next = nextStages.value.find((item) => item.id === chosenNext.value) ?? nextStages.value[0];
  phase.value.confirmations.unshift(record);
  if (next) workspace.current.stage = next.name;
  workspace.recordEvent(
    "确认阶段完成",
    `${stage.name}已由学生核对确认；依据：${record.note}${next ? "；下一阶段：" + next.name : "；没有尚待开始且前置满足的阶段。"}`,
    "/screens/today",
    { type: "stage-completed", objectId: stage.id, sourceVersion: record.workflowVersion },
  );
  phaseVerified.value = false;
  phaseNote.value = "";
  chosenNext.value = "";
  phaseNotice.value = `已记录“${stage.name}”的确认依据。${next ? "进入" + next.name + "。" : ""}`;
}
</script>
<template>
  <div class="screen-page today-screen">
    <header class="screen-heading">
      <div>
        <p class="tp-label">Today · 把大事，写成每一天</p>
        <h1 class="tp-display mt-3">今天，向前一步。</h1>
        <p class="screen-lead">{{ workspace.userName }}，从最要紧的一件事开始。每一点进展，都有迹可循。</p>
      </div>
      <RouterLink class="tp-btn tp-btn--outline" to="/screens/projects">项目设置 <TpIcon :icon="PhArrowRight" /></RouterLink>
    </header>
    <ProjectNotice />
    <section class="today-hero screen-panel">
      <div class="today-hero__main">
        <p class="tp-label">当前航程 / {{ workspace.current.stage }}</p>
        <h2 class="tp-title mt-4">{{ workspace.current.title }}</h2>
        <p class="studio-copy">{{ workspace.current.planning || "还没有填写个人规划也没关系。我们依据已知任务、产物和截止日期，陪你走完这一程。" }}</p>
        <RouterLink class="tp-btn tp-btn--primary" to="/screens/write">继续写作 <TpIcon :icon="PhNotePencil" /></RouterLink>
      </div>
      <div class="today-hero__stats">
        <div>
          <span class="tp-caption">任务进度</span>
          <p class="screen-stat">{{ completed }} <small>/ {{ plan.tasks.length }}</small></p>
          <TpProgress :value="plan.tasks.length ? (completed / plan.tasks.length) * 100 : 0" label="学生已确认任务" />
          <span class="tp-caption">学生已确认 · 不代表论文质量</span>
        </div>
        <div class="today-meter">
          <div class="studio-row">
            <span class="tp-caption">正文字数</span
            ><b class="tp-mono">{{ words.toLocaleString() }} <small v-if="target.target">/ {{ target.target.toLocaleString() }}</small></b>
          </div>
          <TpProgress v-if="target.target" :value="wordPercent" label="正文字数目标" /><span class="tp-caption">{{
            target.target ? "与写作页使用同一计数口径" : target.reason
          }}</span>
        </div>
        <div class="today-meter">
          <div class="studio-row"><span class="tp-caption">阶段时间</span><b class="tp-mono">{{ time.known ? time.percent + "%" : "待补充" }}</b></div>
          <TpProgress v-if="time.known" :value="time.percent" label="阶段已用时间" /><span class="tp-caption">{{ time.label }}</span>
        </div>
        <div class="studio-row"><span class="tp-caption">提交截止</span><b class="tp-mono">{{ workspace.current.deadline }}</b></div>
        <div class="studio-row"><span class="tp-caption">当前正文</span><b class="tp-mono">v{{ workspace.current.document.version }}</b></div>
      </div>
    </section>
    <div class="screen-columns">
      <section class="screen-panel">
        <header class="screen-panel__head">
          <h2 class="tp-subheading">接下来，做这几件事</h2>
          <RouterLink to="/screens/plan" class="studio-link">完整计划 ↗</RouterLink>
        </header>
        <Transition name="tp-swap" mode="out-in">
          <TransitionGroup key="active-tasks" name="tp-list" tag="div" v-bind="listMotionHooks" v-if="active.length" class="tp-list-group studio-list">
            <RouterLink v-for="(task, i) in active" :key="task.id" :to="'/screens/plan?task=' + task.id" class="today-task"
              ><span class="today-task__no tp-mono">0{{ i + 1 }}</span>
              <div>
                <h3 class="tp-subheading">{{ task.title }}</h3>
                <p class="tp-caption mt-2">{{ task.chapter || "尚未关联章节" }} · {{ task.deadline }} · {{ task.evidence.length }} 份证据</p>
              </div>
              <TpStatus
                :tone="task.status === 'verify' ? 'warning' : 'info'"
                :label="task.status === 'verify' ? '待核验' : task.status === 'doing' ? '进行中' : '待开始'"
            /></RouterLink>
          </TransitionGroup>
          <div key="empty-tasks" v-else class="studio-empty">
            <h3 class="tp-subheading">给下一步一个清晰的目标</h3>
            <p class="tp-caption mt-3">在计划中创建任务，写下验收条件，再关联你的产物。</p>
            <RouterLink class="tp-btn tp-btn--outline mt-4" to="/screens/plan">创建任务</RouterLink>
          </div>
        </Transition>
      </section>
      <aside class="studio-stack">
        <section class="screen-panel studio-body">
          <div class="studio-row">
            <h2 class="tp-subheading">等你决定</h2>
            <span class="screen-stat">{{ decisions.length }}</span>
          </div>
          <Transition name="tp-swap" mode="out-in">
            <p key="no-decisions" v-if="!decisions.length" class="studio-copy">暂时没有待决定事项，安心完成手头的任务。</p>
            <TransitionGroup key="pending-decisions" name="tp-list" tag="div" v-bind="listMotionHooks" v-else class="tp-list-group today-decisions">
              <RouterLink v-for="item in decisions.slice(0, 6)" :key="item.id" :to="item.route"
                ><b>{{ item.title }}</b><span class="tp-caption">{{ item.detail }}</span><TpIcon :icon="PhArrowRight"
              /></RouterLink>
            </TransitionGroup>
          </Transition>
          <RouterLink class="studio-link" to="/screens/inbox">查看收件箱 · {{ pending }} 条未读 ↗</RouterLink>
        </section>
        <section class="screen-panel studio-body">
          <p class="tp-label">本阶段的完成条件</p>
          <h3 class="tp-subheading mt-3">{{ currentStage?.condition || "先选择适用流程和阶段" }}</h3>
          <p class="studio-copy">所需产物：{{ currentStage?.deliverables || "尚未配置" }}</p>
          <Transition name="tp-swap">
            <TransitionGroup name="tp-list" tag="div" v-bind="listMotionHooks" v-if="deliverables.length" class="tp-list-group today-deliverables">
              <RouterLink v-for="item in deliverables" :key="item.name" :to="item.route"
                ><span>{{ item.name }}</span><small>{{ item.status }} ↗</small></RouterLink
              >
            </TransitionGroup>
          </Transition>
          <p v-if="currentStage?.predecessorId && !confirmedIds.includes(currentStage.predecessorId)" class="tp-caption mt-3">
            前置阶段尚无确认记录，请同时核对已有产物；当前位置不等于已完成证明。
          </p>
          <Transition name="tp-swap" mode="out-in">
            <div :key="currentStage.id" v-if="currentStage && !confirmedIds.includes(currentStage.id)">
              <label class="today-phase-note"
                ><span class="tp-caption">本次完成依据</span><input v-model="phaseNote" class="tp-input" placeholder="记录核对的产物、版本或线下进展"
              /></label>
              <label class="studio-check mt-3"><input v-model="phaseVerified" type="checkbox" class="tp-checkbox" />已核对本阶段及前置条件</label>
              <Transition name="tp-swap">
                <label v-if="nextStages.length > 1" class="today-phase-note"
                  ><span class="tp-caption">接下来进入</span
                  ><TpSelect
                    v-model="chosenNext"
                    :options="[
                      { value: '', label: nextStages[0]?.name ?? '请选择下一阶段' },
                      ...nextStages.map((stage) => ({ value: stage.id, label: stage.name })),
                    ]"
                /></label>
              </Transition>
            </div>
          </Transition>
          <div class="screen-actions">
            <TpButton v-if="currentStage && !confirmedIds.includes(currentStage.id)" variant="seal" :disabled="!phaseVerified" @click="confirmStage"
              >我已核对，完成此阶段</TpButton
            ><RouterLink class="studio-link" to="/screens/settings?tab=workflow">查看流程</RouterLink>
          </div>
          <Transition name="tp-swap" mode="out-in">
            <p :key="phaseNotice" v-if="phaseNotice" role="status" class="tp-caption mt-3">{{ phaseNotice }}</p>
          </Transition>
          <Transition name="tp-swap">
            <details v-if="phase.confirmations.length" class="today-phase-history">
              <summary>查看阶段确认记录（{{ phase.confirmations.length }}）</summary>
              <TransitionGroup name="tp-list" tag="div" class="tp-list-group" v-bind="listMotionHooks">
                <article v-for="item in phase.confirmations" :key="item.id">
                  <b>{{ item.stageName }}</b>
                  <p>{{ item.note }}</p>
                  <small>{{ item.at }} · 正文 v{{ item.documentVersion }} · 流程 v{{ item.workflowVersion }}</small>
                </article>
              </TransitionGroup>
            </details>
          </Transition>
        </section>
      </aside>
    </div>
    <div class="studio-grid studio-grid--3">
      <RouterLink v-for="item in quick" :key="item.path" :to="item.path" class="screen-panel studio-body today-quick"
        ><TpIcon :icon="item.icon" :size="24" />
        <div>
          <h3 class="tp-subheading">{{ item.title }}</h3>
          <p class="tp-caption mt-2">{{ item.description }}</p>
        </div>
        <TpIcon :icon="PhPath" class="text-fg-muted"
      /></RouterLink>
    </div>
  </div>
</template>
<style scoped>
.today-meter {
  display: grid;
  gap: 8px;
}
.today-meter small {
  font-size: 12px;
  font-weight: 400;
}
.today-decisions {
  display: grid;
  margin: 18px 0;
}
.today-decisions a {
  position: relative;
  display: grid;
  gap: 5px;
  padding: 12px 24px 12px 0;
  border-bottom: 1px solid var(--tp-line);
  font-size: 13px;
}
.today-decisions a:hover {
  color: var(--tp-accent);
}
.today-decisions .tp-icon {
  position: absolute;
  right: 0;
  top: 16px;
}
.today-deliverables {
  display: grid;
  gap: 8px;
  margin-bottom: 18px;
}
.today-deliverables a {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  border-bottom: 1px dashed var(--tp-line);
  padding-bottom: 8px;
  font-size: 12px;
}
.today-deliverables small {
  color: var(--tp-text-muted);
}
.today-phase-note {
  display: grid;
  gap: 8px;
  margin: 16px 0;
}
.today-phase-history {
  margin-top: 20px;
  font-size: 12px;
  color: var(--tp-text-muted);
}
.today-phase-history summary {
  cursor: pointer;
}
.today-phase-history article {
  display: grid;
  gap: 4px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--tp-line);
}
.today-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  overflow: hidden;
}
.today-hero__main {
  padding: 32px;
}
.today-hero__main .tp-title {
  font-size: 28px;
  max-width: 26em;
  line-height: 1.55;
}
.today-hero__stats {
  padding: 32px;
  background: var(--tp-surface-sunken);
  border-left: 1px solid var(--tp-line);
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.today-hero__stats .screen-stat {
  font-size: 48px;
  margin: 8px 0;
}
.today-hero__stats small {
  font-size: 24px;
  color: var(--tp-text-muted);
}
.today-task {
  display: flex;
  gap: 20px;
  align-items: center;
  padding: 24px;
  border-bottom: 1px solid var(--tp-line);
}
.today-task:last-child {
  border: 0;
}
.today-task:hover,
.today-quick:hover {
  background: var(--tp-surface-sunken);
}
.today-task > div {
  flex: 1;
  min-width: 0;
}
.today-task__no {
  color: var(--tp-text-muted);
  font-size: 20px;
}
.today-quick {
  display: flex;
  align-items: center;
  gap: 16px;
}
.today-quick > div {
  flex: 1;
}
@media (max-width: 960px) {
  .today-hero {
    grid-template-columns: 1fr;
  }
  .today-hero__stats {
    border-left: 0;
    border-top: 1px solid var(--tp-line);
    padding: 24px;
  }
  .today-hero__main {
    padding: 24px;
  }
}
@media (max-width: 600px) {
  .today-task {
    padding: 16px;
    gap: 12px;
    flex-wrap: wrap;
  }
  .today-task > .tp-status {
    margin-left: 36px;
  }
  .today-hero__main .tp-title {
    font-size: 24px;
  }
}
</style>
