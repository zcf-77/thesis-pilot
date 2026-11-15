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
import { canRerunServiceJob, isActiveServiceJob, serviceJobFailure, serviceJobStatus, serviceJobTitle, type ServiceJobsState } from "@/lab/state/serviceJobs";
import type { JobDetail, JobRead, ProjectRead } from "@/services";
import { jobRoute, projectJobsRoute, projectsRoute, versionRoute, writingRoute } from "./workspaceRoutes";

const props = defineProps<{ project?: ProjectRead; source: string; selectedId?: string; state: ServiceJobsState }>();
const {
  projectId,
  directory,
  listLimit,
  total,
  offset,
  loading,
  loadError,
  action,
  actionError,
  notice,
  filter,
  detailData,
  detailLoading,
  detailError,
  detailMissing,
} = props.state;
const { refresh, inspect, changeFilter, cancel, retry } = props.state;
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
const attemptStatus: Record<JobDetail["attempts"][number]["status"], string> = {
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  lease_expired: "执行中断",
};
const links = (job: JobRead) => jobRoute(job.project_id, job.id, props.source);
const savedVersion = computed(() => {
  const job = detailData.value;
  const scope = job?.resource_scope;
  return job && scope
    ? versionRoute({ source: props.source, projectId: job.project_id, documentId: scope.document_id, version: scope.document_version })
    : undefined;
});

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
    </header>
    <TpState v-if="!project" class="screen-panel" kind="empty" title="请选择论文项目">
      <RouterLink class="tp-btn tp-btn--outline tp-btn--sm" :to="projectsRoute">打开项目目录</RouterLink>
    </TpState>
    <template v-else>
      <div class="screen-actions workspace-jobs__controls">
        <TpField v-slot="{ id }" label="按状态筛选">
          <TpSelect :id="id" :model-value="filter" :options="statuses" @update:model-value="changeFilter" />
        </TpField>
        <TpButton variant="ghost" :loading="loading" :disabled="loading" @click="refresh()">刷新任务</TpButton>
      </div>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <p v-if="actionError" :key="actionError" class="studio-notice" role="alert">{{ actionError }}</p>
        <p v-else-if="notice" :key="notice" class="studio-notice" role="status">{{ notice }}</p>
      </Transition>
      <Transition name="tp-swap" v-bind="panelMotionHooks">
        <TpState v-if="loadError" kind="error" title="任务状态暂时无法读取" :desc="loadError" retryable @retry="refresh()" />
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
                <h2 class="tp-subheading">{{ serviceJobTitle(job) }}</h2>
                <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                  <TpStatus :key="job.status" v-bind="serviceJobStatus(job)" />
                </Transition>
              </div>
              <p class="tp-caption mt-2">
                <span v-if="job.resource_scope">正式稿 v{{ job.resource_scope.document_version }} · </span>
                <time :datetime="job.created_at">{{ formatTime(job.created_at) }}</time>
                <span v-if="serviceJobFailure(job)"> · {{ serviceJobFailure(job) }}</span>
              </p>
              <div class="screen-actions mt-3">
                <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                  <TpButton
                    v-if="isActiveServiceJob(job)"
                    key="cancel"
                    size="sm"
                    :loading="action?.type === 'cancel' && action.id === job.id"
                    :disabled="!!action"
                    @click="cancel(job)"
                    >取消任务</TpButton
                  >
                  <TpButton
                    v-else-if="canRerunServiceJob(job)"
                    key="retry"
                    size="sm"
                    :loading="action?.type === 'retry' && action.id === job.id"
                    :disabled="!!action"
                    @click="retry(job)"
                    >重试任务</TpButton
                  >
                </Transition>
                <RouterLink class="studio-link" :to="links(job)" :aria-current="selectedId === job.id ? 'location' : undefined">查看详情</RouterLink>
              </div>
            </article>
            <p v-if="loading && !directory.length" key="loading" class="studio-body tp-caption" role="status">正在读取任务…</p>
            <TpState
              v-else-if="!loadError && !directory.length"
              key="empty"
              :kind="filter === 'all' ? 'empty' : 'noresult'"
              :title="filter === 'all' ? '还没有执行记录' : '没有符合条件的任务'"
            >
              <RouterLink v-if="filter === 'all'" class="tp-btn tp-btn--outline tp-btn--sm" :to="writingRoute(project.id)">打开写作台</RouterLink>
              <TpButton v-else size="sm" @click="changeFilter('all')">显示全部</TpButton>
            </TpState>
          </TransitionGroup>
          <nav v-if="total > listLimit" class="screen-actions" aria-label="任务分页">
            <TpButton :disabled="loading || offset === 0" @click="refresh(offset - listLimit)">上一页</TpButton>
            <span class="tp-caption">第 {{ Math.floor(offset / listLimit) + 1 }} 页，共 {{ total }} 项</span>
            <TpButton :disabled="loading || offset + listLimit >= total" @click="refresh(offset + listLimit)">下一页</TpButton>
          </nav>
        </div>
        <aside ref="detailPanel" class="screen-panel studio-body studio-stack workspace-jobs__detail" tabindex="-1" aria-label="任务详情">
          <div class="studio-row">
            <h2 class="tp-subheading">任务详情</h2>
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
                <template v-if="savedVersion && detailData.resource_scope">
                  <dt>输入版本</dt>
                  <dd><RouterLink :to="savedVersion" class="studio-link">正式稿 v{{ detailData.resource_scope.document_version }}</RouterLink></dd>
                </template>
                <dt>创建时间</dt>
                <dd><time :datetime="detailData.created_at">{{ formatTime(detailData.created_at) }}</time></dd>
                <template v-if="detailData.source_job_id">
                  <dt>重试来源</dt>
                  <dd><RouterLink :to="jobRoute(project.id, detailData.source_job_id, source)" class="studio-link">查看原任务</RouterLink></dd>
                </template>
              </dl>
              <p v-if="serviceJobFailure(detailData)" class="studio-copy">{{ serviceJobFailure(detailData) }}</p>
              <Transition name="tp-swap" v-bind="panelMotionHooks">
                <div v-if="detailData.artifacts.length" class="studio-stack">
                  <h3 class="tp-subheading">结构统计</h3>
                  <dl v-for="artifact in detailData.artifacts" :key="artifact.id" class="studio-facts" data-testid="inspection-result">
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
              <details class="tp-disclosure">
                <summary>执行记录</summary>
                <dl class="studio-facts">
                  <dt>任务标识</dt>
                  <dd class="tp-mono">{{ detailData.id }}</dd>
                  <template v-if="detailData.configuration">
                    <dt>统计文本字符</dt>
                    <dd>{{ detailData.configuration.include_text_statistics ? "开启" : "关闭" }}</dd>
                  </template>
                  <template v-if="detailData.error_code">
                    <dt>错误代码</dt>
                    <dd class="tp-mono">{{ detailData.error_code }}</dd>
                  </template>
                </dl>
                <TransitionGroup name="tp-list" tag="ol" class="tp-list-group job-attempts" v-bind="listMotionHooks">
                  <li v-for="attempt in detailData.attempts" :key="attempt.id" class="studio-history-row">
                    <div class="studio-row">
                      <b>第 {{ attempt.attempt }} 次</b>
                      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                        <span :key="attempt.status">{{ attemptStatus[attempt.status] }}</span>
                      </Transition>
                    </div>
                    <p class="tp-caption"><time :datetime="attempt.started_at">{{ formatTime(attempt.started_at) }}</time></p>
                    <p v-if="attempt.error_code" class="tp-caption tp-mono">{{ attempt.error_code }}</p>
                  </li>
                  <li v-if="!detailData.attempts.length" key="no-attempts" class="tp-caption">尚未开始执行</li>
                </TransitionGroup>
              </details>
            </div>
            <p v-else-if="detailLoading" key="loading" class="tp-caption" role="status">正在读取任务详情…</p>
            <p v-else-if="!selectedId" key="unselected" class="tp-caption">选择一项任务查看详情。</p>
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
.workspace-jobs__detail dd {
  overflow-wrap: anywhere;
}
@media (max-width: 800px) {
  .workspace-jobs__layout--selected .workspace-jobs__detail {
    grid-row: 1;
  }
}
</style>
