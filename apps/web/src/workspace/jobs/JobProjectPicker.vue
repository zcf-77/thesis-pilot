<script setup lang="ts">
import { PhArrowRight, PhNotebook } from "@phosphor-icons/vue";
import { computed, onMounted, onScopeDispose, ref, shallowRef } from "vue";
import { RouterLink } from "vue-router";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpState from "@/components/ui/TpState.vue";
import { listMotionHooks } from "@/design/motion";
import type { ProjectRead, ProjectService } from "@/services";
import { asApiError } from "@/services/errors";
import { readAll } from "../projects/flowCatalog";
import { projectJobsRoute, projectsRoute } from "../workspaceRoutes";

const props = defineProps<{ projects: ProjectService }>();
const items = shallowRef<ProjectRead[]>();
const busy = ref(true);
const error = ref("");
const active = computed(() => items.value?.filter((project) => !project.archived) ?? []);
let request: AbortController | undefined;

async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  error.value = "";
  try {
    const all = await readAll((query) => props.projects.list(query, controller.signal), controller.signal);
    if (!controller.signal.aborted) items.value = all;
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    if (request === controller) busy.value = false;
  }
}

onMounted(() => void load());
onScopeDispose(() => request?.abort());
</script>

<template>
  <section class="screen-panel" aria-labelledby="job-project-picker" :aria-busy="busy || undefined">
    <header class="screen-panel__head"><h2 id="job-project-picker" class="tp-subheading">选择要查看任务的项目</h2></header>
    <Transition name="tp-swap" mode="out-in">
      <div v-if="busy && !items" key="loading" class="studio-body workspace-loading" role="status">
        <span class="tp-btn__spinner" aria-hidden="true" />正在读取项目…
      </div>
      <TpState v-else-if="error" key="error" kind="error" title="无法读取项目" :desc="error" retryable @retry="load" />
      <TpState v-else-if="!active.length" key="empty" kind="empty" title="还没有进行中的项目">
        <RouterLink class="tp-btn tp-btn--outline tp-btn--sm" :to="projectsRoute">打开项目目录</RouterLink>
      </TpState>
      <TransitionGroup v-else key="list" name="tp-list" tag="ul" class="workspace-project-list tp-list-group" v-bind="listMotionHooks">
        <li v-for="project in active" :key="project.id">
          <RouterLink :to="projectJobsRoute(project.id)" class="workspace-project-row">
            <span class="workspace-project-icon"><TpIcon :icon="PhNotebook" :size="20" /></span>
            <span class="workspace-project-detail">
              <strong>{{ project.name }}</strong>
              <span v-if="project.title" class="tp-caption">{{ project.title }}</span>
            </span>
            <TpIcon :icon="PhArrowRight" class="workspace-project-arrow" />
          </RouterLink>
        </li>
      </TransitionGroup>
    </Transition>
  </section>
</template>
