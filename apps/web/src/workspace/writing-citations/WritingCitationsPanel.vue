<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import { PhArrowsClockwise, PhBookOpenText, PhClockCounterClockwise, PhCrosshair, PhPencilSimpleLine, PhSealCheck } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpPencilFrame from "@/components/ui/TpPencilFrame.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { BackendServices } from "@/services";
import type { CitationCandidateRead, ProjectRead } from "@/services/contracts/api.generated.ts";
import type { PreviewHighlight } from "@muffin-office/vue/docs-anchors";
import {
  OVERLAY_GROUP,
  candidateFrame,
  candidateLabel,
  citedFocus,
  entryMeta,
  insertionContext,
  markerFocus,
  placementOf,
  verificationLabel,
  type FocusAnchor,
  type PanelDocument,
  type PanelSelection,
} from "./citationView";
import { useCitations } from "./useCitations";

/**
 * 写作页副驾 · 引用（AC-019）。从项目文献选一条，在光标处生成引用候选：
 * 候选只画铅笔标记，学生采纳后才由服务端写入上标标记与参考文献条目（GB/T 7714 顺序编码制）。
 */
const props = defineProps<{
  services: BackendServices;
  project: ProjectRead;
  document: PanelDocument | null;
  selection: PanelSelection | null;
  eligible: boolean;
}>();
const emit = defineEmits<{
  overlays: [group: string, highlights: PreviewHighlight[]];
  focus: [anchor: FocusAnchor];
  changed: [];
  close: [];
}>();

const state = useCitations({ services: () => props.services, projectId: () => props.project.id, document: () => props.document });
const { citable, list, ready, candidates, overlays, loading, loadError, actionError, pending, entryId } = state;

const v1 = computed(() => list.value?.schema_version === 1);
const placement = computed(() => placementOf(props.document?.snapshot, props.selection));
const context = computed(() =>
  props.document && placement.value ? insertionContext(props.document.snapshot, placement.value.node_id, placement.value.offset) : null,
);
const entry = computed(() => citable.value.find((item) => item.id === entryId.value));
const entryOptions = computed(() => [
  { value: "", label: citable.value.length ? "选择项目文献" : "暂无可引用的项目文献", disabled: true },
  ...citable.value.map((item) => ({ value: item.id, label: item.record.title })),
]);
const blocked = computed(() => {
  if (!props.document) return "正文尚未载入。";
  if (v1.value) return "正文仍是旧版结构，请先升级正文结构再插入引用。";
  if (!props.eligible) return "正文有未保存的修改或不是最新版本，请先保存后再生成或采纳引用。";
  if (!entry.value) return citable.value.length ? "请选择要引用的文献。" : "请先在资料页把文献保存到项目文献。";
  if (!placement.value) return "请把光标放在正文段落中（参考文献表之外）。";
  return "";
});
const applied = computed(() => candidates.value.filter((item) => item.status === "applied"));

watch(
  () => [props.project.id, props.document?.id, props.document?.version],
  () => void state.load(),
  { immediate: true },
);
// 宿主每次渲染都可能传入新的 document 对象：只在标记内容变化时替换纸面上的本组标记。
let emitted = "";
watch(
  overlays,
  (value) => {
    const key = JSON.stringify(value);
    if (key === emitted) return;
    emitted = key;
    emit("overlays", OVERLAY_GROUP, value);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  state.dispose();
  emit("overlays", OVERLAY_GROUP, []);
});

async function generate() {
  if (blocked.value || !placement.value) return;
  const item = await state.create(placement.value);
  if (item) emit("focus", markerFocus(item));
}
async function adopt(item: CitationCandidateRead) {
  if (await state.apply(item)) emit("changed");
}
async function revoke(item: CitationCandidateRead) {
  if (await state.undo(item)) emit("changed");
}
const busy = (key: string) => pending.value === key;
const contextOf = (item: CitationCandidateRead) =>
  props.document && item.base_version === props.document.version
    ? insertionContext(props.document.snapshot, item.placement.node_id, item.placement.offset)
    : null;
</script>

<template>
  <section class="cite-panel studio-stack" aria-label="引用文献">
    <header class="studio-row">
      <div>
        <h2 class="tp-subheading">插入引用</h2>
        <p class="tp-caption">GB/T 7714 顺序编码制</p>
      </div>
    </header>

    <section class="cite-insert" aria-label="插入引用">
      <TpField v-slot="{ id }" label="引用文献">
        <TpSelect :id="id" v-model="entryId" :options="entryOptions" :disabled="loading || !citable.length || !!pending" searchable />
      </TpField>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <div v-if="entry" :key="entry.id" class="cite-entry">
          <p class="cite-entry__meta">{{ entryMeta(entry) }}</p>
          <div class="cite-entry__facts">
            <TpStatus :tone="verificationLabel[entry.verification].tone" :label="verificationLabel[entry.verification].label" size="sm" />
            <span class="tp-caption">{{ entry.record.coverage === "abstract" ? "已取得题录与摘要" : "仅取得题录" }}</span>
          </div>
        </div>
      </Transition>
      <div class="cite-place" :data-ready="!!placement">
        <TpIcon :icon="PhCrosshair" :size="15" />
        <p v-if="context" class="cite-place__text">
          <span>{{ context.before }}</span><mark class="cite-caret" aria-label="插入位置" /><span>{{ context.after }}</span>
        </p>
        <p v-else class="tp-caption">在正文段落中放置光标作为插入位置</p>
      </div>
      <TpButton variant="pencil" size="sm" block :disabled="!!blocked || !!pending" :loading="busy('create')" @click="generate"
        ><TpIcon :icon="PhPencilSimpleLine" />生成引用候选</TpButton
      >
      <p v-if="blocked && props.document && !loading" class="tp-caption">{{ blocked }}</p>
    </section>

    <Transition name="tp-swap" v-bind="panelMotionHooks"
      ><p v-if="actionError || loadError" :key="actionError || loadError" role="alert" class="studio-notice">{{ actionError || loadError }}</p></Transition
    >
    <p v-if="loading" role="status" class="tp-caption">正在读取引用…</p>

    <TransitionGroup v-if="ready.length || applied.length" tag="div" name="tp-list" v-bind="listMotionHooks" class="cite-candidates tp-list-group">
      <TpPencilFrame v-for="item in [...ready, ...applied]" :key="item.id" :state="candidateFrame(item)" :class="{ 'tp-stale': item.stale }">
        <article class="tp-rev cite-card" :aria-label="`引用候选：${item.entry.title}`">
          <span v-if="item.status === 'applied'" class="tp-rev__seal"><TpSeal text="已采纳" /></span>
          <header class="tp-rev__head">
            <span class="cite-number tp-mono">{{ item.preview.marker.text }}</span>
            <div class="min-w-0 flex-1" :class="{ 'pr-20': item.status === 'applied' }">
              <h3 class="tp-rev__goal">{{ item.entry.title }}</h3>
              <p class="tp-rev__sub">
                <TpStatus v-if="item.status !== 'applied'" :tone="candidateLabel(item).tone" :label="candidateLabel(item).label" size="sm" />
                <span>{{ item.preview.reused ? "复用已有编号" : "新增编号" }}</span>
                <TpVersion :v="item.base_version" prefix="基于正文 " :stale="item.stale" />
                <TpVersion v-if="item.result_version" :v="item.result_version" prefix="形成 " />
              </p>
            </div>
          </header>
          <p v-if="contextOf(item)" class="cite-card__context">
            {{ contextOf(item)!.before }}<sup class="cite-card__marker">{{ item.preview.marker.text }}</sup>{{ contextOf(item)!.after }}
          </p>
          <div v-if="!item.stale" class="cite-card__reference">
            <p class="tp-label">{{ item.preview.heading.new ? "新建“参考文献”并追加" : item.preview.reference.new ? "参考文献追加" : "参考文献条目" }}</p>
            <p class="cite-card__entry">{{ item.preview.reference.text }}</p>
          </div>
          <p v-if="item.preview.renumbered.length && !item.stale" class="tp-caption">
            重新编号：{{ item.preview.renumbered.map((row) => `[${row.before}]→[${row.after}]`).join("、") }}
          </p>
          <footer class="tp-rev__foot">
            <template v-if="item.status === 'ready' && !item.stale">
              <TpButton variant="seal" size="sm" :disabled="!eligible || !item.applicable || !!pending" :loading="busy(`apply:${item.id}`)" @click="adopt(item)"
                ><TpIcon :icon="PhSealCheck" />采纳引用</TpButton
              >
              <TpButton variant="ghost" size="sm" :disabled="!!pending" :loading="busy(`reject:${item.id}`)" @click="state.reject(item)">拒绝</TpButton>
              <TpButton variant="ghost" size="sm" icon-only label="定位插入位置" @click="emit('focus', markerFocus(item))"
                ><TpIcon :icon="PhCrosshair"
              /></TpButton>
            </template>
            <template v-else-if="item.status === 'ready'">
              <span class="tp-caption">正文已变化，候选不能采纳</span>
              <TpButton class="ml-auto" variant="pencil" size="sm" :disabled="!eligible || !!pending" :loading="busy('create')" @click="state.regenerate(item)"
                ><TpIcon :icon="PhArrowsClockwise" />重新生成</TpButton
              >
              <TpButton variant="ghost" size="sm" :disabled="!!pending" @click="state.reject(item)">拒绝</TpButton>
            </template>
            <template v-else>
              <span class="tp-caption">已写入正文与参考文献</span>
              <TpButton class="ml-auto" variant="ghost" size="sm" :disabled="!eligible || !!pending" :loading="busy(`undo:${item.id}`)" @click="revoke(item)"
                ><TpIcon :icon="PhClockCounterClockwise" />撤销采纳</TpButton
              >
            </template>
          </footer>
        </article>
      </TpPencilFrame>
    </TransitionGroup>

    <section class="cite-list" aria-label="已引用文献">
      <p class="tp-label">已引用 · {{ list?.items.length ?? 0 }}</p>
      <p v-if="list && !list.consistent" class="studio-notice">正文中的引用标记与参考文献不一致，新引用无法自动编号；请在历史版本中比较后恢复。</p>
      <p v-if="list && !list.items.length" class="tp-caption">正文还没有引用。</p>
      <TransitionGroup tag="ol" name="tp-list" v-bind="listMotionHooks" class="tp-list-group">
        <li v-for="item in list?.items ?? []" :key="item.entry_id">
          <button type="button" class="cite-row" :disabled="!citedFocus(item)" @click="citedFocus(item) && emit('focus', citedFocus(item)!)">
            <span class="cite-number tp-mono">[{{ item.number }}]</span>
            <span class="cite-row__title">{{ item.title || "文献条目" }}</span>
            <span class="tp-caption">{{ item.markers.length }} 处</span>
            <TpIcon :icon="PhBookOpenText" :size="14" />
          </button>
        </li>
      </TransitionGroup>
    </section>
  </section>
</template>

<style scoped>
.cite-panel {
  gap: 16px;
}
.cite-insert {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--tp-line);
}
.cite-entry {
  display: grid;
  gap: 6px;
}
.cite-entry__meta {
  font-size: 12px;
  line-height: 1.6;
  color: var(--tp-text-muted);
  overflow-wrap: anywhere;
}
.cite-entry__facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.cite-place {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px dashed var(--tp-line-strong);
  border-radius: var(--tp-radius-s);
  color: var(--tp-text-muted);
  background: var(--tp-surface);
}
.cite-place[data-ready="true"] {
  border-color: var(--tp-pencil-line);
  color: var(--tp-pencil-content);
}
.cite-place__text {
  margin: 0;
  font-family: var(--tp-font-prose);
  font-size: 13px;
  line-height: 1.7;
  color: var(--tp-text);
  overflow-wrap: anywhere;
}
.cite-caret {
  display: inline-block;
  width: 2px;
  height: 1.1em;
  margin: 0 2px;
  vertical-align: text-bottom;
  border-radius: 1px;
  background: var(--tp-pencil);
}
.cite-number {
  flex-shrink: 0;
  min-width: 2.4em;
  font-size: 12px;
  font-weight: 600;
  color: var(--tp-protect-citation);
}
.cite-candidates {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cite-card {
  display: grid;
  gap: 10px;
}
.cite-card__context {
  margin: 0;
  font-family: var(--tp-font-prose);
  font-size: 13px;
  line-height: 1.75;
  color: var(--tp-text-muted);
  overflow-wrap: anywhere;
}
.cite-card__marker {
  padding: 0 2px;
  border-radius: var(--tp-radius-xs);
  color: var(--tp-pencil-content);
  background: var(--tp-pencil-soft);
  font-weight: 600;
}
.cite-card__reference {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-left: 2px solid var(--tp-pencil-line);
  background: var(--tp-pencil-soft);
  border-radius: 0 var(--tp-radius-s) var(--tp-radius-s) 0;
}
.cite-card__entry {
  margin: 0;
  font-family: var(--tp-font-prose);
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--tp-text);
  overflow-wrap: anywhere;
}
.cite-list {
  display: grid;
  gap: 8px;
}
.cite-list ol {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cite-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--tp-radius-s);
  text-align: left;
  font-size: 13px;
  color: var(--tp-text);
  transition: background-color var(--tp-dur-fast) var(--tp-ease-standard);
}
.cite-row:hover:not(:disabled),
.cite-row:focus-visible {
  background: var(--tp-surface-sunken);
}
.cite-row:focus-visible {
  outline: 2px solid var(--tp-focus);
  outline-offset: 1px;
}
.cite-row__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
