import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createServices } from "../../src/services/index.ts";
import type { DocumentContent_Input, DocumentRead, DocumentVersionRead, ProjectRead } from "../../src/services/contracts/api.generated.ts";

const projectId = "09c93463-a51f-4fba-9a18-e934268bb5ee";
const otherProjectId = "ccb234bb-e2b7-435e-8eb6-43312798dcbf";
const documentId = "a0bc2a3d-572f-47a1-b779-84dc10cc3925";
const timestamp = "2026-11-17T05:00:00Z";
const contentLimit = 16 * 1024 * 1024;
const transportLimit = contentLimit + 64 * 1024;
const project: ProjectRead = {
  id: projectId,
  name: "自制正文项目",
  version: 1,
  created_at: timestamp,
  updated_at: timestamp,
  title: "",
  deadline: null,
  planning_mode: "none",
  plan_note: "",
  existing_artifacts: "",
  archived: false,
  flow_version_id: null,
  stage_id: null,
};
const encoder = new TextEncoder();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const mock = (instanceId = "document-mock") => createServices({ mode: "mock", instanceId });
const http = (fetch: typeof globalThis.fetch, timeoutMs?: number) => createServices({ mode: "http", instanceId: "document-http", fetch, timeoutMs });
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const manuscript = (text = "自制正文🙂"): DocumentContent_Input => ({ schema_version: 1, json: { type: "doc", content: [paragraph(text)] } });

function read(content = manuscript(), version = 1, owner = projectId): DocumentRead {
  return { id: documentId, project_id: owner, version, content, created_at: timestamp, updated_at: timestamp };
}
function historical(content: DocumentContent_Input, version: number): DocumentVersionRead {
  return { document_id: documentId, project_id: projectId, version, source: version === 1 ? "local_import" : "manual_edit", content, created_at: timestamp };
}
function nested(depth: number): DocumentContent_Input {
  let block: DocumentContent_Input["json"] = paragraph("深层引文");
  for (let layer = 0; layer < depth; layer++) block = { type: "blockquote", content: [block] };
  return { schema_version: 1, json: { type: "doc", content: [block] } };
}
function atContentLimit(): string {
  const textBytes = contentLimit - encoder.encode(JSON.stringify(manuscript("").json)).length;
  return "🙂".repeat(Math.floor(textBytes / 4)) + "a".repeat(textBytes % 4);
}
afterEach(() => vi.useRealTimers());

describe("正式正文服务适配器", () => {
  it("Mock首次导入并发唯一，项目和服务实例彼此隔离", async () => {
    const api = mock();
    const owner = await api.projects.create({ name: "正文所属项目" });
    const other = await api.projects.create({ name: "另一个项目" });
    await expect(api.documents.current(owner.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND", status: 404 });
    const results = await Promise.allSettled([
      api.documents.import(owner.id, { content: manuscript("第一份") }),
      api.documents.import(owner.id, { content: manuscript("第二份") }),
    ]);
    const imported = results.find((result) => result.status === "fulfilled");
    expect(imported?.value.version).toBe(1);
    expect(results.find((result) => result.status === "rejected")?.reason).toMatchObject({ code: "DOCUMENT_ALREADY_EXISTS", status: 409 });
    const doc = await api.documents.current(owner.id);
    expect(doc).toEqual(imported?.value);
    await expect(api.documents.current(other.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(api.documents.save(other.id, doc.id, { expected_version: 1, content: manuscript() })).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(api.documents.versions(other.id, doc.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(api.documents.version(other.id, doc.id, 1)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    expect((await api.documents.current(owner.id)).content).toEqual(doc.content);
    expect(await mock("isolated").projects.list()).toMatchObject({ total: 0 });
    await expect(mock("isolated").documents.current(owner.id)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("Mock以正文CAS追加历史，旧版本和项目元数据不会被修改", async () => {
    const api = mock();
    const owner = await api.projects.create({ name: "独立版本项目" });
    const original = manuscript("初始正文𠮷");
    const doc = await api.documents.import(owner.id, { content: original });
    const saves = await Promise.allSettled([
      api.documents.save(owner.id, doc.id, { expected_version: 1, content: manuscript("窗口甲") }),
      api.documents.save(owner.id, doc.id, { expected_version: 1, content: manuscript("窗口乙") }),
    ]);
    const latest = saves.find((result) => result.status === "fulfilled")?.value;
    expect(latest?.version).toBe(2);
    expect(saves.find((result) => result.status === "rejected")?.reason).toMatchObject({ code: "DOCUMENT_VERSION_CONFLICT", status: 409 });
    await expect(api.documents.versions(owner.id, doc.id, { limit: 1, offset: 1 })).resolves.toMatchObject({
      items: [{ version: 1, source: "local_import" }],
      total: 2,
      limit: 1,
      offset: 1,
    });
    const versions = await api.documents.versions(owner.id, doc.id);
    expect(versions.items.map(({ version, source }) => [version, source])).toEqual([
      [2, "manual_edit"],
      [1, "local_import"],
    ]);
    expect(versions.items[0]).not.toHaveProperty("content");
    await expect(api.documents.version(owner.id, doc.id, 1)).resolves.toMatchObject({ version: 1, content: original });
    await expect(api.documents.version(owner.id, doc.id, 2)).resolves.toMatchObject({ version: 2, content: latest?.content });
    await expect(api.documents.version(owner.id, doc.id, 3)).rejects.toMatchObject({ code: "DOCUMENT_VERSION_NOT_FOUND" });
    (doc.content.json as { type: string }).type = "篡改响应对象";
    await expect(api.documents.current(owner.id)).resolves.toEqual(latest);
    await expect(api.documents.version(owner.id, doc.id, 1)).resolves.toMatchObject({ content: original });
    await expect(api.projects.get(owner.id)).resolves.toMatchObject({ version: 1 });
  });

  it("HTTP使用项目限定路径、固定基础版本和现有错误契约", async () => {
    const original = manuscript("原稿");
    const edited = manuscript("编辑后");
    const { content: _content, ...summary } = historical(original, 1);
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(read(original), 201))
      .mockResolvedValueOnce(json(read(original)))
      .mockResolvedValueOnce(json(read(edited, 2)))
      .mockResolvedValueOnce(json({ items: [summary], total: 2, limit: 1, offset: 1 }))
      .mockResolvedValueOnce(json(historical(original, 1)))
      .mockResolvedValueOnce(json({ error: { code: "DOCUMENT_VERSION_CONFLICT", message: "私密正文不能回显", request_id: "write_conflict" } }, 409))
      .mockResolvedValueOnce(json({ error: { code: "DOCUMENT_ALREADY_EXISTS", message: "不回显服务正文", request_id: "already_exist" } }, 409));
    const { documents } = http(transport);
    const route = "/api/v1/projects/" + projectId + "/documents";
    await expect(documents.import(projectId, { content: original })).resolves.toEqual(read(original));
    await expect(documents.current(projectId)).resolves.toEqual(read(original));
    await expect(documents.save(projectId, documentId, { expected_version: 1, content: edited })).resolves.toEqual(read(edited, 2));
    await expect(documents.versions(projectId, documentId, { limit: 1, offset: 1 })).resolves.toMatchObject({ items: [summary] });
    await expect(documents.version(projectId, documentId, 1)).resolves.toEqual(historical(original, 1));
    await expect(documents.save(projectId, documentId, { expected_version: 1, content: edited })).rejects.toMatchObject({
      code: "DOCUMENT_VERSION_CONFLICT",
      status: 409,
      requestId: "write_conflict",
      message: expect.not.stringContaining("私密正文"),
    });
    await expect(documents.import(projectId, { content: original })).rejects.toMatchObject({ code: "DOCUMENT_ALREADY_EXISTS", status: 409 });
    expect(transport.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [route, "POST"],
      [route + "/current", "GET"],
      [route + "/" + documentId, "PATCH"],
      [route + "/" + documentId + "/versions?limit=1&offset=1", "GET"],
      [route + "/" + documentId + "/versions/1", "GET"],
      [route + "/" + documentId, "PATCH"],
      [route, "POST"],
    ]);
    expect(JSON.parse(transport.mock.calls[0]![1]!.body as string)).toEqual({ content: original });
    for (const index of [2, 5]) expect(JSON.parse(transport.mock.calls[index]![1]!.body as string)).toEqual({ expected_version: 1, content: edited });
  });

  it("HTTP拒绝错项目、错文档或错版本的响应，并执行生产结构校验", async () => {
    const valid = manuscript();
    const { content: _content, ...summary } = historical(valid, 1);
    const unknown: DocumentContent_Input = { schema_version: 1, json: { type: "doc", content: [{ type: "paragraph", attrs: { keptByFutureEditor: true } }] } };
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(read(valid, 1, otherProjectId)))
      .mockResolvedValueOnce(json({ ...read(valid, 2), id: otherProjectId }))
      .mockResolvedValueOnce(json({ items: [{ ...summary, project_id: otherProjectId }], total: 1, limit: 20, offset: 0 }))
      .mockResolvedValueOnce(json(historical(valid, 2)))
      .mockResolvedValueOnce(json(read(unknown)))
      .mockResolvedValueOnce(json(read(valid)));
    const { documents } = http(transport);
    await expect(documents.current(projectId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(documents.save(projectId, documentId, { expected_version: 1, content: valid })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(documents.versions(projectId, documentId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(documents.version(projectId, documentId, 1)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(documents.current(projectId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(documents.current(projectId.toUpperCase())).resolves.toEqual(read(valid));
  });

  it("两种适配器拒绝正式稿缺失章节身份和多余输入字段", async () => {
    const transport = vi.fn<typeof fetch>();
    const local = mock();
    const owner = await local.projects.create({ name: "结构预检项目" });
    for (const [api, id] of [
      [local, owner.id],
      [http(transport), projectId],
    ] as const) {
      const missingIdentity: DocumentContent_Input = { schema_version: 1, json: { type: "doc", content: [{ type: "heading" }] } };
      const extra = { content: { ...manuscript(), html: "<p>旧格式</p>" } };
      await expect(api.documents.import(id, { content: missingIdentity })).rejects.toMatchObject({ code: "DOCUMENT_STRUCTURE_INVALID", status: 422 });
      await expect(api.documents.import(id, extra)).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    }
    expect(transport).not.toHaveBeenCalled();
    await expect(local.documents.current(owner.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });

  it("只对正文放宽结构递归传输预算，节点深度超过80仍拒绝", async () => {
    const valid = nested(78);
    const beyond = nested(79);
    let deep: unknown = { end: true };
    for (let layer = 0; layer < 45; layer++) deep = { inside: deep };
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(read(valid)))
      .mockResolvedValueOnce(json(read(beyond)))
      .mockResolvedValueOnce(json({ ...project, extra: deep }));
    const api = http(transport);
    await expect(api.documents.current(projectId)).resolves.toMatchObject({ content: valid });
    await expect(api.documents.current(projectId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(api.projects.get(projectId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    const local = mock();
    const owner = await local.projects.create({ name: "深层结构" });
    await expect(local.documents.import(owner.id, { content: beyond })).rejects.toMatchObject({ code: "DOCUMENT_STRUCTURE_INVALID" });
    await expect(local.documents.import(owner.id, { content: valid })).resolves.toMatchObject({ content: valid });
  });

  it("正文按UTF-8验证16 MiB边界和传输包装，普通响应保留原大小限制", async () => {
    const exactText = atContentLimit();
    const exact = manuscript(exactText);
    const beyond = manuscript(exactText + "a");
    expect(encoder.encode(JSON.stringify(exact.json)).length).toBe(contentLimit);
    expect(encoder.encode(JSON.stringify(beyond.json)).length).toBe(contentLimit + 1);
    const short = JSON.stringify(read());
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(read(exact)))
      .mockResolvedValueOnce(json(read(beyond)))
      .mockResolvedValueOnce(new Response(short + " ".repeat(transportLimit + 1 - encoder.encode(short).length)))
      .mockResolvedValueOnce(json({ ...project, extra: "x".repeat(1_000_000) }));
    const api = http(transport);
    await expect(api.documents.current(projectId)).resolves.toMatchObject({ content: exact });
    await expect(api.documents.current(projectId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(api.documents.current(projectId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(api.projects.get(projectId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(api.documents.import(projectId, { content: beyond })).rejects.toMatchObject({ code: "DOCUMENT_TOO_LARGE", status: 413 });
    expect(transport).toHaveBeenCalledTimes(4);
  }, 20_000);

  it("延迟写入响应超时后保持结果未知，查询可以确认且不会自动重发", async () => {
    vi.useFakeTimers();
    const saved = read(manuscript("晚到的结果"), 2);
    let reply!: (response: Response) => void;
    const delayed = new Promise<Response>((resolve) => (reply = resolve));
    const transport = vi.fn<typeof fetch>().mockReturnValueOnce(delayed).mockResolvedValueOnce(json(saved));
    const { documents } = http(transport, 50);
    const timedOut = expect(documents.save(projectId, documentId, { expected_version: 1, content: saved.content })).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(51);
    await timedOut;
    reply(json(saved));
    await expect(documents.current(projectId)).resolves.toMatchObject({ version: 2, content: saved.content });
    expect(transport.mock.calls.map(([, init]) => init?.method)).toEqual(["PATCH", "GET"]);

    const aborter = new AbortController();
    aborter.abort();
    await expect(documents.import(projectId, { content: manuscript() }, aborter.signal)).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
