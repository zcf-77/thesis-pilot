import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createServices } from "../../src/services/index.ts";
import type { AssistantRunCreate, RevisionRead } from "../../src/services/contracts/api.generated.ts";
import { parseRevisionDto } from "../../src/services/revisionContent.ts";
import { assistantJobLink, canRerunServiceJob, serviceJobTitle } from "../../src/lab/state/serviceJobs.ts";

const text = "Synthetic manuscript 42.";
const content = (value = text) => ({
  schema_version: 1 as const,
  json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] },
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.useRealTimers());
async function fixture() {
  const api = createServices({ mode: "mock", instanceId: `assistant-${crypto.randomUUID()}` });
  const project = await api.projects.create({ name: "合成助手项目" });
  const document = await api.documents.import(project.id, { content: content() });
  const provider = await api.aiConfigs.create({ name: "合成接口", content: { kind: "api", max_retries: 2 } });
  const model = await api.aiConfigs.create({
    name: "合成模型",
    content: { kind: "model", api_version_id: provider.current_version_id, model_code: "deepseek-flash", capabilities: ["text"] },
  });
  const prompt = await api.aiConfigs.create({
    name: "合成提示词",
    content: { kind: "prompt", template: "{{context}}\n{{goal}}", variables: ["context", "goal"] },
  });
  const agent = await api.aiConfigs.create({
    name: "合成内容助手",
    content: {
      kind: "agent",
      role: "content",
      instructions: "仅返回建议",
      model_version_id: model.current_version_id,
      prompt_version_id: prompt.current_version_id,
    },
  });
  const session = await api.assistantSessions.create(project.id, { title: "会话甲" });
  const request: AssistantRunCreate = {
    command_id: crypto.randomUUID(),
    expected_session_version: 1,
    input: {
      document_id: document.id,
      document_version: 1,
      selection: { textblock_path: [0], from: 1, to: text.length + 1, text },
      goal: "保持数字的合成修订",
      agent_config_version_id: agent.current_version_id,
      source_binding_version_id: null,
    },
  };
  return { api, projectId: project.id, document, provider, agent, session, request };
}

describe("SG-08A 助手会话同契约服务", () => {
  it("两个会话分别保存消息和运行，Mock失败明确且从不产生模型候选或改正文", async () => {
    vi.useFakeTimers();
    const { api, projectId, session, request, document } = await fixture();
    const second = await api.assistantSessions.create(projectId, { title: "会话乙" });
    const firstRun = await api.assistantSessions.createRun(projectId, session.id, request);
    const secondRun = await api.assistantSessions.createRun(projectId, second.id, {
      ...request,
      command_id: crypto.randomUUID(),
      input: { ...request.input, goal: "第二会话的合成目标" },
    });
    expect(firstRun.session.version).toBe(2);
    expect((await api.assistantSessions.messages(projectId, session.id)).items.map((message) => message.content)).toEqual([request.input.goal]);
    expect((await api.assistantSessions.messages(projectId, second.id)).items.map((message) => message.content)).toEqual(["第二会话的合成目标"]);
    expect((await api.jobs.list({ project_id: projectId, kind: "content_revision" })).total).toBe(2);
    expect(serviceJobTitle(firstRun.job)).toBe("内容修订");
    await vi.advanceTimersByTimeAsync(2500);
    for (const run of [firstRun.run, secondRun.run]) {
      expect(await api.assistantSessions.run(projectId, run.id)).toMatchObject({
        status: "failed",
        error_code: "MODEL_NOT_CONFIGURED",
        candidate_id: null,
        result_message_id: null,
      });
      expect((await api.jobs.get(run.job_id)).result).toBeNull();
    }
    expect((await api.assistantSessions.context(projectId, firstRun.run.id)).context_snapshot).toMatchObject({ model_used: false });
    expect((await api.revisions.list(projectId, document.id)).total).toBe(0);
    expect(await api.documents.current(projectId)).toEqual(document);
  });

  it("会话元数据CAS、归档恢复及分页不串项目", async () => {
    const { api, projectId, session } = await fixture();
    const outcomes = await Promise.allSettled([
      api.assistantSessions.update(projectId, session.id, { expected_version: 1, title: "新标题甲" }),
      api.assistantSessions.update(projectId, session.id, { expected_version: 1, title: "新标题乙" }),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((item) => item.status === "rejected")?.reason).toMatchObject({ code: "ASSISTANT_SESSION_VERSION_CONFLICT" });
    await api.assistantSessions.update(projectId, session.id, { expected_version: 2, archived: true });
    expect((await api.assistantSessions.list(projectId)).total).toBe(0);
    expect((await api.assistantSessions.list(projectId, { include_archived: true })).total).toBe(1);
    await api.assistantSessions.update(projectId, session.id, { expected_version: 3, archived: false });
    const other = await api.projects.create({ name: "其他项目" });
    await expect(api.assistantSessions.get(other.id, session.id)).rejects.toMatchObject({ code: "ASSISTANT_SESSION_NOT_FOUND" });
  });

  it("同命令默认参数可重放，异参冲突且并发发送只有一个原子胜者", async () => {
    const { api, projectId, session, request } = await fixture();
    const [first, replay] = await Promise.all([
      api.assistantSessions.createRun(projectId, session.id, request),
      api.assistantSessions.createRun(projectId, session.id, { ...request, purpose: "content_revision", input: { ...request.input, material_sources: [] } }),
    ]);
    expect(first.run.id).toBe(replay.run.id);
    expect((await api.assistantSessions.messages(projectId, session.id)).total).toBe(1);
    await expect(api.assistantSessions.createRun(projectId, session.id, { ...request, input: { ...request.input, goal: "不同目标" } })).rejects.toMatchObject({
      code: "ASSISTANT_COMMAND_CONFLICT",
    });
    const second = await api.assistantSessions.create(projectId, { title: "并发会话" });
    const outcomes = await Promise.allSettled([
      api.assistantSessions.createRun(projectId, second.id, { ...request, command_id: crypto.randomUUID() }),
      api.assistantSessions.createRun(projectId, second.id, { ...request, command_id: crypto.randomUUID() }),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect((await api.assistantSessions.messages(projectId, second.id)).total).toBe(1);
    expect((await api.jobs.list({ project_id: projectId })).total).toBe(2);
  });

  it("取消由共享Job确认，重试保留固定上下文但新Run且不重复用户消息", async () => {
    vi.useFakeTimers();
    const { api, projectId, session, request } = await fixture();
    const accepted = await api.assistantSessions.createRun(projectId, session.id, request);
    const context = await api.assistantSessions.context(projectId, accepted.run.id);
    const cancel = { command_id: crypto.randomUUID() };
    expect((await api.assistantSessions.cancel(projectId, accepted.run.id, cancel)).status).toBe("cancelled");
    expect((await api.assistantSessions.cancel(projectId, accepted.run.id, cancel)).status).toBe("cancelled");
    await vi.advanceTimersByTimeAsync(2500);
    expect((await api.jobs.get(accepted.job.id)).status).toBe("cancelled");
    expect(canRerunServiceJob({ ...accepted.job, status: "cancelled" })).toBe(false);
    expect(assistantJobLink(accepted.job)?.query).toEqual({ assistantRunId: accepted.run.id });
    await expect(api.jobs.retry(accepted.job.id, "forbidden-generic-retry")).rejects.toMatchObject({ code: "ASSISTANT_RUN_RETRY_REQUIRED" });
    const command = { command_id: crypto.randomUUID() };
    const retry = await api.assistantSessions.retry(projectId, accepted.run.id, command);
    expect((await api.assistantSessions.retry(projectId, accepted.run.id, command)).run.id).toBe(retry.run.id);
    expect(retry.run).toMatchObject({ source_run_id: accepted.run.id, trigger_message_id: accepted.message.id });
    expect(retry.job.source_job_id).toBe(accepted.job.id);
    expect((await api.assistantSessions.context(projectId, retry.run.id)).context_snapshot).toEqual(context.context_snapshot);
    expect((await api.assistantSessions.messages(projectId, session.id)).total).toBe(1);
  });

  it("陈旧正文、错误选区或错误配置在创建消息和Job前拒绝，运行快照不被后续修改污染", async () => {
    const { api, projectId, session, request, document } = await fixture();
    await expect(
      api.assistantSessions.createRun(projectId, session.id, {
        ...request,
        input: { ...request.input, selection: { ...request.input.selection, text: "不匹配" } },
      }),
    ).rejects.toBeInstanceOf(Error);
    expect((await api.assistantSessions.messages(projectId, session.id)).total).toBe(0);
    const run = await api.assistantSessions.createRun(projectId, session.id, request);
    const snapshot = await api.assistantSessions.context(projectId, run.run.id);
    request.input.goal = "修改调用者对象";
    snapshot.context_snapshot.goal = "修改返回对象";
    expect((await api.assistantSessions.context(projectId, run.run.id)).context_snapshot.goal).toBe("保持数字的合成修订");
    await api.assistantSessions.cancel(projectId, run.run.id, { command_id: crypto.randomUUID() });
    await api.documents.save(projectId, document.id, { expected_version: 1, content: content("Updated manuscript 42.") });
    await expect(api.assistantSessions.retry(projectId, run.run.id, { command_id: crypto.randomUUID() })).rejects.toMatchObject({
      code: "ASSISTANT_CONTEXT_STALE",
    });
    expect((await api.jobs.list({ project_id: projectId })).total).toBe(1);
  });

  it("HTTP回执核对会话/运行/Job关联，消息上限保持普通1MiB传输", async () => {
    const { api, projectId, session, request } = await fixture();
    const receipt = await api.assistantSessions.createRun(projectId, session.id, request);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(receipt));
    const http = createServices({ mode: "http", instanceId: "assistant-http", fetch: fetcher });
    expect((await http.assistantSessions.createRun(projectId, session.id, request)).run.id).toBe(receipt.run.id);
    fetcher.mockResolvedValueOnce(json({ ...receipt, run: { ...receipt.run, session_id: crypto.randomUUID() } }));
    await expect(http.assistantSessions.createRun(projectId, session.id, request)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(http.assistantSessions.messages(projectId, session.id, { limit: 51 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValueOnce(new Response("{}", { headers: { "Content-Length": "1000001" } }));
    await expect(http.assistantSessions.messages(projectId, session.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("同会话并发重试仍只有一个活跃运行，兄弟重试共享固定预算", async () => {
    vi.useFakeTimers();
    const { api, projectId, session, request } = await fixture();
    const original = await api.assistantSessions.createRun(projectId, session.id, request);
    await api.assistantSessions.cancel(projectId, original.run.id, { command_id: crypto.randomUUID() });
    const attempts = await Promise.allSettled([
      api.assistantSessions.retry(projectId, original.run.id, { command_id: crypto.randomUUID() }),
      api.assistantSessions.retry(projectId, original.run.id, { command_id: crypto.randomUUID() }),
    ]);
    expect(attempts.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect((await api.jobs.list({ project_id: projectId, status: ["queued", "running"] })).total).toBe(1);
    await vi.advanceTimersByTimeAsync(2500);
    await api.assistantSessions.runs(projectId, session.id);
    await api.assistantSessions.retry(projectId, original.run.id, { command_id: crypto.randomUUID() });
    await vi.advanceTimersByTimeAsync(2500);
    await api.assistantSessions.runs(projectId, session.id);
    await expect(api.assistantSessions.retry(projectId, original.run.id, { command_id: crypto.randomUUID() })).rejects.toMatchObject({
      code: "MODEL_RETRY_LIMIT_REACHED",
    });
    expect((await api.assistantSessions.messages(projectId, session.id)).total).toBe(1);
  });

  it("HTTP未知结果只保留原命令供显式重放，不自动重试或退Mock", async () => {
    const { api, projectId, session, request } = await fixture();
    const receipt = await api.assistantSessions.createRun(projectId, session.id, request);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("synthetic lost acknowledgement")).mockResolvedValueOnce(json(receipt));
    const http = createServices({ mode: "http", instanceId: "assistant-unknown", fetch: fetcher });
    await expect(http.assistantSessions.createRun(projectId, session.id, request)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await http.assistantSessions.createRun(projectId, session.id, request);
    expect(fetcher.mock.calls[0]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body);
  });

  it("模型候选来源、失败码和采纳门槛严格验证，旧确定性候选契约保留", () => {
    const id = crypto.randomUUID();
    const time = "2026-11-18T00:00:00Z";
    const candidate: RevisionRead = {
      id,
      project_id: crypto.randomUUID(),
      document_id: crypto.randomUUID(),
      base_version: 1,
      document_version: 1,
      revision: 1,
      status: "failed",
      result_version: null,
      application_command_id: null,
      created_at: time,
      updated_at: time,
      selection: { textblock_path: [0], from: 1, to: 5, text: "合成原文" },
      goal: "合成目标",
      policy_version: "revision-protection-v1",
      producer: "model_run",
      run_id: crypto.randomUUID(),
      adoption_blocked_reason: "REVISION_ADOPTION_NOT_APPROVED",
      generation_error_code: "MODEL_TIMEOUT",
      generation_token: null,
      patches: [],
      decisions: [],
      checks: [],
      applicable: false,
    };
    expect(parseRevisionDto("RevisionRead", candidate).status).toBe("failed");
    for (const changes of [
      { applicable: true },
      { run_id: null },
      { adoption_blocked_reason: null },
      { generation_token: crypto.randomUUID() },
      { generation_error_code: "MODEL_PRIVATE_UNKNOWN" },
    ])
      expect(() => parseRevisionDto("RevisionRead", { ...candidate, ...changes })).toThrow();
    expect(
      parseRevisionDto("RevisionRead", {
        ...candidate,
        producer: "deterministic_preview",
        run_id: null,
        adoption_blocked_reason: null,
        status: "ready",
        generation_error_code: null,
      }).producer,
    ).toBe("deterministic_preview");
  });
});
