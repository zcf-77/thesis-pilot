<script setup lang="ts">
import { computed, onScopeDispose, ref } from "vue";
import { PhUploadSimple } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { BackendServices } from "@/services";
import { ApiError, asApiError } from "@/services/errors";
import { beginJobRequest, confirmJobRequest } from "@/lab/components/integration/jobsRequests";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { bytesToBase64, materialCategories, materialFileError, materialFormat, materialSize, materialStem, type MaterialKind } from "./materialPresentation";

type Material = Awaited<ReturnType<BackendServices["materials"]["get"]>>;
type Receipt = Awaited<ReturnType<BackendServices["materials"]["upload"]>>;
type Upload = Parameters<BackendServices["materials"]["upload"]>[1];
type EntryStatus = "ready" | "invalid" | "uploading" | "saved" | "failed" | "unknown";
interface Entry {
  id: string;
  file: File;
  name: string;
  status: EntryStatus;
  error: string;
  command?: { input: Upload; scope: string; key: string };
}

const props = defineProps<{ services: BackendServices; projectId: string; target?: Material }>();
const emit = defineEmits<{ uploaded: [receipt: Receipt]; done: []; close: [] }>();
const entries = ref<Entry[]>([]);
const category = ref<MaterialKind>(props.target?.kind ?? "other");
const source = ref(props.target?.source_note ?? "");
const error = ref("");
const running = ref(false);
let request: AbortController | undefined;
let disposed = false;

const statusWord: Record<EntryStatus, { label: string; tone: "neutral" | "info" | "success" | "danger" | "warning" }> = {
  ready: { label: "待上传", tone: "neutral" },
  invalid: { label: "不能上传", tone: "danger" },
  uploading: { label: "上传中", tone: "info" },
  saved: { label: "原件已保存", tone: "success" },
  failed: { label: "上传失败", tone: "danger" },
  unknown: { label: "结果未确认", tone: "warning" },
};
const pending = computed(() => entries.value.filter((entry) => ["ready", "failed", "unknown"].includes(entry.status)));
const fileSummary = computed(() =>
  entries.value.length ? entries.value.map((entry) => entry.file.name).join("、") : props.target ? "选择新的原件文件" : "可多选，保留每份原件",
);

function pick(event: Event) {
  const element = event.target as HTMLInputElement;
  const files = Array.from(element.files ?? []);
  if (!files.length) return;
  error.value = "";
  const chosen = props.target ? files.slice(0, 1) : files;
  const kept = entries.value.filter((entry) => entry.status === "saved" || entry.status === "unknown");
  entries.value = [
    ...kept,
    ...chosen.map((file) => {
      const problem = materialFileError(file);
      return {
        id: crypto.randomUUID(),
        file,
        name: props.target?.name ?? materialStem(file.name),
        status: (problem ? "invalid" : "ready") as EntryStatus,
        error: problem,
      };
    }),
  ];
  element.value = "";
}
function discard(entry: Entry) {
  if (entry.status === "uploading") return;
  entries.value = entries.value.filter((item) => item.id !== entry.id);
}

async function prepare(entry: Entry): Promise<NonNullable<Entry["command"]>> {
  const bytes = new Uint8Array(await entry.file.arrayBuffer());
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
  const file_type = materialFormat(entry.file);
  if (!file_type) throw new ApiError("VALIDATION_ERROR");
  const name = entry.name.trim();
  const input: Upload = {
    name,
    kind: category.value,
    source_note: source.value.trim(),
    filename: entry.file.name,
    file_type,
    content_base64: bytesToBase64(bytes),
  };
  const target = props.target;
  const scope =
    "thesispilot.pending-material-upload:" +
    JSON.stringify([props.services.sourceKey, props.projectId, target?.id, target?.version, name, input.kind, input.source_note, entry.file.name, digest]);
  return { input, scope, key: beginJobRequest(scope) };
}

async function send(entry: Entry, controller: AbortController) {
  entry.status = "uploading";
  entry.error = "";
  try {
    const command = (entry.command ??= await prepare(entry));
    if (controller.signal.aborted) return;
    const target = props.target;
    const receipt = target
      ? await props.services.materials.appendOriginal(
          props.projectId,
          target.id,
          { ...command.input, expected_version: target.version },
          command.key,
          controller.signal,
        )
      : await props.services.materials.upload(props.projectId, command.input, command.key, controller.signal);
    if (controller.signal.aborted) return;
    confirmJobRequest(command.scope, command.key);
    entry.command = undefined;
    entry.status = "saved";
    emit("uploaded", receipt);
  } catch (problem) {
    if (controller.signal.aborted) return;
    const issue = asApiError(problem);
    const unknown = !!entry.command && (issue.status === undefined || issue.status >= 500 || issue.code === "INVALID_RESPONSE");
    if (entry.command && !unknown) {
      confirmJobRequest(entry.command.scope, entry.command.key);
      entry.command = undefined;
    }
    entry.status = unknown ? "unknown" : "failed";
    entry.error = unknown ? "上传结果尚未确认，文件与原请求已保留；请用原请求确认，避免重复保存。" : issue.message;
  }
}

async function run(only?: Entry) {
  if (running.value) return;
  error.value = "";
  const queue = only ? [only] : pending.value;
  if (!entries.value.length) {
    error.value = props.target ? "请先选择新的原件文件。" : "请先选择资料文件。";
    return;
  }
  for (const entry of queue) {
    const name = entry.name.trim();
    if (!name || Array.from(name).length > 200) {
      entry.status = "failed";
      entry.error = "资料名称需为 1 至 200 个字符。";
      return;
    }
  }
  const controller = new AbortController();
  request = controller;
  running.value = true;
  try {
    for (const entry of queue) {
      if (controller.signal.aborted || disposed) return;
      await send(entry, controller);
    }
  } finally {
    if (!controller.signal.aborted) running.value = false;
  }
  if (!disposed && entries.value.length && entries.value.every((entry) => entry.status === "saved")) emit("done");
}
function close() {
  request?.abort();
  running.value = false;
  emit("close");
}
onScopeDispose(() => {
  disposed = true;
  request?.abort();
});
</script>

<template>
  <section class="screen-panel library-form" :aria-label="target ? '新增原件版本' : '上传资料'" @keydown.esc.stop="close">
    <div>
      <h2 class="tp-subheading">{{ target ? `为「${target.name}」新增原件版本` : "保留原件，再开始整理。" }}</h2>
      <p class="tp-caption mt-2">DOCX、UTF-8 文本或 PDF，每份最多 8 MiB。上传后自动创建解析任务；PDF 只保留原件，暂不解析。</p>
    </div>
    <form class="library-form-body" @submit.prevent="run()">
      <div class="library-form-grid">
        <TpField v-if="!target" v-slot="{ id }" label="资料分类"
          ><TpSelect :id="id" v-model="category" :options="materialCategories" :disabled="running"
        /></TpField>
        <TpField v-slot="field" label="资料文件" :error="error" :class="{ 'library-form-wide': target }">
          <label class="tp-file-control" :for="field.id">
            <span class="tp-file-control__button"><TpIcon :icon="PhUploadSimple" :size="16" />选择文件</span>
            <span class="tp-file-control__text">{{ fileSummary }}</span>
            <input
              :id="field.id"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedby"
              type="file"
              :multiple="!target"
              class="tp-file-control__input"
              accept=".docx,.txt,.text,.md,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              aria-label="资料文件"
              :disabled="running"
              @change="pick"
            />
          </label>
        </TpField>
        <TpField v-if="!target" v-slot="{ id }" label="资料来源" class="library-form-wide">
          <input :id="id" v-model="source" class="tp-input" maxlength="4000" placeholder="例如课程公开要求、自制模板" :readonly="running" />
        </TpField>
      </div>
      <TransitionGroup v-if="entries.length" name="tp-list" tag="ul" class="upload-queue tp-list-group" aria-label="待上传文件" v-bind="listMotionHooks"
        ><li v-for="entry in entries" :key="entry.id" class="upload-entry">
          <div class="upload-entry-main">
            <input
              v-if="!target && entry.status !== 'saved'"
              v-model="entry.name"
              class="tp-input upload-entry-name"
              maxlength="200"
              :aria-label="`资料名称：${entry.file.name}`"
              :readonly="running || entry.status === 'unknown'"
            /><strong v-else class="upload-entry-title">{{ entry.name }}</strong>
            <span class="tp-caption">{{ entry.file.name }} · {{ materialSize(entry.file.size) }}</span>
          </div>
          <div class="upload-entry-state">
            <TpStatus v-bind="statusWord[entry.status]" :live="entry.status === 'uploading'" size="sm" />
            <TpButton v-if="entry.status === 'failed' && !running" size="sm" @click="run(entry)">重试上传</TpButton
            ><TpButton v-else-if="entry.status === 'unknown' && !running" size="sm" @click="run(entry)">用原请求确认</TpButton
            ><TpButton v-if="['ready', 'invalid', 'failed'].includes(entry.status) && !running" size="sm" variant="ghost" @click="discard(entry)"
              >移除文件</TpButton
            >
          </div>
          <Transition name="tp-swap" v-bind="panelMotionHooks"
            ><p v-if="entry.error" :key="entry.error" class="upload-entry-error" role="alert">{{ entry.error }}</p></Transition
          >
          <p v-if="entry.status === 'ready' && materialFormat(entry.file) === 'pdf'" class="tp-caption upload-entry-note">
            PDF 原件会保留，解析任务将报告暂不支持。
          </p>
        </li></TransitionGroup
      >
      <div class="screen-actions">
        <TpButton type="submit" variant="primary" :loading="running" :disabled="running || !pending.length">上传并解析</TpButton
        ><TpButton variant="ghost" @click="close">{{ running ? "停止并收起" : "收起上传" }}</TpButton>
      </div>
    </form>
  </section>
</template>

<style scoped>
.library-form {
  display: grid;
  gap: 20px;
  padding: 24px;
}
.library-form-body {
  display: grid;
  gap: 20px;
}
.library-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.library-form-grid > * {
  min-width: 0;
}
.library-form-wide {
  grid-column: 1 / -1;
}
.library-form-grid .tp-input {
  width: 100%;
}
.upload-queue {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--tp-line);
}
.upload-entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 16px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--tp-line);
}
.upload-entry-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.upload-entry-name {
  width: 100%;
  min-width: 0;
}
.upload-entry-title {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.upload-entry-main .tp-caption {
  overflow-wrap: anywhere;
}
.upload-entry-state {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}
.upload-entry-note {
  grid-column: 1 / -1;
}
.upload-entry-error {
  grid-column: 1 / -1;
  font-size: 12px;
  color: var(--tp-danger-content);
}
@media (max-width: 600px) {
  .library-form {
    padding: 16px;
  }
  .library-form-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .upload-entry {
    grid-template-columns: minmax(0, 1fr);
  }
  .upload-entry-state {
    justify-content: flex-start;
  }
}
</style>
