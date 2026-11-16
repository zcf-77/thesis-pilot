import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createServices } from "../../src/services/index.ts";
import type { FeedbackItemSummary, FeedbackSplitRead, FeedbackSuggestionRead, FeedbackSummary } from "../../src/services/contracts/api.generated.ts";
import { canRerunServiceJob, serviceJobTitle } from "../../src/lab/state/serviceJobs.ts";
import { buildInbox, historyActions } from "../../src/workspace/feedback/feedbackPresentation.ts";
import {
  adoptable,
  adoptedItems,
  decision,
  draftFromSuggestion,
  isActiveSplit,
  splitCounts,
  splitStatusText,
  suggestionTone,
} from "../../src/workspace/feedback/feedbackSplitView.ts";

afterEach(() => vi.useRealTimers());
const ORIGINAL = "第二章方法写得太笼统。\n图3 缺单位。";

async function fixture(role: "content" | "review" = "content") {
  const api = createServices({ mode: "mock", instanceId: `split-${crypto.randomUUID()}` });
  const project = await api.projects.create({ name: "合成反馈拆解" });
  const batch = await api.feedback.create(project.id, { command_id: crypto.randomUUID(), expected_version: 0, original_text: ORIGINAL });
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
    name: "合成整理",
    content: { kind: "agent", role, instructions: "只拆解", model_version_id: model.current_version_id, prompt_version_id: prompt.current_version_id },
  });
  return { api, projectId: project.id, batchId: batch.id, agent: agent.current_version_id };
}

function suggestion(changes: Partial<FeedbackSuggestionRead> = {}): FeedbackSuggestionRead {
  return {
    id: crypto.randomUUID(),
    position: 0,
    source_range: { from: 0, to: 11, text: "第二章方法写得太笼统。" },
    interpretation: "补充方法细节",
    certainty: "certain",
    ambiguous: false,
    task_title: "补充方法",
    state: "pending",
    version: 0,
    feedback_item_id: null,
    stale: false,
    stale_reasons: [],
    history: [],
    ...changes,
  };
}

describe("SG-09 反馈拆解同契约服务", () => {
  it("Mock 队列像无凭据服务器一样明确失败，不编造建议；重试按原输入、通用重试被拒绝", async () => {
    vi.useFakeTimers();
    const { api, projectId, batchId, agent } = await fixture();
    const input = { command_id: crypto.randomUUID(), agent_config_version_id: agent };
    const receipt = await api.feedbackSplits.create(projectId, batchId, input);
    expect(receipt.split).toMatchObject({ status: "queued", batch_id: batchId, suggestions: [] });
    expect(receipt.job.kind).toBe("feedback_decomposition");
    expect(serviceJobTitle(receipt.job)).toBe("反馈意见整理");
    expect((await api.feedbackSplits.create(projectId, batchId, input)).split.id).toBe(receipt.split.id);
    await expect(api.feedbackSplits.create(projectId, batchId, { ...input, agent_config_version_id: crypto.randomUUID() })).rejects.toMatchObject({
      code: "FEEDBACK_SPLIT_COMMAND_CONFLICT",
    });
    await expect(api.feedbackSplits.create(projectId, batchId, { command_id: crypto.randomUUID(), agent_config_version_id: agent })).rejects.toMatchObject({
      code: "FEEDBACK_SPLIT_BUSY",
    });
    await vi.advanceTimersByTimeAsync(2500);
    const failed = await api.feedbackSplits.get(projectId, receipt.split.id);
    expect(failed).toMatchObject({ status: "failed", error_code: "MODEL_NOT_CONFIGURED", suggestions: [] });
    expect(splitStatusText(failed)).toContain("原文保留，没有产生建议或任务");
    await expect(
      api.feedbackSplits.decide(projectId, failed.id, {
        command_id: crypto.randomUUID(),
        decisions: [{ suggestion_id: crypto.randomUUID(), expected_version: 0, action: "reject" }],
      }),
    ).rejects.toMatchObject({ code: "FEEDBACK_SPLIT_NOT_READY" });
    const job = (await api.jobs.list({ project_id: projectId, kind: "feedback_decomposition" })).items[0]!;
    expect(canRerunServiceJob(job)).toBe(false);
    await expect(api.jobs.retry(job.id, "split-generic", undefined, projectId)).rejects.toMatchObject({ code: "FEEDBACK_SPLIT_RETRY_REQUIRED" });
    const retried = await api.feedbackSplits.retry(projectId, failed.id, { command_id: crypto.randomUUID() });
    expect(retried.split.source_split_id).toBe(failed.id);
    expect((await api.feedbackSplits.cancel(projectId, retried.split.id)).status).toBe("cancelled");
    expect((await api.feedbackSplits.list(projectId, batchId)).total).toBe(2);
    expect((await api.feedback.items(projectId, batchId)).total).toBe(0);
  });

  it("非内容助手智能体与跨项目访问被拒绝", async () => {
    const review = await fixture("review");
    await expect(
      review.api.feedbackSplits.create(review.projectId, review.batchId, { command_id: crypto.randomUUID(), agent_config_version_id: review.agent }),
    ).rejects.toMatchObject({ code: "FEEDBACK_SPLIT_AGENT_INVALID" });
    const { api, projectId, batchId, agent } = await fixture();
    const receipt = await api.feedbackSplits.create(projectId, batchId, { command_id: crypto.randomUUID(), agent_config_version_id: agent });
    const other = await api.projects.create({ name: "另一个合成项目" });
    await expect(api.feedbackSplits.get(other.id, receipt.split.id)).rejects.toMatchObject({ code: "FEEDBACK_SPLIT_NOT_FOUND" });
  });

  it("HTTP 适配器拒绝与固定任务不一致或未成功却带建议的响应", async () => {
    const projectId = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    const splitId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    const split: FeedbackSplitRead = {
      id: splitId,
      project_id: projectId,
      batch_id: batchId,
      job_id: jobId,
      status: "queued",
      error_code: null,
      attempt: 0,
      agent_config_version_id: crypto.randomUUID(),
      agent_name: "合成整理 · v1",
      config_version_ids: {},
      source_split_id: null,
      requested_model: null,
      response_model: null,
      note: "",
      suggestions: [],
      created_at: now,
      updated_at: now,
    };
    const job = (id: string) => ({
      id: jobId,
      project_id: projectId,
      kind: "feedback_decomposition",
      status: "queued",
      attempt: 0,
      result: null,
      input_snapshot: { schema_version: 1, split_id: id },
      resource_scope: { schema_version: 1, split_id: id },
      configuration: null,
      source_job_id: null,
      error_code: null,
      created_at: now,
      updated_at: now,
    });
    const respond = (body: unknown) =>
      createServices({
        mode: "http",
        instanceId: "split-http",
        fetch: async () => new Response(JSON.stringify(body), { status: 202, headers: { "Content-Type": "application/json" } }),
      });
    const input = { command_id: crypto.randomUUID(), agent_config_version_id: crypto.randomUUID() };
    expect((await respond({ split, job: job(splitId) }).feedbackSplits.create(projectId, batchId, input)).split.id).toBe(splitId);
    await expect(respond({ split, job: job(crypto.randomUUID()) }).feedbackSplits.create(projectId, batchId, input)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(respond({ ...split, suggestions: [suggestion()] }).feedbackSplits.get(projectId, splitId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(respond({ ...split, project_id: crypto.randomUUID() }).feedbackSplits.get(projectId, splitId)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});

describe("拆解建议展示与决定", () => {
  it("材质：待决定铅笔、过期旧稿、采纳为墨、拒绝留白；过期不可采纳", () => {
    expect(suggestionTone(suggestion())).toBe("tp-pencil");
    expect(suggestionTone(suggestion({ stale: true }))).toBe("tp-stale");
    expect(suggestionTone(suggestion({ state: "adopted" }))).toBe("tp-ink");
    expect(suggestionTone(suggestion({ state: "rejected" }))).toBe("tp-ghost");
    expect(adoptable(suggestion())).toBe(true);
    expect(adoptable(suggestion({ stale: true }))).toBe(false);
    expect(isActiveSplit({ status: "running" })).toBe(true);
    expect(isActiveSplit({ status: "cancelled" })).toBe(false);
  });

  it("原样采纳草稿保留歧义为待明确、不建任务；决定携带当前版本", () => {
    const ambiguous = suggestion({ ambiguous: true, certainty: "uncertain", version: 2 });
    const draft = draftFromSuggestion(ambiguous);
    expect(draft).toMatchObject({ certainty: "uncertain", source_checked: true, task_id: null, new_task: null, evidence: [] });
    expect(draft.source_range).toEqual(ambiguous.source_range);
    expect(decision(ambiguous, "adopt")).toEqual({ suggestion_id: ambiguous.id, expected_version: 2, action: "adopt" });
    expect(decision(ambiguous, "adopt", draft).content?.interpretation).toBe("补充方法细节");
  });

  it("只把新采纳的解释项交给索引刷新；计数区分待决定与过期", () => {
    const first = suggestion();
    const second = suggestion({ id: crypto.randomUUID(), stale: true });
    const before = { suggestions: [first, second] } as FeedbackSplitRead;
    const itemId = crypto.randomUUID();
    const after = { status: "succeeded", suggestions: [{ ...first, state: "adopted", version: 1, feedback_item_id: itemId }, second] } as FeedbackSplitRead;
    expect(adoptedItems(before, after)).toEqual([itemId]);
    expect(adoptedItems(after, after)).toEqual([]);
    expect(splitCounts(after)).toEqual({ total: 2, pending: 1, adopted: 1, stale: 1 });
  });

  it("撤销采纳的解释项不进入索引；采纳 AI 建议的条目标明来源", () => {
    const batch: FeedbackSummary = {
      id: crypto.randomUUID(),
      project_id: crypto.randomUUID(),
      preview: ORIGINAL,
      item_count: 2,
      created_at: new Date().toISOString(),
    };
    const item = (changes: Partial<FeedbackItemSummary>): FeedbackItemSummary => ({
      id: crypto.randomUUID(),
      batch_id: batch.id,
      version: 1,
      status: "open",
      origin: "ai_suggested",
      preview: "补充方法细节",
      certainty: "certain",
      task_id: null,
      needs_review: true,
      review_reasons: ["缺少处理证据"],
      updated_at: batch.created_at,
      ...changes,
    });
    const entries = buildInbox([batch], new Map([[batch.id, [item({}), item({ status: "withdrawn", version: 2 })]]]));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.summary).toContain("采纳 AI 建议");
    const onlyWithdrawn = buildInbox([batch], new Map([[batch.id, [item({ status: "withdrawn" })]]]));
    expect(onlyWithdrawn[0]).toMatchObject({ kind: "batch", state: "recorded" });
    expect(historyActions.adopt).toBe("采纳 AI 拆解建议");
    expect(historyActions.withdraw).toBe("撤销采纳");
  });
});
