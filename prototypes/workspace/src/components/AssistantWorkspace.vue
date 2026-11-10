<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ArrowLeft, ArrowRight, Columns2, Sparkles, X } from "@lucide/vue";
import type {
  AgentRole,
  AssistantMode,
  ChatMessage,
  PanelLayout,
  RevisionCandidate,
  ReviewReportData,
} from "../types";
import AgentPanel from "./AgentPanel.vue";
import RevisionReview from "./RevisionReview.vue";
import ReviewReport from "./ReviewReport.vue";

const props = defineProps<{
  mode: AssistantMode;
  layout: PanelLayout;
  role: AgentRole;
  secondRole: AgentRole;
  messages: Record<AgentRole, ChatMessage[]>;
  selectionText: string;
  candidate: RevisionCandidate | null;
  stale: boolean;
  report: ReviewReportData | null;
  error: string;
}>();
const emit = defineEmits<{
  "update:mode": [mode: AssistantMode];
  "update:layout": [layout: PanelLayout];
  "update:role": [role: AgentRole];
  "update:secondRole": [role: AgentRole];
  close: [];
  send: [role: AgentRole, text: string];
  revise: [];
  accept: [];
  reject: [];
  review: [];
  locate: [section: string];
  downloadReport: [];
}>();

const specialists: { value: AgentRole; label: string }[] = [
  { value: "literature", label: "文献助手" },
  { value: "writing", label: "论文助手" },
  { value: "format", label: "格式助手" },
  { value: "progress", label: "进度助手" },
  { value: "review", label: "评审助手" },
];
const firstRole = computed<AgentRole>(() =>
  props.mode === "combined" ? "all" : props.role === "all" ? "writing" : props.role,
);
const resultExpanded = ref(false);
const hasResult = computed(() => Boolean(props.candidate || props.report));
const resultLabel = computed(() =>
  props.candidate && props.report
    ? "查看修订与评审结果"
    : props.candidate
      ? "查看修订结果"
      : "查看评审结果",
);

watch(
  () => [props.candidate, props.report, props.candidate?.id, props.report?.version] as const,
  ([candidate, report]) => {
    resultExpanded.value = Boolean(candidate || report);
  },
  { immediate: true },
);

function setMode(mode: AssistantMode) {
  resultExpanded.value = false;
  emit("update:mode", mode);
  if (mode === "specialist" && props.role === "all") emit("update:role", "writing");
}

function selectRole(event: Event, second = false) {
  resultExpanded.value = false;
  const value = (event.target as HTMLSelectElement).value as AgentRole;
  if (second) emit("update:secondRole", value);
  else emit("update:role", value);
}

function toggleLayout() {
  resultExpanded.value = false;
  emit("update:layout", props.layout === "split" ? "single" : "split");
}
</script>

<template>
  <aside class="assistant-workspace" :class="{ split: layout === 'split' }" aria-label="辅助工作台">
    <header class="workspace-heading">
      <div>
        <Sparkles :size="16" :stroke-width="1.6" aria-hidden="true" />
        <h2>辅助工作台</h2>
      </div>
      <button
        class="btn btn-sm btn-ghost close-button"
        type="button"
        aria-label="关闭辅助面板"
        @click="emit('close')"
      >
        <X :size="16" aria-hidden="true" />
      </button>
    </header>
    <div class="workspace-tools">
      <div class="mode-switch" aria-label="助手模式">
        <button
          type="button"
          :class="{ active: mode === 'combined' }"
          :aria-pressed="mode === 'combined'"
          @click="setMode('combined')"
        >
          综合助手</button
        ><button
          type="button"
          :class="{ active: mode === 'specialist' }"
          :aria-pressed="mode === 'specialist'"
          @click="setMode('specialist')"
        >
          专业分工
        </button>
      </div>
      <button
        class="btn btn-sm btn-ghost layout-button"
        type="button"
        :class="{ active: layout === 'split' }"
        :aria-pressed="layout === 'split'"
        @click="toggleLayout"
      >
        <Columns2 :size="14" aria-hidden="true" /><span>并排面板</span>
      </button>
    </div>
    <div v-if="hasResult" class="result-navigation">
      <button
        class="btn btn-sm btn-ghost result-toggle"
        type="button"
        :aria-expanded="resultExpanded"
        @click="resultExpanded = !resultExpanded"
      >
        <ArrowLeft v-if="resultExpanded" :size="13" aria-hidden="true" />
        <span>{{ resultExpanded ? "返回对话" : resultLabel }}</span>
        <ArrowRight v-if="!resultExpanded" :size="13" aria-hidden="true" />
      </button>
    </div>
    <div v-show="!resultExpanded" class="panels">
      <div class="panel-column">
        <div v-if="mode === 'specialist'" class="panel-selector">
          <select :value="firstRole" aria-label="选择专业助手" @change="selectRole($event)">
            <option
              v-for="specialist in specialists"
              :key="specialist.value"
              :value="specialist.value"
            >
              {{ specialist.label }}
            </option>
          </select>
        </div>
        <AgentPanel
          :role="firstRole"
          :messages="messages[firstRole]"
          :selection-text="selectionText"
          @send="emit('send', firstRole, $event)"
          @revise="emit('revise')"
          @review="emit('review')"
        />
      </div>
      <div v-show="layout === 'split'" class="panel-column second-panel">
        <div class="panel-selector">
          <select
            :value="secondRole"
            aria-label="选择第二面板助手"
            @change="selectRole($event, true)"
          >
            <option value="all">综合助手</option>
            <option
              v-for="specialist in specialists"
              :key="specialist.value"
              :value="specialist.value"
            >
              {{ specialist.label }}
            </option>
          </select>
        </div>
        <AgentPanel
          :role="secondRole"
          :messages="messages[secondRole]"
          :selection-text="selectionText"
          @send="emit('send', secondRole, $event)"
          @revise="emit('revise')"
          @review="emit('review')"
        />
      </div>
    </div>
    <div v-if="hasResult" v-show="resultExpanded" class="shared-results" aria-label="建议与报告">
      <RevisionReview
        v-if="candidate"
        :candidate="candidate"
        :stale="stale"
        :error="error"
        @accept="emit('accept')"
        @reject="emit('reject')"
      />
      <ReviewReport
        v-if="report"
        :report="report"
        @locate="emit('locate', $event)"
        @download="emit('downloadReport')"
      />
    </div>
    <p v-if="error && !candidate" class="workspace-error" role="alert">{{ error }}</p>
  </aside>
</template>

<style scoped>
.assistant-workspace {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--line);
  background: #fdfefd;
  color: var(--ink);
}
.workspace-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 57px;
  padding: 0 16px 0 19px;
  border-bottom: 1px solid var(--line);
}
.workspace-heading > div {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--accent);
}
h2 {
  margin: 0;
  color: var(--ink);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.3px;
}
.close-button {
  width: 27px;
  height: 27px;
  min-height: 27px;
  padding: 0;
  color: var(--muted);
}
.workspace-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px 15px 11px;
  border-bottom: 1px solid var(--line);
}
.mode-switch {
  display: flex;
  padding: 3px;
  gap: 2px;
  border-radius: 7px;
  background: #f0f3ef;
}
.mode-switch button {
  min-height: 27px;
  padding: 0 10px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.mode-switch button.active {
  background: white;
  color: var(--accent);
  box-shadow: 0 1px 3px #253b370d;
  font-weight: 500;
}
.layout-button {
  min-height: 27px;
  height: 27px;
  padding: 0 5px;
  gap: 5px;
  color: var(--muted);
  font-size: 10px;
  font-weight: 400;
}
.layout-button.active {
  color: var(--accent);
  background: var(--soft);
}
.result-navigation {
  flex-shrink: 0;
  padding: 5px 15px;
  border-bottom: 1px solid var(--line);
}
.result-toggle {
  height: 28px;
  min-height: 28px;
  padding: 0 4px;
  color: var(--accent);
  font-size: 11px;
  font-weight: 400;
}
.panels {
  display: flex;
  flex: 1;
  min-height: 145px;
  min-width: 0;
  overflow: hidden;
}
.panel-column {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.second-panel {
  border-left: 1px solid var(--line);
}
.panel-selector {
  display: flex;
  align-items: center;
  min-height: 42px;
  padding: 7px 16px 0;
}
select {
  width: 100%;
  max-width: 180px;
  padding: 5px 20px 5px 7px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: white;
  color: var(--ink);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.shared-results {
  flex: 1;
  min-height: 0;
  max-height: none;
  min-width: 0;
  overflow: auto;
  overscroll-behavior: contain;
  background: white;
  scrollbar-width: thin;
}
.shared-results > :deep(.review-report:not(:first-child)) {
  border-top: 1px solid var(--line);
}
.workspace-error {
  flex-shrink: 0;
  margin: 0;
  padding: 14px 18px;
  color: #ac5345;
  font-size: 11px;
  line-height: 1.8;
}
button:focus-visible,
select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
@media (max-width: 780px) {
  .split .panels {
    flex-direction: column;
  }
  .second-panel {
    border-left: 0;
    border-top: 1px solid var(--line);
  }
  .split .panel-column {
    flex: 1;
    overflow: hidden;
  }
}
</style>
