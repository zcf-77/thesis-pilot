import { effectScope, type EffectScope } from "vue";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ApiError, createServices, type RestoreRead } from "../../src/services/index.ts";
import { createHttpBackups } from "../../src/services/httpBackups.ts";
import { sha256Sync } from "../../src/services/mockExports.ts";
import { serviceJobTitle, canRerunServiceJob } from "../../src/lab/state/serviceJobs.ts";
import { backupFailure, objectTotal, restoreFailure, useBackups } from "../../src/workspace/export/useBackups.ts";

const scopes: EffectScope[] = [];
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.useRealTimers();
});

async function seeded() {
  const api = createServices({ mode: "mock", instanceId: `backups-${crypto.randomUUID()}` });
  const project = await api.projects.create({ name: "合成备份项目", title: "自制题目" });
  return { api, project };
}

describe("项目备份与恢复服务", () => {
  it("备份任务完成后可下载且摘要一致；同键重放、异键冲突，任务托盘同源", async () => {
    vi.useFakeTimers();
    const { api, project } = await seeded();
    const queued = await api.backups.create(project.id, "backup-1");
    expect(queued).toMatchObject({ status: "queued", file: null, project_id: project.id });
    expect((await api.backups.create(project.id, "backup-1")).job_id).toBe(queued.job_id);
    await expect(api.backups.download(project.id, queued.job_id)).rejects.toMatchObject({ code: "BACKUP_FILE_NOT_READY" });
    await vi.advanceTimersByTimeAsync(2500);
    const done = await api.backups.get(project.id, queued.job_id);
    expect(done.status).toBe("succeeded");
    const file = await api.backups.download(project.id, queued.job_id);
    expect(sha256Sync(new Uint8Array(await file.blob.arrayBuffer()))).toBe(done.file!.sha256);
    const job = (await api.jobs.list({ project_id: project.id })).items.find((item) => item.id === queued.job_id)!;
    expect(serviceJobTitle(job)).toBe("项目备份");
    expect(canRerunServiceJob({ ...job, kind: "project_restore", status: "failed" })).toBe(false);
    await expect(api.jobs.create({ project_id: project.id, kind: "project_backup" }, "forged")).rejects.toMatchObject({ code: "JOB_KIND_UNAVAILABLE" });
  });

  it("恢复为新项目：原项目不变，名称附恢复副本；无效与不支持的格式明确拒绝且不记录", async () => {
    vi.useFakeTimers();
    const { api, project } = await seeded();
    const queued = await api.backups.create(project.id, "backup-2");
    await vi.advanceTimersByTimeAsync(2500);
    const { blob } = await api.backups.download(project.id, queued.job_id);
    const receipt = await api.backups.upload(blob, "合成备份.zip", "restore-1");
    expect(receipt).toMatchObject({ status: "queued", result_project_id: null, source_project_name: "合成备份项目" });
    const done = await api.backups.restore(receipt.job_id);
    expect(done.status).toBe("succeeded");
    const copy = await api.projects.get(done.result_project_id!);
    expect(copy.id).not.toBe(project.id);
    expect(copy.name).toBe("合成备份项目（恢复副本）");
    expect((await api.projects.get(project.id)).name).toBe("合成备份项目");
    await expect(api.backups.upload(new Blob(["not a zip"]), "x.zip", "restore-2")).rejects.toMatchObject({ code: "BACKUP_PACKAGE_INVALID" });
    await expect(
      api.backups.upload(new Blob([JSON.stringify({ format: "thesispilot-backup/9", project: { id: "x", name: "y" } })]), "x.zip", "restore-3"),
    ).rejects.toMatchObject({
      code: "BACKUP_FORMAT_UNSUPPORTED",
    });
    expect((await api.backups.restores()).total).toBe(1);
    await expect(api.backups.upload(new Blob(["other"]), "x.zip", "restore-1")).rejects.toMatchObject({ code: "JOB_IDEMPOTENCY_CONFLICT" });
  });

  it("页面状态：恢复完成只为本页发起的恢复跳转一次，失败给出三段式说明", async () => {
    vi.useFakeTimers();
    const { api, project } = await seeded();
    const queued = await api.backups.create(project.id, "backup-3");
    await vi.advanceTimersByTimeAsync(2500);
    const { blob } = await api.backups.download(project.id, queued.job_id);
    const restored: RestoreRead[] = [];
    const scope = effectScope();
    scopes.push(scope);
    const state = scope.run(() => useBackups(api, project.id, (value) => restored.push(value)))!;
    await state.refresh();
    expect(state.backups.value.map((item) => item.job_id)).toContain(queued.job_id);
    expect(await state.restoreFrom(new File([blob], "备份.zip"))).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(state.restore.value?.status).toBe("succeeded");
    expect(restored).toHaveLength(1);
    await state.refresh();
    expect(restored).toHaveLength(1);
    expect(await state.restoreFrom(new File(["坏文件"], "坏.zip"))).toBe(false);
    expect(state.actionError.value).toMatchObject({ scope: "restore", message: new ApiError("BACKUP_PACKAGE_INVALID").message });
    expect(objectTotal({ projects: 1, tasks: 3 })).toBe(4);
    expect(restoreFailure({ ...state.restore.value!, status: "failed", error_code: "BACKUP_PACKAGE_CORRUPT" })).toContain("摘要校验未通过");
    expect(restoreFailure({ ...state.restore.value!, status: "cancelled" })).toContain("没有创建新项目");
    expect(backupFailure({ ...state.backups.value[0]!, status: "failed", error_code: "BACKUP_PACKAGE_TOO_LARGE" })).toContain("256MiB");
  });

  it("HTTP 适配：上传以 application/zip 原文发送、校验下载摘要，拒绝不一致的响应", async () => {
    const calls: { path: string; method?: string; body?: unknown; headers?: Record<string, string> }[] = [];
    const jobId = crypto.randomUUID();
    const restoreRead = {
      job_id: jobId,
      restore_id: crypto.randomUUID(),
      status: "queued",
      attempt: 0,
      error_code: null,
      filename: "a.zip",
      sha256: "0".repeat(64),
      byte_size: 3,
      package_sha256: "1".repeat(64),
      source_project_id: crypto.randomUUID(),
      source_project_name: "合成",
      schema_head: "20261119_0021",
      exported_at: new Date().toISOString(),
      object_counts: { projects: 1 },
      result_project_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const request = (async (path: string, _schema: string, method?: string, body?: unknown, _signal?: AbortSignal, headers?: Record<string, string>) => {
      calls.push({ path, method, body, headers });
      return restoreRead;
    }) as never;
    const http = createHttpBackups(request, (async () => new Blob()) as never);
    const file = new Blob(["abc"], { type: "application/zip" });
    // A queued restore claiming a result project is an invalid response.
    await expect(http.upload(file, "备份 1.zip", "key-1")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(calls[0]).toMatchObject({
      path: `/backups/restores?filename=${encodeURIComponent("备份 1.zip")}`,
      method: "POST",
      body: file,
      headers: { "Idempotency-Key": "key-1" },
    });
    await expect(http.upload(new Blob([]), "empty.zip", "key-2")).rejects.toMatchObject({ code: "BACKUP_PACKAGE_TOO_LARGE" });
  });
});
