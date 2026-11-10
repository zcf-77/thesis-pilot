<script setup lang="ts">
import {
  PhArrowElbowDownLeft,
  PhBooks,
  PhChartLineUp,
  PhChatsCircle,
  PhClockCounterClockwise,
  PhMagnifyingGlass,
  PhNotePencil,
  PhSealCheck,
} from "@phosphor-icons/vue";
import { computed, nextTick, ref, watch, type Component } from "vue";
import { onKeyStroke } from "@vueuse/core";
import TpIcon from "./TpIcon.vue";

/**
 * 指令面板（L5）：⌘K 唤起，跨模块跳转与发起操作的统一入口。
 * 展台内为演示数据；正式实现由路由与各模块注册指令。
 */
interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: Component;
}

const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ run: [id: string] }>();
const query = ref("");
const active = ref(0);
const input = ref<HTMLInputElement>();

const commands: Command[] = [
  { id: "goto-write", group: "前往", label: "写作 · 第 3 章 系统设计", hint: "继续上次位置", icon: PhNotePencil },
  { id: "goto-plan", group: "前往", label: "计划 · 本周任务", icon: PhChartLineUp },
  { id: "goto-library", group: "前往", label: "资料 · 模板与规范", icon: PhBooks },
  { id: "ask-revise", group: "让 AI 起草（只产生候选）", label: "润色当前选区", hint: "128 字", icon: PhChatsCircle },
  { id: "ask-review", group: "让 AI 起草（只产生候选）", label: "评审第 3 章", hint: "仅评审，不改正文", icon: PhSealCheck },
  { id: "history", group: "版本", label: "查看版本历史", hint: "当前 v13", icon: PhClockCounterClockwise },
];

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? commands.filter((c) => (c.label + c.group).toLowerCase().includes(q)) : commands;
});
const groups = computed(() => {
  const map = new Map<string, Command[]>();
  for (const c of filtered.value) map.set(c.group, [...(map.get(c.group) ?? []), c]);
  return [...map.entries()];
});

watch(open, async (value) => {
  if (!value) return;
  query.value = "";
  active.value = 0;
  await nextTick();
  input.value?.focus();
});
watch(query, () => (active.value = 0));

function run(command: Command) {
  emit("run", command.id);
  open.value = false;
}
function onKey(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    active.value = (active.value + 1) % Math.max(filtered.value.length, 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    active.value = (active.value - 1 + filtered.value.length) % Math.max(filtered.value.length, 1);
  } else if (event.key === "Enter" && filtered.value[active.value]) {
    event.preventDefault();
    run(filtered.value[active.value]);
  }
}
onKeyStroke("Escape", () => {
  if (open.value) open.value = false;
});
onKeyStroke("k", (event) => {
  if (event.metaKey || event.ctrlKey) {
    event.preventDefault();
    open.value = !open.value;
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="tp-cmd">
      <div v-if="open">
        <div class="tp-scrim" @click="open = false" />
        <div class="tp-cmd" role="dialog" aria-modal="true" aria-label="指令面板" @keydown="onKey">
          <div class="tp-cmd__input">
            <TpIcon :icon="PhMagnifyingGlass" :size="18" class="text-fg-muted" />
            <input
              ref="input"
              v-model="query"
              placeholder="搜索页面、章节，或让 AI 起草…"
              aria-label="搜索指令"
              role="combobox"
              aria-expanded="true"
              aria-controls="tp-cmd-list"
            />
            <kbd class="tp-kbd">Esc</kbd>
          </div>
          <div id="tp-cmd-list" class="tp-cmd__list" role="listbox">
            <template v-for="[group, list] in groups" :key="group">
              <p class="tp-label tp-cmd__group">{{ group }}</p>
              <button
                v-for="c in list"
                :key="c.id"
                type="button"
                role="option"
                class="tp-menu__item !h-10"
                :class="{ 'is-active': filtered[active]?.id === c.id }"
                :aria-selected="filtered[active]?.id === c.id"
                @mousemove="active = filtered.indexOf(c)"
                @click="run(c)"
              >
                <TpIcon :icon="c.icon" :size="17" class="text-fg-muted" />
                <span class="font-medium">{{ c.label }}</span>
                <span v-if="c.hint" class="tp-caption">{{ c.hint }}</span>
                <TpIcon v-if="filtered[active]?.id === c.id" :icon="PhArrowElbowDownLeft" :size="14" class="ml-auto text-fg-faint" />
              </button>
            </template>
            <p v-if="filtered.length === 0" class="tp-caption px-3 py-6 text-center">没有匹配的指令。试试“写作”“评审”“版本”。</p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
