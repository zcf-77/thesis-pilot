import { effectScope, ref, type EffectScope } from "vue";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ApiError, createServices } from "../../src/services/index.ts";
import { createServiceJobsState, serviceJobTitle } from "../../src/lab/state/serviceJobs.ts";
import type { JobDetail } from "../../src/services/contracts/api.generated.ts";

const scopes: EffectScope[] = [];
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
});
async function setup() {
  const api = createServices({ mode: "mock", instanceId: `probe-${crypto.randomUUID()}` });
  const project = await api.projects.create({ name: "合成试跑状态" });
  const prompt = await api.aiConfigs.create({ name: "固定提示词", content: { kind: "prompt", template: "{{context}}", variables: ["context"] } });
  const scope = effectScope();
  scopes.push(scope);
  const state = scope.run(() => createServiceJobsState(api, ref<string | undefined>(project.id), "synthetic-workspace"))!;
  await state.refresh();
  return { api, project, prompt, state };
}

describe("配置试跑共享任务状态", () => {
  it("未知提交结果重放相同幂等键，并保持变量顺序不影响身份", async () => {
    const { api, project, prompt, state } = await setup();
    const original = api.jobs.create.bind(api.jobs);
    const create = vi
      .spyOn(api.jobs, "create")
      .mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new ApiError("REQUEST_TIMEOUT");
      })
      .mockImplementation(original);
    const variables = { context: "合成原文" };
    const pending = state.probeConfiguration(prompt.current_version_id, variables);
    variables.context = "提交后变动不能改变固定参数";
    expect(await pending).toBeUndefined();
    expect(state.actionError.value).toContain("尚不能确认");
    const accepted = await state.probeConfiguration(prompt.current_version_id, { context: "合成原文" });
    expect(accepted?.kind).toBe("configuration_probe");
    expect(create.mock.calls[0]![1]).toBe(create.mock.calls[1]![1]);
    expect((await api.jobs.list({ project_id: project.id })).total).toBe(1);
    expect(serviceJobTitle(accepted!)).toBe("配置试跑");
  });

  it("产物不匹配固定配置版本时拒绝展示，不将未知来源当成功", async () => {
    const { api, prompt, project, state } = await setup();
    const queued = await state.probeConfiguration(prompt.current_version_id, { context: "合成原文" });
    expect(queued).toBeDefined();
    const attemptId = crypto.randomUUID();
    const timestamp = new Date(Date.now() + 10).toISOString();
    const result = {
      kind: "configuration_probe" as const,
      schema_version: 1 as const,
      job_id: queued!.id,
      project_id: project.id,
      config_version_id: crypto.randomUUID(),
      config_kind: "prompt" as const,
      version_ids: { prompt: prompt.current_version_id },
      model_used: false,
      requested_model: null,
      response_model: null,
      writes_performed: false as const,
      content: "合成结果",
    };
    const wrong: JobDetail = {
      ...queued!,
      status: "succeeded",
      updated_at: timestamp,
      result,
      attempts: [{ id: attemptId, attempt: 1, status: "succeeded", started_at: timestamp, finished_at: timestamp, error_code: null }],
      artifacts: [
        { id: crypto.randomUUID(), job_id: queued!.id, attempt_id: attemptId, kind: "configuration_probe", schema_version: 1, created_at: timestamp, result },
      ],
    };
    vi.spyOn(api.jobs, "get").mockResolvedValue(wrong);
    await state.inspect(queued!.id);
    expect(state.detailData.value).toBeUndefined();
    expect(state.detailError.value).toContain("数据结构");
  });

  it("重试响应改变冻结链时保留原取消任务，拒绝应用伪成功响应", async () => {
    const { api, prompt, state } = await setup();
    const queued = await state.probeConfiguration(prompt.current_version_id, { context: "合成原文" });
    await state.cancel(queued!);
    const cancelled = state.directory.value.find((job) => job.id === queued!.id)!;
    const retry = api.jobs.retry.bind(api.jobs);
    vi.spyOn(api.jobs, "retry").mockImplementation(async (...args) => {
      const value = await retry(...args);
      return { ...value, resource_scope: { schema_version: 1, config_version_id: crypto.randomUUID(), version_ids: {} } };
    });
    expect(await state.retry(cancelled)).toBeUndefined();
    expect(state.actionError.value).toContain("数据结构");
    expect(state.directory.value.find((job) => job.id === cancelled.id)?.status).toBe("cancelled");
  });
});
