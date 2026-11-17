<script setup lang="ts">
import { PhArrowSquareOut, PhX } from "@phosphor-icons/vue";
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import VersionTimeline from "@/components/domain/VersionTimeline.vue";
import type { VersionView } from "@/domain/types";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { ApiError, asApiError, type BackendServices, type DocumentVersionPage, type DocumentVersionRead } from "@/services";
import type { DocsSnapshot } from "../editor/docsSnapshot.ts";
import type { VersionDiff } from "./versionDiff.ts";

/**
 * 版本历史：版本列表、只读查看与段落对比、恢复为新版本（学生决定，生成新版本，不删除历史）。
 * 查看的版本在写作台中以只读纸面呈现；v1 版本经服务端 `?as=v2` 转换后只读预览。
 */
export interface HistoryPreview {
  version: number;
  source: DocumentVersionRead["source"];
  createdAt: string;
  converted: boolean;
  snapshot: DocsSnapshot;
}

const props = defineProps<{
  services: BackendServices;
  projectId: string;
  documentId: string;
  /** 当前已保存版本。 */
  currentVersion: number;
  /** 服务端已知的更新版本（冲突时），列表随之刷新。 */
  latestVersion?: number;
  /** 正在查看的版本（来自深链）。 */
  selected?: number;
  preview: HistoryPreview | null;
  previewError: string;
  previewLoading: boolean;
  diff: VersionDiff | null;
  /** 无未保存修改、无冲突时才允许恢复。 */
  eligible: boolean;
}>();
const emit = defineEmits<{
  compare: [version: number];
  closeCompare: [];
  retryPreview: [];
  locate: [row: { before?: string; after?: string }];
  restored: [version: number];
}>();

const pageSize = 12;
const page = shallowRef<DocumentVersionPage>();
const listLoading = ref(false);
const listError = ref("");
const restoring = ref(false);
const restoreError = ref("");
const restoreResult = ref<number>();
let pendingRestore: { id: string; target: number; base: number } | undefined;
let listRequest: AbortController | undefined;
let restoreRequest: AbortController | undefined;

const causeOf = {
  blank: "blank",
  local_import: "import",
  manual_edit: "manual",
  ai_adoption: "adopt",
  adoption_undo: "undo",
  version_revert: "restore",
  schema_upgrade: "upgrade",
} satisfies Record<DocumentVersionRead["source"], VersionView["cause"]>;
const sourceLabel: Record<DocumentVersionRead["source"], string> = {
  blank: "创建空白稿",
  local_import: "导入",
  manual_edit: "手动保存",
  ai_adoption: "采纳候选",
  adoption_undo: "撤销采纳",
  version_revert: "恢复",
  schema_upgrade: "升级正文结构",
};
const timeline = computed<VersionView[]>(
  () =>
    page.value?.items.map((item) => ({
      v: item.version,
      at: new Date(item.created_at).toLocaleString("zh-CN", { hour12: false }),
      cause: causeOf[item.source],
      summary: "",
      words: 0,
      current: item.version === props.currentVersion,
    })) ?? [],
);
const canRestore = computed(() => props.eligible && !restoring.value && !!props.preview && props.preview.version !== props.currentVersion);

async function loadPage(offset = 0) {
  listRequest?.abort();
  const request = (listRequest = new AbortController());
  listLoading.value = true;
  listError.value = "";
  try {
    const result = await props.services.documents.versions(props.projectId, props.documentId, { limit: pageSize, offset }, request.signal);
    if (request === listRequest) page.value = result;
  } catch (cause) {
    if (request !== listRequest) return;
    const error = asApiError(cause);
    if (error.code !== "REQUEST_CANCELLED") listError.value = error.message;
  } finally {
    if (request === listRequest) {
      listLoading.value = false;
      listRequest = undefined;
    }
  }
}

function uncertain(error: ApiError) {
  return ["NETWORK_ERROR", "REQUEST_TIMEOUT", "INVALID_RESPONSE", "INTERNAL_ERROR"].includes(error.code) || (error.status ?? 0) >= 500;
}

/** 恢复为新版本：同一次恢复使用同一个命令 ID，结果未知时可安全重试。 */
async function restore() {
  const preview = props.preview;
  if (!preview || !canRestore.value) return;
  if (pendingRestore?.target !== preview.version || pendingRestore.base !== props.currentVersion)
    pendingRestore = { id: crypto.randomUUID(), target: preview.version, base: props.currentVersion };
  const command = pendingRestore;
  restoreRequest?.abort();
  const request = (restoreRequest = new AbortController());
  restoring.value = true;
  restoreError.value = "";
  restoreResult.value = undefined;
  try {
    const result = await props.services.revisions.revert(
      props.projectId,
      props.documentId,
      { command_id: command.id, expected_document_version: command.base, target_version: command.target },
      request.signal,
    );
    if (request !== restoreRequest) return;
    if (result.operation !== "revert" || !result.result_version || result.result_version <= command.base) throw new ApiError("INVALID_RESPONSE");
    pendingRestore = undefined;
    restoreResult.value = result.result_version;
    emit("restored", result.result_version);
  } catch (cause) {
    if (request !== restoreRequest) return;
    const error = asApiError(cause);
    if (error.code === "REQUEST_CANCELLED") return;
    if (!uncertain(error)) pendingRestore = undefined;
    restoreError.value = uncertain(error) ? `${error.message} 恢复结果尚未确认，可以继续同一次恢复，不会重复生成版本。` : error.message;
  } finally {
    if (request === restoreRequest) {
      restoring.value = false;
      restoreRequest = undefined;
    }
  }
}

watch(
  () => [props.documentId, props.projectId] as const,
  () => {
    page.value = undefined;
    void loadPage();
  },
  { immediate: true },
);
watch(
  () => Math.max(props.currentVersion, props.latestVersion ?? 0),
  (version, previous) => {
    if (version !== previous) void loadPage(page.value?.offset ?? 0);
  },
);
watch(
  () => props.preview?.version,
  () => {
    restoreError.value = "";
    if (props.preview) restoreResult.value = undefined;
  },
);
onScopeDispose(() => {
  listRequest?.abort();
  restoreRequest?.abort();
});
</script>

<template>
  <section class="writing-history" aria-label="正式稿版本">
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <section v-if="selected !== undefined" :key="selected" class="writing-history__compare" aria-label="正式稿版本对比">
        <header class="writing-history__compare-head">
          <div>
            <h3 class="tp-subheading">查看 v{{ selected }}</h3>
            <p v-if="preview" class="tp-caption">
              {{ sourceLabel[preview.source] }} · {{ new Date(preview.createdAt).toLocaleString("zh-CN", { hour12: false }) }}
            </p>
          </div>
          <TpButton size="sm" variant="ghost" icon-only label="收起对比" @click="emit('closeCompare')"><TpIcon :icon="PhX" :size="16" /></TpButton>
        </header>
        <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
          <TpState v-if="previewError" key="error" kind="error" title="无法读取所选版本" :desc="previewError" retryable @retry="emit('retryPreview')" />
          <p v-else-if="previewLoading || !preview" key="loading" class="tp-caption" role="status">正在读取所选版本…</p>
          <div v-else key="ready" class="writing-history__detail">
            <p v-if="preview.converted" class="writing-history__note">旧版结构的只读转换预览；升级后的正文以新版本为准。</p>
            <div v-if="diff" class="writing-history__summary" role="status">
              <template v-if="preview.version === currentVersion">这是当前已保存的版本。</template>
              <template v-else-if="!diff.rows.length">与当前已保存的 v{{ currentVersion }} 文字相同。</template>
              <template v-else>
                相对当前 v{{ currentVersion }}：
                <TpStatus v-if="diff.changed" tone="warning" size="sm" :label="`${diff.changed} 段修改`" />
                <TpStatus v-if="diff.added" tone="success" size="sm" :label="`${diff.added} 段为后来新增`" />
                <TpStatus v-if="diff.removed" tone="danger" size="sm" :label="`${diff.removed} 段后来删去`" />
              </template>
            </div>
            <TransitionGroup v-if="diff?.rows.length" tag="ol" name="tp-list" v-bind="listMotionHooks" class="writing-history__rows tp-list-group">
              <li v-for="row in diff.rows.slice(0, 60)" :key="row.key">
                <button type="button" class="writing-history__row" :class="'is-' + row.kind" @click="emit('locate', row)">
                  <span class="writing-history__text" :class="{ 'is-heading': row.heading }"
                    ><template v-for="(part, index) in row.parts" :key="index"
                      ><del v-if="part.kind === 'del'">{{ part.text }}</del><ins v-else-if="part.kind === 'ins'">{{ part.text }}</ins
                      ><span v-else>{{ part.text.length > 40 ? "…" + part.text.slice(-40) : part.text }}</span></template
                    ></span
                  >
                  <TpIcon :icon="PhArrowSquareOut" :size="13" class="writing-history__go" />
                </button>
              </li>
            </TransitionGroup>
            <p v-if="diff && diff.rows.length > 60" class="tp-caption">另有 {{ diff.rows.length - 60 }} 处差异未列出，可在纸面上查看标记。</p>
            <div v-if="preview.version !== currentVersion" class="writing-history__actions">
              <TpButton size="sm" variant="seal" :disabled="!canRestore" :loading="restoring" @click="restore">恢复为新版本</TpButton>
              <span v-if="!eligible" class="tp-caption">保存或处理当前编辑后可以恢复。</span>
              <span v-else class="tp-caption">生成 v{{ currentVersion + 1 }}，原有历史全部保留。</span>
            </div>
            <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
              <p v-if="restoreError" :key="restoreError" class="writing-history__alert" role="alert">{{ restoreError }}</p>
              <p v-else-if="restoreResult" :key="restoreResult" class="writing-history__note" role="status">已恢复为正式稿 v{{ restoreResult }}。</p>
            </Transition>
          </div>
        </Transition>
      </section>
    </Transition>

    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <TpState v-if="listError" key="error" kind="error" title="无法读取正式稿版本" :desc="listError" retryable @retry="loadPage(page?.offset ?? 0)" />
      <p v-else-if="listLoading && !page" key="loading" class="tp-caption" role="status">正在读取正式稿版本…</p>
      <p v-else-if="page && !timeline.length" key="empty" class="tp-caption">暂无正式稿版本。</p>
    </Transition>
    <VersionTimeline v-if="timeline.length" :versions="timeline" read-only hide-words @compare="emit('compare', $event)" />
    <nav v-if="page && page.total > page.limit" class="writing-history__pager" aria-label="正式稿版本分页">
      <TpButton size="sm" variant="ghost" :disabled="listLoading || page.offset === 0" @click="loadPage(Math.max(0, page.offset - page.limit))">较新</TpButton>
      <span class="tp-caption">{{ page.offset + 1 }}–{{ Math.min(page.total, page.offset + page.limit) }} / {{ page.total }}</span>
      <TpButton size="sm" variant="ghost" :disabled="listLoading || page.offset + page.limit >= page.total" @click="loadPage(page.offset + page.limit)"
        >较早</TpButton
      >
    </nav>
  </section>
</template>

<style scoped>
.writing-history {
  display: grid;
  align-content: start;
  gap: 16px;
}
.writing-history__compare {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--tp-line-strong);
  border-radius: var(--tp-radius-m);
  background: var(--tp-surface);
}
.writing-history__compare-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.writing-history__detail {
  display: grid;
  gap: 10px;
}
.writing-history__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--tp-text-muted);
}
.writing-history__rows {
  display: grid;
  gap: 4px;
  max-height: 320px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.writing-history__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--tp-radius-s);
  border-left: 2px solid var(--tp-line-strong);
  text-align: left;
  font-size: 12.5px;
  line-height: 1.7;
  transition: background-color var(--tp-dur-instant) linear;
}
.writing-history__row:hover {
  background: var(--tp-surface-sunken);
}
.writing-history__row.is-changed {
  border-left-color: var(--tp-warning);
}
.writing-history__row.is-added {
  border-left-color: var(--tp-success);
}
.writing-history__row.is-removed {
  border-left-color: var(--tp-danger);
}
.writing-history__text {
  min-width: 0;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.writing-history__text.is-heading {
  font-weight: 650;
}
.writing-history__text del {
  background: var(--tp-del-bg);
  color: var(--tp-del-text);
  text-decoration: line-through;
}
.writing-history__text ins {
  background: var(--tp-ins-bg);
  color: var(--tp-ins-text);
  text-decoration: none;
}
.writing-history__go {
  margin-top: 4px;
  color: var(--tp-text-faint);
}
.writing-history__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding-top: 4px;
}
.writing-history__note {
  font-size: 12px;
  line-height: 1.7;
  color: var(--tp-text-muted);
}
.writing-history__alert {
  padding: 8px 10px;
  border-radius: var(--tp-radius-s);
  background: var(--tp-danger-soft);
  color: var(--tp-danger-content);
  font-size: 12.5px;
  line-height: 1.7;
}
.writing-history__pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
