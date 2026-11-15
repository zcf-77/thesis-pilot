import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createServices } from "../../src/services/index.ts";
import type { AIConfigCreate } from "../../src/services/contracts/api.generated.ts";
import { parseDto, parseJobInput } from "../../src/services/validation.ts";

const mock = () => createServices({ mode: "mock", instanceId: "ai-config-unit" });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.useRealTimers());

async function chain(api = mock()) {
  const provider = await api.aiConfigs.create({ name: "自制接口", content: { kind: "api" } });
  const model = await api.aiConfigs.create({
    name: "自制模型",
    content: { kind: "model", api_version_id: provider.current_version_id, model_code: "deepseek-flash", capabilities: ["text", "review"] },
  });
  const prompt = await api.aiConfigs.create({ name: "自制提示词", content: { kind: "prompt", template: "核对 {{ context }}", variables: ["context"] } });
  const agent = await api.aiConfigs.create({
    name: "自制评审智能体",
    content: {
      kind: "agent",
      role: "review",
      instructions: "只返回建议",
      model_version_id: model.current_version_id,
      prompt_version_id: prompt.current_version_id,
    },
  });
  return { api, provider, model, prompt, agent };
}

describe("SG-07 四库同契约服务", () => {
  it("四类配置冻结引用；并发CAS只有一个成功，历史和返回对象互不污染", async () => {
    const { api, provider, model } = await chain();
    const changes = await Promise.allSettled([
      api.aiConfigs.update(provider.id, { expected_version: 1, name: "接口甲" }),
      api.aiConfigs.update(provider.id, { expected_version: 1, name: "接口乙" }),
    ]);
    expect(changes.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(changes.find((value) => value.status === "rejected")?.reason).toMatchObject({ code: "AI_CONFIG_VERSION_CONFLICT" });
    expect((await api.aiConfigs.get(model.id)).content).toMatchObject({ api_version_id: provider.current_version_id });
    provider.name = "篡改响应";
    const historical = await api.aiConfigs.version(provider.id, 1);
    historical.name = "篡改历史响应";
    expect((await api.aiConfigs.version(provider.id, 1)).name).toBe("自制接口");
    expect(await api.aiConfigs.versions(provider.id, { limit: 1 })).toMatchObject({ total: 2, limit: 1, offset: 0 });
    expect((await api.aiConfigs.list({ kind: "model" })).items.map((item) => item.id)).toEqual([model.id]);
    expect(await api.aiConfigs.availability()).toMatchObject({ credential_configured: false });
  });

  it("复制旧版本创建独立记录，停用依赖禁止新绑定而原历史和管理仍可读", async () => {
    const { api, provider, model } = await chain();
    await api.aiConfigs.update(model.id, { expected_version: 1, name: "新版模型名称" });
    const copied = await api.aiConfigs.copy(model.id, { name: "复制历史", source_version: 1 });
    expect(copied.id).not.toBe(model.id);
    expect(copied).toMatchObject({ version: 1, enabled: true, content: model.content });
    const references = await api.aiConfigs.references(provider.id);
    expect(references.configs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ config_id: model.id, version: 1, current: false, referenced_version_id: provider.current_version_id }),
      ]),
    );
    await api.aiConfigs.update(provider.id, { expected_version: 1, enabled: false });
    await expect(api.aiConfigs.copy(model.id, { name: "不可复制失效链" })).rejects.toMatchObject({ code: "AI_CONFIG_DISABLED" });
    await expect(api.aiConfigs.update(model.id, { expected_version: 2, enabled: true })).rejects.toMatchObject({ code: "AI_CONFIG_DISABLED" });
    expect((await api.aiConfigs.update(model.id, { expected_version: 2, name: "仍可管理" })).version).toBe(3);
    expect((await api.aiConfigs.version(model.id, 1)).content).toEqual(model.content);
  });
  it("同库名称冲突原子拒绝，跨库同名可用", async () => {
    const api = mock();
    const first = await api.aiConfigs.create({ name: "同名", content: { kind: "api" } });
    const second = await api.aiConfigs.create({ name: "另一项", content: { kind: "api" } });
    await expect(api.aiConfigs.update(second.id, { expected_version: 1, name: first.name })).rejects.toMatchObject({ code: "AI_CONFIG_NAME_CONFLICT" });
    expect((await api.aiConfigs.get(second.id)).version).toBe(1);
    expect((await api.aiConfigs.versions(second.id)).total).toBe(1);
    expect((await api.aiConfigs.create({ name: "同名", content: { kind: "prompt", template: "合成模板" } })).kind).toBe("prompt");
  });

  it("非法模板、重复能力、结构键与秘密字段在两种适配器一致拒绝", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapters = [mock(), createServices({ mode: "http", instanceId: "validation", fetch: fetcher })];
    const invalid = [
      { name: "未声明变量", content: { kind: "prompt", template: "{{context}}", variables: [] } },
      { name: "变量未闭合", content: { kind: "prompt", template: "{{ context", variables: ["context"] } },
      { name: "未使用变量", content: { kind: "prompt", template: "正文", variables: ["context"] } },
      { name: "非法结构键", content: { kind: "prompt", template: "正文", input_schema: { "invalid-key": "string" } } },
      {
        name: "过多结构字段",
        content: { kind: "prompt", template: "正文", output_schema: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`field${index}`, "string"])) },
      },
      { name: "禁止凭据", content: { kind: "api", api_key: "synthetic-secret-must-not-be-sent" } },
    ];
    for (const api of adapters) for (const input of invalid) await expect(api.aiConfigs.create(input as AIConfigCreate)).rejects.toBeInstanceOf(Error);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("Mock试跑固定配置快照、明确模拟，取消不复活，重试引用原快照", async () => {
    vi.useFakeTimers();
    const { api, provider, agent } = await chain();
    const project = await api.projects.create({ name: "合成试跑项目" });
    const input = {
      project_id: project.id,
      kind: "configuration_probe" as const,
      input_snapshot: { schema_version: 1 as const, config_version_id: agent.current_version_id, variables: { context: "合成论文" } },
    };
    const queued = await api.jobs.create(input, "probe-original");
    const originalConfiguration = structuredClone(queued.configuration);
    input.input_snapshot.variables.context = "调用后修改不进入快照";
    await api.aiConfigs.update(provider.id, { expected_version: 1, name: "接口新名字" });
    await api.jobs.cancel(queued.id, undefined, project.id);
    await vi.advanceTimersByTimeAsync(2500);
    expect((await api.jobs.get(queued.id)).status).toBe("cancelled");
    const retry = await api.jobs.retry(queued.id, "probe-retry", undefined, project.id);
    expect(retry).toMatchObject({ source_job_id: queued.id, configuration: originalConfiguration, resource_scope: queued.resource_scope });
    await vi.advanceTimersByTimeAsync(2500);
    const completed = await api.jobs.get(retry.id);
    expect(completed).toMatchObject({
      status: "succeeded",
      result: { kind: "configuration_probe", model_used: false, writes_performed: false, response_model: null },
    });
    expect(completed.result?.kind === "configuration_probe" && completed.result.content).toContain("本地模拟试跑");
    expect((await api.aiConfigs.references(provider.id)).jobs).toEqual(
      expect.arrayContaining([expect.objectContaining({ job_id: retry.id, matched_version_ids: [provider.current_version_id] })]),
    );
  });

  it("试跑变量不匹配或客户端伪造冻结配置不创建任务", async () => {
    const { api, prompt } = await chain();
    const project = await api.projects.create({ name: "无效输入" });
    await expect(
      api.jobs.create(
        { project_id: project.id, kind: "configuration_probe", input_snapshot: { config_version_id: prompt.current_version_id, variables: {} } },
        "missing-variable",
      ),
    ).rejects.toMatchObject({ code: "AI_CONFIG_VARIABLE_INVALID" });
    await expect(
      api.jobs.create(
        {
          project_id: project.id,
          kind: "configuration_probe",
          input_snapshot: { config_version_id: prompt.current_version_id, variables: { context: "合成" } },
          configuration: { include_text_statistics: true },
        },
        "forged-config",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await api.jobs.list({ project_id: project.id })).total).toBe(0);
  });
  it("Mock确定性提示词不满足输出结构时失败，不能显示成功产物", async () => {
    vi.useFakeTimers();
    const api = mock();
    const project = await api.projects.create({ name: "合成结构检查" });
    const prompt = await api.aiConfigs.create({
      name: "JSON输出要求",
      content: { kind: "prompt", template: "普通文字", output_schema: { summary: "string" } },
    });
    const queued = await api.jobs.create(
      { project_id: project.id, kind: "configuration_probe", input_snapshot: { config_version_id: prompt.current_version_id } },
      "invalid-output-schema",
    );
    await vi.advanceTimersByTimeAsync(2500);
    expect(await api.jobs.get(queued.id)).toMatchObject({ status: "failed", error_code: "AI_CONFIG_SCHEMA_INVALID", result: null, artifacts: [] });
  });
  it("试跑兄弟重试共享固定预算，重放同键不重复消耗预算", async () => {
    const { api, agent } = await chain();
    const project = await api.projects.create({ name: "显式重试预算" });
    const original = await api.jobs.create(
      { project_id: project.id, kind: "configuration_probe", input_snapshot: { config_version_id: agent.current_version_id, variables: { context: "合成" } } },
      "budget-source",
    );
    await api.jobs.cancel(original.id);
    const first = await api.jobs.retry(original.id, "budget-first");
    expect((await api.jobs.retry(original.id, "budget-first")).id).toBe(first.id);
    await api.jobs.retry(original.id, "budget-second");
    await expect(api.jobs.retry(original.id, "budget-third")).rejects.toMatchObject({ code: "MODEL_RETRY_LIMIT_REACHED", status: 409 });
    expect((await api.jobs.list({ project_id: project.id })).total).toBe(3);
  });

  it("HTTP拒绝错身份、错版本和带秘密的成功响应，不把未知结构作为成功", async () => {
    const source = await mock().aiConfigs.create({ name: "响应校验", content: { kind: "api" } });
    const fetcher = vi.fn<typeof fetch>();
    const api = createServices({ mode: "http", instanceId: "http-config", fetch: fetcher });
    fetcher.mockResolvedValueOnce(json({ ...source, id: crypto.randomUUID() }));
    await expect(api.aiConfigs.get(source.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    fetcher.mockResolvedValueOnce(json({ ...source, version: 10 }));
    await expect(api.aiConfigs.update(source.id, { expected_version: 1, name: "新名" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    fetcher.mockResolvedValueOnce(json({ ...source, api_key: "synthetic-forbidden-secret" }));
    await expect(api.aiConfigs.get(source.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    fetcher.mockResolvedValueOnce(json({ ...source, content: { ...source.content, kind: "unknown" } }));
    await expect(api.aiConfigs.get(source.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("HTTP请求保留CAS和选定复制版本，反查同源传输且取消不回退Mock", async () => {
    const source = await mock().aiConfigs.create({ name: "协议", content: { kind: "api" } });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ ...source, version: 2 }));
    const api = createServices({ mode: "http", instanceId: "wire-config", fetch: fetcher });
    await api.aiConfigs.update(source.id, { expected_version: 1, name: "新名字" });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ expected_version: 1, name: "新名字" });
    fetcher.mockResolvedValueOnce(json({ ...source, id: crypto.randomUUID() }));
    await api.aiConfigs.copy(source.id, { name: "复制", source_version: 1 });
    expect(fetcher.mock.calls[1]![0]).toBe(`/api/v1/ai-configs/${source.id}/copies`);
    expect(fetcher.mock.calls[1]![1]).toMatchObject({ credentials: "same-origin", cache: "no-store", method: "POST" });
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(api.aiConfigs.get(source.id, cancelled.signal)).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("probe版本字典拒绝未知类型key和越界变量，合法联合结构可验证", async () => {
    const id = crypto.randomUUID();
    const scope = { schema_version: 1, config_version_id: id, version_ids: { api: id } };
    expect(parseDto("ConfigurationProbeScope", scope)).toEqual(scope);
    expect(() => parseDto("ConfigurationProbeScope", { ...scope, version_ids: { unknown: id } })).toThrow();
    expect(() =>
      parseJobInput({ project_id: id, kind: "configuration_probe", input_snapshot: { config_version_id: id, variables: { "invalid-key": "value" } } }),
    ).toThrow();
    expect(() =>
      parseJobInput({
        project_id: id,
        kind: "configuration_probe",
        input_snapshot: { config_version_id: id, variables: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`field${index}`, "value"])) },
      }),
    ).toThrow();
  });
  it("HTTP校验试跑来源与真实模型声明，不能把Mock模型结果当真实结果", async () => {
    vi.useFakeTimers();
    const { api: simulated, prompt, agent } = await chain();
    const project = await simulated.projects.create({ name: "响应来源" });
    const promptJob = await simulated.jobs.create(
      { project_id: project.id, kind: "configuration_probe", input_snapshot: { config_version_id: prompt.current_version_id, variables: { context: "合成" } } },
      "http-prompt-result",
    );
    const modelJob = await simulated.jobs.create(
      { project_id: project.id, kind: "configuration_probe", input_snapshot: { config_version_id: agent.current_version_id, variables: { context: "合成" } } },
      "http-model-result",
    );
    await vi.advanceTimersByTimeAsync(2500);
    const promptResult = await simulated.jobs.get(promptJob.id);
    const modelResult = await simulated.jobs.get(modelJob.id);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(promptResult));
    const real = createServices({ mode: "http", instanceId: "result-source", fetch: fetcher });
    expect((await real.jobs.get(promptJob.id)).status).toBe("succeeded");
    fetcher.mockResolvedValueOnce(json({ ...promptResult, result: { ...promptResult.result!, config_version_id: crypto.randomUUID() } }));
    await expect(real.jobs.get(promptJob.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    fetcher.mockResolvedValueOnce(json(modelResult));
    await expect(real.jobs.get(modelJob.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
