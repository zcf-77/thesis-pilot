<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { RouterLink } from "vue-router";
import StageRoute from "@/components/domain/StageRoute.vue";
import TpButton from "@/components/ui/TpButton.vue";
import type { BackendServices, ProjectRead } from "@/services";
import type { FlowStage } from "@/services/contracts/api.generated";
import { asApiError } from "@/services/errors";
import { projectsRoute } from "../workspaceRoutes";
import { stageViews } from "./taskBoard";

const props = defineProps<{ services: BackendServices; project: ProjectRead }>();
const flow = shallowRef<{ name: string; version: number; stages: FlowStage[] }>();
const loading = ref(false);
const error = ref("");
const stages = computed(() => (flow.value ? stageViews(flow.value.stages, props.project.stage_id) : []));
const current = computed(() => stages.value.find((stage) => stage.state === "current"));
const currentStage = computed(() => flow.value?.stages.find((stage) => stage.id === props.project.stage_id && stage.enabled !== false));
let request: AbortController | undefined;

/** 项目只保存不可变流程版本 ID；逐个流程查找该版本，不假设它是最新版本。 */
async function load() {
  request?.abort();
  flow.value = undefined;
  error.value = "";
  const target = props.project.flow_version_id;
  if (!target) return;
  const controller = new AbortController();
  request = controller;
  loading.value = true;
  try {
    for (let offset = 0; ;) {
      const page = await props.services.projectFlows.list({ offset, limit: 100 }, controller.signal);
      for (const item of page.items) {
        if (item.current_version_id === target) {
          flow.value = { name: item.name, version: item.version, stages: item.stages };
          return;
        }
        for (let versionOffset = 0; ;) {
          const versions = await props.services.projectFlows.versions(item.id, { offset: versionOffset, limit: 100 }, controller.signal);
          const found = versions.items.find((version) => version.id === target);
          if (found) {
            flow.value = { name: found.name, version: found.version, stages: found.stages };
            return;
          }
          versionOffset += versions.items.length;
          if (!versions.items.length || versionOffset >= versions.total) break;
        }
      }
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) break;
    }
    if (!controller.signal.aborted) error.value = "未找到项目绑定的流程版本。";
  } catch (issue) {
    if (!controller.signal.aborted) error.value = asApiError(issue).message;
  } finally {
    if (request === controller) loading.value = false;
  }
}
watch(() => [props.project.id, props.project.flow_version_id], load, { immediate: true });
onScopeDispose(() => request?.abort());
</script>

<template>
  <section class="screen-panel plan-route" aria-label="毕业论文阶段" :aria-busy="loading || undefined">
    <div class="plan-route__intro">
      <div class="plan-route__current">
        <span class="tp-label">当前阶段</span>
        <strong>{{ current?.name ?? (loading ? "读取中" : flow ? "未定位" : "尚未绑定") }}</strong>
        <span v-if="flow" class="tp-caption">{{ flow.name }} · v{{ flow.version }}</span>
      </div>
      <RouterLink class="tp-caption plan-link" :to="projectsRoute">项目设置 ↗</RouterLink>
    </div>
    <details v-if="currentStage" class="tp-disclosure plan-route__requirements">
      <summary class="tp-caption">阶段要求</summary>
      <div class="plan-route__definition">
        <p v-if="currentStage.description">{{ currentStage.description }}</p>
        <p><span>完成条件</span>{{ currentStage.conditions.join("；") || "尚未配置" }}</p>
        <p><span>所需产物</span>{{ currentStage.deliverables.join("；") || "尚未配置" }}</p>
        <p><span>阶段期限</span>{{ currentStage.start || "未设开始" }} — {{ currentStage.deadline || "未设截止" }}</p>
      </div>
    </details>
    <Transition name="tp-swap" mode="out-in">
      <div v-if="stages.length" key="route" class="plan-route__scroll"><StageRoute :stages="stages" compact /></div>
      <p v-else-if="loading" key="loading" class="tp-caption plan-route__state" role="status">
        <span class="tp-btn__spinner" aria-hidden="true" />正在读取流程…
      </p>
      <div v-else-if="error" key="error" class="tp-ghost plan-route__blank" role="alert">
        <span>{{ error }}项目设置保持不变。</span><TpButton size="sm" variant="ghost" @click="load">重新读取</TpButton>
      </div>
      <p v-else key="unbound" class="tp-ghost plan-route__blank">
        尚未绑定流程。<RouterLink :to="projectsRoute" class="plan-link">在项目设置中绑定 ↗</RouterLink>
      </p>
    </Transition>
    <p v-if="stages.length && !current" class="tp-caption plan-route__hint" role="alert">当前阶段不在绑定流程中，请核对项目设置。</p>
  </section>
</template>

<style scoped>
.plan-route {
  padding: 16px 20px 12px;
}
.plan-route__intro,
.plan-route__current {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.plan-route__intro {
  justify-content: space-between;
}
.plan-route__current > strong {
  font-size: 14px;
}
.plan-route__requirements {
  margin-top: 8px;
}
.plan-route__definition {
  display: grid;
  gap: 8px;
  padding: 12px 0 4px;
  font-size: 13px;
}
.plan-route__definition p > span {
  display: inline-block;
  min-width: 72px;
  color: var(--tp-text-muted);
}
.plan-route__scroll {
  overflow-x: auto;
  margin-top: 8px;
}
.plan-route__scroll > * {
  min-width: 520px;
}
.plan-route__blank {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 12px;
  margin-top: 12px;
}
.plan-route__state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-block: 16px 8px;
}
.plan-route__hint {
  margin-top: 8px;
  color: var(--tp-warning-content);
}
.plan-link {
  min-height: 28px;
  text-decoration: underline;
  text-underline-offset: 4px;
}
@media (max-width: 700px) {
  .plan-route {
    padding: 16px 16px 12px;
  }
}
</style>
