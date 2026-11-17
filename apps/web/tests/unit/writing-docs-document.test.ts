import { describe, expect, it, vi } from "vite-plus/test";
import { ApiError, type BackendServices, type DocumentRead } from "../../src/services/index.ts";
import { createDocsSnapshot, type DocsSnapshot } from "../../src/workspace/editor/docsSnapshot.ts";
import type { DocsModel } from "@muffin-office/core/types";
import { sameDocsDraftScope, type DocsDraft, type DocsDraftRepository } from "../../src/workspace/writing/docsDrafts.ts";
import { createDocsDocumentController, snapshotKey } from "../../src/workspace/writing/docsDocument.ts";

const date = "2026-11-19T08:00:00Z";
const model = (text: string): DocsModel =>
  ({
    kind: "docs",
    schemaVersion: 1,
    id: "doc",
    theme: { name: "minimal" },
    sections: [
      {
        id: "s1",
        blocks: [
          { type: "heading", id: "ch-1", level: 1, inlines: [{ type: "run", text: "第一章 绪论" }] },
          { type: "paragraph", id: "p-1", inlines: [{ type: "run", text }] },
        ],
      },
    ],
  }) as DocsModel;
const snapshot = (text: string, protections: DocsSnapshot["protections"] = []) => createDocsSnapshot(model(text), protections);
const v2 = (text: string): DocumentRead["content"] => ({ schema_version: 2, json: snapshot(text) as never });
const v1: DocumentRead["content"] = { schema_version: 1, json: { type: "doc", content: [{ type: "paragraph" }] } };

function setup() {
  const identity = { sourceKey: "mock:writing-tests", projectId: crypto.randomUUID(), localProjectId: crypto.randomUUID() };
  const id = crypto.randomUUID();
  const reading = (version: number, content: DocumentRead["content"]): DocumentRead => ({
    id,
    project_id: identity.projectId,
    version,
    content,
    created_at: date,
    updated_at: date,
  });
  let remote = reading(1, v2("自制初稿。"));
  const documents = {
    current: vi.fn<BackendServices["documents"]["current"]>(async () => remote),
    import: vi.fn<BackendServices["documents"]["import"]>(),
    createBlank: vi.fn<BackendServices["documents"]["createBlank"]>(async () => (remote = reading(1, v1))),
    save: vi.fn<BackendServices["documents"]["save"]>(async (_projectId, _documentId, input) => {
      if (input.expected_version !== remote.version) throw new ApiError("DOCUMENT_VERSION_CONFLICT", { status: 409 });
      return (remote = reading(remote.version + 1, input.content));
    }),
    versions: vi.fn<BackendServices["documents"]["versions"]>(),
    version: vi.fn<BackendServices["documents"]["version"]>(),
    versionAsV2: vi.fn<BackendServices["documents"]["versionAsV2"]>(),
    upgradeSchema: vi.fn<BackendServices["documents"]["upgradeSchema"]>(async (_projectId, _documentId, input) => {
      if (input.expected_version !== remote.version) throw new ApiError("DOCUMENT_VERSION_CONFLICT", { status: 409 });
      remote = reading(remote.version + 1, v2(""));
      return {
        document: remote,
        replayed: false,
        upgrade: {
          command_id: input.command_id,
          converter_sha256: "0".repeat(64),
          converter_version: "1",
          created_at: date,
          document_id: id,
          from_schema_version: 1,
          from_version: input.expected_version,
          id: crypto.randomUUID(),
          loss_report: [],
          to_schema_version: 2,
          to_version: remote.version,
        },
      };
    }),
    uploadResource: vi.fn<BackendServices["documents"]["uploadResource"]>(),
    resource: vi.fn<BackendServices["documents"]["resource"]>(),
  };
  const entries = new Map<string, DocsDraft>();
  const drafts = {
    list: async (scope) => [...entries.values()].filter((draft) => sameDocsDraftScope(draft, scope)).map((draft) => structuredClone(draft)),
    put: async (draft) => {
      entries.set(draft.id, structuredClone(draft));
    },
    removeIfUnchanged: async (draft) => {
      if (entries.get(draft.id)?.revision === draft.revision) entries.delete(draft.id);
    },
  } satisfies DocsDraftRepository;
  const controller = () => createDocsDocumentController({ sourceKey: identity.sourceKey, documents }, identity, drafts);
  return { reading, documents, entries, controller, remote: () => remote, setRemote: (value: DocumentRead) => (remote = value) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("正式稿 v2 的保存、草稿与冲突", () => {
  it("载入 v2 后编辑生成本机草稿，保存提交完整快照并按 CAS 递增版本，编辑器不换稿", async () => {
    const fixture = setup();
    const controller = fixture.controller();
    expect(await controller.load()).toBe(true);
    expect(controller.state.schema).toBe(2);
    const loaded = controller.state.loadRevision;
    expect(controller.eligible()).toBe(true);

    controller.touch();
    expect(controller.state.dirty).toBe(true);
    expect(controller.eligible()).toBe(false);
    const edited = snapshot("自制初稿。补充一句。", [{ id: "lock-1", kind: "lock", anchor: { node: "p-1", start: 0, end: 2 } }]);
    expect(controller.edit(edited)).toBe(true);
    await settle();
    expect(fixture.entries.size).toBe(1);

    expect(await controller.save()).toBe(true);
    const sent = fixture.documents.save.mock.calls[0]![2];
    expect(sent.expected_version).toBe(1);
    expect(sent.content).toMatchObject({ schema_version: 2, json: { schemaVersion: 2, protections: [{ id: "lock-1", kind: "lock" }] } });
    expect(controller.state.document?.version).toBe(2);
    expect(controller.state.dirty).toBe(false);
    expect(controller.state.loadRevision).toBe(loaded);
    await settle();
    expect(fixture.entries.size).toBe(0);
  });

  it("保存冲突时保留草稿、读到最新版本；载入最新时草稿进入列表，可恢复后以我的版本保存为新版本", async () => {
    const fixture = setup();
    const controller = fixture.controller();
    await controller.load();
    controller.edit(snapshot("本窗口的修改。"));
    fixture.setRemote(fixture.reading(2, v2("另一窗口的修改。")));

    expect(await controller.save()).toBe(false);
    expect(controller.state.issue).toBe("conflict");
    expect(controller.state.latest?.version).toBe(2);
    expect(controller.state.snapshot && snapshotKey(controller.state.snapshot)).toBe(snapshotKey(snapshot("本窗口的修改。")));

    expect(await controller.loadLatestPreservingDraft()).toBe(true);
    expect(controller.state.document?.version).toBe(2);
    expect(controller.state.dirty).toBe(false);
    expect(controller.state.drafts).toHaveLength(1);
    const draft = controller.state.drafts[0]!;
    expect(draft.baseVersion).toBe(1);

    expect(await controller.recoverDraft(draft.id)).toBe(true);
    expect(controller.state.issue).toBe("conflict");
    expect(controller.state.latest?.version).toBe(2);
    expect(await controller.save()).toBe(false);

    expect(await controller.saveOverLatest()).toBe(true);
    expect(fixture.documents.save.mock.calls.at(-1)![2].expected_version).toBe(2);
    expect(fixture.remote().version).toBe(3);
    expect(controller.state.issue).toBeNull();
    expect(controller.state.dirty).toBe(false);
  });

  it("保存结果未知时按提交指纹核对：一致即确认，不重复提交", async () => {
    const fixture = setup();
    const controller = fixture.controller();
    await controller.load();
    controller.edit(snapshot("网络中断前提交的修改。"));
    fixture.documents.save.mockImplementationOnce(async (_projectId, _documentId, input) => {
      fixture.setRemote(fixture.reading(2, input.content));
      throw new ApiError("NETWORK_ERROR");
    });
    expect(await controller.save()).toBe(false);
    expect(controller.state.issue).toBe("unknown");
    expect(await controller.checkLatest()).toBe(true);
    expect(controller.state.issue).toBeNull();
    expect(controller.state.dirty).toBe(false);
    expect(controller.state.document?.version).toBe(2);
    expect(fixture.documents.save).toHaveBeenCalledTimes(1);
  });

  it("刷新后单份草稿自动恢复；与服务端相同的草稿被清理", async () => {
    const fixture = setup();
    const first = fixture.controller();
    await first.load();
    first.edit(snapshot("刷新前未保存的修改。"));
    await settle();
    first.dispose();

    const second = fixture.controller();
    await second.load();
    expect(second.state.dirty).toBe(true);
    expect(second.state.snapshot && snapshotKey(second.state.snapshot)).toBe(snapshotKey(snapshot("刷新前未保存的修改。")));
    second.dispose();

    const third = fixture.controller();
    fixture.setRemote(fixture.reading(1, v2("刷新前未保存的修改。")));
    await third.load();
    expect(third.state.dirty).toBe(false);
    await settle();
    expect(fixture.entries.size).toBe(0);
  });

  it("v1 正文只读，显式升级以同一操作标识重试并进入编辑", async () => {
    const fixture = setup();
    fixture.setRemote(fixture.reading(3, v1));
    const controller = fixture.controller();
    await controller.load();
    expect(controller.state.schema).toBe(1);
    expect(controller.state.snapshot).toBeNull();
    expect(controller.eligible()).toBe(false);
    controller.touch();
    expect(controller.edit(snapshot("不能写入旧版结构"))).toBe(false);
    expect(controller.state.dirty).toBe(false);

    fixture.documents.upgradeSchema.mockRejectedValueOnce(new ApiError("NETWORK_ERROR"));
    expect(await controller.upgrade()).toBe(false);
    expect(await controller.upgrade()).toBe(true);
    const [first, second] = fixture.documents.upgradeSchema.mock.calls.map((call) => call[2]);
    expect(first!.command_id).toBe(second!.command_id);
    expect(second!.expected_version).toBe(3);
    expect(controller.state.schema).toBe(2);
    expect(controller.state.document?.version).toBe(4);
  });

  it("空项目创建空白稿：服务端空白 v1 立即显式升级为 v2", async () => {
    const fixture = setup();
    fixture.documents.current.mockRejectedValueOnce(new ApiError("DOCUMENT_NOT_FOUND", { status: 404 }));
    const controller = fixture.controller();
    expect(await controller.load()).toBe(true);
    expect(controller.state.phase).toBe("empty");
    expect(await controller.createBlank()).toBe(true);
    expect(fixture.documents.createBlank).toHaveBeenCalledTimes(1);
    expect(fixture.documents.upgradeSchema.mock.calls[0]![2].expected_version).toBe(1);
    expect(controller.state.schema).toBe(2);
    expect(controller.state.document?.version).toBe(2);
  });

  it("无法解释的快照不载入，服务器版本保持不变", async () => {
    const fixture = setup();
    fixture.setRemote(fixture.reading(1, { schema_version: 2, json: { schemaVersion: 2, model: { kind: "slides" }, protections: [] } as never }));
    const controller = fixture.controller();
    expect(await controller.load()).toBe(false);
    expect(controller.state.phase).toBe("error");
    expect(controller.state.error).toContain("正文快照的结构不受支持");
  });
});
