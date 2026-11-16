import type { ApiTypes, ReviewRead, ReviewReceipt, ReviewReportRead, SchemaName } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { PageQuery, ReviewService } from "./types.ts";
import { isReviewInput, pageQuery, parseDto, requireUuid } from "./validation.ts";

type Request = {
  <Name extends SchemaName>(path: string, schema: Name, method?: string, body?: unknown, signal?: AbortSignal): Promise<ApiTypes[Name]>;
  (path: string, schema: "blob", method: "GET", body?: undefined, signal?: AbortSignal): Promise<Blob>;
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const base = (projectId: string) => `/projects/${requireUuid(projectId)}/reviews`;
const path = (projectId: string, reviewId: string) => `${base(projectId)}/${requireUuid(reviewId)}`;

function review(value: ReviewRead, projectId: string, reviewId?: string): ReviewRead {
  if (!same(value.project_id, projectId) || (reviewId !== undefined && !same(value.id, reviewId))) throw new ApiError("INVALID_RESPONSE");
  if (value.report_id !== null && value.status !== "succeeded") throw new ApiError("INVALID_RESPONSE");
  return value;
}

export function reviewReceipt(value: ReviewReceipt, projectId: string): ReviewReceipt {
  review(value.review, projectId);
  const { job } = value;
  if (
    job.kind !== "review" ||
    !same(job.id, value.review.job_id) ||
    !same(job.project_id, projectId) ||
    !isReviewInput(job.input_snapshot) ||
    !same(job.input_snapshot.review_id, value.review.id)
  )
    throw new ApiError("INVALID_RESPONSE");
  return value;
}

function report(value: ReviewReportRead, projectId: string, reviewId: string): ReviewReportRead {
  if (!same(value.project_id, projectId) || !same(value.review_id, reviewId)) throw new ApiError("INVALID_RESPONSE");
  return value;
}

/** Client-side checks only bound transport; the server freezes and verifies inputs. */
export function reviewInput(input: ApiTypes["ReviewCreate"]): ApiTypes["ReviewCreate"] {
  return parseDto(
    "ReviewCreate",
    {
      command_id: input.command_id.toLowerCase(),
      document_id: input.document_id.toLowerCase(),
      document_version: input.document_version,
      chapter_id: input.chapter_id ?? null,
      rubric_version: input.rubric_version,
      agent_config_version_id: input.agent_config_version_id.toLowerCase(),
      source_binding_version_id: input.source_binding_version_id?.toLowerCase() ?? null,
    },
    true,
  );
}

export function createHttpReviews(request: Request): ReviewService {
  return {
    async rubrics(signal) {
      return request("/review-rubrics", "ReviewRubricList", "GET", undefined, signal);
    },
    async create(projectId, input, signal) {
      return reviewReceipt(await request(base(projectId), "ReviewReceipt", "POST", reviewInput(input), signal), projectId);
    },
    async list(projectId, query?: PageQuery, signal?) {
      const { limit, offset } = pageQuery(query);
      const value = await request(`${base(projectId)}?limit=${limit}&offset=${offset}`, "ReviewPage", "GET", undefined, signal);
      if (value.limit !== limit || value.offset !== offset || value.items.length > limit || value.total < value.items.length)
        throw new ApiError("INVALID_RESPONSE");
      value.items.forEach((item) => review(item, projectId));
      return value;
    },
    async get(projectId, reviewId, signal) {
      return review(await request(path(projectId, reviewId), "ReviewRead", "GET", undefined, signal), projectId, reviewId);
    },
    async cancel(projectId, reviewId, signal) {
      return review(await request(`${path(projectId, reviewId)}/cancel`, "ReviewRead", "POST", undefined, signal), projectId, reviewId);
    },
    async retry(projectId, reviewId, input, signal) {
      const data = parseDto("ReviewRetry", { command_id: input.command_id.toLowerCase() }, true);
      const value = reviewReceipt(await request(`${path(projectId, reviewId)}/retry`, "ReviewReceipt", "POST", data, signal), projectId);
      if (!value.review.source_review_id || !same(value.review.source_review_id, reviewId)) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async report(projectId, reviewId, signal) {
      return report(await request(`${path(projectId, reviewId)}/report`, "ReviewReportRead", "GET", undefined, signal), projectId, reviewId);
    },
    async download(projectId, reviewId, format, signal) {
      if (format !== "html" && format !== "markdown") throw new ApiError("VALIDATION_ERROR", { status: 422 });
      return request(`${path(projectId, reviewId)}/report/download?format=${format}`, "blob", "GET", undefined, signal);
    },
  };
}
