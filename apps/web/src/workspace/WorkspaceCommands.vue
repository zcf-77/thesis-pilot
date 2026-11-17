<script setup lang="ts">
import {
  PhBooks,
  PhChatTeardropText,
  PhCheckSquare,
  PhClock,
  PhFileText,
  PhNotebook,
  PhNotePencil,
  PhPath,
  PhSlidersHorizontal,
  PhBookOpenText,
  PhUser,
} from "@phosphor-icons/vue";
import { computed, nextTick, onScopeDispose, reactive, ref, watch, type Component } from "vue";
import type { RouteLocationRaw } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpDialog from "@/components/ui/TpDialog.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import { listMotionHooks } from "@/design/motion";
import type { BackendServices, ProjectRead } from "@/services";
import { loadSearchSource, matchRows, searchSources, type SearchRow, type SearchSource } from "./shell/commandSearch";
import {
  accountRoute,
  configurationsRoute,
  feedbackRoute,
  flowsRoute,
  materialsRoute,
  projectJobsRoute,
  projectsRoute,
  tasksRoute,
  writingAnchorRoute,
  writingRoute,
} from "./workspaceRoutes";

interface Entry {
  id: string;
  label: string;
  icon: Component;
  target: RouteLocationRaw;
  detail?: string;
  terms?: string;
}
interface Group {
  id: string;
  label: string;
  entries: (Entry & { index: number })[];
}
interface SourceState {
  status: "idle" | "loading" | "ready" | "failed";
  projectId?: string;
  rows: SearchRow[];
}

const props = defineProps<{ services: Pick<BackendServices, "projects" | "tasks" | "materials" | "documents">; current?: ProjectRead }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ navigate: [target: RouteLocationRaw] }>();
const query = ref("");
const needle = computed(() => query.value.trim().toLocaleLowerCase());
const applied = ref("");
const selected = ref(0);
const resultsHost = ref<HTMLElement>();
const sources = reactive<Record<SearchSource, SourceState>>({
  tasks: { status: "idle", rows: [] },
  materials: { status: "idle", rows: [] },
  chapters: { status: "idle", rows: [] },
  projects: { status: "idle", rows: [] },
});
const sourceLabels: Record<SearchSource, string> = { tasks: "任务", materials: "资料", chapters: "章节", projects: "项目" };
const requests = new Map<SearchSource, AbortController>();
let debounce: ReturnType<typeof setTimeout> | undefined;

const spaces = computed<Entry[]>(() => {
  const project = props.current;
  return [
    ...(project
      ? [
          { id: "write", label: "写作", icon: PhNotePencil, target: writingRoute(project.id), terms: "正文 写作台" },
          { id: "plan", label: "计划", icon: PhPath, target: tasksRoute(project.id), terms: "论文任务 版本证据" },
          { id: "library", label: "资料", icon: PhBooks, target: materialsRoute(project.id), terms: "项目资料 来源 模板 要求" },
          { id: "feedback", label: "反馈", icon: PhChatTeardropText, target: feedbackRoute(project.id), terms: "导师反馈 学生处理" },
        ]
      : []),
    { id: "flows", label: "配置 · 流程", icon: PhSlidersHorizontal, target: flowsRoute, terms: "项目流程 阶段" },
    { id: "configurations", label: "配置 · 四库", icon: PhSlidersHorizontal, target: configurationsRoute, terms: "智能体 模型 提示词" },
    { id: "jobs", label: "执行任务", icon: PhClock, target: projectJobsRoute(project?.id), terms: "后台任务 任务中心" },
    { id: "projects", label: "项目目录", icon: PhNotebook, target: projectsRoute, terms: "论文项目 新建项目" },
    { id: "account", label: "账户与偏好", icon: PhUser, target: accountRoute, terms: "外观 主题 动效 通知 退出" },
  ];
});

function rowsFor(source: SearchSource) {
  const state = sources[source];
  if (state.status !== "ready" || (source !== "projects" && state.projectId !== props.current?.id)) return [];
  return matchRows(state.rows, applied.value);
}

const groups = computed<Group[]>(() => {
  const project = props.current;
  const term = needle.value;
  const draft: { id: string; label: string; entries: Entry[] }[] = [
    { id: "spaces", label: "工作空间", entries: spaces.value.filter((entry) => `${entry.label} ${entry.terms ?? ""}`.toLocaleLowerCase().includes(term)) },
  ];
  if (project) {
    draft.push(
      {
        id: "tasks",
        label: "任务",
        entries: rowsFor("tasks").map((row) => ({
          id: `task:${row.id}`,
          label: row.label,
          detail: row.detail,
          icon: PhCheckSquare,
          target: tasksRoute(project.id, row.id),
        })),
      },
      {
        id: "materials",
        label: "资料",
        entries: rowsFor("materials").map((row) => ({
          id: `material:${row.id}`,
          label: row.label,
          icon: PhFileText,
          target: materialsRoute(project.id, row.id),
        })),
      },
      {
        id: "chapters",
        label: "章节",
        entries: rowsFor("chapters").map((row) => ({
          id: `chapter:${row.id}`,
          label: row.label,
          icon: PhBookOpenText,
          target: writingAnchorRoute(project.id, { chapterId: row.id }),
        })),
      },
    );
  }
  draft.push({
    id: "projects",
    label: "项目",
    entries: rowsFor("projects").map((row) => ({
      id: `project:${row.id}`,
      label: row.label,
      detail: row.detail,
      icon: PhNotebook,
      target: writingRoute(row.id),
    })),
  });
  let index = 0;
  return draft.filter((group) => group.entries.length).map((group) => ({ ...group, entries: group.entries.map((entry) => ({ ...entry, index: index++ })) }));
});
const entries = computed(() => groups.value.flatMap((group) => group.entries));
const relevant = computed<SearchSource[]>(() => (props.current ? [...searchSources] : ["projects"]));
const searching = computed(() => !!needle.value && (needle.value !== applied.value || relevant.value.some((source) => sources[source].status === "loading")));
const failed = computed(() => (applied.value ? relevant.value.filter((source) => sources[source].status === "failed") : []));

function abortAll() {
  clearTimeout(debounce);
  for (const request of requests.values()) request.abort();
  requests.clear();
}

async function load(source: SearchSource) {
  requests.get(source)?.abort();
  const request = new AbortController();
  requests.set(source, request);
  const projectId = props.current?.id;
  const state = sources[source];
  state.status = "loading";
  state.projectId = projectId;
  try {
    const rows = await loadSearchSource(props.services, source, projectId, request.signal);
    if (request.signal.aborted || (source !== "projects" && props.current?.id !== projectId)) return;
    state.rows = rows;
    state.status = "ready";
  } catch {
    if (!request.signal.aborted) state.status = "failed";
  } finally {
    if (requests.get(source) === request) requests.delete(source);
  }
}

function ensureSources(retry = false) {
  for (const source of relevant.value) {
    const state = sources[source];
    const stale = source !== "projects" && state.projectId !== props.current?.id;
    if (state.status === "idle" || stale || (retry && state.status === "failed")) void load(source);
  }
}

function reset() {
  abortAll();
  applied.value = "";
  for (const source of searchSources) Object.assign(sources[source], { status: "idle", projectId: undefined, rows: [] });
}

watch(open, (visible) => {
  reset();
  if (visible) query.value = "";
});
watch(
  () => props.current?.id,
  () => {
    if (open.value) reset();
  },
);
watch(needle, (term) => {
  clearTimeout(debounce);
  if (!term) {
    applied.value = "";
    return;
  }
  debounce = setTimeout(() => {
    applied.value = term;
    ensureSources();
  }, 180);
});
watch([needle, applied], () => (selected.value = 0));
onScopeDispose(abortAll);

function run(entry?: Entry) {
  if (!entry || !open.value) return;
  open.value = false;
  emit("navigate", entry.target);
}

function handleKey(event: KeyboardEvent) {
  if (event.isComposing || !entries.value.length) return;
  if (event.key === "Enter") {
    event.preventDefault();
    run(entries.value[selected.value]);
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    selected.value = (selected.value + step + entries.value.length) % entries.value.length;
    void nextTick(() => {
      const button = resultsHost.value?.querySelector<HTMLButtonElement>(`[data-entry-index='${selected.value}']`);
      if (event.target instanceof HTMLButtonElement) button?.focus();
      else button?.scrollIntoView({ block: "nearest" });
    });
  }
}
</script>

<template>
  <TpDialog v-model:open="open" title="去往你的工作空间" description="搜索页面、任务、资料、章节或项目。">
    <div class="studio-stack" :inert="!open">
      <input
        v-model="query"
        type="search"
        class="tp-input"
        placeholder="搜索页面、任务、资料、章节或项目…"
        aria-label="搜索工作空间"
        data-autofocus
        @keydown="handleKey"
      />
      <div ref="resultsHost" class="screens-command-results workspace-command-results">
        <TransitionGroup name="tp-list" v-bind="listMotionHooks" tag="div" class="tp-list-group workspace-command-groups">
          <section v-for="group in groups" :key="group.id" class="workspace-command-group" :aria-label="group.label">
            <p class="tp-label workspace-command-group__label" aria-hidden="true">{{ group.label }}</p>
            <TransitionGroup name="tp-list" v-bind="listMotionHooks" tag="div" class="tp-list-group workspace-command-group__items">
              <button
                v-for="entry in group.entries"
                :key="entry.id"
                type="button"
                class="studio-command"
                :class="{ 'is-selected': entry.index === selected }"
                :data-entry-index="entry.index"
                :data-command-group="group.id"
                @click="run(entry)"
                @focus="selected = entry.index"
                @pointermove="selected = entry.index"
                @keydown="handleKey"
              >
                <TpIcon :icon="entry.icon" /><span>{{ entry.label }}</span>
                <span v-if="entry.detail" class="tp-caption">{{ entry.detail }}</span>
              </button>
            </TransitionGroup>
          </section>
        </TransitionGroup>
      </div>
      <Transition name="tp-swap" mode="out-in">
        <p v-if="searching" key="busy" role="status" class="tp-caption">正在搜索…</p>
        <div v-else-if="failed.length" key="failed" class="screen-actions">
          <p role="alert" class="tp-caption">无法搜索{{ failed.map((source) => sourceLabels[source]).join("、") }}，其他结果不受影响。</p>
          <TpButton size="sm" @click="ensureSources(true)">重试</TpButton>
        </div>
        <p v-else-if="!entries.length" key="empty" role="status" class="tp-caption">没有匹配结果，试试任务、章节名称或「写作」。</p>
      </Transition>
    </div>
  </TpDialog>
</template>

<style scoped>
.workspace-command-groups {
  display: grid;
  gap: 12px;
}
.workspace-command-group {
  display: grid;
  gap: 4px;
}
.workspace-command-group__label {
  padding: 0 12px;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--tp-text-muted);
}
.workspace-command-group__items {
  display: grid;
  gap: 4px;
}
</style>
