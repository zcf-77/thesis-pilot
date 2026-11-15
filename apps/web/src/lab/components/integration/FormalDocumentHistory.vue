<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpState from "@/components/ui/TpState.vue";
import VersionTimeline from "@/components/domain/VersionTimeline.vue";
import type { VersionView } from "@/domain/types";
import { ApiError, asApiError, type BackendServices, type DocumentRead, type DocumentVersionPage, type DocumentVersionRead } from "@/services";
import { editorSnapshotSchema } from "../../state/editorSchema";
import type { createRemoteDocumentController } from "../../state/remoteDocuments";
import { panelMotionHooks } from "./motion";

const props = defineProps<{
  controller: ReturnType<typeof createRemoteDocumentController>;
  services: BackendServices;
  projectId: string;
  requestedVersion?: number;
}>();
const pageSize = 12;
const page = shallowRef<DocumentVersionPage>();
const detail = shallowRef<DocumentVersionRead>();
const selected = ref<number>();
const listLoading = ref(false);
const detailLoading = ref(false);
const listError = ref("");
const detailError = ref("");
let requestedOffset = 0;
let listRequest: AbortController | undefined;
let detailRequest: AbortController | undefined;

const document = computed(() => props.controller.state.latest ?? props.controller.state.document);
const context = computed(() => {
  const current = document.value;
  return current?.project_id === props.projectId ? JSON.stringify([props.services.sourceKey, props.projectId, current.id]) : "";
});
const timeline = computed<VersionView[]>(
  () =>
    page.value?.items.map((item) => ({
      v: item.version,
      at: new Date(item.created_at).toLocaleString("zh-CN"),
      cause: item.source === "local_import" ? "import" : "manual",
      summary: "",
      words: 0,
      current: item.version === document.value?.version,
    })) ?? [],
);
function documentText(content: DocumentRead["content"]) {
  const node = editorSnapshotSchema.nodeFromJSON(content.json);
  return node.textBetween(0, node.content.size, "\n\n", (leaf) => (leaf.type.name === "hardBreak" ? "\n" : ""));
}
const comparison = computed(() => {
  const entry = detail.value;
  const current = document.value;
  if (!entry || !current) return;
  return {
    version: entry.version,
    historical: documentText(entry.content),
    currentVersion: current.version,
    current: documentText(current.content),
  };
});

async function loadPage(offset = 0) {
  const current = document.value;
  if (!current || !context.value) return;
  const captured = context.value;
  const controller = props.controller;
  listRequest?.abort();
  const request = (listRequest = new AbortController());
  const isCurrent = () => request === listRequest && captured === context.value && controller === props.controller;
  requestedOffset = offset;
  listLoading.value = true;
  listError.value = "";
  try {
    const result = await props.services.documents.versions(props.projectId, current.id, { limit: pageSize, offset }, request.signal);
    if (isCurrent()) page.value = result;
  } catch (cause) {
    if (!isCurrent()) return;
    const error = asApiError(cause);
    if (error.code !== "REQUEST_CANCELLED") listError.value = error.message;
  } finally {
    if (isCurrent()) {
      listLoading.value = false;
      listRequest = undefined;
    }
  }
}

async function openComparison(version: number) {
  const current = document.value;
  if (!current || !context.value) return;
  const captured = context.value;
  const controller = props.controller;
  detailRequest?.abort();
  const request = (detailRequest = new AbortController());
  const isCurrent = () => request === detailRequest && captured === context.value && controller === props.controller;
  selected.value = version;
  detailLoading.value = true;
  detailError.value = "";
  detail.value = undefined;
  try {
    const result = await props.services.documents.version(props.projectId, current.id, version, request.signal);
    if (!isCurrent()) return;
    if (result.project_id !== props.projectId || result.document_id !== current.id || result.version !== version) throw new ApiError("INVALID_RESPONSE");
    detail.value = result;
  } catch (cause) {
    if (!isCurrent()) return;
    const error = asApiError(cause);
    if (error.code !== "REQUEST_CANCELLED") detailError.value = error.message;
  } finally {
    if (isCurrent()) {
      detailLoading.value = false;
      detailRequest = undefined;
    }
  }
}

function closeComparison() {
  detailRequest?.abort();
  detailRequest = undefined;
  selected.value = undefined;
  detail.value = undefined;
  detailLoading.value = false;
  detailError.value = "";
}

function reset() {
  listRequest?.abort();
  listRequest = undefined;
  page.value = undefined;
  listLoading.value = false;
  listError.value = "";
  closeComparison();
}

watch(
  [context, () => props.controller],
  ([scope]) => {
    reset();
    if (!scope) return;
    void loadPage();
    if (props.requestedVersion !== undefined) void openComparison(props.requestedVersion);
  },
  { immediate: true },
);
watch(
  () => props.requestedVersion,
  (version) => {
    if (version !== undefined && selected.value !== version) void openComparison(version);
  },
);
watch(
  () => document.value?.version,
  (version, previous) => {
    if (version !== undefined && previous !== undefined && version !== previous && page.value) void loadPage(page.value.offset);
  },
);
onScopeDispose(reset);
</script>

<template>
  <section class="studio-stack" aria-label="正式稿版本">
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <TpState v-if="listError" :key="listError" kind="error" title="无法读取正式稿版本" :desc="listError" retryable @retry="loadPage(requestedOffset)" />
      <p v-else-if="listLoading && !page" key="loading" class="tp-caption" role="status">正在读取正式稿版本…</p>
      <p v-else-if="!timeline.length" key="empty" class="tp-caption">暂无正式稿版本。</p>
    </Transition>
    <VersionTimeline v-if="timeline.length" :versions="timeline" read-only hide-words @compare="openComparison" />
    <nav v-if="page && page.total > page.limit" class="screen-actions" aria-label="正式稿版本分页">
      <TpButton size="sm" :disabled="listLoading || page.offset === 0" @click="loadPage(Math.max(0, page.offset - page.limit))">上一页</TpButton>
      <span class="tp-caption">第 {{ Math.floor(page.offset / page.limit) + 1 }} 页</span>
      <TpButton size="sm" :disabled="listLoading || page.offset + page.limit >= page.total" @click="loadPage(page.offset + page.limit)">下一页</TpButton>
    </nav>

    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <section
        v-if="selected !== undefined"
        :key="selected"
        class="screen-panel studio-body studio-stack formal-history__comparison"
        aria-label="正式稿版本对比"
      >
        <div class="studio-row">
          <h3 class="tp-subheading">正式稿 v{{ selected }}</h3>
          <TpButton size="sm" variant="ghost" @click="closeComparison">收起对比</TpButton>
        </div>
        <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
          <TpState
            v-if="detailError"
            :key="detailError"
            kind="error"
            title="无法读取所选版本"
            :desc="detailError"
            retryable
            @retry="openComparison(selected)"
          />
          <p v-else-if="detailLoading" key="detail-loading" class="tp-caption" role="status">正在读取所选版本…</p>
          <div v-else-if="comparison" key="comparison" class="studio-stack">
            <div>
              <h4 class="tp-caption">所选正式稿 v{{ comparison.version }} 正文文本</h4>
              <p class="formal-history__text">{{ comparison.historical }}</p>
            </div>
            <div>
              <h4 class="tp-caption">当前已保存正式稿 v{{ comparison.currentVersion }} 正文文本</h4>
              <p class="formal-history__text">{{ comparison.current }}</p>
            </div>
          </div>
        </Transition>
      </section>
    </Transition>
  </section>
</template>

<style scoped>
.formal-history__comparison > .studio-row {
  flex-wrap: wrap;
}
.formal-history__text {
  margin-top: 8px;
  max-height: 240px;
  overflow: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  color: var(--tp-text-muted);
  font-size: 12px;
  line-height: 1.75;
}
</style>
