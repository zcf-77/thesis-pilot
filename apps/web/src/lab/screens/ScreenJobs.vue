<script setup lang="ts">
import { listMotionHooks } from "@/design/motion";
import { jobStatus } from "@/domain/vocab";
import TpSelect from "@/components/ui/TpSelect.vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpTabs from "@/components/ui/TpTabs.vue";
import { usePreviewWorkspaceStore } from "../state/previewWorkspace";
import { useJobsState, cancelPreviewJob, canRetryProjectJob, retryProjectJob, startProjectJob, jobLabels } from "../state/jobState";
import { useServiceJobs } from "../state/serviceJobs";
import { useBackendServices } from "@/services/runtime";
import ServiceJobs from "../components/integration/ServiceJobs.vue";
import { panelMotionHooks } from "../components/integration/motion";
const backend = useBackendServices();
const service = useServiceJobs();
const workspace = usePreviewWorkspaceStore();
const state = useJobsState();
const route = useRoute();
const router = useRouter();
type JobSource = "service" | "local";
const sourceTabs: { value: JobSource; label: string }[] = [
  { value: "service", label: backend.mode === "mock" ? backend.sourceLabel : "服务端任务" },
  { value: "local", label: "本机任务" },
];
const source = computed<JobSource>({
  get() {
    if (!service || route.query.source === "local" || (route.query.source !== "service" && typeof route.query.job === "string")) return "local";
    return "service";
  },
  set(value) {
    void router.replace({ query: { ...route.query, source: value, job: undefined } });
  },
});
const filter = ref("all");
const selected = ref("");
const fail = ref(false);
const visible = computed(() => state.value.jobs.filter((j) => filter.value === "all" || j.status === filter.value));
const detail = computed(() => state.value.jobs.find((j) => j.id === selected.value));
const running = computed(() =>
  source.value === "service" ? (service?.activeCount.value ?? null) : state.value.jobs.filter((j) => ["queued", "running"].includes(j.status)).length,
);
const formatTime = (value: string) => (Number.isNaN(Date.parse(value)) ? value : new Date(value).toLocaleString("zh-CN"));
watch(
  () => [route.path, route.query.job, source.value] as const,
  ([path, id, origin]) => {
    if (path === "/screens/jobs" && origin === "local") selected.value = typeof id === "string" ? id : "";
  },
  { immediate: true },
);
function run(sourceId = crypto.randomUUID()) {
  const project = workspace.current;
  const shouldFail = fail.value;
  let timer: ReturnType<typeof setTimeout>;
  const handle = startProjectJob(
    project,
    {
      title: "任务执行交互预览",
      kind: "生成",
      route: "/screens/jobs",
      sourceId,
      queued: true,
      input: "正文 v" + project.document.version + " · 要求 v" + project.requirementVersion,
      snapshot: { mode: "本地交互样例", scenario: shouldFail ? "timeout" : "success" },
    },
    {
      cancel: () => clearTimeout(timer),
      retry: () => run(sourceId),
    },
  );
  selected.value = handle.id;
  timer = setTimeout(() => {
    if (!handle.start()) return;
    timer = setTimeout(
      () => handle.finish(shouldFail ? "failed" : "done", shouldFail ? "模拟请求超时；原数据保留，可重试。" : "模拟任务完成；没有调用外部服务或修改论文。"),
      800,
    );
  }, 250);
}
</script>
<template>
  <div class="screen-page">
    <header class="screen-heading">
      <h1 class="tp-display">执行任务</h1>
      <TpStatus v-if="running !== null" :tone="running ? 'info' : 'ghost'" :live="!!running" :label="running ? running + ' 项正在执行' : '当前没有运行任务'" />
    </header>
    <TpTabs v-if="service" v-model="source" :tabs="sourceTabs" label="任务来源" />
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <ServiceJobs v-if="service && source === 'service'" key="service" :state="service" />
      <div v-else key="local" class="studio-stack">
        <div class="screen-actions">
          <TpField v-slot="{ id }" label="按状态筛选"
            ><TpSelect
              :id="id"
              v-model="filter"
              :options="[{ value: 'all', label: '全部状态' }, ...Object.entries(jobLabels).map(([value, label]) => ({ value, label }))]"
          /></TpField>
        </div>
        <div class="studio-grid jobs-layout">
          <TransitionGroup name="tp-list" tag="section" v-bind="listMotionHooks" class="tp-list-group screen-panel">
            <article v-for="job in visible" :key="'local:' + job.id" class="studio-body studio-history-row" :class="{ 'job-is-selected': selected === job.id }">
              <div class="studio-row">
                <button class="studio-text-button tp-subheading" @click="selected = job.id">{{ job.title }}</button>
                <Transition name="tp-swap" mode="out-in">
                  <TpStatus :key="job.status" :tone="jobStatus[job.status].tone" :label="jobStatus[job.status].label" :live="jobStatus[job.status].live" />
                </Transition>
              </div>
              <p class="tp-caption mt-2">{{ job.kind }} · {{ formatTime(job.at) }}</p>
              <p v-if="job.status === 'failed' || job.status === 'partial'" class="studio-copy">{{ job.diagnosis }}</p>
              <div class="screen-actions">
                <Transition name="tp-swap">
                  <TpButton v-if="['queued', 'running'].includes(job.status)" size="sm" @click="cancelPreviewJob(job)">取消任务</TpButton>
                </Transition>
                <Transition name="tp-swap">
                  <TpButton v-if="canRetryProjectJob(job)" size="sm" @click="retryProjectJob(job)">重试任务</TpButton>
                </Transition>
                <RouterLink class="studio-link" :to="job.route">{{
                  ["failed", "cancelled", "partial"].includes(job.status) && !canRetryProjectJob(job) ? "回到来源重新执行 ↗" : "打开关联内容 ↗"
                }}</RouterLink>
              </div>
            </article>
            <div key="empty-jobs" v-if="!visible.length" class="studio-empty">
              <h2 class="tp-subheading">{{ state.jobs.length ? "没有符合条件的任务" : "还没有执行记录" }}</h2>
              <p class="tp-caption mt-3">从资料解析、写作、评审或导出开始，结果会保留在这里。</p>
              <TpButton v-if="state.jobs.length" class="mt-4" @click="filter = 'all'">显示全部</TpButton>
              <RouterLink v-else class="studio-link mt-4" to="/screens/write">返回写作 ↗</RouterLink>
            </div>
          </TransitionGroup>
          <aside class="screen-panel studio-body studio-stack">
            <h2 class="tp-subheading">输入与诊断</h2>
            <Transition name="tp-swap" mode="out-in">
              <div class="studio-stack" :key="detail.id" v-if="detail">
                <dl class="studio-facts">
                  <dt>类型</dt>
                  <dd>{{ detail.kind }}</dd>
                  <dt>最近执行</dt>
                  <dd>{{ formatTime(detail.at) }}</dd>
                  <dt>输入快照</dt>
                  <dd>{{ detail.input }}</dd>
                </dl>
                <Transition name="tp-swap" mode="out-in">
                  <p :key="detail.status + ':' + detail.attempt" class="studio-copy">{{ detail.diagnosis }}</p>
                </Transition>
                <details class="job-snapshot tp-disclosure">
                  <summary>运行标识与配置快照</summary>
                  <p class="tp-mono">{{ detail.id }}</p>
                  <pre>{{ JSON.stringify(detail.snapshot ?? {}, null, 2) }}</pre>
                </details>
                <h3 class="tp-subheading">每次尝试</h3>
                <TransitionGroup name="tp-list" tag="ol" v-bind="listMotionHooks" class="tp-list-group job-attempts">
                  <li v-for="attempt in [...(detail.attempts ?? [])].reverse()" :key="attempt.number" class="studio-history-row">
                    <div class="studio-row">
                      <b>第 {{ attempt.number }} 次</b
                      ><Transition name="tp-swap" mode="out-in">
                        <TpStatus :key="attempt.status" size="sm" :label="jobLabels[attempt.status]" :tone="attempt.status === 'failed' ? 'danger' : 'ghost'" />
                      </Transition>
                    </div>
                    <p class="tp-caption mt-2">
                      {{ formatTime(attempt.startedAt) }}<span v-if="attempt.finishedAt"> → {{ formatTime(attempt.finishedAt) }}</span>
                    </p>
                    <p class="studio-copy">{{ attempt.diagnosis }}</p>
                    <p class="tp-caption">{{ attempt.input }}</p>
                    <details class="job-snapshot tp-disclosure mt-2">
                      <summary>查看此次固定输入</summary>
                      <pre>{{ JSON.stringify(attempt.snapshot, null, 2) }}</pre>
                    </details>
                  </li>
                </TransitionGroup>
                <p v-if="!detail.attempts?.length" class="tp-caption">这是旧版执行记录，未保存逐次快照。</p>
              </div>
              <p key="no-job-selection" v-else class="tp-caption">选择一个任务查看输入和历史。取消不会删除原件，也不会改动已经采纳的内容。</p>
            </Transition>
          </aside>
        </div>
        <details v-if="backend.mode === 'preview'" class="screen-panel studio-body tp-disclosure">
          <summary>预览场景 · 排队、取消与失败重试</summary>
          <div class="screen-actions mt-4">
            <label class="studio-check"><input v-model="fail" type="checkbox" class="checkbox checkbox-primary checkbox-sm" />模拟超时</label>
            <TpButton @click="run()">运行预览任务</TpButton>
          </div>
        </details>
      </div>
    </Transition>
  </div>
</template>
<style scoped>
.jobs-layout {
  align-items: start;
}
.job-is-selected {
  background: var(--tp-surface-sunken);
  box-shadow: inset 3px 0 var(--tp-accent);
}
.job-attempts {
  list-style: none;
  padding: 0;
  margin: 0;
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
.jobs-layout :deep(dd) {
  overflow-wrap: anywhere;
}
</style>
