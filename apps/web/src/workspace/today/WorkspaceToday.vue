<script setup lang="ts">
import { PhArrowRight, PhChatTeardropText, PhMagnifyingGlass, PhNotePencil } from "@phosphor-icons/vue";
import { computed, onActivated, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { RouterLink } from "vue-router";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpProgress from "@/components/ui/TpProgress.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpButton from "@/components/ui/TpButton.vue";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { BackendServices, DocumentRead, ProjectRead, StageCommandRead, StageProgressRead, TaskSummary } from "@/services";
import { asApiError } from "@/services/errors";
import { feedbackRoute, materialsRoute, projectsRoute, tasksRoute, writingRoute } from "../workspaceRoutes";
import TodayStageCard from "./TodayStageCard.vue";
import { loadAllTasks, loadDecisions, loadDocument, manuscriptCharacters, nextTasks, shanghaiDate, stageClock, type DecisionSource } from "./todayFacts";
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
const statusLabel: Record<string, string> = { todo: "待开始", doing: "进行中", verify: "待核验", rework: "返工" };
const statusTone: Record<string, "neutral" | "info" | "warning"> = { todo: "neutral", doing: "info", verify: "warning", rework: "warning" };
const decisionRows = computed(() =>
  (decisions.value ?? [])
    .filter((item) => item.count > 0 || item.error)
    .map((item) => {
      const name = { revision: "正文修订候选", format: "格式候选", feedback: "导师反馈条目" }[item.kind];
      const count = `${item.count}${item.capped ? "+" : ""}`;
      const detail = item.error
        ? item.error
        : { revision: `${count} 条待审阅 · 采纳前正文不变`, format: `${count} 条待逐项决定`, feedback: `${count} 条尚未处理` }[item.kind];
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
  { title: "整理导师反馈", icon: PhChatTeardropText, to: feedbackRoute(props.project.id) },
  { title: "查阅资料", icon: PhMagnifyingGlass, to: materialsRoute(props.project.id) },
]);
const taskLink = (id: string) => ({ ...(tasksRoute(props.project.id) as object), query: { task: id } });
</script>

<template>
  <div class="screen-page today-screen">
    <header class="screen-heading today-heading">
      <div>
        <p class="tp-label">{{ shanghaiDate(now) }}</p>
        <h1 class="tp-title mt-3">今日</h1>
      </div>
      <RouterLink class="tp-btn tp-btn--outline" :to="projectsRoute">项目设置 <TpIcon :icon="PhArrowRight" /></RouterLink>
    </header>

    <section class="today-hero screen-panel" :aria-busy="loading || undefined">
      <div class="today-hero__main">
        <p class="tp-label">当前航程 / {{ stageName }}</p>
        <h2 class="tp-title mt-4">{{ project.title || project.name }}</h2>
        <p v-if="project.plan_note" class="today-plan">{{ project.plan_note }}</p>
        <div class="today-hero__actions">
          <RouterLink class="tp-btn tp-btn--primary" :to="writingRoute(project.id)">继续写作 <TpIcon :icon="PhNotePencil" /></RouterLink>
          <span v-if="document" class="tp-caption">当前正文 v{{ document.version }}</span>
          <span v-else-if="document === null" class="tp-caption">尚无正式稿</span>
        </div>
      </div>
      <div class="today-hero__stats">
        <div class="today-stat">
          <div class="studio-row">
            <span class="tp-caption">任务进度</span>
            <p class="screen-stat">
              <template v-if="tasks">{{ confirmedCount }} <small>/ {{ counted.length }}</small></template>
              <span v-else class="today-blank" aria-label="读取中">—</span>
            </p>
          </div>
          <TpProgress :value="counted.length ? (confirmedCount / counted.length) * 100 : 0" label="学生已确认任务" />
          <span class="tp-caption">{{ tasksError ? (tasks ? tasksError : "读取失败") : "学生已确认" }}</span>
        </div>
        <div class="today-stat">
          <div class="studio-row">
            <span class="tp-caption">正文字数</span>
            <b class="tp-mono today-stat__value">{{ words === null || words === undefined ? "—" : words.toLocaleString() }}</b>
          </div>
          <span class="tp-caption">
            {{ documentError || (document === null ? "尚无正式稿" : document ? "未设字数目标" : "正在读取") }}
          </span>
        </div>
        <div class="today-stat">
          <div class="studio-row">
            <span class="tp-caption">阶段时间</span>
            <b class="tp-mono today-stat__value">{{ time?.known ? (time.percent !== null ? `${time.percent}%` : `已用 ${time.days} 天`) : "未设置" }}</b>
          </div>
          <TpProgress v-if="time?.percent !== null && time?.percent !== undefined" :value="time.percent" label="阶段已用时间" />
          <span class="tp-caption">{{
            time?.known ? `自 ${time.since} 起${progress?.current?.stage.deadline ? " · 截止 " + progress.current.stage.deadline : ""}` : "起止日期未设置"
          }}</span>
        </div>
        <div class="today-stat">
          <div class="studio-row">
            <span class="tp-caption">提交截止</span>
            <b class="tp-mono today-stat__value">{{ project.deadline ?? "未设置" }}</b>
          </div>
          <RouterLink class="studio-link today-stat__link" :to="tasksRoute(project.id)">查看完整计划</RouterLink>
        </div>
      </div>
    </section>

    <div class="screen-columns today-work">
      <div class="today-primary">
        <section class="screen-panel today-tasks">
          <header class="screen-panel__head">
            <div>
              <h2 class="tp-subheading">最紧要任务</h2>
              <p v-if="tasks" class="tp-caption mt-2">{{ counted.length - confirmedCount }} 项尚未确认</p>
            </div>
            <RouterLink :to="tasksRoute(project.id)" class="studio-link">全部任务 ↗</RouterLink>
          </header>
          <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
            <div v-if="!tasks && !tasksError" key="loading" class="today-skeleton" role="status" aria-busy="true">
              <span v-for="n in 3" :key="n" />
            </div>
            <TpState
              v-else-if="!tasks"
              key="error"
              kind="error"
              title="无法读取论文任务"
              :desc="`${tasksError} 已有任务不受影响。`"
              retryable
              @retry="load()"
            />
            <TransitionGroup v-else-if="active.length" key="tasks" name="tp-list" tag="div" v-bind="listMotionHooks" class="tp-list-group">
              <RouterLink v-for="task in active" :key="task.id" :to="taskLink(task.id)" class="today-task">
                <div>
                  <h3 class="tp-subheading">{{ task.title }}</h3>
                  <p class="tp-caption mt-2">
                    {{ task.due_date ? `截止 ${task.due_date}` : "未设期限" }}{{ task.needs_review ? " · " + task.review_reasons.join("、") : "" }}
                  </p>
                </div>
                <TpStatus
                  :tone="task.needs_review || task.status === 'rework' ? 'warning' : (statusTone[task.status] ?? 'neutral')"
                  :label="task.needs_review ? '待复核' : (statusLabel[task.status] ?? task.status)"
                />
                <TpIcon :icon="PhArrowRight" class="today-task__arrow" />
              </RouterLink>
            </TransitionGroup>
            <div v-else key="empty" class="studio-empty today-empty">
              <h3 class="tp-subheading">从下一步开始</h3>
              <p class="tp-caption mt-3">创建任务并写下可核对的验收条件。</p>
              <RouterLink class="tp-btn tp-btn--outline mt-4" :to="tasksRoute(project.id)">创建任务</RouterLink>
            </div>
          </Transition>
        </section>

        <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
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
      </div>

      <aside class="studio-stack">
        <section class="screen-panel studio-body today-decision-panel" :aria-busy="decisionsLoading || undefined">
          <div class="studio-row">
            <h2 class="tp-subheading">等你决定</h2>
            <span class="today-decision-total">{{ decisions ? decisionTotal : "—" }}</span>
          </div>
          <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
            <div v-if="!decisions && documentError" key="blocked" role="alert" class="today-decision-error">
              <p class="tp-caption">{{ documentError }}</p>
              <TpButton size="sm" variant="ghost" @click="load()">重试</TpButton>
            </div>
            <div v-else-if="!decisions" key="loading" class="today-skeleton today-skeleton--compact" role="status" aria-busy="true">
              <span v-for="n in 2" :key="n" />
            </div>
            <p v-else-if="!decisionRows.length" key="none" class="tp-caption today-decision-empty">暂时没有待决定事项</p>
            <TransitionGroup v-else key="rows" name="tp-list" tag="div" v-bind="listMotionHooks" class="tp-list-group today-decisions">
              <component
                :is="item.error ? 'div' : RouterLink"
                v-for="item in decisionRows"
                :key="item.kind"
                v-bind="item.error ? { role: 'alert' } : { to: item.route }"
                :data-error="item.error ? 'true' : undefined"
              >
                <b>{{ item.error ? `${item.name}读取失败` : item.name }}</b>
                <span class="tp-caption">{{ item.detail }}</span>
                <TpButton v-if="item.error" size="sm" variant="ghost" @click="refreshDecisions(document?.id ?? null)">重试</TpButton>
                <span v-else class="today-decisions__go" aria-hidden="true"><TpIcon :icon="PhArrowRight" /></span>
              </component>
            </TransitionGroup>
          </Transition>
        </section>

        <nav class="today-shortcuts" aria-label="常用入口">
          <p class="tp-label">常用入口</p>
          <RouterLink v-for="item in quick" :key="item.title" :to="item.to" class="today-shortcut">
            <TpIcon :icon="item.icon" :size="18" />
            <span>{{ item.title }}</span>
            <TpIcon :icon="PhArrowRight" class="text-fg-muted" />
          </RouterLink>
        </nav>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.today-heading {
  align-items: center;
}
.today-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(400px, 0.9fr);
  overflow: hidden;
}
.today-hero__main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  min-width: 0;
  padding: 32px;
}
.today-hero__main .tp-title {
  max-width: 26em;
  overflow-wrap: anywhere;
  font-size: 28px;
  line-height: 1.55;
}
.today-plan {
  max-width: 48em;
  margin: 20px 0 0;
  color: var(--tp-text-muted);
  line-height: 1.75;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.today-hero__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 28px;
}
.today-hero__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px 32px;
  padding: 32px;
  background: var(--tp-surface-sunken);
  border-left: 1px solid var(--tp-line);
}
.today-stat {
  display: grid;
  align-content: start;
  gap: 12px;
  min-width: 0;
}
.today-stat .studio-row {
  align-items: baseline;
  gap: 12px;
}
.today-stat .screen-stat {
  margin: 0;
  white-space: nowrap;
}
.today-stat .screen-stat small {
  color: var(--tp-text-muted);
  font-size: 16px;
}
.today-stat__value {
  overflow-wrap: anywhere;
  text-align: right;
}
.today-stat__link {
  width: fit-content;
}
.today-blank {
  color: var(--tp-text-muted);
}
.today-work {
  grid-template-columns: minmax(0, 1fr) 340px;
}
.today-primary {
  display: grid;
  gap: 24px;
  min-width: 0;
}
.today-task {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 20px;
  gap: 16px;
  align-items: center;
  min-height: 76px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--tp-line);
  transition: background-color var(--tp-dur-fast) var(--tp-ease-standard);
}
.today-task:last-child {
  border-bottom: 0;
}
.today-task:hover,
.today-shortcut:hover {
  background: var(--tp-surface-sunken);
}
.today-task > div {
  min-width: 0;
}
.today-task h3 {
  overflow-wrap: anywhere;
}
.today-task__arrow {
  color: var(--tp-text-muted);
}
.today-empty {
  margin: 20px;
}
.today-decision-panel {
  overflow: hidden;
}
.today-decision-total {
  font: 600 28px/1.1 var(--tp-font-display);
  font-variant-numeric: tabular-nums;
}
.today-decisions {
  display: grid;
  margin-top: 16px;
}
.today-decisions > * {
  position: relative;
  display: grid;
  gap: 4px;
  min-height: 64px;
  padding: 12px 28px 12px 0;
  border-top: 1px solid var(--tp-line);
  font-size: 13px;
  align-content: center;
}
.today-decisions a {
  transition: color var(--tp-dur-fast) var(--tp-ease-standard);
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
  top: 22px;
  display: inline-flex;
}
.today-decision-empty {
  margin-top: 20px;
}
.today-decision-error {
  display: grid;
  gap: 8px;
  margin-top: 16px;
  color: var(--tp-danger-content);
}
.today-shortcuts {
  display: grid;
  padding: 0 4px;
}
.today-shortcuts > .tp-label {
  margin-bottom: 12px;
}
.today-shortcut {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 8px 12px;
  border-top: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  transition: background-color var(--tp-dur-fast) var(--tp-ease-standard);
}
.today-skeleton {
  display: grid;
  gap: 12px;
  padding: 24px;
}
.today-skeleton--compact {
  padding: 20px 0 0;
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
@media (max-width: 1150px) {
  .today-work {
    grid-template-columns: minmax(0, 1fr) 300px;
  }
  .today-hero {
    grid-template-columns: minmax(0, 1fr) minmax(340px, 0.9fr);
  }
  .today-hero__stats {
    gap: 20px;
    padding: 24px;
  }
}
@media (max-width: 960px) {
  .today-hero,
  .today-work {
    grid-template-columns: 1fr;
  }
  .today-hero__stats {
    border-left: 0;
    border-top: 1px solid var(--tp-line);
  }
}
@media (max-width: 600px) {
  .today-heading {
    align-items: flex-start;
  }
  .today-heading .tp-title {
    font-size: 24px;
  }
  .today-hero__main {
    padding: 24px;
  }
  .today-hero__main .tp-title {
    font-size: 24px;
  }
  .today-hero__stats {
    grid-template-columns: 1fr;
    padding: 20px 24px;
  }
  .today-stat {
    padding-bottom: 16px;
    border-bottom: 1px solid var(--tp-line);
  }
  .today-stat:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }
  .today-task {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    padding: 16px;
  }
  .today-task > .tp-status {
    grid-column: 1;
    justify-self: start;
  }
  .today-task__arrow {
    grid-column: 2;
    grid-row: 1;
  }
  .today-empty {
    margin: 16px;
  }
}
</style>
