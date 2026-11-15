<script setup lang="ts">
import { PhArrowElbowDownLeft, PhClock, PhNotebook, PhNotePencil, PhUser } from "@phosphor-icons/vue";
import { computed, nextTick, ref, shallowRef, watch, type Component } from "vue";
import type { RouteLocationRaw } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpDialog from "@/components/ui/TpDialog.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import { listMotionHooks } from "@/design/motion";
import type { ProjectRead, ProjectService } from "@/services";
import { accountRoute, configurationsRoute, flowsRoute, projectJobsRoute, projectsRoute, writingRoute } from "./workspaceRoutes";
import { findWorkspaceProjects } from "./useWorkspaceProject";

interface Entry {
  id: string;
  label: string;
  icon: Component;
  target: RouteLocationRaw;
  timestamp?: string;
}

const props = defineProps<{ projects: ProjectService; current?: ProjectRead }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ navigate: [target: RouteLocationRaw] }>();
const query = ref("");
const needle = computed(() => query.value.trim().toLocaleLowerCase());
const searchBusy = ref(false);
const searchError = ref(false);
const retry = ref(0);
const results = shallowRef<ProjectRead[]>([]);
const selected = ref(0);
const resultsHost = ref<HTMLElement>();
const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" });

const commands = computed<Entry[]>(() => {
  const nav: Entry[] = [
    { id: "projects", label: "论文项目", icon: PhNotebook, target: projectsRoute },
    { id: "jobs", label: "执行任务", icon: PhClock, target: projectJobsRoute(props.current?.id) },
    { id: "account", label: "账户与偏好", icon: PhUser, target: accountRoute },
    { id: "flows", label: "项目流程", icon: PhNotebook, target: flowsRoute },
    { id: "configurations", label: "智能体与模型四库", icon: PhNotebook, target: configurationsRoute },
  ];
  if (props.current) nav.splice(1, 0, { id: "writing", label: "写作台", icon: PhNotePencil, target: writingRoute(props.current.id) });
  return [
    ...nav.filter((entry) => entry.label.includes(needle.value)),
    ...results.value.map((project) => ({
      id: project.id,
      label: project.name,
      icon: PhNotebook,
      target: writingRoute(project.id),
      timestamp: project.created_at,
    })),
  ];
});

watch(open, (visible) => {
  if (visible) query.value = "";
});
watch([needle, open, retry], ([term, visible], _, onCleanup) => {
  selected.value = 0;
  searchError.value = false;
  results.value = [];
  searchBusy.value = !!term && visible;
  if (!term || !visible) return;
  const controller = new AbortController();
  const timer = setTimeout(async () => {
    try {
      const found = await findWorkspaceProjects(props.projects, term, controller.signal);
      if (!controller.signal.aborted) results.value = found;
    } catch {
      if (!controller.signal.aborted) searchError.value = true;
    } finally {
      if (!controller.signal.aborted) searchBusy.value = false;
    }
  }, 180);
  onCleanup(() => {
    clearTimeout(timer);
    controller.abort();
  });
});

function run(entry?: Entry) {
  if (!entry || !open.value) return;
  open.value = false;
  emit("navigate", entry.target);
}

function handleKey(event: KeyboardEvent) {
  if (event.isComposing || !commands.value.length) return;
  if (event.key === "Enter") {
    event.preventDefault();
    run(commands.value[selected.value]);
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    selected.value = (selected.value + step + commands.value.length) % commands.value.length;
    void nextTick(() => {
      const button = resultsHost.value?.querySelector<HTMLButtonElement>(`[data-entry-index='${selected.value}']`);
      if (event.target instanceof HTMLButtonElement) button?.focus();
      else button?.scrollIntoView({ block: "nearest" });
    });
  }
}
</script>

<template>
  <TpDialog v-model:open="open" title="搜索工作区">
    <div class="studio-stack" :inert="!open">
      <input v-model="query" type="search" class="tp-input" placeholder="搜索项目或页面…" aria-label="搜索项目或页面" data-autofocus @keydown="handleKey" />
      <div ref="resultsHost">
        <TransitionGroup name="tp-list" v-bind="listMotionHooks" tag="div" class="screens-command-results tp-list-group">
          <button
            v-for="(entry, index) in commands"
            :key="entry.id"
            type="button"
            class="studio-command"
            :class="{ 'is-selected': index === selected }"
            :data-entry-index="index"
            @click="run(entry)"
            @focus="selected = index"
            @pointermove="selected = index"
            @keydown="handleKey"
          >
            <TpIcon :icon="entry.icon" /><span>{{ entry.label }}</span>
            <time v-if="entry.timestamp" :datetime="entry.timestamp" class="tp-caption">{{ dateFormat.format(new Date(entry.timestamp)) }}</time>
            <TpIcon v-else :icon="PhArrowElbowDownLeft" :size="14" />
          </button>
        </TransitionGroup>
      </div>
      <Transition name="tp-swap" mode="out-in">
        <p v-if="searchBusy" role="status" class="tp-caption">正在搜索项目…</p>
        <div v-else-if="searchError" class="screen-actions">
          <p role="alert" class="tp-caption">无法搜索项目。</p>
          <TpButton size="sm" @click="retry++">重试</TpButton>
        </div>
        <p v-else-if="!commands.length" role="status" class="tp-caption">没有匹配的项目或页面。</p>
      </Transition>
    </div>
  </TpDialog>
</template>
