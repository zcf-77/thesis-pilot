<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";
import { PhFolderOpen, PhMagnifyingGlass, PhUploadSimple } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpState from "@/components/ui/TpState.vue";
import TpTabs from "@/components/ui/TpTabs.vue";
import type { BackendServices, JobRead, ProjectRead } from "@/services";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import MaterialUploadForm from "./materials/MaterialUploadForm.vue";
import MaterialSourceBinding from "./materials/MaterialSourceBinding.vue";
import MaterialFileRow from "./materials/MaterialFileRow.vue";
import MaterialDetail from "./materials/MaterialDetail.vue";
import { PAGE_SIZE, useMaterialCatalog } from "./materials/useMaterialCatalog";
import { bindingChoiceLabel, useSourceBinding } from "./materials/useSourceBinding";
import { materialCategories, type MaterialKind, type MaterialTab } from "./materials/materialPresentation";
import { materialLink } from "./workspaceRoutes";

const props = defineProps<{ services: BackendServices; project: ProjectRead }>();
const route = useRoute();
const emit = defineEmits<{ openJob: [job: JobRead] }>();
type Material = Awaited<ReturnType<BackendServices["materials"]["get"]>>;
type Receipt = Awaited<ReturnType<BackendServices["materials"]["upload"]>>;

const catalog = useMaterialCatalog(props.services, () => props.project.id);
const binding = useSourceBinding(props.services, () => props.project.id);
const { tab, category, includeRemoved, query, page, counts } = catalog;
const selected = shallowRef<Material>();
const preferredOriginal = ref<string>();
const uploadOpen = ref(false);
const appendTarget = shallowRef<Material>();
const uploadedCount = ref(0);
const notice = ref("");
const detail = ref<HTMLElement>();

const count = (value: number | undefined) => (value === undefined ? "—" : String(value).padStart(2, "0"));
const tabs = computed<{ value: MaterialTab; label: string; count?: number }[]>(() => [
  { value: "materials", label: "项目资料", count: counts.value.all },
  { value: "templates", label: "模板", count: counts.value.template },
  { value: "requirements", label: "论文要求", count: counts.value.requirements },
  { value: "literature", label: "文献索引", count: counts.value.literature },
]);
const chips = computed(() => [
  { value: "all" as const, label: "全部资料", count: counts.value.all },
  ...materialCategories.map((item) => ({ value: item.value as MaterialKind, label: item.label, count: counts.value[item.value as MaterialKind] })),
]);
const listLabel = computed(
  () => ({ materials: "文件与版本", templates: "模板与解析版本", requirements: "要求资料与解析版本", literature: "文献原件" })[tab.value],
);
const bindingSummary = computed(() => {
  const current = binding.binding.value;
  if (!current) return binding.loading.value ? "正在读取项目来源绑定…" : "";
  const template = current.template_parse_version_id
    ? binding.templateChoice.value
      ? bindingChoiceLabel(binding.templateChoice.value)
      : "已绑定固定版本"
    : "未绑定";
  const requirements = current.requirement_parse_version_ids.length ? `${current.requirement_parse_version_ids.length} 个解析版本` : "未绑定";
  return `项目模板 ${template} · 要求集 ${requirements}${current.version ? ` · 绑定 v${current.version}` : ""}`;
});

function select(material: Material, original?: string) {
  selected.value = material;
  catalog.pinned.value = material.id;
  preferredOriginal.value = original;
  if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 1050px)").matches)
    void nextTick(() => {
      const reduced = document.documentElement.dataset.motion === "reduced" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      detail.value?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    });
}
function toggleUpload() {
  if (uploadOpen.value && !appendTarget.value) return closeUpload();
  appendTarget.value = undefined;
  uploadedCount.value = 0;
  notice.value = "";
  uploadOpen.value = true;
}
function appendOriginal(material: Material) {
  appendTarget.value = material;
  uploadedCount.value = 0;
  notice.value = "";
  uploadOpen.value = true;
}
function closeUpload() {
  uploadOpen.value = false;
  appendTarget.value = undefined;
}
function uploaded(receipt: Receipt) {
  uploadedCount.value++;
  catalog.refresh();
  void binding.loadOptions();
  select(receipt.material, receipt.original.id);
}
function uploadDone() {
  notice.value = appendTarget.value
    ? "新原件版本已保存，解析任务已创建；旧原件与解析版本保留。"
    : `已保存 ${uploadedCount.value} 份原件并创建解析任务；正式稿保持不变。`;
  closeUpload();
}
function changed(material: Material) {
  if (selected.value?.id === material.id) selected.value = material;
  const listed = page.value?.items.find((item) => item.id === material.id);
  // Removal, restore or a category change can move the item in or out of the current list.
  if (!listed || listed.removed !== material.removed || listed.kind !== material.kind) catalog.refresh();
  else {
    catalog.replace(material);
    void catalog.loadCounts();
  }
}
function jobUpdated(material: Material, job: JobRead) {
  catalog.setJob(material, job);
}
function resetFilters() {
  query.value = "";
  category.value = "all";
}

watch(
  () => props.project.id,
  () => {
    catalog.stop();
    binding.stop();
    selected.value = undefined;
    catalog.pinned.value = undefined;
    closeUpload();
    notice.value = "";
    void catalog.load(0);
    void catalog.loadCounts();
    void binding.load();
    void binding.loadOptions();
  },
  { immediate: true },
);

/** ?material=<id> 选中当前项目的资料；同一链接只生效一次，之后以用户选择为准，链接变化时重新跟随。 */
let followed: string | undefined;
let linkRequest: AbortController | undefined;
async function followLink() {
  const id = route.name === "workspace-materials" ? materialLink(route.query) : undefined;
  const projectId = props.project.id;
  const key = id && `${projectId}:${id}`;
  if (key === followed) return;
  followed = key;
  linkRequest?.abort();
  if (!id || selected.value?.id === id) return;
  const controller = new AbortController();
  linkRequest = controller;
  try {
    const material = await props.services.materials.get(projectId, id, controller.signal);
    if (controller.signal.aborted || props.project.id !== projectId || material.project_id !== projectId) return;
    notice.value = "";
    select(material);
  } catch {
    if (!controller.signal.aborted) notice.value = "当前项目中未找到链接指向的资料，可从资料目录重新选择。";
  }
}
watch(() => [route.name, route.query.material, props.project.id], followLink, { immediate: true });
onScopeDispose(() => linkRequest?.abort());
</script>

<template>
  <Transition appear name="tp-page"
    ><div class="screen-page workspace-page library-page">
      <header class="screen-heading">
        <div>
          <p class="tp-label">Research library · 资料空间</p>
          <h1 class="tp-display mt-3">项目资料</h1>
          <p class="screen-lead">原件、版本与出处，一起留下。把资料整理成可追溯的写作依据。</p>
        </div>
        <div class="library-index" aria-label="资料概况">
          <span><b class="tp-num">{{ count(catalog.linkedTotal.value) }}</b><small>项目资料</small></span
          ><span><b class="tp-num">{{ count(binding.boundRequirementItems.value) }}</b><small>已绑定要求</small></span
          ><span><b class="tp-num">{{ count(counts.literature) }}</b><small>文献索引</small></span>
        </div>
      </header>
      <div class="screen-actions library-top-actions">
        <TpButton variant="primary" :aria-expanded="uploadOpen && !appendTarget" @click="toggleUpload"
          ><TpIcon :icon="PhUploadSimple" :size="17" />上传资料</TpButton
        ><span class="tp-caption library-binding-summary">{{ bindingSummary }}</span>
      </div>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
        ><p v-if="notice" :key="notice" role="status" class="library-notice">{{ notice }}</p></Transition
      >
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
        ><MaterialUploadForm
          v-if="uploadOpen"
          :key="appendTarget?.id ?? 'new'"
          :services="services"
          :project-id="project.id"
          :target="appendTarget"
          @uploaded="uploaded"
          @done="uploadDone"
          @close="closeUpload"
      /></Transition>

      <div class="library-workspace">
        <section class="screen-panel library-catalog" aria-label="资料目录">
          <div class="library-tabs"><TpTabs v-model="tab" label="资料视图" :tabs="tabs" /></div>
          <MaterialSourceBinding v-if="tab === 'requirements'" :state="binding" />
          <div class="library-tools">
            <label class="library-search"
              ><TpIcon :icon="PhMagnifyingGlass" :size="17" /><input
                v-model="query"
                type="search"
                aria-label="搜索项目资料"
                placeholder="按名称筛选，并在所选资料中定位提取内容"
            /></label>
            <div v-if="tab === 'materials'" class="library-filters" role="group" aria-label="资料分类">
              <button
                v-for="item in chips"
                :key="item.value"
                type="button"
                :aria-pressed="category === item.value"
                :class="{ 'is-active': category === item.value }"
                @click="category = item.value"
              >
                {{ item.label }}<span class="tp-mono">{{ item.count ?? "—" }}</span>
              </button>
            </div>
            <label class="library-checkbox mt-4"><input v-model="includeRemoved" class="tp-checkbox" type="checkbox" />显示已移出目录的资料</label>
          </div>
          <div class="library-list-label tp-label"><span>{{ listLabel }}</span><span>处理状态</span></div>
          <TpState
            v-if="catalog.error.value && !page"
            kind="error"
            title="资料读取失败"
            :desc="`${catalog.error.value} 已上传的原件保存在服务端，不受影响。`"
            retryable
            @retry="catalog.load()"
          />
          <div v-else-if="!page" class="library-skeleton" role="status" aria-label="正在读取资料">
            <span v-for="index in 3" :key="index"><i /><b /><b /></span>
          </div>
          <Transition v-else name="tp-swap" mode="out-in">
            <TransitionGroup
              v-if="catalog.visible.value.length"
              key="list"
              name="tp-list"
              tag="div"
              v-bind="listMotionHooks"
              class="library-file-list tp-list-group"
              :aria-busy="catalog.busy.value"
            >
              <MaterialFileRow
                v-for="item in catalog.visible.value"
                :key="item.id"
                :material="item"
                :info="catalog.info.value.get(item.id)"
                :selected="selected?.id === item.id"
                @select="select($event)"
              />
            </TransitionGroup>
            <div v-else-if="catalog.filtered.value" key="noresult" class="library-empty" role="status">
              <TpIcon :icon="PhMagnifyingGlass" :size="32" />
              <h2 class="tp-subheading">没有找到相关资料</h2>
              <p class="tp-caption">名称筛选只作用于当前已读取的资料。</p>
              <div class="screen-actions"><TpButton size="sm" @click="resetFilters">清除筛选</TpButton></div>
            </div>
            <div v-else key="empty" class="library-empty" role="status">
              <TpIcon :icon="PhFolderOpen" :size="36" />
              <h2 class="tp-subheading">{{ tab === "materials" ? "还没有资料" : "这一类还没有资料" }}</h2>
              <p class="tp-caption">上传自制模板、论文要求或文献原件，保留原件并自动解析。</p>
              <div class="screen-actions"><TpButton size="sm" variant="primary" @click="toggleUpload">上传第一份资料</TpButton></div>
            </div>
          </Transition>
          <p v-if="catalog.error.value && page" class="studio-notice library-list-alert" role="alert">
            {{ catalog.error.value }}<TpButton size="sm" @click="catalog.load()">重新读取资料</TpButton>
          </p>
          <footer v-if="page" class="library-list-footer">
            <span
              >{{ catalog.visible.value.length }} 份资料<template v-if="page && page.total > page.items.length">
                · 第 {{ page.offset + 1 }}–{{ page.offset + page.items.length }} / 共 {{ page.total }} 份</template
              ></span
            >
            <span v-if="page && page.total > PAGE_SIZE" class="screen-actions"
              ><TpButton
                size="sm"
                variant="ghost"
                :disabled="catalog.busy.value || page.offset === 0"
                @click="catalog.load(Math.max(0, page.offset - PAGE_SIZE))"
                >上一页资料</TpButton
              ><TpButton
                size="sm"
                variant="ghost"
                :disabled="catalog.busy.value || page.offset + page.items.length >= page.total"
                @click="catalog.load(page.offset + PAGE_SIZE)"
                >下一页资料</TpButton
              ></span
            >
            <span v-else>原件与历史版本分别保留</span>
          </footer>
        </section>

        <aside ref="detail" class="library-detail" aria-label="所选资料详情">
          <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
            ><MaterialDetail
              v-if="selected"
              :key="selected.id"
              :services="services"
              :project-id="project.id"
              :material="selected"
              :preferred-original="preferredOriginal"
              :query="query"
              :binding="binding"
              :requirements-tab="tab === 'requirements'"
              @changed="changed"
              @open-job="emit('openJob', $event)"
              @job-updated="jobUpdated"
              @append="appendOriginal"
              @show-requirements="tab = 'requirements'"
            />
            <div v-else key="empty" class="tp-ghost library-empty library-detail-empty">
              <TpIcon :icon="PhFolderOpen" :size="32" />
              <h2 class="tp-subheading">{{ page && !page.total ? "从第一份资料开始" : "选择一份资料" }}</h2>
              <p class="tp-caption">在这里查看原件、版本与提取结果；上传资料不会改写正文。</p>
            </div></Transition
          >
        </aside>
      </div>
    </div></Transition
  >
</template>

<style scoped>
.library-page {
  min-width: 0;
}
.library-index {
  display: flex;
  gap: 32px;
  flex-shrink: 0;
  align-self: center;
}
.library-index > span {
  display: grid;
  gap: 8px;
  text-align: center;
}
.library-index b {
  font-size: 32px;
  line-height: 1;
}
.library-index small {
  color: var(--tp-text-muted);
  font-size: 12px;
}
.library-top-actions {
  justify-content: space-between;
  margin-top: -12px;
}
.library-binding-summary {
  overflow-wrap: anywhere;
  min-width: 0;
}
.library-notice {
  padding: 12px 16px;
  border-left: 2px solid var(--tp-info);
  background: var(--tp-info-soft);
  font-size: 13px;
}
.library-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 32px;
  align-items: start;
}
.library-catalog {
  min-width: 0;
  overflow: hidden;
}
.library-tabs {
  padding: 8px 20px 0;
  border-bottom: 1px solid var(--tp-line);
  overflow-x: auto;
}
.library-tabs :deep(.tp-tabs) {
  white-space: nowrap;
  width: max-content;
  min-width: 100%;
}
.library-tools {
  padding: 24px 24px 16px;
}
.library-search {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--tp-text-muted);
  border-bottom: 1px solid var(--tp-line-strong);
  padding-bottom: 12px;
}
.library-search input {
  width: 100%;
  min-width: 0;
  background: transparent;
  outline-offset: 4px;
  color: var(--tp-text);
}
.library-search input::placeholder {
  color: var(--tp-text-muted);
}
.library-search input::-webkit-search-cancel-button {
  appearance: none;
}
.library-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}
.library-filters button {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-radius: var(--tp-radius-s);
  color: var(--tp-text-muted);
  font-size: 12px;
  border: 1px solid transparent;
}
.library-filters button:hover {
  background: var(--tp-surface-sunken);
}
.library-filters button.is-active {
  background: var(--tp-surface-sunken);
  color: var(--tp-text);
  border-color: var(--tp-line-strong);
  font-weight: 600;
}
.library-filters .tp-mono {
  font-size: 10px;
}
.library-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--tp-text-muted);
}
.library-checkbox input {
  flex-shrink: 0;
}
.library-list-label {
  display: flex;
  justify-content: space-between;
  padding: 16px 24px 12px;
  background: var(--tp-surface-sunken);
  border-top: 1px solid var(--tp-line);
  border-bottom: 1px solid var(--tp-line);
}
.library-skeleton {
  display: grid;
}
.library-skeleton > span {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 8px 16px;
  padding: 24px;
  border-bottom: 1px solid var(--tp-line);
}
.library-skeleton i {
  grid-row: span 2;
  height: 48px;
  border-radius: var(--tp-radius-xs);
  background: var(--tp-surface-sunken);
}
.library-skeleton b {
  height: 12px;
  border-radius: var(--tp-radius-xs);
  background: var(--tp-surface-sunken);
}
.library-skeleton b:last-child {
  width: 40%;
}
.library-empty {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 64px 24px;
  text-align: center;
  color: var(--tp-text-muted);
}
.library-list-alert {
  margin: 16px 24px 0;
}
.library-list-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 16px 24px;
  color: var(--tp-text-muted);
  font-size: 11px;
}
.library-detail {
  scroll-margin-top: 88px;
  min-width: 0;
}
.library-detail-empty {
  padding: 48px 24px;
}
@media (max-width: 1200px) {
  .library-index {
    gap: 20px;
  }
  .library-workspace {
    gap: 24px;
    grid-template-columns: minmax(0, 1fr) 280px;
  }
}
@media (max-width: 1050px) {
  .library-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 640px) {
  .library-index {
    width: 100%;
    justify-content: space-between;
    padding-top: 20px;
    border-top: 1px solid var(--tp-line);
  }
  .library-index > span {
    text-align: left;
  }
  .library-tools {
    padding: 20px 16px 16px;
  }
  .library-tabs {
    padding-left: 12px;
    padding-right: 12px;
  }
  .library-tabs :deep(.tp-tabs__tab) {
    padding-left: 10px;
    padding-right: 10px;
    font-size: 12px;
  }
  .library-list-label {
    padding: 12px 16px;
  }
  .library-list-label > span:last-child {
    display: none;
  }
  .library-skeleton > span {
    padding: 20px 16px;
  }
  .library-list-footer {
    padding: 16px;
  }
  .library-list-alert {
    margin: 12px 16px 0;
  }
}
</style>
