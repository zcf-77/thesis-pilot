<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, shallowRef, watch } from "vue";
import { PhArrowRight, PhPencilSimple } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpState from "@/components/ui/TpState.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import type { BackendServices, JobRead } from "@/services";
import { asApiError } from "@/services/errors";
import { serviceJobStatus } from "@/lab/state/serviceJobs";
import { beginJobRequest, confirmJobRequest } from "@/lab/components/integration/jobsRequests";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import MaterialParseTask from "./MaterialParseTask.vue";
import MaterialParseResult from "./MaterialParseResult.vue";
import { jobOriginalId } from "./useMaterialCatalog";
import type { SourceBindingState } from "./useSourceBinding";
import { materialCategories, materialExtension, materialSize, materialTaskMatches, materialTime, type MaterialKind } from "./materialPresentation";

type Material = Awaited<ReturnType<BackendServices["materials"]["get"]>>;
type Original = Awaited<ReturnType<BackendServices["materials"]["original"]>>;
type OriginalPage = Awaited<ReturnType<BackendServices["materials"]["originals"]>>;
type ParsePage = Awaited<ReturnType<BackendServices["materials"]["parses"]>>;
type Parsed = Awaited<ReturnType<BackendServices["materials"]["parse"]>>;
type Patch = { name?: string; kind?: MaterialKind; source_note?: string; linked?: boolean; removed?: boolean };

const props = defineProps<{
  services: BackendServices;
  projectId: string;
  material: Material;
  preferredOriginal?: string;
  query: string;
  binding: SourceBindingState;
  requirementsTab?: boolean;
}>();
const emit = defineEmits<{
  changed: [material: Material];
  openJob: [job: JobRead];
  jobUpdated: [material: Material, job: JobRead];
  append: [material: Material];
  showRequirements: [];
}>();

const selected = shallowRef<Material>(props.material);
const originals = shallowRef<OriginalPage>();
const original = shallowRef<Original>();
const parses = shallowRef<ParsePage>();
const parsed = shallowRef<Parsed>();
const selectedJob = shallowRef<JobRead>();
const attempts = shallowRef<JobRead[]>([]);
const detailBusy = ref(false);
const originalBusy = ref(false);
const parseBusy = ref(false);
const detailError = ref("");
const parseError = ref("");
const taskError = ref("");
const downloadBusy = ref(false);
const downloadError = ref("");
const reparseBusy = ref(false);
const reparseError = ref("");
const historyOpen = ref(false);
const followLatest = ref(true);
const requestedParseId = ref("");
const patchBusy = ref(false);
const patchError = ref("");
const mustReload = ref(false);
const notice = ref("");
const undoPatch = shallowRef<Patch>();
const undoLabel = ref("撤销");
const editing = ref<"" | "name" | "source">("");
const draft = ref("");
const editor = ref<HTMLInputElement>();

const categoryName = computed(() => materialCategories.find((item) => item.value === selected.value.kind)?.label ?? selected.value.kind);
const isCurrent = computed(() => !original.value || original.value.id === selected.value.current_original_id);
const available = computed(() => selected.value.linked && !selected.value.removed);
const active = computed(() => selectedJob.value?.status === "queued" || selectedJob.value?.status === "running");
const summary = computed(() => (parsed.value ? { status: parsed.value.result.status } : parses.value?.items[0]));
const retryable = computed(() => selectedJob.value?.status === "failed" || selectedJob.value?.status === "cancelled");
const loading = computed(() => detailBusy.value || originalBusy.value || parseBusy.value);
let detailRequest: AbortController | undefined;
let originalRequest: AbortController | undefined;
let parseRequest: AbortController | undefined;
let patchRequest: AbortController | undefined;
let downloadRequest: AbortController | undefined;
let reparseRequest: AbortController | undefined;
let pendingReparse: { materialId: string; originalId: string; expected: string | null; scope: string; key: string } | undefined;
const objectUrls = new Set<string>();

async function inspect(preferredOriginal?: string) {
  detailRequest?.abort();
  originalRequest?.abort();
  parseRequest?.abort();
  followLatest.value = true;
  originals.value = undefined;
  detailError.value = "";
  const controller = new AbortController();
  detailRequest = controller;
  detailBusy.value = true;
  try {
    const latest = await props.services.materials.get(props.projectId, props.material.id, controller.signal);
    if (controller.signal.aborted) return;
    selected.value = latest;
    const result = await props.services.materials.originals(props.projectId, latest.id, { offset: 0, limit: 20 }, controller.signal);
    if (controller.signal.aborted) return;
    originals.value = result;
    void selectOriginal(preferredOriginal ?? latest.current_original_id);
  } catch (problem) {
    if (!controller.signal.aborted) detailError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) detailBusy.value = false;
  }
}
async function originalPage(offset: number) {
  detailRequest?.abort();
  const controller = new AbortController();
  detailRequest = controller;
  detailBusy.value = true;
  try {
    const result = await props.services.materials.originals(props.projectId, selected.value.id, { offset, limit: 20 }, controller.signal);
    if (!controller.signal.aborted) originals.value = result;
  } catch (problem) {
    if (!controller.signal.aborted) detailError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) detailBusy.value = false;
  }
}
async function selectOriginal(id: string, preserveParse?: string) {
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
  if (original.value?.id !== id) {
    original.value = undefined;
    parsed.value = undefined;
    selectedJob.value = undefined;
    attempts.value = [];
  }
  parses.value = undefined;
  parseError.value = "";
  taskError.value = "";
  reparseError.value = "";
  downloadError.value = "";
  const projectId = props.projectId;
  const materialId = selected.value.id;
  try {
    const results = await Promise.allSettled([
      props.services.materials.original(projectId, materialId, id, controller.signal),
      props.services.materials.parses(projectId, materialId, id, { offset: 0, limit: 20 }, controller.signal),
      originalJobs(projectId, id, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    if (results[0].status === "fulfilled") original.value = results[0].value;
    else parseError.value = asApiError(results[0].reason).message;
    if (results[1].status === "fulfilled") {
      parses.value = results[1].value;
      const parseId = preserveParse ?? original.value?.latest_parse_id ?? results[1].value.items[0]?.id;
      if (parseId) void readParse(parseId);
      else parsed.value = undefined;
    } else parseError.value = asApiError(results[1].reason).message;
    if (results[2].status === "fulfilled") {
      const jobs = results[2].value ?? [];
      attempts.value = jobs;
      if (jobs[0]) selectedJob.value = jobs[0];
      else if (original.value?.initial_job_id) {
        const job = await props.services.jobs.get(original.value.initial_job_id, controller.signal, projectId);
        if (!controller.signal.aborted) {
          selectedJob.value = job;
          attempts.value = [job];
        }
      }
    } else taskError.value = asApiError(results[2].reason).message;
  } catch (problem) {
    if (!controller.signal.aborted) taskError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) originalBusy.value = false;
  }
}
/** Every parse task for one original, newest first; this is the attempt history shown in version records. */
async function originalJobs(projectId: string, originalId: string, signal: AbortSignal) {
  const found: JobRead[] = [];
  let offset = 0;
  do {
    const result = await props.services.jobs.list({ project_id: projectId, kind: "material_parse", offset, limit: 100 }, signal);
    if (signal.aborted) return;
    found.push(...result.items.filter((job) => materialTaskMatches(job, projectId, originalId)));
    offset += result.items.length;
    if (!result.items.length || offset >= result.total || offset >= 1000) break;
  } while (!signal.aborted);
  return found;
}
function updatedJob(job: JobRead) {
  if (!original.value || !materialTaskMatches(job, props.projectId, original.value.id)) return;
  if (job.id !== selectedJob.value?.id && job.source_job_id !== selectedJob.value?.id) return;
  selectedJob.value = job;
  attempts.value = [job, ...attempts.value.filter((item) => item.id !== job.id)];
  if (jobOriginalId(job) === selected.value.current_original_id) emit("jobUpdated", selected.value, job);
}
async function readParse(id: string) {
  if (!original.value) return;
  requestedParseId.value = id;
  parseRequest?.abort();
  const controller = new AbortController();
  parseRequest = controller;
  parseBusy.value = true;
  parseError.value = "";
  try {
    const result = await props.services.materials.parse(props.projectId, selected.value.id, original.value.id, id, controller.signal);
    if (!controller.signal.aborted) parsed.value = result;
  } catch (problem) {
    if (!controller.signal.aborted) parseError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) parseBusy.value = false;
  }
}
async function parsePage(offset: number) {
  if (!original.value) return;
  parseRequest?.abort();
  const controller = new AbortController();
  parseRequest = controller;
  parseBusy.value = true;
  try {
    const result = await props.services.materials.parses(props.projectId, selected.value.id, original.value.id, { offset, limit: 20 }, controller.signal);
    if (!controller.signal.aborted) parses.value = result;
  } catch (problem) {
    if (!controller.signal.aborted) parseError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) parseBusy.value = false;
  }
}
function finished(job: JobRead) {
  if (job.id !== selectedJob.value?.id || !original.value) return;
  const keep = followLatest.value ? undefined : requestedParseId.value || parsed.value?.id;
  void selectOriginal(original.value.id, keep);
  void props.binding.loadOptions();
}
function chooseOriginal(id: string) {
  followLatest.value = true;
  void selectOriginal(id);
}
function chooseParse(id: string) {
  followLatest.value = false;
  void readParse(id);
}

async function patch(fields: Patch, undo = false) {
  if (patchBusy.value || mustReload.value) return false;
  const before = selected.value;
  const controller = new AbortController();
  patchRequest?.abort();
  patchRequest = controller;
  patchBusy.value = true;
  patchError.value = "";
  try {
    const latest = await props.services.materials.update(props.projectId, before.id, { ...fields, expected_version: before.version }, controller.signal);
    if (controller.signal.aborted) return false;
    selected.value = latest;
    emit("changed", latest);
    const previous = Object.fromEntries(Object.keys(fields).map((key) => [key, before[key as keyof Patch]])) as Patch;
    undoPatch.value = undo ? undefined : previous;
    notice.value = undo ? "已撤销上一步修改。" : describe(fields);
    undoLabel.value =
      fields.removed === true
        ? "撤销移出"
        : fields.linked === false
          ? "撤销解除关联"
          : fields.kind
            ? "撤销分类修改"
            : fields.name !== undefined
              ? "撤销重命名"
              : fields.source_note !== undefined
                ? "撤销来源修改"
                : "撤销恢复";
    if ("linked" in fields || "removed" in fields || "kind" in fields) void props.binding.loadOptions();
    return true;
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      mustReload.value = issue.status === 409 || issue.status === undefined || issue.status >= 500 || issue.code === "INVALID_RESPONSE";
      patchError.value = mustReload.value ? `${issue.message} 原件与解析版本不受影响；请载入最新资料后再修改。` : issue.message;
    }
    return false;
  } finally {
    if (!controller.signal.aborted) patchBusy.value = false;
  }
}
function describe(fields: Patch) {
  if (fields.removed === true) return "已移出当前目录；原件与历史保留，可勾选“显示已移出目录的资料”找回。";
  if (fields.linked === false) return "已解除项目关联；不能再用于新的来源绑定，已有绑定不受影响。";
  if (fields.linked === true || fields.removed === false) return "已恢复项目关联。";
  if (fields.kind) return `资料分类已改为「${materialCategories.find((item) => item.value === fields.kind)?.label ?? fields.kind}」。`;
  if (fields.name !== undefined) return "资料名称已保存；原件与解析版本保持不变。";
  return "资料来源已保存。";
}
async function reload() {
  const controller = new AbortController();
  patchRequest?.abort();
  patchRequest = controller;
  patchBusy.value = true;
  try {
    const latest = await props.services.materials.get(props.projectId, selected.value.id, controller.signal);
    if (!controller.signal.aborted) {
      selected.value = latest;
      emit("changed", latest);
      mustReload.value = false;
      patchError.value = "";
      undoPatch.value = undefined;
      notice.value = "已载入最新资料，请重新检查后再修改。";
    }
  } catch (problem) {
    if (!controller.signal.aborted) patchError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) patchBusy.value = false;
  }
}
async function startEdit(field: "name" | "source") {
  editing.value = field;
  draft.value = field === "name" ? selected.value.name : selected.value.source_note;
  patchError.value = "";
  await nextTick();
  editor.value?.focus();
  editor.value?.select();
}
async function saveEdit() {
  const field = editing.value;
  if (!field) return;
  const value = draft.value.trim();
  if (field === "name" && (!value || Array.from(value).length > 200)) {
    patchError.value = "资料名称需为 1 至 200 个字符。";
    return;
  }
  if (value === (field === "name" ? selected.value.name : selected.value.source_note)) {
    editing.value = "";
    return;
  }
  if (await patch(field === "name" ? { name: value } : { source_note: value })) editing.value = "";
}
function cancelEdit() {
  editing.value = "";
  patchError.value = "";
}

async function download() {
  if (!original.value || downloadBusy.value) return;
  const controller = new AbortController();
  downloadRequest = controller;
  downloadBusy.value = true;
  downloadError.value = "";
  const version = original.value;
  try {
    const blob = await props.services.materials.download(props.projectId, selected.value.id, version.id, controller.signal);
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
  if (!original.value || reparseBusy.value) return;
  if (!pendingReparse) {
    const expected = original.value.latest_parse_id;
    const scope =
      "thesispilot.pending-material-parse:" + JSON.stringify([props.services.sourceKey, props.projectId, selected.value.id, original.value.id, expected]);
    pendingReparse = { materialId: selected.value.id, originalId: original.value.id, expected, scope, key: beginJobRequest(scope) };
  }
  const command = pendingReparse;
  const controller = new AbortController();
  reparseRequest = controller;
  reparseBusy.value = true;
  reparseError.value = "";
  try {
    const job = await props.services.materials.reparse(
      props.projectId,
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
      attempts.value = [job, ...attempts.value.filter((item) => item.id !== job.id)];
      followLatest.value = true;
      notice.value = "已创建重新解析任务；当前解析版本保留到新结果完成。";
      undoPatch.value = undefined;
      if (jobOriginalId(job) === selected.value.current_original_id) emit("jobUpdated", selected.value, job);
    }
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      if (issue.status !== undefined && issue.status < 500 && issue.code !== "INVALID_RESPONSE") {
        confirmJobRequest(command.scope, command.key);
        pendingReparse = undefined;
      }
      reparseError.value = pendingReparse ? "创建结果未知，原解析版本不受影响；请再次点击以用原请求确认。" : issue.message;
    }
  } finally {
    if (!controller.signal.aborted) reparseBusy.value = false;
  }
}

function stop() {
  for (const request of [detailRequest, originalRequest, parseRequest, patchRequest, downloadRequest, reparseRequest]) request?.abort();
}
watch(
  () => props.material,
  (material) => {
    if (material.id === selected.value.id && material.version >= selected.value.version) selected.value = material;
  },
);
watch(
  () => props.preferredOriginal,
  (id) => {
    if (id && id !== original.value?.id) void inspect(id);
  },
);
void inspect(props.preferredOriginal);
onScopeDispose(() => {
  stop();
  for (const url of objectUrls) URL.revokeObjectURL(url);
});
defineExpose({ refresh: () => inspect(original.value?.id) });
</script>

<template>
  <div class="library-detail-content">
    <section class="library-paper" aria-label="资料摘要">
      <div class="library-paper-top">
        <p class="tp-label">{{ categoryName }}<template v-if="original"> · {{ materialExtension(original.filename) }}</template></p>
        <TpVersion v-if="original" :v="original.version" prefix="原件 " />
      </div>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <form v-if="editing === 'name'" key="edit" class="library-inline-edit" @submit.prevent="saveEdit" @keydown.esc.stop.prevent="cancelEdit">
          <input ref="editor" v-model="draft" class="tp-input" maxlength="200" aria-label="资料名称" :readonly="patchBusy" />
          <div class="screen-actions">
            <TpButton type="submit" size="sm" :loading="patchBusy">保存名称</TpButton>
            <TpButton size="sm" variant="ghost" :disabled="patchBusy" @click="cancelEdit">取消</TpButton>
          </div>
        </form>
        <h2 v-else key="title" class="library-paper-title">
          {{ selected.name
          }}<button type="button" class="library-edit-icon" aria-label="重命名资料" :disabled="patchBusy" @click="startEdit('name')">
            <TpIcon :icon="PhPencilSimple" :size="15" />
          </button>
        </h2>
      </Transition>
      <p v-if="original" class="library-paper-number">{{ original.filename }}</p>
      <p v-if="original" class="tp-caption">{{ materialSize(original.byte_size) }} · 收录于 {{ materialTime(original.created_at) }}</p>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <form v-if="editing === 'source'" key="edit" class="library-inline-edit" @submit.prevent="saveEdit" @keydown.esc.stop.prevent="cancelEdit">
          <input ref="editor" v-model="draft" class="tp-input" maxlength="4000" aria-label="资料来源" :readonly="patchBusy" />
          <div class="screen-actions">
            <TpButton type="submit" size="sm" :loading="patchBusy">保存来源</TpButton>
            <TpButton size="sm" variant="ghost" :disabled="patchBusy" @click="cancelEdit">取消</TpButton>
          </div>
        </form>
        <p v-else key="source" class="tp-caption library-source">
          <span><b>来源</b>{{ selected.source_note || "未填写" }}</span>
          <button type="button" class="library-edit-icon" aria-label="编辑资料来源" :disabled="patchBusy" @click="startEdit('source')">
            <TpIcon :icon="PhPencilSimple" :size="13" />
          </button>
        </p>
      </Transition>
    </section>

    <TpState v-if="detailError" kind="error" title="详情读取失败" :desc="`${detailError} 原件与解析版本保存在服务端。`" retryable @retry="inspect()" />
    <p v-if="loading && !original" class="tp-caption" role="status">正在读取原件与解析版本…</p>

    <MaterialParseTask
      v-if="original"
      :key="original.id"
      :services="services"
      :job="selectedJob"
      :summary="summary"
      :loading="originalBusy"
      @updated="updatedJob"
      @finished="finished"
      @open-job="emit('openJob', $event)"
    >
      <template #status
        ><span v-if="!isCurrent" class="tp-caption">历史原件 · 当前为最新版本以外的原件</span
        ><span v-else-if="parsed" class="tp-caption">解析 v{{ parsed.version }}</span></template
      >
      <template #actions
        ><TpButton size="sm" :disabled="downloadBusy" :loading="downloadBusy" @click="download">下载原件</TpButton
        ><TpButton v-if="!active && !retryable && original.file_type !== 'pdf'" size="sm" :disabled="reparseBusy" @click="reparse">重新解析</TpButton
        ><TpButton size="sm" :aria-expanded="historyOpen" @click="historyOpen = !historyOpen">版本记录</TpButton></template
      >
    </MaterialParseTask>
    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <p v-if="taskError" :key="taskError" role="alert" class="studio-notice">
        任务状态读取失败：{{ taskError }}<TpButton v-if="original" size="sm" @click="selectOriginal(original.id)">重新读取任务</TpButton>
      </p>
    </Transition>
    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <p v-if="downloadError" :key="downloadError" role="alert" class="studio-notice">下载失败：{{ downloadError }} 原件仍保存在服务端。</p>
    </Transition>
    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <p v-if="reparseError" :key="reparseError" role="alert" class="studio-notice">{{ reparseError }}</p>
    </Transition>

    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <div v-if="historyOpen" class="library-history" aria-label="版本记录" role="region">
        <h3 class="tp-subheading">原件版本</h3>
        <TransitionGroup name="tp-list" tag="div" class="library-history-list tp-list-group" v-bind="listMotionHooks">
          <button
            v-for="item in originals?.items ?? []"
            :key="item.id"
            type="button"
            :aria-pressed="original?.id === item.id"
            :disabled="originalBusy"
            @click="chooseOriginal(item.id)"
          >
            <b>原件 v{{ item.version }}{{ item.id === selected.current_original_id ? " · 当前" : "" }}</b>
            <span>{{ item.filename }} · {{ materialSize(item.byte_size) }} · {{ materialTime(item.created_at) }}</span>
          </button>
        </TransitionGroup>
        <div v-if="originals && originals.total > 20" class="screen-actions">
          <TpButton size="sm" :disabled="detailBusy || originals.offset === 0" @click="originalPage(Math.max(0, originals.offset - 20))">上一页原件</TpButton>
          <TpButton
            size="sm"
            :disabled="detailBusy || originals.offset + originals.items.length >= originals.total"
            @click="originalPage(originals.offset + 20)"
            >下一页原件</TpButton
          >
        </div>
        <template v-if="parses?.items.length">
          <h3 class="tp-subheading">解析版本</h3>
          <TransitionGroup name="tp-list" tag="div" class="library-history-list tp-list-group" v-bind="listMotionHooks">
            <button
              v-for="item in parses.items"
              :key="item.id"
              type="button"
              :aria-pressed="parsed?.id === item.id"
              :disabled="parseBusy"
              @click="chooseParse(item.id)"
            >
              <b>解析 v{{ item.version }} · {{ item.status === "complete" ? "解析完成" : "部分识别" }}</b><span>{{ materialTime(item.created_at) }}</span>
            </button>
          </TransitionGroup>
          <div v-if="parses.total > 20" class="screen-actions">
            <TpButton size="sm" :disabled="parseBusy || parses.offset === 0" @click="parsePage(Math.max(0, parses.offset - 20))">上一页解析</TpButton>
            <TpButton size="sm" :disabled="parseBusy || parses.offset + parses.items.length >= parses.total" @click="parsePage(parses.offset + 20)"
              >下一页解析</TpButton
            >
          </div>
        </template>
        <template v-if="attempts.length">
          <h3 class="tp-subheading">解析记录</h3>
          <TransitionGroup name="tp-list" tag="div" class="library-history-list tp-list-group" v-bind="listMotionHooks">
            <article v-for="(job, index) in attempts" :key="job.id">
              <b>第 {{ attempts.length - index }} 次 · {{ serviceJobStatus(job).label }}</b>
              <span>{{ materialTime(job.created_at) }}{{ job.source_job_id ? " · 重试" : "" }}{{ job.error_code ? ` · ${job.error_code}` : "" }}</span>
            </article>
          </TransitionGroup>
        </template>
        <details v-if="original" class="library-source-record tp-disclosure">
          <summary>原件校验</summary>
          <p class="library-digest tp-mono">SHA-256 {{ original.sha256 }}</p>
        </details>
      </div>
    </Transition>

    <div class="library-management">
      <TpField v-slot="{ id }" label="资料分类">
        <TpSelect
          :id="id"
          :model-value="selected.kind"
          :options="materialCategories"
          :disabled="patchBusy || mustReload"
          @update:model-value="(value) => value !== selected.kind && patch({ kind: value as MaterialKind })"
        />
      </TpField>
      <div class="screen-actions mt-3">
        <TpButton v-if="!available" size="sm" :disabled="patchBusy || mustReload" @click="patch({ linked: true, removed: false })">恢复关联</TpButton>
        <template v-else>
          <TpButton size="sm" :disabled="patchBusy || mustReload" @click="emit('append', selected)">新增原件版本</TpButton>
          <TpButton size="sm" variant="ghost" :disabled="patchBusy || mustReload" @click="patch({ linked: false })">解除项目关联</TpButton>
          <TpButton size="sm" variant="ghost" :disabled="patchBusy || mustReload" @click="patch({ removed: true })">移出当前目录</TpButton>
        </template>
      </div>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <p v-if="patchError" :key="patchError" role="alert" class="studio-notice mt-3">
          {{ patchError }}<TpButton v-if="mustReload" size="sm" :disabled="patchBusy" @click="reload">载入最新资料</TpButton>
        </p>
        <p v-else-if="notice" :key="notice" role="status" class="tp-caption mt-3">
          {{ notice }}<TpButton v-if="undoPatch" size="sm" variant="ghost" :disabled="patchBusy" @click="patch(undoPatch, true)">{{ undoLabel }}</TpButton>
        </p>
      </Transition>
    </div>

    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <p v-if="parseError" :key="parseError" role="alert" class="studio-notice">
        {{ parseError }}<TpButton v-if="original" size="sm" @click="selectOriginal(original.id)">重试读取解析</TpButton>
      </p>
    </Transition>
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
      ><MaterialParseResult v-if="parsed" :key="parsed.id" :parsed="parsed" :kind="selected.kind" :query="query" :binding="binding" :available="available" />
      <p v-else-if="original && !parseBusy && !originalBusy && !parseError" key="none" class="tp-caption">
        {{ active ? "解析完成后在这里查看提取结果。" : "这份原件还没有可读的解析版本；原件始终保留。" }}
      </p></Transition
    >
    <TpButton v-if="selected.kind === 'requirements' && !requirementsTab" block @click="emit('showRequirements')"
      >查看要求集绑定<TpIcon :icon="PhArrowRight" :size="15"
    /></TpButton>
  </div>
</template>

<style scoped>
.library-detail-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}
.library-paper {
  min-width: 0;
}
.library-paper-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--tp-text-muted);
}
.library-paper-title {
  overflow-wrap: anywhere;
  margin: 8px 0 16px;
  font-family: var(--tp-font-prose);
  font-size: 22px;
  line-height: 1.5;
  font-weight: 600;
  text-wrap: balance;
}
.library-paper-number {
  overflow-wrap: anywhere;
  margin: 0 0 4px;
  font-size: 13px;
  line-height: 1.6;
}
.library-source {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  overflow-wrap: anywhere;
  margin-top: 16px;
  color: var(--tp-text-muted);
}
.library-source > span {
  min-width: 0;
  flex: 1;
}
.library-source b {
  margin-right: 8px;
  color: var(--tp-text);
  font-weight: 500;
}
.library-edit-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  min-width: 28px;
  min-height: 28px;
  margin: -6px 0 -6px 4px;
  padding: 4px;
  color: var(--tp-text-muted);
  border-radius: var(--tp-radius-xs);
}
.library-edit-icon:hover:not(:disabled) {
  color: var(--tp-text);
  background: var(--tp-surface-sunken);
}
.library-edit-icon:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.library-inline-edit {
  display: grid;
  gap: 12px;
  margin: 8px 0 16px;
}
.library-inline-edit .tp-input {
  width: 100%;
  min-width: 0;
}
.library-detail-content > :deep(.material-task),
.library-history,
.library-management {
  padding-top: 20px;
  border-top: 1px solid var(--tp-line);
}
.library-history {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.library-history-list {
  display: grid;
}
.library-history button,
.library-history article {
  display: grid;
  gap: 4px;
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid var(--tp-line);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.library-history button:hover:not(:disabled) {
  background: var(--tp-surface-sunken);
}
.library-history button[aria-pressed="true"] {
  background: var(--tp-accent-soft);
  box-shadow: inset 2px 0 var(--tp-accent);
}
.library-history button:disabled {
  cursor: wait;
}
.library-history span {
  color: var(--tp-text-muted);
}
.library-source-record {
  padding-top: 4px;
  font-size: 12px;
}
.library-digest {
  margin-top: 12px;
  color: var(--tp-text-muted);
  overflow-wrap: anywhere;
  word-break: break-all;
}
.library-management {
  min-width: 0;
}
@media (max-width: 480px) {
  .library-paper-title {
    font-size: 20px;
  }
}
</style>
