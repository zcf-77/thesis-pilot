<script setup lang="ts">
import {
  PhBooks,
  PhChatTeardropText,
  PhClock,
  PhMagnifyingGlass,
  PhNotePencil,
  PhPath,
  PhSlidersHorizontal,
  PhSunHorizon,
  PhUser,
  PhExport,
  PhExam,
} from "@phosphor-icons/vue";
import { onKeyStroke } from "@vueuse/core";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue";
import { RouterLink, useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpState from "@/components/ui/TpState.vue";
import LabLogo from "@/lab/LabLogo.vue";
import JobTray from "@/lab/components/JobTray.vue";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { createServiceJobsState } from "@/lab/state/serviceJobs";
import type { BackendServices, JobRead, ProjectRead } from "@/services";
import type { WorkspaceProfile, WorkspaceSession } from "@/services/workspace";
import WorkspaceAccount from "./WorkspaceAccount.vue";
import WorkspaceCommands from "./WorkspaceCommands.vue";
import WorkspaceJobs from "./WorkspaceJobs.vue";
import WorkspaceProjects from "./WorkspaceProjects.vue";
import WorkspaceSettings from "./WorkspaceSettings.vue";
import WorkspaceMaterials from "./WorkspaceMaterials.vue";
import WorkspaceTasks from "./WorkspaceTasks.vue";
import WorkspaceFeedback from "./WorkspaceFeedback.vue";
import WorkspaceReview from "./review/WorkspaceReview.vue";
import WorkspaceWriting from "./WorkspaceWriting.vue";
import WorkspaceProgress from "./shell/WorkspaceProgress.vue";
import WorkspaceToday from "./today/WorkspaceToday.vue";
import WorkspaceInbox from "./inbox/WorkspaceInbox.vue";
import WorkspaceExport from "./export/WorkspaceExport.vue";
import InboxBell from "./inbox/InboxBell.vue";
import { useInboxCount } from "./inbox/useInboxCount";
import WorkspaceProjectSwitcher from "./shell/WorkspaceProjectSwitcher.vue";
import { useWorkspaceProject } from "./useWorkspaceProject";
import {
  accountRoute,
  configurationsRoute,
  feedbackRoute,
  flowsRoute,
  inboxRoute,
  exportRoute,
  reviewRoute,
  jobRoute,
  materialsRoute,
  projectJobsRoute,
  projectsRoute,
  resolveWorkspaceRoute,
  rootRoute,
  tasksRoute,
  todayRoute,
  versionRoute,
  workspaceSpace,
  writingRoute,
  type WorkspaceSpace,
} from "./workspaceRoutes";

const props = defineProps<{ session: WorkspaceSession; services: BackendServices; exiting: boolean; locked?: boolean; exitError: string }>();
const emit = defineEmits<{ exit: []; profileSaved: [profile: WorkspaceProfile] }>();
const route = useRoute();
const router = useRouter();
const view = computed(() => resolveWorkspaceRoute(route, props.services.sourceKey));
const routeProjectId = computed(() => ("projectId" in view.value ? view.value.projectId : undefined));
const {
  project,
  status,
  requestedId,
  reload,
  sync,
  replace: replaceProject,
} = useWorkspaceProject(props.services.projects, `${props.services.sourceKey}:${props.session.workspace_id}`, routeProjectId);
const inactive = computed(() => props.exiting || !!props.locked);
const activeProjectId = computed(() => (props.exiting ? undefined : project.value?.id));
const jobs = createServiceJobsState(props.services, activeProjectId, props.session.workspace_id);
const inbox = useInboxCount(props.services.notifications, activeProjectId);
const jobDirectory = computed(() => projectJobsRoute(project.value?.id));
const commandOpen = ref(false);
const content = ref<HTMLElement>();
const navigation = ref<HTMLElement>();
const pageIdentity = computed(() => `${view.value.page}:${routeProjectId.value ?? ""}`);
// 写作页报告正式稿版本变化时递增，让顶栏进度重新读取正文版本。
const documentRevision = ref(0);
const space = computed(() => workspaceSpace(view.value.page));
const displayName = computed(() => props.session.profile.display_name.trim());
const initial = computed(() => Array.from(displayName.value)[0]);

const spaces = computed<{ id: WorkspaceSpace; title: string; icon: Component; to: RouteLocationRaw }[]>(() => {
  const current = project.value;
  return [
    ...(current
      ? [
          { id: "today" as const, title: "今日", icon: PhSunHorizon, to: todayRoute(current.id) },
          { id: "write" as const, title: "写作", icon: PhNotePencil, to: writingRoute(current.id) },
          { id: "plan" as const, title: "计划", icon: PhPath, to: tasksRoute(current.id) },
          { id: "library" as const, title: "资料", icon: PhBooks, to: materialsRoute(current.id) },
          { id: "feedback" as const, title: "反馈", icon: PhChatTeardropText, to: feedbackRoute(current.id) },
          { id: "review" as const, title: "评审", icon: PhExam, to: reviewRoute(current.id) },
        ]
      : []),
    // Flows and the four libraries share one 配置 space; the settings page decides which tab is open.
    { id: "settings", title: "配置", icon: PhSlidersHorizontal, to: view.value.page === "flows" ? flowsRoute : configurationsRoute },
  ];
});

const jobDetails = (job: JobRead) => jobRoute(job.project_id, job.id, props.services.sourceKey);

/**
 * Each cache partition belongs to one requested project, so cached forms never cross projects.
 * Cached pages re-read server data in onActivated, so a returning view never shows data changed on another page.
 */
const cacheKey = computed(() => `${props.session.workspace_id}:${requestedId.value ?? ""}`);
const page = computed<{ id: string; component: Component; props: Record<string, unknown> } | undefined>(() => {
  const screen = view.value;
  const current = project.value;
  const { services } = props;
  if (screen.page === "projects")
    return {
      id: "projects",
      component: WorkspaceProjects,
      props: {
        projects: services.projects,
        projectFlows: services.projectFlows,
        services,
        currentId: current?.id,
        onCreated: (created: { id: string }) => navigate(writingRoute(created.id)),
      },
    };
  if (screen.page === "flows" || screen.page === "configurations")
    return {
      id: "settings",
      component: WorkspaceSettings,
      props: { services, project: current, tab: screen.page, onOpenJob: (job: JobRead) => navigate(jobDetails(job)) },
    };
  if (screen.page === "account")
    return {
      id: "account",
      component: WorkspaceAccount,
      props: {
        session: props.session,
        exiting: props.exiting,
        exitError: props.exitError,
        onExit: () => emit("exit"),
        onProfileSaved: (profile: WorkspaceProfile) => emit("profileSaved", profile),
      },
    };
  if (screen.page === "jobs" && (current || !routeProjectId.value))
    return {
      id: "jobs",
      component: WorkspaceJobs,
      props: {
        project: current,
        selectedId: "jobId" in screen ? screen.jobId : undefined,
        state: jobs,
        source: services.sourceKey,
        services,
        workspaceId: props.session.workspace_id,
      },
    };
  if (!current) return undefined;
  const scoped = { services, project: current, workspaceId: props.session.workspace_id };
  if (screen.page === "materials")
    return { id: "materials", component: WorkspaceMaterials, props: { services, project: current, onOpenJob: (job: JobRead) => navigate(jobDetails(job)) } };
  if (screen.page === "review") return { id: "review", component: WorkspaceReview, props: { services, project: current } };
  if (screen.page === "export") return { id: "export", component: WorkspaceExport, props: { services, project: current } };
  if (screen.page === "inbox") return { id: "inbox", component: WorkspaceInbox, props: { services, project: current, onUnread: inbox.accept } };
  if (screen.page === "today")
    return { id: "today", component: WorkspaceToday, props: { ...scoped, onProjectChanged: (next: ProjectRead) => replaceProject(next) } };
  if (screen.page === "tasks")
    return { id: "tasks", component: WorkspaceTasks, props: { ...scoped, onProjectChanged: (next: ProjectRead) => replaceProject(next) } };
  if (screen.page === "feedback") return { id: "feedback", component: WorkspaceFeedback, props: scoped };
  if (screen.page === "writing")
    return {
      id: "writing",
      component: WorkspaceWriting,
      props: {
        ...scoped,
        jobs,
        historyLink: "historyLink" in screen ? screen.historyLink : undefined,
        // A suspended session keeps the editor mounted behind the unlock dialog; only an exit stops the writing page.
        active: !props.exiting,
        onOpenVersion: (link: Parameters<typeof versionRoute>[0]) => navigate(versionRoute(link)),
        onCloseVersion: () => navigate(writingRoute(current.id)),
        onOpenProjects: () => navigate(projectsRoute),
        onDocumentVersion: () => documentRevision.value++,
      },
    };
  return undefined;
});

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
  async (identity, previous) => {
    if (previous !== undefined) void sync();
    await nextTick();
    if (identity !== pageIdentity.value) return;
    content.value?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  },
  { immediate: true },
);

watch(
  space,
  async () => {
    await nextTick();
    const nav = navigation.value;
    const item = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && item && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = item.offsetLeft - nav.offsetLeft - (nav.clientWidth - item.clientWidth) / 2;
  },
  { immediate: true, flush: "post" },
);

watch(inactive, (value) => {
  if (value) commandOpen.value = false;
});

onKeyStroke(["k", "K"], (event) => {
  if ((!event.ctrlKey && !event.metaKey) || event.isComposing || inactive.value) return;
  event.preventDefault();
  if (!event.repeat) commandOpen.value = !commandOpen.value;
});

function syncOnReturn() {
  if (document.visibilityState !== "hidden" && !inactive.value) void sync();
}
onMounted(() => window.addEventListener("focus", syncOnReturn));
onBeforeUnmount(() => window.removeEventListener("focus", syncOnReturn));

function navigate(target: RouteLocationRaw) {
  if (!inactive.value) void router.push(target);
}
</script>

<template>
  <div class="screens-shell workspace-shell" :class="{ 'screens-shell--writing': view.page === 'writing' }" :inert="inactive">
    <a href="#workspace-content" class="screens-skip" @click.prevent="content?.focus()">跳到页面内容</a>
    <aside class="screens-rail">
      <RouterLink :to="rootRoute" class="screens-home" aria-label="ThesisPilot 工作区首页"><LabLogo :size="34" /></RouterLink>
      <span class="screens-rail__label tp-label">工作空间</span>
      <nav ref="navigation" class="screens-nav" aria-label="工作空间">
        <RouterLink v-for="item in spaces" :key="item.id" :to="item.to" :aria-current="space === item.id ? 'page' : undefined"
          ><TpIcon :icon="item.icon" :size="20" /><span>{{ item.title }}</span></RouterLink
        >
      </nav>
      <JobTray :formal="{ state: jobs, directory: jobDirectory, detail: jobDetails, inactive }" />
      <RouterLink
        :to="accountRoute"
        class="screens-avatar workspace-avatar"
        :aria-label="displayName ? `账户：${displayName}` : '账户与偏好'"
        :title="displayName || '账户与偏好'"
        :aria-current="view.page === 'account' ? 'page' : undefined"
        ><template v-if="initial">{{ initial }}</template><TpIcon v-else :icon="PhUser" :size="16"
      /></RouterLink>
    </aside>
    <div class="screens-workspace">
      <header class="screens-topbar">
        <WorkspaceProjectSwitcher :projects="services.projects" :current="project" :disabled="inactive" />
        <WorkspaceProgress
          v-if="project"
          :key="`${session.workspace_id}:${project.id}`"
          :services="services"
          :project="project"
          :refresh-key="`${pageIdentity}:${documentRevision}`"
        />
        <nav class="screens-tools workspace-tools" aria-label="工作区工具">
          <button
            class="screens-tool"
            type="button"
            aria-label="搜索工作空间（Ctrl 或 ⌘ + K）"
            title="搜索页面、任务、资料或章节 · Ctrl K"
            @click="commandOpen = true"
          >
            <TpIcon :icon="PhMagnifyingGlass" :size="18" />
          </button>
          <InboxBell v-if="project" :to="inboxRoute(project.id)" :count="inbox.count.value" :current="view.page === 'inbox'" />
          <RouterLink
            v-if="project"
            :to="exportRoute(project.id)"
            class="screens-tool"
            title="导出"
            aria-label="导出"
            :aria-current="view.page === 'export' ? 'page' : undefined"
            ><TpIcon :icon="PhExport" :size="18"
          /></RouterLink>
          <RouterLink :to="jobDirectory" class="screens-tool" aria-label="执行任务" title="执行任务" :aria-current="view.page === 'jobs' ? 'page' : undefined"
            ><TpIcon :icon="PhClock" :size="18"
          /></RouterLink>
        </nav>
      </header>

      <main
        id="workspace-content"
        ref="content"
        class="screens-content"
        :class="{ 'screens-content--write': view.page === 'writing' && !!project }"
        tabindex="-1"
      >
        <Transition name="tp-page" mode="out-in" v-bind="panelMotionHooks">
          <KeepAlive v-if="page" :key="cacheKey" :max="8">
            <component :is="page.component" :key="`${cacheKey}:${page.id}`" v-bind="page.props" />
          </KeepAlive>
          <TpState v-else-if="view.page === 'invalid'" key="invalid" class="screen-panel" kind="noresult" title="此工作区链接不可用">
            <RouterLink v-if="project && view.projectId === project.id" :to="writingRoute(project.id)" class="tp-btn tp-btn--outline tp-btn--sm"
              >打开写作台</RouterLink
            >
            <RouterLink :to="projectsRoute" class="tp-btn tp-btn--outline tp-btn--sm">返回项目</RouterLink>
          </TpState>
          <TpState v-else-if="status === 'missing'" key="missing" class="screen-panel" kind="noresult" title="未找到此论文项目">
            <RouterLink :to="projectsRoute" class="tp-btn tp-btn--outline tp-btn--sm">返回项目</RouterLink>
          </TpState>
          <TpState
            v-else-if="status === 'failed'"
            key="failed"
            class="screen-panel"
            kind="error"
            title="无法读取论文项目"
            desc="请检查服务连接后重试。"
            retryable
            @retry="reload"
          >
            <RouterLink :to="projectsRoute" class="tp-btn tp-btn--outline tp-btn--sm">返回项目</RouterLink>
          </TpState>
          <div v-else key="loading" class="screen-panel studio-body workspace-loading" role="status" aria-busy="true">
            <span class="tp-btn__spinner" aria-hidden="true" />正在读取项目…
          </div>
        </Transition>
        <footer v-if="view.page !== 'writing'" class="screens-footer"><span>ThesisPilot · 毕设智途</span><span>铅笔提议，墨水落定。</span></footer>
      </main>
    </div>
    <WorkspaceCommands v-if="!inactive" v-model:open="commandOpen" :services="services" :current="project" @navigate="navigate" />
  </div>
</template>
