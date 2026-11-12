<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import { ApiError, type BackendServices, type JobRead } from "@/services";
import { usePreviewWorkspaceStore } from "../../state/previewWorkspace";
import { panelMotionHooks } from "./motion";
import { beginDiagnosticRequest, confirmDiagnosticRequest, pendingDiagnosticKey } from "./jobsRequests";

const props = defineProps<{ services: BackendServices; sourceLabel: string }>();
const workspace = usePreviewWorkspaceStore();
const binding = computed(() => {
  const current = workspace.current.remoteBinding;
  return current?.sourceKey === props.services.sourceKey ? current : undefined;
});
const jobs = ref<JobRead[]>([]);
const total = ref(0);
const offset = ref(0);
const limit = 12;
const loading = ref(false);
const creating = ref(false);
const cancelling = ref("");
const detailLoading = ref(false);
const detail = ref<JobRead | null>(null);
const error = ref("");
const actionError = ref("");
const notice = ref("");
const directoryLoaded = ref(false);
const pendingCreation = ref(false);
const labels: Record<JobRead["status"], string> = { queued: "排队中", running: "执行中", succeeded: "已完成", failed: "失败", cancelled: "已取消" };
const isActive = (job: JobRead) => job.status === "queued" || job.status === "running";
const activeCount = computed(() => jobs.value.filter(isActive).length);
const resultMessage = computed(() => (typeof detail.value?.result?.message === "string" ? detail.value.result.message : ""));
let alive = true;
let context = 0;
let listSequence = 0;
let detailSequence = 0;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let listRequest: AbortController | undefined;
let detailRequest: AbortController | undefined;
let createRequest: AbortController | undefined;
let cancelRequest: AbortController | undefined;

function message(cause: unknown) {
  return cause instanceof ApiError ? cause.message : "任务服务暂时不可用，请稍后重试。";
}
function cancelled(cause: unknown) {
  return cause instanceof ApiError && cause.code === "REQUEST_CANCELLED";
}
function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN");
}
function tone(job: JobRead) {
  return job.status === "failed" ? "danger" : job.status === "succeeded" ? "success" : isActive(job) ? "info" : "ghost";
}
function mergeJob(job: JobRead) {
  const index = jobs.value.findIndex((item) => item.id === job.id);
  if (index >= 0 && Date.parse(jobs.value[index]!.updated_at) <= Date.parse(job.updated_at)) jobs.value[index] = job;
  if (detail.value?.id === job.id && Date.parse(detail.value.updated_at) <= Date.parse(job.updated_at)) detail.value = job;
}
function schedulePoll(captured: number, delay = 1500) {
  clearTimeout(pollTimer);
  if (alive && captured === context && binding.value && (jobs.value.some(isActive) || (detail.value && isActive(detail.value))))
    pollTimer = setTimeout(() => void load(offset.value, true), delay);
}
async function load(nextOffset = offset.value, background = false) {
  const projectId = binding.value?.projectId;
  if (!projectId) return;
  const captured = context;
  const sequence = ++listSequence;
  clearTimeout(pollTimer);
  listRequest?.abort();
  const request = (listRequest = new AbortController());
  if (!background) loading.value = true;
  error.value = "";
  let failed = false;
  try {
    const page = await props.services.jobs.list({ project_id: projectId, limit, offset: nextOffset }, request.signal);
    if (!alive || captured !== context || sequence !== listSequence) return;
    jobs.value = page.items;
    total.value = page.total;
    offset.value = page.offset;
    directoryLoaded.value = true;
    if (detail.value) {
      const current = page.items.find((item) => item.id === detail.value?.id);
      if (current) mergeJob(current);
      else if (isActive(detail.value)) {
        const requestedId = detail.value.id;
        const requestedDetailSequence = detailSequence;
        const latest = await props.services.jobs.get(requestedId, request.signal);
        if (!alive || captured !== context || sequence !== listSequence) return;
        if (requestedDetailSequence === detailSequence && detail.value?.id === requestedId) mergeJob(latest);
      }
    }
  } catch (cause) {
    if (!alive || captured !== context || sequence !== listSequence || cancelled(cause)) return;
    failed = true;
    error.value = message(cause);
  } finally {
    if (alive && captured === context && sequence === listSequence) {
      loading.value = false;
      schedulePoll(captured, failed ? 5000 : 1500);
    }
  }
}
async function createDiagnostic() {
  const projectId = binding.value?.projectId;
  if (!projectId || creating.value || !directoryLoaded.value) return;
  const captured = context;
  const key = beginDiagnosticRequest(props.services.sourceKey, projectId);
  pendingCreation.value = true;
  const request = (createRequest = new AbortController());
  creating.value = true;
  actionError.value = "";
  notice.value = "";
  try {
    const result = await props.services.jobs.create({ project_id: projectId, kind: "diagnostic" }, key, request.signal);
    if (!alive || captured !== context) return;
    confirmDiagnosticRequest(props.services.sourceKey, projectId, key);
    pendingCreation.value = false;
    detail.value = result;
    notice.value = "诊断任务已受理。离开页面不会取消后台执行。";
    await load(0);
  } catch (cause) {
    if (alive && captured === context && !cancelled(cause)) actionError.value = `${message(cause)} 再次发起会使用同一请求标识，避免重复创建。`;
  } finally {
    if (alive && captured === context) creating.value = false;
  }
}
async function inspect(job: JobRead) {
  const captured = context;
  const sequence = ++detailSequence;
  detailRequest?.abort();
  const request = (detailRequest = new AbortController());
  detailLoading.value = true;
  actionError.value = "";
  try {
    const latest = await props.services.jobs.get(job.id, request.signal);
    if (!alive || captured !== context || sequence !== detailSequence) return;
    if (detail.value?.id !== latest.id || Date.parse(detail.value.updated_at) <= Date.parse(latest.updated_at)) detail.value = latest;
    schedulePoll(captured);
  } catch (cause) {
    if (alive && captured === context && sequence === detailSequence && !cancelled(cause)) actionError.value = message(cause);
  } finally {
    if (alive && captured === context && sequence === detailSequence) detailLoading.value = false;
  }
}
async function cancel(job: JobRead) {
  if (cancelling.value) return;
  const captured = context;
  const request = (cancelRequest = new AbortController());
  cancelling.value = job.id;
  actionError.value = "";
  notice.value = "";
  try {
    const confirmed = await props.services.jobs.cancel(job.id, request.signal);
    if (!alive || captured !== context) return;
    // Discard earlier reads before applying the confirmed cancellation.
    listSequence += 1;
    detailSequence += 1;
    listRequest?.abort();
    detailRequest?.abort();
    detailLoading.value = false;
    mergeJob(confirmed);
    notice.value = "任务已取消。原有论文、规划和资料保持不变。";
    await load();
  } catch (cause) {
    if (!alive || captured !== context || cancelled(cause)) return;
    actionError.value = message(cause);
    await load();
  } finally {
    if (alive && captured === context) cancelling.value = "";
  }
}
function stopQueries() {
  clearTimeout(pollTimer);
  listSequence += 1;
  detailSequence += 1;
  listRequest?.abort();
  detailRequest?.abort();
  createRequest?.abort();
  cancelRequest?.abort();
}
watch(
  () => binding.value?.projectId,
  () => {
    context += 1;
    stopQueries();
    pendingCreation.value = binding.value ? !!pendingDiagnosticKey(props.services.sourceKey, binding.value.projectId) : false;
    directoryLoaded.value = false;
    jobs.value = [];
    detail.value = null;
    total.value = offset.value = 0;
    loading.value = creating.value = detailLoading.value = false;
    cancelling.value = error.value = actionError.value = notice.value = "";
    if (binding.value) void load(0);
  },
  { immediate: true },
);
onScopeDispose(() => {
  alive = false;
  context += 1;
  stopQueries();
});
</script>

<template>
  <div class="screen-page" data-testid="service-jobs">
    <header class="screen-heading">
      <div>
        <p class="tp-label">Activity · {{ sourceLabel }}</p>
        <h1 class="tp-display mt-3">执行任务</h1>
        <p class="screen-lead">执行状态由当前服务保存，回到页面后重新读取。</p>
      </div>
      <TpStatus :tone="activeCount ? 'info' : 'ghost'" :live="!!activeCount" :label="activeCount ? `${activeCount} 项正在执行` : '当前页没有运行任务'" />
    </header>
    <p class="studio-notice">当前仅接入诊断任务，用于检查执行链路；不调用模型，不修改论文或规划。</p>
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <section v-if="!binding" key="unbound" class="screen-panel">
        <TpState kind="empty" title="先打开一个已关联的项目" desc="当前本机项目尚未关联到这个服务。请从项目目录打开项目，再查看诊断记录。">
          <RouterLink class="tp-btn tp-btn--primary" to="/screens/projects">前往项目目录</RouterLink>
        </TpState>
      </section>
      <section v-else :key="binding.projectId" class="studio-stack">
        <div class="screen-actions">
          <p class="tp-caption">当前项目：{{ workspace.current.title }}</p>
          <TpButton variant="primary" :loading="creating" :disabled="creating || !directoryLoaded" @click="createDiagnostic">{{
            pendingCreation ? "重试未确认诊断" : "运行诊断"
          }}</TpButton
          ><TpButton :loading="loading" @click="load()">刷新任务</TpButton>
        </div>
        <Transition name="tp-swap" v-bind="panelMotionHooks">
          <p v-if="pendingCreation && !creating" class="studio-notice">上一次诊断请求尚待确认，请先核对列表；重试会沿用原请求标识。</p>
        </Transition>
        <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
          ><p v-if="notice" :key="notice" role="status" class="studio-notice">{{ notice }}</p></Transition
        >
        <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
          ><p v-if="actionError" :key="actionError" role="alert" class="studio-notice">{{ actionError }}</p></Transition
        >
        <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
          ><TpState v-if="error" :key="error" kind="error" title="任务状态暂时无法读取" :desc="error" retryable @retry="load()"
        /></Transition>
        <p v-if="loading" class="tp-caption" role="status">正在读取任务…</p>
        <div class="studio-grid service-jobs-layout">
          <TransitionGroup name="tp-list" tag="section" v-bind="listMotionHooks" class="tp-list-group screen-panel">
            <article
              v-for="job in jobs"
              :key="job.id"
              class="studio-body studio-history-row"
              :class="{ 'service-job-selected': detail?.id === job.id }"
              data-testid="service-job-row"
            >
              <div class="studio-row">
                <button class="studio-text-button tp-subheading" @click="inspect(job)">执行链路诊断</button
                ><Transition name="tp-swap" mode="out-in"
                  ><TpStatus :key="job.status" :tone="tone(job)" :label="labels[job.status]" :live="job.status === 'running'"
                /></Transition>
              </div>
              <p class="tp-caption mt-3">{{ formatTime(job.created_at) }} · 第 {{ job.attempt }} 次执行</p>
              <p v-if="job.error_code" class="tp-caption mt-2">诊断代码：{{ job.error_code }}</p>
              <div class="screen-actions mt-3">
                <TpButton size="sm" variant="ghost" @click="inspect(job)">查看详情</TpButton
                ><Transition name="tp-swap" v-bind="panelMotionHooks"
                  ><TpButton v-if="isActive(job)" size="sm" :loading="cancelling === job.id" :disabled="!!cancelling" @click="cancel(job)"
                    >取消任务</TpButton
                  ></Transition
                >
              </div>
            </article>
            <div v-if="!loading && !error && !jobs.length" key="empty-jobs" class="studio-empty">
              <h2 class="tp-subheading">还没有诊断记录</h2>
              <p class="tp-caption mt-3">运行一次诊断，即可查看排队、执行和结果。</p>
            </div>
          </TransitionGroup>
          <aside class="screen-panel studio-body studio-stack">
            <h2 class="tp-subheading">任务详情</h2>
            <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
              <p v-if="detailLoading" key="loading" class="tp-caption" role="status">正在读取任务详情…</p>
              <div v-else-if="detail" :key="detail.id" class="studio-stack">
                <dl class="studio-facts service-facts">
                  <dt>任务标识</dt>
                  <dd class="tp-mono">{{ detail.id }}</dd>
                  <dt>状态</dt>
                  <dd>{{ labels[detail.status] }}</dd>
                  <dt>创建时间</dt>
                  <dd>{{ formatTime(detail.created_at) }}</dd>
                  <dt>最近更新</dt>
                  <dd>{{ formatTime(detail.updated_at) }}</dd>
                  <dt>执行次数</dt>
                  <dd>{{ detail.attempt }}</dd>
                </dl>
                <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
                  ><p v-if="resultMessage" :key="resultMessage" class="studio-copy">{{ resultMessage }}</p>
                  <p v-else-if="detail.error_code" :key="detail.error_code" class="studio-copy">任务未完成，诊断代码：{{ detail.error_code }}</p>
                  <p v-else :key="detail.status" class="tp-caption">
                    {{ detail.status === "cancelled" ? "取消已由服务确认。" : "尚无执行结果，运行状态会自动刷新。" }}
                  </p></Transition
                >
              </div>
              <p v-else key="no-selection" class="tp-caption">选择一个任务查看详情。离开页面仅停止查询，后台任务继续执行。</p>
            </Transition>
          </aside>
        </div>
        <nav v-if="total > limit" class="screen-actions" aria-label="任务分页">
          <TpButton :disabled="loading || offset === 0" @click="load(Math.max(0, offset - limit))">上一页</TpButton
          ><span class="tp-caption">第 {{ Math.floor(offset / limit) + 1 }} 页，共 {{ total }} 项</span
          ><TpButton :disabled="loading || offset + limit >= total" @click="load(offset + limit)">下一页</TpButton>
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
