<script setup lang="ts">
import {
  PhArrowLeft,
  PhBooks,
  PhChatTeardropText,
  PhPath,
  PhNotebook,
  PhSunHorizon,
  PhNotePencil,
  PhExam,
  PhSlidersHorizontal,
  PhBell,
  PhClock,
  PhExport,
  PhUser,
  PhMagnifyingGlass,
} from "@phosphor-icons/vue";
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import { RouterLink, useRouter, useRoute } from "vue-router";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpDialog from "@/components/ui/TpDialog.vue";
import LabLogo from "../LabLogo.vue";
import ScreenToday from "../screens/ScreenToday.vue";
import ScreenWrite from "../screens/ScreenWrite.vue";
import ScreenPlan from "../screens/ScreenPlan.vue";
import ScreenLibrary from "../screens/ScreenLibrary.vue";
import ScreenFeedback from "../screens/ScreenFeedback.vue";
import ScreenReview from "../screens/ScreenReview.vue";
import ScreenSettings from "../screens/ScreenSettings.vue";
import ScreenProjects from "../screens/ScreenProjects.vue";
import ScreenInbox from "../screens/ScreenInbox.vue";
import ScreenAccount from "../screens/ScreenAccount.vue";
import ScreenJobs from "../screens/ScreenJobs.vue";
import ScreenExport from "../screens/ScreenExport.vue";
import { usePreviewWorkspaceStore } from "../state/previewWorkspace";
import { downloadPreviewFile, serializePreviewBackup } from "../state/previewBackup";
import { usePlanState } from "../state/planState";
import { useInboxState } from "../state/inboxState";
import { useBackendServices } from "@/services/runtime";
import { provideServiceJobs } from "../state/serviceJobs";
import { provideFormalDocument } from "../state/formalDocumentContext";
import { useProjectEventBridge } from "../services/eventService";
import ProjectProgress from "../components/ProjectProgress.vue";
import JobTray from "../components/JobTray.vue";
import { listMotionHooks } from "@/design/motion";
import "../screens/screens.css";
const props = defineProps<{ screen: string }>();
const workspace = usePreviewWorkspaceStore();
const jobServices = useBackendServices().services;
const route = useRoute();
provideFormalDocument(
  jobServices,
  computed(() => workspace.current.id),
  computed(() => workspace.current.remoteBinding),
);
const formalWriting = computed(() => props.screen === "write" && route.query.source === "service");
if (jobServices) {
  provideServiceJobs(
    jobServices,
    computed(() => {
      const binding = workspace.current.remoteBinding;
      return binding?.sourceKey === jobServices.sourceKey ? binding.projectId : undefined;
    }),
  );
}
// 项目目录属于工作区；创建/归档改变 activeId 时，保留目录的列表进出过程。
// 进入项目页面前更新缓存分区，保持不同项目的编辑状态隔离。
const screenCacheProjectId = ref(workspace.activeId);
watch([() => workspace.activeId, () => props.screen], ([id, screen]) => {
  if (screen !== "projects") screenCacheProjectId.value = id;
});
const plan = usePlanState();
const inbox = useInboxState();
useProjectEventBridge();
const router = useRouter();
const navigation = ref<HTMLElement>();
watch(
  () => props.screen,
  async () => {
    await nextTick();
    const nav = navigation.value;
    const item = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && item && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = item.offsetLeft - nav.offsetLeft - (nav.clientWidth - item.clientWidth) / 2;
  },
  { immediate: true },
);
const spaces = [
  { id: "today", title: "今日", icon: PhSunHorizon, component: ScreenToday },
  { id: "write", title: "写作", icon: PhNotePencil, component: ScreenWrite },
  { id: "plan", title: "计划", icon: PhPath, component: ScreenPlan },
  { id: "library", title: "资料", icon: PhBooks, component: ScreenLibrary },
  { id: "feedback", title: "反馈", icon: PhChatTeardropText, component: ScreenFeedback },
  { id: "review", title: "评审", icon: PhExam, component: ScreenReview },
  { id: "settings", title: "配置", icon: PhSlidersHorizontal, component: ScreenSettings },
];
const utilities = [
  { id: "projects", title: "项目", icon: PhNotebook, component: ScreenProjects },
  { id: "inbox", title: "收件箱", icon: PhBell, component: ScreenInbox },
  { id: "jobs", title: "执行任务", icon: PhClock, component: ScreenJobs },
  { id: "export", title: "导出备份", icon: PhExport, component: ScreenExport },
  { id: "account", title: "账户偏好", icon: PhUser, component: ScreenAccount },
];
const all = [...spaces, ...utilities];
const current = computed(() => all.find((s) => s.id === props.screen) ?? spaces[0]!);
const commandOpen = ref(false);
const query = ref("");
const commandIndex = ref(0);
const unread = computed(() => inbox.value.suggestions.filter((item) => item.state === "unread").length);
const backupError = ref("");
const commands = computed(() => {
  const headings = [...new DOMParser().parseFromString(workspace.current.document.html, "text/html").querySelectorAll("h2,h3,h4")];
  const items = [
    ...all.map((item) => ({ ...item, group: "工作空间", route: "/screens/" + item.id })),
    ...plan.value.tasks.map((item) => ({
      id: "task-" + item.id,
      title: item.title,
      icon: PhPath,
      group: "任务",
      route: "/screens/plan?task=" + encodeURIComponent(item.id),
    })),
    ...headings.map((item, index) => ({
      id: "chapter-" + index,
      title: item.textContent || "未命名章节",
      icon: PhNotebook,
      group: "章节",
      route: "/screens/write?chapter=" + encodeURIComponent(item.textContent || ""),
    })),
    {
      id: "ai-rewrite",
      title: "请内容助手润色当前选区",
      icon: PhNotePencil,
      group: "助手",
      route: "/screens/write?agent=content&goal=" + encodeURIComponent("润色当前选区，保留数字和引用"),
    },
    {
      id: "ai-citations",
      title: "请文献助手核对引用",
      icon: PhBooks,
      group: "助手",
      route: "/screens/write?agent=lit&goal=" + encodeURIComponent("核对当前引用的来源与取得范围"),
    },
  ];
  const search = query.value.trim().toLocaleLowerCase();
  return items.filter((item) => (item.title + item.group + item.id).toLocaleLowerCase().includes(search));
});
watch(query, () => {
  commandIndex.value = 0;
});
const sessionOpen = computed({ get: () => !workspace.sessionActive, set: () => {} });
function shortcut(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    commandOpen.value = !commandOpen.value;
  }
}
function navigate(route: string) {
  commandOpen.value = false;
  query.value = "";
  void router.push(route);
}
function commandKey(event: KeyboardEvent) {
  if (event.key === "Enter" && commands.value[commandIndex.value]) {
    event.preventDefault();
    navigate(commands.value[commandIndex.value]!.route);
  }
  if (["ArrowDown", "ArrowUp"].includes(event.key) && commands.value.length) {
    event.preventDefault();
    commandIndex.value = (commandIndex.value + (event.key === "ArrowDown" ? 1 : -1) + commands.value.length) % commands.value.length;
    void nextTick(() => document.querySelector(`[data-command-index="${commandIndex.value}"]`)?.scrollIntoView({ block: "nearest" }));
  }
}
function backup() {
  const result = downloadPreviewFile("thesispilot-project-backup.json", serializePreviewBackup(workspace.current), "application/json");
  backupError.value = result.ok ? "" : result.error;
}
onMounted(() => window.addEventListener("keydown", shortcut));
onUnmounted(() => window.removeEventListener("keydown", shortcut));
</script>
<template>
  <div class="screens-shell" :class="{ 'screens-shell--writing': screen === 'write' }">
    <a href="#screen-content" class="screens-skip" @click.prevent="($refs.content as HTMLElement)?.focus()">跳到页面内容</a>
    <aside class="screens-rail">
      <RouterLink to="/" class="screens-home" aria-label="返回设计展台"><LabLogo :size="34" /></RouterLink
      ><span class="screens-rail__label tp-label">工作空间</span>
      <nav ref="navigation" aria-label="页面设计导航" class="screens-nav">
        <RouterLink v-for="space in spaces" :key="space.id" :to="'/screens/' + space.id" :aria-current="screen === space.id ? 'page' : undefined"
          ><TpIcon :icon="space.icon" :size="20" /><span>{{ space.title }}</span></RouterLink
        >
      </nav>
      <RouterLink to="/" class="screens-return" aria-label="返回展台目录"><TpIcon :icon="PhArrowLeft" :size="18" /><span>展台</span></RouterLink
      ><JobTray /><RouterLink to="/screens/account" class="screens-avatar" :aria-label="'账户：' + workspace.userName">{{
        workspace.userName.slice(0, 1)
      }}</RouterLink>
    </aside>
    <div class="screens-workspace">
      <header class="screens-topbar">
        <RouterLink to="/screens/projects" class="screens-project" aria-label="切换论文项目"
          ><TpIcon :icon="PhNotebook" :size="20" class="text-fg-muted" /><span
            ><span class="tp-label block">毕业设计 · 当前项目</span><b>{{ workspace.current.short }}</b></span
          ></RouterLink
        ><ProjectProgress />
        <nav class="screens-tools" aria-label="项目工具">
          <button class="screens-tool" aria-label="搜索页面（Ctrl K）" title="搜索页面、章节、任务或助手指令 · Ctrl K" @click="commandOpen = true">
            <TpIcon :icon="PhMagnifyingGlass" :size="18" /></button
          ><RouterLink
            v-for="item in utilities.filter((x) => x.id !== 'projects' && x.id !== 'account')"
            :key="item.id"
            :to="'/screens/' + item.id"
            class="screens-tool"
            :title="item.title"
            :aria-label="item.title"
            :aria-current="screen === item.id ? 'page' : undefined"
            ><TpIcon :icon="item.icon" :size="18" /><span v-if="item.id === 'inbox' && unread" class="screens-unread" :aria-label="unread + '条未读建议'">{{
              unread > 9 ? "9+" : unread
            }}</span></RouterLink
          >
        </nav>
      </header>
      <div v-if="screen !== 'write'" class="screens-preview-note">
        <span><b>{{ current.title }}</b><span v-if="!formalWriting" class="screens-note-detail"> · 本机工作区</span></span
        ><RouterLink to="/spec">设计规范 ↗</RouterLink>
      </div>
      <Transition name="tp-swap"
        ><div v-if="workspace.saveStatus === 'failed'" class="screens-save-error" role="alert">
          <span>{{ workspace.saveError }} 当前内容仍保留在本页。</span><TpButton size="sm" @click="workspace.retrySave()">重试保存</TpButton
          ><RouterLink class="studio-link" to="/screens/export">下载备份</RouterLink>
        </div></Transition
      >
      <div id="screen-content" ref="content" class="screens-content" :class="{ 'screens-content--write': screen === 'write' }" tabindex="-1">
        <Transition name="tp-page" mode="out-in"
          ><KeepAlive :key="screenCacheProjectId"><component :is="current.component" :key="current.id" /></KeepAlive
        ></Transition>
        <footer v-if="screen !== 'write'" class="screens-footer"><span>ThesisPilot · 毕设智途</span><span>铅笔提议，墨水落定。</span></footer>
      </div>
    </div>
    <TpDialog v-model:open="commandOpen" title="去往你的工作空间" description="搜索章节、任务、页面，或把当前问题交给助手。"
      ><div class="studio-stack">
        <input v-model="query" class="tp-input" aria-label="搜索工作空间" placeholder="搜索页面、章节、任务或助手指令…" data-autofocus @keydown="commandKey" />
        <TransitionGroup name="tp-list" v-bind="listMotionHooks" tag="div" class="screens-command-results tp-list-group">
          <button
            v-for="(item, index) in commands"
            :key="item.id"
            class="studio-command"
            :class="{ 'is-selected': commandIndex === index }"
            :data-command-index="index"
            @focus="commandIndex = index"
            @keydown="commandKey"
            @click="navigate(item.route)"
          >
            <TpIcon :icon="item.icon" /><span>{{ item.title }}</span><span class="tp-caption">{{ item.group }}</span>
          </button>
        </TransitionGroup>
        <Transition name="tp-swap"><p v-if="!commands.length" class="tp-caption">没有匹配结果，试试章节名称或「写作」。</p></Transition>
      </div></TpDialog
    >
    <TpDialog v-model:open="sessionOpen" title="演示会话已结束" description="当前文稿和操作保留，重新进入即可继续。"
      ><p class="studio-copy">当前项目：{{ workspace.current.short }} · 正文 v{{ workspace.current.document.version }}。也可以下载项目备份。</p>
      <p v-if="backupError" role="alert" class="studio-notice">{{ backupError }}</p>
      <template #actions
        ><TpButton @click="backup">下载备份</TpButton><TpButton variant="primary" @click="workspace.sessionActive = true">重新进入演示</TpButton></template
      ></TpDialog
    >
  </div>
</template>
