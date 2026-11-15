<script setup lang="ts">
import { computed, useId, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import type { JobRead } from "@/services";
import {
  canRerunServiceJob,
  diagnosticJobTitle,
  isActiveServiceJob,
  serviceJobFailure,
  serviceJobStatus,
  type ServiceJobsState,
} from "../../state/serviceJobs";
import { panelMotionHooks } from "./motion";

const props = defineProps<{ state: ServiceJobsState }>();
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
  pendingCreation,
  detail,
  detailLoading,
  detailError,
  refresh,
  inspect,
  createDiagnostic,
  cancel,
} = props.state;
const route = useRoute();
const router = useRouter();
const detailsPanel = useId();
const selectedId = computed(() =>
  route.path === "/screens/jobs" && route.query.source === "service" && typeof route.query.job === "string" ? route.query.job : "",
);
const resultMessage = computed(() => (detail.value?.status === "succeeded" && detail.value.result?.kind === "diagnostic" ? detail.value.result.message : ""));
const isStarting = computed(() => action.value?.type === "create" && !action.value.fromId);
const formatTime = (value: string) => new Date(value).toLocaleString("zh-CN");
watch([projectId, selectedId], ([, id]) => void inspect(id), { immediate: true });
function openDetails(job: JobRead) {
  if (selectedId.value === job.id) void inspect(job.id);
  else void router.replace({ query: { ...route.query, source: "service", job: job.id } });
}
</script>

<template>
  <div class="studio-stack" data-testid="service-jobs">
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <section v-if="!projectId" key="unbound" class="screen-panel">
        <TpState kind="empty" title="先打开一个已关联的项目" desc="从项目目录打开项目后，即可查看服务任务。">
          <RouterLink class="tp-btn tp-btn--primary" to="/screens/projects">前往项目目录</RouterLink>
        </TpState>
      </section>
      <section v-else :key="projectId" class="studio-stack">
        <div class="screen-actions">
          <TpButton variant="primary" :loading="isStarting" :disabled="!!action" @click="createDiagnostic()">{{
            pendingCreation && !action ? "确认上次运行请求" : "运行诊断"
          }}</TpButton>
          <TpButton variant="ghost" :loading="loading" :disabled="loading" @click="refresh()">刷新任务</TpButton>
        </div>
        <Transition name="tp-swap" v-bind="panelMotionHooks">
          <p v-if="pendingCreation && !action" class="studio-notice">上一次运行请求尚未确认，可以继续确认同一次请求。</p>
        </Transition>
        <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
          <p v-if="notice" :key="notice" role="status" class="studio-notice">{{ notice }}</p>
        </Transition>
        <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
          <p v-if="actionError" :key="actionError" role="alert" class="studio-notice">{{ actionError }}</p>
        </Transition>
        <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
          <TpState v-if="loadError" :key="loadError" kind="error" title="任务状态暂时无法读取" :desc="loadError" retryable @retry="refresh()" />
        </Transition>
        <p v-if="loading && !directory.length" class="tp-caption" role="status">正在读取任务…</p>
        <div class="studio-grid service-jobs-layout">
          <TransitionGroup name="tp-list" tag="section" v-bind="listMotionHooks" class="tp-list-group screen-panel" aria-label="服务任务">
            <article
              v-for="job in directory"
              :key="'service:' + job.id"
              class="studio-body studio-history-row"
              :class="{ 'service-job-selected': selectedId === job.id }"
              data-testid="service-job-row"
            >
              <div class="studio-row">
                <h2 class="tp-subheading">{{ diagnosticJobTitle }}</h2>
                <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                  <TpStatus :key="job.status" v-bind="serviceJobStatus(job)" />
                </Transition>
              </div>
              <p class="tp-caption mt-2">{{ formatTime(job.created_at) }}<span v-if="serviceJobFailure(job)"> · {{ serviceJobFailure(job) }}</span></p>
              <div class="screen-actions mt-3">
                <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                  <TpButton
                    v-if="isActiveServiceJob(job)"
                    key="cancel"
                    size="sm"
                    :loading="action?.type === 'cancel' && action.id === job.id"
                    :disabled="!!action"
                    @click="cancel(job)"
                  >
                    取消任务
                  </TpButton>
                  <TpButton
                    v-else-if="canRerunServiceJob(job)"
                    key="rerun"
                    size="sm"
                    :loading="action?.type === 'create' && action.fromId === job.id"
                    :disabled="!!action || pendingCreation"
                    @click="createDiagnostic(job)"
                  >
                    重新运行
                  </TpButton>
                </Transition>
                <TpButton size="sm" variant="ghost" :aria-controls="detailsPanel" :aria-expanded="selectedId === job.id" @click="openDetails(job)"
                  >查看详情</TpButton
                >
              </div>
            </article>
            <div v-if="!loading && !loadError && !directory.length" key="empty-jobs" class="studio-empty">
              <h2 class="tp-subheading">还没有诊断记录</h2>
            </div>
          </TransitionGroup>
          <aside :id="detailsPanel" class="screen-panel studio-body studio-stack">
            <h2 class="tp-subheading">任务详情</h2>
            <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
              <div v-if="detail && selectedId" :key="detail.id" class="studio-stack">
                <dl class="studio-facts service-facts">
                  <dt>创建时间</dt>
                  <dd>{{ formatTime(detail.created_at) }}</dd>
                  <dt>最近更新</dt>
                  <dd>{{ formatTime(detail.updated_at) }}</dd>
                  <dt>执行次数</dt>
                  <dd>{{ detail.attempt }}</dd>
                </dl>
                <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                  <p :key="detail.status" class="studio-copy">{{ resultMessage || serviceJobFailure(detail) || serviceJobStatus(detail).label }}</p>
                </Transition>
                <details class="tp-disclosure">
                  <summary>运行标识与诊断</summary>
                  <dl class="studio-facts service-facts">
                    <dt>任务标识</dt>
                    <dd class="tp-mono">{{ detail.id }}</dd>
                    <dt>项目标识</dt>
                    <dd class="tp-mono">{{ detail.project_id }}</dd>
                    <template v-if="detail.error_code">
                      <dt>诊断代码</dt>
                      <dd class="tp-mono">{{ detail.error_code }}</dd>
                    </template>
                  </dl>
                </details>
              </div>
              <p v-else-if="detailLoading" key="loading" class="tp-caption" role="status">正在读取任务详情…</p>
              <p v-else-if="!detailError" key="no-selection" class="tp-caption">选择一项任务查看结果和运行记录。</p>
            </Transition>
            <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
              <TpState
                v-if="detailError"
                :key="detailError"
                kind="error"
                title="任务详情暂时无法读取"
                :desc="detailError"
                retryable
                @retry="inspect(selectedId)"
              />
            </Transition>
          </aside>
        </div>
        <nav v-if="total > listLimit" class="screen-actions" aria-label="任务分页">
          <TpButton :disabled="loading || offset === 0" @click="refresh(Math.max(0, offset - listLimit))">上一页</TpButton>
          <span class="tp-caption">第 {{ Math.floor(offset / listLimit) + 1 }} 页，共 {{ total }} 项</span>
          <TpButton :disabled="loading || offset + listLimit >= total" @click="refresh(offset + listLimit)">下一页</TpButton>
        </nav>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.service-jobs-layout {
  align-items: start;
}
.service-job-selected {
  background: var(--tp-surface-sunken);
  box-shadow: inset 3px 0 var(--tp-accent);
}
.service-facts dd {
  overflow-wrap: anywhere;
}
</style>
