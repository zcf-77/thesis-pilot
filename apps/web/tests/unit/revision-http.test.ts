import { describe, expect, it, vi } from "vite-plus/test";
import { createServices } from "../../src/services/index.ts";
import type { RevisionCommandRead, RevisionCreate, RevisionRead } from "../../src/services/contracts/api.generated.ts";
import { REVISION_TRANSPORT_BYTES } from "../../src/services/revisionContent.ts";

const project = "09c93463-a51f-4fba-9a18-e934268bb5ee";
const document = "a0bc2a3d-572f-47a1-b779-84dc10cc3925";
const candidate = "ccb234bb-e2b7-435e-8eb6-43312798dcbf";
const command = "8d8bfc94-6444-4bee-bc2e-5caf82d1c3ee";
const token = "aa52ba85-ae46-4da6-b6af-2a47c3532d3c";
const timestamp = "2026-11-17T05:00:00Z";
const input: RevisionCreate = { command_id: command, base_version: 1, selection: { textblock_path: [0], from: 1, to: 4, text: "自制稿" }, goal: "精简措辞" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const http = (fetch: typeof globalThis.fetch) => createServices({ mode: "http", instanceId: "revision-http", fetch }).revisions;
function receipt(operation: RevisionCommandRead["operation"] = "create"): RevisionCommandRead {
  return {
    command_id: command,
    document_id: document,
    candidate_id: operation === "revert" ? null : candidate,
    operation,
    candidate_revision: operation === "revert" ? null : 1,
    base_version: 1,
    result_version: ["apply", "undo", "revert"].includes(operation) ? 2 : null,
    created_at: timestamp,
  };
}
function read(): RevisionRead {
  return {
    id: candidate,
    project_id: project,
    document_id: document,
    base_version: 1,
    document_version: 1,
    revision: 1,
    status: "generating",
    result_version: null,
    created_at: timestamp,
    updated_at: timestamp,
    selection: input.selection,
    goal: input.goal,
    policy_version: "sg04-v1",
    producer: "deterministic_preview",
    generation_token: token,
    patches: [],
    decisions: [],
    checks: [],
    applicable: false,
    application_command_id: null,
  };
}

describe("正式修订 HTTP 契约", () => {
  it("写操作使用固定命令和专用路径，采纳撤销恢复不走正文保存", async () => {
    const transport = vi.fn<typeof fetch>();
    const api = http(transport);
    const operations = ["create", "proposal", "decide", "apply", "cancel", "undo", "revert"] as const;
    for (const operation of operations) transport.mockResolvedValueOnce(json(receipt(operation)));
    await api.create(project, document, input);
    await api.propose(project, document, candidate, {
      command_id: command,
      generation_token: token,
      patches: [{ id: "p1", from: 1, to: 4, before: "自制稿", after: "稿件" }],
    });
    await api.decide(project, document, candidate, { command_id: command, expected_revision: 1, decisions: [{ patch_id: "p1", decision: "accepted" }] });
    await api.apply(project, document, candidate, { command_id: command, expected_revision: 1, expected_document_version: 1 });
    await api.cancel(project, document, candidate, { command_id: command });
    await api.undo(project, document, command, { command_id: command, expected_document_version: 1 });
    await api.revert(project, document, { command_id: command, expected_document_version: 1, target_version: 1 });
    const base = `/api/v1/projects/${project}/documents/${document}`;
    expect(transport.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
      [`${base}/revisions`, "POST"],
      [`${base}/revisions/${candidate}/proposal`, "PUT"],
      [`${base}/revisions/${candidate}/decisions`, "PUT"],
      [`${base}/revisions/${candidate}/apply`, "POST"],
      [`${base}/revisions/${candidate}/cancel`, "POST"],
      [`${base}/revision-commands/${command}/undo`, "POST"],
      [`${base}/revert`, "POST"],
    ]);
    for (const [, options] of transport.mock.calls) {
      const body = options?.body;
      if (typeof body !== "string") throw new Error("修订请求必须使用 JSON 文本");
      expect(JSON.parse(body).command_id).toBe(command);
    }
  });

  it.each([{ document_id: token }, { command_id: token }, { candidate_id: token }, { operation: "cancel" }, { result_version: 3 }])(
    "拒绝归属、操作或结果版本不匹配的回执：%j",
    async (change) => {
      const api = http(vi.fn<typeof fetch>().mockResolvedValue(json({ ...receipt("apply"), ...change })));
      await expect(api.apply(project, document, candidate, { command_id: command, expected_revision: 1, expected_document_version: 1 })).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });
    },
  );

  it("读取候选、列表与命令校验完整归属，历史命令保持返回的固定版本", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(read()))
      .mockResolvedValueOnce(json({ ...read(), project_id: token }))
      .mockResolvedValueOnce(json({ items: [{ ...read(), document_id: token }], total: 1, limit: 20, offset: 0 }))
      .mockResolvedValueOnce(json(receipt("apply")))
      .mockResolvedValueOnce(json({ ...receipt("apply"), command_id: token }));
    const api = http(transport);
    await expect(api.get(project, document, candidate)).resolves.toMatchObject({ id: candidate });
    await expect(api.get(project, document, candidate)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(api.list(project, document)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(api.command(project, document, command)).resolves.toMatchObject({ result_version: 2 });
    await expect(api.command(project, document, command)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("发出请求前拒绝空候选、过量候选、非法 Unicode 和超出字节预算", async () => {
    const transport = vi.fn<typeof fetch>();
    const api = http(transport);
    const patch = { id: "p", from: 1, to: 4, before: "自制稿", after: "稿件" };
    for (const patches of [[], Array.from({ length: 101 }, () => patch)])
      await expect(api.propose(project, document, candidate, { command_id: command, generation_token: token, patches })).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    await expect(api.create(project, document, { ...input, goal: "\ud800" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      api.propose(project, document, candidate, { command_id: command, generation_token: token, patches: [{ ...patch, after: "中".repeat(100_000) }] }),
    ).rejects.toMatchObject({ code: "REVISION_TOO_LARGE", status: 413 });
    await expect(api.list(project, document, { limit: 51 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("按流式 UTF-8 字节限制响应，拒绝非法编码和孤立代理字符，保留 NUL", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(" ".repeat(REVISION_TRANSPORT_BYTES + 1)))
      .mockResolvedValueOnce(new Response(new Uint8Array([0xc3, 0x28])))
      .mockResolvedValueOnce(json({ ...read(), goal: "\udfff" }))
      .mockResolvedValueOnce(json({ ...read(), goal: "自制\u0000目标" }));
    const api = http(transport);
    for (let index = 0; index < 3; index++) await expect(api.get(project, document, candidate)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(api.get(project, document, candidate)).resolves.toMatchObject({ goal: "自制\u0000目标" });
  });
});
