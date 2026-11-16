<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, reactive, ref, shallowRef, watch } from "vue";
import { PhPlus } from "@phosphor-icons/vue";
import { useRoute, useRouter } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import TpState from "@/components/ui/TpState.vue";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { BackendServices, ProjectRead, ProjectService, ProjectFlowService } from "@/services";
import { asApiError } from "@/services/errors";
import { useBackendServices } from "@/services/runtime";
import WorkspaceProjectSettings from "./WorkspaceProjectSettings.vue";
import ProjectCard from "./projects/ProjectCard.vue";
import ProjectSetupWizard from "./projects/ProjectSetupWizard.vue";
import { loadFlowCatalog, readAll } from "./projects/flowCatalog";
import { useProjectFacts, type Catalog } from "./projects/projectFacts";
import { projectsLink, projectsLinkKeys, projectsRoute, type ProjectsLink } from "./workspaceRoutes";

const props = defineProps<{ projects: ProjectService; projectFlows: ProjectFlowService; currentId?: string; services?: BackendServices }>();
const emit = defineEmits<{ created: [project: ProjectRead] }>();
const backend = (props.services ?? useBackendServices().services)!;
const all = shallowRef<ProjectRead[]>();
const listBusy = ref(true);
const listError = ref("");
const view = ref<"active" | "archived">("active");
const panel = shallowRef<{ kind: "create" } | { kind: "edit"; project: ProjectRead }>();
const catalog = shallowRef<Catalog>({ state: "loading" });
const pending = reactive(new Set<string>());
const actionError = ref("");
const undo = shallowRef<{ project: ProjectRead; archived: boolean }>();
const heading = ref<HTMLElement>();
const wizard = ref<InstanceType<typeof ProjectSetupWizard>>();
const { facts, load: loadFacts } = useProjectFacts(backend);
const listed = computed(() => all.value?.filter((project) => project.archived === (view.value === "archived")) ?? []);
const viewOptions = [
  { value: "active" as const, label: "进行中的项目" },
  { value: "archived" as const, label: "归档项目" },
];
const route = useRoute();
const router = useRouter();
const link = shallowRef<ProjectsLink>();
let listRequest: AbortController | undefined;
let catalogRequest: AbortController | undefined;
let linkRequest: AbortController | undefined;

/** The API has no archived filter, so the full directory is read before either view can be reported as empty. */
async function load() {
  listRequest?.abort();
  const request = new AbortController();
  listRequest = request;
  listBusy.value = true;
  listError.value = "";
  try {
    const items = await readAll((query) => props.projects.list(query, request.signal), request.signal);
    if (!request.signal.aborted) all.value = items;
  } catch (error) {
    if (!request.signal.aborted) listError.value = asApiError(error).message;
  } finally {
    if (!request.signal.aborted) listBusy.value = false;
  }
}

async function loadCatalog() {
  catalogRequest?.abort();
  const request = new AbortController();
  catalogRequest = request;
  catalog.value = { state: "loading" };
  try {
    const { versions } = await loadFlowCatalog(props.projectFlows, request.signal);
    if (!request.signal.aborted) catalog.value = { state: "ready", versions };
  } catch {
    if (!request.signal.aborted) catalog.value = { state: "failed" };
  }
}

function replace(project: ProjectRead) {
  const items = all.value ?? [];
  all.value = items.some((item) => item.id === project.id) ? items.map((item) => (item.id === project.id ? project : item)) : [project, ...items];
}

async function showCreate() {
  if (panel.value?.kind !== "create") panel.value = { kind: "create" };
  await nextTick();
  wizard.value?.focus();
}

function closePanel(reload = false) {
  const editing = panel.value?.kind === "edit" ? panel.value.project : undefined;
  panel.value = undefined;
  if (reload) void load();
  if (editing?.flow_version_id) void loadCatalog();
  void nextTick(() => heading.value?.focus());
}

function edited(project: ProjectRead) {
  replace(project);
  if (panel.value?.kind === "edit") panel.value = { kind: "edit", project };
}

async function setArchived(project: ProjectRead, archived: boolean, fromUndo = false) {
  if (pending.has(project.id)) return;
  const latest = all.value?.find((item) => item.id === project.id) ?? project;
  pending.add(project.id);
  actionError.value = "";
  if (!fromUndo) undo.value = undefined;
  try {
    const saved = await props.projects.update(project.id, { archived, expected_version: latest.version });
    replace(saved);
    undo.value = fromUndo ? undefined : { project: saved, archived };
    if (panel.value?.kind === "edit" && panel.value.project.id === saved.id) panel.value = undefined;
  } catch (error) {
    const issue = asApiError(error);
    actionError.value =
      issue.status === 409
        ? `“${project.name}”已在其他地方更新，项目未改变。已重新读取项目列表，请再试一次。`
        : `${archived ? "归档" : "恢复"}“${project.name}”未完成，项目保持原状。${issue.message}`;
    if (issue.status === 409) void load();
  } finally {
    pending.delete(project.id);
  }
}

/** 外壳链接（?create=1 / ?settings=<id>）只触发一次：读出后立即从地址移除，无效参数忽略。 */
function takeLink() {
  if (route.name !== projectsRoute.name || !projectsLinkKeys.some((key) => key in route.query)) return;
  link.value = projectsLink(route.query) ?? link.value;
  const query = { ...route.query };
  for (const key of projectsLinkKeys) delete query[key];
  void router.replace({ ...projectsRoute, query });
}
/** 设置链接按服务端最新项目打开，避免用目录缓存的旧版本编辑；不存在或读取失败的链接忽略。 */
async function applyLink() {
  const target = link.value;
  if (!target) return;
  link.value = undefined;
  linkRequest?.abort();
  if (target.kind === "create") {
    void showCreate();
    return;
  }
  const request = new AbortController();
  linkRequest = request;
  try {
    const project = await props.projects.get(target.projectId, request.signal);
    if (request.signal.aborted || project.id.toLowerCase() !== target.projectId) return;
    if (all.value) replace(project);
    view.value = project.archived ? "archived" : "active";
    panel.value = { kind: "edit", project };
  } catch {
    /* 链接指向的项目不可用时保持目录原状。 */
  }
}

watch(() => route.query, takeLink, { immediate: true });
watch(link, applyLink, { immediate: true });
watch(listed, (items) => items.forEach((project) => loadFacts(project.id)));
onMounted(() => {
  void load();
  void loadCatalog();
});
onScopeDispose(() => {
  listRequest?.abort();
  catalogRequest?.abort();
  linkRequest?.abort();
});
</script>

<template>
  <Transition appear name="tp-page">
    <div class="screen-page workspace-page">
      <header class="screen-heading">
        <div>
          <p class="tp-label">Projects · 每一程，都有来处</p>
          <h1 ref="heading" class="tp-display mt-3" tabindex="-1">论文项目</h1>
          <p class="screen-lead">从一张白纸开始，或带着已有的积累继续。</p>
        </div>
        <div class="screen-actions">
          <TpButton variant="primary" @click="showCreate"><TpIcon :icon="PhPlus" />新建项目</TpButton>
        </div>
      </header>

      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <ProjectSetupWizard
          v-if="panel?.kind === 'create'"
          key="create"
          ref="wizard"
          :services="backend"
          @persisted="replace"
          @done="emit('created', $event)"
          @close="closePanel(true)"
        />
        <WorkspaceProjectSettings
          v-else-if="panel?.kind === 'edit'"
          :key="panel.project.id"
          :project="panel.project"
          :projects="projects"
          :project-flows="projectFlows"
          @updated="edited"
          @close="closePanel()"
        />
      </Transition>

      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <p v-if="actionError" :key="actionError" role="alert" class="studio-notice">{{ actionError }}</p>
        <div v-else-if="undo" :key="undo.project.id + undo.archived" role="status" class="studio-notice screen-actions project-undo">
          <span>{{ undo.archived ? `已归档“${undo.project.name}”，正文与版本记录继续保留。` : `已恢复“${undo.project.name}”。` }}</span>
          <TpButton size="sm" variant="ghost" :disabled="pending.has(undo.project.id)" @click="setArchived(undo.project, !undo.archived, true)">撤销</TpButton>
        </div>
      </Transition>

      <div v-if="all?.length" class="screen-actions">
        <TpSegmented v-model="view" :options="viewOptions" label="项目范围" />
      </div>

      <section aria-label="项目列表" :aria-busy="listBusy || undefined">
        <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
          <div v-if="listBusy && !all" key="loading" class="screen-panel studio-body workspace-loading" role="status">
            <span class="tp-btn__spinner" aria-hidden="true" />正在读取项目…
          </div>
          <TpState v-else-if="listError && !all" key="error" class="screen-panel" kind="error" title="无法读取项目" :desc="listError" retryable @retry="load" />
          <section v-else-if="all && !all.length" key="empty" class="studio-empty">
            <h2 class="tp-subheading">还没有论文项目</h2>
            <p class="tp-caption mt-3">新建项目后，按步骤选择流程、规划与正文起点。</p>
          </section>
          <div v-else key="list" class="studio-stack">
            <p v-if="listError" role="alert" class="studio-notice screen-actions">
              {{ listError }}<TpButton size="sm" :disabled="listBusy" @click="load">重新读取项目</TpButton>
            </p>
            <TransitionGroup name="tp-list" tag="div" v-bind="listMotionHooks" class="tp-list-group studio-grid project-grid">
              <ProjectCard
                v-for="project in listed"
                :key="project.id"
                :project="project"
                :current="project.id === currentId"
                :catalog="catalog"
                :facts="facts.get(project.id)"
                :busy="pending.has(project.id)"
                :editing="panel?.kind === 'edit' && panel.project.id === project.id"
                @edit="panel = { kind: 'edit', project }"
                @archive="setArchived(project, $event)"
              />
            </TransitionGroup>
            <Transition name="tp-swap" v-bind="panelMotionHooks">
              <section v-if="!listed.length" class="studio-empty">
                <h2 class="tp-subheading">这里还没有{{ view === "archived" ? "归档" : "进行中的" }}项目</h2>
                <p class="tp-caption mt-3">归档保留正文、版本与关联数据，可以随时恢复。</p>
              </section>
            </Transition>
          </div>
        </Transition>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.workspace-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.project-grid {
  align-items: start;
}
.project-undo {
  justify-content: space-between;
}
</style>
