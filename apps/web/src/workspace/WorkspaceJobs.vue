<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import { jobStatus } from "@/domain/vocab";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import {
  assistantJobLink,
  canRerunServiceJob,
  isActiveServiceJob,
  serviceJobFailure,
  serviceJobStatus,
  serviceJobTitle,
  type ServiceJobsState,
} from "@/lab/state/serviceJobs";
import type { BackendServices, JobRead, ProjectRead } from "@/services";
import { useBackendServices } from "@/services/runtime";
import { isInspectionInput, isInspectionConfiguration, isProbeScope, isProbeConfiguration, isMaterialInput } from "@/services/validation";
import JobProjectPicker from "./jobs/JobProjectPicker.vue";
import { printableConfiguration } from "./configurations/configurationEditor";
import {
  artifactPresentation,
  attemptDiagnosis,
  attemptStatus,
  fixedInput,
  jobNextStep,
  jobScopeSummary,
  jobSourceAction,
  kindOptions,
  useKindFilteredJobs,
  type JobKind,
} from "./jobs/jobPresentation";
import { jobRoute, materialsRoute, projectJobsRoute, versionRoute, writingRoute } from "./workspaceRoutes";

const props = defineProps<{
  project?: ProjectRead;
  source: string;
  selectedId?: string;
  state: ServiceJobsState;
  services?: BackendServices;
  workspaceId?: string;
}>();
const backend = (props.services ?? useBackendServices().services)!;
const { projectId, filter, activeCount, detailData, detailLoading, detailError, detailMissing, inspect } = props.state;
const kindJobs = useKindFilteredJobs(backend, projectId, props.workspaceId);
const { kind } = kindJobs;
/** The listing comes from the kind-scoped state while a kind is chosen; details always use the shared state. */
const list = computed(() => (kindJobs.active.value ? kindJobs.scoped : props.state));
const directory = computed(() => list.value.directory.value);
const total = computed(() => list.value.total.value);
const offset = computed(() => list.value.offset.value);
const listLimit = computed(() => list.value.listLimit);
const loading = computed(() => list.value.loading.value);
const loadError = computed(() => list.value.loadError.value);
const action = computed(() => list.value.action.value);
const actionError = computed(() => list.value.actionError.value);
const notice = computed(() => list.value.notice.value);
const filtered = computed(() => filter.value !== "all" || kind.value !== "all");
const detailPanel = ref<HTMLElement>();
const statuses = [
  { value: "all", label: "全部状态" },
  { value: "queued", label: jobStatus.queued.label },
  { value: "running", label: jobStatus.running.label },
  { value: "succeeded", label: jobStatus.done.label },
  { value: "failed", label: jobStatus.failed.label },
  { value: "cancelled", label: jobStatus.cancelled.label },
];
const format = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
const formatTime = (value: string) => format.format(new Date(value));
const links = (job: JobRead) => jobRoute(job.project_id, job.id, props.source);
const savedVersion = computed(() => {
  const job = detailData.value;
  const scope = job?.resource_scope;
  return job && isInspectionInput(scope)
    ? versionRoute({ source: props.source, projectId: job.project_id, documentId: scope.document_id, version: scope.document_version })
    : undefined;
});
const artifactViews = computed(() => detailData.value?.artifacts.map(artifactPresentation) ?? []);
const probeConfiguration = computed(() => (isProbeConfiguration(detailData.value?.configuration) ? detailData.value.configuration : undefined));
const sourceAction = computed(() => (detailData.value ? jobSourceAction(detailData.value) : undefined));
const attempts = computed(() => [...(detailData.value?.attempts ?? [])].sort((a, b) => b.attempt - a.attempt));

function changeStatus(status: typeof filter.value) {
  props.state.changeFilter(status);
  if (kindJobs.active.value) kindJobs.scoped.changeFilter(status);
}
function changeKind(next: JobKind | "all") {
  kindJobs.changeKind(next, filter.value);
}
function showAll() {
  changeKind("all");
  changeStatus("all");
}

watch(
  [projectId, () => props.selectedId],
  async ([, id]) => {
    void inspect(id ?? "");
    if (!id) return;
    await nextTick();
    if (props.selectedId === id) detailPanel.value?.focus();
  },
  { immediate: true },
);
</script>

<template>
  <section class="screen-page workspace-page workspace-jobs">
    <header class="screen-heading">
      <div>
        <h1 class="tp-display">执行任务</h1>
        <p v-if="project" class="tp-caption jobs-project">{{ project.name }}</p>
      </div>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <TpStatus
          v-if="project && activeCount !== null"
          :key="activeCount ? 'live' : 'idle'"
          :tone="activeCount ? 'info' : 'ghost'"
          :live="!!activeCount"
          :label="activeCount ? `${activeCount} 项正在执行` : '当前没有运行任务'"
        />
      </Transition>
    </header>
    <JobProjectPicker v-if="!project" :projects="backend.projects" />
    <template v-else>
      <div class="screen-actions workspace-jobs__controls">
        <TpField v-slot="{ id }" label="按状态筛选"><TpSelect :id="id" :model-value="filter" :options="statuses" @update:model-value="changeStatus" /></TpField>
        <TpField v-if="workspaceId" v-slot="{ id }" label="按类型筛选">
          <TpSelect :id="id" :model-value="kind" :options="kindOptions" searchable @update:model-value="changeKind" />
        </TpField>
        <TpButton variant="ghost" :loading="loading" :disabled="loading" @click="list.refresh()">刷新任务</TpButton>
        <span v-if="filtered" class="tp-caption jobs-filter-count">{{ total }} 项符合筛选</span>
      </div>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <p v-if="actionError" :key="actionError" class="studio-notice" role="alert">{{ actionError }}</p>
        <p v-else-if="notice" :key="notice" class="studio-notice jobs-notice" role="status">{{ notice }}</p>
      </Transition>
      <Transition name="tp-swap" v-bind="panelMotionHooks">
        <TpState v-if="loadError" kind="error" title="任务状态暂时无法读取" :desc="loadError" retryable @retry="list.refresh()" />
      </Transition>
      <div class="workspace-jobs__layout" :class="{ 'workspace-jobs__layout--selected': selectedId }">
        <section class="screen-panel jobs-directory" aria-label="项目任务" :aria-busy="loading || undefined">
          <header class="jobs-directory__head">
            <h2 class="tp-subheading">任务列表</h2>
            <span class="tp-caption">{{ total }} 项</span>
          </header>
          <TransitionGroup name="tp-list" tag="ul" class="jobs-list tp-list-group" v-bind="listMotionHooks">
            <li v-for="job in directory" :key="job.id" class="jobs-list__item">
              <article class="job-row" :class="{ 'workspace-jobs__selected': selectedId === job.id }" data-testid="workspace-job-row">
                <div class="job-row__heading">
                  <RouterLink class="studio-text-button tp-subheading" :to="links(job)" :aria-current="selectedId === job.id ? 'location' : undefined">{{
                    serviceJobTitle(job)
                  }}</RouterLink>
                  <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
                    ><TpStatus :key="job.status" v-bind="serviceJobStatus(job)" size="sm"
                  /></Transition>
                </div>
                <p class="tp-caption job-row__meta">
                  <span>{{ jobScopeSummary(job) }}</span> · <time :datetime="job.created_at">{{ formatTime(job.created_at) }}</time>
                  <span v-if="job.attempt > 1"> · 第 {{ job.attempt }} 次尝试</span>
                </p>
                <p v-if="serviceJobFailure(job)" class="job-row__failure">{{ serviceJobFailure(job) }}</p>
                <p class="job-row__next">{{ jobNextStep(job) }}</p>
                <div class="screen-actions job-row__actions">
                  <TpButton
                    v-if="isActiveServiceJob(job)"
                    size="sm"
                    variant="outline"
                    :loading="action?.type === 'cancel' && action.id === job.id"
                    :disabled="!!action"
                    @click="list.cancel(job)"
                    >取消任务</TpButton
                  >
                  <TpButton
                    v-else-if="canRerunServiceJob(job)"
                    size="sm"
                    variant="outline"
                    :loading="action?.type === 'retry' && action.id === job.id"
                    :disabled="!!action"
                    @click="list.retry(job)"
                    >重试任务</TpButton
                  >
                  <RouterLink v-if="assistantJobLink(job)" class="studio-link" :to="assistantJobLink(job)!">返回助手会话</RouterLink>
                </div>
              </article>
            </li>
            <li v-if="loading && !directory.length" key="loading" class="jobs-loading" role="status">
              <span class="tp-btn__spinner" aria-hidden="true" />正在读取任务…
            </li>
            <li v-else-if="!loadError && !directory.length" key="empty">
              <TpState
                :kind="filtered ? 'noresult' : 'empty'"
                :title="filtered ? '没有符合条件的任务' : '还没有执行记录'"
                :desc="filtered ? undefined : '业务任务的执行记录会保留在这里。'"
              >
                <TpButton v-if="filtered" size="sm" @click="showAll">显示全部</TpButton>
                <RouterLink v-else class="tp-btn tp-btn--outline tp-btn--sm" :to="writingRoute(project.id)">打开写作台</RouterLink>
              </TpState>
            </li>
          </TransitionGroup>
          <nav v-if="total > listLimit" class="screen-actions jobs-pagination" aria-label="任务分页">
            <TpButton size="sm" variant="ghost" :disabled="loading || offset === 0" @click="list.refresh(offset - listLimit)">上一页</TpButton>
            <span class="tp-caption">第 {{ Math.floor(offset / listLimit) + 1 }} 页</span>
            <TpButton size="sm" variant="ghost" :disabled="loading || offset + listLimit >= total" @click="list.refresh(offset + listLimit)">下一页</TpButton>
          </nav>
        </section>

        <aside ref="detailPanel" class="screen-panel workspace-jobs__detail" tabindex="-1" aria-label="输入与诊断">
          <div class="job-detail__top">
            <div>
              <p class="tp-label">任务详情</p>
              <h2 class="tp-subheading">输入与诊断</h2>
            </div>
            <RouterLink v-if="selectedId" class="studio-link" :to="projectJobsRoute(project.id)">收起详情</RouterLink>
          </div>
          <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
            <div v-if="detailData" :key="detailData.id" class="job-detail">
              <div class="job-detail__heading">
                <div>
                  <h3 class="tp-heading">{{ serviceJobTitle(detailData) }}</h3>
                  <p class="tp-caption">{{ jobScopeSummary(detailData) }}</p>
                </div>
                <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
                  ><TpStatus :key="detailData.status" v-bind="serviceJobStatus(detailData)"
                /></Transition>
              </div>
              <p class="job-detail__next" :data-status="detailData.status">{{ jobNextStep(detailData) }}</p>
              <div class="screen-actions job-detail__actions">
                <TpButton
                  v-if="isActiveServiceJob(detailData)"
                  size="sm"
                  variant="primary"
                  :loading="action?.type === 'cancel' && action.id === detailData.id"
                  :disabled="!!action"
                  @click="list.cancel(detailData)"
                  >取消任务</TpButton
                >
                <TpButton
                  v-else-if="canRerunServiceJob(detailData)"
                  size="sm"
                  variant="primary"
                  :loading="action?.type === 'retry' && action.id === detailData.id"
                  :disabled="!!action"
                  @click="list.retry(detailData)"
                  >重试任务</TpButton
                >
                <RouterLink v-if="sourceAction" class="studio-link" :to="sourceAction.to">{{ sourceAction.label }}</RouterLink>
              </div>
              <dl class="studio-facts job-facts">
                <template v-if="savedVersion && isInspectionInput(detailData.resource_scope)">
                  <dt>输入版本</dt>
                  <dd><RouterLink :to="savedVersion" class="studio-link">正式稿 v{{ detailData.resource_scope.document_version }}</RouterLink></dd>
                </template>
                <template v-if="isProbeScope(detailData.resource_scope)">
                  <dt>配置版本</dt>
                  <dd>{{ Object.keys(detailData.resource_scope.version_ids).length }} 个固定版本</dd>
                </template>
                <template v-if="isMaterialInput(detailData.resource_scope)">
                  <dt>资料来源</dt>
                  <dd>
                    <RouterLink class="studio-link" :to="materialsRoute(project.id, detailData.resource_scope.material_id)">查看资料与解析版本</RouterLink>
                  </dd>
                </template>
                <dt>创建时间</dt>
                <dd><time :datetime="detailData.created_at">{{ formatTime(detailData.created_at) }}</time></dd>
                <dt>最近更新</dt>
                <dd><time :datetime="detailData.updated_at">{{ formatTime(detailData.updated_at) }}</time></dd>
                <template v-if="detailData.source_job_id">
                  <dt>重试来源</dt>
                  <dd><RouterLink :to="jobRoute(project.id, detailData.source_job_id, source)" class="studio-link">查看原任务</RouterLink></dd>
                </template>
              </dl>
              <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                <p v-if="serviceJobFailure(detailData)" :key="`${detailData.id}:${detailData.status}`" class="job-detail__failure" role="alert">
                  {{ serviceJobFailure(detailData) }}
                </p>
              </Transition>

              <section v-if="artifactViews.length" class="job-artifacts" aria-label="产物与结果">
                <h3 class="tp-subheading">产物与结果</h3>
                <TransitionGroup name="tp-list" tag="div" class="job-artifacts__list tp-list-group" v-bind="listMotionHooks">
                  <article v-for="artifact in artifactViews" :key="artifact.id" class="job-artifact" :data-testid="artifact.testid">
                    <h4>{{ artifact.title }}</h4>
                    <dl class="job-artifact__facts">
                      <template v-for="fact in artifact.facts" :key="fact.label"
                        ><dt>{{ fact.label }}</dt>
                        <dd>{{ fact.value }}</dd></template
                      >
                    </dl>
                    <pre v-if="artifact.content" class="workspace-jobs__probe-output">{{ artifact.content }}</pre>
                  </article>
                </TransitionGroup>
              </section>

              <details class="job-snapshot">
                <summary>运行标识与配置快照</summary>
                <dl class="studio-facts job-facts">
                  <dt>任务标识</dt>
                  <dd class="tp-mono">{{ detailData.id }}</dd>
                  <template v-if="isProbeScope(detailData.resource_scope)">
                    <dt>所选配置版本</dt>
                    <dd class="tp-mono">{{ detailData.resource_scope.config_version_id }}</dd>
                    <template v-for="(id, versionKind) in detailData.resource_scope.version_ids" :key="versionKind">
                      <dt>{{ versionKind }} 版本</dt>
                      <dd class="tp-mono">{{ id }}</dd>
                    </template>
                  </template>
                  <template v-if="isMaterialInput(detailData.resource_scope)">
                    <dt>固定原件</dt>
                    <dd class="tp-mono">{{ detailData.resource_scope.original_version_id }}</dd>
                    <dt>原件摘要</dt>
                    <dd class="tp-mono">{{ detailData.resource_scope.original_sha256 }}</dd>
                  </template>
                  <template v-if="isInspectionConfiguration(detailData.configuration)">
                    <dt>统计文本字符</dt>
                    <dd>{{ detailData.configuration.include_text_statistics ? "开启" : "关闭" }}</dd>
                  </template>
                  <template v-if="probeConfiguration">
                    <dt>固定调用参数</dt>
                    <dd>
                      {{ probeConfiguration.model?.model_code ?? probeConfiguration.config_kind }} · {{ probeConfiguration.api?.timeout_seconds ?? "—" }} 秒超时
                    </dd>
                  </template>
                  <template v-if="detailData.error_code"
                    ><dt>错误代码</dt>
                    <dd class="tp-mono">{{ detailData.error_code }}</dd></template
                  >
                </dl>
                <details class="job-snapshot__nested">
                  <summary>查看固定输入</summary>
                  <pre>{{ fixedInput(detailData) }}</pre>
                </details>
                <details v-if="detailData.result" class="job-snapshot__nested">
                  <summary>查看原始结果</summary>
                  <pre>{{ printableConfiguration(detailData.result) }}</pre>
                </details>
              </details>

              <section class="job-attempt-section" aria-labelledby="job-attempts-title">
                <h3 id="job-attempts-title" class="tp-subheading">每次尝试</h3>
                <TransitionGroup name="tp-list" tag="ol" class="tp-list-group job-attempts" v-bind="listMotionHooks">
                  <li v-for="attempt in attempts" :key="attempt.id" class="job-attempt">
                    <div class="job-row__heading">
                      <b>第 {{ attempt.attempt }} 次</b>
                      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
                        ><TpStatus :key="attempt.status" size="sm" v-bind="attemptStatus[attempt.status]"
                      /></Transition>
                    </div>
                    <p class="tp-caption">
                      <time :datetime="attempt.started_at">{{ formatTime(attempt.started_at) }}</time>
                      <template v-if="attempt.finished_at"> → <time :datetime="attempt.finished_at">{{ formatTime(attempt.finished_at) }}</time></template>
                    </p>
                    <p class="job-attempt__diagnosis">{{ attemptDiagnosis(attempt) }}</p>
                    <details v-if="attempt.error_code" class="job-attempt__detail">
                      <summary>技术诊断</summary>
                      <span class="tp-mono">{{ attempt.error_code }}</span>
                    </details>
                  </li>
                  <li v-if="!attempts.length" key="no-attempts" class="tp-caption">尚未开始执行，排队期间可以取消。</li>
                </TransitionGroup>
              </section>
            </div>
            <p v-else-if="detailLoading" key="loading" class="jobs-loading" role="status">
              <span class="tp-btn__spinner" aria-hidden="true" />正在读取任务详情…
            </p>
            <p v-else-if="!selectedId" key="unselected" class="tp-caption job-unselected">选择任务查看输入、产物和逐次尝试。</p>
          </Transition>
          <Transition name="tp-swap" v-bind="panelMotionHooks">
            <TpState
              v-if="detailError && selectedId"
              :kind="detailMissing ? 'noresult' : 'error'"
              title="无法读取此任务"
              :desc="detailError"
              :retryable="!detailMissing"
              @retry="inspect(selectedId)"
            />
          </Transition>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.workspace-jobs {
  gap: 16px;
}
.jobs-project {
  margin-top: 4px;
  overflow-wrap: anywhere;
}
.workspace-jobs__controls {
  align-items: flex-end;
  gap: 8px 12px;
}
.workspace-jobs__controls :deep(.tp-field) {
  min-width: 148px;
}
.jobs-filter-count {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  margin-left: auto;
}
.jobs-notice {
  border-left-color: var(--tp-success);
}
.workspace-jobs__layout {
  display: grid;
  grid-template-columns: minmax(320px, 0.8fr) minmax(0, 1.2fr);
  gap: 16px;
  align-items: start;
}
.jobs-directory {
  overflow: hidden;
}
.jobs-directory__head,
.job-row__heading,
.job-detail__top,
.job-detail__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}
.jobs-directory__head {
  min-height: 48px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--tp-line);
}
.job-row__heading > *,
.job-detail__heading > * {
  min-width: 0;
}
.jobs-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.jobs-list__item {
  border-bottom: 1px solid var(--tp-line);
}
.jobs-list__item:last-child {
  border-bottom: 0;
}
.job-row {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 12px;
}
.job-row:hover {
  background: var(--tp-surface-sunken);
}
.job-row__heading .studio-text-button {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  overflow-wrap: anywhere;
}
.workspace-jobs__selected {
  background: var(--tp-accent-soft);
  box-shadow: inset 3px 0 var(--tp-accent);
}
.workspace-jobs__selected:hover {
  background: var(--tp-accent-soft);
}
.job-row__meta {
  overflow-wrap: anywhere;
}
.job-row__failure,
.job-detail__failure {
  margin: 0;
  color: var(--tp-danger-content);
  font-size: 13px;
}
.job-row__next {
  margin: 0;
  color: var(--tp-text-muted);
  font-size: 12px;
  line-height: 1.55;
}
.job-row__actions {
  gap: 4px 12px;
}
.job-row__actions .studio-link,
.job-detail__actions .studio-link {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
}
.jobs-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: var(--tp-text-muted);
  font-size: 13px;
}
.jobs-pagination {
  justify-content: center;
  padding: 10px 12px;
  border-top: 1px solid var(--tp-line);
}
.workspace-jobs__detail {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 16px;
  outline: none;
}
.workspace-jobs__detail:focus-visible {
  outline: 2px solid var(--tp-focus);
  outline-offset: 2px;
}
.job-detail {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.job-detail__heading {
  align-items: flex-start;
}
.job-detail__heading h3 {
  overflow-wrap: anywhere;
}
.job-detail__next {
  margin: 0;
  padding: 8px 12px;
  border-left: 2px solid var(--tp-info);
  background: var(--tp-surface-sunken);
  font-size: 13px;
}
.job-detail__next[data-status="failed"] {
  border-left-color: var(--tp-danger);
}
.job-detail__next[data-status="cancelled"] {
  border-left-color: var(--tp-ghost-line);
}
.job-detail__next[data-status="succeeded"] {
  border-left-color: var(--tp-success);
}
.job-detail__actions {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--tp-line);
}
.job-facts {
  grid-template-columns: 96px minmax(0, 1fr);
  margin: 0;
}
.workspace-jobs__detail :deep(dd) {
  margin: 0;
  overflow-wrap: anywhere;
}
.job-artifacts,
.job-artifacts__list {
  display: grid;
  gap: 12px;
}
.job-artifact {
  padding-top: 12px;
  border-top: 1px solid var(--tp-line);
}
.job-artifact h4 {
  margin: 0 0 8px;
  font-size: 14px;
}
.job-artifact__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
  margin: 0;
}
.job-artifact__facts > * {
  min-width: 0;
}
.job-artifact__facts dt {
  color: var(--tp-text-muted);
  font-size: 12px;
}
.job-artifact__facts dd {
  font-size: 13px;
}
.workspace-jobs__probe-output {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 320px;
  overflow-y: auto;
  margin: 12px 0 0;
  padding: 12px;
  background: var(--tp-surface-sunken);
  border-radius: var(--tp-radius-s);
  font-family: var(--tp-font-body);
  font-size: 13px;
  line-height: 1.7;
}
.job-snapshot {
  font-size: 13px;
}
.job-snapshot summary,
.job-attempt__detail summary {
  min-height: 28px;
  cursor: pointer;
  font-weight: 600;
}
.job-snapshot__nested {
  margin-top: 8px;
}
.job-snapshot pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 260px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.65;
  padding: 12px;
  margin: 8px 0 0;
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
}
.job-attempt-section {
  display: grid;
  gap: 8px;
}
.job-attempts {
  display: grid;
  gap: 0;
  list-style: none;
  padding: 0;
  margin: 0;
}
.job-attempt {
  display: grid;
  gap: 6px;
  padding-block: 12px;
  border-top: 1px solid var(--tp-line);
}
.job-attempt__diagnosis {
  margin: 0;
  font-size: 13px;
}
.job-attempt__detail {
  color: var(--tp-text-muted);
  font-size: 12px;
}
.job-unselected {
  margin: 0;
}
@media (max-width: 1100px) {
  .workspace-jobs__layout {
    grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.1fr);
  }
}
@media (max-width: 850px) {
  .workspace-jobs__layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .workspace-jobs__layout--selected .workspace-jobs__detail {
    grid-row: 1;
  }
}
@media (max-width: 600px) {
  .workspace-jobs__controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: end;
  }
  .workspace-jobs__controls :deep(.tp-field) {
    min-width: 0;
  }
  .jobs-filter-count {
    margin-left: 0;
  }
  .job-artifact__facts {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
  .job-artifact__facts dt {
    margin-top: 6px;
  }
  .workspace-jobs__detail {
    padding: 14px;
  }
  .job-detail__heading {
    flex-wrap: wrap;
  }
}
</style>
