<script setup lang="ts">
import WorkspaceHeader from "./components/WorkspaceHeader.vue";
import DocumentOutline from "./components/DocumentOutline.vue";
import EditorToolbar from "./components/EditorToolbar.vue";
import PaperEditor from "./components/PaperEditor.vue";
import AssistantWorkspace from "./components/AssistantWorkspace.vue";
import MilestoneNotice from "./components/MilestoneNotice.vue";
import { useWorkspace } from "./composables/useWorkspace";
import { X } from "@lucide/vue";

const {
  title,
  editor,
  version,
  saved,
  error,
  toast,
  activeSection,
  selectionText,
  assistantOpen,
  focused,
  outlineOpen,
  mode,
  layout,
  role,
  secondRole,
  messages,
  candidate,
  stale,
  report,
  completed,
  reminder,
  deferredReminder,
  outline,
  wordCount,
  currentChapter,
  openAssistant,
  send,
  revise,
  accept,
  reject,
  runReview,
  locate,
  completeChapter,
  deferReminder,
  downloadReport,
} = useWorkspace();

function toggleFocus() {
  focused.value = !focused.value;
}
function toggleAssistant() {
  if (focused.value) {
    focused.value = false;
    assistantOpen.value = true;
  } else assistantOpen.value = !assistantOpen.value;
}
function clearSelection() {
  if (editor.value)
    editor.value.chain().focus().setTextSelection(editor.value.state.selection.to).run();
}
async function requestRevision() {
  openAssistant("writing");
  await revise();
}
</script>

<template>
  <div
    class="workspace"
    :class="{
      'focus-mode': focused,
      'has-assistant': assistantOpen && !focused,
      'split-assistant': layout === 'split',
      'hide-outline': !outlineOpen || focused,
    }"
  >
    <WorkspaceHeader
      :title="title"
      :saved="saved"
      :focused="focused"
      :assistant-open="assistantOpen && !focused"
      @toggle-focus="toggleFocus"
      @toggle-assistant="toggleAssistant"
      @toggle-outline="outlineOpen = !outlineOpen"
      @review="runReview"
    />
    <div class="workspace-body">
      <DocumentOutline
        v-show="outlineOpen && !focused"
        :items="outline"
        :active="activeSection"
        :completed="completed"
        @navigate="locate"
        @review="runReview"
      />
      <main class="document-main">
        <EditorToolbar :editor="editor" @toggle-outline="outlineOpen = !outlineOpen" />
        <div v-if="error && !assistantOpen" class="workspace-error" role="alert">
          {{ error
          }}<button class="btn btn-ghost icon-button" aria-label="收起错误提示" @click="error = ''">
            <X :size="15" />
          </button>
        </div>
        <PaperEditor
          :editor="editor"
          :title="title"
          :selection-text="selectionText"
          :word-count="wordCount"
          :version="version"
          :current-chapter="currentChapter"
          :chapter-complete="completed.includes(currentChapter)"
          @revise="requestRevision"
          @ask="openAssistant('all')"
          @clear-selection="clearSelection"
          @complete="completeChapter"
        />
        <MilestoneNotice
          v-if="reminder"
          :chapter="reminder"
          @review="
            runReview();
            reminder = null;
          "
          @later="deferReminder"
          @dismiss="reminder = null"
        />
      </main>
      <AssistantWorkspace
        v-show="assistantOpen && !focused"
        v-model:mode="mode"
        v-model:layout="layout"
        v-model:role="role"
        v-model:second-role="secondRole"
        :messages="messages"
        :selection-text="selectionText"
        :candidate="candidate"
        :stale="stale"
        :report="report"
        :error="error"
        @close="assistantOpen = false"
        @send="send"
        @revise="requestRevision"
        @accept="accept"
        @reject="reject"
        @review="runReview"
        @locate="locate"
        @download-report="downloadReport"
      />
    </div>
    <button
      v-if="deferredReminder && !reminder"
      class="deferred-reminder btn btn-sm"
      @click="
        openAssistant('progress');
        send('progress', `${deferredReminder}完成后，下一步怎么安排？`);
        deferredReminder = null;
      "
    >
      有 1 条待查看的进度建议
    </button>
    <div class="toast-region" role="status" aria-live="polite">
      <span v-if="toast">{{ toast }}</span>
    </div>
  </div>
</template>
