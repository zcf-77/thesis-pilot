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
      <span class="tp-label">你的毕设航线{{ flow ? ` · ${flow.name} v${flow.version}` : "" }}</span
      ><RouterLink class="tp-caption plan-link" :to="projectsRoute">{{ current ? `当前 · ${current.name} · ` : "" }}项目设置 ↗</RouterLink>
    </div>
    <Transition name="tp-swap" mode="out-in">
      <div v-if="stages.length" key="route" class="plan-route__scroll"><StageRoute :stages="stages" /></div>
      <p v-else-if="loading" key="loading" class="tp-caption" role="status"><span class="tp-btn__spinner" aria-hidden="true" />正在读取流程阶段…</p>
      <div v-else-if="error" key="error" class="tp-ghost plan-route__blank" role="alert">
        <span>{{ error }}项目设置保持不变。</span><TpButton size="sm" variant="ghost" @click="load">重新读取流程</TpButton>
      </div>
      <p v-else key="unbound" class="tp-ghost plan-route__blank">
        项目尚未绑定流程与当前阶段。<RouterLink :to="projectsRoute" class="plan-link">在项目设置中绑定 ↗</RouterLink>
      </p>
    </Transition>
    <p v-if="stages.length && !current" class="tp-caption plan-route__hint">当前阶段不在绑定流程中，请核对项目设置。</p>
  </section>
</template>

<style scoped>
.plan-route {
  padding: 20px 24px 24px;
}
.plan-route__intro {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
}
.plan-route__scroll {
  overflow-x: auto;
}
.plan-route__scroll > * {
  min-width: 540px;
}
.plan-route__blank {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 16px;
  line-height: 1.8;
}
.plan-route__hint {
  margin-top: 12px;
}
.plan-link {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.tp-btn__spinner {
  margin-right: 8px;
}
@media (max-width: 700px) {
  .plan-route {
    padding: 16px;
  }
}
</style>
