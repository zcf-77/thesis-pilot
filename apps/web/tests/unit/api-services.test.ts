import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ApiError, createServices, toJobView, toProjectView, type JobRead, type ProjectRead } from "../../src/services/index.ts";
import { parseDto } from "../../src/services/validation.ts";

const projectId = "09c93463-a51f-4fba-9a18-e934268bb5ee";
const jobId = "a0bc2a3d-572f-47a1-b779-84dc10cc3925";
const timestamp = "2026-11-14T12:00:00Z";
const project: ProjectRead = { id: projectId, name: "自制项目", version: 1, created_at: timestamp, updated_at: timestamp };
const diagnostic: JobRead = {
  id: jobId,
  project_id: projectId,
  kind: "diagnostic",
  status: "queued",
  attempt: 0,
  result: null,
  error_code: null,
  created_at: timestamp,
  updated_at: timestamp,
};
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
const mock = () => createServices({ mode: "mock", instanceId: "unit" });
const http = (fetcher: typeof fetch, timeoutMs?: number) => createServices({ mode: "http", instanceId: "unit", fetch: fetcher, timeoutMs });

afterEach(() => vi.useRealTimers());

describe("同契约服务及远端状态边界", () => {
  it("Mock项目持久在服务实例中，分页、CAS和返回副本隔离", async () => {
    const services = mock();
    const first = await services.projects.create({ name: "  初始名称  " });
    expect(first.name).toBe("初始名称");
    await services.projects.create({ name: "另一个" });
    expect((await services.projects.list({ limit: 1 })).items).toHaveLength(1);
    expect((await services.projects.list()).total).toBe(2);
    const updated = await services.projects.update(first.id, { name: "修改名称", expected_version: 1 });
    expect(updated.version).toBe(2);
    await expect(services.projects.update(first.id, { name: "陈旧修改", expected_version: 1 })).rejects.toMatchObject({
      code: "PROJECT_VERSION_CONFLICT",
      status: 409,
    });
    updated.name = "篡改响应对象";
    expect((await services.projects.get(first.id)).name).toBe("修改名称");
    expect((await mock().projects.list()).items).toEqual([]);
  });

  it("Mock幂等键绑定项目，任务列表不串项目", async () => {
    const services = mock();
    const a = await services.projects.create({ name: "甲" });
    const b = await services.projects.create({ name: "乙" });
    const job = await services.jobs.create({ project_id: a.id }, "one-request");
    expect((await services.jobs.create({ project_id: a.id }, "one-request")).id).toBe(job.id);
    await expect(services.jobs.create({ project_id: b.id }, "one-request")).rejects.toMatchObject({ code: "JOB_IDEMPOTENCY_CONFLICT" });
    expect((await services.jobs.list({ project_id: a.id })).total).toBe(1);
    expect((await services.jobs.list({ project_id: b.id })).total).toBe(0);
  });

  it("Mock任务取消后迟到时间不将其恢复成功，终态不能取消", async () => {
    vi.useFakeTimers();
    const services = mock();
    const p = await services.projects.create({ name: "测试" });
    const cancelled = await services.jobs.create({ project_id: p.id }, "cancel-key");
    await services.jobs.cancel(cancelled.id);
    await vi.advanceTimersByTimeAsync(2500);
    expect((await services.jobs.get(cancelled.id)).status).toBe("cancelled");
    expect((await services.jobs.cancel(cancelled.id)).status).toBe("cancelled");
    const done = await services.jobs.create({ project_id: p.id }, "done-key");
    await vi.advanceTimersByTimeAsync(600);
    expect((await services.jobs.get(done.id)).status).toBe("running");
    await vi.advanceTimersByTimeAsync(1500);
    expect((await services.jobs.get(done.id)).status).toBe("succeeded");
    await expect(services.jobs.cancel(done.id)).rejects.toMatchObject({ code: "JOB_STATE_CONFLICT" });
  });

  it("两种适配器均拒绝无效输入，不发送请求或写入状态", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const services of [mock(), http(fetcher)]) {
      await expect(services.projects.create({ name: " \n " })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(services.projects.list({ limit: 101 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(services.projects.get("invalid-id")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(services.projects.update(projectId, { name: "合法名", expected_version: 0 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(services.jobs.create({ project_id: projectId }, "bad key")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("预先取消的写入不会发生，HTTP不因失败回退Mock", async () => {
    const aborter = new AbortController();
    aborter.abort();
    const services = mock();
    await expect(services.projects.create({ name: "不应写入" }, aborter.signal)).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect((await services.projects.list()).total).toBe(0);
    const failing = http(vi.fn<typeof fetch>().mockRejectedValue(new Error("PRIVATE-TRANSPORT")));
    await expect(failing.projects.list()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    await expect(failing.projects.list()).rejects.not.toThrow("PRIVATE-TRANSPORT");
  });

  it("HTTP按真实契约传参，不附带前端管理令牌", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ items: [project], total: 1, limit: 20, offset: 0 }))
      .mockResolvedValueOnce(json({ ...project, version: 2 }))
      .mockResolvedValueOnce(json(diagnostic, 202));
    const services = http(fetcher);
    await services.projects.list();
    expect(fetcher.mock.calls[0]![0]).toBe("/api/v1/projects?limit=20&offset=0");
    await services.projects.update(projectId, { name: " 更新 ", expected_version: 1 });
    const update = fetcher.mock.calls[1]![1]!;
    expect(update.method).toBe("PATCH");
    expect(JSON.parse(update.body as string)).toEqual({ name: "更新", expected_version: 1 });
    expect(new Headers(update.headers).has("Authorization")).toBe(false);
    expect(update.redirect).toBe("error");
    await services.jobs.create({ project_id: projectId }, "stable-key");
    expect(new Headers(fetcher.mock.calls[2]![1]!.headers).get("Idempotency-Key")).toBe("stable-key");
  });

  it("HTTP保留服务端错误码和安全请求标识，不回显私密错误正文", async () => {
    for (const [status, code] of [
      [401, "UNAUTHORIZED"],
      [409, "PROJECT_VERSION_CONFLICT"],
      [503, "NOT_READY"],
    ] as const) {
      const services = http(
        vi.fn<typeof fetch>().mockResolvedValue(json({ error: { code, message: "PRIVATE-PAPER-PASSWORD", request_id: "trace_123" } }, status)),
      );
      try {
        await services.projects.get(projectId);
        throw new Error("expected error");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ code, status, requestId: "trace_123" });
        expect(String(error)).not.toContain("PRIVATE-PAPER-PASSWORD");
      }
    }
  });

  it("HTTP拒绝无效结构、未知任务状态和伪造时间", async () => {
    await expect(http(vi.fn<typeof fetch>().mockResolvedValue(json({ ...project, id: "bad" }))).projects.get(projectId)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(http(vi.fn<typeof fetch>().mockResolvedValue(json({ ...diagnostic, status: "partial" }))).jobs.get(jobId)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(
      http(vi.fn<typeof fetch>().mockResolvedValue(json({ ...project, created_at: "2026-02-31T12:00:00Z" }))).projects.get(projectId),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(http(vi.fn<typeof fetch>().mockResolvedValue(new Response("PRIVATE HTML", { status: 502 }))).projects.list()).rejects.toMatchObject({
      code: "HTTP_ERROR",
      status: 502,
    });
  });

  it("HTTP超时与用户取消独立分类，迟到响应不返回成功", async () => {
    vi.useFakeTimers();
    let finish: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const services = http(vi.fn<typeof fetch>().mockReturnValue(pending), 50);
    const timeout = expect(services.projects.get(projectId)).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(51);
    await timeout;
    finish(json(project));
    await Promise.resolve();
    const aborter = new AbortController();
    const cancelled = expect(
      http(vi.fn<typeof fetch>().mockReturnValue(new Promise(() => undefined))).projects.get(projectId, aborter.signal),
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    aborter.abort();
    await cancelled;
  });

  it("DTO映射区分项目元数据版本与文档版本，成功态明确转换", () => {
    expect(toProjectView(project)).toEqual({ id: project.id, title: project.name, metadataVersion: 1, createdAt: timestamp, updatedAt: timestamp });
    expect(toProjectView(project)).not.toHaveProperty("document");
    expect(toJobView({ ...diagnostic, status: "succeeded" }).status).toBe("done");
    expect(() => parseDto("JobRead", { ...diagnostic, result: JSON.parse('{"nested":{"__proto__":{"admin":true}}}') })).toThrow(ApiError);
  });

  it("实例身份和同源接口路径必须明确有效", () => {
    expect(mock().sourceKey).toBe("mock:unit");
    expect(() => createServices({ mode: "http", instanceId: "", baseUrl: "/api/v1" })).toThrow(ApiError);
    for (const baseUrl of ["https://other.invalid/api", "//other.invalid/api", "/api/../private", "/api?token=secret"])
      expect(() => createServices({ mode: "http", instanceId: "unit", baseUrl })).toThrow(ApiError);
  });
});
