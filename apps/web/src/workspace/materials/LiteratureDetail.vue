<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { PhArrowSquareOut, PhBookOpen, PhChatsCircle, PhCheck, PhSealQuestion } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import { asApiError } from "@/services/errors";
import type { BackendServices } from "@/services";
import { coverageLabel, formatInstant, literatureMeta, verificationView, versionActionLabel } from "./literaturePresentation";
import { sourceLabel, type LiteratureState, type LiteratureVersion } from "./useLiterature";
import { MAX_ASSISTANT_LITERATURE, assistantLiteratureScope, useAssistantLiterature } from "../writing-citations/assistantLiterature";
import { writingRoute } from "../workspaceRoutes";

const props = defineProps<{ state: LiteratureState; services: BackendServices; projectId: string }>();
const s = props.state;
const result = computed(() => s.selectedResult.value);
const entry = computed(() => s.selectedEntry.value);
const record = computed(() => entry.value?.record ?? result.value);
const search = computed(() => s.search.value);
const verification = computed(() => (entry.value ? verificationView(entry.value) : undefined));
const savedEntry = computed(() => (result.value?.saved_entry_id ? s.entries.value.find((item) => item.id === result.value?.saved_entry_id) : undefined));
const history = shallowRef<LiteratureVersion[]>();
const historyError = ref("");
const historyOpen = ref(false);
let historyRequest: AbortController | undefined;

const retrievedAt = computed(() => entry.value?.retrieved_at ?? search.value?.snapshot?.retrieved_at);
const busy = (key: string) => s.pending.value === key;

async function loadHistory() {
  const current = entry.value;
  historyRequest?.abort();
  if (!current || !historyOpen.value) return;
  const controller = new AbortController();
  historyRequest = controller;
  try {
    const page = await props.services.literature.versions(props.projectId, current.id, { limit: 50 }, controller.signal);
    if (controller.signal.aborted) return;
    history.value = page.items;
    historyError.value = "";
  } catch (cause) {
    if (!controller.signal.aborted) historyError.value = asApiError(cause).message;
  }
}
watch(
  () => [entry.value?.id, entry.value?.version, historyOpen.value],
  () => void loadHistory(),
);
function toggleHistory(event: Event) {
  historyOpen.value = (event.target as HTMLDetailsElement).open;
}
const assistant = useAssistantLiterature(() => assistantLiteratureScope(props.services.sourceKey, props.projectId));
const inAssistant = computed(() => !!entry.value && assistant.has(entry.value.id));
const assistantFull = ref(false);
function toggleAssistant() {
  const current = entry.value;
  if (!current || current.removed) return;
  assistantFull.value = false;
  if (assistant.has(current.id)) assistant.remove(current.id);
  else assistantFull.value = !assistant.add(current);
}
watch(
  () => [entry.value?.id, entry.value?.version, entry.value?.removed],
  () => {
    if (entry.value) assistant.sync(s.entries.value);
  },
);
function openSaved() {
  if (savedEntry.value) s.selection.value = { kind: "entry", id: savedEntry.value.id };
}
</script>

<template>
  <div v-if="record" class="library-detail-content">
    <header class="library-detail-heading">
      <p class="tp-label">Reading record · 取得范围</p>
      <span class="tp-mono">{{ sourceLabel(record.source) }}</span>
    </header>
    <div class="library-paper library-paper--reference">
      <TpIcon :icon="PhBookOpen" :size="28" />
      <p class="tp-label mt-6">{{ entry ? "项目文献" : "检索结果" }} · {{ record.work_type ?? "类型未提供" }}</p>
      <h2 class="library-paper-title">{{ record.title }}</h2>
      <div class="library-paper-rule" />
      <p class="tp-caption">{{ literatureMeta(record) }}</p>
      <p v-if="record.publisher" class="tp-caption mt-1">{{ record.publisher }}</p>
      <p v-if="record.doi" class="library-paper-number tp-mono mt-3">DOI {{ record.doi }}</p>
    </div>
    <div class="library-detail-status">
      <TpStatus v-if="entry?.removed" tone="ghost" label="已移出项目文献" />
      <TpStatus v-else-if="verification" :tone="verification.tone" :label="verification.label" />
      <TpStatus v-else-if="result?.saved_entry_id" tone="success" label="已在项目文献" />
      <TpStatus v-else tone="ghost" label="尚未保存" />
      <span class="tp-caption">{{ coverageLabel(record) }}</span>
    </div>
    <div class="library-coverage library-coverage--large" :aria-label="'取得范围：' + coverageLabel(record)">
      <span class="is-available">题录</span><span :class="{ 'is-available': record.coverage === 'abstract' }">摘要</span><span>全文</span>
    </div>
    <p v-if="verification" class="tp-ghost library-detail-note"><TpIcon :icon="PhSealQuestion" :size="14" />{{ verification.note }}</p>
    <p class="tp-ghost library-detail-note">
      全文未取得{{ record.coverage === "abstract" ? "；下方摘要由来源提供" : "，来源也没有提供摘要" }}。没有取得的段落、页码与结论不能作为依据。
    </p>
    <div class="library-excerpt">
      <p class="tp-label">已取得摘要</p>
      <blockquote v-if="record.abstract">{{ record.abstract }}</blockquote>
      <p v-else class="tp-caption mt-2">来源未提供摘要。</p>
      <p class="tp-caption">
        {{ sourceLabel(record.source) }}<template v-if="retrievedAt"> · 检索于 {{ formatInstant(retrievedAt) }}</template
        ><template v-if="search?.snapshot && !entry"> · 响应摘要 {{ search.snapshot.response_sha256.slice(0, 12) }}</template>
      </p>
      <a v-if="record.source_url" class="literature-link" :href="record.source_url" target="_blank" rel="noopener noreferrer"
        >打开来源页面<TpIcon :icon="PhArrowSquareOut" :size="14"
      /></a>
    </div>
    <p v-if="s.actionError.value" class="studio-notice" role="alert">{{ s.actionError.value }}</p>
    <template v-if="result && !entry">
      <TpButton v-if="savedEntry" variant="tonal" block @click="openSaved">查看项目文献</TpButton>
      <TpButton
        v-else
        variant="primary"
        block
        :disabled="!!result.saved_entry_id || !!s.pending.value"
        :loading="busy(`save:${result.index}`)"
        @click="s.save(result)"
        >保存到项目文献</TpButton
      >
      <p class="tp-caption">保存时会用 DOI 向 Crossref 回查题名与年份；没有 DOI 的条目保持未核实。</p>
    </template>
    <template v-if="entry">
      <div class="screen-actions">
        <TpButton
          v-if="!entry.removed"
          size="sm"
          variant="pencil"
          :disabled="!!s.pending.value || !entry.record.doi"
          :loading="busy(`verify:${entry.id}`)"
          @click="s.verify(entry)"
          >重新核验 DOI</TpButton
        ><TpButton v-if="!entry.removed" size="sm" :disabled="!!s.pending.value" :loading="busy(`remove:${entry.id}`)" @click="s.remove(entry)"
          >移出项目文献</TpButton
        ><TpButton v-else size="sm" variant="primary" :disabled="!!s.pending.value" :loading="busy(`restore:${entry.id}`)" @click="s.restore(entry)"
          >恢复到项目文献</TpButton
        >
      </div>
      <div v-if="!entry.removed" class="library-assistant">
        <TpButton size="sm" :variant="inAssistant ? 'tonal' : 'outline'" :aria-pressed="inAssistant" @click="toggleAssistant"
          ><TpIcon :icon="inAssistant ? PhCheck : PhChatsCircle" />{{ inAssistant ? "已加入助手上下文" : "加入助手上下文" }}</TpButton
        >
        <RouterLink v-if="assistant.items.value.length" :to="writingRoute(projectId)" class="studio-link"
          >去写作页使用（{{ assistant.items.value.length }} 篇）</RouterLink
        >
        <p v-if="assistantFull" role="alert" class="tp-caption">一次最多加入 {{ MAX_ASSISTANT_LITERATURE }} 篇文献，请先移出部分文献。</p>
      </div>
      <details class="library-history tp-disclosure" @toggle="toggleHistory">
        <summary>条目记录 · v{{ entry.version }}</summary>
        <p v-if="historyError" class="tp-caption" role="alert">{{ historyError }}</p>
        <TransitionGroup v-if="history" name="tp-list" tag="div" class="tp-list-group" v-bind="listMotionHooks">
          <article v-for="item in history" :key="item.version">
            <b>v{{ item.version }} · {{ versionActionLabel[item.action] ?? item.action }}</b>
            <small
              >{{ formatInstant(item.created_at) }} ·
              {{ verificationView({ ...entry, verification: item.verification, verification_detail: item.verification_detail }).label }}</small
            >
          </article>
        </TransitionGroup>
      </details>
    </template>
  </div>
</template>

<style scoped>
.library-assistant {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.library-detail-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}
.library-detail-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.library-paper {
  position: relative;
  padding: 24px;
  background: var(--tp-surface);
  border: 1px solid var(--tp-line-strong);
  border-radius: var(--tp-radius-xs);
  box-shadow: var(--tp-shadow-1);
}
.library-paper-title {
  overflow-wrap: anywhere;
  margin-top: 8px;
  font-family: var(--tp-font-prose);
  font-size: 20px;
  line-height: 1.55;
  font-weight: 600;
  text-wrap: balance;
}
.library-paper-rule {
  height: 1px;
  background: var(--tp-line-strong);
  margin: 24px 0 16px;
  width: 36px;
}
.library-paper-number {
  overflow-wrap: anywhere;
  color: var(--tp-text-muted);
}
.library-detail-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.library-detail-note {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 12px;
  font-size: 12px;
  line-height: 1.7;
}
.library-detail-note svg {
  flex-shrink: 0;
  margin-top: 3px;
}
.library-coverage {
  display: flex;
  gap: 4px;
}
.library-coverage > span {
  flex: 1;
  text-align: center;
  padding: 8px;
  font-size: 12px;
  border: 1px dashed var(--tp-ghost-line);
  border-radius: var(--tp-radius-xs);
  color: var(--tp-text-muted);
}
.library-coverage > span.is-available {
  border-style: solid;
  border-color: var(--tp-line-strong);
  background: var(--tp-surface-sunken);
  color: var(--tp-text);
}
.library-excerpt {
  border-left: 2px solid var(--tp-line-strong);
  padding-left: 16px;
}
.library-excerpt blockquote {
  white-space: pre-line;
  font-family: var(--tp-font-prose);
  font-size: 14px;
  line-height: 1.9;
  margin: 12px 0;
  overflow-wrap: anywhere;
  max-height: 320px;
  overflow-y: auto;
}
.library-excerpt .tp-caption {
  font-size: 11px;
}
.literature-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--tp-text);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.library-history {
  display: grid;
  gap: 12px;
  padding: 16px;
  background: var(--tp-surface);
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-m);
}
.library-history article {
  padding: 12px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.library-history small {
  display: block;
  margin-top: 4px;
  color: var(--tp-text-muted);
}
@media (max-width: 1050px) {
  .library-detail-content {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 20px 32px;
  }
  .library-detail-heading {
    grid-column: 1 / -1;
  }
  .library-paper {
    grid-row: span 5;
  }
}
@media (max-width: 640px) {
  .library-detail-content {
    display: flex;
  }
}
</style>
