<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { RouterLink } from "vue-router";
import StageRoute from "@/components/domain/StageRoute.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpDialog from "@/components/ui/TpDialog.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import { projectDeadlineSummary } from "@/lab/state/projectProgress";
import type { BackendServices, ProjectRead } from "@/services";
import type { FlowVersionRead } from "@/services/contracts/api.generated";
import { asApiError } from "@/services/errors";
import { flowsRoute, projectSettingsRoute, tasksRoute, writingRoute } from "../workspaceRoutes";
import { findFlowVersion, shellStageProgress } from "./progress";

/** Mounted per project (keyed by id), so responses for a previous project can never reach this instance. */
const props = defineProps<{ services: Pick<BackendServices, "projectFlows" | "documents">; project: ProjectRead; refreshKey: string }>();
const open = ref(false);
const now = ref(new Date());
const flowState = ref<"unset" | "loading" | "ready" | "missing" | "failed">("loading");
const flowVersion = shallowRef<FlowVersionRead>();
const documentState = ref<"loading" | "ready" | "none" | "failed">("loading");
const documentVersion = ref<number>();
let documentId: string | undefined;
let flowRequest: AbortController | undefined;
let documentRequest: AbortController | undefined;

const progress = computed(() => (flowVersion.value ? shellStageProgress(flowVersion.value, props.project.stage_id) : undefined));
const deadline = computed(() => projectDeadlineSummary(props.project.deadline ?? "", now.value));
const settings = computed(() => projectSettingsRoute(props.project.id));
const progressLabel = computed(() => {
  if (flowState.value === "unset") return "尚未绑定毕设流程";
  if (flowState.value === "loading") return "正在读取毕设流程";
  if (flowState.value === "failed") return "无法读取毕设流程";
  if (flowState.value === "missing" || !progress.value) return "绑定的流程版本不可用";
  const { issue, currentIndex, stages, sourceStages } = progress.value;
  return issue || `当前阶段：${sourceStages[currentIndex]!.name}，第 ${currentIndex + 1} / ${stages.length} 阶段`;
});

async function loadFlow() {
  flowRequest?.abort();
  const versionId = props.project.flow_version_id;
  if (!versionId) {
    flowVersion.value = undefined;
    flowState.value = "unset";
    return;
  }
  if (flowVersion.value?.id === versionId) return;
  const request = new AbortController();
  flowRequest = request;
  flowState.value = "loading";
  try {
    const found = await findFlowVersion(props.services.projectFlows, versionId, request.signal);
    if (request.signal.aborted) return;
    flowVersion.value = found;
    flowState.value = found ? "ready" : "missing";
  } catch {
    if (!request.signal.aborted) flowState.value = "failed";
  }
}

async function loadDocument() {
  documentRequest?.abort();
  const request = new AbortController();
  documentRequest = request;
  const projectId = props.project.id;
  try {
    if (documentId) {
      const page = await props.services.documents.versions(projectId, documentId, { offset: 0, limit: 1 }, request.signal);
      if (request.signal.aborted) return;
      const latest = page.items[0];
      if (!latest || latest.document_id !== documentId || latest.project_id !== projectId) throw new Error("unexpected version page");
      documentVersion.value = latest.version;
    } else {
      const current = await props.services.documents.current(projectId, request.signal);
      if (request.signal.aborted) return;
      if (current.project_id !== projectId) throw new Error("unexpected document");
      documentId = current.id;
      documentVersion.value = current.version;
    }
    documentState.value = "ready";
  } catch (error) {
    if (request.signal.aborted) return;
    if (asApiError(error).code === "DOCUMENT_NOT_FOUND") {
      documentId = undefined;
      documentVersion.value = undefined;
      documentState.value = "none";
    } else documentState.value = "failed";
  }
}

watch(() => [props.project.flow_version_id, props.project.stage_id], loadFlow, { immediate: true });
watch(() => props.refreshKey, loadDocument, { immediate: true });

let timer: ReturnType<typeof setInterval> | undefined;
function refreshClock() {
  now.value = new Date();
}
function refreshOnReturn() {
  if (document.visibilityState === "hidden") return;
  refreshClock();
  void loadDocument();
}
onMounted(() => {
  timer = setInterval(refreshClock, 60_000);
  window.addEventListener("focus", refreshOnReturn);
  document.addEventListener("visibilitychange", refreshOnReturn);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  flowRequest?.abort();
  documentRequest?.abort();
  window.removeEventListener("focus", refreshOnReturn);
  document.removeEventListener("visibilitychange", refreshOnReturn);
});
</script>

<template>
  <div class="project-progress workspace-progress">
    <div class="project-progress__content">
      <div class="project-progress__route" :class="{ 'is-unknown': flowState !== 'ready' || !!progress?.issue }">
        <div v-if="progress?.stages.length" class="project-progress__route-scroll">
          <StageRoute :stages="progress.stages" compact />
        </div>
        <span v-else-if="flowState === 'loading'" class="workspace-progress__pending" aria-hidden="true" />
        <span v-else class="workspace-progress__unset tp-ghost">{{ flowState === "unset" ? "流程未设置" : progressLabel }}</span>
        <span v-if="progress?.stages.length && progress.issue" class="project-progress__issue">阶段待核对</span>
        <button type="button" class="project-progress__open" aria-label="查看毕设阶段进度" :title="progressLabel + '；点击查看完成条件'" @click="open = true" />
      </div>
      <div class="project-progress__meta">
        <RouterLink v-if="deadline.kind === 'unknown'" :to="settings" class="workspace-progress__unset tp-ghost" :aria-label="deadline.label + '，打开项目设置'"
          >截止未设置</RouterLink
        >
        <span v-else class="project-progress__deadline" :data-state="deadline.kind" :aria-label="deadline.label" :title="'项目提交截止：' + project.deadline">
          <template v-if="deadline.kind === 'future'">距论文提交 <b class="tp-num">{{ deadline.days }}</b> 天</template>
          <template v-else-if="deadline.kind === 'overdue'">已逾期 <b class="tp-num">{{ Math.abs(deadline.days!) }}</b> 天</template>
          <template v-else>{{ deadline.label }}</template>
        </span>
        <span class="workspace-progress__version">
          <TpVersion v-if="documentVersion !== undefined" :v="documentVersion" prefix="正文 " />
          <RouterLink
            v-else-if="documentState === 'none'"
            :to="writingRoute(project.id)"
            class="workspace-progress__unset tp-ghost"
            aria-label="尚无正文，打开写作"
            >正文未创建</RouterLink
          >
          <span v-else-if="documentState === 'failed'" class="workspace-progress__unset tp-ghost" title="无法读取正文版本">正文版本未知</span>
        </span>
      </div>
    </div>
    <TpDialog v-model:open="open" title="毕设阶段与完成条件" :description="progressLabel">
      <p class="project-progress__explanation">航线显示项目当前所处阶段，不代表论文质量。查看条件不会切换阶段。</p>
      <div v-if="flowState === 'failed'" class="project-progress__warning screen-actions">
        <span>流程暂时读取失败，项目绑定没有改变。</span><TpButton size="sm" @click="loadFlow">重新读取</TpButton>
      </div>
      <p v-else-if="flowState === 'unset'" class="project-progress__warning">绑定毕设流程与当前阶段后，这里显示阶段航线与完成条件。</p>
      <p v-else-if="flowState === 'missing'" class="project-progress__warning">找不到项目绑定的流程版本，请在项目设置中重新选择。</p>
      <p v-else-if="progress?.issue" class="project-progress__warning">{{ progress.issue }}，请在项目设置中核对绑定。</p>
      <ol v-if="progress" class="project-progress__details">
        <li v-for="(stage, index) in progress.sourceStages" :key="stage.id" :data-current="index === progress.currentIndex">
          <header><b>{{ stage.name }}</b><span v-if="index === progress.currentIndex">当前阶段</span></header>
          <p><span>完成条件</span>{{ stage.conditions.join("；") || "尚未配置" }}</p>
          <p><span>所需产物</span>{{ stage.deliverables.join("；") || "尚未配置" }}</p>
          <p><span>阶段截止</span>{{ stage.deadline || "尚未设置" }}</p>
        </li>
      </ol>
      <template #actions>
        <RouterLink :to="flowState === 'ready' ? flowsRoute : settings" class="tp-btn tp-btn--ghost" @click="open = false">{{
          flowState === "ready" ? "查看流程配置" : "打开项目设置"
        }}</RouterLink>
        <RouterLink :to="tasksRoute(project.id)" class="tp-btn tp-btn--outline" @click="open = false">查看计划</RouterLink>
        <TpButton variant="primary" @click="open = false">关闭</TpButton>
      </template>
    </TpDialog>
  </div>
</template>

<style scoped>
.project-progress {
  min-width: 0;
  container-type: inline-size;
}
.project-progress__content {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) max-content;
  align-items: center;
  gap: 20px;
}
.project-progress__route {
  position: relative;
  min-width: 0;
  max-width: 480px;
  padding: 8px 0;
}
.project-progress__route-scroll {
  min-width: 0;
  overflow-x: auto;
  padding: 4px 0;
}
.project-progress__route :deep(.tp-route) {
  min-width: 280px;
}
.project-progress__open {
  position: absolute;
  inset: 0;
  cursor: pointer;
  border-radius: var(--tp-radius-s);
  background: transparent;
}
.project-progress__open:focus-visible {
  outline: 2px solid var(--tp-focus);
  outline-offset: 2px;
}
.project-progress__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  min-width: 0;
  font-size: 12px;
  color: var(--tp-text-muted);
}
.project-progress__deadline {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}
.project-progress__deadline b {
  color: var(--tp-text);
  font-size: 24px;
  line-height: 1;
}
.project-progress__deadline[data-state="overdue"],
.project-progress__deadline[data-state="overdue"] b {
  color: var(--tp-danger-content);
}
.workspace-progress__version {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-left: 1px solid var(--tp-line);
  padding-left: 12px;
  white-space: nowrap;
}
.workspace-progress__unset {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 2px 10px;
  border-radius: var(--tp-radius-s);
  color: var(--tp-text-muted);
  font-size: 12px;
  white-space: nowrap;
}
a.workspace-progress__unset:hover {
  color: var(--tp-text);
}
.workspace-progress__pending {
  display: block;
  height: 28px;
  max-width: 280px;
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
}
.project-progress__issue {
  display: block;
  margin-top: 4px;
  color: var(--tp-text-muted);
  font-size: 12px;
  text-align: center;
}
.project-progress__explanation,
.project-progress__warning {
  font-size: 13px;
  line-height: 1.7;
  color: var(--tp-text-muted);
  margin-bottom: 16px;
}
.project-progress__warning {
  padding: 12px;
  border: 1px dashed var(--tp-ghost-line);
}
.project-progress__details {
  display: grid;
  gap: 12px;
  max-height: 48vh;
  overflow-y: auto;
}
.project-progress__details li {
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  padding: 12px 16px;
}
.project-progress__details li[data-current="true"] {
  border-color: var(--tp-accent);
  background-color: color-mix(in srgb, var(--tp-accent) 5%, var(--tp-surface));
}
.project-progress__details header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.project-progress__details header > span,
.project-progress__details p {
  font-size: 12px;
  line-height: 1.7;
}
.project-progress__details p {
  overflow-wrap: anywhere;
}
.project-progress__details p > span {
  display: inline-block;
  color: var(--tp-text-muted);
  margin-right: 12px;
}
@container (max-width: 580px) {
  .project-progress__content {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
  .project-progress__route {
    max-width: none;
    padding: 4px 0;
  }
  .project-progress__meta {
    justify-content: center;
    gap: 8px;
    padding-bottom: 4px;
  }
  .project-progress__deadline b {
    font-size: 20px;
  }
  .workspace-progress__version {
    padding-left: 8px;
  }
}
</style>
