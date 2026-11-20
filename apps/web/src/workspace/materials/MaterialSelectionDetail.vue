<script setup lang="ts">
import { computed } from "vue";
import { PhBookOpen, PhFolderOpen } from "@phosphor-icons/vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import type { BackendServices, JobRead } from "@/services";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import MaterialDetail from "./MaterialDetail.vue";
import LiteratureDetail from "./LiteratureDetail.vue";
import type { LiteratureState } from "./useLiterature";
import type { SourceBindingState } from "./useSourceBinding";
import type { MaterialTab } from "./materialPresentation";

type Material = Awaited<ReturnType<BackendServices["materials"]["get"]>>;
const props = defineProps<{
  services: BackendServices;
  projectId: string;
  tab: MaterialTab;
  selected?: Material;
  preferredOriginal?: string;
  query: string;
  binding: SourceBindingState;
  literature: LiteratureState;
  catalogEmpty: boolean;
}>();
const emit = defineEmits<{
  changed: [material: Material];
  openJob: [job: JobRead];
  jobUpdated: [material: Material, job: JobRead];
  append: [material: Material];
  showRequirements: [];
}>();
const literatureKey = computed(() => {
  const value = props.literature.selection.value;
  return value ? (value.kind === "entry" ? `entry:${value.id}` : `result:${props.literature.search.value?.id}:${value.index}`) : "none";
});
</script>

<template>
  <Transition v-if="tab === 'literature'" name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
    <LiteratureDetail
      v-if="literature.selectedResult.value || literature.selectedEntry.value"
      :key="literatureKey"
      :state="literature"
      :services="services"
      :project-id="projectId"
    />
    <div v-else key="empty" class="tp-ghost selection-empty">
      <TpIcon :icon="PhBookOpen" :size="28" />
      <h2 class="tp-subheading">选择一篇文献</h2>
      <p class="tp-caption">查看来源、取得范围与可用操作。</p>
    </div>
  </Transition>
  <Transition v-else name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
    <MaterialDetail
      v-if="selected"
      :key="selected.id"
      :services="services"
      :project-id="projectId"
      :material="selected"
      :preferred-original="preferredOriginal"
      :query="query"
      :binding="binding"
      :requirements-tab="tab === 'requirements'"
      @changed="emit('changed', $event)"
      @open-job="emit('openJob', $event)"
      @job-updated="(material, job) => emit('jobUpdated', material, job)"
      @append="emit('append', $event)"
      @show-requirements="emit('showRequirements')"
    />
    <div v-else key="empty" class="tp-ghost selection-empty">
      <TpIcon :icon="PhFolderOpen" :size="28" />
      <h2 class="tp-subheading">{{ catalogEmpty ? "从第一份资料开始" : "选择一份资料" }}</h2>
      <p class="tp-caption">查看原件、解析状态与可用操作。</p>
    </div>
  </Transition>
</template>

<style scoped>
.selection-empty {
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 12px;
  min-height: 280px;
  padding: 32px 16px;
  text-align: center;
  color: var(--tp-text-muted);
}
</style>
