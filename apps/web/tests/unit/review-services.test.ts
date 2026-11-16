import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createServices } from "../../src/services/index.ts";
import type { DocumentImport, ReviewIssue, ReviewRead } from "../../src/services/contracts/api.generated.ts";
import { canRerunServiceJob, serviceJobTitle } from "../../src/lab/state/serviceJobs.ts";
import { resolveWorkspaceRoute, reviewLocationRoute } from "../../src/workspace/workspaceRoutes.ts";
import { basisLabel, chapterOptions, locationLabel, matchesHistory } from "../../src/workspace/review/reviewView.ts";

const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { chapterId: "c1", level: 1 }, content: [{ type: "text", text: "第一章 引言" }] },
    { type: "paragraph", content: [{ type: "text", text: "合成正文 42。" }] },
  ],
};
afterEach(() => vi.useRealTimers());

async function fixture(role: "review" | "content" = "review") {
  const api = createServices({ mode: "mock", instanceId: `review-${crypto.randomUUID()}` });
  const project = await api.projects.create({ name: "合成评审项目" });
  const document = await api.documents.import(project.id, { content: { schema_version: 1, json: doc as unknown as DocumentImport["content"]["json"] } });
  const provider = await api.aiConfigs.create({ name: "合成接口", content: { kind: "api", max_retries: 2 } });
  const model = await api.aiConfigs.create({
    name: "合成模型",
    content: {
      kind: "model",
      api_version_id: provider.current_version_id,
      model_code: "deepseek-flash",
      capabilities: [role === "review" ? "review" : "text"],
    },
  });
  const prompt = await api.aiConfigs.create({ name: "合成提示词", content: { kind: "prompt", template: "{{context}}", variables: ["context"] } });
  const agent = await api.aiConfigs.create({
    name: "合成评审",
    content: { kind: "agent", role, instructions: "只评审", model_version_id: model.current_version_id, prompt_version_id: prompt.current_version_id },
  });
  const request = (changes: Record<string, unknown> = {}) => ({
    command_id: crypto.randomUUID(),
    document_id: document.id,
    document_version: 1,
    chapter_id: null,
    rubric_version: "thesispilot-review-1",
    agent_config_version_id: agent.current_version_id,
    source_binding_version_id: null,
    ...changes,
  });
  return { api, projectId: project.id, document, request };
}

describe("SG-12 独立评审同契约服务", () => {
  it("Mock 队列像无凭据服务器一样明确失败，从不编造报告，也不写正文", async () => {
    vi.useFakeTimers();
    const { api, projectId, document, request } = await fixture();
    expect((await api.reviews.rubrics()).items[0]!.dimensions.map((item) => item.full)).toEqual([25, 35, 25, 15]);
    const input = request({ chapter_id: "c1" });
    const receipt = await api.reviews.create(projectId, input);
    expect(receipt.review).toMatchObject({ status: "queued", scope_title: "第一章 引言", document_version: 1, report_id: null });
    expect(receipt.job.kind).toBe("review");
    expect(serviceJobTitle(receipt.job)).toBe("论文评审");
    expect((await api.reviews.create(projectId, input)).review.id).toBe(receipt.review.id);
    await expect(api.reviews.create(projectId, { ...input, chapter_id: null })).rejects.toMatchObject({ code: "REVIEW_COMMAND_CONFLICT" });
    await expect(api.reviews.create(projectId, request())).rejects.toMatchObject({ code: "REVIEW_BUSY" });
    await expect(api.reviews.retry(projectId, receipt.review.id, { command_id: crypto.randomUUID() })).rejects.toMatchObject({ code: "REVIEW_RETRY_INVALID" });
    await vi.advanceTimersByTimeAsync(2500);
    const failed = await api.reviews.get(projectId, receipt.review.id);
    expect(failed).toMatchObject({ status: "failed", error_code: "MODEL_NOT_CONFIGURED", report_id: null });
    await expect(api.reviews.report(projectId, failed.id)).rejects.toMatchObject({ code: "REVIEW_REPORT_NOT_FOUND" });
    await expect(api.reviews.download(projectId, failed.id, "html")).rejects.toMatchObject({ code: "REVIEW_REPORT_NOT_FOUND" });
    const job = (await api.jobs.list({ project_id: projectId, kind: "review" })).items[0]!;
    expect(canRerunServiceJob(job)).toBe(false);
    await expect(api.jobs.retry(job.id, "review-generic", undefined, projectId)).rejects.toMatchObject({ code: "REVIEW_RETRY_REQUIRED" });
    const retried = await api.reviews.retry(projectId, failed.id, { command_id: crypto.randomUUID() });
    expect(retried.review).toMatchObject({ source_review_id: failed.id, chapter_id: "c1", document_version: 1 });
    expect((await api.reviews.cancel(projectId, retried.review.id)).status).toBe("cancelled");
    expect((await api.documents.current(projectId)).version).toBe(document.version);
    expect((await api.reviews.list(projectId)).total).toBe(2);
  });

  it("固定输入校验：旧版本、不存在章节、非评审智能体与跨项目均被拒绝", async () => {
    const { api, projectId, request } = await fixture();
    await expect(api.reviews.create(projectId, request({ document_version: 2 }))).rejects.toMatchObject({ code: "REVIEW_CONTEXT_STALE" });
    await expect(api.reviews.create(projectId, request({ chapter_id: "missing" }))).rejects.toMatchObject({ code: "REVIEW_SCOPE_NOT_FOUND" });
    await expect(api.reviews.create(projectId, request({ rubric_version: "unknown" }))).rejects.toMatchObject({ code: "REVIEW_RUBRIC_UNAVAILABLE" });
    const content = await fixture("content");
    await expect(content.api.reviews.create(content.projectId, content.request())).rejects.toMatchObject({ code: "REVIEW_AGENT_INVALID" });
    const receipt = await api.reviews.create(projectId, request());
    const other = await api.projects.create({ name: "另一个合成项目" });
    await expect(api.reviews.get(other.id, receipt.review.id)).rejects.toMatchObject({ code: "REVIEW_NOT_FOUND" });
  });

  it("HTTP 适配器拒绝评审回执与固定任务不一致的响应", async () => {
    const reviewId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    const review: ReviewRead = {
      id: reviewId,
      project_id: projectId,
      job_id: jobId,
      status: "queued",
      error_code: null,
      attempt: 0,
      document_id: crypto.randomUUID(),
      document_version: 1,
      chapter_id: null,
      scope_title: "整篇论文",
      rubric_version: "thesispilot-review-1",
      agent_config_version_id: crypto.randomUUID(),
      agent_name: "合成评审 · v1",
      config_version_ids: {},
      source_binding_version_id: null,
      template_parse_version_id: null,
      requirement_parse_version_ids: [],
      source_review_id: null,
      report_id: null,
      created_at: now,
      updated_at: now,
    };
    const job = (id: string) => ({
      id: jobId,
      project_id: projectId,
      kind: "review",
      status: "queued",
      attempt: 0,
      result: null,
      input_snapshot: { schema_version: 1, review_id: id },
      resource_scope: { schema_version: 1, review_id: id },
      configuration: null,
      source_job_id: null,
      error_code: null,
      created_at: now,
      updated_at: now,
    });
    const respond = (body: unknown) =>
      createServices({
        mode: "http",
        instanceId: "review-http",
        fetch: async () => new Response(JSON.stringify(body), { status: 202, headers: { "Content-Type": "application/json" } }),
      });
    const input = {
      command_id: crypto.randomUUID(),
      document_id: review.document_id,
      document_version: 1,
      rubric_version: "thesispilot-review-1",
      agent_config_version_id: review.agent_config_version_id,
    };
    expect((await respond({ review, job: job(reviewId) }).reviews.create(projectId, input)).review.id).toBe(reviewId);
    await expect(respond({ review, job: job(crypto.randomUUID()) }).reviews.create(projectId, input)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(respond({ review: { ...review, report_id: crypto.randomUUID() }, job: job(reviewId) }).reviews.create(projectId, input)).rejects.toMatchObject(
      {
        code: "INVALID_RESPONSE",
      },
    );
    await expect(respond({ review, job: job(reviewId) }).jobs.create({ project_id: projectId, kind: "review" }, "forged")).rejects.toMatchObject({
      code: "JOB_KIND_UNAVAILABLE",
    });
  });

  it("视图规则：无法定位留白、缺依据明示、章节与历史检索、只读深链", () => {
    const base: ReviewIssue = {
      id: "I1",
      severity: "major",
      title: "合成问题",
      explanation: "说明",
      direction: "方向",
      basis: [],
      basis_status: "missing",
      location: { status: "unlocated", chapter_id: null, chapter_title: null, block_index: null, start: null, end: null, quote: null },
    };
    expect(locationLabel(base)).toBe("无法定位");
    expect(basisLabel(base)).toBe("缺依据");
    expect(
      locationLabel({ ...base, location: { status: "range", chapter_id: "c1", chapter_title: "第一章", block_index: 1, start: 0, end: 2, quote: "合成" } }),
    ).toBe("第一章 · “合成”");
    expect(locationLabel({ ...base, location: { ...base.location, status: "block", chapter_id: "c1", chapter_title: "第一章", block_index: 2 } })).toBe(
      "第一章 · 第 3 段",
    );
    expect(chapterOptions(doc)).toEqual([{ value: "c1", label: "第一章 引言" }]);
    const review = {
      scope_title: "第一章 引言",
      created_at: new Date().toISOString(),
      document_version: 3,
      status: "failed",
      agent_name: "评审",
    } as ReviewRead;
    expect(matchesHistory(review, "v3")).toBe(true);
    expect(matchesHistory(review, "失败")).toBe(true);
    expect(matchesHistory(review, "第二章")).toBe(false);
    const projectId = crypto.randomUUID();
    expect(resolveWorkspaceRoute({ name: "workspace-review", params: { projectId }, query: {} }, "http:x")).toEqual({ page: "review", projectId });
    expect(reviewLocationRoute(projectId, "c1", "r1")).toEqual({ name: "workspace-writing", params: { projectId }, query: { chapterId: "c1", review: "r1" } });
  });
});
