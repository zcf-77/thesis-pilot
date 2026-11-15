<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpState from "@/components/ui/TpState.vue";
import type { BackendServices, JobRead, ProjectRead } from "@/services";
import { ApiError, asApiError } from "@/services/errors";
import { beginJobRequest, confirmJobRequest } from "@/lab/components/integration/jobsRequests";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import MaterialUploadForm from "./materials/MaterialUploadForm.vue";
import MaterialParseTask from "./materials/MaterialParseTask.vue";
import MaterialParseResult from "./materials/MaterialParseResult.vue";
import MaterialSourceBinding from "./materials/MaterialSourceBinding.vue";
import { bytesToBase64, materialCategories, materialFileError, materialFormat, materialSize, materialTaskMatches } from "./materials/materialPresentation";

const props = defineProps<{ services: BackendServices; project?: ProjectRead }>();
const emit = defineEmits<{ openJob: [job: JobRead] }>();
type Material = Awaited<ReturnType<BackendServices["materials"]["get"]>>;
type MaterialPage = Awaited<ReturnType<BackendServices["materials"]["list"]>>;
type Original = Awaited<ReturnType<BackendServices["materials"]["original"]>>;
type OriginalPage = Awaited<ReturnType<BackendServices["materials"]["originals"]>>;
type ParsePage = Awaited<ReturnType<BackendServices["materials"]["parses"]>>;
type Parsed = Awaited<ReturnType<BackendServices["materials"]["parse"]>>;
type Upload = Parameters<BackendServices["materials"]["upload"]>[1];
const page = shallowRef<MaterialPage>();
const listBusy = ref(false);
const listError = ref("");
const attemptedOffset = ref(0);
const selected = shallowRef<Material>();
const originals = shallowRef<OriginalPage>();
const original = shallowRef<Original>();
const parses = shallowRef<ParsePage>();
const parsed = shallowRef<Parsed>();
const selectedJob = shallowRef<JobRead>();
const detailBusy = ref(false);
const originalBusy = ref(false);
const parseBusy = ref(false);
const detailError = ref("");
const parseError = ref("");
const taskError = ref("");
const uploadOpen = ref(false);
const appendTarget = shallowRef<Material>();
const busy = ref(false);
const uploadError = ref("");
const unknownUpload = ref(false);
const notice = ref("");
const editOpen = ref(false);
const editDraft = ref({ name: "", kind: "other" as Material["kind"], source_note: "" });
const editError = ref("");
const mustReload = ref(false);
const downloadBusy = ref(false);
const downloadError = ref("");
const reparseBusy = ref(false);
const reparseError = ref("");
const bindingToken = ref(0);
const followLatest = ref(true);
const requestedParseId = ref("");
const categoryName = (kind: string) => materialCategories.find((item) => item.value === kind)?.label ?? kind;
const originalOptions = computed(() => {
  const items = [...(originals.value?.items ?? [])];
  if (original.value && !items.some((item) => item.id === original.value!.id)) items.unshift(original.value);
  return items.map((item) => ({ value: item.id, label: `原件 v${item.version} · ${item.filename}` }));
});
const parseOptions = computed(() => {
  const items = [...(parses.value?.items ?? [])];
  if (parsed.value && !items.some((item) => item.id === parsed.value!.id))
    items.unshift({ id: parsed.value.id, version: parsed.value.version } as ParsePage["items"][number]);
  return items.map((item) => ({ value: item.id, label: `解析 v${item.version}` }));
});
let listRequest: AbortController | undefined;
let detailRequest: AbortController | undefined;
let originalRequest: AbortController | undefined;
let parseRequest: AbortController | undefined;
let mutationRequest: AbortController | undefined;
let downloadRequest: AbortController | undefined;
let reparseRequest: AbortController | undefined;
let pendingUpload: { input: Upload; scope: string; key: string; projectId: string; target?: Material } | undefined;
let pendingReparse: { projectId: string; materialId: string; originalId: string; expected: string | null; scope: string; key: string } | undefined;
const objectUrls = new Set<string>();

async function load(offset = attemptedOffset.value) {
  if (!props.project) return;
  listRequest?.abort();
  const controller = new AbortController();
  listRequest = controller;
  attemptedOffset.value = offset;
  listBusy.value = true;
  listError.value = "";
  try {
    const result = await props.services.materials.list(props.project.id, { offset, limit: 20 }, controller.signal);
    if (!controller.signal.aborted) page.value = result;
  } catch (problem) {
    if (!controller.signal.aborted) listError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) listBusy.value = false;
  }
}

function closeUpload() {
  mutationRequest?.abort();
  busy.value = false;
  uploadOpen.value = false;
  appendTarget.value = undefined;
  pendingUpload = undefined;
  unknownUpload.value = false;
}
function showUpload(target?: Material) {
  closeUpload();
  uploadError.value = "";
  notice.value = "";
  appendTarget.value = target;
  uploadOpen.value = true;
}
async function upload(input: { file: File; name: string; category: string; source: string }) {
  if (!props.project || busy.value || unknownUpload.value) return;
  uploadError.value = materialFileError(input.file);
  if (uploadError.value) return;
  const projectId = props.project.id;
  const target = appendTarget.value;
  const controller = new AbortController();
  mutationRequest = controller;
  busy.value = true;
  try {
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    if (controller.signal.aborted) return;
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
    if (controller.signal.aborted) return;
    const file_type = materialFormat(input.file);
    if (!file_type) throw new ApiError("VALIDATION_ERROR");
    const body: Upload = {
      name: input.name,
      kind: input.category as Material["kind"],
      source_note: input.source,
      filename: input.file.name,
      file_type,
      content_base64: bytesToBase64(bytes),
    };
    const scope =
      "thesispilot.pending-material-upload:" +
      JSON.stringify([props.services.sourceKey, projectId, target?.id, target?.version, input.name, input.category, input.source, input.file.name, digest]);
    pendingUpload = { input: body, scope, key: beginJobRequest(scope), projectId, target };
    busy.value = false;
    await confirmUpload();
  } catch (problem) {
    if (!controller.signal.aborted) uploadError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
async function confirmUpload() {
  const command = pendingUpload;
  if (!command || busy.value) return;
  const controller = new AbortController();
  mutationRequest = controller;
  busy.value = true;
  uploadError.value = "";
  try {
    const receipt = command.target
      ? await props.services.materials.appendOriginal(
          command.projectId,
          command.target.id,
          { ...command.input, expected_version: command.target.version },
          command.key,
          controller.signal,
        )
      : await props.services.materials.upload(command.projectId, command.input, command.key, controller.signal);
    if (controller.signal.aborted) return;
    confirmJobRequest(command.scope, command.key);
    pendingUpload = undefined;
    unknownUpload.value = false;
    uploadOpen.value = false;
    appendTarget.value = undefined;
    await load(0);
    if (controller.signal.aborted) return;
    void inspect(receipt.material, receipt.original.id);
    bindingToken.value++;
    notice.value = "原件已保存，解析任务已创建；正式稿保持不变。";
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      unknownUpload.value = issue.status === undefined || issue.status >= 500 || issue.code === "INVALID_RESPONSE";
      uploadError.value = unknownUpload.value ? "上传结果尚未确认，文件与固定请求已保留。请使用原请求确认，避免重复上传。" : issue.message;
      if (!unknownUpload.value) {
        confirmJobRequest(command.scope, command.key);
        pendingUpload = undefined;
      }
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

async function inspect(material: Material, preferredOriginal?: string) {
  if (!props.project) return;
  detailRequest?.abort();
  originalRequest?.abort();
  parseRequest?.abort();
  mutationRequest?.abort();
  busy.value = false;
  editOpen.value = false;
  mustReload.value = false;
  followLatest.value = true;
  selected.value = material;
  original.value = undefined;
  parsed.value = undefined;
  selectedJob.value = undefined;
  originals.value = undefined;
  parses.value = undefined;
  detailError.value = "";
  const controller = new AbortController();
  detailRequest = controller;
  detailBusy.value = true;
  try {
    const latest = await props.services.materials.get(props.project.id, material.id, controller.signal);
    if (controller.signal.aborted) return;
    selected.value = latest;
    const result = await props.services.materials.originals(props.project.id, material.id, { offset: 0, limit: 20 }, controller.signal);
    if (controller.signal.aborted) return;
    originals.value = result;
    const id = preferredOriginal ?? latest.current_original_id;
    void selectOriginal(id);
  } catch (problem) {
    if (!controller.signal.aborted) detailError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) detailBusy.value = false;
  }
}
async function originalPage(offset: number) {
  if (!props.project || !selected.value) return;
  detailRequest?.abort();
  const controller = new AbortController();
  detailRequest = controller;
  detailBusy.value = true;
  try {
    const result = await props.services.materials.originals(props.project.id, selected.value.id, { offset, limit: 20 }, controller.signal);
    if (!controller.signal.aborted) originals.value = result;
  } catch (problem) {
    if (!controller.signal.aborted) detailError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) detailBusy.value = false;
  }
}
async function selectOriginal(id: string, preserveParse?: string) {
  if (!props.project || !selected.value) return;
  if (pendingReparse?.originalId !== id) pendingReparse = undefined;
  originalRequest?.abort();
  parseRequest?.abort();
  reparseRequest?.abort();
  downloadRequest?.abort();
  reparseBusy.value = false;
  downloadBusy.value = false;
  const controller = new AbortController();
  originalRequest = controller;
  originalBusy.value = true;
  original.value = undefined;
  parsed.value = undefined;
  selectedJob.value = undefined;
  parses.value = undefined;
  parseError.value = "";
  taskError.value = "";
  reparseError.value = "";
  downloadError.value = "";
  const projectId = props.project.id;
  const materialId = selected.value.id;
  try {
    const results = await Promise.allSettled([
      props.services.materials.original(projectId, materialId, id, controller.signal),
      props.services.materials.parses(projectId, materialId, id, { offset: 0, limit: 20 }, controller.signal),
      latestJob(projectId, id, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    if (results[0].status === "fulfilled") original.value = results[0].value;
    else parseError.value = asApiError(results[0].reason).message;
    if (results[1].status === "fulfilled") {
      parses.value = results[1].value;
      const parseId = preserveParse ?? original.value?.latest_parse_id ?? results[1].value.items[0]?.id;
      if (parseId) void readParse(parseId);
    } else parseError.value = asApiError(results[1].reason).message;
    if (results[2].status === "fulfilled") {
      const matching = results[2].value;
      if (matching) selectedJob.value = matching;
      else if (original.value?.initial_job_id) {
        const job = await props.services.jobs.get(original.value.initial_job_id, controller.signal, projectId);
        if (!controller.signal.aborted) selectedJob.value = job;
      }
    } else taskError.value = asApiError(results[2].reason).message;
  } catch (problem) {
    if (!controller.signal.aborted) parseError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) originalBusy.value = false;
  }
}
async function latestJob(projectId: string, originalId: string, signal: AbortSignal) {
  let offset = 0;
  do {
    const result = await props.services.jobs.list({ project_id: projectId, kind: "material_parse", offset, limit: 100 }, signal);
    if (signal.aborted) return;
    const found = result.items.find((job) => materialTaskMatches(job, projectId, originalId));
    if (found) return found;
    offset += result.items.length;
    if (!result.items.length || offset >= result.total) return;
  } while (!signal.aborted);
}
function updatedJob(job: JobRead) {
  if (!props.project || !original.value || !materialTaskMatches(job, props.project.id, original.value.id)) return;
  if (job.id !== selectedJob.value?.id && job.source_job_id !== selectedJob.value?.id) return;
  selectedJob.value = job;
}
async function readParse(id: string) {
  if (!props.project || !selected.value || !original.value) return;
  requestedParseId.value = id;
  parseRequest?.abort();
  const controller = new AbortController();
  parseRequest = controller;
  parseBusy.value = true;
  parseError.value = "";
  try {
    const result = await props.services.materials.parse(props.project.id, selected.value.id, original.value.id, id, controller.signal);
    if (!controller.signal.aborted) {
      parsed.value = result;
      bindingToken.value++;
    }
  } catch (problem) {
    if (!controller.signal.aborted) parseError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) parseBusy.value = false;
  }
}
async function parsePage(offset: number) {
  if (!props.project || !selected.value || !original.value) return;
  parseRequest?.abort();
  const controller = new AbortController();
  parseRequest = controller;
  parseBusy.value = true;
  try {
    const result = await props.services.materials.parses(props.project.id, selected.value.id, original.value.id, { offset, limit: 20 }, controller.signal);
    if (!controller.signal.aborted) parses.value = result;
  } catch (problem) {
    if (!controller.signal.aborted) parseError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) parseBusy.value = false;
  }
}
function finished(job: JobRead) {
  if (job.id !== selectedJob.value?.id || !original.value) return;
  const id = original.value.id;
  const keep = followLatest.value ? undefined : requestedParseId.value || parsed.value?.id;
  void selectOriginal(id, keep);
  bindingToken.value++;
}

function edit() {
  if (!selected.value) return;
  editDraft.value = { name: selected.value.name, kind: selected.value.kind, source_note: selected.value.source_note };
  editError.value = "";
  mustReload.value = false;
  editOpen.value = true;
}
function closeEdit() {
  mutationRequest?.abort();
  busy.value = false;
  editOpen.value = false;
}
async function saveMetadata() {
  if (!props.project || !selected.value || busy.value || mustReload.value) return;
  if (!editDraft.value.name.trim() || Array.from(editDraft.value.name.trim()).length > 200) {
    editError.value = "请输入 1 至 200 个字符的资料名称。";
    return;
  }
  const controller = new AbortController();
  mutationRequest = controller;
  busy.value = true;
  editError.value = "";
  try {
    const latest = await props.services.materials.update(
      props.project.id,
      selected.value.id,
      { ...editDraft.value, name: editDraft.value.name.trim(), expected_version: selected.value.version },
      controller.signal,
    );
    if (!controller.signal.aborted) {
      selected.value = latest;
      editOpen.value = false;
      await load();
      bindingToken.value++;
      notice.value = "资料名称、分类与来源已保存；原件与解析版本保持不变。";
    }
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      mustReload.value = issue.status === 409 || issue.status === undefined || issue.status >= 500 || issue.code === "INVALID_RESPONSE";
      editError.value = mustReload.value ? `${issue.message} 输入已保留，请载入最新资料后重新编辑。` : issue.message;
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
async function reloadMetadata() {
  if (!props.project || !selected.value) return;
  const controller = new AbortController();
  mutationRequest?.abort();
  mutationRequest = controller;
  busy.value = true;
  try {
    const latest = await props.services.materials.get(props.project.id, selected.value.id, controller.signal);
    if (!controller.signal.aborted) {
      selected.value = latest;
      edit();
      notice.value = "已载入最新资料，请重新检查并编辑。";
    }
  } catch (problem) {
    if (!controller.signal.aborted) editError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}
async function download() {
  if (!props.project || !selected.value || !original.value || downloadBusy.value) return;
  const controller = new AbortController();
  downloadRequest = controller;
  downloadBusy.value = true;
  downloadError.value = "";
  const version = original.value;
  try {
    const blob = await props.services.materials.download(props.project.id, selected.value.id, version.id, controller.signal);
    if (controller.signal.aborted) return;
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = version.filename;
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      objectUrls.delete(url);
    }, 1000);
  } catch (problem) {
    if (!controller.signal.aborted) downloadError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) downloadBusy.value = false;
  }
}
async function reparse() {
  if (!props.project || !selected.value || !original.value || reparseBusy.value) return;
  if (!pendingReparse) {
    const expected = original.value.latest_parse_id;
    const scope =
      "thesispilot.pending-material-parse:" + JSON.stringify([props.services.sourceKey, props.project.id, selected.value.id, original.value.id, expected]);
    pendingReparse = {
      projectId: props.project.id,
      materialId: selected.value.id,
      originalId: original.value.id,
      expected,
      scope,
      key: beginJobRequest(scope),
    };
  }
  const command = pendingReparse;
  const controller = new AbortController();
  reparseRequest = controller;
  reparseBusy.value = true;
  reparseError.value = "";
  try {
    const job = await props.services.materials.reparse(
      command.projectId,
      command.materialId,
      command.originalId,
      { expected_parse_id: command.expected },
      command.key,
      controller.signal,
    );
    if (!controller.signal.aborted) {
      confirmJobRequest(command.scope, command.key);
      pendingReparse = undefined;
      selectedJob.value = job;
      followLatest.value = true;
      notice.value = "重新解析任务已创建，当前解析版本保留到新结果完成。";
    }
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      if (issue.status !== undefined && issue.status < 500 && issue.code !== "INVALID_RESPONSE") {
        confirmJobRequest(command.scope, command.key);
        pendingReparse = undefined;
      }
      reparseError.value = pendingReparse ? "创建结果未知，请使用原请求确认重新解析。" : issue.message;
    }
  } finally {
    if (!controller.signal.aborted) reparseBusy.value = false;
  }
}

function stop() {
  listRequest?.abort();
  detailRequest?.abort();
  originalRequest?.abort();
  parseRequest?.abort();
  mutationRequest?.abort();
  downloadRequest?.abort();
  reparseRequest?.abort();
}
watch(
  () => props.project?.id,
  () => {
    stop();
    page.value = undefined;
    selected.value = undefined;
    original.value = undefined;
    parsed.value = undefined;
    selectedJob.value = undefined;
    uploadOpen.value = false;
    editOpen.value = false;
    busy.value = false;
    pendingUpload = undefined;
    pendingReparse = undefined;
    unknownUpload.value = false;
    void load(0);
  },
  { immediate: true },
);
onScopeDispose(() => {
  stop();
  for (const url of objectUrls) URL.revokeObjectURL(url);
});
</script>

<template>
  <Transition appear name="tp-page"
    ><div class="screen-page workspace-page studio-stack materials-page">
      <header class="screen-heading">
        <div>
          <h1 class="tp-display">项目资料</h1>
          <p v-if="project" class="tp-caption">{{ project.name }} · 原件、解析与固定来源版本</p>
        </div>
        <TpButton v-if="project && !uploadOpen" variant="primary" @click="showUpload()">上传资料</TpButton>
      </header>
      <TpState v-if="!project" kind="empty" title="请选择论文项目" desc="资料只在明确项目范围内上传和绑定。" class="screen-panel" />
      <template v-else>
        <Transition name="tp-swap" v-bind="panelMotionHooks"
          ><MaterialUploadForm
            v-if="uploadOpen"
            :key="appendTarget?.id ?? 'new'"
            :busy="busy || unknownUpload"
            :title="appendTarget ? '新增原件版本' : '上传资料'"
            :initial="appendTarget ? { name: appendTarget.name, category: appendTarget.kind, source: appendTarget.source_note } : undefined"
            @upload="upload"
            @close="closeUpload"
        /></Transition>
        <Transition name="tp-swap" v-bind="panelMotionHooks"
          ><p v-if="uploadError" :key="uploadError" class="studio-notice" role="alert">{{ uploadError }}</p></Transition
        >
        <div v-if="unknownUpload" class="screen-actions">
          <TpButton :disabled="busy" @click="confirmUpload">使用原请求确认上传</TpButton
          ><TpButton :disabled="listBusy" @click="load(0)">刷新并核对资料列表</TpButton>
        </div>
        <p v-if="notice" class="studio-notice" role="status">{{ notice }}</p>
        <div class="materials-layout">
          <section class="screen-panel studio-body studio-stack" aria-label="资料列表">
            <div class="studio-row">
              <h2 class="tp-heading">项目资料</h2>
              <TpButton size="sm" variant="ghost" :disabled="listBusy" @click="load()">刷新资料</TpButton>
            </div>
            <p v-if="listBusy" class="tp-caption" role="status">正在读取资料…</p>
            <TpState v-if="listError && !page?.items.length" kind="error" title="资料读取失败" :desc="listError" retryable @retry="load()" /><TpState
              v-else-if="page && !page.items.length"
              kind="empty"
              title="还没有资料"
              desc="上传自制模板或要求，保留原件并自动解析。"
            /><TransitionGroup name="tp-list" tag="ul" v-bind="listMotionHooks" class="material-list tp-list-group"
              ><li v-for="material in page?.items" :key="material.id">
                <button
                  type="button"
                  class="material-list-entry"
                  :aria-label="material.name"
                  :aria-pressed="selected?.id === material.id"
                  :disabled="busy"
                  @click="inspect(material)"
                >
                  <strong>{{ material.name }}</strong
                  ><span class="tp-caption"
                    >{{ categoryName(material.kind) }} · 元数据 v{{ material.version
                    }}{{ material.removed ? " · 已移除" : !material.linked ? " · 未关联" : "" }}</span
                  >
                </button>
              </li></TransitionGroup
            >
            <p v-if="listError && page?.items.length" class="studio-notice" role="alert">{{ listError }}</p>
            <div v-if="page && page.total > 20" class="screen-actions">
              <TpButton size="sm" :disabled="listBusy || page.offset === 0" @click="load(Math.max(0, page.offset - 20))">上一页资料</TpButton
              ><TpButton size="sm" :disabled="listBusy || page.offset + page.items.length >= page.total" @click="load(page.offset + 20)">下一页资料</TpButton>
            </div>
          </section>
          <div class="studio-stack material-main">
            <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
              ><section v-if="selected" :key="selected.id" class="screen-panel studio-body studio-stack" aria-label="资料详情">
                <div class="studio-row">
                  <h2 class="tp-heading">{{ selected.name }}</h2>
                  <span class="tp-caption">{{ categoryName(selected.kind) }}</span>
                </div>
                <p class="tp-caption">来源：{{ selected.source_note || "未填写" }}</p>
                <div class="screen-actions">
                  <TpButton size="sm" :disabled="busy" @click="edit">编辑资料信息</TpButton
                  ><TpButton size="sm" :disabled="busy" @click="showUpload(selected)">新增原件版本</TpButton
                  ><TpButton size="sm" variant="ghost" :disabled="detailBusy || originalBusy" @click="inspect(selected, original?.id)">刷新资料详情</TpButton>
                </div>
                <p v-if="detailBusy || originalBusy || parseBusy" class="tp-caption" role="status">正在读取原件与解析版本…</p>
                <TpState v-if="detailError" kind="error" title="详情读取失败" :desc="detailError" retryable @retry="inspect(selected)" />
                <Transition name="tp-swap" v-bind="panelMotionHooks"
                  ><form
                    v-if="editOpen"
                    class="studio-stack material-edit"
                    aria-label="编辑资料信息"
                    @submit.prevent="saveMetadata"
                    @keydown.esc.stop="closeEdit"
                  >
                    <TpField v-slot="{ id }" label="资料名称"
                      ><input :id="id" v-model="editDraft.name" class="tp-input" :readonly="busy" maxlength="200" /></TpField
                    ><TpField v-slot="{ id }" label="资料分类"
                      ><TpSelect :id="id" v-model="editDraft.kind" :options="materialCategories" :disabled="busy" /></TpField
                    ><TpField v-slot="{ id }" label="资料来源">
                      <textarea :id="id" v-model="editDraft.source_note" class="tp-input" rows="2" :readonly="busy" />
                    </TpField>
                    <p v-if="editError" role="alert" class="studio-notice">{{ editError }}</p>
                    <div class="screen-actions">
                      <TpButton type="submit" variant="primary" :disabled="busy || mustReload" :loading="busy">保存资料信息</TpButton
                      ><TpButton v-if="mustReload" :disabled="busy" @click="reloadMetadata">载入最新资料</TpButton
                      ><TpButton variant="ghost" @click="closeEdit">取消编辑</TpButton>
                    </div>
                  </form></Transition
                >
                <TpField v-if="originals?.items.length" v-slot="{ id }" label="原件版本"
                  ><TpSelect
                    :id="id"
                    :model-value="original?.id"
                    :options="originalOptions"
                    :disabled="originalBusy"
                    @update:model-value="
                      followLatest = true;
                      selectOriginal($event);
                    "
                /></TpField>
                <div v-if="originals && originals.total > 20" class="screen-actions">
                  <TpButton size="sm" :disabled="detailBusy || originals.offset === 0" @click="originalPage(Math.max(0, originals.offset - 20))"
                    >上一页原件</TpButton
                  ><TpButton
                    size="sm"
                    :disabled="detailBusy || originals.offset + originals.items.length >= originals.total"
                    @click="originalPage(originals.offset + 20)"
                    >下一页原件</TpButton
                  >
                </div>
                <div v-if="original" class="studio-stack">
                  <p class="tp-caption">
                    {{ original.filename }} · {{ materialSize(original.byte_size) }} · {{ original.file_type.toUpperCase() }} · 原件 v{{ original.version }}
                  </p>
                  <p class="tp-caption material-digest">SHA-256：{{ original.sha256 }}</p>
                  <p v-if="original.file_type === 'pdf'" class="studio-notice">当前不支持 PDF 解析；原件已保留，可下载后查看。</p>
                  <div class="screen-actions">
                    <TpButton size="sm" :disabled="downloadBusy" @click="download">下载当前原件</TpButton
                    ><TpButton size="sm" :disabled="reparseBusy || selectedJob?.status === 'queued' || selectedJob?.status === 'running'" @click="reparse"
                      >重新解析此原件</TpButton
                    >
                  </div>
                  <p v-if="downloadError" role="alert" class="studio-notice">下载失败：{{ downloadError }}</p>
                  <p v-if="reparseError" role="alert" class="studio-notice">
                    {{ reparseError }}<TpButton size="sm" :disabled="reparseBusy" @click="reparse">使用原请求确认重新解析</TpButton>
                  </p>
                </div>
                <MaterialParseTask
                  v-if="selectedJob && original"
                  :key="original.id"
                  :services="services"
                  :job="selectedJob"
                  @updated="updatedJob"
                  @finished="finished"
                  @open-job="emit('openJob', $event)"
                />
                <p v-if="taskError" role="alert" class="studio-notice">任务状态读取失败：{{ taskError }}</p>
                <TpField v-if="parses?.items.length" v-slot="{ id }" label="解析版本"
                  ><TpSelect
                    :id="id"
                    :model-value="parsed?.id"
                    :options="parseOptions"
                    :disabled="parseBusy"
                    @update:model-value="
                      followLatest = false;
                      readParse($event);
                    "
                /></TpField>
                <div v-if="parses && parses.total > 20" class="screen-actions">
                  <TpButton size="sm" :disabled="parseBusy || parses.offset === 0" @click="parsePage(Math.max(0, parses.offset - 20))">上一页解析</TpButton
                  ><TpButton size="sm" :disabled="parseBusy || parses.offset + parses.items.length >= parses.total" @click="parsePage(parses.offset + 20)"
                    >下一页解析</TpButton
                  >
                </div>
                <p v-if="parseError" role="alert" class="studio-notice">
                  {{ parseError }}<TpButton v-if="original" size="sm" @click="selectOriginal(original.id)">重试解析读取</TpButton>
                </p>
                <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
                  ><MaterialParseResult v-if="parsed" :key="parsed.id" :parsed="parsed" />
                  <p v-else-if="original && !parseBusy && !parseError" class="tp-caption">本原件尚无可读解析版本；请查看任务状态，原件始终保留。</p></Transition
                >
              </section>
              <TpState v-else kind="empty" title="选择一份资料" desc="查看原件、解析结果与来源；上传资料不会改写正文。" class="screen-panel"
            /></Transition>
          </div>
        </div>
        <MaterialSourceBinding :services="services" :project-id="project.id" :refresh-token="bindingToken" />
      </template></div
  ></Transition>
</template>

<style scoped>
.materials-layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  align-items: start;
  gap: 20px;
}
.material-main {
  min-width: 0;
}
.material-list {
  padding: 0;
  margin: 0;
  list-style: none;
}
.material-list-entry {
  display: grid;
  gap: 5px;
  width: 100%;
  padding: 14px 10px;
  border: 0;
  border-bottom: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  text-align: left;
  background: transparent;
  color: var(--tp-text);
  cursor: pointer;
  overflow-wrap: anywhere;
}
.material-list-entry:hover,
.material-list-entry[aria-pressed="true"] {
  background: var(--tp-accent-soft);
  color: var(--tp-accent-soft-content);
}
.material-edit {
  padding: 16px;
  background: var(--tp-surface-sunken);
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
}
.material-digest {
  font-family: var(--tp-font-mono);
  font-size: 11px;
  overflow-wrap: anywhere;
}
textarea {
  width: 100%;
  resize: vertical;
}
@media (max-width: 900px) {
  .materials-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
