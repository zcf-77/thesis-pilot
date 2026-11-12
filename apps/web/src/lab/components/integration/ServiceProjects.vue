<script setup lang="ts">
import { onMounted, onScopeDispose, ref } from "vue";
import { useRouter } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import { ApiError, type BackendServices, type ProjectRead } from "@/services";
import { usePreviewWorkspaceStore } from "../../state/previewWorkspace";
import { panelMotionHooks } from "./motion";

const props = defineProps<{ services: BackendServices; sourceLabel: string }>();
const workspace = usePreviewWorkspaceStore();
const router = useRouter();
const projects = ref<ProjectRead[]>([]);
const total = ref(0);
const offset = ref(0);
const limit = 12;
const loading = ref(false);
const loadError = ref("");
const actionError = ref("");
const notice = ref("");
const formOpen = ref(false);
const editing = ref<ProjectRead | null>(null);
const name = ref("");
const formError = ref("");
const conflict = ref(false);
const uncertain = ref(false);
const saving = ref(false);
const openingId = ref("");
const detail = ref<ProjectRead | null>(null);
const detailLoading = ref(false);
let alive = true;
let listSequence = 0;
let actionSequence = 0;
let formSequence = 0;
let listRequest: AbortController | undefined;
let actionRequest: AbortController | undefined;
let formRequest: AbortController | undefined;

function message(error: unknown) {
  return error instanceof ApiError ? error.message : "操作暂时无法完成，请稍后重试；本机资料保持不变。";
}
function cancelled(error: unknown) {
  return error instanceof ApiError && error.code === "REQUEST_CANCELLED";
}
function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN");
}
async function load(nextOffset = offset.value) {
  const sequence = ++listSequence;
  listRequest?.abort();
  const request = (listRequest = new AbortController());
  loading.value = true;
  loadError.value = "";
  try {
    const page = await props.services.projects.list({ limit, offset: nextOffset }, request.signal);
    if (!alive || sequence !== listSequence) return;
    projects.value = page.items;
    total.value = page.total;
    offset.value = page.offset;
  } catch (error) {
    if (alive && sequence === listSequence && !cancelled(error)) loadError.value = message(error);
  } finally {
    if (alive && sequence === listSequence) loading.value = false;
  }
}
function openForm(project?: ProjectRead) {
  if (saving.value) return;
  stopRead();
  formSequence += 1;
  formRequest?.abort();
  editing.value = project ?? null;
  name.value = project?.name ?? "";
  formError.value = "";
  conflict.value = false;
  uncertain.value = false;
  notice.value = "";
  formOpen.value = true;
}
function closeForm() {
  if (saving.value) return;
  formSequence += 1;
  formRequest?.abort();
  formOpen.value = false;
}
async function save() {
  if (saving.value || conflict.value || uncertain.value) return;
  const value = name.value.trim();
  if (!value || value.length > 200) {
    formError.value = "请填写 1—200 字的项目名称。";
    return;
  }
  const base = editing.value;
  const sequence = ++formSequence;
  const request = (formRequest = new AbortController());
  saving.value = true;
  formError.value = "";
  try {
    const result = base
      ? await props.services.projects.update(base.id, { name: value, expected_version: base.version }, request.signal)
      : await props.services.projects.create({ name: value }, request.signal);
    if (!alive || sequence !== formSequence) return;
    stopRead();
    formOpen.value = false;
    detail.value = result;
    notice.value = "项目名称已保存。正文、规划与资料仍保存在当前浏览器。";
    await load(base ? offset.value : 0);
  } catch (error) {
    if (!alive || sequence !== formSequence) return;
    conflict.value = error instanceof ApiError && error.status === 409;
    uncertain.value =
      error instanceof ApiError &&
      (["REQUEST_TIMEOUT", "NETWORK_ERROR", "REQUEST_CANCELLED", "INVALID_RESPONSE"].includes(error.code) || (error.status ?? 0) >= 500);
    formError.value = uncertain.value ? "连接中断，名称是否保存尚待核对。输入已保留，请先查看项目目录，避免重复新建。" : message(error);
  } finally {
    if (alive && sequence === formSequence) saving.value = false;
  }
}
async function reloadBase() {
  const base = editing.value;
  if (!base || saving.value) return;
  const sequence = ++formSequence;
  const request = (formRequest = new AbortController());
  saving.value = true;
  try {
    const latest = await props.services.projects.get(base.id, request.signal);
    if (!alive || sequence !== formSequence) return;
    editing.value = latest;
    conflict.value = false;
    formError.value = `最新名称为「${latest.name}」（v${latest.version}）。你的输入已保留，请核对后再次保存。`;
    await load();
  } catch (error) {
    if (alive && sequence === formSequence && !cancelled(error)) formError.value = message(error);
  } finally {
    if (alive && sequence === formSequence) saving.value = false;
  }
}
async function inspect(project: ProjectRead, openWorkspace = false) {
  const sequence = ++actionSequence;
  actionRequest?.abort();
  const request = (actionRequest = new AbortController());
  actionError.value = "";
  openingId.value = openWorkspace ? project.id : "";
  detailLoading.value = !openWorkspace;
  try {
    const latest = await props.services.projects.get(project.id, request.signal);
    if (!alive || sequence !== actionSequence) return;
    detail.value = latest;
    if (openWorkspace) {
      workspace.openServiceProject(latest, props.services.sourceKey);
      await router.push("/screens/write");
    }
  } catch (error) {
    if (alive && sequence === actionSequence && !cancelled(error)) actionError.value = message(error);
  } finally {
    if (alive && sequence === actionSequence) {
      openingId.value = "";
      detailLoading.value = false;
    }
  }
}
function stopRead() {
  actionSequence += 1;
  actionRequest?.abort();
  detailLoading.value = false;
  openingId.value = "";
}
onMounted(() => void load(0));
onScopeDispose(() => {
  alive = false;
  listSequence += 1;
  actionSequence += 1;
  formSequence += 1;
  listRequest?.abort();
  actionRequest?.abort();
  formRequest?.abort();
});
</script>

<template>
  <div class="screen-page" data-testid="service-projects">
    <header class="screen-heading">
      <div>
        <p class="tp-label">Projects · {{ sourceLabel }}</p>
        <h1 class="tp-display mt-3">论文项目</h1>
        <p class="screen-lead">项目名称由当前服务保存；打开后继续使用本机的论文工作区。</p>
      </div>
      <TpButton variant="primary" :disabled="saving" @click="openForm()">新建项目</TpButton>
    </header>
    <p class="studio-notice">当前接入范围：项目名称与诊断任务。截止日期、阶段、规划、正文和资料仍保存在当前浏览器。</p>
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <p v-if="notice" :key="notice" role="status" class="studio-notice">{{ notice }}</p>
    </Transition>
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <form v-if="formOpen" :key="editing?.id ?? 'new'" class="screen-panel studio-body studio-stack" @submit.prevent="save" @keydown.esc="closeForm">
        <h2 class="tp-subheading">{{ editing ? "修改项目名称" : "新建项目" }}</h2>
        <TpField v-slot="{ id, invalid, describedby }" label="项目名称" required :error="formError">
          <input
            :id="id"
            v-model="name"
            class="tp-input"
            maxlength="200"
            :disabled="saving"
            :aria-invalid="invalid"
            :aria-describedby="describedby"
            autofocus
          />
        </TpField>
        <p v-if="editing" class="tp-caption">项目元数据 v{{ editing.version }}，与论文正文版本分别管理。</p>
        <div class="screen-actions">
          <TpButton type="submit" variant="primary" :loading="saving" :disabled="saving || conflict || uncertain">保存名称</TpButton>
          <TpButton v-if="conflict" :disabled="saving" @click="reloadBase">读取最新版本</TpButton>
          <TpButton v-if="uncertain" :loading="loading" @click="load(0)">刷新目录核对</TpButton>
          <TpButton
            v-if="uncertain"
            variant="ghost"
            @click="
              uncertain = false;
              formError = '';
            "
            >已核对，继续编辑</TpButton
          >
          <TpButton variant="ghost" :disabled="saving" @click="closeForm">取消</TpButton>
        </div>
      </form>
    </Transition>
    <div class="screen-actions">
      <TpButton :loading="loading" @click="load()">刷新项目</TpButton>
      <p class="tp-caption" aria-live="polite">{{ loading ? "正在读取项目…" : `共 ${total} 个项目` }}</p>
    </div>
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <TpState v-if="loadError" :key="loadError" kind="error" title="项目目录暂时无法读取" :desc="loadError" retryable @retry="load()" />
    </Transition>
    <TransitionGroup name="tp-list" tag="div" v-bind="listMotionHooks" class="tp-list-group studio-grid">
      <article v-for="project in projects" :key="project.id" class="screen-panel studio-body studio-stack" data-testid="service-project-card">
        <div class="studio-row"><span class="tp-label">{{ sourceLabel }}</span><TpStatus tone="neutral" :label="`名称 v${project.version}`" /></div>
        <h2 class="tp-title">{{ project.name }}</h2>
        <p class="tp-caption">更新于 {{ formatTime(project.updated_at) }}</p>
        <div class="screen-actions">
          <TpButton variant="primary" :loading="openingId === project.id" :disabled="!!openingId || saving" @click="inspect(project, true)"
            >打开工作区</TpButton
          >
          <TpButton :disabled="saving" @click="openForm(project)">修改名称</TpButton>
          <TpButton variant="ghost" @click="inspect(project)">查看详情</TpButton>
        </div>
      </article>
    </TransitionGroup>
    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <TpState v-if="!loading && !loadError && !projects.length" kind="empty" title="这里还没有项目" desc="先新建项目名称，再打开本机工作区开始写作。" />
    </Transition>
    <nav v-if="total > limit" class="screen-actions" aria-label="项目分页">
      <TpButton :disabled="loading || offset === 0" @click="load(Math.max(0, offset - limit))">上一页</TpButton>
      <span class="tp-caption">第 {{ Math.floor(offset / limit) + 1 }} 页</span>
      <TpButton :disabled="loading || offset + limit >= total" @click="load(offset + limit)">下一页</TpButton>
    </nav>
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <p v-if="actionError" :key="actionError" role="alert" class="studio-notice">{{ actionError }}</p>
    </Transition>
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <section v-if="detailLoading" key="loading-detail" class="screen-panel studio-body screen-actions" aria-live="polite">
        <span>正在读取项目详情…</span><TpButton size="sm" variant="ghost" @click="stopRead">取消读取</TpButton>
      </section>
      <section v-else-if="detail" :key="detail.id" class="screen-panel studio-body studio-stack">
        <div class="studio-row">
          <h2 class="tp-subheading">项目详情</h2>
          <TpButton variant="ghost" size="sm" @click="detail = null">收起详情</TpButton>
        </div>
        <dl class="studio-facts service-facts">
          <dt>名称</dt>
          <dd>{{ detail.name }}</dd>
          <dt>项目标识</dt>
          <dd class="tp-mono">{{ detail.id }}</dd>
          <dt>名称版本</dt>
          <dd>v{{ detail.version }}</dd>
          <dt>创建时间</dt>
          <dd>{{ formatTime(detail.created_at) }}</dd>
          <dt>更新时间</dt>
          <dd>{{ formatTime(detail.updated_at) }}</dd>
        </dl>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.service-facts dd {
  overflow-wrap: anywhere;
}
</style>
