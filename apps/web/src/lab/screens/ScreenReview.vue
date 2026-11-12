<script setup lang="ts">
import { listMotionHooks } from "@/design/motion";

import { computed, onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import { PhArrowDown, PhArrowRight, PhClockCounterClockwise, PhClipboardText, PhFileText, PhMagnifyingGlass, PhPlus, PhScales } from "@phosphor-icons/vue";
import ReviewSummary from "@/components/domain/ReviewSummary.vue";
import IssueItem from "@/components/domain/IssueItem.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpDrawer from "@/components/ui/TpDrawer.vue";
import { usePreviewWorkspaceStore } from "../state/previewWorkspace";
import { downloadPreviewFile } from "../state/previewBackup";
import { captureBusinessConfig, useSettingsState } from "../state/settingsState";
import { useLibraryState } from "../state/libraryState";
import { startProjectJob } from "../state/jobState";
import { evaluateLibraryRequirement } from "../services/libraryService";
import {
  buildPreviewReport,
  extractReviewScope,
  reviewReportHtml,
  reviewSectionOptions,
  useReviewState,
  type ReviewInput,
  type ReviewRun,
  type ReviewReport,
} from "../state/reviewState";

const router = useRouter();
const workspace = usePreviewWorkspaceStore();
const state = useReviewState();
const settings = useSettingsState();
const library = useLibraryState();
const instanceState = state.value;
const showForm = ref(false);
const scope = ref("整篇论文");
const scenario = ref<ReviewRun["scenario"]>("normal");
const severity = ref("all");
const search = ref("");
const error = ref("");
const announcement = ref("");
const compare = ref(false);
const sections = computed(() => reviewSectionOptions(workspace.current.document.html));
const executionConfig = computed(() => captureBusinessConfig(settings.value, "review"));
const selected = computed(() => state.value.reports.find((r) => r.id === state.value.selectedId));
const history = computed(() => state.value.reports.filter((r) => `${r.input.scope} ${r.at} v${r.input.docVersion}`.includes(search.value.trim())));
const issues = computed(() => selected.value?.issues.filter((i) => severity.value === "all" || i.severity === severity.value) ?? []);
const previous = computed(() => {
  const index = state.value.reports.findIndex((r) => r.id === state.value.selectedId);
  return state.value.reports[index + 1];
});
const busy = computed(() => state.value.run?.status === "queued" || state.value.run?.status === "running");
const runLabels = { queued: "等待开始", running: "正在检查", done: "预览检查完成", partial: "部分完成", failed: "评审失败", cancelled: "已取消" } as const;
const timers: ReturnType<typeof setTimeout>[] = [];
const jobHandles = new Map<string, ReturnType<typeof startProjectJob>>();
const locatorOpen = ref(false);
const locatorReport = ref<ReviewReport | null>(null);
const locatorLocation = ref("");
const locatorBlocks = computed(() => {
  if (!locatorReport.value) return [];
  const located = extractReviewScope(locatorReport.value.input.html, locatorLocation.value);
  const dom = new DOMParser().parseFromString(located.html || locatorReport.value.input.html, "text/html");
  let highlighted = false;
  let headingSeen = false;
  return Array.from(dom.body.children).map((node, index) => {
    const text = node.textContent ?? "";
    if (/^H[1-6]$/.test(node.tagName) && !headingSeen) {
      highlighted = !!located.html || text.trim() === locatorLocation.value || locatorReport.value!.input.scope === locatorLocation.value;
      headingSeen = true;
    }
    return { id: index, tag: /^H[1-6]$/.test(node.tagName) ? node.tagName.toLowerCase() : "p", text, highlighted };
  });
});
const downloadError = ref("");
const simulateDownloadFailure = ref(false);

function capture(): ReviewInput | null {
  if (executionConfig.value.errors.length) {
    error.value = executionConfig.value.errors.join(" ");
    return null;
  }
  const content = extractReviewScope(workspace.current.document.html, scope.value);
  const boundRequirements = library.value.requirementSets.find((item) => item.version === workspace.current.requirementVersion)?.items ?? [];
  if (!content.text.trim()) {
    error.value = "当前范围没有可评审文字，请先撰写内容或选择其他范围。";
    return null;
  }
  return {
    projectId: workspace.current.id,
    title: workspace.current.title,
    docVersion: workspace.current.document.version,
    templateVersion: workspace.current.templateVersion,
    requirementVersion: workspace.current.requirementVersion,
    rubricVersion: 1,
    scope: sections.value.find((item) => item.id === scope.value)?.label ?? scope.value,
    sectionId: scope.value === "整篇论文" ? undefined : scope.value,
    configSnapshot: JSON.parse(JSON.stringify(executionConfig.value.snapshot)),
    requirementSnapshot: {
      version: workspace.current.requirementVersion,
      items: boundRequirements
        .filter((item) => item.enabled)
        .map((item) => {
          const result =
            scope.value === "整篇论文"
              ? evaluateLibraryRequirement(item, content.html, { ...library.value, requirements: boundRequirements }, workspace.current.document.version)
              : { verdict: "unknown", verdictNote: "本次为章节评审；全篇适用要求保留依据，不用局部输入判为全篇合规。" };
          return {
            id: item.id,
            text: item.text,
            param: item.param ?? "",
            kind: item.kind,
            sourceMaterialId: item.sourceMaterialId,
            sourceVersion: item.sourceVersion,
            verdict: result.verdict,
            note: result.verdictNote,
          };
        }),
    },
    templateSnapshot: (() => {
      const binding = library.value.templateBinding;
      const material = library.value.materials.find((item) => item.id === binding?.materialId);
      const version = material?.versions.find((item) => item.version === binding?.version);
      return binding && material && version
        ? { materialId: material.id, version: version.version, title: material.name, items: JSON.parse(JSON.stringify(version.templateItems ?? [])) }
        : null;
    })(),
    ...content,
  };
}
function schedule(input: ReviewInput, mode: ReviewRun["scenario"], attempt = 1, sourceId?: string) {
  if (workspace.current.id !== input.projectId) return;
  const owner = state.value;
  const run: ReviewRun = {
    id: crypto.randomUUID(),
    input: JSON.parse(JSON.stringify(input)) as ReviewInput,
    status: "queued",
    scenario: mode,
    attempt,
    diagnosis: "",
  };
  run.sourceId = sourceId ?? "review-" + run.id;
  owner.run = run;
  owner.runs ??= [];
  owner.runs.unshift(run);
  const job = startProjectJob(
    workspace.current,
    {
      title: "论文评审 · " + input.scope,
      kind: "评审",
      route: "/screens/review",
      input: `正文 v${input.docVersion} · ${input.scope}`,
      sourceId: run.sourceId,
      snapshot: { docVersion: input.docVersion, requirementVersion: input.requirementVersion, config: input.configSnapshot ?? [], scope: input.scope },
    },
    {
      cancel: () => {
        if (owner.run?.id === run.id) {
          owner.run.status = "cancelled";
          owner.run.diagnosis = "已取消，保留固定输入，迟到结果不会生成报告。";
        }
      },
      retry: () => schedule(input, "normal", attempt + 1, run.sourceId),
    },
  );
  jobHandles.set(run.id, job);
  showForm.value = false;
  error.value = "";
  announcement.value = "已固定输入版本，评审不会修改正文或计划。";
  const active = () => job.isActive() && owner.run?.id === run.id && ["queued", "running"].includes(owner.run.status);
  timers.push(
    setTimeout(() => {
      if (!active()) return;
      owner.run!.status = "running";
    }, 250),
  );
  timers.push(
    setTimeout(() => {
      if (!active()) return;
      if (mode === "timeout") {
        owner.run!.status = "failed";
        owner.run!.diagnosis = "模拟请求超时。输入快照与历史报告均已保留，可按原输入重试。";
        job.finish("failed", owner.run!.diagnosis);
        return;
      }
      const report = buildPreviewReport(input, mode === "partial");
      owner.reports.unshift(report);
      owner.selectedId = report.id;
      owner.run!.status = mode === "partial" ? "partial" : "done";
      owner.run!.diagnosis = mode === "partial" ? "模拟文献来源不可用，其他规则预览已完成；未完成项已列入报告。" : "";
      job.finish(mode === "partial" ? "partial" : "done", mode === "partial" ? owner.run!.diagnosis : "只读评审完成，报告已保存；正文和计划未修改。");
      if (workspace.current.id === input.projectId) {
        workspace.recordEvent(
          "评审报告可查看",
          `正文 v${input.docVersion} · ${input.scope} · ${mode === "partial" ? "部分完成" : "规则预览完成"}`,
          "/screens/review",
        );
        announcement.value = "报告已生成；正文和计划保持原样。";
      }
    }, 1000),
  );
}
function start() {
  if (busy.value) return;
  const input = capture();
  if (input) schedule(input, scenario.value);
}
function cancel() {
  if (!busy.value || !state.value.run) return;
  state.value.run.status = "cancelled";
  state.value.run.diagnosis = "本次评审已取消，未生成新报告。输入快照与原有报告保留。";
  jobHandles.get(state.value.run.id)?.cancel();
  announcement.value = "已取消评审。";
}
function retry() {
  if (busy.value || !state.value.run) return;
  const last = state.value.run;
  schedule(last.input, "normal", last.attempt + 1, last.sourceId);
}
function openIssue(id: string, revise: boolean) {
  const issue = selected.value?.issues.find((i) => i.id === id);
  if (!issue || !selected.value) return;
  if (revise) {
    void router.push({
      path: "/screens/write",
      query: {
        chapter: issue.location,
        review: selected.value.id,
        reviewVersion: selected.value.input.docVersion,
        goal: issue.suggestion,
        ...(selected.value.input.sectionId && !selected.value.input.sectionId.startsWith("section-") ? { chapterId: selected.value.input.sectionId } : {}),
      },
    });
    return;
  }
  locatorReport.value = selected.value;
  locatorLocation.value = issue.location;
  locatorOpen.value = true;
}
function download() {
  if (!selected.value) return;
  const report = selected.value;
  const job = startProjectJob(
    workspace.current,
    {
      title: "评审报告导出",
      kind: "导出",
      route: "/screens/review",
      input: `报告 ${report.id} · 正文 v${report.input.docVersion}`,
      sourceId: "review-export-" + report.id,
      snapshot: { reportId: report.id, docVersion: report.input.docVersion },
    },
    {
      retry: () => {
        state.value.selectedId = report.id;
        simulateDownloadFailure.value = false;
        download();
      },
    },
  );
  downloadError.value = "";
  const result = simulateDownloadFailure.value
    ? { ok: false as const, error: "模拟下载准备失败。报告保留，可关闭失败场景后重试。" }
    : downloadPreviewFile(`ThesisPilot-review-v${report.input.docVersion}.html`, reviewReportHtml(report), "text/html;charset=utf-8");
  if (!result.ok) {
    downloadError.value = result.error;
    job.finish("failed", result.error);
    return;
  }
  job.finish("done", "报告文件已生成并交给浏览器下载。");
  announcement.value = "已生成 HTML 报告并交给浏览器下载，包含本次版本、问题、依据与未检查项。";
}
onBeforeUnmount(() => {
  timers.forEach(clearTimeout);
  for (const handle of jobHandles.values()) if (handle.isActive()) handle.cancel();
  if (instanceState.run && ["queued", "running"].includes(instanceState.run.status)) {
    instanceState.run.status = "cancelled";
    instanceState.run.diagnosis = "页面退出，本次运行已取消。输入快照保留，可重试。";
  }
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
        <TpButton variant="primary" :disabled="busy" @click="showForm = !showForm"><TpIcon :icon="PhPlus" />新建评审</TpButton>
      </div>
    </header>

    <div class="review-overview">
      <div><span class="tp-label">评审记录</span><strong class="tp-num">{{ state.reports.length }}</strong><span>每次检查都有独立快照</span></div>
      <div>
        <span class="tp-label">当前正文</span><strong class="tp-num">v{{ workspace.current.document.version }}</strong><span>版本固定后再开始检查</span>
      </div>
      <p>
        <TpIcon :icon="PhScales" :size="24" /><span><b>仅评审，不改稿</b><br />参考评分与建议不代表教师成绩；修改由你另行决定。</span>
      </p>
    </div>

    <Transition mode="out-in" name="tp-swap">
      <section v-if="state.run" class="review-run screen-panel" aria-label="评审执行状态">
        <div>
          <div class="review-run-status">
            <Transition name="tp-swap" mode="out-in"
              ><TpStatus
                :key="state.run.status"
                :tone="
                  state.run.status === 'failed' ? 'danger' : state.run.status === 'partial' ? 'warning' : state.run.status === 'cancelled' ? 'ghost' : 'info'
                "
                :label="runLabels[state.run.status]"
                :live="busy"
            /></Transition>
          </div>
          <p class="tp-caption mt-2">{{ state.run.input.scope }} · 正文 v{{ state.run.input.docVersion }} · 第 {{ state.run.attempt }} 次执行</p>
          <p v-if="state.run.diagnosis" class="tp-caption mt-2">{{ state.run.diagnosis }}</p>
        </div>
        <TpButton class="review-run-action" v-if="busy" size="sm" @click="cancel">取消评审</TpButton
        ><TpButton v-else-if="['failed', 'partial', 'cancelled'].includes(state.run.status)" size="sm" @click="retry">按原输入重试</TpButton>
      </section>
    </Transition>

    <Transition name="tp-swap">
      <form v-if="showForm" class="screen-panel review-form" aria-label="新建评审" @submit.prevent="start" @keydown.esc.prevent="showForm = false">
        <div class="review-form__head">
          <div>
            <p class="tp-label">新建评审</p>
            <h2 class="tp-heading mt-2">这一次，想检查哪些内容？</h2>
          </div>
          <TpStatus tone="ghost" label="规则预览 · 未接入真实模型" />
        </div>
        <div class="review-fields">
          <TpField label="评审范围" :error="error" required v-slot="field"
            ><TpSelect
              :id="field.id"
              v-model="scope"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedby"
              :options="[{ value: '整篇论文', label: '整篇论文' }, ...sections.map((chapter) => ({ value: chapter.id, label: chapter.label }))]"
          /></TpField>
          <TpField label="评分量表" hint="只有结构维度展示预览分值，其他维度保持不能判定。" v-slot="field"
            ><TpSelect
              :id="field.id"
              model-value="基础评审量表 · v1（自制样例）"
              :options="[{ value: '基础评审量表 · v1（自制样例）', label: '基础评审量表 · v1（自制样例）' }]"
          /></TpField>
        </div>
        <p class="review-snapshot">
          输入快照：正文 v{{ workspace.current.document.version }} ·
          {{ workspace.current.templateVersion ? "模板 v" + workspace.current.templateVersion : "模板未绑定" }} ·
          {{ workspace.current.requirementVersion ? "要求 v" + workspace.current.requirementVersion : "要求未绑定" }}。开始后的正文编辑不会混入本次报告。
        </p>
        <p class="tp-caption">执行配置：{{ executionConfig.snapshot.map((node) => `${node.name} v${node.version}`).join(" → ") }}</p>
        <p v-if="executionConfig.errors.length" class="settings-errors" role="alert">{{ executionConfig.errors.join(" ") }}</p>
        <details class="review-scenario tp-disclosure">
          <summary>状态预览</summary>
          <TpField label="本次预览场景" v-slot="field"
            ><TpSelect
              :id="field.id"
              v-model="scenario"
              :options="[
                { value: 'normal', label: '正常完成' },
                { value: 'partial', label: '部分完成：文献来源不可用' },
                { value: 'timeout', label: '失败：模拟请求超时' },
              ]"
          /></TpField>
        </details>
        <div class="screen-actions">
          <TpButton variant="pencil" type="submit"><TpIcon :icon="PhClipboardText" />开始预览评审</TpButton
          ><TpButton variant="ghost" @click="showForm = false">取消</TpButton>
        </div>
      </form>
    </Transition>

    <div class="review-layout">
      <aside class="screen-panel review-history">
        <div class="screen-panel__head">
          <h2 class="tp-heading"><TpIcon :icon="PhClockCounterClockwise" />评审历史</h2>
          <span class="tp-mono tp-caption">{{ state.reports.length }}</span>
        </div>
        <div class="review-history__search">
          <TpIcon :icon="PhMagnifyingGlass" /><input v-model="search" class="tp-input" type="search" aria-label="搜索评审历史" placeholder="范围、时间或版本" />
        </div>
        <TransitionGroup name="tp-list" tag="div" class="tp-list-group review-history-list" v-bind="listMotionHooks">
          <button
            v-for="report in history"
            :key="report.id"
            class="review-history__item"
            :class="{ 'is-selected': state.selectedId === report.id }"
            :aria-pressed="state.selectedId === report.id"
            @click="
              state.selectedId = report.id;
              severity = 'all';
              compare = false;
            "
          >
            <span class="review-history__title">{{ report.input.scope }}<TpIcon :icon="PhArrowRight" /></span><span class="tp-caption">{{ report.at }}</span
            ><span class="review-history__meta"
              ><span class="tp-mono">正文 v{{ report.input.docVersion }}</span
              ><TpStatus
                size="sm"
                :tone="report.input.docVersion !== workspace.current.document.version ? 'stale' : report.partial ? 'warning' : 'neutral'"
                :label="report.input.docVersion !== workspace.current.document.version ? '旧稿' : report.partial ? '部分完成' : '预览报告'"
            /></span>
          </button>
        </TransitionGroup>
        <div v-if="!history.length" class="review-no-history">
          <p>{{ state.reports.length ? "没有匹配的记录" : "还没有评审记录" }}</p>
          <TpButton v-if="search" variant="ghost" size="sm" @click="search = ''">清除搜索</TpButton>
        </div>
        <p class="review-history__note">历史报告保留当时的输入与判断，不随后续正文变化重写。</p>
      </aside>

      <Transition name="tp-swap" mode="out-in">
        <div :key="selected.id" v-if="selected" class="review-report">
          <section class="screen-panel review-report__cover">
            <div class="review-cover__top">
              <p class="tp-label">Review report · {{ selected.partial ? "部分完成" : "规则预览" }}</p>
              <TpButton size="sm" @click="download"><TpIcon :icon="PhArrowDown" />下载报告</TpButton>
            </div>
            <h2 class="review-title">{{ selected.input.scope }}<span>评审记录</span></h2>
            <p class="tp-caption">{{ selected.input.title }}</p>
            <div class="review-bindings">
              <span>正文 v{{ selected.input.docVersion }}</span
              ><span>{{ selected.input.templateVersion ? "模板 v" + selected.input.templateVersion : "模板未绑定" }}</span
              ><span>{{ selected.input.requirementVersion ? "要求 v" + selected.input.requirementVersion : "要求未绑定" }}</span
              ><span>量表 v{{ selected.input.rubricVersion }}</span>
            </div>
            <details class="review-rubric tp-disclosure">
              <summary>查看量表与计分依据</summary>
              <p>结构可读性 25 分、论证与内容 35 分、文献与依据 25 分、格式与表达 15 分。这是自制预览量表，未采用学校评分标准。</p>
              <p>本轮仅识别二级/三级标题：存在时结构维度示例计 20 分，否则 10 分。其他维度未执行真实评审，因此不计分，也不汇总总分。</p>
            </details>
            <details class="review-rubric tp-disclosure">
              <summary>查看本次配置与适用依据</summary>
              <p v-if="!selected.input.configSnapshot?.length">这份历史样例没有记录执行配置，不以当前配置补写。</p>
              <ul v-else>
                <li v-for="node in selected.input.configSnapshot" :key="node.id">{{ node.name }} · v{{ node.version }}</li>
              </ul>
              <p>
                {{
                  selected.input.templateSnapshot
                    ? `${selected.input.templateSnapshot.title} v${selected.input.templateSnapshot.version}`
                    : "未记录模板来源快照"
                }}
              </p>
              <p>固定要求 {{ selected.input.requirementSnapshot?.items.length ?? 0 }} 条；未知来源继续列为未检查。</p>
              <ul v-if="selected.input.requirementSnapshot">
                <li v-for="item in selected.input.requirementSnapshot.items" :key="item.id">
                  {{ item.text }} · {{ item.param }} · 来源 {{ item.sourceMaterialId || "缺失" }} v{{ item.sourceVersion }}
                  <p>{{ item.note || "未判定" }}</p>
                </li>
              </ul>
            </details>
            <details class="review-rubric tp-disclosure">
              <summary>下载状态预览</summary>
              <label><input class="tp-checkbox" v-model="simulateDownloadFailure" type="checkbox" /> 模拟下载准备失败</label>
            </details>
            <Transition mode="out-in" name="tp-swap">
              <div :key="downloadError" v-if="downloadError" class="review-old-note" role="alert">
                <p>{{ downloadError }}</p>
                <TpButton
                  size="sm"
                  @click="
                    simulateDownloadFailure = false;
                    download();
                  "
                  >重试下载</TpButton
                >
              </div>
            </Transition>
          </section>
          <ReviewSummary
            :dims="selected.dims"
            :doc-version="selected.input.docVersion"
            :current-version="workspace.current.document.version"
            :unchecked="selected.unchecked"
          />
          <section class="screen-panel">
            <div class="screen-panel__head">
              <div>
                <p class="tp-label">Findings</p>
                <h2 class="tp-heading mt-2">问题与下一步</h2>
              </div>
              <TpSelect
                v-model="severity"
                class="review-filter"
                aria-label="筛选问题严重程度"
                :options="[
                  { value: 'all', label: `全部程度（${selected.issues.length}）` },
                  { value: 'major', label: '严重' },
                  { value: 'minor', label: '一般' },
                  { value: 'advice', label: '建议' },
                ]"
              />
            </div>
            <p v-if="selected.input.docVersion !== workspace.current.document.version" class="review-old-note">
              以下记录基于旧稿。定位将只读查看本报告的原文；明确请求修订才进入当前写作页，候选须按当前版本重新核对。
            </p>
            <div class="review-issues">
              <TransitionGroup name="tp-list" tag="div" class="tp-list-group review-issue-items" v-bind="listMotionHooks">
                <IssueItem
                  v-for="issue in issues"
                  :key="issue.id"
                  :issue="issue"
                  @locate="openIssue($event, false)"
                  @revise="openIssue($event, true)"
                /> </TransitionGroup
              ><TpState v-if="!issues.length" kind="noresult" title="该程度下没有检查项" desc="这不代表论文不存在问题，未检查的内容仍需后续核对。"
                ><TpButton size="sm" @click="severity = 'all'">查看全部问题</TpButton></TpState
              >
            </div>
          </section>
          <section class="screen-panel review-trace">
            <div class="review-trace__head">
              <h2 class="tp-heading"><TpIcon :icon="PhFileText" />输入与版本追溯</h2>
              <TpButton v-if="previous" size="sm" variant="ghost" @click="compare = !compare">{{ compare ? "收起对比" : "对比上一份" }}</TpButton>
            </div>
            <Transition name="tp-swap">
              <div v-if="compare && previous" class="review-comparison">
                <div>
                  <span class="tp-label">上一份</span><b>v{{ previous.input.docVersion }} · {{ previous.input.scope }}</b>
                  <p>{{ previous.words }} 字 · {{ previous.issues.length }} 个检查项</p>
                </div>
                <div>
                  <span class="tp-label">当前所选</span><b>v{{ selected.input.docVersion }} · {{ selected.input.scope }}</b>
                  <p>{{ selected.words }} 字 · {{ selected.issues.length }} 个检查项</p>
                </div>
                <p class="tp-caption">范围或量表不同的报告不直接比较评分；检查项数量不代表质量升降。</p>
              </div>
            </Transition>
            <details class="tp-disclosure">
              <summary>查看固定输入文字 · {{ selected.words }} 字</summary>
              <pre class="review-input">{{ selected.input.text }}</pre>
            </details>
          </section>
        </div>
        <section :key="'review-empty'" v-else class="screen-panel review-empty">
          <TpState kind="empty" title="从第一份评审开始" desc="选择整篇或指定章节，保留这一次的版本与问题记录。"
            ><TpButton variant="pencil" @click="showForm = true">选择评审范围</TpButton></TpState
          >
        </section>
      </Transition>
    </div>
    <Transition mode="out-in" name="tp-swap">
      <p :key="announcement" v-if="announcement" class="tp-caption" role="status">{{ announcement }}</p>
    </Transition>
    <TpDrawer v-model:open="locatorOpen" title="报告原文 · 只读定位" eyebrow="仅评审 · 固定输入">
      <template v-if="locatorReport">
        <p class="tp-caption">{{ locatorReport.input.scope }} · 正文 v{{ locatorReport.input.docVersion }} · {{ locatorReport.at }}</p>
        <p class="review-old-note">定位依据：{{ locatorLocation }}。这是本次评审的固定原文，不会修改当前论文。</p>
        <article class="review-readonly-paper" aria-label="报告版本只读原文" tabindex="0">
          <component :is="block.tag" v-for="block in locatorBlocks" :key="block.id" :class="{ 'review-located': block.highlighted }">{{
            block.text
          }}</component>
        </article>
      </template>
    </TpDrawer>
  </div>
</template>

<style scoped>
.review-readonly-paper {
  max-height: 58vh;
  overflow: auto;
  padding: 24px;
  background: var(--tp-surface);
  border: 1px solid var(--tp-line);
  font-family: var(--tp-font-prose);
  line-height: 2;
}
.review-readonly-paper > * {
  padding: 8px 12px;
  margin: 0;
  overflow-wrap: anywhere;
}
.review-readonly-paper h2,
.review-readonly-paper h3 {
  font-weight: 700;
  margin-top: 12px;
}
.review-located {
  background: var(--tp-surface-sunken);
  border-left: 3px solid var(--tp-accent);
}
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
.review-form__head {
  flex-wrap: wrap;
}
.review-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}
.review-fields .tp-input,
.review-scenario .tp-input {
  width: 100%;
}
.review-snapshot {
  padding: 12px 16px;
  background: var(--tp-surface-sunken);
  color: var(--tp-text-muted);
  border-radius: var(--tp-radius-s);
  font-size: 12px;
  line-height: 1.8;
}
.review-scenario,
.review-rubric,
.review-trace details {
  font-size: 12px;
  color: var(--tp-text-muted);
  line-height: 1.8;
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
.review-scenario .tp-field,
.review-rubric p {
  margin-top: 12px;
}
.review-run {
  padding: 20px 24px;
  align-items: flex-start;
  scroll-margin-block-start: 140px;
}
.review-run.tp-swap-enter-from,
.review-run.tp-swap-leave-to {
  transform: none;
}
.review-run-status {
  min-height: 24px;
}
.review-run-action {
  scroll-margin-block: 140px 24px;
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
.review-history__note,
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
.review-bindings {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 24px;
  font-size: 11px;
  color: var(--tp-text-muted);
}
.review-rubric {
  border-top: 1px solid var(--tp-line);
  padding-top: 16px;
  margin-top: 16px;
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
.review-input {
  font: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 16px;
  background: var(--tp-surface-sunken);
  margin-top: 12px;
  border-radius: var(--tp-radius-s);
  max-height: 300px;
  overflow: auto;
}
.review-comparison {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 16px;
  background: var(--tp-surface-sunken);
}
.review-comparison > div {
  display: grid;
  gap: 8px;
  font-size: 12px;
}
.review-comparison > p {
  grid-column: 1/-1;
}
.review-empty {
  min-height: 400px;
  display: grid;
  place-items: center;
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
}
@media (max-width: 600px) {
  .review-fields {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .review-form,
  .review-report__cover,
  .review-run {
    padding: 16px;
  }
  .review-title {
    font-size: 24px;
  }
  .review-cover__top {
    align-items: flex-start;
  }
  .review-issues :deep(.tp-issue .flex.gap-2) {
    flex-wrap: wrap;
  }
  .review-trace__head {
    flex-wrap: wrap;
  }
  .review-comparison {
    grid-template-columns: 1fr;
  }
}
</style>
