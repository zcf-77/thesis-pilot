import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createMockDocuments, type MockDocuments } from "../../src/services/mockDocuments.ts";
import { createServices } from "../../src/services/index.ts";
import type { DocumentSourceImport } from "../../src/services/contracts/api.generated.ts";
import { DOCUMENT_SOURCE_TRANSPORT_BYTES } from "../../src/services/httpDocumentSources.ts";

const projectId = "9d82c097-28f2-4b05-b4f1-9c29af9bbf13";
const content = (text = "自制原件投影") => ({
  schema_version: 1 as const,
  json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
});
afterEach(() => vi.useRealTimers());
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
async function fixture() {
  const api = createServices({ mode: "mock", instanceId: "document-source-unit" });
  const project = await api.projects.create({ name: "合成原件导入" });
  const original = await api.materials.upload(
    project.id,
    { name: "合成文字", filename: "synthetic.txt", kind: "other", file_type: "text", content_base64: btoa("Synthetic manuscript 42.") },
    "source-original",
  );
  await vi.advanceTimersByTimeAsync(2500);
  const job = await api.jobs.get(original.job.id);
  if (job.result?.kind !== "material_parse") throw new Error("Synthetic parse did not finish");
  const ids = { material_id: original.material.id, original_version_id: original.original.id, parse_version_id: job.result.parse_version_id };
  return { api, projectId: project.id, original, ids };
}

describe("来源导入Mock事务基础", () => {
  it("同步来源导入写入现有正式稿与历史存储，已有稿不覆盖", async () => {
    const documents = createMockDocuments(() => {});
    const imported = documents.createSourceImport(projectId, content());
    expect(await documents.current(projectId)).toEqual(imported);
    expect((await documents.version(projectId, imported.id, 1)).content).toEqual(content());
    expect(() => documents.createSourceImport(projectId, content("不能覆盖"))).toThrow();
    expect((await documents.current(projectId)).content).toEqual(content());
  });

  it("来源写入中途失败时正文、历史与映射一起回滚", async () => {
    const documents = createMockDocuments(() => {});
    const sources = new Map<number, string>();
    documents.sourceTransaction((document) => ({
      commit() {
        sources.set(document.version, "半条来源");
        throw new Error("synthetic source failure");
      },
      rollback() {
        sources.delete(document.version);
      },
    }));
    expect(() => documents.createSourceImport(projectId, content())).toThrow("synthetic source failure");
    await expect(documents.current(projectId)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    expect(sources.size).toBe(0);
  });

  it("后续保存来源映射失败，正式稿保持原版且无半个新历史", async () => {
    const documents = createMockDocuments(() => {});
    const initial = documents.createSourceImport(projectId, content());
    const sources = new Map<number, string>([[1, "原来源"]]);
    documents.sourceTransaction((document) => ({
      commit() {
        sources.set(document.version, "待回滚");
        throw new Error("synthetic append failure");
      },
      rollback() {
        sources.delete(document.version);
      },
    }));
    await expect(documents.save(projectId, initial.id, { expected_version: 1, content: content("待回滚正文") })).rejects.toThrow("synthetic append failure");
    expect((await documents.current(projectId)).version).toBe(1);
    expect((await documents.versions(projectId, initial.id)).total).toBe(1);
    expect([...sources.keys()]).toEqual([1]);
  });
});

describe("SG-13A 固定来源同契约服务", () => {
  it("可读模拟预览和章节校正只创建一次正式稿，来源固定且导入结果只有IDs", async () => {
    vi.useFakeTimers();
    const { api, projectId, ids } = await fixture();
    const preview = await api.documentSources.preview(projectId, ids);
    expect(preview).toMatchObject({ can_import: true, existing_document_id: null, file_type: "text", chapters_truncated: false });
    expect(preview.diagnostics.join(" ")).toContain("本地模拟");
    const command = {
      ...ids,
      command_id: crypto.randomUUID(),
      chapter_corrections: [{ anchor_id: preview.chapters[0]!.anchor_id, kind: "heading" as const, level: 2 }],
    };
    const [first, replay] = await Promise.all([api.documentSources.import(projectId, command), api.documentSources.import(projectId, command)]);
    expect(replay).toEqual(first);
    expect(first).not.toHaveProperty("document");
    const document = await api.documents.current(projectId);
    expect(document.id).toBe(first.document_id);
    expect(document.content.json.content).toEqual([
      expect.objectContaining({ type: "heading", attrs: expect.objectContaining({ level: 2 }), content: [{ type: "text", text: "Synthetic manuscript 42." }] }),
    ]);
    const source = await api.documentSources.current(projectId, document.id, 1);
    expect(source).toMatchObject({
      ...ids,
      original_sha256: preview.original_sha256,
      manifest_sha256: preview.manifest_sha256,
      document_version: 1,
      source_id: first.source_id,
    });
    expect(source.guard_contract.chapter_overrides).toHaveLength(1);
    expect((await api.documentSources.preview(projectId, ids)).can_import).toBe(false);
    expect((await api.documents.versions(projectId, document.id)).total).toBe(1);
  });

  it("同一命令异参拒绝，其他命令与空白稿不能覆盖已有正文", async () => {
    vi.useFakeTimers();
    const { api, projectId, ids } = await fixture();
    const command = { ...ids, command_id: crypto.randomUUID() };
    const first = await api.documentSources.import(projectId, command);
    expect(await api.documentSources.import(projectId, { ...command, chapter_corrections: [] })).toEqual(first);
    await expect(
      api.documentSources.import(projectId, { ...command, chapter_corrections: [{ anchor_id: "mock-text-1", kind: "heading", level: 1 }] }),
    ).rejects.toMatchObject({ code: "DOCUMENT_SOURCE_COMMAND_CONFLICT" });
    await expect(api.documentSources.import(projectId, { ...command, command_id: crypto.randomUUID() })).rejects.toMatchObject({
      code: "DOCUMENT_ALREADY_EXISTS",
    });
    const second = await fixture();
    const blank = await second.api.documents.createBlank(second.projectId);
    await expect(second.api.documentSources.import(second.projectId, { ...second.ids, command_id: crypto.randomUUID() })).rejects.toMatchObject({
      code: "DOCUMENT_ALREADY_EXISTS",
    });
    await expect(second.api.documentSources.current(second.projectId, blank.id, 1)).rejects.toMatchObject({ code: "DOCUMENT_SOURCE_NOT_FOUND", status: 404 });
  });

  it("保存与AI版本共用来源事务，文字可改，格式结构受保护且旧版本映射不变", async () => {
    vi.useFakeTimers();
    const { api, projectId, ids } = await fixture();
    const receipt = await api.documentSources.import(projectId, { ...ids, command_id: crypto.randomUUID() });
    const document = await api.documents.current(projectId);
    const initial = await api.documentSources.current(projectId, document.id, 1);
    const second = await api.documents.save(projectId, document.id, { expected_version: 1, content: content("Changed synthetic words 42.") });
    expect(second.version).toBe(2);
    await expect(api.documentSources.current(projectId, document.id, 1)).rejects.toMatchObject({ code: "DOCUMENT_VERSION_CONFLICT" });
    expect(await api.documentSources.version(projectId, document.id, 1)).toEqual(initial);
    expect((await api.documentSources.current(projectId, document.id, 2)).source_id).toBe(receipt.source_id);
    const changedStructure = {
      schema_version: 1 as const,
      json: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Changed synthetic words 42." }] },
          { type: "paragraph", content: [] },
        ],
      },
    };
    await expect(api.documents.save(projectId, document.id, { expected_version: 2, content: changedStructure })).rejects.toMatchObject({
      code: "DOCUMENT_SOURCE_PROTECTED",
    });
    const internal = api.documents as MockDocuments;
    expect(() => internal.appendRevisionVersion(projectId, document.id, 2, changedStructure, "ai_adoption")).toThrow();
    const third = internal.appendRevisionVersion(projectId, document.id, 2, content("Accepted synthetic suggestion 42."), "ai_adoption");
    expect(third.version).toBe(3);
    expect((await api.documentSources.current(projectId, document.id, 3)).source_id).toBe(receipt.source_id);
    expect((await api.documents.versions(projectId, document.id)).total).toBe(3);
  });

  it("跨项目或解绑来源、未知章节及客户端正文JSON被拒绝，不创建稿件", async () => {
    vi.useFakeTimers();
    const { api, projectId, ids, original } = await fixture();
    const other = await api.projects.create({ name: "其他项目" });
    await expect(api.documentSources.import(other.id, { ...ids, command_id: crypto.randomUUID() })).rejects.toBeInstanceOf(Error);
    await expect(
      api.documentSources.import(projectId, {
        ...ids,
        command_id: crypto.randomUUID(),
        chapter_corrections: [{ anchor_id: "unknown", kind: "paragraph", level: null }],
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_SOURCE_CHAPTER_INVALID" });
    await expect(
      api.documentSources.import(projectId, { ...ids, command_id: crypto.randomUUID(), content: content() } as DocumentSourceImport),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await api.materials.update(projectId, original.material.id, { expected_version: 1, linked: false });
    await expect(api.documentSources.preview(projectId, ids)).rejects.toMatchObject({ code: "DOCUMENT_SOURCE_INVALID" });
    await expect(api.documents.current(projectId)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });
  it("真实Mock修订采纳、撤销与恢复都逐版保留相同固定来源", async () => {
    vi.useFakeTimers();
    const { api, projectId, ids } = await fixture();
    const receipt = await api.documentSources.import(projectId, { ...ids, command_id: crypto.randomUUID() });
    const documentId = receipt.document_id;
    const base = "Synthetic manuscript 42.";
    const selection = { textblock_path: [0], from: 1, to: base.length + 1, text: base };
    const created = await api.revisions.create(projectId, documentId, { command_id: crypto.randomUUID(), base_version: 1, goal: "合成措辞修订", selection });
    const candidate = await api.revisions.get(projectId, documentId, created.candidate_id!);
    await api.revisions.propose(projectId, documentId, candidate.id, {
      command_id: crypto.randomUUID(),
      generation_token: candidate.generation_token!,
      patches: [{ id: "source-patch", from: 1, to: base.length + 1, before: base, after: "Original manuscript 42." }],
    });
    const ready = await api.revisions.get(projectId, documentId, candidate.id);
    await api.revisions.decide(projectId, documentId, candidate.id, {
      command_id: crypto.randomUUID(),
      expected_revision: ready.revision,
      decisions: [{ patch_id: "source-patch", decision: "accepted" }],
    });
    const reviewed = await api.revisions.get(projectId, documentId, candidate.id);
    const applyId = crypto.randomUUID();
    await api.revisions.apply(projectId, documentId, candidate.id, { command_id: applyId, expected_document_version: 1, expected_revision: reviewed.revision });
    await api.revisions.undo(projectId, documentId, applyId, { command_id: crypto.randomUUID(), expected_document_version: 2 });
    await api.revisions.revert(projectId, documentId, { command_id: crypto.randomUUID(), expected_document_version: 3, target_version: 2 });
    for (const version of [1, 2, 3, 4])
      expect(await api.documentSources.version(projectId, documentId, version)).toMatchObject({
        document_version: version,
        source_id: receipt.source_id,
        ...ids,
      });
    expect((await api.documents.current(projectId)).version).toBe(4);
  });

  it("HTTP导入固定原命令UUID与来源IDs，未知结果不自动换命令或回退Mock", async () => {
    vi.useFakeTimers();
    const { api, projectId, ids } = await fixture();
    const command = { ...ids, command_id: crypto.randomUUID() };
    const receipt = await api.documentSources.import(projectId, command);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("synthetic disconnected after acceptance")).mockResolvedValueOnce(json(receipt));
    const http = createServices({ mode: "http", instanceId: "source-http", fetch: fetcher });
    await expect(http.documentSources.import(projectId, command)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await http.documentSources.import(projectId, command)).toEqual(receipt);
    const bodies = fetcher.mock.calls.map((call) => JSON.parse(call[1]!.body as string));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual({ ...command, chapter_corrections: [] });
    expect(bodies[1]).not.toHaveProperty("content");
    fetcher.mockResolvedValueOnce(json({ ...receipt, command_id: crypto.randomUUID() }));
    await expect(http.documentSources.import(projectId, command)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("HTTP来源严格核对当前版本、guard与manifest，409映射缺失不可当无来源", async () => {
    vi.useFakeTimers();
    const { api, projectId, ids } = await fixture();
    const receipt = await api.documentSources.import(projectId, { ...ids, command_id: crypto.randomUUID() });
    const source = await api.documentSources.current(projectId, receipt.document_id, 1);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(source));
    const http = createServices({ mode: "http", instanceId: "source-identity", fetch: fetcher });
    expect(await http.documentSources.current(projectId, receipt.document_id, 1)).toEqual(source);
    expect(fetcher.mock.calls[0]![0]).toContain("expected_document_version=1");
    for (const value of [
      { ...source, document_version: 2 },
      { ...source, guard_contract: { ...source.guard_contract, manifest_sha256: "0".repeat(64) } },
      { ...source, guard_version: "unknown-guard-version" },
    ]) {
      fetcher.mockResolvedValueOnce(json(value));
      await expect(http.documentSources.current(projectId, receipt.document_id, 1)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
    fetcher.mockResolvedValueOnce(
      json({ error: { code: "DOCUMENT_SOURCE_MAPPING_MISSING", message: "private untrusted message", request_id: "source-test" } }, 409),
    );
    await expect(http.documentSources.current(projectId, receipt.document_id, 1)).rejects.toMatchObject({
      code: "DOCUMENT_SOURCE_MAPPING_MISSING",
      status: 409,
    });
  });

  it("大来源映射使用独立有界通道，普通DTO预算不放宽", async () => {
    vi.useFakeTimers();
    const { api, projectId, ids } = await fixture();
    const receipt = await api.documentSources.import(projectId, { ...ids, command_id: crypto.randomUUID() });
    const source = await api.documentSources.current(projectId, receipt.document_id, 1);
    const large = {
      ...source,
      guard_contract: { ...source.guard_contract, editable_paths: Array.from({ length: 12000 }, (_, index) => [...Array<number>(77).fill(0), index]) },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(large));
    const http = createServices({ mode: "http", instanceId: "source-budget", fetch: fetcher });
    expect((await http.documentSources.current(projectId, receipt.document_id, 1)).guard_contract.editable_paths).toHaveLength(12000);
    fetcher.mockResolvedValueOnce(new Response("{}", { headers: { "Content-Length": String(DOCUMENT_SOURCE_TRANSPORT_BYTES + 1) } }));
    await expect(http.documentSources.current(projectId, receipt.document_id, 1)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    fetcher.mockResolvedValueOnce(json(large));
    await expect(http.projects.get(projectId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
