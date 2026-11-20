<script setup lang="ts">
import { computed, onActivated, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { BackendServices, ProjectRead } from "@/services";
import { reviewRoute, writingRoute } from "../workspaceRoutes";
import BackupSection from "./BackupSection.vue";
import ExportItem from "./ExportItem.vue";
import {
  changeFormats,
  documentFormats,
  formatTime,
  isOfficeFormat,
  officeModes,
  useExports,
  versionSource,
  type ChangeFormat,
  type DocumentFormat,
  type OfficeMode,
} from "./useExports";

const props = defineProps<{ services: BackendServices; project: ProjectRead }>();
const state = useExports(props.services, props.project.id);
const { document, versions, phase, loadError, records, total, listError, pending, actionError, latestDocument, latestChange, officeSource } = state;

const documentVersion = ref("");
const documentFormat = ref<DocumentFormat>("docx");
const officeMode = ref<OfficeMode>("preserve");
const trackChanges = ref(false);
const fromVersion = ref("");
const toVersion = ref("current");
const changeFormat = ref<ChangeFormat>("markdown");

const versionOptions = computed(() =>
  versions.value.map((item) => ({
    value: String(item.version),
    label: `v${item.version}${item.version === document.value?.version ? " · 当前" : ""}`,
    description: `${versionSource[item.source]} · ${formatTime(item.created_at)}`,
  })),
);
const toOptions = computed(() => [{ value: "current", label: "当前版本", description: "创建时固定为最新版本" }, ...versionOptions.value]);
watch(
  [document, versions],
  ([current, items]) => {
    if (!current || !items.length) return;
    if (!items.some((item) => String(item.version) === documentVersion.value)) documentVersion.value = String(current.version);
    if (!items.some((item) => String(item.version) === fromVersion.value)) fromVersion.value = String(items[items.length - 1]!.version);
  },
  { immediate: true },
);
watch([document, documentVersion], ([current, version]) => {
  if (current && version) void state.loadOfficeSource(Number(version));
});
const canPreserve = computed(() => officeSource.value.status === "ready");
// Without a kept original the only Word/PDF route is rebuilding from the manuscript.
const effectiveMode = computed<OfficeMode>(() => (canPreserve.value ? officeMode.value : "regenerate"));
const modeHint = computed(() => officeModes.find((item) => item.value === effectiveMode.value)!.hint);
const sourceLabel = computed(() =>
  officeSource.value.status === "ready" ? `${officeSource.value.source.filename} · v${officeSource.value.source.document_version} 导入` : "",
);
const rangeError = computed(() => (toVersion.value !== "current" && Number(fromVersion.value) > Number(toVersion.value) ? "起始版本不能晚于结束版本。" : ""));
const retriedIds = computed(() => new Set(records.value.flatMap((item) => (item.source_job_id ? [item.source_job_id] : []))));
const featuredIds = computed(() => new Set([latestDocument.value?.job_id, latestChange.value?.job_id].filter(Boolean)));
const errorFor = (scope: string) => (actionError.value?.scope === scope ? actionError.value.message : "");
function itemError(jobId: string, history = false) {
  const issue = actionError.value;
  if (!issue || (history && featuredIds.value.has(jobId))) return "";
  return ["download", "retry", "cancel", "regenerate"].some((action) => issue.scope === `${action}:${jobId}`) ? issue.message : "";
}

function submitDocument() {
  if (!documentVersion.value || (isOfficeFormat(documentFormat.value) && officeSource.value.status === "loading")) return;
  void state.exportDocument(Number(documentVersion.value), documentFormat.value, { office_mode: effectiveMode.value, track_changes: trackChanges.value });
}
function submitChanges() {
  if (!fromVersion.value || rangeError.value) return;
  void state.exportChanges(Number(fromVersion.value), toVersion.value === "current" ? null : Number(toVersion.value), changeFormat.value);
}
void state.load();
let activatedOnce = false;
onActivated(() => {
  // Versions saved on the writing page appear when returning to this cached page.
  if (activatedOnce) void state.load(true);
  activatedOnce = true;
});
</script>

<template>
  <Transition appear name="tp-page">
    <section class="screen-page workspace-page workspace-export">
      <header class="screen-heading">
        <div>
          <h1 class="tp-display">导出与备份</h1>
          <p class="screen-lead">保存指定版本的正文与修改说明，或备份整个项目。</p>
        </div>
        <div class="screen-actions">
          <RouterLink class="tp-btn tp-btn--outline" :to="reviewRoute(project.id)">评审报告</RouterLink>
          <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
            <TpStatus v-if="document" :key="document.version" tone="info" :label="'正文 v' + document.version" />
          </Transition>
        </div>
      </header>

      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <div v-if="phase === 'loading'" key="loading" class="screen-panel studio-body workspace-loading" role="status" aria-busy="true">
          <span class="tp-btn__spinner" aria-hidden="true" />正在读取正文版本…
        </div>
        <TpState v-else-if="phase === 'missing'" key="missing" class="screen-panel" kind="empty" title="此项目还没有正式稿" desc="保存第一版正文后即可导出。">
          <RouterLink class="tp-btn tp-btn--outline tp-btn--sm" :to="writingRoute(project.id)">打开写作台</RouterLink>
        </TpState>
        <TpState
          v-else-if="phase === 'failed'"
          key="failed"
          class="screen-panel"
          kind="error"
          title="无法读取正文版本"
          :desc="loadError + ' 正文与已导出的文件不受影响。'"
          retryable
          @retry="state.load()"
        />
        <div v-else key="ready" class="studio-stack workspace-export__body">
          <div class="studio-grid workspace-export__choices">
            <section class="screen-panel studio-body studio-stack" aria-labelledby="export-document-title">
              <div><h2 id="export-document-title" class="tp-heading">论文正文</h2></div>
              <form class="studio-stack" @submit.prevent="submitDocument">
                <TpField v-slot="{ id }" label="正文版本" hint="导出后仍固定为所选版本。">
                  <TpSelect :id="id" v-model="documentVersion" :options="versionOptions" searchable />
                </TpField>
                <div class="tp-field">
                  <span class="tp-field__label">文件格式</span>
                  <TpSegmented v-model="documentFormat" class="workspace-export__formats" label="正文文件格式" :options="documentFormats" />
                </div>
                <Transition name="tp-swap" v-bind="panelMotionHooks">
                  <div v-if="isOfficeFormat(documentFormat)" class="workspace-export__office" data-testid="export-office-options">
                    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                      <p v-if="officeSource.status === 'loading'" key="loading" class="tp-caption workspace-export__source-loading" role="status">
                        <span class="tp-btn__spinner" aria-hidden="true" />正在查找该版本的 Word 原件…
                      </p>
                      <div v-else-if="canPreserve" key="ready" class="tp-field">
                        <span class="tp-field__label">处理方式</span>
                        <TpSegmented v-model="officeMode" label="Word 与 PDF 处理方式" :options="officeModes" />
                        <span class="tp-caption workspace-export__source">原件：{{ sourceLabel }}</span>
                      </div>
                      <p v-else-if="officeSource.status === 'failed'" key="failed" class="workspace-export__office-error" role="alert">
                        {{ officeSource.message }} 将按正文重建并附损失报告。
                      </p>
                      <p v-else key="none" class="tp-caption">该版本没有导入的 Word 原件，将按正文重建并附损失报告。</p>
                    </Transition>
                    <p v-if="canPreserve" class="workspace-export__hint">{{ modeHint }}</p>
                    <Transition name="tp-swap" v-bind="panelMotionHooks">
                      <label v-if="documentFormat === 'docx' && effectiveMode === 'preserve'" class="workspace-export__check">
                        <input v-model="trackChanges" class="tp-checkbox" type="checkbox" :disabled="!!pending" />带修订标记
                      </label>
                    </Transition>
                  </div>
                </Transition>
                <Transition name="tp-swap" v-bind="panelMotionHooks">
                  <div v-if="errorFor('document')" class="workspace-export__form-error" role="alert">
                    <p>{{ errorFor("document") }}</p>
                    <p class="tp-caption">正文与历史版本未改变，可核对选择后重试。</p>
                  </div>
                </Transition>
                <div class="screen-actions">
                  <TpButton
                    type="submit"
                    variant="primary"
                    :loading="pending === 'document'"
                    :disabled="!!pending || !documentVersion || (isOfficeFormat(documentFormat) && officeSource.status === 'loading')"
                    >导出正文</TpButton
                  >
                </div>
              </form>
              <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                <div v-if="latestDocument" :key="latestDocument.job_id" class="workspace-export__latest" aria-live="polite">
                  <ExportItem
                    :item="latestDocument"
                    :retried="retriedIds.has(latestDocument.job_id)"
                    :pending="pending"
                    :error="itemError(latestDocument.job_id)"
                    @download="state.download"
                    @retry="state.retry"
                    @cancel="state.cancel"
                    @regenerate="state.regenerate"
                  />
                </div>
              </Transition>
            </section>

            <section class="screen-panel studio-body studio-stack" aria-labelledby="export-change-title">
              <div><h2 id="export-change-title" class="tp-heading">修改说明</h2></div>
              <form class="studio-stack" @submit.prevent="submitChanges">
                <div class="studio-form-grid">
                  <TpField v-slot="{ id }" label="起始版本">
                    <TpSelect :id="id" v-model="fromVersion" :options="versionOptions" searchable />
                  </TpField>
                  <TpField v-slot="{ id }" label="结束版本" :error="rangeError">
                    <TpSelect :id="id" v-model="toVersion" :options="toOptions" searchable />
                  </TpField>
                </div>
                <div class="tp-field">
                  <span class="tp-field__label">文件格式</span>
                  <TpSegmented v-model="changeFormat" label="修改说明文件格式" :options="changeFormats" />
                </div>
                <p class="tp-caption">内容来自所选版本之间的真实保存与修订决定。</p>
                <Transition name="tp-swap" v-bind="panelMotionHooks">
                  <div v-if="errorFor('change')" class="workspace-export__form-error" role="alert">
                    <p>{{ errorFor("change") }}</p>
                    <p class="tp-caption">正文与既有记录未改变，可重试。</p>
                  </div>
                </Transition>
                <div class="screen-actions">
                  <TpButton type="submit" variant="primary" :loading="pending === 'change'" :disabled="!!pending || !fromVersion || !!rangeError"
                    >生成修改说明</TpButton
                  >
                </div>
              </form>
              <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
                <div v-if="latestChange" :key="latestChange.job_id" class="workspace-export__latest" aria-live="polite">
                  <ExportItem
                    :item="latestChange"
                    :retried="retriedIds.has(latestChange.job_id)"
                    :pending="pending"
                    :error="itemError(latestChange.job_id)"
                    @download="state.download"
                    @retry="state.retry"
                    @cancel="state.cancel"
                    @regenerate="state.regenerate"
                  />
                </div>
              </Transition>
            </section>
          </div>

          <section class="screen-panel studio-body studio-stack" aria-labelledby="export-history-title">
            <div class="studio-row">
              <h2 id="export-history-title" class="tp-heading">导出记录</h2>
              <TpButton size="sm" variant="ghost" :disabled="!!pending" @click="state.refresh()">刷新记录</TpButton>
            </div>
            <Transition name="tp-swap" v-bind="panelMotionHooks">
              <TpState
                v-if="listError"
                kind="error"
                title="导出记录暂时无法读取"
                :desc="listError + ' 已生成的文件仍保留在服务端。'"
                retryable
                @retry="state.refresh()"
              />
            </Transition>
            <TransitionGroup name="tp-list" tag="ol" class="tp-list-group workspace-export__list" aria-label="导出记录" v-bind="listMotionHooks">
              <li v-for="item in records" :key="item.job_id" class="studio-history-row">
                <ExportItem
                  :item="item"
                  :retried="retriedIds.has(item.job_id)"
                  :pending="pending"
                  :error="itemError(item.job_id, true)"
                  @download="state.download"
                  @retry="state.retry"
                  @cancel="state.cancel"
                  @regenerate="state.regenerate"
                />
              </li>
            </TransitionGroup>
            <TpState v-if="!listError && !records.length" kind="empty" title="还没有导出记录" desc="完成的任务可在这里下载。" />
            <p v-if="total > records.length" class="tp-caption">显示最近 {{ records.length }} 项，共 {{ total }} 项。</p>
          </section>
        </div>
      </Transition>

      <BackupSection :services="services" :project="project" />
    </section>
  </Transition>
</template>

<style scoped>
.workspace-export__body {
  gap: 24px;
}
.workspace-export > .workspace-backup {
  margin-top: 0;
}
.workspace-export__choices {
  align-items: start;
}
.workspace-export__formats {
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: thin;
}
.workspace-export__formats :deep(.tp-seg__item) {
  flex: none;
}
.workspace-export__office {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
}
.workspace-export__source-loading {
  display: flex;
  align-items: center;
  gap: 8px;
}
.workspace-export__source-loading .tp-btn__spinner {
  position: static;
}
.workspace-export__source {
  overflow-wrap: anywhere;
}
.workspace-export__hint {
  font-size: 13px;
  line-height: 1.7;
  color: var(--tp-text-muted);
}
.workspace-export__office-error,
.workspace-export__form-error {
  padding: 12px 16px;
  border-left: 3px solid var(--tp-danger);
  border-radius: var(--tp-radius-s);
  background: var(--tp-danger-soft);
  color: var(--tp-danger-content);
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.workspace-export__form-error .tp-caption {
  margin-top: 4px;
  color: inherit;
}
.workspace-export__check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  font-size: 14px;
  cursor: pointer;
}
.workspace-export__latest {
  padding-top: 20px;
  border-top: 1px solid var(--tp-line);
}
.workspace-export__list {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin: 0;
  padding: 0;
  list-style: none;
}
@media (max-width: 640px) {
  .workspace-export .studio-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
