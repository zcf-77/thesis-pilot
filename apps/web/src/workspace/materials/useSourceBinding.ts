import { computed, onScopeDispose, ref, shallowRef } from "vue";
import type { BackendServices } from "../../services/index.ts";
import { asApiError } from "../../services/errors.ts";

type Binding = Awaited<ReturnType<BackendServices["materials"]["sourceBinding"]>>;
type HistoryPage = Awaited<ReturnType<BackendServices["materials"]["sourceBindingVersions"]>>;
type History = Awaited<ReturnType<BackendServices["materials"]["sourceBindingVersion"]>>;
export interface BindingChoice {
  id: string;
  kind: string;
  name: string;
  materialId: string;
  originalId: string;
  original: number;
  version: number;
}
export type SourceBindingState = ReturnType<typeof useSourceBinding>;

export const bindingChoiceLabel = (item: Pick<BindingChoice, "name" | "original" | "version">) => `${item.name} · 原件v${item.original} · 解析v${item.version}`;

/**
 * One project binding snapshot shared by the requirements tab and the template detail.
 * Every save sends the full snapshot with the version it was read at, so a template bind never drops requirements.
 */
export function useSourceBinding(services: BackendServices, projectId: () => string) {
  const binding = shallowRef<Binding>();
  const choices = shallowRef<BindingChoice[]>([]);
  const loading = ref(false);
  const optionLoading = ref(false);
  const busy = ref(false);
  const error = ref("");
  const optionError = ref("");
  const mustReload = ref(false);
  const boundRequirementItems = ref<number>();
  const history = shallowRef<HistoryPage>();
  const viewing = shallowRef<History>();
  const historyBusy = ref(false);
  const historyError = ref("");
  let currentRequest: AbortController | undefined;
  let optionsRequest: AbortController | undefined;
  let saveRequest: AbortController | undefined;
  let historyRequest: AbortController | undefined;
  let countRequest: AbortController | undefined;

  const choice = (id: string | null | undefined) => (id ? choices.value.find((item) => item.id === id) : undefined);
  const sourceLabel = (id: string | null | undefined) => (id ? (choice(id) ? bindingChoiceLabel(choice(id)!) : "固定解析版本（来源不可用）") : "未绑定");
  const templateChoice = computed(() => choice(binding.value?.template_parse_version_id));

  async function load() {
    currentRequest?.abort();
    const controller = new AbortController();
    currentRequest = controller;
    loading.value = true;
    error.value = "";
    try {
      const latest = await services.materials.sourceBinding(projectId(), controller.signal);
      if (!controller.signal.aborted) {
        binding.value = latest;
        mustReload.value = false;
        void countRequirements();
      }
    } catch (problem) {
      if (!controller.signal.aborted) error.value = asApiError(problem).message;
    } finally {
      if (!controller.signal.aborted) loading.value = false;
    }
  }

  async function loadOptions() {
    optionsRequest?.abort();
    const controller = new AbortController();
    optionsRequest = controller;
    optionLoading.value = true;
    optionError.value = "";
    const found: BindingChoice[] = [];
    const project = projectId();
    try {
      let offset = 0;
      do {
        const materials = await services.materials.list(project, { offset, limit: 100 }, controller.signal);
        if (controller.signal.aborted) return;
        for (const material of materials.items) {
          if (!["template", "requirements"].includes(material.kind) || material.removed || !material.linked) continue;
          let originalOffset = 0;
          do {
            const originals = await services.materials.originals(project, material.id, { offset: originalOffset, limit: 100 }, controller.signal);
            if (controller.signal.aborted) return;
            for (const original of originals.items) {
              let parseOffset = 0;
              do {
                const parses = await services.materials.parses(project, material.id, original.id, { offset: parseOffset, limit: 100 }, controller.signal);
                if (controller.signal.aborted) return;
                found.push(
                  ...parses.items.map((item) => ({
                    id: item.id,
                    kind: material.kind,
                    name: material.name,
                    materialId: material.id,
                    originalId: original.id,
                    original: original.version,
                    version: item.version,
                  })),
                );
                parseOffset += parses.items.length;
                if (!parses.items.length || parseOffset >= parses.total) break;
              } while (!controller.signal.aborted);
            }
            originalOffset += originals.items.length;
            if (!originals.items.length || originalOffset >= originals.total) break;
          } while (!controller.signal.aborted);
        }
        offset += materials.items.length;
        if (!materials.items.length || offset >= materials.total) break;
      } while (!controller.signal.aborted);
      choices.value = found;
      void countRequirements();
    } catch (problem) {
      if (!controller.signal.aborted) {
        choices.value = found;
        optionError.value = `可绑定版本仅部分读取：${asApiError(problem).message}`;
      }
    } finally {
      if (!controller.signal.aborted) optionLoading.value = false;
    }
  }

  /** Count requirement items inside the bound parse versions; unknown stays undefined instead of zero. */
  async function countRequirements() {
    countRequest?.abort();
    const ids = binding.value?.requirement_parse_version_ids ?? [];
    if (!ids.length) {
      boundRequirementItems.value = binding.value ? 0 : undefined;
      return;
    }
    const resolved = ids.map(choice);
    if (resolved.some((item) => !item)) {
      boundRequirementItems.value = undefined;
      return;
    }
    const controller = new AbortController();
    countRequest = controller;
    try {
      const parsed = await Promise.all(
        resolved.map((item) => services.materials.parse(projectId(), item!.materialId, item!.originalId, item!.id, controller.signal)),
      );
      if (!controller.signal.aborted) boundRequirementItems.value = parsed.reduce((sum, item) => sum + item.result.requirements.length, 0);
    } catch {
      if (!controller.signal.aborted) boundRequirementItems.value = undefined;
    }
  }

  async function save(next: { template?: string | null; requirements?: string[] }): Promise<Binding | undefined> {
    const current = binding.value;
    if (!current || busy.value || mustReload.value) return;
    const requirements = next.requirements ?? current.requirement_parse_version_ids;
    if (requirements.length > 50) {
      error.value = "每个绑定快照最多选择 50 个要求解析版本。";
      return;
    }
    saveRequest?.abort();
    const controller = new AbortController();
    saveRequest = controller;
    busy.value = true;
    error.value = "";
    try {
      const latest = await services.materials.updateSourceBinding(
        projectId(),
        {
          expected_version: current.version,
          template_parse_version_id: next.template !== undefined ? next.template : current.template_parse_version_id,
          requirement_parse_version_ids: [...requirements],
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      binding.value = latest;
      history.value = undefined;
      viewing.value = undefined;
      void countRequirements();
      return latest;
    } catch (problem) {
      if (!controller.signal.aborted) {
        const issue = asApiError(problem);
        mustReload.value = issue.status === 409 || issue.status === undefined || issue.status >= 500 || issue.code === "INVALID_RESPONSE";
        error.value = mustReload.value ? `${issue.message} 选择已保留，请载入最新绑定后重新核对。` : issue.message;
      }
    } finally {
      if (!controller.signal.aborted) busy.value = false;
    }
  }

  async function loadHistory(offset = 0) {
    historyRequest?.abort();
    const controller = new AbortController();
    historyRequest = controller;
    historyBusy.value = true;
    historyError.value = "";
    try {
      const page = await services.materials.sourceBindingVersions(projectId(), { offset, limit: 20 }, controller.signal);
      if (!controller.signal.aborted) {
        history.value = page;
        viewing.value = page.items[0];
      }
    } catch (problem) {
      if (!controller.signal.aborted) historyError.value = asApiError(problem).message;
    } finally {
      if (!controller.signal.aborted) historyBusy.value = false;
    }
  }

  async function viewHistory(version: number) {
    historyRequest?.abort();
    const controller = new AbortController();
    historyRequest = controller;
    historyBusy.value = true;
    historyError.value = "";
    try {
      const item = await services.materials.sourceBindingVersion(projectId(), version, controller.signal);
      if (!controller.signal.aborted) viewing.value = item;
    } catch (problem) {
      if (!controller.signal.aborted) historyError.value = asApiError(problem).message;
    } finally {
      if (!controller.signal.aborted) historyBusy.value = false;
    }
  }

  function stop() {
    for (const request of [currentRequest, optionsRequest, saveRequest, historyRequest, countRequest]) request?.abort();
    loading.value = optionLoading.value = busy.value = historyBusy.value = false;
  }
  onScopeDispose(stop);

  return {
    binding,
    choices,
    loading,
    optionLoading,
    busy,
    error,
    optionError,
    mustReload,
    boundRequirementItems,
    history,
    viewing,
    historyBusy,
    historyError,
    templateChoice,
    choice,
    sourceLabel,
    load,
    loadOptions,
    save,
    loadHistory,
    viewHistory,
    stop,
  };
}
