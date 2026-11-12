<script setup lang="ts">
import { listMotionHooks } from "@/design/motion";

import { PhArrowDown, PhArrowRight, PhBookOpen, PhFileText, PhFolderOpen, PhMagnifyingGlass, PhUploadSimple } from "@phosphor-icons/vue";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import RequirementRow from "@/components/domain/RequirementRow.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpProgress from "@/components/ui/TpProgress.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpTabs from "@/components/ui/TpTabs.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import { parseStatus } from "@/domain/vocab";
import {
  addLibraryVersion,
  currentLibraryVersion,
  libraryRequirementResult,
  libraryLiteratureSnapshot,
  materialBusinessKind,
  snapshotLibraryRequirements,
  useLibraryState,
  type LibraryMaterial,
  type LibraryRequirement,
  type LibraryVersion,
} from "../state/libraryState";
import { usePreviewWorkspaceStore } from "../state/previewWorkspace";
import { useSettingsState } from "../state/settingsState";
import { extractLibraryRequirements, parseLibraryText, semanticLibraryPreview, inferRuleType, type LibraryRuleType } from "../services/libraryService";
import { startProjectJob } from "../state/jobState";

type LibraryTab = "materials" | "templates" | "requirements" | "literature";
const workspace = usePreviewWorkspaceStore();
const library = useLibraryState();
const settings = useSettingsState();
const uploadCategories = computed(() => settings.value.categories.filter((item) => item.enabled));
const categoryKind = (id: string) =>
  settings.value.categories.find((x) => x.id === id)?.kind ??
  (
    { "category-0": "template", "category-1": "requirements", "category-3": "literature" } as Record<
      string,
      "template" | "requirements" | "literature" | "other"
    >
  )[id] ??
  "other";
const route = useRoute();
const router = useRouter();
const tab = ref<LibraryTab>("materials");
const category = ref("全部资料");
const query = ref("");
const selectedId = ref("m1");
const selectedVersion = ref(0);
const sourceLinkError = ref("");
const selectedLiteratureId = ref("L-012");
const focusedRequirementId = ref("");
const showExcerpt = ref(true);
const detail = ref<HTMLElement>();
const uploadOpen = ref(false);
const uploadCategory = ref("category-2");
const uploadError = ref("");
const uploadFileNames = ref("");
const notice = ref("");
const downloadRetry = ref<(() => void) | null>(null);
const showHistory = ref(false);
const showUnlinked = ref(false);
const editingExtract = ref(false);
const extractDraft = ref("");
const requirementQuery = ref("");
const requirementFilter = ref("all");
const requirementEditor = ref(false);
const requirementDraft = ref({
  text: "",
  param: "",
  scope: "",
  strictness: "硬性",
  kind: "hard" as "hard" | "semantic",
  sourceMaterialId: "",
  sourceVersion: 0,
  position: "",
  ruleType: "characters" as LibraryRuleType,
});
const requirementError = ref("");
const litQuery = ref("");
const litCoverage = ref("all");
const sourceOpen = ref(false);
const templateEditor = ref(false);
const templateDraft = ref<{ name: string; value: string; support: string }[]>([]);
const purposeDraft = ref("");
const nameDraft = ref("");
const renameOpen = ref(false);
const templateError = ref("");
const templateBase = ref(0);
const requirementSet = ref(0);
const verificationOpen = ref(false);
const verificationSource = ref("");
const verificationAbstract = ref("");
const verificationNote = ref("");
const verificationError = ref("");
const verificationStatus = ref("idle");
const verificationScenario = ref("success");
const semanticScenario = ref("success");
const pending = new Map<
  string,
  { token: symbol; projectId: string; item: LibraryMaterial; version: LibraryVersion; job: ReturnType<typeof startProjectJob> }
>();
const checks = new Map<string, ReturnType<typeof startProjectJob>>();
let verificationJob: ReturnType<typeof startProjectJob> | undefined;
const materials = computed(() => library.value.materials);
const requirements = computed(() => library.value.requirements);
const literature = computed(() => library.value.literature);
const linkedMaterials = computed(() => materials.value.filter((item) => item.linked && !item.removed));
const selected = computed(() => (selectedId.value ? materials.value.find((item) => item.id === selectedId.value) : materials.value[0]));
const revision = computed(() =>
  selectedVersion.value > 0
    ? selected.value?.versions.find((item) => item.version === selectedVersion.value)
    : selected.value
      ? currentLibraryVersion(selected.value)
      : undefined,
);
const sourceProblem = computed(
  () =>
    sourceLinkError.value ||
    (selectedVersion.value > 0 && !revision.value ? `请求的资料版本 v${selectedVersion.value} 不存在于当前项目，未改用其他版本。` : ""),
);
const selectedLiterature = computed(() => literature.value.find((item) => item.id === selectedLiteratureId.value) ?? literature.value[0]);
const focusedRequirement = computed(() => requirements.value.find((item) => item.id === focusedRequirementId.value));
const categories = computed(() =>
  ["全部资料", "规范与模板", "文献附件", "其他材料"].map((label) => ({ label, count: linkedMaterials.value.filter((item) => inCategory(item, label)).length })),
);
const filteredMaterials = computed(() =>
  materials.value.filter((item) => {
    if (showUnlinked.value ? item.linked && !item.removed : !item.linked || item.removed) return false;
    if (tab.value === "templates" && materialBusinessKind(item) !== "template") return false;
    return (
      inCategory(item, category.value) &&
      `${item.name} ${item.category} ${currentLibraryVersion(item).extracted}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())
    );
  }),
);
const filteredRequirements = computed(() =>
  requirements.value.filter(
    (item) =>
      `${item.text} ${item.category} ${item.scope}`.includes(requirementQuery.value.trim()) &&
      (requirementFilter.value === "all" || requirementFilter.value === "disabled"
        ? requirementFilter.value === "all" || !item.enabled
        : item.enabled && item.kind === requirementFilter.value),
  ),
);
const filteredLiterature = computed(() =>
  literature.value.filter(
    (item) =>
      `${item.title} ${item.meta}`.toLocaleLowerCase().includes(litQuery.value.trim().toLocaleLowerCase()) &&
      (litCoverage.value === "all" ||
        (litCoverage.value === "fulltext" && item.coverage.fulltext) ||
        (litCoverage.value === "abstract" && item.coverage.abstract && !item.coverage.fulltext) ||
        (litCoverage.value === "unverified" && item.verify !== "verified")),
  ),
);
const activeTemplates = computed(() => materials.value.filter((item) => materialBusinessKind(item) === "template" && item.linked && !item.removed));
const activeVersion = computed(() => selected.value && revision.value?.version === selected.value.version);

function inCategory(item: LibraryMaterial, value: string) {
  return (
    value === "全部资料" ||
    (value === "规范与模板" && ["requirements", "template"].includes(materialBusinessKind(item))) ||
    (value === "文献附件" && materialBusinessKind(item) === "literature") ||
    (value === "其他材料" && materialBusinessKind(item) === "other")
  );
}
function changeCategory(categoryId: string | number) {
  if (!selected.value) return;
  const category = settings.value.categories.find((x) => x.id === categoryId);
  if (!category) return;
  selected.value.categoryId = category.id;
  selected.value.category = category.name;
  selected.value.businessKind = categoryKind(category.id);
  if (selected.value.businessKind === "template") {
    const parsed = parseLibraryText(revision.value?.extracted ?? "", true);
    selected.value.templateItems = parsed.templateItems;
    currentLibraryVersion(selected.value).templateItems = parsed.templateItems;
  }
}
async function revealDetail() {
  await nextTick();
  if (window.matchMedia("(max-width: 1050px)").matches) detail.value?.scrollIntoView({ block: "start", behavior: "smooth" });
}
function selectMaterial(id: string) {
  sourceLinkError.value = "";
  selectedId.value = id;
  selectedVersion.value = 0;
  renameOpen.value = false;
  focusedRequirementId.value = "";
  editingExtract.value = false;
  templateEditor.value = false;
  showExcerpt.value = true;
  void revealDetail();
}
function showSource(id: string) {
  sourceLinkError.value = "";
  focusedRequirementId.value = id;
  const req = requirements.value.find((item) => item.id === id);
  if (req?.sourceMaterialId) {
    selectedId.value = req.sourceMaterialId;
    selectedVersion.value = req.sourceVersion;
  }
  showExcerpt.value = true;
  void revealDetail();
}
function selectLiterature(id: string) {
  verificationJob?.cancel();
  selectedLiteratureId.value = id;
  sourceOpen.value = false;
  verificationOpen.value = false;
  verificationError.value = "";
  void revealDetail();
}
function resetFilters() {
  query.value = "";
  category.value = "全部资料";
  showUnlinked.value = false;
}
function download(name: string, content: string, mime = "text/plain;charset=utf-8") {
  try {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    downloadRetry.value = null;
    notice.value = "已发起文件下载，请在浏览器下载列表中查看；来源内容保持不变。";
  } catch {
    notice.value = "文件下载准备失败，内容保留，可重试。";
    downloadRetry.value = () => download(name, content, mime);
  }
}
function downloadOriginal() {
  if (!revision.value?.dataUrl) return;
  const { dataUrl: url, originalName } = revision.value;
  const attempt = () => {
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = originalName;
      a.click();
      downloadRetry.value = null;
      notice.value = "已发起原件下载，请在浏览器下载列表中查看。";
    } catch {
      notice.value = "原件下载准备失败，原件仍保留，可重试。";
      downloadRetry.value = attempt;
    }
  };
  attempt();
}
function viewOriginal() {
  if (!revision.value) return;
  sourceOpen.value = !sourceOpen.value;
}
function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取文件，原有资料未变化。"));
    reader.readAsDataURL(file);
  });
}
function abortParsing(id: string) {
  const record = pending.get(id);
  if (!record) return;
  pending.delete(id);
  const { item, version } = record;
  version.status = "failed";
  version.diagnosis = "读取已取消，原件与此前版本保留，可重试或手动补充。";
  if (version.attempts?.length) version.attempts[version.attempts.length - 1]!.result = "学生取消读取";
  if (item.version === version.version) {
    item.cancelled = true;
    item.status = "failed";
    item.diagnosis = version.diagnosis;
    item.progress = undefined;
  }
}
async function parseMaterial(item: LibraryMaterial, version: LibraryVersion, text: string | null, projectId: string) {
  pending.get(item.id)?.job.cancel();
  const project = workspace.projects.find((x) => x.id === projectId);
  if (!project) return;
  version.attempts ??= [];
  const attempt = { at: new Date().toLocaleString("zh-CN"), result: "等待读取" };
  version.attempts.push(attempt);
  const token = Symbol();
  const job = startProjectJob(
    project,
    {
      title: `解析 · ${item.name}`,
      kind: "解析",
      route: `/screens/library?material=${item.id}&version=${version.version}`,
      input: `资料 v${version.version}`,
      sourceId: `library:${item.id}:${version.version}`,
      snapshot: { materialId: item.id, version: version.version },
    },
    {
      cancel: () => abortParsing(item.id),
      retry: () => {
        void parseMaterial(item, version, text, projectId);
      },
    },
  );
  pending.set(item.id, { token, projectId, item, version, job });
  item.cancelled = false;
  item.status = "waiting";
  version.status = "waiting";
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (pending.get(item.id)?.token !== token || !job.isActive()) return;
  item.status = "processing";
  version.status = "processing";
  item.progress = 45;
  await new Promise((resolve) => setTimeout(resolve, 450));
  if (pending.get(item.id)?.token !== token || !job.isActive()) return;
  pending.delete(item.id);
  item.progress = undefined;
  if (text === null) {
    item.status = "failed";
    item.diagnosis = "原件已保留。当前预览不支持此格式的内容解析，可手动补充提取文本，或换用 UTF-8 文本文件。";
  } else {
    const parsed = parseLibraryText(text, materialBusinessKind(item) === "template");
    item.status = !text.trim() || parsed.unknown ? "partial" : "parsed";
    version.extracted = text;
    version.fragments = parsed.fragments;
    if (materialBusinessKind(item) === "template") {
      item.templateItems = parsed.templateItems;
      version.templateItems = parsed.templateItems.map((x) => ({ ...x }));
    }
    item.recognized = parsed.recognized;
    item.unrecognized = parsed.unknown;
    item.diagnosis = text.trim()
      ? `已读取 ${parsed.recognized} 个文本片段；${parsed.unknown ? `${parsed.unknown} 项模板字段未知或冲突，可逐项纠正。` : "可按位置追溯来源。"}结构提取为本地规则预览，不保证复杂文档版式。`
      : "文件为空，原件已保留；可补充文本。";
  }
  version.status = item.status;
  version.diagnosis = item.diagnosis;
  attempt.result = item.diagnosis;
  job.finish(item.status === "failed" ? "failed" : item.status === "partial" ? "partial" : "done", item.diagnosis);
  if (workspace.activeId === projectId) notice.value = `${item.name}：${item.status === "parsed" ? "文本已读取" : "请查看诊断"}。`;
}
async function uploadFiles(event: Event) {
  if (!uploadCategories.value.some((x) => x.id === uploadCategory.value)) {
    uploadError.value = "请先选择一个启用的资料分类。";
    return;
  }
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  uploadFileNames.value = files.map((file) => file.name).join("、");
  uploadError.value = "";
  const targetState = library.value;
  const projectId = workspace.activeId;
  for (const file of files) {
    if (file.size > 2 * 1024 * 1024) {
      uploadError.value = `${file.name} 超过预览上限 2 MB，请选较小文件。`;
      continue;
    }
    try {
      const raw = await dataUrl(file);
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "file";
      const text = ["txt", "md", "csv", "json", "tex"].includes(ext) ? await file.text() : null;
      const old = targetState.materials.find((item) => currentLibraryVersion(item).originalName === file.name && !item.removed);
      let item: LibraryMaterial;
      let version: LibraryVersion;
      const patch = { originalName: file.name, mime: file.type, dataUrl: raw, extracted: "", status: "waiting" as const, diagnosis: "等待读取" };
      if (old) {
        item = old;
        version = addLibraryVersion(item, patch, raw === currentLibraryVersion(item).dataUrl ? "重复上传（保留记录）" : "上传新原件版本");
      } else {
        version = { ...patch, version: 1, at: new Date().toLocaleString("zh-CN"), reason: "上传原件" };
        item = {
          id: crypto.randomUUID(),
          name: file.name,
          ext,
          category: uploadCategories.value.find((x) => x.id === uploadCategory.value)!.name,
          categoryId: uploadCategory.value,
          businessKind: categoryKind(uploadCategory.value),
          version: 1,
          status: "waiting",
          size: `${Math.max(1, Math.ceil(file.size / 1024))} KB`,
          at: version.at,
          source: "本机上传",
          linked: true,
          removed: false,
          cancelled: false,
          versions: [version],
          purpose: "",
          templateItems:
            categoryKind(uploadCategory.value) === "template"
              ? [
                  { name: "标题层级", value: "未知", support: "未解析" },
                  { name: "字体字号", value: "未知", support: "未解析" },
                  { name: "段落与页边距", value: "未知", support: "未解析" },
                  { name: "页眉页脚", value: "未知", support: "未解析" },
                ]
              : [],
        };
        targetState.materials.unshift(item);
        item = targetState.materials[0]!;
        version = currentLibraryVersion(item);
      }
      if (workspace.activeId === projectId) {
        selectedId.value = item.id;
        selectedVersion.value = 0;
        tab.value = "materials";
        resetFilters();
      }
      void parseMaterial(item, version, text, projectId);
    } catch {
      uploadError.value = "文件读取失败，已有资料未被覆盖，请重新选择文件。";
    }
  }
  input.value = "";
}
function cancelParsing() {
  if (selected.value) pending.get(selected.value.id)?.job.cancel();
}
function retryParsing() {
  const item = selected.value;
  if (!item) return;
  const version = currentLibraryVersion(item);
  const text =
    version.dataUrl && ["txt", "md", "csv", "json", "tex"].includes(item.ext)
      ? new TextDecoder().decode(Uint8Array.from(atob(version.dataUrl.split(",")[1] ?? ""), (c) => c.charCodeAt(0)))
      : null;
  void parseMaterial(item, version, text, workspace.activeId);
}
function editExtract() {
  extractDraft.value = revision.value?.extracted ?? "";
  editingExtract.value = true;
}
function saveExtract() {
  if (!selected.value || !extractDraft.value.trim()) return;
  addLibraryVersion(
    selected.value,
    {
      extracted: extractDraft.value,
      fragments: parseLibraryText(extractDraft.value).fragments,
      status: "parsed",
      diagnosis: "学生手动补充/纠正的提取文本，原件未修改。",
    },
    "学生纠正提取结果",
  );
  selectedVersion.value = 0;
  editingExtract.value = false;
  notice.value = "已保存新提取版本，旧版本和原件保留。";
}
function renameMaterial() {
  if (!selected.value || !nameDraft.value.trim()) return;
  selected.value.name = nameDraft.value.trim();
  renameOpen.value = false;
  notice.value = "资料名称已更新，原件文件名和历史版本保留。";
}
function toggleLinked(remove = false) {
  if (!selected.value) return;
  if (pending.has(selected.value.id)) cancelParsing();
  selected.value.linked = !selected.value.linked;
  selected.value.removed = remove;
  showUnlinked.value = !selected.value.linked || remove;
  notice.value = remove
    ? "已从当前资料目录移除；历史版本仍可在历史资料中恢复。"
    : selected.value.linked
      ? "已重新关联当前项目。"
      : "已解除当前项目关联；历史依据保留。";
}
function restoreMaterial() {
  if (!selected.value) return;
  selected.value.removed = false;
  selected.value.linked = true;
  showUnlinked.value = false;
}
function editRequirement(item: LibraryRequirement) {
  focusedRequirementId.value = item.id;
  requirementDraft.value = {
    text: item.text,
    param: item.param ?? "",
    scope: item.scope,
    strictness: item.strictness,
    kind: item.kind,
    sourceMaterialId: item.sourceMaterialId,
    sourceVersion: item.sourceVersion,
    position: item.position,
    ruleType: inferRuleType(item),
  };
  requirementEditor.value = true;
  requirementError.value = "";
  showSource(item.id);
}
function changeRequirement(item: LibraryRequirement, reason: string) {
  item.version += 1;
  library.value.requirementsVersion += 1;
  item.history.push({
    version: item.version,
    at: new Date().toLocaleString("zh-CN"),
    text: item.text,
    param: item.param ?? "",
    enabled: item.enabled,
    reason,
    scope: item.scope,
    strictness: item.strictness,
    kind: item.kind,
    sourceMaterialId: item.sourceMaterialId,
    sourceVersion: item.sourceVersion,
    position: item.position,
  });
  snapshotLibraryRequirements(library.value);
}
function saveRequirement() {
  const item = focusedRequirement.value;
  if (!item) return;
  if (!requirementDraft.value.text.trim() || !requirementDraft.value.scope.trim()) {
    requirementError.value = "请填写要求内容和适用范围。";
    return;
  }
  const source = materials.value.find((x) => x.id === requirementDraft.value.sourceMaterialId);
  if (requirementDraft.value.sourceMaterialId && !source?.versions.some((x) => x.version === requirementDraft.value.sourceVersion)) {
    requirementError.value = "请选择存在的来源版本。";
    return;
  }
  Object.assign(item, requirementDraft.value, { ruleType: requirementDraft.value.kind === "semantic" ? "semantic" : requirementDraft.value.ruleType });
  item.source = source ? `${source.name} · ${item.position}` : undefined;
  item.verdict = "unknown";
  changeRequirement(item, "学生修正要求");
  requirementEditor.value = false;
  notice.value = "要求已形成新版本；项目仍使用原绑定版本，需明确选择后切换。";
}
function toggleRequirement(item: LibraryRequirement) {
  item.enabled = !item.enabled;
  changeRequirement(item, item.enabled ? "重新启用" : "停用");
}
function bindRequirements() {
  const version = requirementSet.value || library.value.requirementsVersion;
  const set = library.value.requirementSets.find((x) => x.version === version);
  if (!set?.items.some((item) => item.enabled)) {
    notice.value = "尚无已启用要求；请先从资料提取结果建立要求，核对后启用。";
    return;
  }
  workspace.current.requirementVersion = version;
  notice.value = `项目已绑定要求集 v${version}，供写作、评审及各助手统一使用；正文未改变。`;
}
function newRequirement() {
  const material = selected.value;
  const version = revision.value;
  if (!material || !version?.extracted.trim()) return;
  const items = extractLibraryRequirements(material, version.version, version.extracted);
  if (!items.length) {
    notice.value = "没有识别到含要求语义的条目；请先在提取文本中补充明确的原文要求。";
    return;
  }
  library.value.requirements.push(...items);
  library.value.requirementsVersion += 1;
  snapshotLibraryRequirements(library.value);
  requirementSet.value = 0;
  tab.value = "requirements";
  editRequirement(items[0]!);
  notice.value = `已从原文提取 ${items.length} 条要求，暂未启用。逐条核对后可启用并绑定。`;
}
async function runSemantic(item: LibraryRequirement) {
  if (!item.enabled) {
    notice.value = "请核对来源并启用此要求。";
    return;
  }
  const source = materials.value.find((x) => x.id === item.sourceMaterialId);
  if (!source?.versions.some((x) => x.version === item.sourceVersion)) {
    notice.value = "来源版本不可用，请先补充正确来源。";
    return;
  }
  checks.get(item.id)?.cancel();
  const state = library.value;
  const project = workspace.current;
  const html = project.document.html;
  const inputVersion = project.document.version;
  const requirement = structuredClone({ ...item, history: item.history.map((x) => ({ ...x })) });
  const token = crypto.randomUUID();
  state.semanticChecks ??= {};
  state.semanticChecks[item.id] = {
    status: "running",
    inputVersion,
    requirementVersion: item.version,
    explanation: "正在结合正文片段生成本地语义预览…",
    evidence: [],
    token,
  };
  const scenario = semanticScenario.value;
  const job = startProjectJob(
    project,
    {
      title: `要求语义预览 · ${item.id}`,
      kind: "生成",
      route: "/screens/library?tab=requirements",
      input: `正文 v${inputVersion} · 要求 v${item.version}`,
      sourceId: `semantic:${item.id}`,
      snapshot: { documentVersion: inputVersion, requirementId: item.id, requirementVersion: item.version },
    },
    {
      cancel: () => {
        const run = state.semanticChecks?.[item.id];
        if (run?.token === token) {
          run.status = "cancelled";
          run.explanation = "已取消，原规则和正文保持不变，可重新执行。";
        }
      },
      retry: () => {
        void runSemantic(item);
      },
    },
  );
  checks.set(item.id, job);
  await new Promise((resolve) => setTimeout(resolve, 650));
  if (!job.isActive() || state.semanticChecks[item.id]?.token !== token) return;
  if (scenario === "failed") {
    state.semanticChecks[item.id]!.status = "failed";
    state.semanticChecks[item.id]!.explanation = "模拟请求超时；原文保留，请重试。";
    job.finish("failed", "语义预览模拟超时");
    return;
  }
  Object.assign(state.semanticChecks[item.id]!, semanticLibraryPreview(requirement, html), { status: "done" });
  job.finish(state.semanticChecks[item.id]!.evidence.length ? "done" : "partial", state.semanticChecks[item.id]!.explanation);
}
function editTemplate() {
  if (!selected.value) return;
  templateDraft.value = structuredClone((revision.value?.templateItems ?? selected.value.templateItems).map((item) => ({ ...item })));
  purposeDraft.value = revision.value?.purpose ?? selected.value.purpose;
  templateBase.value = selected.value.version;
  templateError.value = "";
  templateEditor.value = true;
}
function saveTemplate() {
  if (!selected.value || !revision.value) return;
  if (selected.value.version !== templateBase.value) {
    templateError.value = "模板已产生新版本，请重新打开纠正表单。";
    return;
  }
  if (templateDraft.value.some((x) => !x.value.trim())) {
    templateError.value = "每项填写已核实的值，无法确认请保留“未知”。";
    return;
  }
  const sourceVersion = revision.value.version;
  templateDraft.value = templateDraft.value.map((x) => ({
    ...x,
    state: x.value === "未知" ? "unknown" : "identified",
    support: x.value === "未知" ? "未识别，可按原件补充" : "学生根据原件纠正；仅标题结构/对齐支持安全应用",
  }));
  selected.value.templateItems = templateDraft.value.map((item) => ({ ...item }));
  selected.value.purpose = purposeDraft.value;
  addLibraryVersion(
    selected.value,
    { ...revision.value, templateItems: templateDraft.value.map((item) => ({ ...item })), purpose: purposeDraft.value },
    `学生修正模板解析项（基于 v${sourceVersion}）`,
  );
  templateEditor.value = false;
  selectedVersion.value = 0;
  notice.value = "模板解析项已保存为新版本，原件与正文未改变。";
}
function bindTemplate() {
  if (!selected.value) return;
  workspace.current.templateVersion = revision.value?.version ?? selected.value.version;
  library.value.templateBinding = { materialId: selected.value.id, version: workspace.current.templateVersion };
  notice.value = `项目已绑定模板 v${workspace.current.templateVersion}；绑定不修改正文。`;
}
function toggleLiterature(id: string) {
  const item = literature.value.find((x) => x.id === id);
  if (!item || !libraryLiteratureSnapshot(item)) {
    notice.value = "来源未核实或冲突，先补充来源再提问。";
    return;
  }
  const ids = library.value.contextLiteratureIds;
  library.value.contextLiteratureIds = ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}
function openVerification() {
  const item = selectedLiterature.value;
  if (!item) return;
  verificationSource.value = item.sourceText;
  verificationAbstract.value = item.abstractText;
  verificationNote.value = item.verificationNote ?? "";
  verificationError.value = "";
  verificationStatus.value = "idle";
  verificationOpen.value = true;
}
async function verifyLiterature() {
  const item = selectedLiterature.value;
  if (!item || verificationStatus.value === "running") return;
  if (verificationSource.value.trim().length < 10 || verificationNote.value.trim().length < 5) {
    verificationError.value = "请补充至少10字的来源记录及至少5字的核对说明；不确定的信息不要补造。";
    return;
  }
  const sourceText = verificationSource.value.trim(),
    abstractText = verificationAbstract.value.trim(),
    note = verificationNote.value.trim();
  const scenario = verificationScenario.value;
  const project = workspace.current;
  verificationError.value = "";
  verificationStatus.value = "running";
  const job = startProjectJob(
    project,
    {
      title: `文献来源核验 · ${item.id}`,
      kind: "检索",
      route: "/screens/library?tab=literature",
      input: `来源 v${item.version ?? 1}`,
      sourceId: `literature:${item.id}`,
      snapshot: { literatureId: item.id, sourceVersion: item.version ?? 1 },
    },
    {
      cancel: () => {
        verificationStatus.value = "cancelled";
        verificationError.value = "核验已取消，原有来源状态未变化。";
      },
      retry: () => {
        void verifyLiterature();
      },
    },
  );
  verificationJob = job;
  await new Promise((resolve) => setTimeout(resolve, 650));
  if (!job.isActive()) return;
  if (scenario === "failed") {
    verificationStatus.value = "failed";
    verificationError.value = "模拟核验超时，原来源保留；可重试。";
    job.finish("failed", verificationError.value);
    return;
  }
  item.history ??= [];
  item.history.push({
    version: item.version ?? 1,
    at: new Date().toLocaleString("zh-CN"),
    sourceText: item.sourceText,
    abstractText: item.abstractText,
    fullText: item.fullText,
    verify: item.verify,
    note: item.verificationNote ?? item.note ?? "原记录",
  });
  item.version = (item.version ?? 1) + 1;
  item.sourceText = sourceText;
  item.abstractText = abstractText;
  item.coverage.abstract = !!abstractText;
  item.verify = "verified";
  item.verificationNote = note;
  item.note = "学生已核对并补充本地来源记录；这是样例核验流程，不代表外部出版真实性认证。";
  verificationStatus.value = "done";
  verificationOpen.value = false;
  job.finish("done", `已保存来源 v${item.version}，此前记录保留。`);
  notice.value = `已保存 ${item.id} 来源 v${item.version}。既有调用仍保留原来源快照。`;
}
function prepareFormat() {
  const item = selected.value;
  const version = revision.value;
  if (!item || !version) return;
  const fields = version.templateItems ?? item.templateItems;
  if (fields.some((x) => x.state === "conflict")) {
    templateError.value = "模板仍有冲突字段，请先纠正后请求格式候选。";
    return;
  }
  library.value.formatRequest = {
    materialId: item.id,
    templateVersion: version.version,
    baseVersion: workspace.current.document.version,
    operation: "normalize-headings",
    label: "规范标题结构与对齐",
    sourceText: version.extracted,
    align: fields.some((x) => /居中/.test(x.value)) ? "center" : "left",
    fontWeight: "700",
  };
  void router.push({ path: "/screens/write", query: { material: item.id, intent: "format" } });
}
function askFragment(line: number) {
  const item = selected.value;
  const version = revision.value;
  if (!item || !version) return;
  const fragment = (version.fragments ?? parseLibraryText(version.extracted).fragments).find((x) => x.line === line);
  if (!fragment) return;
  library.value.contextSources = [
    {
      id: item.id,
      version: version.version,
      title: item.name,
      text: fragment.text,
      verify: "verified",
      coverage: { biblio: true, abstract: true, fulltext: false },
      position: `第${line}行`,
    },
  ];
  void router.push({ path: "/screens/write", query: { materials: item.id } });
}
function saveLiterature() {
  const item = selectedLiterature.value;
  if (!item || item.saved) return;
  item.saved = true;
  const text = [item.sourceText, item.abstractText, item.fullText].filter(Boolean).join("\n\n");
  const at = new Date().toLocaleString("zh-CN");
  library.value.materials.unshift({
    id: `lit-${item.id}`,
    name: `${item.title}（取得内容）`,
    ext: "txt",
    category: "文献附件",
    categoryId: "category-3",
    businessKind: "literature",
    version: 1,
    status: "parsed",
    size: `${text.length} 字符`,
    at,
    source: "自制文献样例库",
    linked: true,
    removed: false,
    cancelled: false,
    purpose: "文献取得内容与来源记录",
    templateItems: [],
    versions: [
      {
        version: 1,
        at,
        reason: "保存文献取得内容",
        originalName: `${item.id}-样例资料.txt`,
        mime: "text/plain;charset=utf-8",
        dataUrl: `data:text/plain;charset=utf-8;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(text)))}`,
        extracted: text,
        status: "parsed",
        diagnosis: "自制样例，无真实出版来源。",
      },
    ],
  });
  notice.value = "已将实际取得内容保存到当前项目资料。";
}
function askAssistant(single = false, citation = false) {
  const item = selectedLiterature.value;
  const ids = single && item ? [item.id] : library.value.contextLiteratureIds;
  if (!ids.length) return;
  const sources = ids.map((id) => {
    const source = literature.value.find((x) => x.id === id);
    return source ? libraryLiteratureSnapshot(source) : null;
  });
  if (sources.some((x) => !x)) {
    notice.value = "所选来源包含未核实、冲突或缺失条目，请补充核验后再使用。";
    return;
  }
  if (citation && (!item?.coverage.abstract || !item.abstractText.trim())) {
    notice.value = "未取得可引用文本，不能生成引用候选。";
    return;
  }
  library.value.contextLiteratureIds = [...ids];
  library.value.contextSources = sources.filter((x) => x !== null);
  const text = citation && item ? `${item.abstractText.trim()} [${item.id}]（自制文献样例，仅用于设计预览）` : "";
  if (citation) library.value.citationRequest = { ids, baseVersion: workspace.current.document.version, text, sources: library.value.contextSources };
  void router.push({ path: "/screens/write", query: { materials: ids.join(","), ...(text ? { citation: text } : {}) } });
}
watch(
  () => route.query.tab,
  (value) => {
    if (typeof value === "string" && ["materials", "templates", "requirements", "literature"].includes(value)) tab.value = value as LibraryTab;
  },
  { immediate: true },
);
watch(
  () => [route.query.material, route.query.version] as const,
  ([id, version]) => {
    if (id === undefined && version === undefined) return;
    tab.value = "materials";
    if (typeof id !== "string" || !materials.value.some((item) => item.id === id)) {
      sourceLinkError.value = "找不到链接指定的资料。它可能不属于当前项目或未随备份保存，未改用其他资料。";
      selectedId.value = typeof id === "string" ? id : "";
      return;
    }
    selectMaterial(id);
    if (version === undefined) return;
    if (typeof version !== "string" || !/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version))) {
      sourceLinkError.value = "来源版本号无效，无法确认这条证据对应的版本。";
      return;
    }
    selectedVersion.value = Number(version);
  },
  { immediate: true },
);
watch(
  () => workspace.activeId,
  () => {
    for (const record of pending.values()) record.job.cancel();
    for (const job of checks.values()) job.cancel();
    verificationJob?.cancel();
    selectedId.value = materials.value[0]?.id ?? "";
    focusedRequirementId.value = "";
    selectedVersion.value = 0;
    sourceLinkError.value = "";
    uploadError.value = "";
    notice.value = "";
    requirementEditor.value = false;
    editingExtract.value = false;
    templateEditor.value = false;
  },
);
onBeforeUnmount(() => {
  for (const { job } of pending.values()) job.cancel();
  for (const job of checks.values()) job.cancel();
  verificationJob?.cancel();
});
</script>

<template>
  <div class="screen-page library-page">
    <header class="screen-heading">
      <div>
        <p class="tp-label">Research library · 资料空间</p>
        <h1 class="tp-display mt-3">让每一份依据，有处可寻。</h1>
        <p class="screen-lead">原件、版本与出处，一起留下。把资料整理成可追溯的写作依据。</p>
      </div>
      <div class="library-index" aria-label="资料概况">
        <span><b class="tp-num">{{ String(linkedMaterials.length).padStart(2, "0") }}</b><small>项目资料</small></span
        ><span><b class="tp-num">{{ String(requirements.filter((item) => item.enabled).length).padStart(2, "0") }}</b><small>已启用要求</small></span
        ><span><b class="tp-num">{{ String(literature.length).padStart(2, "0") }}</b><small>文献索引</small></span>
      </div>
    </header>
    <div class="screen-actions library-top-actions">
      <TpButton variant="primary" :aria-expanded="uploadOpen" aria-controls="library-upload" @click="uploadOpen = !uploadOpen"
        ><TpIcon :icon="PhUploadSimple" :size="17" />上传资料</TpButton
      ><span class="tp-caption"
        >项目模板 {{ workspace.current.templateVersion > 0 ? "v" + workspace.current.templateVersion : "未绑定" }} · 要求集
        {{ workspace.current.requirementVersion > 0 ? "v" + workspace.current.requirementVersion : "未绑定" }}</span
      >
    </div>
    <Transition mode="out-in" name="tp-swap">
      <p :key="notice" v-if="notice" role="status" class="library-notice">{{ notice }}</p>
    </Transition>
    <Transition name="tp-swap">
      <TpButton v-if="downloadRetry" size="sm" @click="downloadRetry()">重试下载</TpButton>
    </Transition>
    <Transition name="tp-swap">
      <section v-if="uploadOpen" id="library-upload" class="screen-panel library-form" aria-label="上传资料" @keydown.esc="uploadOpen = false">
        <div>
          <h2 class="tp-subheading">保留原件，再开始整理。</h2>
          <p class="tp-caption mt-2">每份上限 2 MB。UTF-8 文本可真实读取并按行提取；其他文件保留原件并明确解析限制。</p>
        </div>
        <div class="library-form-grid">
          <TpField label="资料分类" v-slot="field"
            ><TpSelect :id="field.id" v-model="uploadCategory" :options="uploadCategories.map((item) => ({ value: item.id, label: item.name }))" /></TpField
          ><TpField label="选择文件" :error="uploadError" v-slot="field"
            ><label class="tp-file-control" :for="field.id">
              <span class="tp-file-control__button"><TpIcon :icon="PhUploadSimple" :size="16" />选择文件</span>
              <span class="tp-file-control__text">{{ uploadFileNames || "可多选文件，保留每份原件" }}</span>
              <input
                :id="field.id"
                type="file"
                multiple
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedby"
                class="tp-file-control__input"
                aria-label="选择文件"
                @change="uploadFiles"
              /> </label
          ></TpField>
        </div>
        <div class="screen-actions">
          <TpButton size="sm" variant="ghost" @click="uploadOpen = false">收起上传</TpButton>
          <p class="tp-caption">选择后直接保存原件并读取，无需核对发布。导师反馈请在反馈空间粘贴文字。</p>
        </div>
      </section>
    </Transition>

    <div class="library-workspace">
      <section class="screen-panel library-catalog" aria-label="资料目录">
        <div class="library-tabs">
          <TpTabs
            v-model="tab"
            label="资料视图"
            :tabs="[
              { value: 'materials', label: '项目资料', count: linkedMaterials.length },
              { value: 'templates', label: '模板', count: activeTemplates.length },
              { value: 'requirements', label: '论文要求', count: requirements.length },
              { value: 'literature', label: '文献索引', count: literature.length },
            ]"
          />
        </div>
        <template v-if="tab === 'materials' || tab === 'templates'">
          <div class="library-tools">
            <label class="library-search"
              ><TpIcon :icon="PhMagnifyingGlass" :size="17" /><input
                v-model="query"
                type="search"
                aria-label="搜索项目资料"
                placeholder="搜索名称、类型、提取内容…"
            /></label>
            <div v-if="tab === 'materials'" class="library-filters" role="group" aria-label="资料分类">
              <button
                v-for="item in categories"
                :key="item.label"
                type="button"
                :aria-pressed="category === item.label"
                :class="{ 'is-active': category === item.label }"
                @click="category = item.label"
              >
                {{ item.label }}<span class="tp-mono">{{ item.count }}</span>
              </button>
            </div>
            <label class="library-checkbox mt-4"><input class="tp-checkbox" v-model="showUnlinked" type="checkbox" />查看已解绑 / 移除的历史资料</label>
          </div>
          <div class="library-list-label tp-label"><span>{{ tab === "templates" ? "模板与支持范围" : "文件与版本" }}</span><span>处理状态</span></div>
          <Transition name="tp-swap" mode="out-in">
            <TransitionGroup
              key="boundary-first"
              name="tp-list"
              tag="div"
              v-bind="listMotionHooks"
              v-if="filteredMaterials.length"
              class="library-file-list tp-list-group"
            >
              <button
                v-for="item in filteredMaterials"
                :key="item.id"
                type="button"
                class="library-file-row"
                :class="{ 'is-selected': selectedId === item.id }"
                :aria-pressed="selectedId === item.id"
                @click="selectMaterial(item.id)"
              >
                <span class="library-file-icon"><TpIcon :icon="PhFileText" :size="25" /><small>{{ item.ext }}</small></span
                ><span class="library-file-copy"
                  ><span class="library-file-title">{{ item.name }}</span
                  ><span class="library-file-meta tp-caption">{{ item.category }}<i />{{ item.size }}<i /><TpVersion :v="item.version" /></span
                  ><span v-if="query && currentLibraryVersion(item).extracted.includes(query)" class="tp-caption block mt-2"
                    >匹配提取内容 · 来源 v{{ item.version }}</span
                  ></span
                ><span class="library-file-state"
                  ><TpStatus
                    :tone="item.cancelled ? 'ghost' : parseStatus[item.status].tone"
                    :label="item.cancelled ? '已取消' : parseStatus[item.status].label"
                    size="sm"
                  /><small v-if="item.removed">已移除 · 历史保留</small><small v-else-if="!item.linked">未关联项目</small
                  ><small v-else-if="item.unrecognized">{{ item.unrecognized }} 项待补充</small><small v-else-if="item.progress">{{ item.progress }}%</small
                  ><small v-else>{{ item.versions.length }} 个可查版本</small></span
                >
              </button>
            </TransitionGroup>
            <div key="boundary-last" v-else class="library-empty" role="status">
              <TpIcon :icon="PhFolderOpen" :size="36" />
              <h2 class="tp-subheading">没有找到相关资料</h2>
              <p class="tp-caption">上传第一份资料，或清除当前筛选。</p>
              <div class="screen-actions">
                <TpButton size="sm" @click="resetFilters">清除筛选</TpButton
                ><TpButton size="sm" variant="primary" @click="uploadOpen = true">上传资料</TpButton>
              </div>
            </div>
          </Transition>
          <footer class="library-list-footer"><span>{{ filteredMaterials.length }} 份资料</span><span>原件与历史版本分别保留</span></footer>
        </template>
        <template v-else-if="tab === 'requirements'">
          <div class="library-section-note">
            <p class="tp-subheading">要求有依据，判断有边界。</p>
            <p class="tp-caption mt-2">硬规则由程序检查；语义要求仅给出建议。项目绑定的适用版本由所有助手与评审共用。</p>
            <div class="library-form-grid mt-4">
              <input v-model="requirementQuery" type="search" class="tp-input" aria-label="搜索论文要求" placeholder="搜索内容、类别或范围" /><TpSelect
                v-model="requirementFilter"
                aria-label="要求筛选"
                :options="[
                  { value: 'all', label: '全部要求' },
                  { value: 'hard', label: '启用的硬规则' },
                  { value: 'semantic', label: '启用的语义要求' },
                  { value: 'disabled', label: '已停用' },
                ]"
              />
            </div>
            <div class="screen-actions mt-4">
              <TpSelect
                v-model="requirementSet"
                aria-label="适用要求集版本"
                :options="[
                  { value: 0, label: '最新要求集' },
                  ...library.requirementSets.filter((set) => set.version > 0).map((set) => ({ value: set.version, label: `历史 v${set.version}` })),
                ]"
              />
              <TpButton
                size="sm"
                :disabled="
                  !library.requirementSets.find((x) => x.version === (requirementSet || library.requirementsVersion))?.items.some((item) => item.enabled)
                "
                @click="bindRequirements"
                >{{ library.requirementsVersion > 0 ? "绑定要求集 v" + (requirementSet || library.requirementsVersion) : "尚无可绑定要求" }}</TpButton
              ><span class="tp-caption">{{
                workspace.current.requirementVersion > 0 ? "当前绑定 v" + workspace.current.requirementVersion : "当前未绑定要求集"
              }}</span>
            </div>
            <label class="tp-caption"
              >语义预览场景
              <TpSelect
                v-model="semanticScenario"
                aria-label="语义预览场景"
                :options="[
                  { value: 'success', label: '正常预览' },
                  { value: 'failed', label: '模拟超时' },
                ]"
            /></label>
            <p v-if="!requirements.some((item) => item.enabled)" class="tp-caption mt-3">
              先从资料提取结果建立要求，核对并启用后再绑定；空要求集不代表已满足规范。
            </p>
          </div>
          <Transition name="tp-swap" mode="out-in">
            <TransitionGroup
              key="boundary-first"
              name="tp-list"
              tag="div"
              v-bind="listMotionHooks"
              v-if="filteredRequirements.length"
              class="library-requirements tp-list-group"
            >
              <div v-for="item in filteredRequirements" :key="item.id" class="library-requirement-wrap">
                <RequirementRow
                  :requirement="libraryRequirementResult(item, workspace.current.document.html, library, workspace.current.document.version)"
                  @source="showSource"
                />
                <div class="library-requirement-actions">
                  <span class="tp-caption"
                    >{{ item.scope }} · {{ item.strictness }} · {{ item.kind === "hard" ? "自动判定范围见结果" : "语义预览不等于合规判断" }}</span
                  >
                  <div class="screen-actions">
                    <TpButton
                      v-if="item.kind === 'semantic' && library.semanticChecks?.[item.id]?.status !== 'running'"
                      size="sm"
                      variant="pencil"
                      :disabled="!item.enabled"
                      @click="runSemantic(item)"
                      >运行语义预览</TpButton
                    >
                    <TpButton v-else-if="library.semanticChecks?.[item.id]?.status === 'running'" size="sm" @click="checks.get(item.id)?.cancel()"
                      >取消预览</TpButton
                    >
                    <TpButton size="sm" variant="ghost" @click="editRequirement(item)">编辑要求</TpButton
                    ><TpButton size="sm" variant="ghost" @click="toggleRequirement(item)">{{ item.enabled ? "停用" : "启用" }}</TpButton
                    ><TpButton
                      size="sm"
                      variant="ghost"
                      @click="
                        showSource(item.id);
                        showHistory = true;
                      "
                      >历史</TpButton
                    >
                  </div>
                </div>
                <details v-if="library.semanticChecks?.[item.id]?.evidence.length" class="library-excerpt tp-disclosure">
                  <summary>查看判断依据 · 正文 v{{ library.semanticChecks?.[item.id]?.inputVersion }}</summary>
                  <blockquote v-for="(text, index) in library.semanticChecks?.[item.id]?.evidence" :key="index">{{ text }}</blockquote>
                </details>
              </div>
            </TransitionGroup>
            <div key="boundary-last" v-else class="library-empty">
              <p>没有匹配的要求。</p>
              <TpButton
                size="sm"
                @click="
                  requirementQuery = '';
                  requirementFilter = 'all';
                "
                >清除要求筛选</TpButton
              >
            </div>
          </Transition>
          <footer class="library-list-footer">
            <span>检查对象 · 正文 v{{ workspace.current.document.version }}</span
            ><span>{{ library.requirementsVersion > 0 ? "规则集 v" + library.requirementsVersion : "尚无规则集" }}</span>
          </footer>
        </template>
        <template v-else>
          <div class="library-section-note">
            <p class="tp-subheading">读到哪里，就说到哪里。</p>
            <p class="tp-caption mt-2">查询范围为 4 条自制文献样例，不访问外部检索服务。</p>
            <div class="library-form-grid mt-4">
              <input v-model="litQuery" type="search" aria-label="查询文献" class="tp-input" placeholder="输入关键词查询样例" /><TpSelect
                v-model="litCoverage"
                aria-label="文献取得范围"
                :options="[
                  { value: 'all', label: '全部范围' },
                  { value: 'fulltext', label: '已取得全文节选' },
                  { value: 'abstract', label: '仅摘要' },
                  { value: 'unverified', label: '待核实 / 冲突' },
                ]"
              />
            </div>
            <div class="screen-actions mt-4">
              <TpButton size="sm" variant="pencil" :disabled="!library.contextLiteratureIds.length" @click="askAssistant()"
                >带 {{ library.contextLiteratureIds.length }} 篇资料提问</TpButton
              ><TpButton v-if="library.contextLiteratureIds.length" size="sm" variant="ghost" @click="library.contextLiteratureIds = []">取消选择</TpButton>
            </div>
          </div>
          <TransitionGroup name="tp-list" tag="div" class="tp-list-group library-literature-list" v-bind="listMotionHooks">
            <div v-for="item in filteredLiterature" :key="item.id" class="library-literature-wrap">
              <label class="library-literature-check"
                ><input
                  class="tp-checkbox"
                  type="checkbox"
                  :checked="library.contextLiteratureIds.includes(item.id)"
                  :disabled="item.verify !== 'verified'"
                  :aria-label="'选择文献：' + item.title"
                  @change="toggleLiterature(item.id)" /></label
              ><button
                type="button"
                class="library-literature-row"
                :class="{ 'is-selected': selectedLiteratureId === item.id }"
                :aria-pressed="selectedLiteratureId === item.id"
                @click="selectLiterature(item.id)"
              >
                <span class="library-reference-no tp-mono">{{ item.id.replace("L-", "") }}</span
                ><span class="library-file-copy"
                  ><span class="library-file-title">{{ item.title }}</span><span class="tp-caption mt-1 block">{{ item.meta }}</span
                  ><span class="library-coverage"
                    ><span :class="{ 'is-available': item.coverage.biblio }">题录</span><span :class="{ 'is-available': item.coverage.abstract }">摘要</span
                    ><span :class="{ 'is-available': item.coverage.fulltext }">全文节选</span></span
                  ></span
                ><TpIcon :icon="PhArrowRight" :size="17" class="text-fg-muted" />
              </button>
            </div>
          </TransitionGroup>
          <div v-if="!filteredLiterature.length" class="library-empty" role="status">
            <TpIcon :icon="PhMagnifyingGlass" :size="32" />
            <h2 class="tp-subheading">没有查询到文献</h2>
            <p class="tp-caption">仅搜索当前自制样例，不表示真实检索没有结果。</p>
            <TpButton
              size="sm"
              @click="
                litQuery = '';
                litCoverage = 'all';
              "
              >清除文献筛选</TpButton
            >
          </div>
          <footer class="library-list-footer"><span>{{ filteredLiterature.length }} 条自制文献样例</span><span>没有真实 DOI 或出版页码</span></footer>
        </template>
      </section>

      <aside ref="detail" class="library-detail" aria-label="所选资料详情" aria-live="polite">
        <Transition name="tp-swap" mode="out-in"
          ><div :key="[tab, selectedId, revision?.version, selectedLiteratureId, focusedRequirementId].join(':')" class="library-detail-content">
            <div v-if="tab !== 'literature' && sourceProblem" class="tp-ghost library-form" role="status">
              <h2 class="tp-subheading">来源版本不可用</h2>
              <p class="tp-caption">{{ sourceProblem }}</p>
              <TpButton v-if="selected" size="sm" @click="selectMaterial(selected.id)">查看该资料当前版本</TpButton>
              <p v-else class="tp-caption">可从左侧选择一份可用资料，或返回原任务补充正确的证据。</p>
            </div>
            <template
              v-else-if="tab !== 'literature' && selected && revision && (tab !== 'requirements' || !focusedRequirement || focusedRequirement.sourceMaterialId)"
            >
              <header class="library-detail-heading">
                <p class="tp-label">Source & version · 来源与版本</p>
                <TpVersion :v="revision.version" />
              </header>
              <div class="library-paper">
                <div class="library-paper-top">
                  <TpIcon :icon="PhFileText" :size="24" /><span class="tp-label"
                    >{{ selected.ext }} · {{ revision.dataUrl ? "原件留存" : "自制内容样例" }}</span
                  >
                </div>
                <p class="tp-label mt-6">{{ selected.category }}</p>
                <h2 class="library-paper-title">{{ selected.name }}</h2>
                <div class="library-paper-rule" />
                <p class="library-paper-number tp-mono">{{ selected.id.toUpperCase() }} / V{{ revision.version.toString().padStart(2, "0") }}</p>
                <p class="tp-caption">收录于 {{ revision.at }}</p>
                <p class="tp-caption mt-2">{{ selected.source }}</p>
              </div>
              <div class="library-detail-status">
                <TpStatus
                  :tone="activeVersion && selected.cancelled ? 'ghost' : parseStatus[revision.status].tone"
                  :label="activeVersion && selected.cancelled ? '已取消' : parseStatus[revision.status].label"
                  size="sm"
                /><span v-if="!activeVersion" class="tp-caption">历史版本 · 当前 v{{ selected.version }}</span>
              </div>
              <Transition name="tp-swap">
                <TpProgress v-if="activeVersion && selected.status === 'processing'" :value="selected.progress" label="文本读取进度" tone="info" />
              </Transition>
              <Transition name="tp-swap">
                <p v-if="revision.diagnosis" class="tp-ghost library-detail-note">{{ revision.diagnosis }}</p>
              </Transition>
              <div class="screen-actions">
                <TpButton v-if="activeVersion && ['waiting', 'processing'].includes(selected.status)" size="sm" @click="cancelParsing">取消读取</TpButton
                ><TpButton v-else-if="activeVersion && (selected.status === 'failed' || selected.status === 'partial')" size="sm" @click="retryParsing"
                  >重试读取</TpButton
                ><TpButton v-if="revision.dataUrl" size="sm" @click="downloadOriginal">下载原件</TpButton
                ><TpButton size="sm" @click="viewOriginal">{{ sourceOpen ? "收起来源" : "查看来源" }}</TpButton
                ><TpButton size="sm" @click="showHistory = !showHistory">版本记录</TpButton>
              </div>
              <Transition name="tp-swap">
                <div v-if="sourceOpen" class="library-excerpt">
                  <p class="tp-label">{{ revision.originalName || "自制来源摘录" }} · v{{ revision.version }}</p>
                  <p v-if="!revision.dataUrl" class="tp-caption mt-2">此设计样例未提供 PDF/DOCX 原件，不提供伪造原件下载。</p>
                  <blockquote>{{ revision.extracted || "当前没有可读取文字。原始文件如已上传，可通过下载原件查看。" }}</blockquote>
                  <TpButton v-if="revision.extracted" size="sm" @click="download(selected.name + '-提取文本.txt', revision.extracted)"
                    >下载提取文本 .txt</TpButton
                  >
                </div>
              </Transition>
              <Transition name="tp-swap">
                <div v-if="showHistory" class="library-history">
                  <h3 class="tp-subheading">资料版本</h3>
                  <TransitionGroup name="tp-list" tag="div" class="tp-list-group" v-bind="listMotionHooks">
                    <button
                      v-for="version in selected.versions.slice().reverse()"
                      :key="version.version"
                      type="button"
                      :aria-pressed="revision.version === version.version"
                      @click="
                        selectedVersion = version.version;
                        editingExtract = false;
                      "
                    >
                      <b>v{{ version.version }} · {{ version.reason }}</b><span>{{ version.at }}</span>
                    </button>
                  </TransitionGroup>
                </div>
              </Transition>
              <Transition name="tp-swap">
                <div v-if="showHistory && revision.attempts?.length" class="library-history">
                  <h3 class="tp-subheading">读取记录</h3>
                  <article v-for="(attempt, index) in revision.attempts" :key="index">
                    <b>第 {{ index + 1 }} 次 · {{ attempt.at }}</b>
                    <p>{{ attempt.result }}</p>
                  </article>
                </div>
              </Transition>
              <div class="library-management">
                <Transition name="tp-swap" mode="out-in">
                  <form :key="'state-0'" v-if="renameOpen" class="library-rename" @submit.prevent="renameMaterial" @keydown.esc="renameOpen = false">
                    <TpField label="资料名称" v-slot="field"><input :id="field.id" v-model="nameDraft" class="tp-input" /></TpField>
                    <div class="screen-actions mt-3">
                      <TpButton type="submit" size="sm" variant="primary" :disabled="!nameDraft.trim()">保存名称</TpButton
                      ><TpButton size="sm" @click="renameOpen = false">取消</TpButton>
                    </div>
                  </form>
                  <TpButton
                    :key="'state-1'"
                    v-else
                    size="sm"
                    variant="ghost"
                    @click="
                      nameDraft = selected.name;
                      renameOpen = true;
                    "
                    >重命名资料</TpButton
                  >
                </Transition>
                <TpField label="资料分类" v-slot="field"
                  ><TpSelect
                    :id="field.id"
                    :model-value="selected.categoryId ?? ''"
                    @change="changeCategory"
                    :options="[
                      { value: '', label: selected.category, disabled: true },
                      ...uploadCategories.map((item) => ({ value: item.id, label: item.name })),
                    ]"
                /></TpField>
                <div class="screen-actions mt-3">
                  <TpButton v-if="selected.removed || !selected.linked" size="sm" @click="restoreMaterial">恢复关联</TpButton
                  ><template v-else
                    ><TpButton size="sm" variant="ghost" @click="toggleLinked()">解除项目关联</TpButton
                    ><TpButton size="sm" variant="ghost" @click="toggleLinked(true)">移出当前目录</TpButton></template
                  >
                </div>
                <p class="tp-caption mt-2">解绑、移出均保留历史；本预览不永久删除原件。</p>
              </div>
              <button type="button" class="library-excerpt-toggle" :aria-expanded="showExcerpt" @click="showExcerpt = !showExcerpt">
                <span><TpIcon :icon="PhBookOpen" :size="16" />{{ focusedRequirement ? "要求原文与位置" : "提取结果与定位" }}</span
                ><TpIcon :icon="PhArrowDown" :size="14" :class="{ 'is-open': showExcerpt }" />
              </button>
              <Transition name="tp-swap">
                <div v-if="showExcerpt" class="library-excerpt">
                  <template v-if="focusedRequirement"
                    ><p class="tp-label">{{ focusedRequirement.position }} · 来源 v{{ focusedRequirement.sourceVersion }}</p>
                    <blockquote>{{ focusedRequirement.original }}</blockquote>
                    <p class="tp-caption">{{ focusedRequirement.id }} · 原文独立保留，不随修正覆盖</p>
                    <p
                      v-if="libraryRequirementResult(focusedRequirement, workspace.current.document.html, library).verdict === 'conflict'"
                      class="tp-ghost library-detail-note"
                    >
                      {{ libraryRequirementResult(focusedRequirement, workspace.current.document.html, library).verdictNote }}
                    </p></template
                  ><template v-else
                    ><p class="tp-label">{{ selected.name }} · v{{ revision.version }} · 全文提取</p>
                    <blockquote>{{ revision.extracted || "暂无提取内容；可根据原件手动补充。" }}</blockquote></template
                  >
                </div>
              </Transition>
              <details v-if="revision.extracted && !focusedRequirement" class="library-excerpt tp-disclosure">
                <summary>按位置查看知识片段 · v{{ revision.version }}</summary>
                <article
                  v-for="fragment in (revision.fragments ?? parseLibraryText(revision.extracted).fragments).filter((x) => !query || x.text.includes(query))"
                  :key="fragment.id"
                  class="library-fragment"
                >
                  <span class="tp-label">第 {{ fragment.line }} 行</span>
                  <blockquote>{{ fragment.text }}</blockquote>
                  <TpButton size="sm" variant="pencil" @click="askFragment(fragment.line)">带此片段提问</TpButton>
                </article>
              </details>
              <Transition name="tp-swap" mode="out-in">
                <form
                  :key="'state-0'"
                  v-if="editingExtract"
                  class="library-form library-inline-form"
                  @submit.prevent="saveExtract"
                  @keydown.esc="editingExtract = false"
                >
                  <TpField label="提取文本" hint="这里只修正提取结果，不修改原件。Ctrl/Cmd+Enter 保存。" v-slot="field">
                    <textarea
                      :id="field.id"
                      v-model="extractDraft"
                      class="tp-input"
                      rows="7"
                      @keydown.ctrl.enter.prevent="saveExtract"
                      @keydown.meta.enter.prevent="saveExtract"
                    />
                  </TpField>
                  <div class="screen-actions">
                    <TpButton size="sm" type="submit" variant="primary" :disabled="!extractDraft.trim()">保存提取新版本</TpButton
                    ><TpButton size="sm" @click="editingExtract = false">取消</TpButton>
                  </div>
                </form>
                <TpButton :key="'state-1'" v-else-if="activeVersion && !['waiting', 'processing'].includes(selected.status)" size="sm" @click="editExtract">{{
                  revision.extracted ? "纠正提取结果" : "手动补充文本"
                }}</TpButton>
              </Transition>
              <TpButton v-if="revision.extracted && activeVersion" size="sm" @click="newRequirement">从提取文本建立要求</TpButton>
              <template v-if="materialBusinessKind(selected) === 'template'">
                <div class="library-template">
                  <h3 class="tp-subheading">模板结构与支持范围</h3>
                  <p class="tp-caption mt-2">{{ revision.purpose || selected.purpose || "用途尚未填写" }}</p>
                  <dl v-if="!templateEditor" class="library-definition">
                    <template v-for="item in revision.templateItems ?? selected.templateItems" :key="item.name"
                      ><dt>{{ item.name }}</dt>
                      <dd><b>{{ item.value }}</b><small>{{ item.support }}</small></dd></template
                    >
                  </dl>
                  <p v-if="!selected.templateItems.length" class="tp-ghost library-detail-note">尚未解析结构与格式项，不能判为完整支持。</p>
                  <p class="tp-caption mt-3">解析状态、浏览器编辑能力、DOCX 导出能力分别判断。</p>
                </div>
                <Transition name="tp-swap">
                  <form v-if="templateEditor" class="library-form library-inline-form" @submit.prevent="saveTemplate" @keydown.esc="templateEditor = false">
                    <TpField label="模板用途" v-slot="field"><input :id="field.id" v-model="purposeDraft" class="tp-input" /></TpField
                    ><TpField v-for="(item, index) in templateDraft" :key="index" :label="item.name" v-slot="field"
                      ><input :id="field.id" v-model="item.value" class="tp-input"
                    /></TpField>
                    <div class="screen-actions">
                      <TpButton size="sm" type="submit" variant="primary">保存模板新版本</TpButton
                      ><TpButton size="sm" @click="templateEditor = false">取消</TpButton>
                    </div>
                  </form>
                </Transition>
                <div class="screen-actions">
                  <TpButton size="sm" @click="editTemplate">纠正模板解析项</TpButton><TpButton size="sm" @click="bindTemplate">绑定此模板版本</TpButton
                  ><TpButton size="sm" variant="pencil" @click="prepareFormat">审阅标题格式</TpButton>
                </div>
                <p v-if="templateError" role="alert" class="tp-caption">{{ templateError }}</p>
                <p class="tp-caption">标题层级与对齐可生成候选；字号、页边距、页眉页脚保持原样。绑定模板不会自动修改正文。</p>
              </template>
              <TpButton
                v-if="tab !== 'requirements' && ['requirements', 'template'].includes(materialBusinessKind(selected))"
                block
                @click="tab = 'requirements'"
                >查看论文要求<TpIcon :icon="PhArrowRight" :size="15"
              /></TpButton>
            </template>
            <div v-else-if="tab === 'requirements' && focusedRequirement && !focusedRequirement.sourceMaterialId" class="tp-ghost library-form">
              <h2 class="tp-subheading">来源尚未找到</h2>
              <p class="tp-caption">这条要求没有关联原始材料，不能将其他资料当作它的来源。</p>
              <blockquote>{{ focusedRequirement.original }}</blockquote>
              <p class="tp-caption">可编辑整理，核验前不能作为确定性依据。</p>
            </div>
            <div v-else-if="tab !== 'literature'" class="tp-ghost library-empty">
              <TpIcon :icon="PhFolderOpen" :size="32" />
              <h2 class="tp-subheading">从第一份资料开始</h2>
              <p class="tp-caption">上传后在这里查看原件、版本与提取结果。</p>
              <TpButton size="sm" @click="uploadOpen = true">上传资料</TpButton>
            </div>
            <template v-else-if="selectedLiterature">
              <header class="library-detail-heading">
                <p class="tp-label">Reading record · 取得范围</p>
                <span class="tp-mono">{{ selectedLiterature.id }}</span>
              </header>
              <div class="library-paper library-paper--reference">
                <TpIcon :icon="PhBookOpen" :size="28" />
                <p class="tp-label mt-6">文献索引 · 自制样例</p>
                <h2 class="library-paper-title">{{ selectedLiterature.title }}</h2>
                <div class="library-paper-rule" />
                <p class="tp-caption">{{ selectedLiterature.meta }}</p>
              </div>
              <TpStatus
                :tone="selectedLiterature.verify === 'verified' ? 'success' : selectedLiterature.verify === 'conflict' ? 'warning' : 'ghost'"
                :label="
                  selectedLiterature.verify === 'verified' ? '样例来源可回溯' : selectedLiterature.verify === 'conflict' ? '题录信息冲突' : '来源无法核实'
                "
              />
              <div class="library-coverage library-coverage--large">
                <span :class="{ 'is-available': selectedLiterature.coverage.biblio }">题录</span
                ><span :class="{ 'is-available': selectedLiterature.coverage.abstract }">摘要</span
                ><span :class="{ 'is-available': selectedLiterature.coverage.fulltext }">全文节选</span>
              </div>
              <p class="tp-caption">{{ selectedLiterature.note ?? "包含自制题录、摘要与全文节选；不能作为真实论文依据。" }}</p>
              <p v-if="!selectedLiterature.coverage.fulltext" class="tp-ghost library-detail-note">全文不可访问。没有取得的段落、页码与结论不能用于回答。</p>
              <TpButton size="sm" @click="sourceOpen = !sourceOpen">{{ sourceOpen ? "收起取得内容" : "查看来源与取得内容" }}</TpButton>
              <Transition name="tp-swap">
                <div v-if="sourceOpen" class="library-excerpt">
                  <p class="tp-label">原始样例记录</p>
                  <blockquote>{{ selectedLiterature.sourceText }}</blockquote>
                  <h3 v-if="selectedLiterature.abstractText" class="tp-subheading">已取得摘要</h3>
                  <blockquote>{{ selectedLiterature.abstractText || "摘要不可用。" }}</blockquote>
                  <h3 v-if="selectedLiterature.fullText" class="tp-subheading">已取得全文节选</h3>
                  <blockquote v-if="selectedLiterature.fullText">{{ selectedLiterature.fullText }}</blockquote>
                  <p class="tp-caption">来源为应用内自制样例，没有外部出版链接。</p>
                </div>
              </Transition>
              <TpButton :variant="selectedLiterature.saved ? 'tonal' : 'primary'" :disabled="selectedLiterature.saved" block @click="saveLiterature">{{
                selectedLiterature.saved ? "已加入项目收藏" : "加入项目收藏"
              }}</TpButton
              ><TpButton variant="pencil" block :disabled="selectedLiterature.verify !== 'verified'" @click="askAssistant(true)">带这篇资料提问</TpButton
              ><TpButton
                variant="pencil"
                block
                :disabled="selectedLiterature.verify !== 'verified' || !selectedLiterature.coverage.abstract"
                @click="askAssistant(true, true)"
                >准备引用候选</TpButton
              >
              <p class="tp-caption">引用候选在写作页审阅，当前操作不写入正文。</p>
              <p v-if="selectedLiterature.verify !== 'verified'" class="tp-ghost library-detail-note">可收藏以便核对；来源不可用或冲突时禁止提问和引用。</p>
              <TpButton size="sm" @click="openVerification">补充来源并核验</TpButton>
              <Transition name="tp-swap">
                <form
                  v-if="verificationOpen"
                  class="library-form library-inline-form"
                  @submit.prevent="verifyLiterature"
                  @keydown.esc="
                    verificationJob?.cancel();
                    verificationOpen = false;
                  "
                >
                  <h3 class="tp-subheading">核对取得内容 · v{{ selectedLiterature.version ?? 1 }}</h3>
                  <p class="tp-caption">仅演示本地核验流程。请填实际取得的内容，不会访问外部出版数据库。</p>
                  <TpField label="来源记录" v-slot="field">
                    <textarea :id="field.id" v-model="verificationSource" class="tp-input" rows="3" :disabled="verificationStatus === 'running'" />
                  </TpField>
                  <TpField label="实际取得的摘要" v-slot="field">
                    <textarea :id="field.id" v-model="verificationAbstract" class="tp-input" rows="3" :disabled="verificationStatus === 'running'" />
                  </TpField>
                  <TpField label="核对说明" v-slot="field">
                    <textarea
                      :id="field.id"
                      v-model="verificationNote"
                      class="tp-input"
                      rows="2"
                      placeholder="说明如何核对、如何处理题录冲突"
                      :disabled="verificationStatus === 'running'"
                    />
                  </TpField>
                  <TpSelect
                    v-model="verificationScenario"
                    aria-label="来源核验场景"
                    :options="[
                      { value: 'success', label: '保存核对结果' },
                      { value: 'failed', label: '模拟超时' },
                    ]"
                  />
                  <p v-if="verificationError" role="alert">{{ verificationError }}</p>
                  <div class="screen-actions">
                    <TpButton v-if="verificationStatus !== 'running'" type="submit" size="sm" variant="primary">核验并保存来源版本</TpButton
                    ><TpButton v-else size="sm" @click="verificationJob?.cancel()">取消核验</TpButton
                    ><TpButton
                      size="sm"
                      @click="
                        verificationJob?.cancel();
                        verificationOpen = false;
                      "
                      >收起</TpButton
                    >
                  </div>
                </form>
              </Transition>
              <details v-if="selectedLiterature.history?.length" class="library-history tp-disclosure">
                <summary>来源版本记录</summary>
                <TransitionGroup name="tp-list" tag="div" class="tp-list-group" v-bind="listMotionHooks">
                  <article v-for="entry in selectedLiterature.history.slice().reverse()" :key="entry.version">
                    <b>v{{ entry.version }} · {{ entry.at }}</b>
                    <p>{{ entry.sourceText }}</p>
                    <small>{{ entry.note }}</small>
                  </article>
                </TransitionGroup>
              </details>
            </template>
            <template v-if="tab === 'requirements' && focusedRequirement"
              ><Transition name="tp-swap">
                <form
                  v-if="requirementEditor"
                  class="library-form library-inline-form"
                  @submit.prevent="saveRequirement"
                  @keydown.esc="requirementEditor = false"
                >
                  <h3 class="tp-subheading">修正要求</h3>
                  <TpField label="要求内容" :error="requirementError" v-slot="field">
                    <textarea :id="field.id" v-model="requirementDraft.text" class="tp-input" rows="3" /></TpField
                  ><TpField label="参数" v-slot="field"><input :id="field.id" v-model="requirementDraft.param" class="tp-input" /></TpField
                  ><TpField label="适用范围" v-slot="field"><input :id="field.id" v-model="requirementDraft.scope" class="tp-input" /></TpField>
                  <div class="library-form-grid">
                    <TpField label="来源资料" v-slot="field"
                      ><TpSelect
                        :id="field.id"
                        v-model="requirementDraft.sourceMaterialId"
                        @change="requirementDraft.sourceVersion = materials.find((x) => x.id === requirementDraft.sourceMaterialId)?.version ?? 0"
                        :options="[{ value: '', label: '来源缺失' }, ...materials.map((source) => ({ value: source.id, label: source.name }))]"
                    /></TpField>
                    <TpField label="来源版本" v-slot="field"
                      ><TpSelect
                        :id="field.id"
                        v-model="requirementDraft.sourceVersion"
                        :options="[
                          { value: 0, label: '未选择' },
                          ...(materials.find((source) => source.id === requirementDraft.sourceMaterialId)?.versions ?? []).map((source) => ({
                            value: source.version,
                            label: `v${source.version}`,
                          })),
                        ]"
                    /></TpField>
                  </div>
                  <TpField label="来源位置" v-slot="field"
                    ><input :id="field.id" v-model="requirementDraft.position" class="tp-input" placeholder="例如第3行或章节位置"
                  /></TpField>
                  <TpField v-if="requirementDraft.kind === 'hard'" label="检查类型" v-slot="field"
                    ><TpSelect
                      :id="field.id"
                      v-model="requirementDraft.ruleType"
                      :options="[
                        { value: 'characters', label: '字数 / 字符数' },
                        { value: 'references', label: '参考文献数量' },
                        { value: 'recentReferences', label: '近年文献比例' },
                        { value: 'chapters', label: '章节数量' },
                        { value: 'headings', label: '标题层级' },
                        { value: 'format', label: '其他格式（未检查）' },
                      ]"
                  /></TpField>
                  <div class="library-form-grid">
                    <TpField label="要求类型" v-slot="field"
                      ><TpSelect
                        :id="field.id"
                        v-model="requirementDraft.kind"
                        :options="[
                          { value: 'hard', label: '硬规则' },
                          { value: 'semantic', label: '语义要求' },
                        ]" /></TpField
                    ><TpField label="严格程度" v-slot="field"
                      ><TpSelect
                        :id="field.id"
                        v-model="requirementDraft.strictness"
                        :options="[
                          { value: '硬性', label: '硬性' },
                          { value: '建议', label: '建议' },
                          { value: '待澄清', label: '待澄清' },
                        ]"
                    /></TpField>
                  </div>
                  <div class="screen-actions">
                    <TpButton type="submit" size="sm" variant="primary">保存要求新版本</TpButton
                    ><TpButton size="sm" @click="requirementEditor = false">取消</TpButton>
                  </div>
                </form>
              </Transition>
              <Transition name="tp-swap">
                <div v-if="showHistory" class="library-history">
                  <h3 class="tp-subheading">{{ focusedRequirement.id }} 修订记录</h3>
                  <TransitionGroup name="tp-list" tag="div" class="tp-list-group" v-bind="listMotionHooks">
                    <article v-for="version in focusedRequirement.history.slice().reverse()" :key="version.version">
                      <b>v{{ version.version }} · {{ version.reason }}</b>
                      <p>{{ version.text }} {{ version.param }}</p>
                      <small
                        >{{ version.at }} · {{ version.enabled ? "启用" : "停用" }} · {{ version.scope }} · {{ version.kind }} · {{ version.strictness }}</small
                      ><small v-if="version.sourceMaterialId">{{ version.sourceMaterialId }} v{{ version.sourceVersion }} · {{ version.position }}</small>
                    </article>
                  </TransitionGroup>
                </div>
              </Transition></template
            >
          </div></Transition
        >
      </aside>
    </div>
  </div>
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
.library-list-label {
  display: flex;
  justify-content: space-between;
  padding: 16px 24px 12px;
  background: var(--tp-surface-sunken);
  border-top: 1px solid var(--tp-line);
  border-bottom: 1px solid var(--tp-line);
}
.library-file-row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  width: 100%;
  text-align: left;
  padding: 24px;
  border-bottom: 1px solid var(--tp-line);
  position: relative;
  transition: background var(--tp-dur-fast);
}
.library-file-row:hover,
.library-literature-row:hover {
  background: var(--tp-surface-sunken);
}
.library-file-row.is-selected,
.library-literature-row.is-selected {
  background: color-mix(in srgb, var(--tp-ink) 4%, var(--tp-surface));
}
.library-file-row.is-selected::before,
.library-literature-row.is-selected::before {
  content: "";
  position: absolute;
  inset: 16px auto 16px 0;
  width: 3px;
  background: var(--tp-ink);
}
.library-file-icon {
  display: grid;
  place-items: center;
  gap: 2px;
  padding: 8px 4px;
  border: 1px solid var(--tp-line-strong);
  border-radius: var(--tp-radius-xs);
  color: var(--tp-text-muted);
  background: var(--tp-surface);
}
.library-file-icon small {
  text-transform: uppercase;
  font-family: var(--tp-font-mono);
  font-size: 9px;
}
.library-file-copy {
  min-width: 0;
}
.library-file-title {
  font-weight: 600;
  line-height: 1.55;
  display: block;
  overflow-wrap: anywhere;
}
.library-file-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}
.library-file-meta i {
  width: 2px;
  height: 2px;
  background: var(--tp-text-faint);
  border-radius: 50%;
}
.library-file-state {
  display: grid;
  justify-items: end;
  gap: 8px;
}
.library-file-state small {
  color: var(--tp-text-muted);
  font-size: 11px;
}
.library-list-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  padding: 16px 24px;
  color: var(--tp-text-muted);
  font-size: 11px;
}
.library-detail {
  scroll-margin-top: 88px;
  min-width: 0;
}
.library-detail-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}
.library-detail-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.library-paper {
  position: relative;
  padding: 24px;
  background: var(--tp-surface);
  border: 1px solid var(--tp-line-strong);
  border-radius: var(--tp-radius-xs);
  box-shadow: var(--tp-shadow-1);
}
.library-paper-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--tp-text-muted);
}
.library-paper-title {
  overflow-wrap: anywhere;
  margin-top: 8px;
  font-family: var(--tp-font-prose);
  font-size: 20px;
  line-height: 1.55;
  font-weight: 600;
  text-wrap: balance;
}
.library-paper-rule {
  height: 1px;
  background: var(--tp-line-strong);
  margin: 24px 0 16px;
  width: 36px;
}
.library-paper-number {
  overflow-wrap: anywhere;
  margin-bottom: 8px;
  color: var(--tp-text-muted);
}
.library-detail-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.library-detail-note {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 12px;
  font-size: 12px;
  line-height: 1.7;
}
.library-detail-note svg {
  flex-shrink: 0;
  margin-top: 2px;
}
.library-diagnosis {
  border-left: 2px solid var(--tp-warning);
  background: var(--tp-warning-soft);
  color: var(--tp-warning-content);
}
.library-excerpt-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  font-size: 12px;
  width: 100%;
  padding-top: 4px;
}
.library-excerpt-toggle > span {
  display: flex;
  align-items: center;
  gap: 8px;
}
.library-excerpt-toggle .is-open {
  transform: rotate(180deg);
}
.library-excerpt {
  border-left: 2px solid var(--tp-line-strong);
  padding-left: 16px;
}
.library-excerpt blockquote {
  white-space: pre-line;
  font-family: var(--tp-font-prose);
  font-size: 14px;
  line-height: 1.9;
  margin: 12px 0;
}
.library-excerpt .tp-caption {
  font-size: 11px;
}
.library-excerpt .tp-caption svg {
  display: inline;
  vertical-align: text-bottom;
  margin-right: 4px;
}
.library-pending-source {
  display: grid;
  gap: 8px;
  padding: 20px;
  color: var(--tp-text-muted);
  font-size: 12px;
}
.library-section-note {
  padding: 24px;
  border-bottom: 1px solid var(--tp-line);
}
.library-requirements :deep(.tp-row) {
  padding: 20px 24px;
}
.library-empty {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 64px 24px;
  text-align: center;
  color: var(--tp-text-muted);
}
.library-literature-row {
  width: 100%;
  text-align: left;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 12px;
  padding: 24px;
  border-bottom: 1px solid var(--tp-line);
  position: relative;
  align-items: start;
}
.library-reference-no {
  color: var(--tp-text-muted);
  padding-top: 3px;
}
.library-literature-row > svg {
  margin-top: 4px;
}
.library-coverage {
  display: flex;
  gap: 4px;
  margin-top: 12px;
}
.library-coverage > span {
  border: 1px dashed var(--tp-ghost-line);
  border-radius: var(--tp-radius-xs);
  color: var(--tp-text-muted);
  font-size: 10px;
  padding: 2px 12px;
}
.library-coverage > span.is-available {
  border-style: solid;
  border-color: var(--tp-line-strong);
  background: var(--tp-surface-sunken);
  color: var(--tp-text);
}
.library-coverage--large {
  margin-top: 0;
}
.library-coverage--large > span {
  flex: 1;
  text-align: center;
  padding: 8px;
  font-size: 12px;
}
@media (max-width: 1200px) {
  .library-index {
    gap: 20px;
  }
  .library-workspace {
    gap: 24px;
    grid-template-columns: minmax(0, 1fr) 280px;
  }
  .library-file-row {
    gap: 12px;
    padding: 20px 16px;
  }
}
@media (max-width: 1050px) {
  .library-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .library-detail-content {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 20px 32px;
  }
  .library-detail-heading {
    grid-column: 1 / -1;
  }
  .library-paper {
    grid-row: span 5;
  }
  .library-detail-status {
    align-self: start;
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
  .library-index b {
    font-size: 32px;
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
  .library-file-row {
    grid-template-columns: 36px minmax(0, 1fr);
    gap: 8px 12px;
    padding: 20px 16px;
  }
  .library-file-icon {
    grid-row: span 2;
    align-self: start;
  }
  .library-file-state {
    grid-column: 2;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .library-list-label {
    padding: 12px 16px;
  }
  .library-list-label > span:last-child {
    display: none;
  }
  .library-file-title {
    font-size: 13px;
  }
  .library-file-meta {
    font-size: 11px;
    margin-top: 4px;
  }
  .library-detail-content {
    display: flex;
    gap: 20px;
  }
  .library-paper {
    padding: 24px;
  }
  .library-section-note {
    padding: 20px 16px;
  }
  .library-requirements :deep(.tp-row) {
    padding: 20px 16px;
    grid-template-columns: auto minmax(0, 1fr) !important;
  }
  .library-requirements :deep(.tp-row > .tp-status) {
    grid-column: 2;
    justify-self: start;
  }
  .library-literature-row {
    padding: 20px 16px;
    grid-template-columns: 24px minmax(0, 1fr) auto;
    gap: 8px;
  }
  .library-list-footer {
    padding: 16px;
  }
}

.library-top-actions {
  justify-content: space-between;
  margin-top: -12px;
}
.library-notice {
  padding: 12px 16px;
  border-left: 2px solid var(--tp-info);
  background: var(--tp-info-soft);
  font-size: 13px;
}
.library-form {
  display: grid;
  gap: 20px;
  padding: 24px;
}
.library-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.library-form-grid > * {
  min-width: 0;
}
.library-inline-form {
  padding: 16px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-m);
  background: var(--tp-surface);
}
.library-form .tp-input,
.library-management .tp-input,
.library-form-grid .tp-input {
  width: 100%;
  min-width: 0;
}
.library-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--tp-text-muted);
}
.library-checkbox input,
.library-literature-check input {
  flex-shrink: 0;
}
.library-requirement-wrap {
  border-bottom: 1px solid var(--tp-line);
}
.library-requirement-actions {
  padding: 0 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.library-literature-wrap {
  position: relative;
}
.library-literature-check {
  position: absolute;
  top: 24px;
  left: 16px;
  z-index: 1;
}
.library-literature-wrap .library-literature-row {
  padding-left: 48px;
}
.library-history {
  display: grid;
  gap: 12px;
  padding: 16px;
  background: var(--tp-surface);
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-m);
}
.library-history button,
.library-history article {
  padding: 12px;
  text-align: left;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.library-history button[aria-pressed="true"] {
  border-color: var(--tp-accent);
  background: var(--tp-accent-soft);
}
.library-history span,
.library-history small {
  display: block;
  margin-top: 4px;
  color: var(--tp-text-muted);
}
.library-management {
  padding: 16px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-m);
}
.library-rename {
  margin-bottom: 16px;
}
.library-definition {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  margin-top: 16px;
  font-size: 12px;
}
.library-definition dt,
.library-definition dd {
  padding: 12px 0;
  border-bottom: 1px solid var(--tp-line);
}
.library-definition dt {
  color: var(--tp-text-muted);
}
.library-definition small {
  display: block;
  margin-top: 4px;
  color: var(--tp-text-muted);
}
.library-excerpt blockquote {
  overflow-wrap: anywhere;
  max-height: 320px;
  overflow-y: auto;
}
@media (max-width: 600px) {
  .library-form {
    padding: 16px;
  }
  .library-form-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .library-literature-wrap .library-literature-row {
    padding-left: 40px;
  }
  .library-literature-check {
    left: 12px;
  }
  .library-requirements :deep(.tp-row) {
    grid-template-columns: auto minmax(0, 1fr) !important;
  }
  .library-requirements :deep(.tp-row > .tp-status) {
    grid-column: 2;
  }
}
</style>
