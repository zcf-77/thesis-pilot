<script setup lang="ts">
import { PhFileZip } from "@phosphor-icons/vue";
import { computed, onActivated, ref } from "vue";
import { useRouter } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import { jobStatus } from "@/domain/vocab";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { BackendServices, BackupRead, ProjectRead, RestoreRead } from "@/services";
import { todayRoute } from "../workspaceRoutes";
import { formatTime } from "./useExports";
import { backupFailure, formatBytes, isActive, objectTotal, restoreFailure, useBackups } from "./useBackups";

const props = defineProps<{ services: BackendServices; project: ProjectRead }>();
const router = useRouter();
const state = useBackups(props.services, props.project.id, (done: RestoreRead) => {
  if (done.result_project_id) void router.push(todayRoute(done.result_project_id));
});
const { backups, total, listError, restore, pending, actionError, retried } = state;

const file = ref<File>();
const fileInput = ref<HTMLInputElement>();
const errorFor = (scope: string) => (actionError.value?.scope === scope ? actionError.value.message : "");
const backupError = computed(() =>
  actionError.value && actionError.value.scope !== "restore" && !actionError.value.scope.startsWith("cancel-restore") ? actionError.value.message : "",
);
const fileSummary = computed(() => (file.value ? `${file.value.name} · ${formatBytes(file.value.size)}` : "未选择文件"));
const restoring = computed(() => !!restore.value && isActive(restore.value));
const statusOf = (status: BackupRead["status"]) => {
  const { label, tone, live } = jobStatus[status === "succeeded" ? "done" : status];
  return { label, tone, live };
};
const busy = (action: string, id: string) => pending.value === `${action}:${id}`;

function pick(event: Event) {
  const input = event.target as HTMLInputElement;
  file.value = input.files?.[0] ?? undefined;
  if (actionError.value?.scope === "restore") actionError.value = undefined;
}
function clearFile() {
  file.value = undefined;
  if (fileInput.value) fileInput.value.value = "";
}
async function submitRestore() {
  if (!file.value || restoring.value) return;
  state.dismissRestore();
  if (await state.restoreFrom(file.value)) clearFile();
}

void state.refresh();
let activatedOnce = false;
onActivated(() => {
  if (activatedOnce) void state.refresh();
  activatedOnce = true;
});
</script>

<template>
  <div class="studio-grid workspace-backup">
    <section class="screen-panel studio-body studio-stack" aria-labelledby="backup-title">
      <div>
        <p class="tp-label">03 / Keep</p>
        <h2 id="backup-title" class="tp-title mt-2">完整项目备份</h2>
      </div>
      <p class="studio-copy">正文与全部历史版本、资料原件、任务、反馈、候选与决定、会话、评审和导出记录都会打包。账户偏好与模型凭据不在其中。</p>
      <Transition name="tp-swap" v-bind="panelMotionHooks">
        <p v-if="backupError" :key="backupError" class="studio-notice" role="alert">{{ backupError }}</p>
      </Transition>
      <div class="screen-actions">
        <TpButton variant="primary" :loading="pending === 'create'" :disabled="!!pending" @click="state.create()">生成项目备份</TpButton>
      </div>
      <Transition name="tp-swap" v-bind="panelMotionHooks">
        <TpState
          v-if="listError"
          kind="error"
          title="备份记录暂时无法读取"
          :desc="listError + ' 已生成的备份仍保留在服务端。'"
          retryable
          @retry="state.refresh()"
        />
      </Transition>
      <TransitionGroup name="tp-list" tag="ol" class="tp-list-group workspace-backup__list" aria-label="备份记录" v-bind="listMotionHooks">
        <li v-for="item in backups" :key="item.job_id" class="workspace-backup__item" :data-status="item.status" data-testid="backup-item">
          <div class="studio-row">
            <div class="min-w-0">
              <p class="workspace-backup__title">{{ item.file?.filename ?? "项目备份" }}</p>
              <p class="tp-caption mt-1">
                <time :datetime="item.created_at">{{ formatTime(item.created_at) }}</time
                ><span v-if="item.file"> · {{ formatBytes(item.file.byte_size) }} · {{ objectTotal(item.file.object_counts) }} 个对象</span
                ><span v-if="item.source_job_id"> · 按原输入重试</span>
              </p>
            </div>
            <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
              <TpStatus :key="item.status" v-bind="statusOf(item.status)" />
            </Transition>
          </div>
          <Transition name="tp-swap" v-bind="panelMotionHooks">
            <div
              v-if="item.status === 'failed' || item.status === 'cancelled'"
              class="workspace-backup__failure"
              :role="item.status === 'failed' ? 'alert' : undefined"
            >
              <p class="workspace-backup__what">{{ backupFailure(item) }}</p>
              <p class="tp-caption">项目内容没有改变，{{ retried.has(item.job_id) ? "已重新生成。" : "可重新生成备份。" }}</p>
            </div>
          </Transition>
          <div class="screen-actions workspace-backup__actions">
            <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
              <TpButton
                v-if="item.status === 'succeeded'"
                key="download"
                size="sm"
                :loading="busy('download', item.job_id)"
                :disabled="!!pending"
                @click="state.download(item)"
                >下载备份</TpButton
              >
              <TpButton
                v-else-if="isActive(item)"
                key="cancel"
                size="sm"
                variant="ghost"
                :loading="busy('cancel', item.job_id)"
                :disabled="!!pending"
                @click="state.cancel(item)"
                >取消备份</TpButton
              >
              <TpButton
                v-else-if="!retried.has(item.job_id)"
                key="retry"
                size="sm"
                :loading="busy('retry', item.job_id)"
                :disabled="!!pending"
                @click="state.retry(item)"
                >重新生成</TpButton
              >
            </Transition>
          </div>
        </li>
      </TransitionGroup>
      <p v-if="!listError && !backups.length" class="tp-caption">还没有备份。</p>
      <p v-if="total > backups.length" class="tp-caption">显示最近 {{ backups.length }} 份，共 {{ total }} 份。</p>
    </section>

    <section class="screen-panel studio-body studio-stack" aria-labelledby="restore-title">
      <div>
        <p class="tp-label">04 / Continue</p>
        <h2 id="restore-title" class="tp-title mt-2">从备份恢复为新项目</h2>
      </div>
      <p class="studio-copy">先完整校验，再恢复为独立的新项目。当前项目不会被覆盖。</p>
      <form class="studio-stack" @submit.prevent="submitRestore">
        <TpField v-slot="field" label="备份文件" :error="errorFor('restore')">
          <label class="tp-file-control" :for="field.id">
            <span class="tp-file-control__button"><TpIcon :icon="PhFileZip" :size="16" />选择备份</span>
            <span class="tp-file-control__text">{{ fileSummary }}</span>
            <input
              :id="field.id"
              ref="fileInput"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedby"
              type="file"
              class="tp-file-control__input"
              accept=".zip,application/zip"
              :disabled="pending === 'restore' || restoring"
              @change="pick"
            />
          </label>
        </TpField>
        <Transition name="tp-swap" v-bind="panelMotionHooks">
          <div v-if="file" class="screen-actions">
            <TpButton type="submit" variant="primary" :loading="pending === 'restore'" :disabled="!!pending || restoring">恢复为新项目</TpButton
            ><TpButton variant="ghost" :disabled="pending === 'restore'" @click="clearFile">取消</TpButton>
          </div>
        </Transition>
      </form>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <div v-if="restore" :key="restore.job_id + restore.status" class="workspace-backup__restore" :data-status="restore.status" data-testid="restore-status">
          <div class="studio-row">
            <div class="min-w-0">
              <p class="workspace-backup__title">{{ restore.source_project_name }}</p>
              <p class="tp-caption mt-1">
                备份于 <time :datetime="restore.exported_at">{{ formatTime(restore.exported_at) }}</time> · {{ objectTotal(restore.object_counts) }} 个对象 ·
                {{ formatBytes(restore.byte_size) }}
              </p>
            </div>
            <TpStatus v-bind="statusOf(restore.status)" />
          </div>
          <div v-if="isActive(restore)" class="screen-actions">
            <p class="tp-caption workspace-backup__live" role="status" aria-live="polite">
              <span class="tp-btn__spinner" aria-hidden="true" />{{ restore.status === "queued" ? "等待恢复…" : "正在创建恢复副本…" }}
            </p>
            <TpButton size="sm" variant="ghost" :loading="pending === 'cancel-restore:' + restore.job_id" :disabled="!!pending" @click="state.cancelRestore()"
              >取消恢复</TpButton
            >
          </div>
          <div v-else-if="restore.status === 'succeeded' && restore.result_project_id" class="screen-actions">
            <p class="tp-caption">已恢复为新项目，原项目保持不变。</p>
            <RouterLink class="tp-btn tp-btn--outline tp-btn--sm" :to="todayRoute(restore.result_project_id)">打开恢复副本</RouterLink>
          </div>
          <div v-else class="workspace-backup__failure" :role="restore.status === 'failed' ? 'alert' : undefined">
            <p class="workspace-backup__what">{{ restoreFailure(restore) }}</p>
            <p class="tp-caption">请重新选择备份文件。</p>
          </div>
          <p v-if="errorFor('cancel-restore:' + restore.job_id)" class="studio-notice" role="alert">{{ errorFor("cancel-restore:" + restore.job_id) }}</p>
        </div>
      </Transition>
    </section>
  </div>
</template>

<style scoped>
.workspace-backup__list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.workspace-backup__item,
.workspace-backup__restore {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding-top: 16px;
  border-top: 1px solid var(--tp-line);
}
.workspace-backup__title {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.workspace-backup__failure {
  padding: 12px 16px;
  border-left: 3px solid var(--tp-danger);
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
  line-height: 1.7;
}
[data-status="cancelled"] > .workspace-backup__failure {
  border-left-color: var(--tp-line-strong);
}
.workspace-backup__what {
  font-size: 13px;
  font-weight: 600;
}
.workspace-backup__actions:empty {
  display: none;
}
.workspace-backup__live {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-right: auto;
}
</style>
