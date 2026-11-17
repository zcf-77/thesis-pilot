import { computed, ref, shallowRef } from "vue";
import type { CitationCandidateRead, CitationListRead, LiteratureEntryRead } from "../../services/contracts/api.generated.ts";
import { asApiError } from "../../services/errors.ts";
import type { BackendServices } from "../../services/index.ts";
import type { PreviewHighlight } from "@muffin-office/vue/docs-anchors";
import { candidateOverlays, citableEntries, type PanelDocument } from "./citationView.ts";

export interface CitationsInput {
  services: () => BackendServices;
  projectId: () => string;
  document: () => PanelDocument | null;
}

const ENTRY_LIMIT = 100;
const RECENT_APPLIED = 5;

/**
 * 引用面板的数据与命令。每次读取以“文档 + 版本”为键，迟到响应不覆盖新版本；
 * 命令重复点击由 pending 锁住，命令标识每次新建，服务端按标识幂等。
 */
export function useCitations(input: CitationsInput) {
  const entries = shallowRef<LiteratureEntryRead[]>([]);
  const list = shallowRef<CitationListRead>();
  const candidates = shallowRef<CitationCandidateRead[]>([]);
  const loading = ref(false);
  const loadError = ref("");
  const actionError = ref("");
  const pending = ref("");
  const entryId = ref("");
  let request: AbortController | undefined;
  let loadedKey = "";

  const key = () => {
    const document = input.document();
    return document ? `${input.projectId()}:${document.id}:${document.version}` : "";
  };
  const citable = computed(() => citableEntries(entries.value));
  const ready = computed(() => candidates.value.filter((item) => item.status === "ready"));
  const overlays = computed<PreviewHighlight[]>(() => {
    const snapshot = input.document()?.snapshot;
    return ready.value.flatMap((item) => candidateOverlays(item, snapshot));
  });

  function upsert(item: CitationCandidateRead) {
    const rest = candidates.value.filter((current) => current.id !== item.id);
    candidates.value = [item, ...rest];
  }

  async function load(force = false) {
    const document = input.document();
    const current = key();
    if (!document || (!force && current === loadedKey && !loadError.value)) return;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    loading.value = true;
    loadError.value = "";
    const services = input.services();
    const projectId = input.projectId();
    const [entryPage, cited, waiting, applied] = await Promise.allSettled([
      services.literature.entries(projectId, { limit: ENTRY_LIMIT }, controller.signal),
      services.citations.list(projectId, document.id, undefined, controller.signal),
      services.citations.candidates(projectId, document.id, { status: "ready", limit: 20 }, controller.signal),
      services.citations.candidates(projectId, document.id, { status: "applied", limit: RECENT_APPLIED }, controller.signal),
    ]);
    if (controller.signal.aborted || key() !== current) return;
    const failures: string[] = [];
    if (entryPage.status === "fulfilled") entries.value = entryPage.value.items;
    else failures.push(`项目文献：${asApiError(entryPage.reason).message}`);
    if (cited.status === "fulfilled") list.value = cited.value;
    else failures.push(`已引用文献：${asApiError(cited.reason).message}`);
    if (waiting.status === "fulfilled" && applied.status === "fulfilled")
      candidates.value = [...waiting.value.items, ...applied.value.items.filter((item) => item.undoable)];
    else failures.push(`引用候选：${asApiError(waiting.status === "rejected" ? waiting.reason : (applied as PromiseRejectedResult).reason).message}`);
    loadError.value = failures.join(" ");
    loadedKey = current;
    loading.value = false;
    if (!citable.value.some((entry) => entry.id === entryId.value)) entryId.value = citable.value[0]?.id ?? "";
  }

  async function run<T>(name: string, action: (services: BackendServices, projectId: string, document: PanelDocument) => Promise<T>): Promise<T | undefined> {
    const document = input.document();
    if (!document || pending.value) return undefined;
    pending.value = name;
    actionError.value = "";
    try {
      return await action(input.services(), input.projectId(), document);
    } catch (problem) {
      actionError.value = asApiError(problem).message;
      return undefined;
    } finally {
      pending.value = "";
    }
  }

  const create = (placement: { node_id: string; offset: number }, entry = entryId.value) =>
    run("create", async (services, projectId, document) => {
      const item = await services.citations.create(projectId, document.id, {
        command_id: crypto.randomUUID(),
        base_version: document.version,
        entry_id: entry,
        placement,
      });
      if (key().endsWith(`:${document.version}`)) upsert(item);
      return item;
    });

  /** 采纳与撤销会形成新正文版本：返回 true 时写作页须重载正文并清空撤销栈。 */
  const apply = (candidate: CitationCandidateRead) =>
    run(`apply:${candidate.id}`, async (services, projectId, document) => {
      const item = await services.citations.apply(projectId, document.id, candidate.id, {
        command_id: crypto.randomUUID(),
        expected_revision: candidate.revision,
        expected_document_version: document.version,
      });
      upsert(item);
      return item.status === "applied";
    });

  const reject = (candidate: CitationCandidateRead) =>
    run(`reject:${candidate.id}`, async (services, projectId, document) => {
      const item = await services.citations.reject(projectId, document.id, candidate.id, {
        command_id: crypto.randomUUID(),
        expected_revision: candidate.revision,
      });
      candidates.value = candidates.value.filter((current) => current.id !== item.id);
      return true;
    });

  const undo = (candidate: CitationCandidateRead) =>
    run(`undo:${candidate.id}`, async (services, projectId, document) => {
      const item = await services.citations.undo(projectId, document.id, candidate.id, {
        command_id: crypto.randomUUID(),
        expected_document_version: document.version,
      });
      candidates.value = candidates.value.filter((current) => current.id !== item.id);
      return item.status === "undone";
    });

  /** 过期候选按原文献与原位置在当前正文重新生成；位置已不存在时由服务端明确拒绝。 */
  const regenerate = async (candidate: CitationCandidateRead) => {
    const item = await create(candidate.placement, candidate.entry.id);
    if (item) candidates.value = candidates.value.filter((current) => current.id !== candidate.id);
    return item;
  };

  function dispose() {
    request?.abort();
  }

  return {
    entries,
    citable,
    list,
    candidates,
    ready,
    overlays,
    loading,
    loadError,
    actionError,
    pending,
    entryId,
    load,
    create,
    apply,
    reject,
    undo,
    regenerate,
    dispose,
  };
}
