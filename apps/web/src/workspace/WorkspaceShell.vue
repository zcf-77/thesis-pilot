<script setup lang="ts">
import { PhMagnifyingGlass, PhNotebook, PhNotePencil, PhUser, PhListChecks, PhSlidersHorizontal, PhFolder, PhChatText } from "@phosphor-icons/vue";
import { onKeyStroke } from "@vueuse/core";
import { computed, nextTick, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpState from "@/components/ui/TpState.vue";
import LabLogo from "@/lab/LabLogo.vue";
import JobTray from "@/lab/components/JobTray.vue";
import { createServiceJobsState } from "@/lab/state/serviceJobs";
import type { BackendServices, JobRead } from "@/services";
import type { WorkspaceProfile, WorkspaceSession } from "@/services/workspace";
import WorkspaceAccount from "./WorkspaceAccount.vue";
import WorkspaceCommands from "./WorkspaceCommands.vue";
import WorkspaceJobs from "./WorkspaceJobs.vue";
import WorkspaceProjects from "./WorkspaceProjects.vue";
import WorkspaceFlows from "./WorkspaceFlows.vue";
import WorkspaceConfigurations from "./WorkspaceConfigurations.vue";
import WorkspaceMaterials from "./WorkspaceMaterials.vue";
import WorkspaceTasks from "./WorkspaceTasks.vue";
import WorkspaceFeedback from "./WorkspaceFeedback.vue";
import WorkspaceWriting from "./WorkspaceWriting.vue";
import { useWorkspaceProject } from "./useWorkspaceProject";
import {
  accountRoute,
  configurationsRoute,
  flowsRoute,
  feedbackRoute,
  jobRoute,
  materialsRoute,
  projectJobsRoute,
  projectsRoute,
  resolveWorkspaceRoute,
  tasksRoute,
  versionRoute,
  writingRoute,
} from "./workspaceRoutes";

const props = defineProps<{ session: WorkspaceSession; services: BackendServices; exiting: boolean; exitError: string }>();
const emit = defineEmits<{ exit: []; profileSaved: [profile: WorkspaceProfile] }>();
const route = useRoute();
const router = useRouter();
const view = computed(() => resolveWorkspaceRoute(route, props.services.sourceKey));
const routeProjectId = computed(() => ("projectId" in view.value ? view.value.projectId : undefined));
const { project, status, reload } = useWorkspaceProject(props.services.projects, `${props.services.sourceKey}:${props.session.workspace_id}`, routeProjectId);
const activeProjectId = computed(() => (props.exiting ? undefined : project.value?.id));
const jobs = createServiceJobsState(props.services, activeProjectId, props.session.workspace_id);
const jobDirectory = computed(() => projectJobsRoute(project.value?.id));
const commandOpen = ref(false);
const content = ref<HTMLElement>();
const pageIdentity = computed(() => `${view.value.page}:${routeProjectId.value ?? ""}`);

watch(
  [view, project, status],
  ([screen, current, state]) => {
    if (screen.page !== "home" || props.exiting) return;
    if (current) void router.replace(writingRoute(current.id));
    else if (state === "idle" || state === "missing") void router.replace(projectsRoute);
  },
  { immediate: true, flush: "post" },
);

watch(
  pageIdentity,
  async (page) => {
    await nextTick();
    if (page !== pageIdentity.value) return;
    content.value?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  },
  { immediate: true },
);
watch(
  () => props.exiting,
  (exiting) => {
    if (exiting) commandOpen.value = false;
  },
);

onKeyStroke(["k", "K"], (event) => {
  if ((!event.ctrlKey && !event.metaKey) || event.isComposing || props.exiting) return;
  event.preventDefault();
  if (!event.repeat) commandOpen.value = !commandOpen.value;
});

function navigate(target: RouteLocationRaw) {
  if (!props.exiting) void router.push(target);
}

const jobDetails = (job: JobRead) => jobRoute(job.project_id, job.id, props.services.sourceKey);
</script>

<template>
  <div class="screens-shell workspace-shell" :inert="exiting">
    <a href="#workspace-content" class="screens-skip" @click.prevent="content?.focus()">跳到页面内容</a>
    <aside class="screens-rail">
      <RouterLink :to="projectsRoute" class="screens-home" aria-label="ThesisPilot 项目目录"><LabLogo :size="34" /></RouterLink>
      <nav class="screens-nav" aria-label="工作区">
        <RouterLink :to="projectsRoute" :aria-current="view.page === 'projects' ? 'page' : undefined"><TpIcon :icon="PhNotebook" :size="20" />项目</RouterLink>
        <RouterLink v-if="project" :to="writingRoute(project.id)" :aria-current="view.page === 'writing' ? 'page' : undefined">
          <TpIcon :icon="PhNotePencil" :size="20" />写作
        </RouterLink>
        <RouterLink v-if="project" :to="materialsRoute(project.id)" :aria-current="view.page === 'materials' ? 'page' : undefined">
          <TpIcon :icon="PhFolder" :size="20" />资料
        </RouterLink>
        <RouterLink v-if="project" :to="tasksRoute(project.id)" :aria-current="view.page === 'tasks' ? 'page' : undefined">
          <TpIcon :icon="PhListChecks" :size="20" />论文任务
        </RouterLink>
        <RouterLink v-if="project" :to="feedbackRoute(project.id)" :aria-current="view.page === 'feedback' ? 'page' : undefined">
          <TpIcon :icon="PhChatText" :size="20" />反馈
        </RouterLink>
        <RouterLink :to="accountRoute" :aria-current="view.page === 'account' ? 'page' : undefined"><TpIcon :icon="PhUser" :size="20" />账户</RouterLink>
        <RouterLink :to="flowsRoute" :aria-current="view.page === 'flows' ? 'page' : undefined"><TpIcon :icon="PhListChecks" :size="20" />流程</RouterLink>
        <RouterLink :to="configurationsRoute" :aria-current="view.page === 'configurations' ? 'page' : undefined"
          ><TpIcon :icon="PhSlidersHorizontal" :size="20" />四库</RouterLink
        >
      </nav>
      <JobTray :formal="{ state: jobs, directory: jobDirectory, detail: jobDetails, inactive: exiting }" />
    </aside>
    <div class="screens-workspace">
      <header class="screens-topbar">
        <RouterLink v-if="project" :to="projectsRoute" class="screens-project" aria-label="切换论文项目">
          <TpIcon :icon="PhNotebook" :size="20" class="text-fg-muted" />
          <span><b :title="project.name">{{ project.name }}</b></span>
        </RouterLink>
        <span v-else class="workspace-wordmark">ThesisPilot</span>
        <button class="screens-tool workspace-search" type="button" aria-label="搜索工作区（Ctrl 或 ⌘ + K）" @click="commandOpen = true">
          <TpIcon :icon="PhMagnifyingGlass" :size="19" /><span>搜索</span><kbd class="tp-kbd">Ctrl K</kbd>
        </button>
      </header>

      <main
        id="workspace-content"
        ref="content"
        class="screens-content"
        :class="{ 'screens-content--write': view.page === 'writing' && !!project }"
        tabindex="-1"
      >
        <WorkspaceProjects
          v-if="view.page === 'projects'"
          :projects="services.projects"
          :project-flows="services.projectFlows"
          :current-id="project?.id"
          @created="navigate(writingRoute($event.id))"
        />
        <WorkspaceFlows v-else-if="view.page === 'flows'" :project-flows="services.projectFlows" />
        <WorkspaceConfigurations v-else-if="view.page === 'configurations'" :services="services" :project="project" @open-job="navigate(jobDetails($event))" />
        <WorkspaceAccount
          v-else-if="view.page === 'account'"
          :session="session"
          :exiting="exiting"
          :exit-error="exitError"
          @exit="$emit('exit')"
          @profile-saved="$emit('profileSaved', $event)"
        />
        <TpState v-else-if="view.page === 'invalid'" class="screen-panel" kind="noresult" title="此工作区链接不可用">
          <RouterLink v-if="project && view.projectId === project.id" :to="writingRoute(project.id)" class="tp-btn tp-btn--outline tp-btn--sm"
            >打开写作台</RouterLink
          >
          <RouterLink :to="projectsRoute" class="tp-btn tp-btn--outline tp-btn--sm">返回项目</RouterLink>
        </TpState>
        <WorkspaceJobs
          v-else-if="view.page === 'jobs' && (project || !routeProjectId)"
          :project="project"
          :selected-id="'jobId' in view ? view.jobId : undefined"
          :state="jobs"
          :source="services.sourceKey"
        />
        <WorkspaceMaterials
          v-else-if="view.page === 'materials' && project"
          :key="`${session.workspace_id}:${project.id}`"
          :services="services"
          :project="project"
          @open-job="navigate(jobDetails($event))"
        />
        <WorkspaceTasks
          v-else-if="view.page === 'tasks' && project"
          :key="`${session.workspace_id}:${project.id}`"
          :services="services"
          :project="project"
          :workspace-id="session.workspace_id"
        />
        <WorkspaceFeedback
          v-else-if="view.page === 'feedback' && project"
          :key="`${session.workspace_id}:${project.id}`"
          :services="services"
          :project="project"
          :workspace-id="session.workspace_id"
        />
        <WorkspaceWriting
          v-else-if="view.page === 'writing' && project"
          :key="`${session.workspace_id}:${project.id}`"
          :project="project"
          :workspace-id="session.workspace_id"
          :services="services"
          :jobs="jobs"
          :history-link="'historyLink' in view ? view.historyLink : undefined"
          :active="!exiting"
          @open-version="navigate(versionRoute($event))"
          @close-version="project && navigate(writingRoute(project.id))"
          @open-projects="navigate(projectsRoute)"
        />
        <TpState v-else-if="status === 'missing'" class="screen-panel" kind="noresult" title="未找到此论文项目">
          <RouterLink :to="projectsRoute" class="tp-btn tp-btn--outline tp-btn--sm">返回项目</RouterLink>
        </TpState>
        <TpState
          v-else-if="status === 'failed'"
          class="screen-panel"
          kind="error"
          title="无法读取论文项目"
          desc="请检查服务连接后重试。"
          retryable
          @retry="reload"
        >
          <RouterLink :to="projectsRoute" class="tp-btn tp-btn--outline tp-btn--sm">返回项目</RouterLink>
        </TpState>
        <div v-else class="screen-panel studio-body workspace-loading" role="status" aria-busy="true">
          <span class="tp-btn__spinner" aria-hidden="true" />正在读取项目…
        </div>
      </main>
    </div>
    <WorkspaceCommands v-if="!exiting" v-model:open="commandOpen" :projects="services.projects" :current="project" @navigate="navigate" />
  </div>
</template>
