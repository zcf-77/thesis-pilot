import { effectScope, ref, type EffectScope } from "vue";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createServices } from "../../src/services/index.ts";
import { createServiceJobsState, serviceJobTitle } from "../../src/lab/state/serviceJobs.ts";
import type { JobDetail } from "../../src/services/contracts/api.generated.ts";

const scopes: EffectScope[] = [];
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.useRealTimers();
});
async function setup() {
  const api = createServices({ mode: "mock", instanceId: `material-state-${crypto.randomUUID()}` });
  const project = await api.projects.create({ name: "合成解析状态" });
  const receipt = await api.materials.upload(
    project.id,
    { name: "合成原件", filename: "synthetic.txt", file_type: "text", kind: "requirements", content_base64: btoa("synthetic source") },
    "state-upload",
  );
  const scope = effectScope();
  scopes.push(scope);
  const state = scope.run(() => createServiceJobsState(api, ref<string | undefined>(project.id), "synthetic-workspace"))!;
  await state.refresh();
  return { api, project, receipt, state };
}
describe("资料解析共享任务状态", () => {
  it("资料任务正确分类，取消后重试保留原件快照且不落旧结果", async () => {
    vi.useFakeTimers();
    const { api, project, receipt, state } = await setup();
    const job = state.directory.value.find((item) => item.id === receipt.job.id)!;
    expect(serviceJobTitle(job)).toBe("资料解析");
    await state.cancel(job);
    await vi.advanceTimersByTimeAsync(2500);
    expect((await api.materials.parses(project.id, receipt.material.id, receipt.original.id)).total).toBe(0);
    const cancelled = state.directory.value.find((item) => item.id === job.id)!;
    const retried = await state.retry(cancelled);
    expect(retried).toMatchObject({
      kind: "material_parse",
      input_snapshot: job.input_snapshot,
      resource_scope: job.resource_scope,
      configuration: job.configuration,
    });
    await vi.advanceTimersByTimeAsync(2500);
    await state.inspect(retried!.id);
    expect(state.detailData.value?.result).toMatchObject({ kind: "material_parse", original_version_id: receipt.original.id });
    expect((await api.materials.parses(project.id, receipt.material.id, receipt.original.id)).total).toBe(1);
  });

  it("不匹配原件摘要的解析产物被拒绝，不能被其他任务类型误认", async () => {
    const { api, project, receipt, state } = await setup();
    const attemptId = crypto.randomUUID();
    const timestamp = new Date(Date.now() + 20).toISOString();
    const result = {
      kind: "material_parse" as const,
      schema_version: 1 as const,
      job_id: receipt.job.id,
      project_id: project.id,
      material_id: receipt.material.id,
      original_version_id: receipt.original.id,
      original_sha256: "0".repeat(64),
      parser_version: "thesispilot-material-1" as const,
      parse_version_id: crypto.randomUUID(),
      anchor_count: 1,
      text_characters: 16,
      model_used: false as const,
      writes_performed: false as const,
    };
    const forged: JobDetail = {
      ...receipt.job,
      status: "succeeded",
      updated_at: timestamp,
      result,
      attempts: [{ id: attemptId, attempt: 1, status: "succeeded", started_at: timestamp, finished_at: timestamp, error_code: null }],
      artifacts: [
        { id: crypto.randomUUID(), job_id: receipt.job.id, attempt_id: attemptId, kind: "material_parse", schema_version: 1, result, created_at: timestamp },
      ],
    };
    vi.spyOn(api.jobs, "get").mockResolvedValue(forged);
    await state.inspect(receipt.job.id);
    expect(state.detailData.value).toBeUndefined();
    expect(state.detailError.value).toContain("数据结构");
  });

  it("客户端不能通过通用jobs接口伪造原件解析请求，HTTP不发送请求", async () => {
    const { api, project, receipt } = await setup();
    const fetcher = vi.fn<typeof fetch>();
    const http = createServices({ mode: "http", instanceId: "material-direct-http", fetch: fetcher });
    for (const adapter of [api, http])
      await expect(
        adapter.jobs.create({ project_id: project.id, kind: "material_parse", input_snapshot: receipt.job.input_snapshot }, "forged-client-parse"),
      ).rejects.toMatchObject({ code: "JOB_KIND_UNAVAILABLE" });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await api.jobs.list({ project_id: project.id })).total).toBe(1);
  });
});
