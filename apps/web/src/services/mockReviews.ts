import type { ConfigurationProbeConfiguration, JobRead, ReviewRead, ReviewRubricRead } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import { reviewInput } from "./httpReviews.ts";
import type { MockDocuments } from "./mockDocuments.ts";
import type { JobService, MaterialService, ReviewService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

/** Mirrors the server's fixed rubric definition; never a school or teacher standard. */
export const MOCK_RUBRIC: ReviewRubricRead = {
  version: "thesispilot-review-1",
  title: "基础评审量表 v1",
  description: "ThesisPilot 自制的通用本科论文参考量表，不代表学校或导师评分标准。",
  dimensions: [
    { id: "structure", name: "结构与逻辑", full: 25, description: "章节层级是否清楚，段落之间是否有明确的推进关系。" },
    { id: "argument", name: "论证与内容", full: 35, description: "观点是否有论据支撑，方法、结果与结论是否相互对应。" },
    { id: "evidence", name: "文献与依据", full: 25, description: "引用与依据是否可追溯，是否存在缺少来源的断言。" },
    { id: "expression", name: "格式与表达", full: 15, description: "术语、语句与格式是否规范，是否符合已绑定的模板与要求。" },
  ],
  limitations: [
    "参考分只反映本量表下的模型判断，不是教师成绩，也不代表导师批准。",
    "评审只读取本次固定的正文范围与已绑定资料，未读取的内容列为未检查项。",
    "评审不修改正文或计划；修改须由学生另行发起受控修订。",
  ],
};

type Node = { type?: string; text?: string; attrs?: { chapterId?: string | null }; content?: Node[] };
const text = (node: Node): string => (node.type === "text" ? (node.text ?? "") : (node.content ?? []).map(text).join(""));

/**
 * Deterministic in-memory adapter with the HTTP contract. Like the server without
 * credentials, the mock queue fails every review job and never invents a report.
 */
export function createMockReviews(
  before: (signal?: AbortSignal) => Promise<void>,
  requireProject: (id: string) => unknown,
  documents: MockDocuments,
  materials: MaterialService,
  configuration: (versionId: string) => ConfigurationProbeConfiguration,
  jobs: JobService,
  enqueue: (projectId: string, reviewId: string, sourceJobId?: string) => JobRead,
): ReviewService {
  const reviews = new Map<string, ReviewRead>();
  const commands = new Map<string, { fingerprint: string; reviewId: string }>();

  function find(projectId: string, reviewId: string) {
    requireProject(requireUuid(projectId));
    const value = reviews.get(requireUuid(reviewId).toLowerCase());
    if (!value || value.project_id !== projectId.toLowerCase()) throw new ApiError("REVIEW_NOT_FOUND", { status: 404 });
    return value;
  }
  async function refresh(value: ReviewRead) {
    const job = await jobs.get(value.job_id, undefined, value.project_id);
    Object.assign(value, { status: job.status, error_code: job.error_code, attempt: job.attempt, updated_at: job.updated_at, report_id: null });
    return parseDto("ReviewRead", structuredClone(value));
  }
  async function receipt(value: ReviewRead) {
    const review = await refresh(value);
    const { attempts: _attempts, artifacts: _artifacts, ...job } = await jobs.get(value.job_id, undefined, value.project_id);
    return parseDto("ReviewReceipt", { review, job });
  }
  async function busy(projectId: string) {
    for (const item of reviews.values()) {
      if (item.project_id !== projectId.toLowerCase()) continue;
      const current = await refresh(item);
      if (current.status === "queued" || current.status === "running") throw new ApiError("REVIEW_BUSY", { status: 409 });
    }
  }
  function remember(commandId: string, fingerprint: string) {
    const previous = commands.get(commandId);
    if (previous && previous.fingerprint !== fingerprint) throw new ApiError("REVIEW_COMMAND_CONFLICT", { status: 409 });
    return previous ? reviews.get(previous.reviewId) : undefined;
  }
  function insert(
    projectId: string,
    data: ReturnType<typeof reviewInput>,
    scopeTitle: string,
    frozen: ConfigurationProbeConfiguration,
    template: string | null,
    requirements: string[],
    source?: ReviewRead,
  ) {
    const id = crypto.randomUUID();
    const job = enqueue(projectId, id, source?.job_id);
    const value: ReviewRead = {
      id,
      project_id: projectId.toLowerCase(),
      job_id: job.id,
      status: job.status,
      error_code: null,
      attempt: 0,
      document_id: data.document_id,
      document_version: data.document_version,
      chapter_id: data.chapter_id ?? null,
      scope_title: scopeTitle,
      rubric_version: data.rubric_version,
      agent_config_version_id: data.agent_config_version_id,
      agent_name: "评审智能体",
      config_version_ids: { ...frozen.version_ids },
      source_binding_version_id: data.source_binding_version_id ?? null,
      template_parse_version_id: template,
      requirement_parse_version_ids: requirements,
      source_review_id: source?.id ?? null,
      report_id: null,
      created_at: job.created_at,
      updated_at: job.updated_at,
    };
    reviews.set(id, parseDto("ReviewRead", value));
    return reviews.get(id)!;
  }

  return {
    async rubrics(signal) {
      await before(signal);
      return parseDto("ReviewRubricList", { items: [structuredClone(MOCK_RUBRIC)] });
    },
    async create(projectId, input, signal) {
      await before(signal);
      requireProject(requireUuid(projectId));
      const data = reviewInput(input);
      const { command_id: commandId, ...fixed } = data;
      const fingerprint = JSON.stringify({ projectId: projectId.toLowerCase(), op: "create", fixed });
      const previous = remember(commandId, fingerprint);
      if (previous) return receipt(previous);
      await busy(projectId);
      const current = await documents.current(projectId, signal);
      if (current.id !== data.document_id) throw new ApiError("DOCUMENT_NOT_FOUND", { status: 404 });
      if (current.version !== data.document_version) throw new ApiError("REVIEW_CONTEXT_STALE", { status: 409 });
      if (data.rubric_version !== MOCK_RUBRIC.version) throw new ApiError("REVIEW_RUBRIC_UNAVAILABLE", { status: 422 });
      const blocks = ((current.content.json as Node).content ?? []).map((node) => ({ node, chapterId: node.attrs?.chapterId ?? null }));
      let title = "整篇论文";
      if (data.chapter_id) {
        const heading = blocks.find((item) => item.node.type === "heading" && item.chapterId === data.chapter_id);
        if (!heading) throw new ApiError("REVIEW_SCOPE_NOT_FOUND", { status: 422 });
        title = text(heading.node).trim() || "未命名章节";
      }
      if (!blocks.some((item) => text(item.node).trim())) throw new ApiError("REVIEW_SCOPE_EMPTY", { status: 422 });
      const binding = await materials.sourceBinding(projectId, signal);
      if ((binding.current_version_id ?? null) !== (data.source_binding_version_id ?? null)) throw new ApiError("REVIEW_CONTEXT_STALE", { status: 409 });
      const frozen = configuration(data.agent_config_version_id);
      if (frozen.config_kind !== "agent" || frozen.agent?.role !== "review" || !frozen.model?.capabilities.includes("review"))
        throw new ApiError("REVIEW_AGENT_INVALID", { status: 422 });
      const value = insert(projectId, data, title, frozen, binding.template_parse_version_id, [...binding.requirement_parse_version_ids]);
      commands.set(commandId, { fingerprint, reviewId: value.id });
      return receipt(value);
    },
    async list(projectId, query, signal) {
      await before(signal);
      requireProject(requireUuid(projectId));
      const { limit, offset } = pageQuery(query);
      const ordered = [...reviews.values()]
        .filter((item) => item.project_id === projectId.toLowerCase())
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      const items = await Promise.all(ordered.slice(offset, offset + limit).map(refresh));
      return parseDto("ReviewPage", { items, total: ordered.length, limit, offset });
    },
    async get(projectId, reviewId, signal) {
      await before(signal);
      return refresh(find(projectId, reviewId));
    },
    async cancel(projectId, reviewId, signal) {
      await before(signal);
      const value = find(projectId, reviewId);
      await jobs.cancel(value.job_id, signal, value.project_id);
      return refresh(value);
    },
    async retry(projectId, reviewId, input, signal) {
      await before(signal);
      const source = await refresh(find(projectId, reviewId));
      const commandId = parseDto("ReviewRetry", { command_id: input.command_id.toLowerCase() }, true).command_id;
      const fingerprint = JSON.stringify({ projectId: projectId.toLowerCase(), op: "retry", reviewId: source.id });
      const previous = remember(commandId, fingerprint);
      if (previous) return receipt(previous);
      if (source.status !== "failed" && source.status !== "cancelled") throw new ApiError("REVIEW_RETRY_INVALID", { status: 409 });
      await busy(projectId);
      const frozen = configuration(source.agent_config_version_id);
      const value = insert(
        projectId,
        reviewInput({ ...source, command_id: commandId }),
        source.scope_title,
        frozen,
        source.template_parse_version_id,
        source.requirement_parse_version_ids,
        source,
      );
      commands.set(commandId, { fingerprint, reviewId: value.id });
      return receipt(value);
    },
    async report(projectId, reviewId, signal) {
      await before(signal);
      find(projectId, reviewId);
      throw new ApiError("REVIEW_REPORT_NOT_FOUND", { status: 404 });
    },
    async download(projectId, reviewId, _format, signal) {
      await before(signal);
      find(projectId, reviewId);
      throw new ApiError("REVIEW_REPORT_NOT_FOUND", { status: 404 });
    },
  };
}
