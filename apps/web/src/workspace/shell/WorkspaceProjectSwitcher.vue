<script setup lang="ts">
import { PhCaretDown, PhCheck, PhFolderOpen, PhNotebook, PhPlus } from "@phosphor-icons/vue";
import { nextTick, onBeforeUnmount, ref, shallowRef } from "vue";
import { RouterLink } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpMenu from "@/components/ui/TpMenu.vue";
import type { ProjectRead, ProjectService } from "@/services";
import { projectCreateRoute, projectsRoute, writingRoute } from "../workspaceRoutes";

const props = defineProps<{ projects: ProjectService; current?: ProjectRead; disabled?: boolean }>();
const recent = shallowRef<ProjectRead[]>();
const state = ref<"idle" | "loading" | "ready" | "failed">("idle");
const menu = ref<HTMLElement>();
const trigger = ref<HTMLElement>();
let request: AbortController | undefined;

async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = "loading";
  try {
    const page = await props.projects.list({ offset: 0, limit: 6 }, controller.signal);
    if (controller.signal.aborted) return;
    recent.value = page.items;
    state.value = "ready";
  } catch {
    if (!controller.signal.aborted) state.value = "failed";
  }
}

async function toggle(toggleMenu: () => void, wasOpen: boolean) {
  if (props.disabled) return;
  toggleMenu();
  if (wasOpen) {
    request?.abort();
    return;
  }
  void load();
  await nextTick();
  menu.value?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
}

function move(event: KeyboardEvent) {
  const items = [...(menu.value?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
  if (!items.length) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(index + step + items.length) % items.length]!.focus();
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    items[event.key === "Home" ? 0 : items.length - 1]!.focus();
  } else if (event.key === "Escape") {
    trigger.value?.focus();
  }
}

onBeforeUnmount(() => request?.abort());
</script>

<template>
  <TpMenu class="workspace-switcher">
    <template #trigger="{ open, toggle: toggleMenu }">
      <button
        ref="trigger"
        type="button"
        class="screens-project workspace-switcher__trigger"
        aria-haspopup="menu"
        :aria-expanded="open"
        :aria-label="current ? `切换论文项目，当前：${current.name}` : '选择论文项目'"
        :disabled="disabled"
        @click="toggle(toggleMenu, open)"
      >
        <TpIcon :icon="PhNotebook" :size="20" class="text-fg-muted" />
        <span>
          <span class="tp-label block">毕业设计 · 当前项目</span>
          <b :title="current?.name">{{ current?.name ?? "选择论文项目" }}</b>
        </span>
        <TpIcon :icon="PhCaretDown" :size="14" class="workspace-switcher__caret" />
      </button>
    </template>
    <div ref="menu" class="workspace-switcher__menu" @keydown="move">
      <p class="tp-label workspace-switcher__label">最近项目</p>
      <Transition name="tp-swap" mode="out-in">
        <div v-if="state === 'failed'" key="failed" class="workspace-switcher__state" role="alert" @click.stop>
          <span>无法读取最近项目。</span><TpButton size="sm" @click="load">重试</TpButton>
        </div>
        <p v-else-if="!recent" key="loading" class="workspace-switcher__state" role="status">正在读取项目…</p>
        <p v-else-if="!recent.length" key="empty" class="workspace-switcher__state">还没有论文项目</p>
        <div v-else key="list" class="workspace-switcher__list" :aria-busy="state === 'loading' || undefined">
          <RouterLink
            v-for="project in recent"
            :key="project.id"
            :to="writingRoute(project.id)"
            class="tp-menu__item"
            role="menuitem"
            :aria-current="project.id === current?.id ? 'true' : undefined"
          >
            <TpIcon :icon="project.id === current?.id ? PhCheck : PhNotebook" :size="16" />
            <span class="workspace-switcher__name" :title="project.name">{{ project.name }}</span>
            <span v-if="project.archived" class="tp-caption">已归档</span>
          </RouterLink>
        </div>
      </Transition>
      <div class="tp-menu__sep" role="separator" />
      <RouterLink :to="projectsRoute" class="tp-menu__item" role="menuitem"><TpIcon :icon="PhFolderOpen" :size="16" />项目目录</RouterLink>
      <RouterLink :to="projectCreateRoute" class="tp-menu__item" role="menuitem"><TpIcon :icon="PhPlus" :size="16" />新建项目</RouterLink>
    </div>
  </TpMenu>
</template>

<style scoped>
.workspace-switcher {
  flex: 0 1 auto;
  min-width: 0;
}
.workspace-switcher :deep(.tp-menu) {
  width: min(18rem, calc(100vw - 32px));
}
.workspace-switcher__trigger {
  max-width: 100%;
  padding: 4px 8px 4px 4px;
  border-radius: var(--tp-radius-s);
  text-align: left;
  color: inherit;
}
.workspace-switcher__trigger:hover {
  background: var(--tp-surface-sunken);
}
.workspace-switcher__trigger:focus-visible {
  outline: 2px solid var(--tp-focus);
  outline-offset: 2px;
}
.workspace-switcher__caret {
  flex: none;
  color: var(--tp-text-muted);
}
.workspace-switcher__label {
  padding: 6px 0.55rem 4px;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--tp-text-muted);
}
.workspace-switcher__list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
.workspace-switcher__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-switcher__state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 2rem;
  padding: 0 0.55rem;
  color: var(--tp-text-muted);
  font-size: 0.8125rem;
}
.tp-menu__item[aria-current="true"] {
  font-weight: 600;
}
</style>
