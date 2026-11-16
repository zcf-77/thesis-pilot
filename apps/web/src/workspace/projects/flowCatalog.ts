import { computed, onScopeDispose, ref, shallowRef } from "vue";
import type { PageQuery, ProjectFlowService } from "../../services/index.ts";
import { ApiError, asApiError } from "../../services/errors.ts";
import { projectBindingError } from "../projectLifecycle.ts";

export type Flow = Awaited<ReturnType<ProjectFlowService["get"]>>;
export type FlowVersion = Awaited<ReturnType<ProjectFlowService["version"]>>;
export interface FlowBinding {
  flow: Flow;
  version: FlowVersion;
}

/** Reads every page of a paged endpoint; a short or shifted page is rejected instead of being treated as complete. */
export async function readAll<T>(read: (query: PageQuery) => Promise<{ items: T[]; total: number; offset: number }>, signal: AbortSignal, limit = 100) {
  const all: T[] = [];
  for (;;) {
    const page = await read({ offset: all.length, limit });
    if (signal.aborted) return all;
    if (page.offset !== all.length || page.items.length > limit) throw new ApiError("INVALID_RESPONSE");
    all.push(...page.items);
    if (!page.items.length || all.length >= page.total) return all;
  }
}

/** Maps every immutable flow version ID to its flow, so a project's binding is shown without assuming it is the latest version. */
export async function loadFlowCatalog(projectFlows: ProjectFlowService, signal: AbortSignal) {
  const flows = await readAll((query) => projectFlows.list(query, signal), signal);
  const versions = new Map<string, FlowBinding>();
  await Promise.all(
    flows.map(async (flow) => {
      for (const version of await readAll((query) => projectFlows.versions(flow.id, query, signal), signal)) versions.set(version.id, { flow, version });
    }),
  );
  return { flows, versions };
}

export function stageName(binding: FlowBinding | undefined, stageId: string | null) {
  return binding?.version.stages.find((stage) => stage.id === stageId)?.name;
}

/** Flow, version and stage choices shared by the setup wizard and project settings. */
export function useFlowPicker(projectFlows: ProjectFlowService) {
  const flows = shallowRef<Flow[]>([]);
  const versions = shallowRef<FlowVersion[]>([]);
  const selectedFlow = ref("");
  const versionId = ref("");
  const stageId = ref("");
  const busy = ref(false);
  const error = ref("");
  const boundVersion = ref("");
  let request: AbortController | undefined;

  const selectedVersion = computed(() => versions.value.find((item) => item.id === versionId.value));
  const flowOptions = computed(() => [
    { value: "", label: "不绑定流程" },
    ...flows.value.map((flow) => ({
      value: flow.id,
      label: `${flow.name}${flow.enabled ? "" : "（已停用，仅保留原绑定）"}`,
      disabled: !flow.enabled && !versions.value.some((version) => version.flow_id === flow.id && version.id === boundVersion.value),
    })),
  ]);
  const versionOptions = computed(() => [
    { value: "", label: "选择明确版本" },
    ...versions.value.map((item) => ({ value: item.id, label: `${item.name} · v${item.version}` })),
  ]);
  const stageOptions = computed(() => [
    { value: "", label: "选择当前阶段" },
    ...(selectedVersion.value?.stages ?? []).map((stage) => ({
      value: stage.id,
      label: `${stage.name}${stage.enabled === false ? "（已停用）" : ""}`,
      disabled: stage.enabled === false,
    })),
  ]);

  function begin() {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    busy.value = true;
    error.value = "";
    return controller;
  }

  /** Loads all flows, then the versions of the flow that holds `binding` (if any). */
  async function load(binding: string, stage: string) {
    const controller = begin();
    boundVersion.value = binding;
    versionId.value = binding;
    stageId.value = stage;
    selectedFlow.value = "";
    versions.value = [];
    try {
      const all = await readAll((query) => projectFlows.list(query, controller.signal), controller.signal);
      if (controller.signal.aborted) return;
      flows.value = all;
      if (!binding) return;
      for (const flow of all) {
        const found = await readAll((query) => projectFlows.versions(flow.id, query, controller.signal), controller.signal);
        if (controller.signal.aborted) return;
        if (found.some((version) => version.id === binding)) {
          selectedFlow.value = flow.id;
          versions.value = found;
          return;
        }
      }
      error.value = "无法定位原绑定版本；请重试读取流程，原绑定暂时保留。";
    } catch (problem) {
      if (!controller.signal.aborted) error.value = asApiError(problem).message;
    } finally {
      if (request === controller) busy.value = false;
    }
  }

  async function chooseFlow(id: string) {
    selectedFlow.value = id;
    versionId.value = "";
    stageId.value = "";
    versions.value = [];
    if (!id) {
      request?.abort();
      busy.value = false;
      error.value = "";
      return;
    }
    const controller = begin();
    try {
      const found = await readAll((query) => projectFlows.versions(id, query, controller.signal), controller.signal);
      if (!controller.signal.aborted) versions.value = found;
    } catch (problem) {
      if (!controller.signal.aborted) error.value = asApiError(problem).message;
    } finally {
      if (request === controller) busy.value = false;
    }
  }

  /** The draft binding error, or "" when the binding is unchanged or valid. */
  function bindingError(unchanged: boolean) {
    if (unchanged) return "";
    if (selectedFlow.value && !versionId.value) return "请选择明确的流程版本。";
    const issue = projectBindingError(versionId.value, stageId.value, selectedVersion.value?.stages ?? []);
    if (issue) return issue;
    if (selectedFlow.value && !flows.value.find((flow) => flow.id === selectedFlow.value)?.enabled) return "已停用流程不能建立新绑定，请选择启用中的流程。";
    return "";
  }

  function stop() {
    request?.abort();
    busy.value = false;
  }
  onScopeDispose(stop);

  return {
    flows,
    versions,
    selectedFlow,
    versionId,
    stageId,
    selectedVersion,
    busy,
    error,
    flowOptions,
    versionOptions,
    stageOptions,
    load,
    chooseFlow,
    bindingError,
    stop,
  };
}
