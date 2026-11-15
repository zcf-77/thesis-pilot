import { describe, expect, it, vi } from "vite-plus/test";
import { createServices } from "../../src/services/index.ts";
import type { FlowCreate, FlowRead, FlowStage, FlowVersionRead, ProjectUpdate } from "../../src/services/contracts/api.generated.ts";

const timestamp = "2026-11-17T10:00:00Z";
const flowId = "09c93463-a51f-4fba-9a18-e934268bb5ee";
const versionId = "a0bc2a3d-572f-47a1-b779-84dc10cc3925";
const otherId = "ccb234bb-e2b7-435e-8eb6-43312798dcbf";
const stage = (id = "proposal", changes: Partial<FlowStage> = {}): FlowStage => ({
  id,
  name: id === "proposal" ? "开题" : "写作",
  description: "自制演示阶段",
  deliverables: ["阶段稿"],
  conditions: ["本人核对产物"],
  dependencies: [],
  enabled: true,
  start: null,
  deadline: null,
  ...changes,
});
const flow = (changes: Partial<FlowRead> = {}): FlowRead => ({
  id: flowId,
  name: "自制流程",
  enabled: true,
  version: 1,
  current_version_id: versionId,
  stages: [stage()],
  created_at: timestamp,
  updated_at: timestamp,
  ...changes,
});
const historical = (changes: Partial<FlowVersionRead> = {}): FlowVersionRead => ({
  id: versionId,
  flow_id: flowId,
  version: 1,
  name: "自制流程",
  stages: [stage()],
  created_at: timestamp,
  ...changes,
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const mock = () => createServices({ mode: "mock", instanceId: "flow-unit" });
const http = (fetch: typeof globalThis.fetch) => createServices({ mode: "http", instanceId: "flow-unit", fetch });

describe("SG-18A 项目生命周期与流程同契约服务", () => {
  it("项目无规划默认值、显式修改、归档恢复与CAS保持完整元数据", async () => {
    const api = mock();
    const initial = await api.projects.create({ name: "  自制项目  ", title: " 自制题目 ", existing_artifacts: "已有自制开题稿" });
    expect(initial).toMatchObject({
      name: "自制项目",
      title: "自制题目",
      planning_mode: "none",
      deadline: null,
      archived: false,
      plan_note: "",
      flow_version_id: null,
      stage_id: null,
    });
    const planned = await api.projects.update(initial.id, { expected_version: 1, planning_mode: "personal", plan_note: "每周检查", deadline: "2026-12-01" });
    expect(planned).toMatchObject({
      version: 2,
      name: initial.name,
      title: initial.title,
      existing_artifacts: initial.existing_artifacts,
      planning_mode: "personal",
      deadline: "2026-12-01",
    });
    const archived = await api.projects.update(initial.id, { expected_version: 2, archived: true });
    expect(archived).toMatchObject({ version: 3, archived: true, plan_note: "每周检查" });
    const restored = await api.projects.update(initial.id, { expected_version: 3, archived: false, deadline: null });
    expect(restored).toMatchObject({ version: 4, archived: false, deadline: null, planning_mode: "personal" });
    await expect(api.projects.update(initial.id, { expected_version: 3, title: "陈旧题目" })).rejects.toMatchObject({ code: "PROJECT_VERSION_CONFLICT" });
    expect((await api.projects.get(initial.id)).title).toBe("自制题目");
  });

  it("流程并发更新只有一个成功，历史快照和返回对象不可篡改存储", async () => {
    const api = mock();
    const original = await api.projectFlows.create({ name: "  自制流程  ", stages: [stage()] });
    const firstVersion = await api.projectFlows.version(original.id, 1);
    expect(firstVersion.id).toBe(original.current_version_id);
    const updates = await Promise.allSettled([
      api.projectFlows.update(original.id, { expected_version: 1, name: "修订流程甲" }),
      api.projectFlows.update(original.id, { expected_version: 1, name: "修订流程乙" }),
    ]);
    expect(updates.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(updates.find((item) => item.status === "rejected")?.reason).toMatchObject({ code: "PROJECT_FLOW_VERSION_CONFLICT", status: 409 });
    original.stages[0]!.name = "改响应";
    firstVersion.stages[0]!.deliverables.push("改历史响应");
    expect((await api.projectFlows.version(original.id, 1)).stages).toEqual([stage()]);
    const versions = await api.projectFlows.versions(original.id, { limit: 1 });
    expect(versions).toMatchObject({ total: 2, limit: 1, offset: 0 });
    expect(versions.items[0]!.version).toBe(2);
    expect((await api.projectFlows.versions(original.id, { offset: 1 })).items[0]!.version).toBe(1);
    expect((await mock().projectFlows.list()).total).toBe(0);
  });

  it("停用流程拒绝新绑定，原项目保留固定版本并可编辑归档和解除绑定", async () => {
    const api = mock();
    const initial = await api.projectFlows.create({ name: "固定版本", stages: [stage()] });
    const project = await api.projects.create({ name: "原绑定", flow_version_id: initial.current_version_id, stage_id: "proposal" });
    await api.projectFlows.update(initial.id, { expected_version: 1, stages: [stage("writing")] });
    expect((await api.projects.get(project.id)).flow_version_id).toBe(initial.current_version_id);
    await api.projectFlows.update(initial.id, { expected_version: 2, enabled: false });
    await expect(api.projects.create({ name: "新绑定", flow_version_id: initial.current_version_id, stage_id: "proposal" })).rejects.toMatchObject({
      code: "PROJECT_FLOW_DISABLED",
      status: 409,
    });
    expect((await api.projects.list()).total).toBe(1);
    const edited = await api.projects.update(project.id, { expected_version: 1, archived: true, title: "不变更绑定" });
    expect(edited).toMatchObject({ archived: true, flow_version_id: initial.current_version_id, stage_id: "proposal" });
    await api.projects.update(project.id, { expected_version: 2, flow_version_id: initial.current_version_id.toUpperCase() });
    expect((await api.projectFlows.version(initial.id, 1)).stages[0]!.id).toBe("proposal");
    const unbound = await api.projects.update(project.id, { expected_version: 3, flow_version_id: null, stage_id: null });
    expect(unbound).toMatchObject({ flow_version_id: null, stage_id: null, version: 4 });
  });

  it("无效或不完整绑定原子拒绝，不改写已有项目元数据", async () => {
    const api = mock();
    const defined = await api.projectFlows.create({ name: "校验绑定", stages: [stage(), stage("writing", { enabled: false })] });
    const project = await api.projects.create({ name: "原名称" });
    for (const update of [
      { flow_version_id: defined.current_version_id },
      { stage_id: "proposal" },
      { flow_version_id: defined.current_version_id, stage_id: "unknown" },
      { flow_version_id: defined.current_version_id, stage_id: "writing" },
      { flow_version_id: otherId, stage_id: "proposal" },
    ]) {
      await expect(api.projects.update(project.id, { ...update, expected_version: 1, name: "不得写入" })).rejects.toBeInstanceOf(Error);
      expect(await api.projects.get(project.id)).toMatchObject({ version: 1, name: "原名称", flow_version_id: null, stage_id: null });
    }
  });

  it("两种适配器校验阶段图、日期、重复及启用规则，不请求或写入无效流程", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const a = stage("proposal", { deadline: "2026-12-03" });
    const b = stage("writing", { dependencies: ["proposal"], deadline: "2026-12-01" });
    const invalid: FlowStage[][] = [
      [],
      [stage("proposal", { enabled: false })],
      [stage(), stage()],
      [stage(), stage("writing", { name: "开题" })],
      [stage("proposal", { dependencies: ["missing"] })],
      [stage("proposal", { dependencies: ["proposal"] })],
      [stage("proposal", { dependencies: ["writing"] }), stage("writing", { dependencies: ["proposal"] })],
      [stage("proposal", { enabled: false }), stage("writing", { dependencies: ["proposal"] })],
      [stage("proposal", { start: "2026-12-03", deadline: "2026-12-01" })],
      [a, b],
      [stage("proposal", { deliverables: [] })],
      [stage("proposal", { conditions: ["   "] })],
      [stage(), stage("writing", { dependencies: ["proposal", "proposal"] })],
    ];
    for (const api of [mock(), http(fetcher)]) {
      for (const stages of invalid)
        await expect(api.projectFlows.create({ name: "无效阶段", stages })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("默认阶段字段与用户文本按后端规则归一化", async () => {
    const api = mock();
    const created = await api.projectFlows.create({
      name: " 流程 ",
      stages: [{ id: " proposal ", name: " 开题 ", deliverables: [" 自制稿 "], conditions: [" 本人核对 "] }],
    });
    expect(created.stages[0]).toEqual({
      id: "proposal",
      name: "开题",
      description: "",
      deliverables: ["自制稿"],
      conditions: ["本人核对"],
      dependencies: [],
      enabled: true,
      start: null,
      deadline: null,
    });
    expect((await api.projects.create({ name: "绑定", flow_version_id: created.current_version_id, stage_id: " proposal " })).stage_id).toBe("proposal");
  });

  it("预先取消和不存在资源明确失败，流程与项目状态保持不变", async () => {
    const api = mock();
    const controller = new AbortController();
    controller.abort();
    await expect(api.projectFlows.create({ name: "不写入", stages: [stage()] }, controller.signal)).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect((await api.projectFlows.list()).total).toBe(0);
    await expect(api.projectFlows.get(flowId)).rejects.toMatchObject({ code: "PROJECT_FLOW_NOT_FOUND", status: 404 });
    await expect(api.projectFlows.version(flowId, 1)).rejects.toMatchObject({ code: "PROJECT_FLOW_VERSION_NOT_FOUND", status: 404 });
    const current = await api.projectFlows.create({ name: "历史", stages: [stage()] });
    await expect(api.projectFlows.version(current.id, 2)).rejects.toMatchObject({ code: "PROJECT_FLOW_VERSION_NOT_FOUND", status: 404 });
  });

  it("HTTP按流程契约发出分页、读取、创建、PATCH和历史请求", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ items: [flow()], total: 1, limit: 1, offset: 0 }))
      .mockResolvedValueOnce(json(flow()))
      .mockResolvedValueOnce(json(flow(), 201))
      .mockResolvedValueOnce(json(flow({ version: 2, enabled: false })))
      .mockResolvedValueOnce(json({ items: [historical()], total: 1, limit: 20, offset: 0 }))
      .mockResolvedValueOnce(json(historical()));
    const api = http(fetcher);
    await api.projectFlows.list({ limit: 1 });
    await api.projectFlows.get(flowId);
    await api.projectFlows.create({ name: " 自制流程 ", stages: [stage()] });
    await api.projectFlows.update(flowId, { expected_version: 1, enabled: false });
    await api.projectFlows.versions(flowId);
    await api.projectFlows.version(flowId, 1);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "/api/v1/project-flows?limit=1&offset=0",
      `/api/v1/project-flows/${flowId}`,
      "/api/v1/project-flows",
      `/api/v1/project-flows/${flowId}`,
      `/api/v1/project-flows/${flowId}/versions?limit=20&offset=0`,
      `/api/v1/project-flows/${flowId}/versions/1`,
    ]);
    expect(fetcher.mock.calls[2]![1]!.method).toBe("POST");
    expect(JSON.parse(fetcher.mock.calls[2]![1]!.body as string).name).toBe("自制流程");
    expect(JSON.parse(fetcher.mock.calls[3]![1]!.body as string)).toEqual({ expected_version: 1, enabled: false });
    expect(new Headers(fetcher.mock.calls[3]![1]!.headers).has("Authorization")).toBe(false);
  });

  it("HTTP拒绝串流程、串版本、分页错位和错误更新版本响应", async () => {
    await expect(http(vi.fn<typeof fetch>().mockResolvedValue(json(flow({ id: otherId })))).projectFlows.get(flowId)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(http(vi.fn<typeof fetch>().mockResolvedValue(json(historical({ flow_id: otherId })))).projectFlows.version(flowId, 1)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(http(vi.fn<typeof fetch>().mockResolvedValue(json(historical({ version: 2 })))).projectFlows.version(flowId, 1)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(
      http(vi.fn<typeof fetch>().mockResolvedValue(json({ items: [flow()], total: 1, limit: 2, offset: 0 }))).projectFlows.list({ limit: 1 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(
      http(vi.fn<typeof fetch>().mockResolvedValue(json(flow()))).projectFlows.update(flowId, { expected_version: 1, enabled: false }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(
      http(vi.fn<typeof fetch>().mockResolvedValue(json({ items: [historical({ flow_id: otherId })], total: 1, limit: 20, offset: 0 }))).projectFlows.versions(
        flowId,
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("HTTP单字段项目PATCH不添加缺失字段，并校验项目身份和版本", async () => {
    const initial = await mock().projects.create({ name: "项目元数据" });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ...initial, archived: true, version: 2 }));
    await http(fetcher).projects.update(initial.id, { expected_version: 1, archived: true });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ expected_version: 1, archived: true });
    await expect(http(vi.fn<typeof fetch>().mockResolvedValue(json({ ...initial, id: otherId }))).projects.get(initial.id)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(
      http(vi.fn<typeof fetch>().mockResolvedValue(json(initial))).projects.update(initial.id, { expected_version: 1, archived: true }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("两种适配器拒绝空修改、显式非法null、无效UUID与版本，HTTP不回退Mock", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const api of [mock(), http(fetcher)]) {
      await expect(api.projectFlows.update(flowId, { expected_version: 1 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(api.projectFlows.update(flowId, { expected_version: 1, name: null })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(api.projects.update(flowId, { expected_version: 1, archived: null } as ProjectUpdate)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(api.projects.update(flowId, { expected_version: 1 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(api.projectFlows.get("invalid-id")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(api.projectFlows.version(flowId, 0)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(api.projectFlows.list({ limit: 101 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(api.projectFlows.create({ name: "半绑定" } as FlowCreate)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect(fetcher).not.toHaveBeenCalled();
    await expect(http(vi.fn<typeof fetch>().mockRejectedValue(new Error("PRIVATE-TRANSPORT"))).projectFlows.list()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("HTTP流式响应超过上限或返回私密错误正文时停止并仅显示安全错误", async () => {
    const oversized = new Response("x".repeat(1_000_001), { headers: { "Content-Type": "application/json" } });
    await expect(http(vi.fn<typeof fetch>().mockResolvedValue(oversized)).projectFlows.list()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    const api = http(
      vi.fn<typeof fetch>().mockResolvedValue(json({ error: { code: "PROJECT_FLOW_DISABLED", message: "PRIVATE-PAPER", request_id: "safe-request" } }, 409)),
    );
    await expect(api.projectFlows.create({ name: "自制流程", stages: [stage()] })).rejects.toMatchObject({
      code: "PROJECT_FLOW_DISABLED",
      status: 409,
      requestId: "safe-request",
    });
  });
});
