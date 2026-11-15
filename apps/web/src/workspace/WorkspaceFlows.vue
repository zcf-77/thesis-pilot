<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowRef } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import TpState from "@/components/ui/TpState.vue";
import type { ProjectFlowService } from "@/services";
import { asApiError } from "@/services/errors";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { cloneStages, flowDraftError, lines, newStage, removeStage, type LifecycleStage } from "./projectLifecycle";

const props = defineProps<{ projectFlows: ProjectFlowService }>();
type Flow = Awaited<ReturnType<ProjectFlowService["get"]>>;
type FlowVersion = Awaited<ReturnType<ProjectFlowService["version"]>>;
type VersionPage = Awaited<ReturnType<ProjectFlowService["versions"]>>;
const flows = shallowRef<Flow[]>([]);
const total = ref(0);
const offset = ref(0);
const listBusy = ref(false);
const listError = ref("");
const editorOpen = ref(false);
const base = shallowRef<Flow>();
const name = ref("");
const stages = ref<LifecycleStage[]>([]);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const mustReload = ref(false);
const uncertainCreate = ref(false);
const history = shallowRef<VersionPage>();
const historyBusy = ref(false);
const historyError = ref("");
const viewing = shallowRef<FlowVersion>();
const historyOptions = computed(
  () => history.value?.items.map((version) => ({ value: version.version, label: `v${version.version} · ${version.name}` })) ?? [],
);
let listRequest: AbortController | undefined;
let editRequest: AbortController | undefined;
let historyRequest: AbortController | undefined;

async function load(nextOffset = offset.value) {
  listRequest?.abort();
  const controller = new AbortController();
  listRequest = controller;
  listBusy.value = true;
  listError.value = "";
  try {
    const page = await props.projectFlows.list({ offset: nextOffset, limit: 20 }, controller.signal);
    if (controller.signal.aborted) return;
    flows.value = page.items;
    total.value = page.total;
    offset.value = page.offset;
  } catch (problem) {
    if (!controller.signal.aborted) listError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) listBusy.value = false;
  }
}

function open(flow?: Flow) {
  editRequest?.abort();
  historyRequest?.abort();
  busy.value = false;
  historyBusy.value = false;
  base.value = flow;
  name.value = flow?.name ?? "";
  stages.value = flow ? cloneStages(flow.stages) : [newStage()];
  error.value = "";
  notice.value = "";
  mustReload.value = false;
  uncertainCreate.value = false;
  history.value = undefined;
  viewing.value = undefined;
  historyError.value = "";
  editorOpen.value = true;
}

function close() {
  editRequest?.abort();
  historyRequest?.abort();
  busy.value = false;
  historyBusy.value = false;
  editorOpen.value = false;
  // A request may already have committed remotely. The next visit always refreshes.
  void load();
}

async function reload() {
  if (!base.value || busy.value) return;
  editRequest?.abort();
  const controller = new AbortController();
  editRequest = controller;
  busy.value = true;
  try {
    const flow = await props.projectFlows.get(base.value.id, controller.signal);
    if (controller.signal.aborted) return;
    open(flow);
    notice.value = "已载入最新流程，请重新检查后保存。";
    await load();
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

async function save(enabled?: boolean) {
  if (busy.value || mustReload.value || uncertainCreate.value) return;
  error.value = flowDraftError(name.value, stages.value);
  notice.value = "";
  if (error.value) return;
  const controller = new AbortController();
  editRequest = controller;
  busy.value = true;
  try {
    const input = { name: name.value.trim(), stages: cloneStages(stages.value).map((stage) => ({ ...stage, name: stage.name.trim() })) };
    const flow = base.value
      ? await props.projectFlows.update(
          base.value.id,
          { ...input, expected_version: base.value.version, ...(enabled === undefined ? {} : { enabled }) },
          controller.signal,
        )
      : await props.projectFlows.create(input, controller.signal);
    if (controller.signal.aborted) return;
    base.value = flow;
    name.value = flow.name;
    stages.value = cloneStages(flow.stages);
    history.value = undefined;
    viewing.value = undefined;
    notice.value =
      enabled === undefined
        ? `已保存为不可变版本 v${flow.version}；已有项目绑定保持原版本。`
        : flow.enabled
          ? "流程已启用，可建立新绑定。"
          : "流程已停用；旧项目绑定和历史版本保留。";
    await load();
  } catch (problem) {
    if (controller.signal.aborted) return;
    const issue = asApiError(problem);
    const unknown = issue.status === undefined || issue.status >= 500 || issue.code === "INVALID_RESPONSE";
    mustReload.value = !!base.value && (issue.status === 409 || unknown);
    uncertainCreate.value = !base.value && unknown;
    error.value = mustReload.value
      ? `${issue.message} 输入已保留，请先载入最新流程再重新编辑。`
      : uncertainCreate.value
        ? "创建结果未知，输入已保留。请刷新并核对流程列表，再决定是否再次创建。"
        : issue.message;
    if (uncertainCreate.value) await load(0);
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

async function loadHistory(nextOffset = 0) {
  if (!base.value) return;
  historyRequest?.abort();
  const controller = new AbortController();
  historyRequest = controller;
  historyBusy.value = true;
  historyError.value = "";
  try {
    const page = await props.projectFlows.versions(base.value.id, { offset: nextOffset, limit: 20 }, controller.signal);
    if (controller.signal.aborted) return;
    history.value = page;
    viewing.value = page.items[0];
  } catch (problem) {
    if (!controller.signal.aborted) historyError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) historyBusy.value = false;
  }
}

async function viewVersion(version: number) {
  if (!base.value) return;
  historyRequest?.abort();
  const controller = new AbortController();
  historyRequest = controller;
  historyBusy.value = true;
  historyError.value = "";
  try {
    const result = await props.projectFlows.version(base.value.id, version, controller.signal);
    if (!controller.signal.aborted) viewing.value = result;
  } catch (problem) {
    if (!controller.signal.aborted) historyError.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) historyBusy.value = false;
  }
}

function setDependency(stage: LifecycleStage, id: string, enabled: boolean) {
  stage.dependencies = enabled ? [...new Set([...stage.dependencies, id])] : stage.dependencies.filter((value) => value !== id);
}
function text(event: Event) {
  return (event.target as HTMLTextAreaElement).value;
}
onMounted(() => void load(0));
onScopeDispose(() => {
  listRequest?.abort();
  editRequest?.abort();
  historyRequest?.abort();
});
</script>

<template>
  <Transition appear name="tp-page">
    <div class="screen-page workspace-page studio-stack">
      <header class="screen-heading workspace-heading">
        <div>
          <h1 class="tp-display">项目流程</h1>
          <p class="tp-caption">配置可复用流程；每次保存生成新版本，项目明确绑定版本与当前位置。</p>
        </div>
        <TpButton v-if="!editorOpen" variant="primary" @click="open()">新建流程</TpButton>
      </header>
      <section class="screen-panel studio-body studio-stack" aria-label="流程列表" :aria-busy="listBusy || undefined">
        <p v-if="listBusy" role="status" class="tp-caption">正在读取流程…</p>
        <TpState v-if="listError && !flows.length" kind="error" title="无法读取流程" :desc="listError" retryable @retry="load()" />
        <TpState v-else-if="!listBusy && !flows.length" kind="empty" title="还没有项目流程" desc="创建阶段、交付物与前置条件，再将明确版本绑定到项目。"
          ><TpButton v-if="!editorOpen" variant="primary" @click="open()">新建流程</TpButton></TpState
        >
        <TransitionGroup name="tp-list" v-bind="listMotionHooks" tag="ul" class="flow-list tp-list-group">
          <li v-for="flow in flows" :key="flow.id" class="flow-row">
            <div>
              <strong>{{ flow.name }}</strong>
              <p class="tp-caption">v{{ flow.version }} · {{ flow.stages.length }} 个阶段 · {{ flow.enabled ? "启用中" : "已停用" }}</p>
            </div>
            <TpButton size="sm" :disabled="busy" @click="open(flow)">管理流程</TpButton>
          </li>
        </TransitionGroup>
        <p v-if="listError && flows.length" role="alert" class="studio-notice">{{ listError }}</p>
        <div v-if="total > 20 || listError" class="screen-actions">
          <TpButton v-if="listError" size="sm" @click="load()">重试列表</TpButton
          ><TpButton size="sm" :disabled="listBusy || offset === 0" @click="load(Math.max(0, offset - 20))">上一页流程</TpButton
          ><TpButton size="sm" :disabled="listBusy || offset + flows.length >= total" @click="load(offset + 20)">下一页流程</TpButton>
        </div>
      </section>
      <Transition name="tp-swap" v-bind="panelMotionHooks">
        <section v-if="editorOpen" class="screen-panel studio-body studio-stack" aria-label="流程编辑" @keydown.esc.stop="close">
          <div class="flow-row">
            <h2 class="tp-heading">{{ base ? `编辑流程 · v${base.version}` : "创建流程" }}</h2>
            <TpButton variant="ghost" size="sm" @click="close">关闭流程编辑</TpButton>
          </div>
          <form class="studio-stack" @submit.prevent="save()">
            <fieldset :disabled="busy" class="flow-fieldset studio-stack">
              <TpField v-slot="{ id }" label="流程名称" required><input :id="id" v-model="name" class="tp-input" required maxlength="200" /></TpField>
              <TransitionGroup name="tp-list" v-bind="listMotionHooks" tag="div" class="studio-stack tp-list-group">
                <article v-for="(stage, index) in stages" :key="stage.id" class="flow-stage studio-stack" :aria-label="`阶段 ${index + 1}`">
                  <div class="flow-row">
                    <h3 class="tp-heading">阶段 {{ index + 1 }}</h3>
                    <TpButton size="sm" variant="ghost" :disabled="busy" @click="stages = removeStage(stages, stage.id)">移除阶段 {{ index + 1 }}</TpButton>
                  </div>
                  <div class="flow-grid">
                    <TpField v-slot="{ id }" label="阶段名称" required
                      ><input :id="id" v-model="stage.name" class="tp-input" maxlength="200" required
                    /></TpField>
                    <TpField v-slot="{ id }" label="阶段状态"
                      ><TpSelect
                        :id="id"
                        :model-value="stage.enabled ? 'enabled' : 'disabled'"
                        :disabled="busy"
                        :options="[
                          { value: 'enabled', label: '启用' },
                          { value: 'disabled', label: '停用' },
                        ]"
                        @update:model-value="stage.enabled = $event === 'enabled'"
                    /></TpField>
                    <TpField v-slot="{ id }" label="开始日期" optional
                      ><TpDatePicker :id="id" :model-value="stage.start ?? ''" :disabled="busy" @update:model-value="stage.start = $event || null"
                    /></TpField>
                    <TpField v-slot="{ id }" label="阶段截止日期" optional
                      ><TpDatePicker :id="id" :model-value="stage.deadline ?? ''" :disabled="busy" @update:model-value="stage.deadline = $event || null"
                    /></TpField>
                    <TpField v-slot="{ id }" label="阶段说明"><textarea :id="id" v-model="stage.description" class="tp-input" rows="2" /></TpField>
                    <TpField v-slot="{ id }" label="交付物" hint="每行一项。">
                      <textarea :id="id" :value="stage.deliverables.join('\n')" class="tp-input" rows="2" @change="stage.deliverables = lines(text($event))" />
                    </TpField>
                    <TpField v-slot="{ id }" label="阶段条件" hint="每行一项；记录要求，不自动标记完成。">
                      <textarea :id="id" :value="stage.conditions.join('\n')" class="tp-input" rows="2" @change="stage.conditions = lines(text($event))" />
                    </TpField>
                    <fieldset class="flow-fieldset studio-stack">
                      <legend class="tp-caption">前置依赖</legend>
                      <label v-for="candidate in stages.filter((item) => item.id !== stage.id)" :key="candidate.id" class="flow-check"
                        ><input
                          type="checkbox"
                          class="checkbox checkbox-sm"
                          :checked="stage.dependencies.includes(candidate.id)"
                          :disabled="busy"
                          @change="setDependency(stage, candidate.id, ($event.target as HTMLInputElement).checked)"
                        /><span>{{ candidate.name || "未命名阶段" }}</span></label
                      ><span v-if="stages.length < 2" class="tp-caption">添加其他阶段后可选择前置依赖。</span>
                    </fieldset>
                  </div>
                </article>
              </TransitionGroup>
              <TpButton :disabled="busy" @click="stages.push(newStage())">添加阶段</TpButton>
            </fieldset>
            <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="error" :key="error" class="studio-notice" role="alert">{{ error }}</p></Transition>
            <p v-if="notice" role="status" class="tp-caption">{{ notice }}</p>
            <div class="screen-actions">
              <TpButton type="submit" variant="primary" :loading="busy" :disabled="busy || mustReload || uncertainCreate">{{
                base ? "保存新版本" : "创建流程"
              }}</TpButton
              ><TpButton v-if="base" :disabled="busy || mustReload" @click="save(!base.enabled)">{{ base.enabled ? "停用流程" : "启用流程" }}</TpButton
              ><TpButton v-if="mustReload" :disabled="busy" @click="reload">载入最新流程</TpButton
              ><TpButton v-if="uncertainCreate" :disabled="busy || listBusy" @click="load(0)">刷新流程列表</TpButton
              ><TpButton
                v-if="uncertainCreate"
                :disabled="busy || listBusy || !!listError"
                @click="
                  uncertainCreate = false;
                  error = '';
                "
                >已核对列表，继续创建</TpButton
              ><TpButton variant="ghost" @click="close">取消</TpButton>
            </div>
          </form>
          <div v-if="base" class="studio-stack">
            <div class="screen-actions">
              <TpButton :disabled="busy || historyBusy" @click="loadHistory()">查看历史版本</TpButton
              ><span v-if="historyBusy" class="tp-caption" role="status">正在读取历史…</span>
            </div>
            <p v-if="historyError" role="alert" class="studio-notice">
              {{ historyError }}<TpButton size="sm" @click="loadHistory(history?.offset ?? 0)">重试历史</TpButton>
            </p>
            <Transition name="tp-swap" v-bind="panelMotionHooks"
              ><section v-if="history" class="flow-stage studio-stack" aria-label="历史版本（只读）">
                <TpField v-slot="{ id }" label="历史版本（只读）"
                  ><TpSelect :id="id" :model-value="viewing?.version" :options="historyOptions" :disabled="historyBusy" @update:model-value="viewVersion"
                /></TpField>
                <div v-if="viewing" :key="viewing.id" class="studio-stack">
                  <p class="tp-caption">{{ viewing.name }} · v{{ viewing.version }} · {{ viewing.created_at }}</p>
                  <article v-for="stage in viewing.stages" :key="stage.id" class="flow-history-stage">
                    <strong>{{ stage.name }} · {{ stage.enabled === false ? "停用" : "启用" }}</strong>
                    <p>{{ stage.description }}</p>
                    <p class="tp-caption">交付物：{{ stage.deliverables.join("、") || "未设置" }}</p>
                    <p class="tp-caption">条件：{{ stage.conditions.join("、") || "未设置" }}</p>
                    <p class="tp-caption">
                      前置：{{ (stage.dependencies ?? []).map((id) => viewing?.stages.find((item) => item.id === id)?.name ?? id).join("、") || "无" }} ·
                      {{ stage.start || "未设开始日期" }} → {{ stage.deadline || "未设截止日期" }}
                    </p>
                  </article>
                </div>
                <div v-if="history.total > 20" class="screen-actions">
                  <TpButton size="sm" :disabled="historyBusy || history.offset === 0" @click="loadHistory(Math.max(0, history.offset - 20))"
                    >上一页版本</TpButton
                  ><TpButton
                    size="sm"
                    :disabled="historyBusy || history.offset + history.items.length >= history.total"
                    @click="loadHistory(history.offset + 20)"
                    >下一页版本</TpButton
                  >
                </div>
              </section></Transition
            >
          </div>
        </section>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.flow-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.flow-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.flow-list .flow-row {
  padding: 14px 0;
  border-bottom: 1px solid var(--tp-line);
}
.flow-stage {
  padding: 20px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-m);
  background: var(--tp-surface-sunken);
}
.flow-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.flow-fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.flow-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.flow-history-stage {
  border-top: 1px solid var(--tp-line);
  padding-top: 12px;
  overflow-wrap: anywhere;
}
textarea {
  width: 100%;
  resize: vertical;
}
@media (max-width: 700px) {
  .flow-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
