<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { PhArrowRight, PhBookOpen, PhMagnifyingGlass } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { ApiError } from "@/services/errors";
import { coverageLabel, formatInstant, literatureMeta, verificationView } from "./literaturePresentation";
import { sourceLabel, sourceOptions, type LiteratureState } from "./useLiterature";

const props = defineProps<{ state: LiteratureState }>();
const emit = defineEmits<{ selected: [] }>();
const s = props.state;
const view = ref<"results" | "entries">(s.selection.value?.kind === "entry" ? "entries" : "results");

const statusView = computed(() => {
  const search = s.search.value;
  if (!search) return undefined;
  if (search.status === "queued" || search.status === "running")
    return { tone: "info" as const, label: "检索中", live: true, note: `正在向 ${sourceLabel(search.source)} 检索“${search.query}”。` };
  if (search.status === "failed")
    return {
      tone: "danger" as const,
      label: "检索失败",
      note: search.error_code ? new ApiError(search.error_code).message : "检索没有完成，已保存的文献不受影响，可按原条件重试。",
    };
  if (search.status === "cancelled") return { tone: "ghost" as const, label: "已取消", note: "本次检索已取消，迟到的结果不会写入。可按原条件重试。" };
  const snapshot = search.snapshot!;
  return {
    tone: "success" as const,
    label: "检索完成",
    note: `${sourceLabel(snapshot.source)} · ${snapshot.total_results} 条匹配 · 本页 ${snapshot.items.length} 条 · ${formatInstant(snapshot.retrieved_at)}`,
  };
});
const views = computed(() => [
  { value: "results" as const, label: `检索结果 ${s.results.value.length}` },
  { value: "entries" as const, label: `项目文献 ${s.entriesTotal.value ?? "—"}` },
]);
function isSelected(kind: "result" | "entry", key: number | string) {
  const value = s.selection.value;
  return value?.kind === "result" ? kind === "result" && value.index === key : value?.kind === "entry" && kind === "entry" && value.id === key;
}
function select(kind: "result" | "entry", key: number | string) {
  s.selection.value = kind === "result" ? { kind, index: key as number } : { kind, id: key as string };
  emit("selected");
}
function clearYears() {
  s.yearFrom.value = "";
  s.yearTo.value = "";
  s.formError.value = "";
}
watch(
  () => s.search.value?.id,
  (id, previous) => {
    if (id && id !== previous) view.value = "results";
  },
);
watch(s.includeRemoved, () => void s.loadEntries());
watch(
  () => s.selection.value,
  (value) => {
    if (value?.kind === "entry") view.value = "entries";
  },
);
</script>

<template>
  <div class="literature-index">
    <form class="library-section-note" novalidate @submit.prevent="s.submit()">
      <div>
        <h2 class="tp-subheading">文献检索</h2>
        <p class="tp-caption mt-2">公开来源的题录与摘要；不抓取全文。</p>
      </div>
      <label class="library-search">
        <TpIcon :icon="PhMagnifyingGlass" :size="17" />
        <input v-model="s.query.value" type="search" aria-label="检索式" placeholder="研究主题或关键词" maxlength="300" :disabled="s.running.value" />
      </label>
      <div class="literature-conditions">
        <TpSelect v-model="s.source.value" aria-label="文献来源" :options="sourceOptions" :disabled="s.running.value" />
        <input
          v-model="s.yearFrom.value"
          class="tp-input"
          inputmode="numeric"
          maxlength="4"
          aria-label="起始年份"
          placeholder="起始年份"
          :disabled="s.running.value"
        />
        <input
          v-model="s.yearTo.value"
          class="tp-input"
          inputmode="numeric"
          maxlength="4"
          aria-label="结束年份"
          placeholder="结束年份"
          :disabled="s.running.value"
        />
      </div>
      <Transition name="tp-swap" v-bind="panelMotionHooks">
        <p v-if="s.formError.value" :key="s.formError.value" class="literature-error" role="alert">{{ s.formError.value }}</p>
      </Transition>
      <div class="screen-actions">
        <TpButton v-if="!s.running.value" type="submit" size="sm" variant="primary" :loading="s.submitting.value">检索文献</TpButton>
        <TpButton v-else size="sm" :loading="s.pending.value === 'cancel'" @click="s.cancel()">取消检索</TpButton>
      </div>
    </form>

    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <div v-if="statusView" :key="`${s.search.value?.id}:${s.search.value?.status}`" class="literature-run" :data-status="s.search.value?.status">
        <TpStatus :tone="statusView.tone" :label="statusView.label" :live="statusView.live" size="sm" />
        <p class="tp-caption" role="status">{{ statusView.note }}</p>
        <TpButton
          v-if="s.search.value?.status === 'failed' || s.search.value?.status === 'cancelled'"
          size="sm"
          :loading="s.pending.value === 'retry'"
          @click="s.retry()"
          >按原条件重试</TpButton
        >
      </div>
    </Transition>
    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <p v-if="s.searchError.value" :key="s.searchError.value" class="studio-notice literature-alert" role="alert">
        {{ s.searchError.value }}<TpButton v-if="!s.running.value" size="sm" @click="s.submit()">重试检索</TpButton>
      </p>
    </Transition>

    <div class="literature-views"><TpSegmented v-model="view" label="文献列表" :options="views" /></div>

    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <div v-if="view === 'results'" key="results">
        <TransitionGroup v-if="s.results.value.length" name="tp-list" tag="div" class="tp-list-group" v-bind="listMotionHooks">
          <button
            v-for="item in s.results.value"
            :key="`${s.search.value?.id}:${item.index}`"
            type="button"
            class="library-literature-row"
            :class="{ 'is-selected': isSelected('result', item.index) }"
            :aria-pressed="isSelected('result', item.index)"
            @click="select('result', item.index)"
          >
            <span class="library-file-copy">
              <span class="library-file-title">{{ item.title }}</span>
              <span class="tp-caption library-row-meta">{{ literatureMeta(item) }}</span>
              <span class="library-row-scope">{{ sourceLabel(item.source) }} · {{ coverageLabel(item) }}</span>
            </span>
            <span class="literature-row-end">
              <TpStatus v-if="item.saved_entry_id" tone="success" label="已保存" size="sm" />
              <TpIcon :icon="PhArrowRight" :size="17" class="text-fg-muted" />
            </span>
          </button>
        </TransitionGroup>
        <div v-else-if="s.search.value?.status === 'succeeded'" class="library-empty" role="status">
          <TpIcon :icon="PhMagnifyingGlass" :size="28" />
          <h2 class="tp-subheading">来源没有返回匹配文献</h2>
          <p class="tp-caption">可调整关键词、年份或来源。</p>
          <TpButton v-if="s.yearFrom.value || s.yearTo.value" size="sm" @click="clearYears">清除年份限制</TpButton>
        </div>
        <div v-else-if="!s.search.value" class="library-empty" role="status">
          <TpIcon :icon="PhBookOpen" :size="28" />
          <h2 class="tp-subheading">从一次检索开始</h2>
          <p class="tp-caption">结果会固定为可回看的检索快照。</p>
        </div>
      </div>
      <div v-else key="entries">
        <label class="library-checkbox literature-removed"><input v-model="s.includeRemoved.value" class="tp-checkbox" type="checkbox" />显示已移出</label>
        <TpState
          v-if="s.entriesError.value && !s.entries.value.length"
          kind="error"
          title="项目文献读取失败"
          :desc="s.entriesError.value"
          retryable
          @retry="s.loadEntries()"
        />
        <Transition v-else name="tp-swap" v-bind="panelMotionHooks">
          <p v-if="s.entriesError.value" :key="s.entriesError.value" class="studio-notice literature-alert" role="alert">
            {{ s.entriesError.value }}<TpButton size="sm" @click="s.loadEntries()">重新读取项目文献</TpButton>
          </p>
        </Transition>
        <p v-if="s.entriesLoading.value && !s.entries.value.length" class="library-loading" role="status">正在读取项目文献…</p>
        <TransitionGroup v-else-if="s.entries.value.length" name="tp-list" tag="div" class="tp-list-group" v-bind="listMotionHooks">
          <button
            v-for="entry in s.entries.value"
            :key="entry.id"
            type="button"
            class="library-literature-row"
            :class="{ 'is-selected': isSelected('entry', entry.id), 'is-removed': entry.removed }"
            :aria-pressed="isSelected('entry', entry.id)"
            @click="select('entry', entry.id)"
          >
            <span class="library-file-copy">
              <span class="library-file-title">{{ entry.record.title }}</span>
              <span class="tp-caption library-row-meta">{{ literatureMeta(entry.record) }}</span>
              <span class="library-row-scope">{{ sourceLabel(entry.record.source) }} · {{ coverageLabel(entry.record) }}</span>
            </span>
            <span class="literature-row-end">
              <TpStatus v-if="entry.removed" tone="ghost" label="已移出" size="sm" />
              <TpStatus v-else :tone="verificationView(entry).tone" :label="verificationView(entry).label" size="sm" />
            </span>
          </button>
        </TransitionGroup>
        <div v-else-if="!s.entriesLoading.value && !s.entriesError.value" class="library-empty" role="status">
          <TpIcon :icon="PhBookOpen" :size="28" />
          <h2 class="tp-subheading">还没有保存的文献</h2>
          <p class="tp-caption">从检索结果选择并保存到当前项目。</p>
        </div>
      </div>
    </Transition>
    <footer class="library-list-footer">
      <span>{{ view === "results" ? `${s.results.value.length} 条检索结果` : `${s.entriesTotal.value ?? 0} 篇项目文献` }}</span>
    </footer>
  </div>
</template>

<style scoped>
.library-section-note {
  display: grid;
  gap: 16px;
  padding: 20px;
  border-bottom: 1px solid var(--tp-line);
}
.library-search {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 36px;
  color: var(--tp-text-muted);
  border-bottom: 1px solid var(--tp-line-strong);
  padding-bottom: 8px;
}
.library-search input {
  width: 100%;
  min-width: 0;
  background: transparent;
  outline-offset: 4px;
  color: var(--tp-text);
}
.library-search input::placeholder {
  color: var(--tp-text-muted);
}
.library-search input::-webkit-search-cancel-button {
  appearance: none;
}
.literature-conditions {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
.literature-conditions > * {
  min-width: 0;
}
.literature-conditions .tp-input {
  width: 100%;
}
.literature-error {
  color: var(--tp-danger-content);
  font-size: 12px;
}
.literature-run {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--tp-line);
  background: var(--tp-surface-sunken);
}
.literature-run .tp-caption {
  flex: 1 1 220px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.literature-alert {
  margin: 16px 20px 0;
}
.literature-views {
  padding: 16px 20px;
  border-bottom: 1px solid var(--tp-line);
}
.literature-removed {
  padding: 16px 20px 0;
}
.library-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  font-size: 12px;
  color: var(--tp-text-muted);
}
.library-literature-row {
  width: 100%;
  text-align: left;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  padding: 20px;
  border-bottom: 1px solid var(--tp-line);
  position: relative;
  align-items: start;
  transition: background var(--tp-dur-fast);
  color: var(--tp-text);
}
.library-literature-row:hover {
  background: var(--tp-surface-sunken);
}
.library-literature-row.is-selected {
  background: color-mix(in srgb, var(--tp-ink) 4%, var(--tp-surface));
  box-shadow: inset 2px 0 var(--tp-ink);
}
.library-literature-row.is-removed .library-file-title {
  color: var(--tp-text-muted);
}
.library-file-copy {
  min-width: 0;
}
.library-file-title {
  font-weight: 600;
  line-height: 1.55;
  display: block;
  overflow-wrap: anywhere;
}
.library-row-meta {
  display: block;
  margin-top: 4px;
  overflow-wrap: anywhere;
}
.library-row-scope {
  display: block;
  margin-top: 8px;
  color: var(--tp-text-muted);
  font-size: 11px;
}
.literature-row-end {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
.library-empty {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 48px 20px;
  text-align: center;
  color: var(--tp-text-muted);
}
.library-loading {
  padding: 32px 20px;
  text-align: center;
  color: var(--tp-text-muted);
  font-size: 12px;
}
.library-list-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  color: var(--tp-text-muted);
  font-size: 11px;
}
@media (max-width: 640px) {
  .library-section-note {
    padding: 16px;
  }
  .literature-conditions {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .literature-conditions > :first-child {
    grid-column: 1 / -1;
  }
  .literature-run,
  .literature-views,
  .library-list-footer {
    padding-left: 16px;
    padding-right: 16px;
  }
  .literature-removed {
    padding: 16px 16px 0;
  }
  .literature-alert {
    margin: 12px 16px 0;
  }
  .library-literature-row {
    padding: 16px;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .literature-row-end svg {
    display: none;
  }
}
</style>
