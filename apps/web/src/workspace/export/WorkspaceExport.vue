<script setup lang="ts">
import { computed, onActivated, ref, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { BackendServices, ProjectRead } from "@/services";
import { writingRoute } from "../workspaceRoutes";
import BackupSection from "./BackupSection.vue";
import ExportItem from "./ExportItem.vue";
import { changeFormats, documentFormats, formatTime, useExports, versionSource, type ChangeFormat, type DocumentFormat } from "./useExports";

const props = defineProps<{ services: BackendServices; project: ProjectRead }>();
const state = useExports(props.services, props.project.id);
const { document, versions, phase, loadError, records, total, listError, pending, actionError, latestDocument, latestChange } = state;

const documentVersion = ref("");
const documentFormat = ref<DocumentFormat>("html");
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
const rangeError = computed(() => (toVersion.value !== "current" && Number(fromVersion.value) > Number(toVersion.value) ? "起始版本不能晚于结束版本。" : ""));
const retriedIds = computed(() => new Set(records.value.flatMap((item) => (item.source_job_id ? [item.source_job_id] : []))));
const errorFor = (scope: string) => (actionError.value?.scope === scope ? actionError.value.message : "");
const historyError = computed(() => (actionError.value && !["document", "change"].includes(actionError.value.scope) ? actionError.value.message : ""));

function submitDocument() {
  if (documentVersion.value) void state.exportDocument(Number(documentVersion.value), documentFormat.value);
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
  <section class="screen-page workspace-page workspace-export">
    <header class="screen-heading">
      <div>
        <p class="tp-label">Deliver · 把每一份努力，妥善留下</p>
        <h1 class="tp-display mt-3">导出与备份</h1>
        <p class="screen-lead">导出指定版本的正文与修改说明，或备份整个项目以便恢复继续。</p>
      </div>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <TpStatus v-if="document" :key="document.version" tone="info" :label="'正文 v' + document.version" />
      </Transition>
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
        <div class="studio-grid">
          <section class="screen-panel studio-body studio-stack" aria-labelledby="export-document-title">
            <div>
              <p class="tp-label">01 / Document</p>
              <h2 id="export-document-title" class="tp-title mt-2">论文正文</h2>
            </div>
            <form class="studio-stack" @submit.prevent="submitDocument">
              <TpField v-slot="{ id }" label="正文版本">
                <TpSelect :id="id" v-model="documentVersion" :options="versionOptions" searchable />
              </TpField>
              <div class="tp-field">
                <span class="tp-field__label">文件格式</span>
                <TpSegmented v-model="documentFormat" label="正文文件格式" :options="documentFormats" />
              </div>
              <Transition name="tp-swap" v-bind="panelMotionHooks">
                <p v-if="errorFor('document')" class="studio-notice" role="alert">{{ errorFor("document") }}</p>
              </Transition>
              <div class="screen-actions">
                <TpButton type="submit" variant="primary" :loading="pending === 'document'" :disabled="!!pending || !documentVersion">导出正文</TpButton>
              </div>
            </form>
            <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
              <ExportItem
                v-if="latestDocument"
                :key="latestDocument.job_id"
                class="workspace-export__latest"
                :item="latestDocument"
                :retried="retriedIds.has(latestDocument.job_id)"
                :pending="pending"
                @download="state.download"
                @retry="state.retry"
                @cancel="state.cancel"
              />
            </Transition>
          </section>

          <section class="screen-panel studio-body studio-stack" aria-labelledby="export-change-title">
            <div>
              <p class="tp-label">02 / Changes</p>
              <h2 id="export-change-title" class="tp-title mt-2">修改说明</h2>
            </div>
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
              <Transition name="tp-swap" v-bind="panelMotionHooks">
                <p v-if="errorFor('change')" class="studio-notice" role="alert">{{ errorFor("change") }}</p>
              </Transition>
              <div class="screen-actions">
                <TpButton type="submit" variant="primary" :loading="pending === 'change'" :disabled="!!pending || !fromVersion || !!rangeError"
                  >生成修改说明</TpButton
                >
              </div>
            </form>
            <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
              <ExportItem
                v-if="latestChange"
                :key="latestChange.job_id"
                class="workspace-export__latest"
                :item="latestChange"
                :retried="retriedIds.has(latestChange.job_id)"
                :pending="pending"
                @download="state.download"
                @retry="state.retry"
                @cancel="state.cancel"
              />
            </Transition>
          </section>
        </div>

        <section class="screen-panel studio-body studio-stack" aria-labelledby="export-history-title">
          <div class="studio-row">
            <h2 id="export-history-title" class="tp-title">导出记录</h2>
            <TpButton size="sm" variant="ghost" :disabled="!!pending" @click="state.refresh()">刷新记录</TpButton>
          </div>
          <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
            <p v-if="historyError" :key="historyError" class="studio-notice" role="alert">{{ historyError }}</p>
          </Transition>
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
                @download="state.download"
                @retry="state.retry"
                @cancel="state.cancel"
              />
            </li>
          </TransitionGroup>
          <TpState
            v-if="!listError && !records.length"
            kind="empty"
            title="还没有导出记录"
            desc="导出正文或生成修改说明后，文件会保留在这里，可随时重新下载。"
          />
          <p v-if="total > records.length" class="tp-caption">显示最近 {{ records.length }} 项，共 {{ total }} 项。</p>
        </section>
      </div>
    </Transition>

    <BackupSection :services="services" :project="project" />
  </section>
</template>

<style scoped>
.workspace-export__body {
  gap: 24px;
}
.workspace-export > .workspace-backup {
  margin-top: 24px;
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
