import { effectScope, ref, type EffectScope } from "vue";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ApiError, type BackendServices, type JobQuery, type JobRead, type JobService } from "../../src/services/index.ts";
import { createServiceJobsState, serviceJobFailure } from "../../src/lab/state/serviceJobs.ts";

const project = "15e786c6-7ed2-4058-8bef-00fa087ae510";
const otherProject = "2f73a2fd-332a-4148-a37c-a5fb0c7692a3";
const time = "2026-11-17T07:16:00.000Z";
const scopes: EffectScope[] = [];
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  vi.unstubAllGlobals();
});

function job(id: string, status: JobRead["status"], projectId = project, error_code: string | null = null): JobRead {
  return { id, kind: "diagnostic", project_id: projectId, status, attempt: 1, result: null, error_code, created_at: time, updated_at: time };
}
function directory(items: JobRead[], query: JobQuery) {
  const filtered = items.filter((item) => item.project_id === query.project_id && (!query.status || query.status.includes(item.status)));
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 12;
  return { items: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((result) => (resolve = result));
  return { promise, resolve };
}
function setup(items: JobRead[] = [], id = project, sourceKey = "http:" + crypto.randomUUID(), workspaceId?: string) {
  const projects = { list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn() };
  const jobs = {
    list: vi.fn<JobService["list"]>(async (query) => directory(items, query)),
    get: vi.fn<JobService["get"]>(async (jobId) => {
      const selected = items.find((item) => item.id === jobId);
      if (!selected) throw new ApiError("JOB_NOT_FOUND");
      return { ...selected, attempts: [], artifacts: [] };
    }),
    create: vi.fn<JobService["create"]>(),
    cancel: vi.fn<JobService["cancel"]>(),
    retry: vi.fn<JobService["retry"]>(),
  } satisfies BackendServices["jobs"];
  const currentProject = ref<string | undefined>(id);
  const scope = effectScope();
  scopes.push(scope);
  const state = scope.run(() => createServiceJobsState({ sourceKey, jobs, projects }, currentProject, workspaceId))!;
  return { jobs, state, scope, currentProject, sourceKey };
}

describe("共享服务任务状态", () => {
  it("活跃计数来自过滤结果，仍能看到目录较早的运行任务和跨页近期任务", async () => {
    const complete = Array.from({ length: 20 }, (_, index) => job("complete-" + index, "succeeded"));
    const active = Array.from({ length: 13 }, (_, index) => job("active-" + index, index === 0 ? "queued" : "running"));
    const { jobs, state } = setup([...complete, ...active]);
    await state.refresh(0);
    expect(state.directory.value.every((item) => item.status === "succeeded")).toBe(true);
    expect(state.activeCount.value).toBe(13);
    expect(state.tray.value).toHaveLength(8);
    expect(state.tray.value[0]).toEqual(active[0]);
    expect(jobs.list).toHaveBeenCalledWith(expect.objectContaining({ status: ["queued", "running"], offset: 0 }), expect.any(AbortSignal));
    await state.refresh(12);
    expect(state.offset.value).toBe(12);
    expect(state.activeCount.value).toBe(13);
    expect(state.tray.value[0]).toEqual(active[0]);
  });

  it("取消只应用服务确认，先发出的旧列表响应不能恢复运行状态", async () => {
    const original = job("first", "running");
    const items = [original];
    const { jobs, state } = setup(items);
    await state.refresh();
    const old = deferred<Awaited<ReturnType<JobService["list"]>>>();
    jobs.list.mockImplementationOnce(() => old.promise);
    const refresh = state.refresh();
    const confirmation = deferred<JobRead>();
    jobs.cancel.mockImplementation(() => confirmation.promise);
    const cancelling = state.cancel(original);
    await state.cancel(original);
    expect(jobs.cancel).toHaveBeenCalledTimes(1);
    expect(state.tray.value[0]?.status).toBe("running");
    expect(state.directory.value[0]?.status).toBe("running");
    items[0] = job("first", "cancelled");
    confirmation.resolve(items[0]);
    await cancelling;
    old.resolve(directory([original], { project_id: project }));
    await refresh;
    expect(state.directory.value[0]?.status).toBe("cancelled");
    expect(state.tray.value[0]?.status).toBe("cancelled");
    expect(state.activeCount.value).toBe(0);
  });

  it("取消请求超时保留任务最后确认的状态", async () => {
    const running = job("running", "running");
    const { jobs, state } = setup([running]);
    await state.refresh();
    jobs.cancel.mockRejectedValue(new ApiError("REQUEST_TIMEOUT"));
    await state.cancel(running);
    expect(state.actionError.value).toContain("尚不能确认");
    expect(state.directory.value[0]?.status).toBe("running");
    expect(state.tray.value[0]?.status).toBe("running");
    expect(state.notice.value).toBe("");
  });

  it("重新运行使用独立请求，响应未知时重放原键并保留旧终态", async () => {
    const failed = job("failed", "failed", project, "JOB_EXECUTION_TIMEOUT");
    const items = [failed];
    const { jobs, state } = setup(items);
    await state.refresh();
    jobs.create.mockRejectedValueOnce(new ApiError("REQUEST_TIMEOUT"));
    await state.createDiagnostic(failed);
    expect(state.pendingCreation.value).toBe(true);
    expect(state.actionError.value).toContain("请求超时");
    expect(state.directory.value).toEqual([failed]);
    await state.createDiagnostic(failed);
    expect(jobs.create).toHaveBeenCalledTimes(1);

    jobs.create.mockImplementationOnce(async () => {
      const newJob = job("new", "queued");
      items.unshift(newJob);
      return newJob;
    });
    await state.createDiagnostic();
    expect(jobs.create.mock.calls[0]?.[1]).toBe(jobs.create.mock.calls[1]?.[1]);
    expect(state.pendingCreation.value).toBe(false);
    expect(state.directory.value.map(({ id, status }) => [id, status])).toEqual([
      ["new", "queued"],
      ["failed", "failed"],
    ]);

    jobs.create.mockResolvedValueOnce(job("another", "queued"));
    await state.createDiagnostic(failed);
    expect(jobs.create.mock.calls[2]?.[1]).not.toBe(jobs.create.mock.calls[1]?.[1]);
  });

  it("已保存的未确认键仅在当前服务与项目中重放，确认后清除", async () => {
    const sourceKey = "http:session-storage";
    const storedKey = "71257df7-b46e-4604-a195-197ee1ee93e4";
    const scopedKey = "thesispilot.pending-diagnostic:" + JSON.stringify([sourceKey, project]);
    const storage = new Map([[scopedKey, storedKey]]);
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => storage.get(key),
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const { jobs, state, currentProject } = setup([], project, sourceKey);
    expect(state.pendingCreation.value).toBe(true);
    currentProject.value = otherProject;
    expect(state.pendingCreation.value).toBe(false);
    currentProject.value = project;
    expect(state.pendingCreation.value).toBe(true);
    jobs.create.mockResolvedValue(job("confirmed", "queued"));
    await state.createDiagnostic();
    expect(jobs.create.mock.calls[0]?.[1]).toBe(storedKey);
    expect(storage.has(scopedKey)).toBe(false);
  });

  it("切换项目后忽略迟到的操作与列表，并拒绝其他项目的详情", async () => {
    const previous = job("previous", "queued");
    const current = job("current", "queued", otherProject);
    const { jobs, state, currentProject } = setup([previous, current]);
    await state.refresh();
    const running = deferred<JobRead>();
    jobs.create.mockImplementationOnce(() => running.promise);
    const inFlight = state.createDiagnostic();
    currentProject.value = otherProject;
    await state.refresh();
    running.resolve(job("late", "queued"));
    await inFlight;
    expect(state.directory.value).toEqual([current]);
    expect(state.tray.value).toEqual([current]);
    expect(state.notice.value).toBe("");
    await state.inspect(previous.id);
    expect(state.detail.value).toBeUndefined();
    expect(state.detailError.value).toContain("任务不存在");

    currentProject.value = project;
    expect(state.pendingCreation.value).toBe(true);
    jobs.create.mockResolvedValueOnce(job("late", "queued"));
    await state.createDiagnostic();
    expect(jobs.create.mock.calls[1]?.[1]).toBe(jobs.create.mock.calls[0]?.[1]);
  });

  it("执行错误仅以任务终态映射为可理解原因", () => {
    expect(serviceJobFailure(job("timeout", "failed", project, "JOB_EXECUTION_TIMEOUT"))).toBe("执行超时");
    expect(serviceJobFailure(job("invalid", "failed", project, "JOB_RESULT_INVALID"))).toBe("结果未通过校验");
    expect(serviceJobFailure(job("pending", "running", project, "JOB_EXECUTION_TIMEOUT"))).toBe("");
    expect(serviceJobFailure(job("unknown", "failed", project, "secret-code"))).toBe("执行失败");
  });

  it("正式任务失去受理响应后沿用请求键，失败重试保留原任务和输入范围", async () => {
    const documentId = "8a698f9e-7a67-4b42-920d-a4ade788318a";
    const snapshot = { schema_version: 1 as const, document_id: documentId, document_version: 3 };
    const configuration = { schema_version: 1 as const, include_text_statistics: true };
    const original: JobRead = {
      ...job("original", "cancelled"),
      kind: "document_inspection",
      input_snapshot: snapshot,
      resource_scope: snapshot,
      configuration,
      source_job_id: null,
    };
    const items: JobRead[] = [];
    const { jobs, state } = setup(items, project, undefined, "formal");
    jobs.create.mockRejectedValueOnce(new ApiError("REQUEST_TIMEOUT"));
    expect(await state.inspectDocument(documentId, 3)).toBeUndefined();
    jobs.create.mockImplementationOnce(async () => {
      items.unshift(original);
      return original;
    });
    expect(await state.inspectDocument(documentId, 3)).toEqual(original);
    expect(jobs.create.mock.calls[1]?.[1]).toBe(jobs.create.mock.calls[0]?.[1]);
    expect(jobs.create.mock.calls[1]?.[0]).toEqual({
      project_id: project,
      kind: "document_inspection",
      input_snapshot: snapshot,
      configuration,
    });
    expect(state.directory.value).toHaveLength(1);
    await state.inspect(original.id);
    expect(jobs.get).toHaveBeenCalledWith(original.id, expect.any(AbortSignal), project);
    expect(state.detailData.value?.resource_scope).toEqual(snapshot);

    jobs.retry.mockRejectedValueOnce(new ApiError("REQUEST_TIMEOUT"));
    expect(await state.retry(original)).toBeUndefined();
    const renewed = { ...original, id: "restarted", status: "queued" as const, source_job_id: original.id };
    jobs.retry.mockImplementationOnce(async () => {
      items.unshift(renewed);
      return renewed;
    });
    expect(await state.retry(original)).toEqual(renewed);
    expect(jobs.retry.mock.calls[0]?.[1]).toBe(jobs.retry.mock.calls[1]?.[1]);
    expect(jobs.retry.mock.calls[1]?.[3]).toBe(project);
    expect(state.directory.value.map(({ id, status }) => [id, status])).toEqual([
      ["restarted", "queued"],
      ["original", "cancelled"],
    ]);
    expect(state.detailData.value?.id).toBe(original.id);
  });
});
