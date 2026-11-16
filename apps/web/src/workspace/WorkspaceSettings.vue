<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from "vue";
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
  { value: "api", label: "AI 接口" },
  { value: "model", label: "模型" },
  { value: "workflow", label: "阶段流程" },
  { value: "business", label: "业务设置" },
  { value: "runs", label: "运行记录" },
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

const counts = ref<{ enabled: number; total: number }>();
let countRequest: AbortController | undefined;
async function loadCounts() {
  countRequest?.abort();
  const controller = new AbortController();
  countRequest = controller;
  let enabled = 0;
  let total = 0;
  try {
    for (const kind of libraries) {
      let next = 0;
      do {
        const page = await props.services.aiConfigs.list({ kind, offset: next, limit: 100 }, controller.signal);
        if (controller.signal.aborted) return;
        enabled += page.items.filter((item) => item.enabled).length;
        total = total + page.items.length;
        next += page.items.length;
        if (!page.items.length || next >= page.total) break;
      } while (!controller.signal.aborted);
    }
    counts.value = { enabled, total };
  } catch {
    // The summary is informational; the library lists report their own failures.
    if (!controller.signal.aborted) counts.value = undefined;
  }
}
onMounted(() => void loadCounts());
onScopeDispose(() => countRequest?.abort());
</script>

<template>
  <Transition appear name="tp-page">
    <div class="screen-page workspace-page settings-page">
      <header class="screen-heading">
        <div>
          <p class="tp-label">Configuration · 有据可依，有迹可循</p>
          <h1 class="tp-display mt-3">配置台</h1>
          <p class="screen-lead">让助手知道边界，让每次运行都有一份可追溯的配置。</p>
        </div>
        <div v-if="counts" class="settings-summary">
          <span class="tp-label">已启用配置</span>
          <strong>{{ counts.enabled }}<small> / {{ counts.total }}</small></strong>
        </div>
      </header>
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
          @changed="loadCounts"
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
.settings-summary {
  display: grid;
  gap: 4px;
  min-width: 140px;
  color: var(--tp-text-muted);
  font-size: 12px;
}
.settings-summary strong {
  font-family: var(--tp-font-display);
  font-size: 28px;
  line-height: 1.2;
  color: var(--tp-text);
}
.settings-summary small {
  font-size: 16px;
  color: var(--tp-text-faint);
  font-weight: 400;
}
.settings-tabs {
  overflow-x: auto;
  max-width: 100%;
}
.settings-tabs :deep(.tp-tabs) {
  min-width: max-content;
}
</style>
