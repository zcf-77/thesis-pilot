<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowRef } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import type { BackendServices, JobCreate, JobRead, ProjectRead } from "@/services";
import { ApiError, asApiError } from "@/services/errors";
import { isProbeConfiguration, isProbeScope } from "@/services/validation";
import { beginJobRequest, confirmJobRequest } from "@/lab/components/integration/jobsRequests";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { serviceJobStatus, serviceJobFailure } from "@/lab/state/serviceJobs";
import TpStatus from "@/components/ui/TpStatus.vue";
import { canonical, printable, probeResultPresentation, shouldApplyTaskUpdate, variableValues, type ConfigurationLibrary } from "./configurationEditor";

const props = defineProps<{
  services: BackendServices;
  project?: ProjectRead;
  configVersionId: string;
  configName: string;
  kind: ConfigurationLibrary;
  enabled: boolean;
}>();
const emit = defineEmits<{ openJob: [job: JobRead] }>();
const projects = shallowRef<ProjectRead[]>([]);
const projectId = ref(props.project?.id ?? "");
const projectsLoading = ref(false);
const projectsError = ref("");
const variables = ref('{\n  "context": "本科毕业论文绪论中介绍研究背景的一段文字",\n  "goal": "提出两条简短的改进建议"\n}');
const job = shallowRef<JobRead>();
const resultPresentation = computed(() => probeResultPresentation(job.value?.result));
const busy = ref(false);
const checking = ref(false);
const error = ref("");
const notice = ref("");
const pending = shallowRef<{ input: JobCreate; key: string; scope: string }>();
const retryCommand = shallowRef<{ job: JobRead; key: string; scope: string }>();
const active = computed(() => job.value?.status === "queued" || job.value?.status === "running");
const projectOptions = computed(() => [
  { value: "", label: "选择明确项目" },
  ...projects.value.map((project) => ({ value: project.id, label: `${project.name}${project.archived ? "（已归档）" : ""}`, disabled: project.archived })),
]);
const trialDescription = computed(() =>
  props.kind === "api"
    ? "验证官方接口连通性，不生成模型文本。"
    : props.kind === "prompt"
      ? "渲染模板并检查变量，不发起模型请求。"
      : "使用服务器冻结的配置链发起真实模型请求；输出只在试跑记录中展示。",
);
let request: AbortController | undefined;
let projectRequest: AbortController | undefined;
let pollRequest: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;

function mergeJob(next: JobRead) {
  const current = job.value;
  if (!shouldApplyTaskUpdate(current, next)) return;
  job.value = next;
}

async function loadProjects() {
  projectRequest?.abort();
  const controller = new AbortController();
  projectRequest = controller;
  projectsLoading.value = true;
  projectsError.value = "";
  const all: ProjectRead[] = [];
  try {
    let offset = 0;
    do {
      const page = await props.services.projects.list({ offset, limit: 100 }, controller.signal);
      if (controller.signal.aborted) return;
      all.push(...page.items);
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) break;
    } while (!controller.signal.aborted);
    projects.value = all;
  } catch (problem) {
    if (!controller.signal.aborted) {
      projects.value = all;
      projectsError.value = asApiError(problem).message;
    }
  } finally {
    if (!controller.signal.aborted) projectsLoading.value = false;
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  if (!disposed && active.value) timer = setTimeout(() => void refresh(), 1200);
}

async function refresh() {
  if (!job.value || checking.value || disposed) return;
  pollRequest?.abort();
  const controller = new AbortController();
  pollRequest = controller;
  checking.value = true;
  const current = job.value;
  try {
    const latest = await props.services.jobs.get(current.id, controller.signal, current.project_id);
    if (!controller.signal.aborted && job.value?.id === current.id) {
      mergeJob(latest);
      error.value = "";
    }
  } catch (problem) {
    if (!controller.signal.aborted) error.value = `任务状态暂不可读：${asApiError(problem).message} 请刷新确认后再决定下一步。`;
  } finally {
    if (!controller.signal.aborted) {
      checking.value = false;
      if (!error.value) schedule();
    }
  }
}

async function start() {
  if (busy.value || active.value || pending.value || retryCommand.value) return;
  error.value = "";
  notice.value = "";
  if (!projectId.value) {
    error.value = "请明确选择本次试跑所属项目。";
    return;
  }
  try {
    const values = variableValues(variables.value);
    const scope =
      "thesispilot.pending-job:" +
      JSON.stringify([props.services.sourceKey, undefined, projectId.value, "configuration_probe", props.configVersionId, canonical(values)]);
    pending.value = {
      input: {
        project_id: projectId.value,
        kind: "configuration_probe",
        input_snapshot: { schema_version: 1, config_version_id: props.configVersionId, variables: values },
      },
      key: beginJobRequest(scope),
      scope,
    };
  } catch (problem) {
    error.value = (problem as Error).message;
    return;
  }
  await recoverCreate();
}

async function recoverCreate() {
  const command = pending.value;
  if (!command || busy.value) return;
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  try {
    const created = await props.services.jobs.create(command.input, command.key, controller.signal);
    if (!controller.signal.aborted) {
      if (
        created.project_id !== command.input.project_id ||
        created.kind !== "configuration_probe" ||
        !isProbeScope(created.resource_scope) ||
        created.resource_scope.config_version_id !== props.configVersionId ||
        !isProbeConfiguration(created.configuration) ||
        created.configuration.config_version_id !== props.configVersionId
      )
        throw new ApiError("INVALID_RESPONSE");
      confirmJobRequest(command.scope, command.key);
      job.value = created;
      pending.value = undefined;
      error.value = "";
      notice.value = "试跑任务已创建。离开页面不会取消服务端任务。";
      schedule();
    }
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      if (issue.status !== undefined && issue.status < 500 && issue.code !== "INVALID_RESPONSE") {
        confirmJobRequest(command.scope, command.key);
        pending.value = undefined;
      }
      error.value = pending.value ? "创建结果未知，固定输入已保留。请使用原请求确认，避免重复发起。" : issue.message;
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

async function cancel() {
  if (!job.value || busy.value || !active.value) return;
  const current = job.value;
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  error.value = "";
  try {
    const result = await props.services.jobs.cancel(current.id, controller.signal, current.project_id);
    if (!controller.signal.aborted && job.value?.id === current.id) {
      mergeJob(result);
      notice.value = result.status === "cancelled" ? "服务端已确认取消。" : "已读取服务端状态，请以当前结果为准。";
      schedule();
    }
  } catch (problem) {
    if (!controller.signal.aborted) {
      error.value = `${asApiError(problem).message} 取消结果须以刷新后的服务端状态为准。`;
      void refresh();
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

async function retry() {
  if (!job.value || busy.value || active.value || pending.value) return;
  if (!retryCommand.value) {
    const scope = "thesispilot.pending-job:" + JSON.stringify([props.services.sourceKey, undefined, job.value.project_id, "retry", job.value.id]);
    retryCommand.value = { job: job.value, key: beginJobRequest(scope), scope };
  }
  const command = retryCommand.value;
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  error.value = "";
  try {
    const result = await props.services.jobs.retry(command.job.id, command.key, controller.signal, command.job.project_id);
    if (!controller.signal.aborted) {
      if (
        result.project_id !== command.job.project_id ||
        result.id === command.job.id ||
        result.source_job_id !== command.job.id ||
        canonical(result.input_snapshot) !== canonical(command.job.input_snapshot) ||
        canonical(result.configuration) !== canonical(command.job.configuration)
      )
        throw new ApiError("INVALID_RESPONSE");
      confirmJobRequest(command.scope, command.key);
      job.value = result;
      retryCommand.value = undefined;
      notice.value = "已使用原固定配置与输入创建重试任务。";
      schedule();
    }
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      if (issue.status !== undefined && issue.status < 500 && issue.code !== "INVALID_RESPONSE") {
        confirmJobRequest(command.scope, command.key);
        retryCommand.value = undefined;
      }
      error.value = retryCommand.value ? "重试结果未知。请继续使用原重试请求确认。" : issue.message;
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

onMounted(() => void loadProjects());
onScopeDispose(() => {
  disposed = true;
  request?.abort();
  pollRequest?.abort();
  projectRequest?.abort();
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <section class="screen-panel studio-body studio-stack" aria-label="配置试跑">
    <h2 class="tp-heading">配置试跑</h2>
    <p class="tp-caption">{{ trialDescription }}</p>
    <p class="tp-caption">明确配置：{{ configName }}。不读取正式稿，不写入正文。</p>
    <form class="studio-stack" @submit.prevent="start">
      <TpField v-slot="{ id }" label="试跑项目"
        ><TpSelect :id="id" v-model="projectId" :options="projectOptions" :disabled="busy || active || !!pending || !!retryCommand || projectsLoading"
      /></TpField>
      <p v-if="projectsLoading" role="status" class="tp-caption">正在读取项目…</p>
      <p v-if="projectsError" class="studio-notice" role="alert">{{ projectsError }}<TpButton size="sm" @click="loadProjects">重试项目列表</TpButton></p>
      <TpField v-slot="{ id }" label="试跑变量 JSON" hint="仅使用合成文本。变量名为 context、goal、requirements、materials，需与提示词声明一致。">
        <textarea :id="id" v-model="variables" rows="5" class="tp-input probe-variables" :readonly="busy || active || !!pending || !!retryCommand" />
      </TpField>
      <div class="screen-actions">
        <TpButton type="submit" variant="primary" :loading="busy" :disabled="busy || active || !!pending || !!retryCommand || !enabled">发起配置试跑</TpButton
        ><span v-if="!enabled" class="tp-caption">当前配置已停用，启用后才能新建试跑。</span
        ><TpButton v-if="pending" :disabled="busy" @click="recoverCreate">使用原请求确认</TpButton>
      </div>
    </form>
    <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="error" :key="error" role="alert" class="studio-notice">{{ error }}</p></Transition>
    <p v-if="notice" role="status" class="tp-caption">{{ notice }}</p>
    <section v-if="job" class="studio-stack probe-result" aria-label="试跑任务结果">
      <div class="studio-row">
        <h3 class="tp-heading">本次试跑</h3>
        <TpStatus v-bind="serviceJobStatus(job)" />
      </div>
      <p class="tp-caption">尝试 {{ job.attempt }} · {{ job.id }}</p>
      <p v-if="serviceJobFailure(job)" role="alert" class="studio-notice">
        {{ serviceJobFailure(job) }}<span v-if="job.error_code">（{{ job.error_code }}）</span>
      </p>
      <div class="screen-actions">
        <TpButton v-if="active" size="sm" :disabled="busy" @click="cancel">取消试跑</TpButton
        ><TpButton v-else-if="job.status === 'failed' || job.status === 'cancelled'" size="sm" :disabled="busy || !!pending" @click="retry">{{
          retryCommand ? "使用原重试请求确认" : "重试固定输入"
        }}</TpButton
        ><TpButton size="sm" :disabled="checking" @click="refresh">刷新试跑状态</TpButton
        ><TpButton size="sm" @click="emit('openJob', job)">在任务中心查看</TpButton>
      </div>
      <div v-if="resultPresentation" class="studio-stack probe-success">
        <p class="tp-caption">
          {{ resultPresentation.execution }} · 固定版本：{{ configName
          }}<span v-if="resultPresentation.versionShort"> · {{ resultPresentation.versionShort }}</span>
        </p>
        <p v-if="resultPresentation.requestedModel || resultPresentation.responseModel" class="tp-caption">
          <span v-if="resultPresentation.requestedModel">请求模型：{{ resultPresentation.requestedModel }}</span
          ><span v-if="resultPresentation.responseModel"> · 响应模型：{{ resultPresentation.responseModel }}</span>
        </p>
        <div class="probe-readable-output">{{ resultPresentation.content }}</div>
        <details class="probe-details">
          <summary>查看运行详情</summary>
          <pre class="probe-output">{{ printable(job.result) }}</pre>
        </details>
      </div>
      <p v-else-if="job.result" class="tp-caption">结果暂时无法展示，请在任务中心核查运行详情。</p>
      <p v-else class="tp-caption">{{ active ? "等待服务端执行结果…" : "本次没有成功结果。" }}</p>
    </section>
  </section>
</template>

<style scoped>
.probe-variables {
  width: 100%;
  font-family: var(--tp-font-mono);
  resize: vertical;
}
.probe-result {
  padding-top: 18px;
  border-top: 1px solid var(--tp-line);
}
.probe-output {
  padding: 14px;
  margin: 0;
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  max-height: 460px;
  overflow-y: auto;
}
.probe-readable-output {
  padding: 18px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
  color: var(--tp-text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--tp-font-body);
  font-size: 14px;
  line-height: 1.8;
}
.probe-details summary {
  width: fit-content;
  color: var(--tp-text-muted);
  font-size: 12px;
  cursor: pointer;
  padding-block: 6px;
}
.probe-details[open] summary {
  margin-bottom: 8px;
}
</style>
