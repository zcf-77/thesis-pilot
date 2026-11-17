import { describe, expect, it, vi } from "vite-plus/test";
import { createServices } from "../../src/services/index.ts";
import { deriveChapters, type DocsSnapshotContent } from "../../src/services/docsContent.ts";
import { isDocsContent } from "../../src/services/documentContent.ts";
import type { DocsModel, DocumentImport, DocumentRead, DocumentSchemaUpgradeRead } from "../../src/services/contracts/api.generated.ts";

const run = (text: string) => ({ type: "run", text });
const legacy: DocumentImport["content"] = {
  schema_version: 1,
  json: {
    type: "doc",
    content: [
      { type: "heading", attrs: { chapterId: "chapter-a", level: 1 }, content: [{ type: "text", text: "第一章" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "样本" },
          { type: "text", text: "128🙂", marks: [{ type: "aiLock" }] },
          { type: "text", text: "例" },
        ],
      },
    ],
  },
};

async function upgraded() {
  const api = createServices({ mode: "mock", instanceId: `docs-v2-${crypto.randomUUID()}` });
  const projectId = (await api.projects.create({ name: "自制 v2 项目" })).id;
  const document = await api.documents.import(projectId, { content: legacy });
  const command = { command_id: crypto.randomUUID(), expected_version: 1 };
  const result = await api.documents.upgradeSchema(projectId, document.id, command);
  return { api, projectId, document, command, result };
}

const snapshotOf = (document: DocumentRead): DocsSnapshotContent => {
  if (!isDocsContent(document.content)) throw new Error("expected v2");
  return structuredClone(document.content.json);
};

describe("正文快照 v2 服务（同契约 Mock）", () => {
  it("显式升级追加 v2 版本，重放幂等，旧版本可按 v2 只读预览", async () => {
    const { api, projectId, document, command, result } = await upgraded();
    expect(result.replayed).toBe(false);
    expect(result.document.version).toBe(2);
    const snapshot = snapshotOf(result.document);
    expect(snapshot.chapters).toEqual([{ id: "chapter-a", level: 1, title: "第一章", block: 0, end: 2, words: 7 }]);
    expect(snapshot.protections?.map((item) => item.kind)).toEqual(["lock"]);
    expect(snapshot.protections?.[0]?.anchor).toMatchObject({ start: 2, end: 6 });
    const replay = await api.documents.upgradeSchema(projectId, document.id, command);
    expect(replay).toMatchObject({ replayed: true, upgrade: result.upgrade });
    await expect(api.documents.upgradeSchema(projectId, document.id, { ...command, expected_version: 2 })).rejects.toMatchObject({
      code: "DOCUPGRADE_COMMAND_REUSED",
    });
    await expect(api.documents.upgradeSchema(projectId, document.id, { command_id: crypto.randomUUID(), expected_version: 2 })).rejects.toMatchObject({
      code: "DOCUPGRADE_ALREADY_UPGRADED",
    });
    const preview = await api.documents.versionAsV2(projectId, document.id, 1);
    expect(preview.converted).toBe(true);
    expect(preview.content.schema_version).toBe(2);
    await expect(api.documents.version(projectId, document.id, 1)).resolves.toMatchObject({ content: { schema_version: 1 } });
  });

  it("升级前后按结构版本保存，保护内容不可被改写或伪造", async () => {
    const { api, projectId, document, result } = await upgraded();
    await expect(api.documents.save(projectId, document.id, { expected_version: 2, content: legacy })).rejects.toMatchObject({
      code: "DOCMODEL_SCHEMA_MISMATCH",
    });
    const snapshot = snapshotOf(result.document);
    const blocks = snapshot.model.sections[0]!.blocks as unknown as { inlines: { text: string }[] }[];
    blocks[1]!.inlines[0]!.text = "全部样本128🙂例";
    snapshot.protections![0]!.anchor = { ...snapshot.protections![0]!.anchor, start: 4, end: 8 };
    const saved = await api.documents.save(projectId, document.id, { expected_version: 2, content: { schema_version: 2, json: snapshot } });
    expect(saved.version).toBe(3);
    const tampered = structuredClone(snapshot);
    (tampered.model.sections[0]!.blocks as unknown as { inlines: { text: string }[] }[])[1]!.inlines[0]!.text = "全部样本129🙂例";
    await expect(api.documents.save(projectId, document.id, { expected_version: 3, content: { schema_version: 2, json: tampered } })).rejects.toMatchObject({
      code: "DOCMODEL_PROTECTION_VIOLATED",
    });
    const forged = structuredClone(snapshot);
    forged.protections!.push({ id: "c1", kind: "citation", anchor: { node: "chapter-a" } });
    await expect(api.documents.save(projectId, document.id, { expected_version: 3, content: { schema_version: 2, json: forged } })).rejects.toMatchObject({
      code: "DOCMODEL_PROTECTION_FORGED",
    });
    await expect(api.documents.save(projectId, document.id, { expected_version: 2, content: { schema_version: 2, json: snapshot } })).rejects.toMatchObject({
      code: "DOCUMENT_VERSION_CONFLICT",
    });
  });

  it("图片按内容寻址上传、去重并按项目隔离", async () => {
    const { api, projectId, document, result } = await upgraded();
    const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const first = await api.documents.uploadResource(projectId, { mime: "image/gif", content_base64: gif });
    expect(first.uri).toBe(`tp-resource:${first.sha256}`);
    await expect(api.documents.uploadResource(projectId, { mime: "image/gif", content_base64: gif })).resolves.toMatchObject({ sha256: first.sha256 });
    await expect(api.documents.uploadResource(projectId, { mime: "image/png", content_base64: gif })).rejects.toMatchObject({
      code: "DOCMODEL_RESOURCE_INVALID",
    });
    expect((await api.documents.resource(projectId, first.sha256)).type).toBe("image/gif");
    const snapshot = snapshotOf(result.document);
    snapshot.model.resources = [{ id: "img", mime: "image/gif", data: { kind: "uri", value: `tp-resource:${"0".repeat(64)}` } }];
    await expect(api.documents.save(projectId, document.id, { expected_version: 2, content: { schema_version: 2, json: snapshot } })).rejects.toMatchObject({
      code: "DOCMODEL_RESOURCE_MISSING",
    });
    snapshot.model.resources[0]!.data.value = first.uri;
    await expect(api.documents.save(projectId, document.id, { expected_version: 2, content: { schema_version: 2, json: snapshot } })).resolves.toMatchObject({
      version: 3,
    });
  });
});

describe("章节派生与服务端同一规则", () => {
  it("跨节顶层块计序号，标题不去空白，按 JS 空白计字并止于参考文献", () => {
    const paragraph = (id: string, text: string) => ({ type: "paragraph", id, inlines: [run(text)] });
    const model = {
      kind: "docs",
      schemaVersion: 1,
      id: "d",
      theme: { name: "minimal" },
      sections: [
        {
          id: "s1",
          blocks: [
            { type: "heading", id: "h1", level: 1, inlines: [run(" 第一章 "), { type: "tab" }] },
            { type: "paragraph", id: "p1", inlines: [run("甲 乙　丙 "), { type: "tab" }] },
            { type: "heading", id: "h2", level: 2, inlines: [run("1.1")] },
            { type: "list", id: "l1", kind: "bullet", items: [{ id: "i1", blocks: [paragraph("p2", "ab")] }] },
            { type: "quote", id: "q1", blocks: [{ type: "heading", id: "h9", level: 3, inlines: [run("不计")] }] },
          ],
        },
        {
          id: "s2",
          blocks: [
            { type: "code_block", id: "c1", text: "x = 1" },
            { type: "table", id: "t1", rows: [{ id: "r1", cells: [{ id: "e1", blocks: [paragraph("p3", "表")] }] }] },
            { type: "heading", id: "h3", level: 1, inlines: [run("参考文献")] },
            paragraph("p4", "[1] 文献"),
            { type: "heading", id: "h4", level: 1, inlines: [run("致谢")] },
            paragraph("p5", "谢谢"),
          ],
        },
      ],
    } as unknown as DocsModel;
    expect(deriveChapters(model)).toEqual([
      { id: "h1", level: 1, title: " 第一章 ", block: 0, end: 7, words: 8 },
      { id: "h2", level: 2, title: "1.1", block: 2, end: 7, words: 5 },
      { id: "h3", level: 1, title: "参考文献", block: 7, end: 9, words: 0 },
      { id: "h4", level: 1, title: "致谢", block: 9, end: 11, words: 0 },
    ]);
  });
});

describe("正文快照 v2 服务（HTTP）", () => {
  const projectId = "09c93463-a51f-4fba-9a18-e934268bb5ee";
  const documentId = "a0bc2a3d-572f-47a1-b779-84dc10cc3925";
  const timestamp = "2026-11-19T05:00:00Z";
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  const snapshot = {
    schemaVersion: 2,
    model: {
      kind: "docs",
      schemaVersion: 1,
      id: "d",
      theme: { name: "minimal" },
      sections: [{ id: "s", blocks: [{ type: "heading", id: "h", level: 1, inlines: [run("章")] }] }],
    },
    protections: [],
    chapters: [{ id: "h", level: 1, title: "章", block: 0, end: 1, words: 0 }],
  };

  it("升级请求带命令与基版本，并核对响应身份", async () => {
    const commandId = crypto.randomUUID();
    const body: DocumentSchemaUpgradeRead = {
      document: {
        id: documentId,
        project_id: projectId,
        version: 4,
        content: { schema_version: 2, json: snapshot } as DocumentRead["content"],
        created_at: timestamp,
        updated_at: timestamp,
      },
      upgrade: {
        id: crypto.randomUUID(),
        document_id: documentId,
        command_id: commandId,
        from_version: 3,
        to_version: 4,
        from_schema_version: 1,
        to_schema_version: 2,
        converter_version: "legacy-v1-to-docs-v2/1",
        converter_sha256: "a".repeat(64),
        loss_report: [],
        created_at: timestamp,
      },
      replayed: false,
    };
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(body, 201))
      .mockResolvedValueOnce(json({ ...body, upgrade: { ...body.upgrade, to_version: 5 } }, 201));
    const api = createServices({ mode: "http", instanceId: "docs-v2-http", fetch: transport });
    await expect(api.documents.upgradeSchema(projectId, documentId, { command_id: commandId, expected_version: 3 })).resolves.toMatchObject({
      replayed: false,
    });
    const [url, init] = transport.mock.calls[0]!;
    expect(url as string).toContain(`/projects/${projectId}/documents/${documentId}/schema-upgrade`);
    expect(JSON.parse(init?.body as string)).toEqual({ command_id: commandId, expected_version: 3 });
    await expect(api.documents.upgradeSchema(projectId, documentId, { command_id: commandId, expected_version: 3 })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("as=v2 预览与服务端错误码直接透出", async () => {
    const version = {
      document_id: documentId,
      project_id: projectId,
      version: 1,
      source: "local_import",
      created_at: timestamp,
      content: { schema_version: 2, json: snapshot },
      converted: true,
    };
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(version))
      .mockResolvedValueOnce(json({ error: { code: "DOCMODEL_PROTECTION_VIOLATED", message: "x", request_id: "r" } }, 409));
    const api = createServices({ mode: "http", instanceId: "docs-v2-http-2", fetch: transport });
    await expect(api.documents.versionAsV2(projectId, documentId, 1)).resolves.toMatchObject({ converted: true });
    expect(transport.mock.calls[0]![0] as string).toContain("/versions/1?as=v2");
    await expect(
      api.documents.save(projectId, documentId, { expected_version: 1, content: { schema_version: 2, json: snapshot } as DocumentRead["content"] }),
    ).rejects.toMatchObject({ code: "DOCMODEL_PROTECTION_VIOLATED" });
  });
});
