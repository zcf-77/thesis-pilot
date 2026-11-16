import type { ApiTypes, FeedbackSplitRead, FeedbackSplitReceipt, SchemaName } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { FeedbackSplitService, PageQuery } from "./types.ts";
import { isFeedbackSplitInput, pageQuery, parseDto, requireUuid } from "./validation.ts";

type Request = <Name extends SchemaName>(path: string, schema: Name, method?: string, body?: unknown, signal?: AbortSignal) => Promise<ApiTypes[Name]>;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const runs = (projectId: string, batchId: string) => `/projects/${requireUuid(projectId)}/feedback/${requireUuid(batchId)}/splits`;
const path = (projectId: string, splitId: string) => `/projects/${requireUuid(projectId)}/feedback-splits/${requireUuid(splitId)}`;

/** Server facts must match the requested project/run; suggestions exist only after success. */
export function splitRead(value: FeedbackSplitRead, projectId: string, splitId?: string, batchId?: string): FeedbackSplitRead {
  if (
    !same(value.project_id, projectId) ||
    (splitId !== undefined && !same(value.id, splitId)) ||
    (batchId !== undefined && !same(value.batch_id, batchId)) ||
    (value.status !== "succeeded" && value.suggestions.length > 0)
  )
    throw new ApiError("INVALID_RESPONSE");
  return value;
}

export function splitReceipt(value: FeedbackSplitReceipt, projectId: string, batchId?: string): FeedbackSplitReceipt {
  splitRead(value.split, projectId, undefined, batchId);
  const { job } = value;
  if (
    job.kind !== "feedback_decomposition" ||
    !same(job.id, value.split.job_id) ||
    !same(job.project_id, projectId) ||
    !isFeedbackSplitInput(job.input_snapshot) ||
    !same(job.input_snapshot.split_id, value.split.id)
  )
    throw new ApiError("INVALID_RESPONSE");
  return value;
}

export const splitCreateInput = (input: ApiTypes["FeedbackSplitCreate"]) =>
  parseDto("FeedbackSplitCreate", { command_id: input.command_id.toLowerCase(), agent_config_version_id: input.agent_config_version_id.toLowerCase() }, true);

export const splitDecideInput = (input: ApiTypes["FeedbackSplitDecide"]) => parseDto("FeedbackSplitDecide", structuredClone(input), true);

export function createHttpFeedbackSplits(request: Request): FeedbackSplitService {
  return {
    async create(projectId, batchId, input, signal) {
      return splitReceipt(await request(runs(projectId, batchId), "FeedbackSplitReceipt", "POST", splitCreateInput(input), signal), projectId, batchId);
    },
    async list(projectId, batchId, query?: PageQuery, signal?) {
      const { limit, offset } = pageQuery(query);
      const value = await request(`${runs(projectId, batchId)}?limit=${Math.min(limit, 50)}&offset=${offset}`, "FeedbackSplitPage", "GET", undefined, signal);
      if (value.offset !== offset || value.items.length > value.limit || value.total < value.items.length) throw new ApiError("INVALID_RESPONSE");
      value.items.forEach((item) => splitRead(item, projectId, undefined, batchId));
      return value;
    },
    async get(projectId, splitId, signal) {
      return splitRead(await request(path(projectId, splitId), "FeedbackSplitRead", "GET", undefined, signal), projectId, splitId);
    },
    async cancel(projectId, splitId, signal) {
      return splitRead(await request(`${path(projectId, splitId)}/cancel`, "FeedbackSplitRead", "POST", undefined, signal), projectId, splitId);
    },
    async retry(projectId, splitId, input, signal) {
      const data = parseDto("FeedbackSplitRetry", { command_id: input.command_id.toLowerCase() }, true);
      const value = splitReceipt(await request(`${path(projectId, splitId)}/retry`, "FeedbackSplitReceipt", "POST", data, signal), projectId);
      if (!value.split.source_split_id || !same(value.split.source_split_id, splitId)) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async decide(projectId, splitId, input, signal) {
      return splitRead(
        await request(`${path(projectId, splitId)}/decisions`, "FeedbackSplitRead", "POST", splitDecideInput(input), signal),
        projectId,
        splitId,
      );
    },
  };
}
