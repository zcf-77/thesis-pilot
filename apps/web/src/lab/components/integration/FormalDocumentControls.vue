<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpState from "@/components/ui/TpState.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import { listMotionHooks } from "@/design/motion";
import type { EditorSnapshot } from "../../state/editorAdapter";
import type { createRemoteDocumentController } from "../../state/remoteDocuments";
import { downloadPreviewFile } from "../../state/previewBackup";
import { panelMotionHooks } from "./motion";

const props = defineProps<{ controller: ReturnType<typeof createRemoteDocumentController>; localSnapshot?: () => EditorSnapshot; editorBlocked?: boolean }>();
defineEmits<{ save: [] }>();
const state = computed(() => props.controller.state);
const busy = computed(() => !!state.value.operation);
const draftListId = useId();
const draftsOpen = ref(false);
const importError = ref("");
const downloadError = ref("");
const formatDate = (value: string) => new Date(value).toLocaleString("zh-CN");
const issueText = computed(() => {
  if (state.value.issue === "conflict") {
    if (state.value.latest) return "服务端已有 v" + state.value.latest.version + "。请保留当前草稿后载入新版。";
    return state.value.error || "正式稿已有更新，请检查最新版本。";
  }
  return state.value.error || "请求结果尚未确认，请检查最新版本。";
});
watch(
  () => props.controller,
  () => {
    draftsOpen.value = false;
    importError.value = downloadError.value = "";
  },
);
watch(
  () => state.value.drafts.length,
  (count) => {
    if (!count) draftsOpen.value = false;
  },
);

async function importLocal() {
  if (!props.localSnapshot) return;
  importError.value = "";
  try {
    await props.controller.importLocal(props.localSnapshot());
  } catch (cause) {
    importError.value = cause instanceof Error ? cause.message : "本机正文无法读取，请返回本机原稿查看。";
  }
}

function downloadDraft() {
  const draft = props.controller.downloadDraft();
  if (!draft) return;
  const result = downloadPreviewFile(draft.filename, draft.content, draft.mime);
  downloadError.value = result.ok ? "" : result.error;
}
</script>

<template>
  <section class="formal-doc-controls studio-stack" aria-label="正式稿操作">
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <div v-if="state.phase === 'ready' && state.document" key="ready" class="screen-actions">
        <TpButton
          size="sm"
          :variant="state.issue ? 'outline' : 'primary'"
          :loading="state.operation === 'save'"
          :disabled="busy || !state.dirty || !!state.issue || editorBlocked"
          @click="$emit('save')"
          >保存</TpButton
        >
        <TpButton
          size="sm"
          :variant="state.issue && !state.latest ? 'primary' : 'ghost'"
          :loading="state.operation === 'check'"
          :disabled="busy || editorBlocked"
          @click="controller.checkLatest()"
          >检查最新版本</TpButton
        >
        <TpButton
          v-if="state.drafts.length"
          size="sm"
          variant="ghost"
          :aria-expanded="draftsOpen"
          :aria-controls="draftListId"
          @click="draftsOpen = !draftsOpen"
          >草稿（{{ state.drafts.length }}）</TpButton
        >
      </div>
      <p v-else-if="state.phase === 'idle' || state.phase === 'loading'" key="loading" class="tp-caption" role="status">正在读取正式稿…</p>
      <div v-else-if="state.issue" key="check-import" class="screen-actions">
        <TpButton size="sm" variant="primary" :loading="state.operation === 'check'" :disabled="busy" @click="controller.checkLatest()">
          检查最新版本
        </TpButton>
      </div>
      <TpState
        v-else-if="state.phase === 'error'"
        key="read-error"
        kind="error"
        title="暂时无法读取正式稿"
        :desc="state.error"
        :retryable="!busy"
        @retry="controller.load()"
      />
      <TpState
        v-else-if="state.phase === 'empty' && localSnapshot"
        key="import"
        kind="empty"
        title="还没有正式稿"
        desc="导入会建立正式稿 v1，本机原稿和历史会保留。"
      >
        <TpButton size="sm" variant="primary" :loading="state.operation === 'import'" :disabled="busy" @click="importLocal">导入本机正文</TpButton>
      </TpState>
      <TpState v-else-if="state.phase === 'empty'" key="create" kind="empty" title="还没有正式稿">
        <TpButton size="sm" variant="primary" :loading="state.operation === 'create-blank'" :disabled="busy" @click="controller.createBlank()">
          创建空白正式稿
        </TpButton>
      </TpState>
    </Transition>

    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <div v-if="state.issue" :key="state.issue" class="studio-notice">
        <p role="alert">{{ issueText }}</p>
        <TpButton
          v-if="state.issue === 'conflict' && state.latest"
          size="sm"
          variant="primary"
          class="mt-3"
          :loading="state.operation === 'load-latest'"
          :disabled="busy || editorBlocked"
          @click="controller.loadLatestPreservingDraft()"
          >保留草稿并载入新版</TpButton
        >
      </div>
      <p v-else-if="importError || (state.phase !== 'error' && state.error)" :key="importError || state.error" class="studio-notice" role="alert">
        {{ importError || state.error }}
      </p>
    </Transition>

    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <div v-if="state.draftError" class="studio-notice">
        <p role="alert">{{ !localSnapshot && state.draftStatus === "error" ? "暂时无法保存草稿。当前编辑仍保留，可重试草稿保存。" : state.draftError }}</p>
        <TpButton v-if="localSnapshot && state.dirty" size="sm" variant="tonal" class="mt-3" @click="downloadDraft">下载草稿</TpButton>
        <TpButton v-else-if="state.dirty && state.draftStatus === 'error'" size="sm" variant="tonal" class="mt-3" @click="controller.retryDraft()">
          重试草稿保存
        </TpButton>
        <p v-if="downloadError" role="alert" class="tp-caption mt-2">{{ downloadError }}</p>
      </div>
    </Transition>

    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <section v-if="draftsOpen && state.drafts.length" :id="draftListId" class="screen-panel studio-body" aria-label="保留的正式稿草稿">
        <TransitionGroup name="tp-list" tag="ul" class="tp-list-group formal-doc-controls__drafts" v-bind="listMotionHooks">
          <li v-for="draft in state.drafts" :key="draft.id" class="studio-row formal-doc-controls__draft">
            <div>
              <TpVersion :v="draft.baseVersion" prefix="基于正式稿 " :stale="draft.baseVersion !== state.document?.version" />
              <p class="tp-caption mt-1">{{ formatDate(draft.updatedAt) }}</p>
            </div>
            <TpButton size="sm" variant="outline" :disabled="busy || editorBlocked" @click="controller.recoverDraft(draft.id)">载入草稿</TpButton>
          </li>
        </TransitionGroup>
      </section>
    </Transition>
  </section>
</template>

<style scoped>
.formal-doc-controls {
  gap: 12px;
}
.formal-doc-controls__drafts {
  list-style: none;
  margin: 0;
  padding: 0;
}
.formal-doc-controls__draft {
  flex-wrap: wrap;
}
.formal-doc-controls__draft + .formal-doc-controls__draft {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--tp-line);
}
</style>
