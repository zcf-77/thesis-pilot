<script setup lang="ts">
import { PhArrowRight, PhChatTeardropText, PhMagnifyingGlass, PhNotePencil, PhPath } from "@phosphor-icons/vue";
import { computed, onActivated, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { RouterLink } from "vue-router";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpProgress from "@/components/ui/TpProgress.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpButton from "@/components/ui/TpButton.vue";
import { listMotionHooks } from "@/design/motion";
import type { BackendServices, DocumentRead, ProjectRead, StageCommandRead, StageProgressRead, TaskSummary } from "@/services";
import { asApiError } from "@/services/errors";
import { feedbackRoute, materialsRoute, projectsRoute, tasksRoute, writingRoute } from "../workspaceRoutes";
import TodayStageCard from "./TodayStageCard.vue";
import { loadAllTasks, loadDecisions, loadDocument, manuscriptCharacters, nextTasks, stageClock, type DecisionSource } from "./todayFacts";
import "@/lab/screens/screens.css";

const props = defineProps<{ services: BackendServices; project: ProjectRead; workspaceId: string }>();
const emit = defineEmits<{ projectChanged: [project: ProjectRead] }>();

const progress = shallowRef<StageProgressRead>();
const progressError = ref("");
const tasks = shallowRef<TaskSummary[]>();
const tasksError = ref("");
const document = shallowRef<DocumentRead | null>();
const documentError = ref("");
const decisions = shallowRef<DecisionSource[]>();
const decisionsLoading = ref(false);
const loading = ref(true);
const now = ref(new Date());
let request: AbortController | undefined;
let decisionRequest: AbortController | undefined;
let clock: ReturnType<typeof setInterval> | undefined;

async function refreshDecisions(documentId: string | null) {
  decisionRequest?.abort();
  const controller = new AbortController();
  decisionRequest = controller;
  decisionsLoading.value = true;
  try {
    const result = await loadDecisions(props.services, props.project.id, documentId, controller.signal);
    if (!controller.signal.aborted) decisions.value = result;
  } catch {
    // Only cancellation escapes loadDecisions; each source reports its own failure.
  } finally {
    if (!controller.signal.aborted) decisionsLoading.value = false;
  }
}

/** A quiet reload (returning to a cached page) keeps the current view until fresh facts arrive. */
async function load(quiet = false) {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  if (!quiet) loading.value = true;
  const id = props.project.id;
  const [stage, list, manuscript] = await Promise.allSettled([
    props.services.stageConfirmations.progress(id, controller.signal),
    loadAllTasks(props.services, id, controller.signal),
    loadDocument(props.services, id, controller.signal),
  ]);
  // A newer load or leaving the page discards these late responses.
  if (controller.signal.aborted) return;
  progressError.value = stage.status === "rejected" ? asApiError(stage.reason).message : "";
  if (stage.status === "fulfilled") progress.value = stage.value;
  tasksError.value = list.status === "rejected" ? asApiError(list.reason).message : "";
  if (list.status === "fulfilled") tasks.value = list.value;
  documentError.value = manuscript.status === "rejected" ? asApiError(manuscript.reason).message : "";
  if (manuscript.status === "fulfilled") document.value = manuscript.value;
  loading.value = false;
  if (manuscript.status === "fulfilled") void refreshDecisions(manuscript.value?.id ?? null);
}

function changed(result: StageCommandRead) {
  emit("projectChanged", result.project);
  void load();
}

onMounted(() => {
  clock = setInterval(() => (now.value = new Date()), 60_000);
});
let activatedOnce = false;
onActivated(() => {
  now.value = new Date();
  // The first activation is the mount itself; later ones re-read facts changed on other pages.
  if (activatedOnce) void load(true);
  activatedOnce = true;
});
onBeforeUnmount(() => {
  clearInterval(clock);
  request?.abort();
  decisionRequest?.abort();
});
watch(
  () => props.project.id,
  () => load(),
  { immediate: true },
);

const stageName = computed(
  () => progress.value?.current?.stage.name ?? (progress.value?.binding === "unbound" ? "尚未绑定流程" : progress.value ? "阶段待核对" : "…"),
);
const active = computed(() => (tasks.value ? nextTasks(tasks.value) : []));
const counted = computed(() => tasks.value?.filter((item) => !item.archived) ?? []);
const confirmedCount = computed(() => counted.value.filter((item) => item.status === "confirmed").length);
const words = computed(() => (document.value ? manuscriptCharacters(document.value.content) : null));
const time = computed(() => {
  const current = progress.value?.current;
  return current ? stageClock(current.entered_at, current.stage.start, current.stage.deadline, now.value) : undefined;
});
const statusLabel: Record<string, string> = { todo: "待开始", doing: "进行中", verify: "待验收", rework: "返工" };
const decisionRows = computed(() =>
  (decisions.value ?? [])
    .filter((item) => item.count > 0 || item.error)
    .map((item) => {
      const name = { revision: "正文修订候选", format: "格式候选", feedback: "导师反馈条目" }[item.kind];
      const count = `${item.count}${item.capped ? "+" : ""}`;
      const detail = item.error
        ? item.error
        : { revision: `${count} 条等你决定 · 采纳前正文不变`, format: `${count} 条等你逐项决定`, feedback: `${count} 条尚未处理` }[item.kind];
      const route =
        item.kind === "feedback"
          ? item.target
            ? { ...(feedbackRoute(props.project.id) as object), query: { batch: item.target.batch, item: item.target.item } }
            : feedbackRoute(props.project.id)
          : writingRoute(props.project.id);
      return { ...item, name, detail, route };
    }),
);
const decisionTotal = computed(() => (decisions.value ?? []).reduce((sum, item) => sum + item.count, 0));
const quick = computed(() => [
  { title: "继续写作", description: "回到当前正文与选区", icon: PhNotePencil, to: writingRoute(props.project.id) },
  { title: "整理导师反馈", description: "粘贴原话，逐项回应", icon: PhChatTeardropText, to: feedbackRoute(props.project.id) },
  { title: "查阅资料", description: "从规范到文献，依据可见", icon: PhMagnifyingGlass, to: materialsRoute(props.project.id) },
]);
const taskLink = (id: string) => ({ ...(tasksRoute(props.project.id) as object), query: { task: id } });
</script>

<template>
  <div class="screen-page today-screen">
    <header class="screen-heading">
      <div>
        <p class="tp-label">Today · 把大事，写成每一天</p>
        <h1 class="tp-display mt-3">今天，向前一步。</h1>
        <p class="screen-lead">从最要紧的一件事开始。每一点进展，都有迹可循。</p>
      </div>
      <RouterLink class="tp-btn tp-btn--outline" :to="projectsRoute">项目设置 <TpIcon :icon="PhArrowRight" /></RouterLink>
    </header>

    <section class="today-hero screen-panel" :aria-busy="loading || undefined">
      <div class="today-hero__main">
        <p class="tp-label">当前航程 / {{ stageName }}</p>
        <h2 class="tp-title mt-4">{{ project.title || project.name }}</h2>
        <p class="studio-copy">{{ project.plan_note || "还没有填写个人规划也没关系。我们依据已知任务、产物和截止日期，陪你走完这一程。" }}</p>
        <RouterLink class="tp-btn tp-btn--primary" :to="writingRoute(project.id)">继续写作 <TpIcon :icon="PhNotePencil" /></RouterLink>
      </div>
      <div class="today-hero__stats">
        <div>
          <span class="tp-caption">任务进度</span>
          <p class="screen-stat">
            <template v-if="tasks">{{ confirmedCount }} <small>/ {{ counted.length }}</small></template
            ><span v-else class="today-blank" aria-label="读取中">—</span>
          </p>
          <TpProgress :value="counted.length ? (confirmedCount / counted.length) * 100 : 0" label="学生已确认任务" />
          <span class="tp-caption">{{ tasksError || "学生已确认 · 不代表论文质量" }}</span>
        </div>
        <div class="today-meter">
          <div class="studio-row">
            <span class="tp-caption">正文字数</span>
            <b class="tp-mono">{{ words === null || words === undefined ? "—" : words.toLocaleString() }} <small>/ 目标未设置</small></b>
          </div>
          <span class="tp-caption">{{ documentError || (document === null ? "尚无正式稿" : "没有已绑定的正文字数规则") }}</span>
        </div>
        <div class="today-meter">
          <div class="studio-row">
            <span class="tp-caption">阶段时间</span>
            <b class="tp-mono">{{ time?.known ? (time.percent !== null ? `${time.percent}%` : `已用 ${time.days} 天`) : "未设置" }}</b>
          </div>
          <TpProgress v-if="time?.percent !== null && time?.percent !== undefined" :value="time.percent" label="阶段已用时间" />
          <span class="tp-caption">{{
            time?.known
              ? `自 ${time.since} 起${time.percent !== null ? `已用 ${time.days} 天` : ""}${progress?.current?.stage.deadline ? " · 截止 " + progress.current.stage.deadline : ""}`
              : "阶段起止日期未设置"
          }}</span>
        </div>
        <div class="studio-row"><span class="tp-caption">提交截止</span><b class="tp-mono">{{ project.deadline ?? "未设置" }}</b></div>
        <div class="studio-row">
          <span class="tp-caption">当前正文</span><b class="tp-mono">{{ document ? `v${document.version}` : document === null ? "尚无" : "—" }}</b>
        </div>
      </div>
    </section>

    <div class="screen-columns">
      <section class="screen-panel">
        <header class="screen-panel__head">
          <h2 class="tp-subheading">接下来，做这几件事</h2>
          <RouterLink :to="tasksRoute(project.id)" class="studio-link">完整计划 ↗</RouterLink>
        </header>
        <Transition name="tp-swap" mode="out-in">
          <div v-if="!tasks && !tasksError" key="loading" class="today-skeleton" role="status" aria-busy="true">
            <span v-for="n in 3" :key="n" />
          </div>
          <TpState v-else-if="!tasks" key="error" kind="error" title="无法读取论文任务" :desc="`${tasksError} 已有任务不受影响。`" retryable @retry="load()" />
          <TransitionGroup v-else-if="active.length" key="tasks" name="tp-list" tag="div" v-bind="listMotionHooks" class="tp-list-group studio-list">
            <RouterLink v-for="(task, i) in active" :key="task.id" :to="taskLink(task.id)" class="today-task"
              ><span class="today-task__no tp-mono">0{{ i + 1 }}</span>
              <div>
                <h3 class="tp-subheading">{{ task.title }}</h3>
                <p class="tp-caption mt-2">
                  {{ task.due_date ? `预计 ${task.due_date} 完成` : "尚未设置期限" }}{{ task.needs_review ? " · " + task.review_reasons.join("、") : "" }}
                </p>
              </div>
              <TpStatus
                :tone="task.needs_review || task.status === 'rework' ? 'warning' : 'info'"
                :label="task.needs_review ? '待复核' : (statusLabel[task.status] ?? task.status)"
            /></RouterLink>
          </TransitionGroup>
          <div v-else key="empty" class="studio-empty">
            <h3 class="tp-subheading">给下一步一个清晰的目标</h3>
            <p class="tp-caption mt-3">在计划中创建任务，写下验收条件，再关联你的产物。</p>
            <RouterLink class="tp-btn tp-btn--outline mt-4" :to="tasksRoute(project.id)">创建任务</RouterLink>
          </div>
        </Transition>
      </section>

      <aside class="studio-stack">
        <section class="screen-panel studio-body" :aria-busy="decisionsLoading || undefined">
          <div class="studio-row">
            <h2 class="tp-subheading">等你决定</h2>
            <span class="screen-stat">{{ decisions ? decisionTotal : "—" }}</span>
          </div>
          <Transition name="tp-swap" mode="out-in">
            <p v-if="!decisions && documentError" key="blocked" role="alert" class="studio-copy">
              {{ documentError }} <TpButton size="sm" variant="ghost" @click="load()">重试</TpButton>
            </p>
            <div v-else-if="!decisions" key="loading" class="today-skeleton" role="status" aria-busy="true"><span v-for="n in 2" :key="n" /></div>
            <p v-else-if="!decisionRows.length" key="none" class="studio-copy">暂时没有待决定事项，安心完成手头的任务。</p>
            <TransitionGroup v-else key="rows" name="tp-list" tag="div" v-bind="listMotionHooks" class="tp-list-group today-decisions">
              <component
                :is="item.error ? 'div' : RouterLink"
                v-for="item in decisionRows"
                :key="item.kind"
                v-bind="item.error ? { role: 'alert' } : { to: item.route }"
                :data-error="item.error ? 'true' : undefined"
                ><b>{{ item.error ? `${item.name}读取失败` : item.name }}</b><span class="tp-caption">{{ item.detail }}</span
                ><TpButton v-if="item.error" size="sm" variant="ghost" @click="refreshDecisions(document?.id ?? null)">重试</TpButton
                ><span v-else class="today-decisions__go" aria-hidden="true"><TpIcon :icon="PhArrowRight" /></span
              ></component>
            </TransitionGroup>
          </Transition>
        </section>

        <Transition name="tp-swap" mode="out-in">
          <TodayStageCard
            v-if="progress"
            key="stage"
            :services="services"
            :project="project"
            :workspace-id="workspaceId"
            :progress="progress"
            @changed="changed"
            @reload="load()"
          />
          <TpState
            v-else-if="progressError"
            key="error"
            class="screen-panel"
            kind="error"
            title="无法读取阶段进度"
            :desc="`${progressError} 阶段记录不受影响。`"
            retryable
            @retry="load()"
          />
          <div v-else key="loading" class="screen-panel studio-body today-skeleton" role="status" aria-busy="true"><span v-for="n in 4" :key="n" /></div>
        </Transition>
      </aside>
    </div>

    <div class="studio-grid studio-grid--3">
      <RouterLink v-for="item in quick" :key="item.title" :to="item.to" class="screen-panel studio-body today-quick"
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
  color: var(--tp-text-muted);
}
.today-blank {
  color: var(--tp-text-muted);
}
.today-decisions {
  display: grid;
  margin: 18px 0;
}
.today-decisions > * {
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
.today-decisions > [data-error] {
  padding-right: 0;
}
.today-decisions > [data-error] .tp-caption {
  color: var(--tp-danger-content);
}
.today-decisions__go {
  position: absolute;
  right: 0;
  top: 16px;
  display: inline-flex;
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
.today-hero__stats .screen-stat small {
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
.today-skeleton {
  display: grid;
  gap: 12px;
  padding: 24px;
}
.today-skeleton span {
  display: block;
  height: 18px;
  border-radius: var(--tp-radius-xs);
  background: var(--tp-surface-sunken);
}
.today-skeleton span:nth-child(even) {
  width: 70%;
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
