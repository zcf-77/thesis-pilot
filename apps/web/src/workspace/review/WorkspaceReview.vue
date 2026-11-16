<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { RouterLink } from "vue-router";
import { PhArrowDown, PhClipboardText, PhClockCounterClockwise, PhFileText, PhMagnifyingGlass, PhPlus, PhScales } from "@phosphor-icons/vue";
import ReviewSummary from "@/components/domain/ReviewSummary.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type {
  AIConfigRead,
  BackendServices,
  DocumentRead,
  ProjectRead,
  ProjectSourceBindingRead,
  ReviewRead,
  ReviewReportRead,
  ReviewRubricRead,
} from "@/services";
import { ApiError, asApiError } from "@/services/errors";
import { configurationsRoute, jobRoute, reviewLocationRoute } from "../workspaceRoutes";
import ReviewIssueRow from "./ReviewIssueRow.vue";
import { chapterOptions, downloadName, formatTime, isActiveReview, matchesHistory, reviewStatus, scoreDims, uncheckedItems } from "./reviewView";

const props = defineProps<{ services: BackendServices; project: ProjectRead }>();
const WHOLE = "__document__";
const POLL_MS = 1500;

const reviews = shallowRef<ReviewRead[]>([]);
const rubrics = shallowRef<ReviewRubricRead[]>([]);
const agents = shallowRef<AIConfigRead[]>([]);
const document = shallowRef<DocumentRead>();
const binding = shallowRef<ProjectSourceBindingRead>();
const loadState = ref<"loading" | "ready" | "failed">("loading");
const loadError = ref("");
const documentMissing = ref(false);
const selectedId = ref<string>();
const report = shallowRef<ReviewReportRead>();
const reportState = ref<"idle" | "loading" | "failed">("idle");
const reportError = ref("");
const showForm = ref(false);
const scope = ref(WHOLE);
const rubric = ref("");
const agent = ref("");
const formError = ref("");
const busy = ref(false);
const actionError = ref("");
const search = ref("");
const severity = ref("all");
const downloading = ref<"html" | "markdown">();
const downloadError = ref("");
const announcement = ref("");
let pendingCommand: string | undefined;
let loadRequest: AbortController | undefined;
let reportRequest: AbortController | undefined;
let mutation: AbortController | undefined;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;

const latest = computed(() => reviews.value[0]);
const active = computed(() => reviews.value.find(isActiveReview));
const selected = computed(() => reviews.value.find((item) => item.id === selectedId.value));
const history = computed(() => reviews.value.filter((item) => matchesHistory(item, search.value)));
const chapters = computed(() => (document.value ? chapterOptions(document.value.content.json) : []));
const scopeOptions = computed(() => [{ value: WHOLE, label: "整篇论文" }, ...chapters.value]);
const rubricOptions = computed(() => rubrics.value.map((item) => ({ value: item.version, label: item.title })));
const agentOptions = computed(() => agents.value.map((item) => ({ value: item.current_version_id, label: `${item.name} · v${item.version}` })));
const currentRubric = computed(() => rubrics.value.find((item) => item.version === rubric.value));
const issues = computed(() => report.value?.content.issues.filter((item) => severity.value === "all" || item.severity === severity.value) ?? []);
const stale = computed(() => !!report.value && !!document.value && report.value.document_version !== document.value.version);
const bannerReview = computed(() => (latest.value && latest.value.status !== "succeeded" ? latest.value : undefined));
const severityOptions = computed(() => {
  const all = report.value?.content.issues ?? [];
  const count = (value: string) => all.filter((item) => item.severity === value).length;
  return [
    { value: "all", label: `全部程度（${all.length}）` },
    { value: "major", label: `严重（${count("major")}）` },
    { value: "minor", label: `一般（${count("minor")}）` },
    { value: "advice", label: `建议（${count("advice")}）` },
  ];
});
const bindingLabel = (value?: string | null) => (value ? "模板与要求已绑定" : "模板与要求未绑定");
const errorText = (code: string | null) => (code ? new ApiError(code).message : "评审未完成。");

async function pages<T>(read: (offset: number) => Promise<{ items: T[]; total: number }>, signal: AbortSignal) {
  const result: T[] = [];
  for (let offset = 0; !signal.aborted;) {
    const page = await read(offset);
    result.push(...page.items);
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  }
  return result;
}

/** A quiet load (returning to the cached page) keeps the current report until fresh facts arrive. */
async function load(quiet = false) {
  loadRequest?.abort();
  const controller = new AbortController();
  loadRequest = controller;
  const { signal } = controller;
  if (!quiet || loadState.value !== "ready") loadState.value = "loading";
  loadError.value = "";
  const id = props.project.id;
  const results = await Promise.allSettled([
    pages((offset) => props.services.reviews.list(id, { offset, limit: 100 }, signal), signal),
    props.services.reviews.rubrics(signal),
    pages((offset) => props.services.aiConfigs.list({ kind: "agent", offset, limit: 100 }, signal), signal),
    props.services.documents.current(id, signal),
    props.services.materials.sourceBinding(id, signal),
  ]);
  if (signal.aborted || disposed) return;
  const [list, rubricList, agentList, current, sources] = results;
  const failures: string[] = [];
  if (list.status === "fulfilled") reviews.value = list.value;
  else failures.push(`评审记录：${asApiError(list.reason).message}`);
  if (rubricList.status === "fulfilled") rubrics.value = rubricList.value.items;
  else failures.push(`评审量表：${asApiError(rubricList.reason).message}`);
  if (agentList.status === "fulfilled")
    agents.value = agentList.value.filter((item) => item.enabled && item.content.kind === "agent" && item.content.role === "review");
  else failures.push(`评审智能体：${asApiError(agentList.reason).message}`);
  documentMissing.value = current.status === "rejected" && asApiError(current.reason).code === "DOCUMENT_NOT_FOUND";
  if (current.status === "fulfilled") document.value = current.value;
  else if (!documentMissing.value) failures.push(`正式稿：${asApiError(current.reason).message}`);
  if (sources.status === "fulfilled") binding.value = sources.value;
  else failures.push(`模板与要求绑定：${asApiError(sources.reason).message}`);
  rubric.value ||= rubrics.value[0]?.version ?? "";
  if (!agents.value.some((item) => item.current_version_id === agent.value)) agent.value = agents.value[0]?.current_version_id ?? "";
  if (!chapters.value.some((item) => item.value === scope.value)) scope.value = WHOLE;
  loadState.value = list.status === "rejected" ? "failed" : "ready";
  loadError.value = failures.join("；");
  if (!selectedId.value || !selected.value) select(reviews.value.find((item) => item.status === "succeeded")?.id ?? reviews.value[0]?.id);
  schedulePoll();
}

function replace(next: ReviewRead) {
  const index = reviews.value.findIndex((item) => item.id === next.id);
  reviews.value = index < 0 ? [next, ...reviews.value] : reviews.value.map((item) => (item.id === next.id ? next : item));
}

async function loadReport(review: ReviewRead) {
  reportRequest?.abort();
  report.value = undefined;
  reportError.value = "";
  if (review.status !== "succeeded" || !review.report_id) {
    reportState.value = "idle";
    return;
  }
  const controller = new AbortController();
  reportRequest = controller;
  reportState.value = "loading";
  try {
    const value = await props.services.reviews.report(props.project.id, review.id, controller.signal);
    if (controller.signal.aborted || selectedId.value !== review.id) return;
    report.value = value;
    reportState.value = "idle";
  } catch (problem) {
    if (controller.signal.aborted) return;
    reportState.value = "failed";
    reportError.value = asApiError(problem).message;
  }
}

function select(id?: string) {
  selectedId.value = id;
  severity.value = "all";
  downloadError.value = "";
  const review = reviews.value.find((item) => item.id === id);
  if (review) void loadReport(review);
  else {
    reportRequest?.abort();
    report.value = undefined;
    reportState.value = "idle";
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const target = active.value;
  if (!target || disposed) return;
  pollTimer = setTimeout(async () => {
    try {
      const next = await props.services.reviews.get(props.project.id, target.id);
      if (disposed) return;
      const previous = reviews.value.find((item) => item.id === next.id);
      // Responses are ordered by job state; never let an older poll undo a terminal state.
      if (previous && !isActiveReview(previous) && isActiveReview(next)) return schedulePoll();
      replace(next);
      if (!isActiveReview(next)) {
        announcement.value = {
          succeeded: "评审报告已生成；正文和计划保持原样。",
          failed: "评审失败，未生成报告。",
          cancelled: "评审已取消，未生成报告。",
        }[next.status as "succeeded" | "failed" | "cancelled"];
        if (selectedId.value === next.id) void loadReport(next);
      }
    } catch {
      // Polling is best effort; the next tick or a manual refresh recovers.
    }
    schedulePoll();
  }, POLL_MS);
}

watch([scope, rubric, agent], () => {
  pendingCommand = undefined;
  formError.value = "";
});

function openForm() {
  if (active.value) return;
  showForm.value = !showForm.value;
  formError.value = "";
}

async function start() {
  if (busy.value || active.value) return;
  if (!document.value) return void (formError.value = "请先在写作页建立正式稿，再发起评审。");
  if (!agent.value) return void (formError.value = "请选择评审智能体。");
  if (!rubric.value) return void (formError.value = "请选择评审量表。");
  const commandId = (pendingCommand ??= crypto.randomUUID());
  mutation?.abort();
  const controller = new AbortController();
  mutation = controller;
  busy.value = true;
  formError.value = "";
  try {
    const receipt = await props.services.reviews.create(
      props.project.id,
      {
        command_id: commandId,
        document_id: document.value.id,
        document_version: document.value.version,
        chapter_id: scope.value === WHOLE ? null : scope.value,
        rubric_version: rubric.value,
        agent_config_version_id: agent.value,
        source_binding_version_id: binding.value?.current_version_id ?? null,
      },
      controller.signal,
    );
    if (controller.signal.aborted || disposed) return;
    pendingCommand = undefined;
    replace(receipt.review);
    select(receipt.review.id);
    showForm.value = false;
    announcement.value = `已固定正文 v${receipt.review.document_version}，评审开始。`;
    schedulePoll();
  } catch (problem) {
    if (controller.signal.aborted) return;
    const error = asApiError(problem);
    formError.value = error.message;
    if (!["NETWORK_ERROR", "REQUEST_TIMEOUT"].includes(error.code)) pendingCommand = undefined;
    if (error.code === "REVIEW_CONTEXT_STALE" || error.code === "REVIEW_BUSY") void load();
  } finally {
    if (mutation === controller) busy.value = false;
  }
}

async function cancel(review: ReviewRead) {
  if (busy.value) return;
  busy.value = true;
  actionError.value = "";
  try {
    replace(await props.services.reviews.cancel(props.project.id, review.id));
    announcement.value = "已取消评审，未生成报告。";
  } catch (problem) {
    actionError.value = asApiError(problem).message;
    void load();
  } finally {
    busy.value = false;
  }
}

async function retry(review: ReviewRead) {
  if (busy.value || active.value) return;
  busy.value = true;
  actionError.value = "";
  try {
    const receipt = await props.services.reviews.retry(props.project.id, review.id, { command_id: crypto.randomUUID() });
    if (disposed) return;
    replace(receipt.review);
    select(receipt.review.id);
    announcement.value = `已按原输入重试：正文 v${receipt.review.document_version}。`;
    schedulePoll();
  } catch (problem) {
    actionError.value = asApiError(problem).message;
  } finally {
    busy.value = false;
  }
}

async function download(format: "html" | "markdown") {
  const review = selected.value;
  if (!review || downloading.value) return;
  downloading.value = format;
  downloadError.value = "";
  try {
    const blob = await props.services.reviews.download(props.project.id, review.id, format);
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = downloadName(review, format);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (problem) {
    downloadError.value = asApiError(problem).message;
  } finally {
    downloading.value = undefined;
  }
}

const locate = (chapterId: string | null) => (selected.value ? reviewLocationRoute(props.project.id, chapterId, selected.value.id) : undefined);
const shortId = (value?: string | null) => (value ? value.slice(0, 8) : "—");

void load();
let activatedOnce = false;
onActivated(() => {
  // Returning to the cached page shows reviews finished and versions saved meanwhile.
  if (activatedOnce) void load(true);
  activatedOnce = true;
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(pollTimer);
  loadRequest?.abort();
  reportRequest?.abort();
  mutation?.abort();
});
</script>

<template>
  <div class="screen-page review-screen">
    <header class="screen-heading">
      <div>
        <p class="tp-label">Review · 在交稿之前，再看一遍</p>
        <h1 class="tp-display mt-3">论文评审</h1>
        <p class="screen-lead">带着依据发现问题，让每一次修改都有方向。</p>
      </div>
      <div class="screen-actions">
        <TpButton variant="primary" :disabled="!!active || loadState === 'loading'" :aria-expanded="showForm" @click="openForm"
          ><TpIcon :icon="PhPlus" />新建评审</TpButton
        >
      </div>
    </header>

    <div class="review-overview">
      <div><span class="tp-label">评审记录</span><strong class="tp-num">{{ reviews.length }}</strong><span>每次评审固定输入版本</span></div>
      <div>
        <span class="tp-label">当前正文</span><strong class="tp-num">{{ document ? "v" + document.version : "—" }}</strong
        ><span>{{ document ? "开始评审时固定此版本" : "尚无正式稿" }}</span>
      </div>
      <p>
        <TpIcon :icon="PhScales" :size="24" /><span><b>仅评审，不改稿</b><br />参考评分与建议不代表教师成绩；修改由你另行决定。</span>
      </p>
    </div>

    <p v-if="loadError && loadState === 'ready'" class="review-old-note" role="alert">{{ loadError }}</p>

    <Transition mode="out-in" name="tp-swap" v-bind="panelMotionHooks">
      <section v-if="bannerReview" :key="bannerReview.id + bannerReview.status" class="review-run screen-panel" aria-label="评审执行状态">
        <div>
          <TpStatus :tone="reviewStatus[bannerReview.status].tone" :label="reviewStatus[bannerReview.status].label" :live="isActiveReview(bannerReview)" />
          <p class="tp-caption mt-2">
            {{ bannerReview.scope_title }} · 正文 v{{ bannerReview.document_version }} · 第 {{ Math.max(bannerReview.attempt, 1) }} 次执行
          </p>
          <p v-if="bannerReview.status === 'failed'" class="tp-caption mt-2">{{ errorText(bannerReview.error_code) }}未生成报告，正文未被修改。</p>
          <p v-else-if="bannerReview.status === 'cancelled'" class="tp-caption mt-2">未生成报告；固定输入保留，可按原输入重试。</p>
          <p v-if="actionError" class="tp-caption mt-2" role="alert">{{ actionError }}</p>
        </div>
        <TpButton v-if="isActiveReview(bannerReview)" class="review-run-action" size="sm" :loading="busy" @click="cancel(bannerReview)">取消评审</TpButton>
        <TpButton v-else class="review-run-action" size="sm" :loading="busy" :disabled="!!active" @click="retry(bannerReview)">按原输入重试</TpButton>
      </section>
    </Transition>

    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <form v-if="showForm" class="screen-panel review-form" aria-label="新建评审" @submit.prevent="start" @keydown.esc.prevent="showForm = false">
        <div class="review-form__head">
          <div>
            <p class="tp-label">新建评审</p>
            <h2 class="tp-heading mt-2">这一次，想检查哪些内容？</h2>
          </div>
        </div>
        <div class="review-fields">
          <TpField label="评审范围" required v-slot="field"
            ><TpSelect :id="field.id" v-model="scope" :disabled="!document" :aria-describedby="field.describedby" :options="scopeOptions"
          /></TpField>
          <TpField label="评分量表" :hint="currentRubric?.description" v-slot="field"
            ><TpSelect :id="field.id" v-model="rubric" :aria-describedby="field.describedby" :options="rubricOptions"
          /></TpField>
          <TpField label="评审智能体" required v-slot="field">
            <TpSelect v-if="agentOptions.length" :id="field.id" v-model="agent" :aria-describedby="field.describedby" :options="agentOptions" />
            <p v-else :id="field.id" class="review-no-agent">
              还没有可用的评审智能体。<RouterLink :to="configurationsRoute" class="studio-link">去配置台添加</RouterLink>
            </p>
          </TpField>
        </div>
        <p v-if="document" class="review-snapshot">
          输入快照：正文 v{{ document.version }} · {{ bindingLabel(binding?.current_version_id)
          }}{{ binding?.current_version_id ? " v" + binding.version : "" }}
        </p>
        <p v-else-if="documentMissing" class="review-snapshot">此项目尚无正式稿，请先在写作页建立正式稿。</p>
        <Transition mode="out-in" name="tp-swap">
          <p v-if="formError" :key="formError" class="settings-errors" role="alert">{{ formError }}</p>
        </Transition>
        <div class="screen-actions">
          <TpButton variant="pencil" type="submit" :loading="busy" :disabled="!document || !agentOptions.length || !!active"
            ><TpIcon :icon="PhClipboardText" />开始评审</TpButton
          ><TpButton variant="ghost" @click="showForm = false">取消</TpButton>
        </div>
      </form>
    </Transition>

    <div v-if="loadState === 'loading' && !reviews.length" class="screen-panel studio-body workspace-loading" role="status" aria-busy="true">
      <span class="tp-btn__spinner" aria-hidden="true" />正在读取评审记录…
    </div>
    <TpState v-else-if="loadState === 'failed'" class="screen-panel" kind="error" title="无法读取评审记录" :desc="loadError" retryable @retry="load()" />

    <div v-else class="review-layout">
      <aside class="screen-panel review-history" aria-label="评审历史">
        <div class="screen-panel__head">
          <h2 class="tp-heading"><TpIcon :icon="PhClockCounterClockwise" />评审历史</h2>
          <span class="tp-mono tp-caption">{{ reviews.length }}</span>
        </div>
        <div class="review-history__search">
          <TpIcon :icon="PhMagnifyingGlass" /><input v-model="search" class="tp-input" type="search" aria-label="搜索评审历史" placeholder="范围、时间或版本" />
        </div>
        <TransitionGroup name="tp-list" tag="div" class="tp-list-group review-history-list" v-bind="listMotionHooks">
          <button
            v-for="item in history"
            :key="item.id"
            type="button"
            class="review-history__item"
            :class="{ 'is-selected': selectedId === item.id }"
            :aria-pressed="selectedId === item.id"
            @click="select(item.id)"
          >
            <span class="review-history__title">{{ item.scope_title }}</span><span class="tp-caption">{{ formatTime(item.created_at) }}</span>
            <span class="review-history__meta"
              ><span class="tp-mono">正文 v{{ item.document_version }}</span
              ><TpStatus
                size="sm"
                :tone="item.status === 'succeeded' && document && item.document_version !== document.version ? 'stale' : reviewStatus[item.status].tone"
                :label="item.status === 'succeeded' && document && item.document_version !== document.version ? '基于旧稿' : reviewStatus[item.status].label"
                :live="isActiveReview(item)"
            /></span>
          </button>
        </TransitionGroup>
        <div v-if="!history.length" class="review-no-history">
          <p>{{ reviews.length ? "没有匹配的记录" : "还没有评审记录" }}</p>
          <TpButton v-if="search" variant="ghost" size="sm" @click="search = ''">清除搜索</TpButton>
        </div>
      </aside>

      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <div v-if="selected && report" :key="selected.id" class="review-report">
          <section class="screen-panel review-report__cover">
            <div class="review-cover__top">
              <p class="tp-label">Review report · 参考评审</p>
              <div class="screen-actions">
                <TpButton size="sm" :loading="downloading === 'html'" :disabled="!!downloading" @click="download('html')"
                  ><TpIcon :icon="PhArrowDown" />下载 HTML</TpButton
                ><TpButton size="sm" variant="ghost" :loading="downloading === 'markdown'" :disabled="!!downloading" @click="download('markdown')"
                  >下载 Markdown</TpButton
                >
              </div>
            </div>
            <h2 class="review-title">{{ report.content.scope.title }}<span>评审记录 · {{ formatTime(report.created_at) }}</span></h2>
            <p class="review-summary">{{ report.content.summary }}</p>
            <div class="review-bindings">
              <span>正文 v{{ report.document_version }}</span><span>{{ bindingLabel(selected.source_binding_version_id) }}</span
              ><span>{{ report.content.rubric.title }}</span><span>{{ selected.agent_name }}</span>
            </div>
            <details class="review-rubric tp-disclosure">
              <summary>查看量表与计分依据</summary>
              <p>{{ report.content.rubric.description }}</p>
              <ul>
                <li v-for="dim in report.content.rubric.dimensions" :key="dim.id">{{ dim.name }} {{ dim.full }} 分：{{ dim.description }}</li>
              </ul>
              <p>不能判定的维度保持留白，不补默认分，也不汇总总分。</p>
              <ul>
                <li v-for="item in report.content.limitations" :key="item">{{ item }}</li>
              </ul>
            </details>
            <Transition mode="out-in" name="tp-swap">
              <p v-if="downloadError" :key="downloadError" class="review-old-note" role="alert">{{ downloadError }}</p>
            </Transition>
          </section>
          <ReviewSummary
            :dims="scoreDims(report)"
            :doc-version="report.document_version"
            :current-version="document?.version ?? report.document_version"
            :unchecked="uncheckedItems(report)"
          />
          <section class="screen-panel">
            <div class="screen-panel__head">
              <div>
                <p class="tp-label">Findings</p>
                <h2 class="tp-heading mt-2">问题与下一步</h2>
              </div>
              <TpSelect v-model="severity" class="review-filter" aria-label="筛选问题严重程度" :options="severityOptions" />
            </div>
            <p v-if="stale" class="review-old-note">
              以下记录基于旧稿 v{{ report.document_version }}。定位只跳到当前写作页对应章节；修改须按当前版本另行发起。
            </p>
            <div class="review-issues">
              <TransitionGroup name="tp-list" tag="div" class="tp-list-group review-issue-items" v-bind="listMotionHooks">
                <ReviewIssueRow
                  v-for="issue in issues"
                  :key="issue.id"
                  :issue="issue"
                  :locate="issue.location.status === 'unlocated' ? undefined : locate(issue.location.chapter_id)"
                />
              </TransitionGroup>
              <TpState
                v-if="!issues.length"
                kind="noresult"
                :title="report.content.issues.length ? '该程度下没有问题' : '本次没有列出问题'"
                desc="这不代表论文不存在问题，未检查的内容仍需后续核对。"
                ><TpButton v-if="severity !== 'all'" size="sm" @click="severity = 'all'">查看全部问题</TpButton></TpState
              >
            </div>
          </section>
          <section class="screen-panel review-trace">
            <div class="review-trace__head">
              <h2 class="tp-heading"><TpIcon :icon="PhFileText" />输入与版本追溯</h2>
              <RouterLink :to="jobRoute(project.id, selected.job_id, services.sourceKey)" class="studio-link">查看执行任务</RouterLink>
            </div>
            <dl class="review-trace__facts">
              <dt>正文</dt>
              <dd>v{{ selected.document_version }} · {{ selected.scope_title }}</dd>
              <dt>模板与要求</dt>
              <dd>
                {{ selected.template_parse_version_id ? "模板解析 " + shortId(selected.template_parse_version_id) : "模板未绑定" }} ·
                {{ selected.requirement_parse_version_ids.length ? `要求 ${selected.requirement_parse_version_ids.length} 份` : "要求未绑定" }}
              </dd>
              <dt>量表</dt>
              <dd class="tp-mono">{{ selected.rubric_version }}</dd>
              <dt>智能体</dt>
              <dd>{{ selected.agent_name }} · <span class="tp-mono">{{ shortId(selected.agent_config_version_id) }}</span></dd>
              <dt>模型</dt>
              <dd class="tp-mono">{{ report.requested_model }} → {{ report.response_model }}</dd>
              <dt>执行</dt>
              <dd>第 {{ selected.attempt }} 次 · {{ formatTime(selected.updated_at) }}</dd>
            </dl>
          </section>
        </div>
        <section
          v-else-if="selected && reportState === 'loading'"
          :key="selected.id + '-loading'"
          class="screen-panel review-empty"
          role="status"
          aria-busy="true"
        >
          <p class="tp-caption"><span class="tp-btn__spinner" aria-hidden="true" />正在读取报告…</p>
        </section>
        <TpState
          v-else-if="selected && reportState === 'failed'"
          :key="selected.id + '-error'"
          class="screen-panel review-empty"
          kind="error"
          title="无法读取报告"
          :desc="reportError"
          retryable
          @retry="loadReport(selected)"
        />
        <section
          v-else-if="selected && isActiveReview(selected)"
          :key="selected.id + '-active'"
          class="screen-panel review-empty"
          role="status"
          aria-busy="true"
        >
          <p class="tp-caption">
            <span class="tp-btn__spinner" aria-hidden="true" />{{ reviewStatus[selected.status].label }} · {{ selected.scope_title }} · 正文 v{{
              selected.document_version
            }}
          </p>
        </section>
        <TpState
          v-else-if="selected"
          :key="selected.id + '-' + selected.status"
          class="screen-panel review-empty"
          :kind="selected.status === 'failed' ? 'error' : 'noresult'"
          :title="selected.status === 'failed' ? '评审失败，未生成报告' : '评审已取消，未生成报告'"
          :desc="selected.status === 'failed' ? errorText(selected.error_code) : '固定输入保留，可按原输入重试。'"
        >
          <TpButton v-if="selected.id !== bannerReview?.id" size="sm" :loading="busy" :disabled="!!active" @click="retry(selected)">按原输入重试</TpButton>
        </TpState>
        <TpState
          v-else
          key="review-empty"
          class="screen-panel review-empty"
          kind="empty"
          title="从第一份评审开始"
          desc="选择整篇或指定章节，保留这一次的版本与问题记录。"
        >
          <TpButton variant="pencil" :disabled="!!active" @click="showForm = true">选择评审范围</TpButton>
        </TpState>
      </Transition>
    </div>
    <Transition mode="out-in" name="tp-swap">
      <p v-if="announcement" :key="announcement" class="tp-caption" role="status">{{ announcement }}</p>
    </Transition>
  </div>
</template>

<style scoped>
.review-overview {
  display: grid;
  grid-template-columns: 160px 160px minmax(0, 1fr);
  gap: 32px;
  padding: 24px 0;
  border-block: 1px solid var(--tp-line);
}
.review-overview > div {
  display: grid;
  gap: 8px;
}
.review-overview strong {
  font-size: 32px;
  line-height: 1;
}
.review-overview > div > span:last-child {
  font-size: 11px;
  color: var(--tp-text-muted);
}
.review-overview > p {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  color: var(--tp-text-muted);
  font-size: 12px;
  line-height: 1.8;
}
.review-overview b {
  font-size: 14px;
  color: var(--tp-text);
  font-weight: 500;
}
.review-form {
  padding: 24px;
  display: grid;
  gap: 20px;
}
.review-form__head,
.review-run,
.review-cover__top,
.review-trace__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.review-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}
.review-no-agent {
  font-size: 12px;
  line-height: 1.8;
  color: var(--tp-text-muted);
}
.review-snapshot {
  padding: 12px 16px;
  background: var(--tp-surface-sunken);
  color: var(--tp-text-muted);
  border-radius: var(--tp-radius-s);
  font-size: 12px;
  line-height: 1.8;
}
.review-rubric {
  font-size: 12px;
  color: var(--tp-text-muted);
  line-height: 1.8;
  border-top: 1px solid var(--tp-line);
  padding-top: 16px;
  margin-top: 16px;
}
.review-rubric p,
.review-rubric ul {
  margin-top: 12px;
}
summary {
  cursor: pointer;
  width: fit-content;
  color: var(--tp-text);
}
summary:focus-visible {
  outline: 2px solid var(--tp-accent);
  outline-offset: 4px;
}
.review-run {
  padding: 20px 24px;
  align-items: flex-start;
}
.review-run.tp-swap-enter-from,
.review-run.tp-swap-leave-to {
  transform: none;
}
.review-layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.review-history .tp-heading,
.review-trace .tp-heading {
  display: flex;
  gap: 8px;
  align-items: center;
}
.review-history__search {
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--tp-line);
}
.review-history__search .tp-input {
  min-width: 0;
  width: 100%;
}
.review-history__item {
  padding: 20px;
  display: grid;
  gap: 12px;
  width: 100%;
  text-align: left;
  border-bottom: 1px solid var(--tp-line);
  border-left: 3px solid transparent;
}
.review-history__item.is-selected {
  background: var(--tp-accent-soft);
  border-left-color: var(--tp-accent);
}
.review-history__item:hover {
  background: var(--tp-surface-sunken);
}
.review-history__item:focus-visible {
  outline: 2px solid var(--tp-accent);
  outline-offset: -3px;
}
.review-history__title,
.review-history__meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.review-history__title {
  font-weight: 600;
  font-size: 13px;
}
.review-history__meta {
  font-size: 11px;
}
.review-no-history {
  padding: 20px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--tp-text-muted);
}
.review-report {
  display: grid;
  min-width: 0;
  gap: 24px;
}
.review-report__cover {
  padding: 24px;
}
.review-title {
  font-family: var(--tp-font-prose);
  font-size: 26px;
  font-weight: 600;
  line-height: 1.5;
  margin: 20px 0 12px;
}
.review-title span {
  display: block;
  font-size: 14px;
  font-family: var(--tp-font-body);
  font-weight: 400;
  color: var(--tp-text-muted);
}
.review-summary {
  font-family: var(--tp-font-prose);
  line-height: 1.9;
  overflow-wrap: anywhere;
}
.review-bindings {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 24px;
  font-size: 11px;
  color: var(--tp-text-muted);
}
.review-filter {
  max-width: 170px;
}
.review-issues {
  padding: 8px 20px;
}
.review-old-note {
  margin: 16px 20px 0;
  padding: 12px 16px;
  background: var(--tp-surface-sunken);
  color: var(--tp-text-muted);
  font-size: 12px;
  line-height: 1.8;
}
.review-issues :deep(.tp-issue) {
  padding-block: 20px;
}
.review-issues :deep(.tp-issue + .tp-issue) {
  border-top: 1px solid var(--tp-line);
}
.review-trace {
  display: grid;
  gap: 20px;
  padding: 20px;
}
.review-trace__facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 8px 24px;
  font-size: 12px;
  line-height: 1.8;
}
.review-trace__facts dt {
  color: var(--tp-text-muted);
}
.review-trace__facts dd {
  overflow-wrap: anywhere;
}
.review-empty {
  min-height: 400px;
  display: grid;
  place-items: center;
}
.review-empty .tp-btn__spinner {
  margin-right: 8px;
  vertical-align: middle;
}
@media (max-width: 1100px) {
  .review-layout {
    grid-template-columns: 220px minmax(0, 1fr);
  }
  .review-overview {
    grid-template-columns: 140px 140px minmax(0, 1fr);
    gap: 24px;
  }
}
@media (max-width: 900px) {
  .review-layout {
    grid-template-columns: 1fr;
  }
  .review-history {
    max-height: 340px;
    overflow: auto;
  }
  .review-overview {
    grid-template-columns: 1fr 1fr;
  }
  .review-overview > p {
    grid-column: 1/-1;
    justify-content: flex-start;
  }
  .review-fields {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}
@media (max-width: 600px) {
  .review-form,
  .review-report__cover,
  .review-run {
    padding: 16px;
  }
  .review-title {
    font-size: 24px;
  }
  .review-cover__top,
  .review-trace__head {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .review-trace__facts {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  .review-trace__facts dd {
    margin-bottom: 8px;
  }
}
</style>
