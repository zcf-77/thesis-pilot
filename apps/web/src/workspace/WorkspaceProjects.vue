<script setup lang="ts">
import { nextTick, onMounted, onScopeDispose, ref, shallowRef } from "vue";
import { RouterLink } from "vue-router";
import { PhArrowRight, PhNotebook, PhPlus } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpState from "@/components/ui/TpState.vue";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { ProjectPage, ProjectRead, ProjectService } from "@/services";
import { asApiError } from "@/services/errors";
import { writingRoute } from "./workspaceRoutes";

const props = defineProps<{ projects: ProjectService; currentId?: string }>();
const emit = defineEmits<{ created: [project: ProjectRead] }>();
const limit = 20;
const page = shallowRef<ProjectPage>();
const listBusy = ref(true);
const listError = ref("");
const attemptedOffset = ref(0);
const formOpen = ref(false);
const createBusy = ref(false);
const name = ref("");
const nameError = ref("");
const createError = ref("");
const uncertain = ref(false);
const verifiedList = ref(false);
const input = ref<HTMLInputElement>();
const projectHeading = ref<HTMLElement>();
const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
let listRequest: AbortController | undefined;
let createRequest: AbortController | undefined;

async function load(offset = 0) {
  listRequest?.abort();
  const request = new AbortController();
  listRequest = request;
  attemptedOffset.value = offset;
  listBusy.value = true;
  listError.value = "";
  try {
    const result = await props.projects.list({ offset, limit }, request.signal);
    if (request.signal.aborted) return;
    page.value = result;
    if (uncertain.value && offset === 0) verifiedList.value = true;
  } catch (error) {
    if (!request.signal.aborted) listError.value = asApiError(error).message;
  } finally {
    if (!request.signal.aborted) listBusy.value = false;
  }
}

async function showCreate() {
  formOpen.value = true;
  await nextTick();
  input.value?.focus();
}

function cancelCreate(event?: KeyboardEvent) {
  if (createBusy.value || event?.isComposing) return;
  formOpen.value = false;
  name.value = "";
  nameError.value = "";
  createError.value = "";
  uncertain.value = false;
  verifiedList.value = false;
  void nextTick(() => projectHeading.value?.focus());
}

async function create() {
  if (createBusy.value || (uncertain.value && !verifiedList.value)) return;
  const value = name.value.trim();
  nameError.value = "";
  createError.value = "";
  if (!value || Array.from(value).length > 200) {
    nameError.value = "请输入 1 至 200 个字符的项目名称。";
    input.value?.focus();
    return;
  }

  const request = new AbortController();
  createRequest = request;
  createBusy.value = true;
  try {
    const project = await props.projects.create({ name: value }, request.signal);
    if (!request.signal.aborted) emit("created", project);
  } catch (error) {
    if (request.signal.aborted) return;
    const problem = asApiError(error);
    if (problem.status === undefined || problem.status >= 500 || problem.code === "INVALID_RESPONSE") {
      uncertain.value = true;
      verifiedList.value = false;
      createError.value = "创建结果尚未确认。请先在刷新后的项目列表中核对，再决定是否重新创建。";
      await load();
    } else createError.value = problem.message;
  } finally {
    if (!request.signal.aborted) createBusy.value = false;
  }
}

onMounted(() => void load());
onScopeDispose(() => {
  listRequest?.abort();
  createRequest?.abort();
});
</script>

<template>
  <Transition appear name="tp-page">
    <div class="screen-page workspace-page">
      <header class="screen-heading workspace-heading">
        <h1 ref="projectHeading" class="tp-display" tabindex="-1">论文项目</h1>
        <TpButton v-if="!formOpen && page?.items.length" variant="primary" @click="showCreate"><TpIcon :icon="PhPlus" />新建项目</TpButton>
      </header>

      <Transition name="tp-swap" v-bind="panelMotionHooks">
        <form v-if="formOpen" class="screen-panel studio-body studio-stack workspace-create" @submit.prevent="create" @keydown.esc.stop="cancelCreate">
          <TpField v-slot="{ id, invalid, describedby }" label="项目名称" :error="nameError">
            <input
              :id="id"
              ref="input"
              v-model="name"
              class="tp-input"
              :aria-invalid="invalid || undefined"
              :aria-describedby="invalid ? describedby : undefined"
              :readonly="createBusy"
              autocomplete="off"
              @input="nameError = ''"
            />
          </TpField>
          <Transition name="tp-swap">
            <p v-if="createError" :key="createError" role="alert" class="studio-notice">{{ createError }}</p>
          </Transition>
          <div class="screen-actions">
            <TpButton type="submit" variant="primary" :loading="createBusy" :disabled="createBusy || (uncertain && !verifiedList)">
              {{ createBusy ? "正在创建…" : uncertain ? "仍要创建" : "创建项目" }}
            </TpButton>
            <TpButton variant="ghost" :disabled="createBusy" @click="cancelCreate()">取消</TpButton>
          </div>
        </form>
      </Transition>

      <section class="screen-panel" aria-label="项目列表" :aria-busy="listBusy || undefined">
        <div v-if="listBusy && !page" class="studio-body workspace-loading" role="status"><span class="tp-btn__spinner" aria-hidden="true" />正在读取项目…</div>
        <TpState
          v-else-if="listError && (!page || page.total === 0)"
          kind="error"
          title="无法读取项目"
          :desc="listError"
          retryable
          @retry="load(attemptedOffset)"
        />
        <TpState v-else-if="page && page.total === 0" kind="empty" title="还没有论文项目" desc="创建项目后即可开始写作。">
          <TpButton v-if="!formOpen" variant="primary" @click="showCreate"><TpIcon :icon="PhPlus" />新建项目</TpButton>
        </TpState>
        <template v-else-if="page">
          <TransitionGroup name="tp-list" v-bind="listMotionHooks" tag="ul" class="workspace-project-list tp-list-group">
            <li v-for="project in page.items" :key="project.id">
              <RouterLink :to="writingRoute(project.id)" class="workspace-project-row">
                <span class="workspace-project-icon"><TpIcon :icon="PhNotebook" :size="20" /></span>
                <span class="workspace-project-detail">
                  <strong>{{ project.name }}</strong>
                  <time class="tp-caption" :datetime="project.created_at">{{ dateFormat.format(new Date(project.created_at)) }}创建</time>
                </span>
                <span v-if="project.id === currentId" class="tp-caption workspace-current">当前项目</span>
                <TpIcon :icon="PhArrowRight" class="workspace-project-arrow" />
              </RouterLink>
            </li>
          </TransitionGroup>
          <div v-if="page.total > limit || listError" class="workspace-pagination">
            <p v-if="listError" role="alert" class="tp-caption">{{ listError }}</p>
            <span v-else class="tp-caption" aria-live="polite">
              {{ listBusy ? "正在读取项目…" : `第 ${page.offset + 1}–${page.offset + page.items.length} 项，共 ${page.total} 项` }}
            </span>
            <div class="screen-actions">
              <TpButton v-if="listError" size="sm" @click="load(attemptedOffset)">重试</TpButton>
              <template v-else>
                <TpButton size="sm" :disabled="listBusy || page.offset === 0" @click="load(Math.max(0, page.offset - limit))">上一页</TpButton>
                <TpButton size="sm" :disabled="listBusy || page.offset + limit >= page.total" @click="load(page.offset + limit)">下一页</TpButton>
              </template>
            </div>
          </div>
        </template>
      </section>
    </div>
  </Transition>
</template>
