<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpState from "@/components/ui/TpState.vue";
import VersionTimeline from "@/components/domain/VersionTimeline.vue";
import type { VersionView } from "@/domain/types";
import { listMotionHooks } from "@/design/motion";
import { ApiError, asApiError, type BackendServices, type DocumentRead, type DocumentVersionPage, type DocumentVersionRead } from "@/services";
import { editorSnapshotSchema } from "../../state/editorSchema";
import type { createRemoteDocumentController } from "../../state/remoteDocuments";
import type { createRemoteRevisionsController } from "../../state/remoteRevisions";
import { panelMotionHooks } from "./motion";

const props = defineProps<{
  controller: ReturnType<typeof createRemoteDocumentController>;
  services: BackendServices;
  projectId: string;
  requestedVersion?: number;
  linked?: boolean;
  revisions?: ReturnType<typeof createRemoteRevisionsController>;
  eligible?: boolean;
}>();
const emit = defineEmits<{ compare: [version: number]; close: [] }>();
const pageSize = 12;
const page = shallowRef<DocumentVersionPage>();
const detail = shallowRef<DocumentVersionRead>();
const selected = ref<number>();
const listLoading = ref(false);
const detailLoading = ref(false);
const listError = ref("");
const detailError = ref("");
const restoreRequested = ref(false);
const restoreReceiptBefore = ref<string>();
const restoreCommand = ref<string>();
let requestedOffset = 0;
let listRequest: AbortController | undefined;
let detailRequest: AbortController | undefined;

const document = computed(() => props.controller.state.latest ?? props.controller.state.document);
const revisionState = computed(() => props.revisions?.state);
const pendingReverts = computed(() => revisionState.value?.pendingCommands.filter((entry) => entry.operation === "revert") ?? []);
const canRestore = computed(
  () => props.eligible && !props.controller.state.issue && !!revisionState.value && !revisionState.value.busy && !revisionState.value.commandsBlocked,
);
const restoreError = computed(() => {
  const state = revisionState.value;
  return state?.storageError || ((restoreRequested.value || pendingReverts.value.length) && state?.error) || "";
});
const restoreResult = computed(() => {
  const receipt = revisionState.value?.latestReceipt;
  if (
    restoreRequested.value &&
    receipt?.operation === "revert" &&
    (restoreCommand.value ? receipt.command_id === restoreCommand.value : receipt.command_id !== restoreReceiptBefore.value) &&
    receipt.result_version === revisionState.value?.resultVersion
  )
    return receipt.result_version;
});
const versionCause = {
  blank: "blank",
  local_import: "import",
  manual_edit: "manual",
  ai_adoption: "adopt",
  adoption_undo: "undo",
  version_revert: "restore",
  schema_upgrade: "upgrade",
} satisfies Record<DocumentVersionRead["source"], VersionView["cause"]>;
const context = computed(() => {
  const current = document.value;
  return current?.project_id === props.projectId ? JSON.stringify([props.services.sourceKey, props.projectId, current.id]) : "";
});
const timeline = computed<VersionView[]>(
  () =>
    page.value?.items.map((item) => ({
      v: item.version,
      at: new Date(item.created_at).toLocaleString("zh-CN"),
      cause: versionCause[item.source],
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
  restoreRequested.value = false;
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

function restoreVersion() {
  const version = detail.value?.version;
  if (!canRestore.value || !version || version === document.value?.version) return;
  restoreRequested.value = true;
  restoreReceiptBefore.value = revisionState.value?.latestReceipt?.command_id;
  restoreCommand.value = undefined;
  void props.revisions?.revert(version);
}

function checkRestore(commandId: string, retry: boolean) {
  const revisions = props.revisions;
  if (!revisions || revisions.state.busy || (retry && !props.eligible)) return;
  restoreRequested.value = true;
  restoreCommand.value = commandId;
  if (retry) void revisions.retryCommand(commandId);
  else void revisions.checkCommand(commandId);
}

function closeComparison() {
  detailRequest?.abort();
  detailRequest = undefined;
  selected.value = undefined;
  detail.value = undefined;
  detailLoading.value = false;
  detailError.value = "";
}

function selectComparison(version: number) {
  if (props.linked) emit("compare", version);
  else void openComparison(version);
}

function dismissComparison() {
  closeComparison();
  if (props.linked) emit("close");
}

function reset() {
  listRequest?.abort();
  listRequest = undefined;
  page.value = undefined;
  listLoading.value = false;
  listError.value = "";
  restoreRequested.value = false;
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
    else if (version === undefined && props.linked) closeComparison();
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
    <VersionTimeline v-if="timeline.length" :versions="timeline" read-only hide-words @compare="selectComparison" />
    <nav v-if="page && page.total > page.limit" class="screen-actions" aria-label="正式稿版本分页">
      <TpButton size="sm" :disabled="listLoading || page.offset === 0" @click="loadPage(Math.max(0, page.offset - page.limit))">上一页</TpButton>
      <span class="tp-caption">第 {{ Math.floor(page.offset / page.limit) + 1 }} 页</span>
      <TpButton size="sm" :disabled="listLoading || page.offset + page.limit >= page.total" @click="loadPage(page.offset + page.limit)">下一页</TpButton>
    </nav>

    <TransitionGroup name="tp-list" tag="div" class="tp-list-group formal-history__recovery" v-bind="listMotionHooks">
      <section v-for="entry in pendingReverts" :key="entry.id" class="studio-notice">
        <p role="status">
          {{ entry.status === "confirmed" ? "历史恢复已确认，待核对结果。" : entry.status === "not-found" ? "尚未查询到恢复结果。" : "历史恢复结果待确认。" }}
        </p>
        <div class="screen-actions mt-2">
          <TpButton size="sm" :disabled="revisionState?.busy" @click="checkRestore(entry.id, false)">检查操作结果</TpButton>
          <TpButton v-if="entry.canRetry" size="sm" variant="ghost" :disabled="revisionState?.busy || !eligible" @click="checkRestore(entry.id, true)"
            >继续同一次操作</TpButton
          >
        </div>
      </section>
    </TransitionGroup>
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <p v-if="restoreError" :key="restoreError" class="studio-notice" role="alert">
        {{ restoreError }}
      </p>
      <p v-else-if="restoreResult" :key="restoreResult" class="studio-notice" role="status">
        已形成正式稿 v{{ restoreResult }}。
        <template v-if="revisionState?.outcome === 'available'">当前编辑仍保留。</template>
      </p>
    </Transition>

    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <section
        v-if="selected !== undefined"
        :key="selected"
        class="screen-panel studio-body studio-stack formal-history__comparison"
        aria-label="正式稿版本对比"
      >
        <div class="studio-row">
          <h3 class="tp-subheading">正式稿 v{{ selected }}</h3>
          <TpButton size="sm" variant="ghost" @click="dismissComparison">收起对比</TpButton>
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
            <div v-if="revisions && comparison.version !== comparison.currentVersion" class="screen-actions">
              <TpButton size="sm" variant="seal" :disabled="!canRestore" :loading="revisionState?.operation === 'revert'" @click="restoreVersion">
                恢复为新版本
              </TpButton>
              <span v-if="!eligible" class="tp-caption">保存当前正式稿后可恢复历史。</span>
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
.formal-history__recovery {
  display: grid;
  gap: 8px;
}
.formal-history__recovery:empty {
  display: none;
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
