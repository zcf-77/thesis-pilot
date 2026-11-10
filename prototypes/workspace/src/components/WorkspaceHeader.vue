<script setup lang="ts">
import { ArrowUpRight, Check, Focus, PanelRight, PanelLeft, Route } from "@lucide/vue";
defineProps<{ title: string; saved: string; focused: boolean; assistantOpen: boolean }>();
defineEmits<{ toggleFocus: []; toggleAssistant: []; toggleOutline: []; review: [] }>();
</script>

<template>
  <header class="workspace-header">
    <a class="brand" href="#" @click.prevent aria-label="毕设智途写作工作区"
      ><span class="brand-mark"><Route :size="21" /></span
      ><strong>毕设智途<span>ThesisPilot</span></strong></a
    >
    <div class="header-divider"></div>
    <div class="project-identity">
      <span class="project-title">{{ title }}</span
      ><span class="save-status"><Check :size="12" />{{ saved }}</span>
    </div>
    <span class="prototype-label">交互原型</span>
    <div class="header-actions">
      <button
        class="btn btn-ghost icon-button mobile-outline"
        aria-label="切换论文目录"
        @click="$emit('toggleOutline')"
      >
        <PanelLeft :size="17" />
      </button>
      <button
        class="btn btn-ghost icon-button"
        :aria-pressed="focused"
        aria-label="专注写作"
        @click="$emit('toggleFocus')"
      >
        <Focus :size="17" />
      </button>
      <button
        class="btn btn-ghost assistant-toggle"
        aria-label="辅助"
        :aria-pressed="assistantOpen"
        @click="$emit('toggleAssistant')"
      >
        <PanelRight :size="16" /><span>辅助</span>
      </button>
      <button class="btn btn-sm review-entry" @click="$emit('review')">
        仅评审<ArrowUpRight :size="14" />
      </button>
    </div>
  </header>
</template>
