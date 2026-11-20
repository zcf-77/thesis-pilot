<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";
import { useMediaQuery } from "@vueuse/core";
import { PhMagnifyingGlass, PhUploadSimple } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpDrawer from "@/components/ui/TpDrawer.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpState from "@/components/ui/TpState.vue";
import TpTabs from "@/components/ui/TpTabs.vue";
import type { BackendServices, JobRead, ProjectRead } from "@/services";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import MaterialUploadForm from "./materials/MaterialUploadForm.vue";
import MaterialSourceBinding from "./materials/MaterialSourceBinding.vue";
import MaterialFileRow from "./materials/MaterialFileRow.vue";
import MaterialSelectionDetail from "./materials/MaterialSelectionDetail.vue";
import LiteratureIndex from "./materials/LiteratureIndex.vue";
import { useLiterature } from "./materials/useLiterature";
import { PAGE_SIZE, useMaterialCatalog } from "./materials/useMaterialCatalog";
import { useSourceBinding } from "./materials/useSourceBinding";
import { materialCategories, type MaterialKind, type MaterialTab } from "./materials/materialPresentation";
import { materialLink } from "./workspaceRoutes";

const props = defineProps<{ services: BackendServices; project: ProjectRead }>();
const route = useRoute();
const emit = defineEmits<{ openJob: [job: JobRead] }>();
type Material = Awaited<ReturnType<BackendServices["materials"]["get"]>>;
type Receipt = Awaited<ReturnType<BackendServices["materials"]["upload"]>>;

const catalog = useMaterialCatalog(props.services, () => props.project.id);
const binding = useSourceBinding(props.services, () => props.project.id);
const literature = useLiterature(props.services, () => props.project.id);
const { tab, category, includeRemoved, query, page, counts } = catalog;
const selected = shallowRef<Material>();
const preferredOriginal = ref<string>();
const uploadOpen = ref(false);
const appendTarget = shallowRef<Material>();
const uploadedCount = ref(0);
const notice = ref("");
const compact = useMediaQuery("(max-width: 1050px)");
const detailOpen = ref(false);

const tabs = computed<{ value: MaterialTab; label: string; count?: number }[]>(() => [
  { value: "materials", label: "项目资料", count: counts.value.all },
  { value: "templates", label: "模板", count: counts.value.template },
  { value: "requirements", label: "论文要求", count: counts.value.requirements },
  { value: "literature", label: "文献索引", count: literature.entriesTotal.value },
]);
const chips = computed(() => [
  { value: "all" as const, label: "全部资料", count: counts.value.all },
  ...materialCategories.map((item) => ({ value: item.value as MaterialKind, label: item.label, count: counts.value[item.value as MaterialKind] })),
]);
const listLabel = computed(() => ({ materials: "资料清单", templates: "模板清单", requirements: "要求资料清单", literature: "文献清单" })[tab.value]);
const detailTitle = computed(() => {
  if (tab.value === "literature") {
    return literature.selectedEntry.value?.record.title ?? literature.selectedResult.value?.title ?? "文献详情";
  }
  return selected.value?.name ?? "资料详情";
});
const detailEyebrow = computed(() => {
  if (tab.value === "literature") return literature.selectedEntry.value ? "项目文献" : "检索结果";
  return selected.value ? (materialCategories.find((item) => item.value === selected.value?.kind)?.label ?? "资料详情") : "资料详情";
});

function select(material: Material, original?: string, reveal = true) {
  selected.value = material;
  catalog.pinned.value = material.id;
  preferredOriginal.value = original;
  if (reveal) revealDetail();
}
function revealDetail() {
  if (compact.value) detailOpen.value = true;
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
  detailOpen.value = false;
}
function closeUpload() {
  uploadOpen.value = false;
  appendTarget.value = undefined;
}
function uploaded(receipt: Receipt) {
  uploadedCount.value++;
  catalog.refresh();
  void binding.loadOptions();
  select(receipt.material, receipt.original.id, false);
}
function uploadDone() {
  notice.value = appendTarget.value ? "新原件已保存，解析任务已创建；旧版本保留。" : `已保存 ${uploadedCount.value} 份原件，解析任务已创建。`;
  closeUpload();
  if (compact.value && selected.value) detailOpen.value = true;
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
    detailOpen.value = false;
    closeUpload();
    notice.value = "";
    void catalog.load(0);
    void catalog.loadCounts();
    void binding.load();
    void binding.loadOptions();
    void literature.load();
  },
  { immediate: true },
);
watch(compact, (value) => {
  if (!value) detailOpen.value = false;
});
watch(tab, (value) => {
  detailOpen.value = false;
  const mismatch = (value === "templates" && selected.value?.kind !== "template") || (value === "requirements" && selected.value?.kind !== "requirements");
  if (mismatch) {
    selected.value = undefined;
    catalog.pinned.value = undefined;
    preferredOriginal.value = undefined;
  }
});

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
  const requestedTab = tab.value;
  const controller = new AbortController();
  linkRequest = controller;
  try {
    const material = await props.services.materials.get(projectId, id, controller.signal);
    if (controller.signal.aborted || props.project.id !== projectId || material.project_id !== projectId || tab.value !== requestedTab) return;
    notice.value = "";
    select(material);
  } catch {
    if (!controller.signal.aborted && tab.value === requestedTab) notice.value = "当前项目中未找到链接指向的资料，可从资料目录重新选择。";
  }
}
watch(() => [route.name, route.query.material, props.project.id], followLink, { immediate: true });
onScopeDispose(() => linkRequest?.abort());
</script>

<template>
  <Transition appear name="tp-page">
    <div class="screen-page workspace-page library-page">
      <header class="screen-heading library-heading">
        <div><h1 class="tp-display">项目资料</h1></div>
        <TpButton variant="primary" :aria-expanded="uploadOpen && !appendTarget" @click="toggleUpload">
          <TpIcon :icon="PhUploadSimple" :size="17" />上传资料
        </TpButton>
      </header>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <p v-if="notice" :key="notice" role="status" class="library-notice">{{ notice }}</p>
      </Transition>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
        <MaterialUploadForm
          v-if="uploadOpen"
          :key="appendTarget?.id ?? 'new'"
          :services="services"
          :project-id="project.id"
          :target="appendTarget"
          @uploaded="uploaded"
          @done="uploadDone"
          @close="closeUpload"
        />
      </Transition>

      <div class="library-workspace">
        <section class="screen-panel library-catalog" aria-label="资料目录">
          <div class="library-tabs"><TpTabs v-model="tab" label="资料视图" :tabs="tabs" /></div>
          <LiteratureIndex v-if="tab === 'literature'" :state="literature" @selected="revealDetail" />
          <template v-else>
            <MaterialSourceBinding v-if="tab === 'requirements'" :state="binding" />
            <div class="library-tools">
              <label class="library-search">
                <TpIcon :icon="PhMagnifyingGlass" :size="17" />
                <input v-model="query" type="search" aria-label="搜索项目资料" placeholder="筛选本页名称；在选中资料中定位文本" />
              </label>
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
              <label class="library-checkbox"><input v-model="includeRemoved" class="tp-checkbox" type="checkbox" />显示已移出</label>
            </div>
            <div class="library-list-label tp-label"><span>{{ listLabel }}</span><span>状态</span></div>
            <TpState
              v-if="catalog.error.value && !page"
              kind="error"
              title="资料读取失败"
              :desc="`${catalog.error.value} 已上传的原件不受影响。`"
              retryable
              @retry="catalog.load()"
            />
            <div v-else-if="!page" class="library-skeleton" role="status" aria-label="正在读取资料">
              <span v-for="index in 3" :key="index"><i /><b /><b /></span>
            </div>
            <Transition v-else name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
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
                <TpIcon :icon="PhMagnifyingGlass" :size="28" />
                <h2 class="tp-subheading">没有符合当前条件的资料</h2>
                <p class="tp-caption">可清除搜索词和分类后重新查看。</p>
                <TpButton size="sm" @click="resetFilters">清除筛选</TpButton>
              </div>
              <div v-else key="empty" class="library-empty" role="status">
                <h2 class="tp-subheading">{{ tab === "materials" ? "还没有资料" : "这一类还没有资料" }}</h2>
                <p class="tp-caption">上传后保留原件，并开始解析。</p>
                <TpButton size="sm" variant="primary" @click="toggleUpload">上传第一份资料</TpButton>
              </div>
            </Transition>
            <Transition name="tp-swap" v-bind="panelMotionHooks">
              <p v-if="catalog.error.value && page" class="studio-notice library-list-alert" role="alert">
                {{ catalog.error.value }}<TpButton size="sm" @click="catalog.load()">重新读取资料</TpButton>
              </p>
            </Transition>
            <footer v-if="page" class="library-list-footer">
              <span
                >{{ catalog.visible.value.length }} 份<template v-if="page.total > page.items.length">
                  · 本页 {{ page.offset + 1 }}–{{ page.offset + page.items.length }} / 共 {{ page.total }} 份</template
                ></span
              >
              <span v-if="page.total > PAGE_SIZE" class="screen-actions">
                <TpButton
                  size="sm"
                  variant="ghost"
                  :disabled="catalog.busy.value || page.offset === 0"
                  @click="catalog.load(Math.max(0, page.offset - PAGE_SIZE))"
                  >上一页</TpButton
                >
                <TpButton
                  size="sm"
                  variant="ghost"
                  :disabled="catalog.busy.value || page.offset + page.items.length >= page.total"
                  @click="catalog.load(page.offset + PAGE_SIZE)"
                  >下一页</TpButton
                >
              </span>
            </footer>
          </template>
        </section>

        <aside v-if="!compact" class="library-detail screen-panel" :aria-label="tab === 'literature' ? '所选文献详情' : '所选资料详情'">
          <MaterialSelectionDetail
            :services="services"
            :project-id="project.id"
            :tab="tab"
            :selected="selected"
            :preferred-original="preferredOriginal"
            :query="query"
            :binding="binding"
            :literature="literature"
            :catalog-empty="!!page && !page.total"
            @changed="changed"
            @open-job="emit('openJob', $event)"
            @job-updated="jobUpdated"
            @append="appendOriginal"
            @show-requirements="tab = 'requirements'"
          />
        </aside>
        <TpDrawer v-else v-model:open="detailOpen" :title="detailTitle" :eyebrow="detailEyebrow">
          <MaterialSelectionDetail
            :services="services"
            :project-id="project.id"
            :tab="tab"
            :selected="selected"
            :preferred-original="preferredOriginal"
            :query="query"
            :binding="binding"
            :literature="literature"
            :catalog-empty="!!page && !page.total"
            @changed="changed"
            @open-job="emit('openJob', $event)"
            @job-updated="jobUpdated"
            @append="appendOriginal"
            @show-requirements="tab = 'requirements'"
          />
        </TpDrawer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.library-page {
  min-width: 0;
}
.library-heading {
  align-items: center;
}
.library-notice {
  padding: 12px 16px;
  border-left: 2px solid var(--tp-info);
  background: var(--tp-info-soft);
  font-size: 13px;
}
.library-workspace {
  display: grid;
  grid-template-columns: minmax(280px, 0.78fr) minmax(400px, 1.22fr);
  gap: 24px;
  align-items: start;
}
.library-catalog {
  min-width: 0;
  overflow: hidden;
}
.library-tabs {
  padding: 8px 16px 0;
  border-bottom: 1px solid var(--tp-line);
  overflow-x: auto;
}
.library-tabs :deep(.tp-tabs) {
  white-space: nowrap;
  width: max-content;
  min-width: 100%;
}
.library-tools {
  display: grid;
  gap: 16px;
  padding: 20px;
}
.library-search {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 36px;
  color: var(--tp-text-muted);
  border-bottom: 1px solid var(--tp-line-strong);
  padding-bottom: 8px;
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
}
.library-filters button {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  min-height: 32px;
  padding: 4px 12px;
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
  min-height: 28px;
  font-size: 12px;
  color: var(--tp-text-muted);
}
.library-checkbox input {
  flex-shrink: 0;
}
.library-list-label {
  display: flex;
  justify-content: space-between;
  padding: 12px 20px;
  background: var(--tp-surface-sunken);
  border-top: 1px solid var(--tp-line);
  border-bottom: 1px solid var(--tp-line);
}
.library-skeleton {
  display: grid;
}
.library-skeleton > span {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 88px;
  gap: 12px;
  padding: 20px;
  border-bottom: 1px solid var(--tp-line);
}
.library-skeleton i {
  grid-column: 1 / -1;
  height: 16px;
  border-radius: var(--tp-radius-xs);
  background: var(--tp-surface-sunken);
}
.library-skeleton b {
  height: 12px;
  border-radius: var(--tp-radius-xs);
  background: var(--tp-surface-sunken);
}
.library-empty {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 48px 20px;
  text-align: center;
  color: var(--tp-text-muted);
}
.library-list-alert {
  margin: 16px 20px 0;
}
.library-list-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  color: var(--tp-text-muted);
  font-size: 11px;
}
.library-detail {
  min-width: 0;
  padding: 24px;
  scroll-margin-top: 88px;
}
@media (max-width: 1280px) {
  .library-workspace {
    grid-template-columns: minmax(260px, 0.85fr) minmax(360px, 1.15fr);
  }
}
@media (max-width: 1050px) {
  .library-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 640px) {
  .library-heading {
    gap: 16px;
  }
  .library-tools {
    padding: 16px;
  }
  .library-tabs {
    padding-left: 8px;
    padding-right: 8px;
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
    padding: 16px;
  }
  .library-list-footer {
    padding: 12px 16px;
  }
  .library-list-alert {
    margin: 12px 16px 0;
  }
}
</style>
