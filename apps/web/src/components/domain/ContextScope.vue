<script setup lang="ts">
import { PhCrosshair, PhFolderSimple, PhGitCommit, PhPaperclip, PhSlidersHorizontal, PhTextAlignLeft } from "@phosphor-icons/vue";
import type { Component } from "vue";
import TpChip from "@/components/ui/TpChip.vue";
import TpIcon from "@/components/ui/TpIcon.vue";

/**
 * 上下文范围条：本次调用到底用了什么 —— 项目、正文版本、章节 / 选区、资料。
 * 项目与正文版本是固定项，不可移除；其余可由学生调整（emit remove / adjust）。
 */
export interface ScopeItem {
  id: string;
  kind: "project" | "version" | "chapter" | "selection" | "material";
  label: string;
  fixed?: boolean;
}
defineProps<{ items: ScopeItem[] }>();
defineEmits<{ remove: [id: string]; adjust: [] }>();
const icons: Record<ScopeItem["kind"], Component> = {
  project: PhFolderSimple,
  version: PhGitCommit,
  chapter: PhTextAlignLeft,
  selection: PhCrosshair,
  material: PhPaperclip,
};
</script>

<template>
  <div class="tp-scope" role="group" aria-label="本次使用的上下文范围">
    <span class="tp-label mr-0.5">范围</span>
    <TransitionGroup name="tp-list">
      <TpChip v-for="item in items" :key="item.id" :removable="!item.fixed" :remove-label="'移除 ' + item.label" @remove="$emit('remove', item.id)">
        <TpIcon :icon="icons[item.kind]" :size="12" />{{ item.label }}
      </TpChip>
    </TransitionGroup>
    <button type="button" class="tp-pick ml-auto tp-tip" data-tip="调整范围" aria-label="调整上下文范围" @click="$emit('adjust')">
      <TpIcon :icon="PhSlidersHorizontal" :size="14" />
    </button>
  </div>
</template>
