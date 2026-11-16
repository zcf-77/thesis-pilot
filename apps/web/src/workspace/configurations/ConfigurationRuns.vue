<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { BackendServices, JobRead, ProjectRead } from "@/services";
import { ApiError, asApiError } from "@/services/errors";
import { isProbeConfiguration } from "@/services/validation";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { beginJobRequest, confirmJobRequest } from "@/lab/components/integration/jobsRequests";
import { serviceJobFailure, serviceJobStatus } from "@/lab/state/serviceJobs";
import { canonical, printable, shouldApplyTaskUpdate, type ConfigurationLibrary } from "./configurationEditor";

const props = defineProps<{ services: BackendServices; project?: ProjectRead | null }>();
const emit = defineEmits<{ openJob: [job: JobRead] }>();
const kindLabels: Record<ConfigurationLibrary, string> = { api: "AI 接口", model: "模型", prompt: "提示词", agent: "智能体" };
const pageSize = 20;

const projects = shallowRef<ProjectRead[]>([]);
const projectId = ref(props.project?.id ?? "");
const projectsBusy = ref(false);
const projectsError = ref("");
const jobs = shallowRef<JobRead[]>([]);
const total = ref(0);
const offset = ref(0);
const listBusy = ref(false);
const listError = ref("");
const selectedId = ref("");
const busy = ref(false);
const error = ref("");
const notice = ref("");
const retryCommand = shallowRef<{ job: JobRead; key: string; scope: string }>();

const selected = computed(() => jobs.value.find((job) => job.id === selectedId.value) ?? jobs.value[0]);
const projectOptions = computed(() => [
  { value: "", label: "选择项目" },
  ...projects.value.map((project) => ({ value: project.id, label: `${project.name}${project.archived ? "（已归档）" : ""}` })),
]);
const hasActive = computed(() => jobs.value.some((job) => job.status === "queued" || job.status === "running"));
const isActive = (job: JobRead) => job.status === "queued" || job.status === "running";
const configuration = (job: JobRead) => (isProbeConfiguration(job.configuration) ? job.configuration : undefined);
const kindOf = (job: JobRead) => {
  const kind = configuration(job)?.config_kind;
  return kind ? kindLabels[kind] : "配置";
};
const timeText = (value: string) => value.replace("T", " ").slice(0, 16);

let projectRequest: AbortController | undefined;
let listRequest: AbortController | undefined;
let mutation: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

async function loadProjects() {
  projectRequest?.abort();
  const controller = new AbortController();
  projectRequest = controller;
  projectsBusy.value = true;
  projectsError.value = "";
  const all: ProjectRead[] = [];
  try {
    let next = 0;
    do {
      const page = await props.services.projects.list({ offset: next, limit: 100 }, controller.signal);
      if (controller.signal.aborted) return;
      all.push(...page.items);
      next += page.items.length;
      if (!page.items.length || next >= page.total) break;
    } while (!controller.signal.aborted);
    projects.value = all;
  } catch (problem) {
    if (!controller.signal.aborted) {
      projects.value = all;
      projectsError.value = asApiError(problem).message;
    }
  } finally {
    if (!controller.signal.aborted) projectsBusy.value = false;
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  if (hasActive.value) timer = setTimeout(() => void load(offset.value, true), 2000);
}

async function load(nextOffset = 0, quiet = false) {
  listRequest?.abort();
  if (!projectId.value) {
    jobs.value = [];
    total.value = 0;
    listBusy.value = false;
    return;
  }
  const controller = new AbortController();
  listRequest = controller;
  if (!quiet) listBusy.value = true;
  listError.value = "";
  try {
    const page = await props.services.jobs.list(
      { project_id: projectId.value, kind: "configuration_probe", offset: nextOffset, limit: pageSize },
      controller.signal,
    );
    if (controller.signal.aborted) return;
    const next = [...page.items];
    // A selected job can be replaced by a newer snapshot but never rolled back.
    jobs.value = next.map((job) => {
      const current = jobs.value.find((item) => item.id === job.id);
      return shouldApplyTaskUpdate(current, job) ? job : current!;
    });
    total.value = page.total;
    offset.value = page.offset;
    schedule();
  } catch (problem) {
    if (!controller.signal.aborted) listError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) listBusy.value = false;
  }
}

function merge(job: JobRead) {
  const exists = jobs.value.some((item) => item.id === job.id);
  jobs.value = exists ? jobs.value.map((item) => (item.id === job.id && shouldApplyTaskUpdate(item, job) ? job : item)) : [job, ...jobs.value];
  selectedId.value = job.id;
  schedule();
}

async function cancel(job: JobRead) {
  if (busy.value || !isActive(job)) return;
  mutation?.abort();
  const controller = new AbortController();
  mutation = controller;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await props.services.jobs.cancel(job.id, controller.signal, job.project_id);
    if (!controller.signal.aborted) merge(result);
  } catch (problem) {
    if (!controller.signal.aborted) {
      error.value = `${asApiError(problem).message} 取消结果须以刷新后的服务端状态为准。`;
      void load(offset.value, true);
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

async function retry(job: JobRead) {
  if (busy.value || isActive(job)) return;
  if (retryCommand.value?.job.id !== job.id) {
    const scope = "thesispilot.pending-job:" + JSON.stringify([props.services.sourceKey, undefined, job.project_id, "retry", job.id]);
    retryCommand.value = { job, key: beginJobRequest(scope), scope };
  }
  const command = retryCommand.value!;
  mutation?.abort();
  const controller = new AbortController();
  mutation = controller;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await props.services.jobs.retry(job.id, command.key, controller.signal, job.project_id);
    if (controller.signal.aborted) return;
    if (
      result.project_id !== job.project_id ||
      result.id === job.id ||
      result.source_job_id !== job.id ||
      canonical(result.input_snapshot) !== canonical(job.input_snapshot) ||
      canonical(result.configuration) !== canonical(job.configuration)
    )
      throw new ApiError("INVALID_RESPONSE");
    confirmJobRequest(command.scope, command.key);
    retryCommand.value = undefined;
    merge(result);
    notice.value = "已使用原固定配置与输入创建重试任务。";
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      if (issue.status !== undefined && issue.status < 500 && issue.code !== "INVALID_RESPONSE") {
        confirmJobRequest(command.scope, command.key);
        retryCommand.value = undefined;
      }
      error.value = retryCommand.value ? "重试结果未知。请再次点击以使用原请求确认。" : issue.message;
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

watch(projectId, () => {
  mutation?.abort();
  busy.value = false;
  selectedId.value = "";
  error.value = "";
  notice.value = "";
  retryCommand.value = undefined;
  jobs.value = [];
  void load(0);
});
onMounted(() => {
  void loadProjects();
  void load(0);
});
onScopeDispose(() => {
  projectRequest?.abort();
  listRequest?.abort();
  mutation?.abort();
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <div class="runs-stack">
    <div class="runs-toolbar">
      <TpField v-slot="{ id }" label="项目" class="runs-project"
        ><TpSelect :id="id" v-model="projectId" :options="projectOptions" :disabled="projectsBusy"
      /></TpField>
      <TpButton size="sm" variant="ghost" :disabled="!projectId || listBusy" @click="load(offset)">刷新记录</TpButton>
    </div>
    <p v-if="projectsError" class="studio-notice" role="alert">
      项目读取失败：{{ projectsError }}<TpButton size="sm" @click="loadProjects">重试项目</TpButton>
    </p>
    <TpState v-if="!projectId" class="screen-panel" kind="empty" title="选择项目查看运行记录" desc="配置试跑归属于明确的项目。" />
    <template v-else>
      <TpState v-if="listError && !jobs.length" class="screen-panel" kind="error" title="运行记录读取失败" :desc="listError" retryable @retry="load(offset)" />
      <TpState
        v-else-if="!listBusy && !jobs.length"
        class="screen-panel"
        kind="empty"
        title="还没有运行记录"
        desc="在智能体、提示词、接口或模型详情中发起配置试跑。"
      />
      <div v-else class="runs-layout">
        <section class="screen-panel runs-list" aria-label="运行记录" :aria-busy="listBusy || undefined">
          <p v-if="listBusy && !jobs.length" role="status" class="tp-caption runs-pad">正在读取运行记录…</p>
          <TransitionGroup name="tp-list" v-bind="listMotionHooks" tag="div" class="tp-list-group">
            <button
              v-for="job in jobs"
              :key="job.id"
              type="button"
              class="runs-item"
              :class="{ 'is-selected': selected?.id === job.id }"
              :aria-pressed="selected?.id === job.id"
              @click="selectedId = job.id"
            >
              <span><b>{{ kindOf(job) }}试跑</b><small>{{ timeText(job.created_at) }} · 第 {{ job.attempt }} 次尝试</small></span
              ><TpStatus v-bind="serviceJobStatus(job)" size="sm" />
            </button>
          </TransitionGroup>
          <p v-if="listError && jobs.length" role="alert" class="studio-notice">{{ listError }}</p>
          <div v-if="total > pageSize" class="screen-actions runs-pad">
            <TpButton size="sm" :disabled="listBusy || offset === 0" @click="load(Math.max(0, offset - pageSize))">上一页记录</TpButton
            ><TpButton size="sm" :disabled="listBusy || offset + jobs.length >= total" @click="load(offset + pageSize)">下一页记录</TpButton>
          </div>
        </section>
        <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
          <section v-if="selected" :key="selected.id" class="screen-panel runs-detail" aria-label="运行详情">
            <div class="runs-row">
              <div>
                <p class="tp-label">Run snapshot</p>
                <h2 class="tp-heading">{{ kindOf(selected) }}试跑</h2>
              </div>
              <TpStatus v-bind="serviceJobStatus(selected)" />
            </div>
            <p v-if="serviceJobFailure(selected)" role="alert" class="studio-notice">
              {{ serviceJobFailure(selected) }}<span v-if="selected.error_code">（{{ selected.error_code }}）</span>
            </p>
            <dl class="runs-facts">
              <div>
                <dt>运行时间</dt>
                <dd>{{ timeText(selected.created_at) }} → {{ isActive(selected) ? "运行中" : timeText(selected.updated_at) }}</dd>
              </div>
              <div>
                <dt>任务</dt>
                <dd class="tp-mono">{{ selected.id }}</dd>
              </div>
              <div v-if="selected.source_job_id">
                <dt>重试自</dt>
                <dd class="tp-mono">{{ selected.source_job_id }}</dd>
              </div>
            </dl>
            <details v-if="configuration(selected)" class="runs-snapshot">
              <summary>固定配置快照</summary>
              <pre>{{ printable(selected.configuration) }}</pre>
            </details>
            <details v-if="selected.input_snapshot" class="runs-snapshot">
              <summary>固定输入</summary>
              <pre>{{ printable(selected.input_snapshot) }}</pre>
            </details>
            <details v-if="selected.result" class="runs-snapshot">
              <summary>运行结果</summary>
              <pre>{{ printable(selected.result) }}</pre>
            </details>
            <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="error" :key="error" role="alert" class="studio-notice">{{ error }}</p></Transition>
            <p v-if="notice" role="status" class="tp-caption">{{ notice }}</p>
            <div class="screen-actions">
              <TpButton v-if="isActive(selected)" size="sm" :disabled="busy" @click="cancel(selected)">取消试跑</TpButton
              ><TpButton v-else-if="selected.status === 'failed' || selected.status === 'cancelled'" size="sm" :disabled="busy" @click="retry(selected)">{{
                retryCommand?.job.id === selected.id ? "使用原请求确认重试" : "重试固定输入"
              }}</TpButton
              ><TpButton size="sm" variant="ghost" @click="emit('openJob', selected)">在任务中心查看</TpButton>
            </div>
          </section>
        </Transition>
      </div>
    </template>
  </div>
</template>

<style scoped>
.runs-stack {
  grid-template-columns: minmax(0, 1fr);
  display: grid;
  gap: 16px;
  min-width: 0;
}
.runs-toolbar {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}
.runs-project {
  width: min(320px, 100%);
}
.runs-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.runs-list {
  overflow: hidden;
}
.runs-pad {
  padding: 12px 14px;
}
.runs-item {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--tp-line);
  background: transparent;
  color: var(--tp-text);
  text-align: left;
  cursor: pointer;
}
.runs-item:last-child {
  border-bottom: 0;
}
.runs-item:hover {
  background: var(--tp-surface-sunken);
}
.runs-item.is-selected {
  background: var(--tp-accent-soft);
  box-shadow: inset 3px 0 var(--tp-accent);
}
.runs-item b {
  display: block;
  font-size: 14px;
}
.runs-item small {
  display: block;
  margin-top: 4px;
  color: var(--tp-text-muted);
  font-size: 12px;
}
.runs-detail {
  grid-template-columns: minmax(0, 1fr);
  display: grid;
  gap: 14px;
  padding: 18px;
  min-width: 0;
}
.runs-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.runs-facts {
  display: grid;
  gap: 8px;
  margin: 0;
  font-size: 13px;
}
.runs-facts > div {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 12px;
}
.runs-facts dt {
  color: var(--tp-text-muted);
}
.runs-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.runs-snapshot {
  font-size: 13px;
}
.runs-snapshot summary {
  cursor: pointer;
  font-weight: 600;
}
.runs-snapshot pre {
  margin: 8px 0 0;
  padding: 12px;
  max-height: 320px;
  overflow: auto;
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
  font-family: var(--tp-font-mono);
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (max-width: 900px) {
  .runs-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
