<script setup lang="ts">
import { computed } from "vue";
import type { Editor } from "@tiptap/vue-3";
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Table2,
  PanelLeft,
} from "@lucide/vue";
const props = defineProps<{ editor: Editor | undefined }>();
defineEmits<{ toggleOutline: [] }>();
const block = computed(() => {
  if (props.editor?.isActive("heading", { level: 1 })) return "h1";
  if (props.editor?.isActive("heading", { level: 2 })) return "h2";
  return "paragraph";
});
function changeBlock(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  const editor = props.editor;
  if (!editor) return;
  if (value === "paragraph") editor.chain().focus().setParagraph().run();
  else
    editor
      .chain()
      .focus()
      .toggleHeading({ level: value === "h1" ? 1 : 2 })
      .run();
}
</script>

<template>
  <div class="editor-toolbar" role="toolbar" aria-label="正文格式">
    <button
      class="btn btn-ghost icon-button outline-toggle"
      aria-label="切换论文目录"
      @mousedown.prevent
      @click="$emit('toggleOutline')"
    >
      <PanelLeft :size="16" />
    </button>
    <div class="toolbar-group">
      <button
        class="btn btn-ghost icon-button"
        aria-label="撤销"
        :disabled="!editor?.can().undo()"
        @mousedown.prevent
        @click="editor?.chain().focus().undo().run()"
      >
        <Undo2 :size="16" />
      </button>
      <button
        class="btn btn-ghost icon-button"
        aria-label="重做"
        :disabled="!editor?.can().redo()"
        @mousedown.prevent
        @click="editor?.chain().focus().redo().run()"
      >
        <Redo2 :size="16" />
      </button>
    </div>
    <div class="toolbar-separator"></div>
    <select class="select block-select" aria-label="段落样式" :value="block" @change="changeBlock">
      <option value="paragraph">正文</option>
      <option value="h1">一级标题</option>
      <option value="h2">二级标题</option>
    </select>
    <div class="toolbar-separator"></div>
    <div class="toolbar-group">
      <button
        class="btn btn-ghost icon-button"
        aria-label="加粗"
        :aria-pressed="editor?.isActive('bold')"
        @mousedown.prevent
        @click="editor?.chain().focus().toggleBold().run()"
      >
        <Bold :size="16" />
      </button>
      <button
        class="btn btn-ghost icon-button"
        aria-label="斜体"
        :aria-pressed="editor?.isActive('italic')"
        @mousedown.prevent
        @click="editor?.chain().focus().toggleItalic().run()"
      >
        <Italic :size="16" />
      </button>
      <button
        class="btn btn-ghost icon-button"
        aria-label="无序列表"
        :aria-pressed="editor?.isActive('bulletList')"
        @mousedown.prevent
        @click="editor?.chain().focus().toggleBulletList().run()"
      >
        <List :size="17" />
      </button>
      <button
        class="btn btn-ghost icon-button"
        aria-label="有序列表"
        :aria-pressed="editor?.isActive('orderedList')"
        @mousedown.prevent
        @click="editor?.chain().focus().toggleOrderedList().run()"
      >
        <ListOrdered :size="17" />
      </button>
      <button
        class="btn btn-ghost icon-button secondary-tool"
        aria-label="引用段落"
        :aria-pressed="editor?.isActive('blockquote')"
        @mousedown.prevent
        @click="editor?.chain().focus().toggleBlockquote().run()"
      >
        <Quote :size="16" />
      </button>
      <button
        class="btn btn-ghost icon-button secondary-tool"
        aria-label="插入表格"
        @mousedown.prevent
        @click="
          editor?.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()
        "
      >
        <Table2 :size="16" />
      </button>
    </div>
    <span class="toolbar-template">示例论文样式</span>
  </div>
</template>
