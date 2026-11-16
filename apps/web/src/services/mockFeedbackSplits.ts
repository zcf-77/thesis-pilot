import type { ConfigurationProbeConfiguration, FeedbackSplitRead, JobRead } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import { splitCreateInput, splitDecideInput } from "./httpFeedbackSplits.ts";
import type { FeedbackService, FeedbackSplitService, JobService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

/**
 * Deterministic in-memory adapter with the HTTP contract. Like the server without
 * credentials, the mock queue fails every split job and never invents suggestions.
 */
export function createMockFeedbackSplits(
  before: (signal?: AbortSignal) => Promise<void>,
  requireProject: (id: string) => unknown,
  feedback: FeedbackService,
  configuration: (versionId: string) => ConfigurationProbeConfiguration,
  jobs: JobService,
  enqueue: (projectId: string, splitId: string, sourceJobId?: string) => JobRead,
): FeedbackSplitService {
  const runs = new Map<string, FeedbackSplitRead>();
  const commands = new Map<string, { fingerprint: string; splitId: string }>();

  function find(projectId: string, splitId: string) {
    requireProject(requireUuid(projectId));
    const value = runs.get(requireUuid(splitId).toLowerCase());
    if (!value || value.project_id !== projectId.toLowerCase()) throw new ApiError("FEEDBACK_SPLIT_NOT_FOUND", { status: 404 });
    return value;
  }
  async function refresh(value: FeedbackSplitRead) {
    const job = await jobs.get(value.job_id, undefined, value.project_id);
    Object.assign(value, { status: job.status, error_code: job.error_code, attempt: job.attempt, updated_at: job.updated_at });
    return parseDto("FeedbackSplitRead", structuredClone(value));
  }
  async function receipt(value: FeedbackSplitRead) {
    const split = await refresh(value);
    const { attempts: _attempts, artifacts: _artifacts, ...job } = await jobs.get(value.job_id, undefined, value.project_id);
    return parseDto("FeedbackSplitReceipt", { split, job });
  }
  async function busy(batchId: string) {
    for (const item of runs.values()) {
      if (item.batch_id !== batchId) continue;
      const current = await refresh(item);
      if (current.status === "queued" || current.status === "running") throw new ApiError("FEEDBACK_SPLIT_BUSY", { status: 409 });
    }
  }
  function remember(commandId: string, fingerprint: string) {
    const previous = commands.get(commandId);
    if (previous && previous.fingerprint !== fingerprint) throw new ApiError("FEEDBACK_SPLIT_COMMAND_CONFLICT", { status: 409 });
    return previous ? runs.get(previous.splitId) : undefined;
  }
  function freeze(versionId: string) {
    const frozen = configuration(versionId);
    if (frozen.config_kind !== "agent" || frozen.agent?.role !== "content" || !frozen.model?.capabilities.includes("text"))
      throw new ApiError("FEEDBACK_SPLIT_AGENT_INVALID", { status: 422 });
    return frozen;
  }
  function insert(projectId: string, batchId: string, agentId: string, frozen: ConfigurationProbeConfiguration, source?: FeedbackSplitRead) {
    const id = crypto.randomUUID();
    const job = enqueue(projectId, id, source?.job_id);
    const value: FeedbackSplitRead = {
      id,
      project_id: projectId.toLowerCase(),
      batch_id: batchId,
      job_id: job.id,
      status: job.status,
      error_code: null,
      attempt: 0,
      agent_config_version_id: agentId,
      agent_name: "整理智能体",
      config_version_ids: { ...frozen.version_ids },
      source_split_id: source?.id ?? null,
      requested_model: null,
      response_model: null,
      note: "",
      suggestions: [],
      created_at: job.created_at,
      updated_at: job.updated_at,
    };
    runs.set(id, parseDto("FeedbackSplitRead", value));
    return runs.get(id)!;
  }

  return {
    async create(projectId, batchId, input, signal) {
      await before(signal);
      requireProject(requireUuid(projectId));
      const data = splitCreateInput(input);
      const batch = (await feedback.get(projectId, batchId, signal)).id;
      const fingerprint = JSON.stringify({ projectId: projectId.toLowerCase(), op: "create", batch, agent: data.agent_config_version_id });
      const previous = remember(data.command_id, fingerprint);
      if (previous) return receipt(previous);
      await busy(batch);
      const value = insert(projectId, batch, data.agent_config_version_id, freeze(data.agent_config_version_id));
      commands.set(data.command_id, { fingerprint, splitId: value.id });
      return receipt(value);
    },
    async list(projectId, batchId, query, signal) {
      await before(signal);
      const batch = (await feedback.get(projectId, batchId, signal)).id;
      const { limit, offset } = pageQuery(query);
      const ordered = [...runs.values()]
        .filter((item) => item.project_id === projectId.toLowerCase() && item.batch_id === batch)
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      const items = await Promise.all(ordered.slice(offset, offset + Math.min(limit, 50)).map(refresh));
      return parseDto("FeedbackSplitPage", { items, total: ordered.length, limit: Math.min(limit, 50), offset });
    },
    async get(projectId, splitId, signal) {
      await before(signal);
      return refresh(find(projectId, splitId));
    },
    async cancel(projectId, splitId, signal) {
      await before(signal);
      const value = find(projectId, splitId);
      await jobs.cancel(value.job_id, signal, value.project_id);
      return refresh(value);
    },
    async retry(projectId, splitId, input, signal) {
      await before(signal);
      const source = await refresh(find(projectId, splitId));
      const commandId = parseDto("FeedbackSplitRetry", { command_id: input.command_id.toLowerCase() }, true).command_id;
      const fingerprint = JSON.stringify({ projectId: projectId.toLowerCase(), op: "retry", splitId: source.id });
      const previous = remember(commandId, fingerprint);
      if (previous) return receipt(previous);
      if (source.status !== "failed" && source.status !== "cancelled") throw new ApiError("FEEDBACK_SPLIT_RETRY_INVALID", { status: 409 });
      await busy(source.batch_id);
      const value = insert(projectId, source.batch_id, source.agent_config_version_id, freeze(source.agent_config_version_id), source);
      commands.set(commandId, { fingerprint, splitId: value.id });
      return receipt(value);
    },
    async decide(projectId, splitId, input, signal) {
      await before(signal);
      splitDecideInput(input);
      const value = await refresh(find(projectId, splitId));
      // The mock never produces suggestions, so there is never anything to decide.
      if (value.status !== "succeeded") throw new ApiError("FEEDBACK_SPLIT_NOT_READY", { status: 409 });
      throw new ApiError("FEEDBACK_SPLIT_NOT_FOUND", { status: 404 });
    },
  };
}
