import type { StageView } from "../../domain/types.ts";
import type { FlowStage, FlowVersionRead } from "../../services/contracts/api.generated.ts";
import { ApiError } from "../../services/errors.ts";
import type { ProjectFlowService } from "../../services/index.ts";

const PAGE = 100;
/** Flow versions are immutable, so a resolved binding can be reused for the lifetime of the service instance. */
const resolved = new WeakMap<ProjectFlowService, Map<string, FlowVersionRead>>();

/** The project stores only the bound version id; locate it without assuming it is the latest version of its flow. */
export async function findFlowVersion(flows: ProjectFlowService, versionId: string, signal: AbortSignal): Promise<FlowVersionRead | undefined> {
  const cache = resolved.get(flows) ?? new Map<string, FlowVersionRead>();
  resolved.set(flows, cache);
  const known = cache.get(versionId);
  if (known) return known;
  for (let offset = 0; ;) {
    const page = await flows.list({ offset, limit: PAGE }, signal);
    if (page.offset !== offset || page.items.length > PAGE) throw new ApiError("INVALID_RESPONSE");
    for (const flow of page.items) {
      for (let versionOffset = 0; ;) {
        const versions = await flows.versions(flow.id, { offset: versionOffset, limit: PAGE }, signal);
        if (versions.offset !== versionOffset || versions.items.length > PAGE) throw new ApiError("INVALID_RESPONSE");
        const found = versions.items.find((item) => item.id === versionId);
        if (found) {
          if (found.flow_id !== flow.id) throw new ApiError("INVALID_RESPONSE");
          cache.set(versionId, found);
          return found;
        }
        versionOffset += versions.items.length;
        if (!versions.items.length || versionOffset >= versions.total) break;
      }
    }
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) return undefined;
  }
}

export interface ShellStageProgress {
  stages: StageView[];
  sourceStages: FlowStage[];
  currentIndex: number;
  issue: string;
}

/** Only the explicit project binding defines the route; earlier stages are not marked done without a recorded confirmation. */
export function shellStageProgress(version: FlowVersionRead, stageId: string | null): ShellStageProgress {
  const sourceStages = version.stages.filter((stage) => stage.enabled !== false);
  const currentIndex = stageId ? sourceStages.findIndex((stage) => stage.id === stageId) : -1;
  const issue = !sourceStages.length ? "绑定流程没有启用的阶段" : currentIndex < 0 ? "当前阶段不在绑定流程中" : "";
  return {
    stages: sourceStages.map((stage, index) => ({
      id: stage.id,
      name: stage.name,
      state: index === currentIndex ? "current" : "upcoming",
      date: stage.deadline || undefined,
      note: stage.conditions.join("；") || undefined,
    })),
    sourceStages,
    currentIndex,
    issue,
  };
}
