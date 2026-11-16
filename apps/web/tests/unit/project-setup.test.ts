import { effectScope, nextTick, ref, type EffectScope } from "vue";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ApiError, type BackendServices, type JobQuery, type JobRead, type JobService, type ProjectRead } from "../../src/services/index.ts";
import { readAll } from "../../src/workspace/projects/flowCatalog.ts";
import {
  changedFields,
  createPayload,
  draftOf,
  emptyDraft,
  findCreatedProject,
  isUncertain,
  projectNameError,
} from "../../src/workspace/projects/projectSetup.ts";
import { deadlineLabel, documentLabel, flowLabel, planningLabel, sourcesLabel, stageLabel } from "../../src/workspace/projects/projectFacts.ts";
import { attemptDiagnosis, fixedInput, useKindFilteredJobs } from "../../src/workspace/jobs/jobPresentation.ts";

const projectId = "15e786c6-7ed2-4058-8bef-00fa087ae510";
const time = "2026-11-18T08:00:00.000Z";
const scopes: EffectScope[] = [];
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()));

function project(overrides: Partial<ProjectRead> = {}): ProjectRead {
  return {
    id: projectId,
    name: "合成项目",
    title: "",
    deadline: null,
    planning_mode: "none",
    plan_note: "",
    existing_artifacts: "",
    flow_version_id: null,
    stage_id: null,
    archived: false,
    version: 3,
    created_at: time,
    updated_at: time,
    ...overrides,
  };
}

describe("首次设置的分步落库", () => {
  it("创建载荷去除空白并把空截止和未绑定流程写为 null", () => {
    const draft = { ...emptyDraft(), name: "  毕业论文 ", title: " 题目 ", planning_mode: "personal" as const, plan_note: " 先开题 " };
    expect(createPayload(draft)).toEqual({
      name: "毕业论文",
      title: "题目",
      deadline: null,
      planning_mode: "personal",
      plan_note: "先开题",
      existing_artifacts: "",
      flow_version_id: null,
      stage_id: null,
    });
  });

  it("续设只提交真正改变的字段，未改动时不发起更新", () => {
    const stored = project({ title: "原题目", deadline: "2027-06-01" });
    expect(changedFields(draftOf(stored), stored)).toBeNull();
    expect(changedFields({ ...draftOf(stored), title: "新题目", deadline: "" }, stored)).toEqual({ title: "新题目", deadline: null });
    expect(changedFields({ ...draftOf(stored), flow_version_id: "v1", stage_id: "s1" }, stored)).toEqual({ flow_version_id: "v1", stage_id: "s1" });
  });

  it("创建结果未确认时按名称与时间找回刚创建的项目，排除旧项目和已归档项目", () => {
    const since = Date.parse(time);
    const fresh = project({ id: "fresh", created_at: new Date(since + 1000).toISOString() });
    const old = project({ id: "old", created_at: "2026-01-01T00:00:00.000Z" });
    const archived = project({ id: "archived", archived: true, created_at: new Date(since + 2000).toISOString() });
    const other = project({ id: "other", name: "其他", created_at: new Date(since + 3000).toISOString() });
    expect(findCreatedProject([old, archived, other, fresh], " 合成项目 ", since)?.id).toBe("fresh");
    expect(findCreatedProject([old, other], "合成项目", since)).toBeUndefined();
  });

  it("只有网络、5xx 或无效响应才视为结果未知", () => {
    expect(isUncertain(new ApiError("NETWORK_ERROR"))).toBe(true);
    expect(isUncertain(new ApiError("SERVER_ERROR", { status: 503 }))).toBe(true);
    expect(isUncertain(new ApiError("INVALID_RESPONSE", { status: 200 }))).toBe(true);
    expect(isUncertain(new ApiError("VALIDATION_ERROR", { status: 422 }))).toBe(false);
    expect(projectNameError(" ")).toContain("1 至 200");
    expect(projectNameError("项".repeat(201))).toContain("1 至 200");
    expect(projectNameError("论文")).toBe("");
  });

  it("分页读取必须完整，偏移错位视为无效响应", async () => {
    const pages = [
      { items: [1, 2], total: 3, offset: 0, limit: 2 },
      { items: [3], total: 3, offset: 2, limit: 2 },
    ];
    const read = vi.fn(async ({ offset }: { offset?: number }) => pages.find((page) => page.offset === offset)!);
    expect(await readAll(read, new AbortController().signal, 2)).toEqual([1, 2, 3]);
    await expect(readAll(async () => ({ items: [1], total: 3, offset: 5 }), new AbortController().signal, 2)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});

describe("项目卡片事实", () => {
  const flow = { id: "flow", name: "比赛流程", enabled: true } as never;
  const version = { id: "v2", flow_id: "flow", version: 2, name: "比赛流程", stages: [{ id: "s1", name: "开题" }] } as never;
  const catalog = { state: "ready" as const, versions: new Map([["v2", { flow, version }]]) };

  it("按不可变版本显示阶段与流程，缺失时明确说明而不猜测", () => {
    const bound = project({ flow_version_id: "v2", stage_id: "s1" });
    expect(stageLabel(bound, catalog)).toBe("开题");
    expect(flowLabel(bound, catalog)).toBe("比赛流程 v2");
    expect(stageLabel(project(), catalog)).toBe("未绑定流程");
    expect(flowLabel(project({ flow_version_id: "gone" }), catalog)).toBe("流程版本不可用");
    expect(stageLabel(bound, { state: "failed" })).toBe("阶段暂时无法读取");
  });

  it("区分未创建正文、读取失败与模板要求绑定数量", () => {
    expect(documentLabel({ state: "missing" })).toBe("尚未创建正式稿");
    expect(documentLabel({ state: "failed" })).toBe("正文暂时无法读取");
    expect(documentLabel({ state: "ready", value: 4 })).toBe("v4");
    const binding = {
      project_id: projectId,
      current_version_id: "b",
      template_parse_version_id: "t",
      requirement_parse_version_ids: ["r1", "r2"],
      updated_at: time,
      version: 2,
    };
    expect(sourcesLabel({ state: "ready", value: binding })).toBe("模板已绑定 · 要求 2 份 · 绑定 v2");
    expect(sourcesLabel({ state: "ready", value: { ...binding, template_parse_version_id: null, requirement_parse_version_ids: [] } })).toBe(
      "模板与要求未绑定",
    );
    expect(planningLabel(project())).toContain("暂不规划");
    expect(planningLabel(project({ planning_mode: "personal", plan_note: "先开题" }))).toBe("先开题");
    expect(deadlineLabel(null)).toBe("未设置");
    expect(deadlineLabel("2027-06-01")).toContain("2027");
  });
});

describe("执行任务的尝试诊断与类型筛选", () => {
  it("逐次诊断不把中断或取消说成失败原因，固定输入完整展示", () => {
    expect(attemptDiagnosis({ status: "failed", error_code: "JOB_EXECUTION_TIMEOUT" })).toBe("执行超时");
    expect(attemptDiagnosis({ status: "cancelled", error_code: null })).toContain("不会写入");
    expect(attemptDiagnosis({ status: "lease_expired", error_code: null })).toContain("中断");
    const text = fixedInput({ resource_scope: { schema_version: 1, document_id: "d", document_version: 2 }, input_snapshot: null, configuration: null });
    expect(JSON.parse(text)).toEqual({
      resource_scope: { schema_version: 1, document_id: "d", document_version: 2 },
      input_snapshot: null,
      configuration: null,
    });
  });

  it("按类型筛选向接口传 kind，切换类型立即清空旧类型的行", async () => {
    const jobs: JobRead[] = [
      {
        id: "a",
        kind: "material_parse",
        project_id: projectId,
        status: "failed",
        attempt: 1,
        result: null,
        error_code: null,
        created_at: time,
        updated_at: time,
      },
      {
        id: "b",
        kind: "document_inspection",
        project_id: projectId,
        status: "succeeded",
        attempt: 1,
        result: null,
        error_code: null,
        created_at: time,
        updated_at: time,
      },
    ];
    const list = vi.fn<JobService["list"]>(async (query: JobQuery) => {
      const items = jobs.filter((job) => (!query.kind || job.kind === query.kind) && (!query.status || query.status.includes(job.status)));
      return { items, total: items.length, offset: query.offset ?? 0, limit: query.limit ?? 12 };
    });
    const services = {
      sourceKey: "http:test",
      projects: { list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn() },
      jobs: { list, get: vi.fn(), create: vi.fn(), cancel: vi.fn(), retry: vi.fn() },
    } satisfies Pick<BackendServices, "sourceKey" | "jobs" | "projects">;
    const scope = effectScope();
    scopes.push(scope);
    const current = ref<string | undefined>(projectId);
    const filtered = scope.run(() => useKindFilteredJobs(services, current, "workspace-1"))!;
    expect(filtered.active.value).toBe(false);
    expect(list).not.toHaveBeenCalled();

    filtered.changeKind("material_parse", "all");
    await vi.waitFor(() => expect(filtered.scoped.directory.value.map((job: JobRead) => job.id)).toEqual(["a"]));
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ kind: "material_parse", project_id: projectId }), expect.any(AbortSignal));

    filtered.changeKind("document_inspection", "succeeded");
    expect(filtered.scoped.directory.value).toEqual([]);
    await vi.waitFor(() => expect(filtered.scoped.directory.value.map((job: JobRead) => job.id)).toEqual(["b"]));
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ kind: "document_inspection", status: ["succeeded"] }), expect.any(AbortSignal));

    filtered.changeKind("all", "all");
    await nextTick();
    expect(filtered.active.value).toBe(false);
  });
});
