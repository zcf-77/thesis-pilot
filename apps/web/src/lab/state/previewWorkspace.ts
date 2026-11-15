import { computed, ref, watch, onScopeDispose, type ComputedRef } from "vue";
import { defineStore } from "pinia";
import { browserStorage, readWorkspaceStorage, writeWorkspaceStorage, WORKSPACE_STORAGE_KEY } from "../services/persistence.ts";
import { normalizeRestoredModules, safeDocumentHtml, validatePreviewProject } from "./previewBackup.ts";
import { createRemoteBinding, type RemoteProjectBinding } from "./serviceBinding.ts";
import { canonicalEditorJson, prepareEditorSnapshot } from "./editorAdapter.ts";
import type { ProjectRead } from "../../services/index.ts";

export interface PreviewEditorSnapshot {
  schemaVersion: 1;
  json: unknown;
  chapters: { id: string; title: string; level: number; position: number; end: number; words: number }[];
}

export interface PreviewDocumentVersion {
  version: number;
  html: string;
  at: string;
  cause: string;
  structure?: PreviewEditorSnapshot;
}
export interface PreviewProject {
  id: string;
  title: string;
  short: string;
  stage: string;
  deadline: string;
  workflowVersion: number;
  templateVersion: number;
  requirementVersion: number;
  planning: string;
  archived: boolean;
  sample: boolean;
  document: { html: string; version: number; savedAt: string; history: PreviewDocumentVersion[]; structure?: PreviewEditorSnapshot };
  modules: Record<string, unknown>;
  events?: PreviewEvent[];
  priorWork?: { title: string; source: string; confirmedAt: string }[];
  remoteBinding?: RemoteProjectBinding;
}
export interface PreviewEvent {
  id: string;
  projectId: string;
  title: string;
  detail: string;
  route: string;
  at: string;
  read: boolean;
  snoozed: boolean;
  dismissed: boolean;
  type?: string;
  objectId?: string;
  sourceVersion?: number;
}
export const initialHtml =
  "<h1>面向校园二手交易平台的混合推荐算法设计与实现</h1><h2>第 3 章 系统设计</h2><p>本系统采用混合推荐方法，结合协同过滤与内容特征完成候选召回。实验样例包含 1200 条记录，召回率为 82.6% [1]。</p><h3>3.1 总体架构</h3><p>系统划分为数据层、推荐层和交互层。各层通过明确的接口交换信息，以便独立验证与维护。</p><h3>3.2 对比实验</h3><p>本文以基线方法进行对照，记录相同条件下的召回结果与响应耗时。这里是自制论文样例，数据仅用于界面演示。</p>";
export function makeProject(title = "面向校园二手交易平台的混合推荐算法设计与实现", empty = false): PreviewProject {
  const html = empty ? "<p></p>" : initialHtml;
  return {
    id: crypto.randomUUID(),
    title,
    short: empty ? title : "推荐算法毕设",
    stage: empty ? "开题" : "论文撰写",
    deadline: "2026-12-25",
    workflowVersion: 1,
    templateVersion: empty ? 0 : 3,
    requirementVersion: empty ? 0 : 2,
    planning: "",
    archived: false,
    sample: !empty,
    document: { html, version: empty ? 1 : 13, savedAt: "当前预览", history: [{ version: empty ? 1 : 13, html, at: "初始样例", cause: "初始化" }] },
    modules: {},
    events: [],
    priorWork: [],
  };
}
export const usePreviewWorkspaceStore = defineStore("preview-workspace", () => {
  type SavedWorkspace = {
    format: "ThesisPilot-workspace";
    schema: 1;
    savedAt: string;
    projects: PreviewProject[];
    activeId: string;
    userName: string;
    notifications: boolean;
    quietStart: string;
    quietEnd: string;
  };
  let restored: SavedWorkspace | null = null;
  let restoreError = "";
  try {
    const value = readWorkspaceStorage(browserStorage()) as SavedWorkspace | null;
    if (value) {
      if (
        value.format !== "ThesisPilot-workspace" ||
        value.schema !== 1 ||
        !Array.isArray(value.projects) ||
        !value.projects.length ||
        !value.projects.every(validatePreviewProject) ||
        new Set(value.projects.map((p) => p.id)).size !== value.projects.length ||
        !value.projects.some((p) => p.id === value.activeId && !p.archived) ||
        typeof value.userName !== "string" ||
        typeof value.notifications !== "boolean" ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.quietStart) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.quietEnd)
      ) {
        throw new Error("本地项目数据校验失败。原存储已保留，请从有效备份恢复，或在账户页明确重置。");
      }
      restored = value;
      restored.projects.forEach((p) => normalizeRestoredModules(p.modules));
    }
  } catch (error) {
    restoreError =
      error instanceof SyntaxError
        ? "本地项目内容无法解析，原存储未被覆盖。请从备份恢复，或在账户页明确重置。"
        : error instanceof Error
          ? error.message
          : "无法读取本地项目，原存储未被覆盖。";
  }
  const projects = ref<PreviewProject[]>(restored?.projects ?? [makeProject()]);
  const activeId = ref(restored?.activeId ?? projects.value[0]!.id);
  const current = computed(() => projects.value.find((p) => p.id === activeId.value) ?? projects.value[0]!);
  const sessionActive = ref(true);
  const userName = ref(restored?.userName ?? "林知夏");
  const notifications = ref(restored?.notifications ?? true);
  const quietStart = ref(restored?.quietStart ?? "22:00");
  const quietEnd = ref(restored?.quietEnd ?? "08:00");
  const events = computed(() => projects.value.flatMap((p) => p.events ?? []));
  const saveStatus = ref<"dirty" | "saving" | "saved" | "failed">(restoreError ? "failed" : "saved");
  const saveError = ref(restoreError);
  const lastPersistedAt = ref(restored?.savedAt ?? "");
  const storageRecoveryRequired = ref(!!restoreError);
  const simulateStorageFailure = ref(false);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function persistNow() {
    clearTimeout(saveTimer);
    if (storageRecoveryRequired.value) return false;
    saveStatus.value = "saving";
    try {
      if (simulateStorageFailure.value) throw new Error("模拟存储失败：当前内容仍在，请关闭故障模拟后重试，或下载项目备份。");
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(quietStart.value) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(quietEnd.value))
        throw new Error("请填写有效的静默开始和结束时间；当前内容仍保留，修正后会重新保存。");
      const savedAt = new Date().toISOString();
      const projectSnapshot = JSON.parse(JSON.stringify(projects.value)) as unknown[];
      if (!projectSnapshot.every(validatePreviewProject)) throw new Error("当前项目未通过恢复校验，本次未覆盖本机存储。内容仍保留，请保留备份并检查最近操作。");
      writeWorkspaceStorage(browserStorage(), {
        format: "ThesisPilot-workspace",
        schema: 1,
        savedAt,
        projects: projectSnapshot,
        activeId: activeId.value,
        userName: userName.value,
        notifications: notifications.value,
        quietStart: quietStart.value,
        quietEnd: quietEnd.value,
      });
      lastPersistedAt.value = savedAt;
      saveStatus.value = "saved";
      saveError.value = "";
      return true;
    } catch (error) {
      saveStatus.value = "failed";
      saveError.value = error instanceof Error ? error.message : "本地保存失败，当前内容仍保留。";
      return false;
    }
  }
  function retrySave() {
    return persistNow();
  }
  function recoverStorage() {
    if (!storageRecoveryRequired.value) return true;
    try {
      const storage = browserStorage();
      const original = storage?.getItem(WORKSPACE_STORAGE_KEY);
      if (original) storage?.setItem(WORKSPACE_STORAGE_KEY + ".recovery", original);
      storageRecoveryRequired.value = false;
      return true;
    } catch {
      saveError.value = "无法保留原存储副本；当前内容仍在。请先下载备份，再到账户页明确重置。";
      return false;
    }
  }
  function resetWorkspace() {
    clearTimeout(saveTimer);
    storageRecoveryRequired.value = false;
    simulateStorageFailure.value = false;
    const project = makeProject();
    projects.value = [project];
    activeId.value = project.id;
    sessionActive.value = true;
    return persistNow();
  }
  watch(
    [projects, activeId, userName, notifications, quietStart, quietEnd],
    () => {
      if (storageRecoveryRequired.value) return;
      saveStatus.value = "dirty";
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persistNow, 150);
    },
    { deep: true, flush: "sync" },
  );
  const pageExit = (event: BeforeUnloadEvent) => {
    if (saveStatus.value !== "saved" && !persistNow()) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  if (typeof window !== "undefined") window.addEventListener("beforeunload", pageExit);
  onScopeDispose(() => {
    clearTimeout(saveTimer);
    if (typeof window !== "undefined") window.removeEventListener("beforeunload", pageExit);
  });
  function moduleState<T>(key: string, factory: () => T): T {
    if (!(key in current.value.modules)) current.value.modules[key] = factory();
    return current.value.modules[key] as T;
  }
  function saveDocument(html: string, cause = "手动编辑", structure?: PreviewEditorSnapshot) {
    const project = current.value;
    const doc = project.document;
    if (!safeDocumentHtml(html)) throw new Error("正文 HTML 包含不受支持的内容，本次未保存。");
    const prepared = structure === undefined ? undefined : prepareEditorSnapshot(structure);
    if (doc.structure !== undefined) {
      if (!prepared) throw new Error("正文已有结构快照，请使用结构化编辑保存；原版本已保留。");
      if (JSON.stringify(canonicalEditorJson(doc.structure.json)) === JSON.stringify(prepared.json)) return doc.version;
    } else if (!prepared && doc.html === html) {
      return doc.version;
    }

    const version = doc.version + 1;
    const savedAt = new Date().toLocaleString("zh-CN");
    const structured = prepared ? { structure: prepared } : {};
    const latest = doc.history[doc.history.length - 1];
    // Older saves could attach structure to the current version alone.
    const history =
      doc.structure && latest && latest.structure === undefined ? [...doc.history.slice(0, -1), { ...latest, structure: doc.structure }] : doc.history;
    project.document = {
      ...doc,
      html,
      version,
      savedAt,
      ...structured,
      history: [...history, { version, html, at: savedAt, cause, ...structured }],
    };
    return version;
  }
  function attachLegacyDocumentStructure(expected: { projectId: string; version: number }, structure: PreviewEditorSnapshot) {
    const project = current.value;
    const doc = project.document;
    if (project.id !== expected.projectId || doc.version !== expected.version) throw new Error("项目或正文版本已变化，请重新打开正文后转换。");
    const latest = doc.history[doc.history.length - 1];
    if (doc.structure !== undefined || latest?.structure !== undefined) throw new Error("正文已有结构快照，原版本已保留。");
    if (!latest || latest.version !== doc.version || latest.html !== doc.html || !safeDocumentHtml(doc.html))
      throw new Error("旧版正文或历史无法通过校验，原版本已保留。");
    const prepared = prepareEditorSnapshot(structure);
    project.document = {
      ...doc,
      structure: prepared,
      history: [...doc.history.slice(0, -1), { ...latest, structure: prepared }],
    };
    return doc.version;
  }
  function recordEvent(title: string, detail: string, route: string, metadata: { type?: string; objectId?: string; sourceVersion?: number } = {}) {
    const event: PreviewEvent = {
      id: crypto.randomUUID(),
      projectId: current.value.id,
      title,
      detail,
      route,
      at: new Date().toLocaleString("zh-CN"),
      read: false,
      snoozed: false,
      dismissed: false,
      ...metadata,
    };
    (current.value.events ??= []).unshift(event);
    return event;
  }
  function switchProject(id: string) {
    if (projects.value.some((p) => p.id === id && !p.archived)) activeId.value = id;
  }
  function createProject(title: string, empty = true) {
    const p = makeProject(title, empty);
    projects.value.push(p);
    activeId.value = p.id;
    return p;
  }
  function openServiceProject(project: ProjectRead, sourceKey: string) {
    const binding = createRemoteBinding(project, sourceKey);
    let local = projects.value.find((item) => item.remoteBinding?.sourceKey === sourceKey && item.remoteBinding.projectId === project.id);
    if (local && local.remoteBinding!.metadataVersion > project.version) throw new Error("项目详情已过期，请刷新后重新打开；本机内容未改变。");
    if (!local) {
      local = makeProject(project.name, true);
      projects.value.push(local);
    }
    // Only a deliberate Open operation updates confirmed metadata. Local IDs,
    // manuscript, plans, evidence, feedback and history remain on this object.
    local.title = project.name;
    local.short = project.name.length > 14 ? project.name.slice(0, 14) + "…" : project.name;
    local.remoteBinding = binding;
    local.archived = false;
    activeId.value = local.id;
    return local;
  }
  return {
    projects,
    activeId,
    current,
    sessionActive,
    userName,
    notifications,
    quietStart,
    quietEnd,
    events,
    moduleState,
    saveDocument,
    attachLegacyDocumentStructure,
    recordEvent,
    switchProject,
    createProject,
    openServiceProject,
    saveStatus,
    saveError,
    lastPersistedAt,
    storageRecoveryRequired,
    simulateStorageFailure,
    persistNow,
    retrySave,
    recoverStorage,
    resetWorkspace,
  };
});
export function usePreviewModule<T>(key: string, factory: () => T): ComputedRef<T> {
  const workspace = usePreviewWorkspaceStore();
  return computed(() => workspace.moduleState(key, factory));
}
