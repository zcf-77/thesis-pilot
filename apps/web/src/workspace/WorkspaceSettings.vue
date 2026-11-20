<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import TpTabs from "@/components/ui/TpTabs.vue";
import type { BackendServices, JobRead, ProjectRead } from "@/services";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import WorkspaceConfigurations from "./WorkspaceConfigurations.vue";
import WorkspaceFlows from "./WorkspaceFlows.vue";
import ConfigurationRuns from "./configurations/ConfigurationRuns.vue";
import ReminderSettings from "./configurations/ReminderSettings.vue";
import type { ConfigurationLibrary } from "./configurations/configurationEditor";
import { configurationsRoute, flowsRoute } from "./workspaceRoutes";

type Panel = ConfigurationLibrary | "workflow" | "business" | "runs";
const props = defineProps<{ services: BackendServices; project?: ProjectRead | null; tab: "flows" | "configurations" }>();
const emit = defineEmits<{ openJob: [job: JobRead] }>();
const route = useRoute();
const router = useRouter();

const libraries: ConfigurationLibrary[] = ["agent", "prompt", "api", "model"];
const tabs: { value: Panel; label: string }[] = [
  { value: "agent", label: "智能体" },
  { value: "prompt", label: "提示词" },
  { value: "model", label: "模型" },
  { value: "api", label: "AI 接口" },
  { value: "workflow", label: "阶段流程" },
  { value: "runs", label: "运行记录" },
  { value: "business", label: "提醒参数" },
];
const queryText = (value: unknown) => (typeof value === "string" ? value : undefined);
const panel = computed<Panel>(() => {
  if (props.tab === "flows") return "workflow";
  if (queryText(route.query.tab) === "runs") return "runs";
  if (queryText(route.query.tab) === "business") return "business";
  const kind = queryText(route.query.kind);
  return libraries.find((item) => item === kind) ?? "agent";
});
const current = computed({
  get: () => panel.value,
  set(next: Panel) {
    if (next === panel.value) return;
    if (next === "workflow") void router.push(flowsRoute);
    else if (next === "runs" || next === "business") void router.push({ ...configurationsRoute, query: { tab: next } });
    else void router.push({ ...configurationsRoute, query: { kind: next } });
  },
});
const library = computed(() => (libraries.find((item) => item === panel.value) ? (panel.value as ConfigurationLibrary) : undefined));
const focusId = computed(() => queryText(route.query.config));
const group = computed(() => (library.value ? "library" : panel.value));

function openKind(kind: ConfigurationLibrary, id: string) {
  void router.push({ ...configurationsRoute, query: { kind, config: id } });
}
</script>

<template>
  <Transition appear name="tp-page">
    <div class="screen-page workspace-page settings-page">
      <header class="screen-heading"><h1 class="tp-display">配置台</h1></header>
      <div class="settings-tabs"><TpTabs v-model="current" :tabs="tabs" label="配置台模块" /></div>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <WorkspaceFlows v-if="panel === 'workflow'" :key="group" :project-flows="services.projectFlows" />
        <ConfigurationRuns v-else-if="panel === 'runs'" :key="group" :services="services" :project="project" @open-job="emit('openJob', $event)" />
        <ReminderSettings v-else-if="panel === 'business'" :key="group" :services="services" />
        <WorkspaceConfigurations
          v-else-if="library"
          :key="group"
          :services="services"
          :project="project"
          :kind="library"
          :focus-id="focusId"
          @open-job="emit('openJob', $event)"
          @open-kind="openKind"
        />
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.settings-page {
  display: grid;
  gap: 16px;
  align-content: start;
}
.settings-tabs {
  overflow-x: auto;
  max-width: 100%;
}
.settings-tabs :deep(.tp-tabs) {
  min-width: max-content;
}
</style>
