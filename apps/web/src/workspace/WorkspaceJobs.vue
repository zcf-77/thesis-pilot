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
import { attemptDiagnosis, attemptStatus, fixedInput, kindOptions, useKindFilteredJobs, type JobKind } from "./jobs/jobPresentation";
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
/** The listing (and its actions) comes from the kind-scoped state while a kind is chosen; details always use the shared state. */
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
const inspectionArtifacts = computed(
  () =>
    detailData.value?.artifacts.flatMap((artifact) => (artifact.result.kind === "document_inspection" ? [{ id: artifact.id, result: artifact.result }] : [])) ??
    [],
);
const probeArtifacts = computed(
  () =>
    detailData.value?.artifacts.flatMap((artifact) => (artifact.result.kind === "configuration_probe" ? [{ id: artifact.id, result: artifact.result }] : [])) ??
    [],
);
const probeConfiguration = computed(() => (isProbeConfiguration(detailData.value?.configuration) ? detailData.value.configuration : undefined));
const materialArtifacts = computed(
  () =>
    detailData.value?.artifacts.flatMap((artifact) => (artifact.result.kind === "material_parse" ? [{ id: artifact.id, result: artifact.result }] : [])) ?? [],
);
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
      <h1 class="tp-display">执行任务</h1>
      <Transition name="tp-swap" mode="out-in">
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
        <TpField v-slot="{ id }" label="按状态筛选">
          <TpSelect :id="id" :model-value="filter" :options="statuses" @update:model-value="changeStatus" />
        </TpField>
        <TpField v-if="workspaceId" v-slot="{ id }" label="按类型筛选">
          <TpSelect :id="id" :model-value="kind" :options="kindOptions" @update:model-value="changeKind" />
        </TpField>
        <TpButton variant="ghost" :loading="loading" :disabled="loading" @click="list.refresh()">刷新任务</TpButton>
      </div>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <p v-if="actionError" :key="actionError" class="studio-notice" role="alert">{{ actionError }}</p>
        <p v-else-if="notice" :key="notice" class="studio-notice" role="status">{{ notice }}</p>
      </Transition>
      <Transition name="tp-swap" v-bind="panelMotionHooks">
        <TpState v-if="loadError" kind="error" title="任务状态暂时无法读取" :desc="loadError" retryable @retry="list.refresh()" />
      </Transition>
      <div class="studio-grid workspace-jobs__layout" :class="{ 'workspace-jobs__layout--selected': selectedId }">
        <div class="studio-stack">
          <TransitionGroup name="tp-list" tag="section" class="screen-panel tp-list-group" aria-label="项目任务" v-bind="listMotionHooks">
            <article
              v-for="job in directory"
              :key="job.id"
              class="studio-body studio-history-row"
              :class="{ 'workspace-jobs__selected': selectedId === job.id }"
              data-testid="workspace-job-row"
            >
              <div class="studio-row">
                <RouterLink class="studio-text-button tp-subheading" :to="links(job)" :aria-current="selectedId === job.id ? 'location' : undefined">{{
                  serviceJobTitle(job)
                }}</RouterLink>
                <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                  <TpStatus :key="job.status" v-bind="serviceJobStatus(job)" />
                </Transition>
              </div>
              <p class="tp-caption mt-2">
                <span v-if="isInspectionInput(job.resource_scope)">正式稿 v{{ job.resource_scope.document_version }} · </span>
                <span v-else-if="isProbeScope(job.resource_scope)">固定配置版本 · </span>
                <span v-else-if="isMaterialInput(job.resource_scope)">固定原件解析 · </span>
                <time :datetime="job.created_at">{{ formatTime(job.created_at) }}</time>
                <span v-if="job.attempt > 1"> · 第 {{ job.attempt }} 次尝试</span>
              </p>
              <p v-if="serviceJobFailure(job)" class="studio-copy">{{ serviceJobFailure(job) }}</p>
              <div class="screen-actions mt-3">
                <RouterLink v-if="assistantJobLink(job)" class="studio-link" :to="assistantJobLink(job)!">返回助手会话 ↗</RouterLink>
                <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                  <TpButton
                    v-if="isActiveServiceJob(job)"
                    key="cancel"
                    size="sm"
                    :loading="action?.type === 'cancel' && action.id === job.id"
                    :disabled="!!action"
                    @click="list.cancel(job)"
                    >取消任务</TpButton
                  >
                  <TpButton
                    v-else-if="canRerunServiceJob(job)"
                    key="retry"
                    size="sm"
                    :loading="action?.type === 'retry' && action.id === job.id"
                    :disabled="!!action"
                    @click="list.retry(job)"
                    >重试任务</TpButton
                  >
                </Transition>
              </div>
            </article>
            <p v-if="loading && !directory.length" key="loading" class="studio-body tp-caption" role="status">正在读取任务…</p>
            <TpState
              v-else-if="!loadError && !directory.length"
              key="empty"
              :kind="filtered ? 'noresult' : 'empty'"
              :title="filtered ? '没有符合条件的任务' : '还没有执行记录'"
              :desc="filtered ? undefined : '资料解析、正文检查、配置试跑与内容修订的执行记录会保留在这里。'"
            >
              <TpButton v-if="filtered" size="sm" @click="showAll">显示全部</TpButton>
              <RouterLink v-else class="tp-btn tp-btn--outline tp-btn--sm" :to="writingRoute(project.id)">打开写作台</RouterLink>
            </TpState>
          </TransitionGroup>
          <nav v-if="total > listLimit" class="screen-actions" aria-label="任务分页">
            <TpButton :disabled="loading || offset === 0" @click="list.refresh(offset - listLimit)">上一页</TpButton>
            <span class="tp-caption">第 {{ Math.floor(offset / listLimit) + 1 }} 页，共 {{ total }} 项</span>
            <TpButton :disabled="loading || offset + listLimit >= total" @click="list.refresh(offset + listLimit)">下一页</TpButton>
          </nav>
        </div>
        <aside ref="detailPanel" class="screen-panel studio-body studio-stack workspace-jobs__detail" tabindex="-1" aria-label="输入与诊断">
          <div class="studio-row">
            <h2 class="tp-subheading">输入与诊断</h2>
            <RouterLink v-if="selectedId" class="studio-link" :to="projectJobsRoute(project.id)">收起详情</RouterLink>
          </div>
          <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
            <div v-if="detailData" :key="detailData.id" class="studio-stack">
              <div class="studio-row">
                <h3 class="tp-subheading">{{ serviceJobTitle(detailData) }}</h3>
                <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                  <TpStatus :key="detailData.status" v-bind="serviceJobStatus(detailData)" />
                </Transition>
              </div>
              <dl class="studio-facts">
                <template v-if="savedVersion && isInspectionInput(detailData.resource_scope)">
                  <dt>输入版本</dt>
                  <dd><RouterLink :to="savedVersion" class="studio-link">正式稿 v{{ detailData.resource_scope.document_version }}</RouterLink></dd>
                </template>
                <template v-if="isProbeScope(detailData.resource_scope)">
                  <dt>配置来源</dt>
                  <dd class="tp-mono">{{ detailData.resource_scope.config_version_id }}</dd>
                  <template v-for="(id, versionKind) in detailData.resource_scope.version_ids" :key="versionKind"
                    ><dt>{{ versionKind }} 版本</dt>
                    <dd class="tp-mono">{{ id }}</dd></template
                  >
                </template>
                <template v-if="isMaterialInput(detailData.resource_scope)"
                  ><dt>资料来源</dt>
                  <dd><RouterLink class="studio-link" :to="materialsRoute(project.id)">查看资料与解析版本</RouterLink></dd>
                  <dt>固定原件</dt>
                  <dd class="tp-mono">{{ detailData.resource_scope.original_version_id }}</dd>
                  <dt>原件摘要</dt>
                  <dd class="tp-mono">{{ detailData.resource_scope.original_sha256 }}</dd></template
                >
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
                <p v-if="serviceJobFailure(detailData)" :key="detailData.status" class="studio-copy">{{ serviceJobFailure(detailData) }}</p>
              </Transition>
              <RouterLink v-if="assistantJobLink(detailData)" class="studio-link" :to="assistantJobLink(detailData)!">返回助手会话查看运行与候选 ↗</RouterLink>
              <Transition name="tp-swap" v-bind="panelMotionHooks">
                <div v-if="inspectionArtifacts.length" class="studio-stack">
                  <h3 class="tp-subheading">结构统计</h3>
                  <dl v-for="artifact in inspectionArtifacts" :key="artifact.id" class="studio-facts" data-testid="inspection-result">
                    <dt>节点</dt>
                    <dd>{{ artifact.result.node_count }}</dd>
                    <dt>段落</dt>
                    <dd>{{ artifact.result.paragraph_count }}</dd>
                    <dt>标题</dt>
                    <dd>{{ artifact.result.heading_count }}</dd>
                    <dt>表格</dt>
                    <dd>{{ artifact.result.table_count }}</dd>
                    <template v-if="artifact.result.text_characters !== null">
                      <dt>文本字符</dt>
                      <dd>{{ artifact.result.text_characters }}</dd>
                    </template>
                  </dl>
                </div>
              </Transition>
              <Transition name="tp-swap" v-bind="panelMotionHooks">
                <div v-if="probeArtifacts.length" class="studio-stack" aria-label="配置试跑结果">
                  <article v-for="artifact in probeArtifacts" :key="artifact.id" class="studio-stack" data-testid="configuration-probe-result">
                    <h3 class="tp-subheading">{{ artifact.result.model_used ? "真实模型试跑结果" : "配置检查与渲染结果" }}</h3>
                    <dl class="studio-facts">
                      <dt>配置类型</dt>
                      <dd>{{ artifact.result.config_kind }}</dd>
                      <dt>请求模型</dt>
                      <dd>{{ artifact.result.requested_model ?? "未请求模型" }}</dd>
                      <dt>响应模型</dt>
                      <dd>{{ artifact.result.response_model ?? "未调用或未返回模型" }}</dd>
                      <dt>写入正式内容</dt>
                      <dd>未写入</dd>
                    </dl>
                    <pre class="workspace-jobs__probe-output">{{ artifact.result.content }}</pre>
                  </article>
                </div>
              </Transition>
              <Transition name="tp-swap" v-bind="panelMotionHooks"
                ><section v-if="materialArtifacts.length" class="studio-stack" aria-label="资料解析结果">
                  <dl v-for="artifact in materialArtifacts" :key="artifact.id" class="studio-facts" data-testid="material-parse-result">
                    <dt>解析版本</dt>
                    <dd class="tp-mono">{{ artifact.result.parse_version_id }}</dd>
                    <dt>来源锚点</dt>
                    <dd>{{ artifact.result.anchor_count }}</dd>
                    <dt>文本字符</dt>
                    <dd>{{ artifact.result.text_characters }}</dd>
                    <dt>模型调用与正式稿写入</dt>
                    <dd>未调用模型，未写入正式稿</dd>
                  </dl>
                  <RouterLink class="studio-link" :to="materialsRoute(project.id)">查看解析文本与来源 ↗</RouterLink>
                </section></Transition
              >
              <details class="job-snapshot">
                <summary>运行标识与配置快照</summary>
                <dl class="studio-facts mt-3">
                  <dt>任务标识</dt>
                  <dd class="tp-mono">{{ detailData.id }}</dd>
                  <template v-if="isInspectionConfiguration(detailData.configuration)">
                    <dt>统计文本字符</dt>
                    <dd>{{ detailData.configuration.include_text_statistics ? "开启" : "关闭" }}</dd>
                  </template>
                  <template v-if="probeConfiguration"
                    ><dt>固定调用参数</dt>
                    <dd>
                      {{ probeConfiguration.model?.model_code ?? probeConfiguration.config_kind }} · {{ probeConfiguration.api?.timeout_seconds ?? "—" }} 秒超时
                    </dd></template
                  >
                  <template v-if="detailData.error_code">
                    <dt>错误代码</dt>
                    <dd class="tp-mono">{{ detailData.error_code }}</dd>
                  </template>
                </dl>
              </details>
              <h3 class="tp-subheading">每次尝试</h3>
              <TransitionGroup name="tp-list" tag="ol" class="tp-list-group job-attempts" v-bind="listMotionHooks">
                <li v-for="attempt in attempts" :key="attempt.id" class="studio-history-row">
                  <div class="studio-row">
                    <b>第 {{ attempt.attempt }} 次</b>
                    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                      <TpStatus :key="attempt.status" size="sm" v-bind="attemptStatus[attempt.status]" />
                    </Transition>
                  </div>
                  <p class="tp-caption mt-2">
                    <time :datetime="attempt.started_at">{{ formatTime(attempt.started_at) }}</time>
                    <template v-if="attempt.finished_at"> → <time :datetime="attempt.finished_at">{{ formatTime(attempt.finished_at) }}</time></template>
                  </p>
                  <p class="studio-copy">{{ attemptDiagnosis(attempt) }}</p>
                  <p v-if="attempt.error_code" class="tp-caption tp-mono">{{ attempt.error_code }}</p>
                  <details class="job-snapshot mt-2">
                    <summary>查看此次固定输入</summary>
                    <pre>{{ fixedInput(detailData) }}</pre>
                  </details>
                </li>
                <li v-if="!attempts.length" key="no-attempts" class="tp-caption">尚未开始执行，排队期间可以取消。</li>
              </TransitionGroup>
            </div>
            <p v-else-if="detailLoading" key="loading" class="tp-caption" role="status">正在读取任务详情…</p>
            <p v-else-if="!selectedId" key="unselected" class="tp-caption">选择一个任务查看输入和历史。取消不会删除原件，也不会改动已经采纳的内容。</p>
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
.workspace-jobs__controls {
  align-items: end;
}
.workspace-jobs__layout {
  align-items: start;
}
.workspace-jobs__selected {
  background: var(--tp-surface-sunken);
  box-shadow: inset 3px 0 var(--tp-accent);
}
.workspace-jobs__detail :deep(dd) {
  overflow-wrap: anywhere;
}
.workspace-jobs__probe-output {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
  font: inherit;
}
.job-attempts {
  list-style: none;
  padding: 0;
  margin: 0;
}
.job-attempts > li {
  padding-top: 16px;
}
.job-attempts > li:first-child {
  padding-top: 0;
}
.job-snapshot {
  font-size: 13px;
}
.job-snapshot pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 260px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.65;
  padding: 12px;
  margin-top: 8px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  background: var(--tp-canvas);
}
@media (max-width: 800px) {
  .workspace-jobs__layout--selected .workspace-jobs__detail {
    grid-row: 1;
  }
}
</style>
