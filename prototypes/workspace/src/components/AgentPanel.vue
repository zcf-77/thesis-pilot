<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ArrowUp, FileCheck2, Sparkles, WandSparkles } from "@lucide/vue";
import type { AgentRole, ChatMessage } from "../types";

const props = defineProps<{
  role: AgentRole;
  messages: ChatMessage[];
  selectionText: string;
}>();
const emit = defineEmits<{
  send: [text: string];
  revise: [];
  review: [];
}>();

const descriptions: Record<AgentRole, { name: string; description: string; prompt: string }> = {
  all: {
    name: "综合助手",
    description: "从资料、写作到进度，围绕当前论文一起梳理。",
    prompt: "帮我梳理当前章节的写作思路",
  },
  literature: {
    name: "文献助手",
    description: "整理文献线索，辨析研究之间的联系与差异。",
    prompt: "如何组织这一节的文献综述？",
  },
  writing: {
    name: "论文助手",
    description: "聚焦章节结构、论证逻辑与学术表达。",
    prompt: "帮我梳理当前章节的论证结构",
  },
  format: {
    name: "格式助手",
    description: "对照论文要求，梳理标题、引用与排版问题。",
    prompt: "帮我梳理当前论文需要检查的格式项",
  },
  progress: {
    name: "进度助手",
    description: "结合阶段目标与现有产物，梳理下一步任务。",
    prompt: "帮我梳理本周的论文写作安排",
  },
  review: {
    name: "评审助手",
    description: "从问题、方法与论证出发，提出有依据的评审意见。",
    prompt: "评审前需要准备哪些论文材料？",
  },
};
const profile = computed(() => descriptions[props.role]);
const canRevise = computed(() => props.role === "all" || props.role === "writing");
const canReview = computed(() => props.role === "all" || props.role === "review");
const drafts = ref<Partial<Record<AgentRole, string>>>({});
const draft = computed({
  get: () => drafts.value[props.role] ?? "",
  set: (value: string) => {
    drafts.value[props.role] = value;
  },
});
const conversation = ref<HTMLElement | null>(null);

function send() {
  const text = draft.value.trim();
  if (!text) return;
  emit("send", text);
  draft.value = "";
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}

watch(
  () => [props.role, props.messages.length],
  async () => {
    await nextTick();
    if (conversation.value) conversation.value.scrollTop = conversation.value.scrollHeight;
  },
);
</script>

<template>
  <section class="agent-panel" :aria-label="`${profile.name}会话`">
    <div
      ref="conversation"
      class="conversation"
      role="log"
      aria-live="polite"
      :aria-label="`${profile.name}消息`"
    >
      <div v-if="messages.length === 0" class="empty-conversation">
        <span class="assistant-symbol"
          ><Sparkles :size="21" :stroke-width="1.6" aria-hidden="true"
        /></span>
        <h3>{{ profile.name }}</h3>
        <p>{{ profile.description }}</p>
        <div class="quick-actions">
          <button
            v-if="canRevise"
            class="btn btn-sm btn-ghost quick-action"
            type="button"
            :disabled="!selectionText.trim()"
            @click="emit('revise')"
          >
            <WandSparkles :size="15" aria-hidden="true" />润色选区
          </button>
          <button
            v-if="canReview"
            class="btn btn-sm btn-ghost quick-action"
            type="button"
            @click="emit('review')"
          >
            <FileCheck2 :size="15" aria-hidden="true" />仅评审
          </button>
          <button
            v-if="!canReview"
            class="btn btn-sm btn-ghost quick-action prompt-action"
            type="button"
            @click="emit('send', profile.prompt)"
          >
            {{ profile.prompt }}
          </button>
        </div>
      </div>
      <article
        v-for="message in messages"
        :key="message.id"
        class="message"
        :class="message.author"
      >
        <div class="message-author">
          <Sparkles v-if="message.author === 'assistant'" :size="13" aria-hidden="true" />
          <span>{{ message.author === "student" ? "你" : profile.name }}</span>
          <span v-if="message.author === 'assistant'" class="example-reply">示例回复</span>
        </div>
        <p>{{ message.text }}</p>
      </article>
    </div>

    <div class="composer-area">
      <div v-if="selectionText.trim()" class="selection-context" :title="selectionText">
        <span>选区</span><span class="selection-excerpt">{{ selectionText }}</span>
      </div>
      <div v-if="messages.length > 0 && (canRevise || canReview)" class="inline-actions">
        <button
          v-if="canRevise"
          type="button"
          class="btn btn-sm btn-ghost"
          :disabled="!selectionText.trim()"
          @click="emit('revise')"
        >
          <WandSparkles :size="14" aria-hidden="true" />润色选区
        </button>
        <button v-if="canReview" type="button" class="btn btn-sm btn-ghost" @click="emit('review')">
          <FileCheck2 :size="14" aria-hidden="true" />仅评审
        </button>
      </div>
      <form class="composer" @submit.prevent="send">
        <textarea
          v-model="draft"
          rows="2"
          placeholder="围绕当前论文提问…"
          :aria-label="`向${profile.name}提问`"
          @keydown="onKeyDown"
        />
        <button
          class="btn btn-sm send-button"
          type="submit"
          :disabled="!draft.trim()"
          :aria-label="`发送给${profile.name}`"
        >
          <ArrowUp :size="18" aria-hidden="true" />
        </button>
      </form>
    </div>
  </section>
</template>

<style scoped>
.agent-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.conversation {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 20px 18px;
  scrollbar-width: thin;
}
.empty-conversation {
  display: flex;
  min-height: 235px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 0 6px 24px;
}
.assistant-symbol {
  display: grid;
  width: 39px;
  height: 39px;
  margin-bottom: 17px;
  place-items: center;
  color: var(--accent);
  background: var(--soft);
  border-radius: 12px;
}
h3 {
  margin: 0 0 8px;
  color: var(--ink);
  font-size: 15px;
  font-weight: 600;
}
.empty-conversation p {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.9;
}
.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 22px;
}
.quick-action {
  min-height: 31px;
  height: auto;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: white;
  color: var(--ink);
  font-size: 11px;
  font-weight: 400;
  box-shadow: none;
}
.prompt-action {
  text-align: left;
  white-space: normal;
}
.message {
  margin-bottom: 23px;
  min-width: 0;
}
.message-author {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  color: var(--ink);
  font-size: 11px;
  font-weight: 600;
}
.example-reply {
  margin-left: auto;
  color: var(--muted);
  font-size: 10px;
  font-weight: 400;
}
.message p {
  margin: 0;
  color: var(--ink);
  font-size: 12px;
  line-height: 1.95;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.student {
  margin-left: 24px;
  padding: 12px;
  background: var(--soft);
  border-radius: 10px 10px 2px 10px;
}
.student .message-author {
  color: var(--muted);
}
.composer-area {
  padding: 10px 14px 14px;
}
.selection-context {
  display: flex;
  gap: 8px;
  min-width: 0;
  padding: 8px 9px;
  margin-bottom: 8px;
  border-left: 2px solid var(--accent);
  background: var(--soft);
  color: var(--muted);
  font-size: 10px;
}
.selection-context > :first-child {
  flex-shrink: 0;
  color: var(--accent);
}
.selection-excerpt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inline-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin: 0 0 6px -7px;
}
.inline-actions .btn {
  min-height: 28px;
  height: 28px;
  padding: 0 7px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 400;
}
.composer {
  position: relative;
  padding: 11px 11px 38px;
  border: 1px solid #d6dfd8;
  border-radius: 10px;
  background: white;
  transition: border-color 0.15s;
}
.composer:focus-within {
  border-color: var(--accent);
}
textarea {
  display: block;
  width: 100%;
  min-height: 43px;
  max-height: 135px;
  padding: 0;
  resize: vertical;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 12px;
  line-height: 1.8;
}
textarea::placeholder {
  color: #9ba39d;
}
.send-button {
  position: absolute;
  right: 9px;
  bottom: 9px;
  width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: var(--accent);
  color: white;
  box-shadow: none;
}
.send-button:disabled {
  background: var(--soft);
  color: #a7b3aa;
}
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
</style>
