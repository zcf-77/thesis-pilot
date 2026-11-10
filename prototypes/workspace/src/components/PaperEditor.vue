<script setup lang="ts">
import { EditorContent, type Editor } from "@tiptap/vue-3";
import { ArrowUpRight, Check, Feather, X } from "@lucide/vue";
defineProps<{
  editor: Editor | undefined;
  title: string;
  selectionText: string;
  wordCount: number;
  version: number;
  currentChapter: string;
  chapterComplete: boolean;
}>();
defineEmits<{ revise: []; ask: []; clearSelection: []; complete: [] }>();
</script>

<template>
  <section class="writing-area" aria-label="论文写作区">
    <div class="writing-context">
      <span
        ><span class="status-dot"></span>初稿写作<span class="context-slash">/</span
        >{{ currentChapter }}</span
      ><button
        class="btn btn-ghost complete-chapter"
        :disabled="chapterComplete"
        @click="$emit('complete')"
      >
        <Check :size="14" />{{ chapterComplete ? "本章已完成" : "标记本章完成" }}
      </button>
    </div>
    <div v-if="selectionText" class="selection-actions" role="toolbar" aria-label="选区操作">
      <span>已选 {{ selectionText.length }} 字</span
      ><button class="btn btn-sm" @mousedown.prevent @click="$emit('revise')">
        <Feather :size="14" />润色选区</button
      ><button class="btn btn-ghost btn-sm" @mousedown.prevent @click="$emit('ask')">
        围绕选区提问<ArrowUpRight :size="13" /></button
      ><button
        class="btn btn-ghost icon-button"
        aria-label="取消选区"
        @click="$emit('clearSelection')"
      >
        <X :size="14" />
      </button>
    </div>
    <div class="paper-scroll">
      <article class="paper">
        <div class="paper-running-head">
          <span>本科毕业论文（设计）</span><span>THESIS / DRAFT</span>
        </div>
        <div class="paper-cover-title">
          <span class="paper-kicker">毕业论文</span>
          <h1>{{ title }}</h1>
          <div class="paper-title-rule"></div>
        </div>
        <EditorContent :editor="editor" />
        <footer class="paper-end">— {{ wordCount.toLocaleString() }} 字 —</footer>
      </article>
      <div class="paper-bottom-space"></div>
    </div>
    <footer class="editor-status">
      <span>{{ wordCount.toLocaleString() }} 字<span class="status-divider">·</span>中文</span
      ><span>浏览器样稿<span class="status-divider">·</span>版本 {{ version }}</span>
    </footer>
  </section>
</template>
