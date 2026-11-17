import { describe, expect, it, vi } from "vite-plus/test";
import { ApiError, type BackendServices, type DocumentRead } from "../../src/services/index.ts";
import { sameDocumentDraftScope, type DocumentDraft, type DocumentDraftRepository } from "../../src/lab/state/documentDrafts.ts";
import { createRemoteDocumentController } from "../../src/lab/state/remoteDocuments.ts";
import type { EditorSnapshot } from "../../src/lab/state/editorAdapter.ts";

const snapshot = (text: string): EditorSnapshot => ({
  schemaVersion: 1,
  json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  chapters: [],
});
const body = (text: string): DocumentRead["content"] => ({ schema_version: 1, json: snapshot(text).json });
const blankBody: DocumentRead["content"] = { schema_version: 1, json: { type: "doc", content: [{ type: "paragraph" }] } };
const date = "2026-11-17T08:00:00Z";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function setup(repository?: DocumentDraftRepository) {
  const identity = { sourceKey: "mock:draft-tests", projectId: crypto.randomUUID(), localProjectId: crypto.randomUUID() };
  const id = crypto.randomUUID();
  const reading = (version: number, content: DocumentRead["content"]): DocumentRead => ({
    id,
    project_id: identity.projectId,
    version,
    content,
    created_at: date,
    updated_at: date,
  });
  let remote = reading(1, body("服务正式稿"));
  const documents = {
    current: vi.fn<BackendServices["documents"]["current"]>(async () => remote),
    import: vi.fn<BackendServices["documents"]["import"]>(async (_projectId, input) => (remote = reading(1, input.content))),
    createBlank: vi.fn<BackendServices["documents"]["createBlank"]>(async () => (remote = reading(1, blankBody))),
    save: vi.fn<BackendServices["documents"]["save"]>(async (_projectId, _documentId, input) => {
      if (input.expected_version !== remote.version) throw new ApiError("DOCUMENT_VERSION_CONFLICT");
      return (remote = reading(remote.version + 1, input.content));
    }),
    versions: vi.fn<BackendServices["documents"]["versions"]>(),
    version: vi.fn<BackendServices["documents"]["version"]>(),
    versionAsV2: vi.fn<BackendServices["documents"]["versionAsV2"]>(),
    upgradeSchema: vi.fn<BackendServices["documents"]["upgradeSchema"]>(),
    uploadResource: vi.fn<BackendServices["documents"]["uploadResource"]>(),
    resource: vi.fn<BackendServices["documents"]["resource"]>(),
  };
  const entries = new Map<string, DocumentDraft>();
  const drafts =
    repository ??
    ({
      list: async (scope) => [...entries.values()].filter((draft) => sameDocumentDraftScope(draft, scope)).map((draft) => structuredClone(draft)),
      put: async (draft) => {
        entries.set(draft.id, structuredClone(draft));
      },
      removeIfUnchanged: async (draft) => {
        if (entries.get(draft.id)?.revision === draft.revision) entries.delete(draft.id);
      },
    } satisfies DocumentDraftRepository);
  const controller = () => createRemoteDocumentController({ sourceKey: identity.sourceKey, documents }, identity, drafts);
  return { identity, id, reading, documents, drafts, entries, controller, setRemote: (value: DocumentRead) => (remote = value) };
}

describe("服务正文草稿和正式版本", () => {
  it("只在服务明确没有正文后创建空白稿，结果未知时先核对再继续", async () => {
    const fixture = setup();
    const { documents } = fixture;
    const controller = fixture.controller();
    documents.current.mockRejectedValueOnce(new ApiError("UNAUTHORIZED"));
    expect(await controller.load()).toBe(false);
    expect(await controller.createBlank()).toBe(false);
    expect(documents.createBlank).not.toHaveBeenCalled();

    documents.current.mockRejectedValueOnce(new ApiError("DOCUMENT_NOT_FOUND"));
    expect(await controller.load()).toBe(true);
    documents.createBlank.mockImplementationOnce(async () => {
      fixture.setRemote(fixture.reading(1, blankBody));
      throw new ApiError("REQUEST_TIMEOUT");
    });
    expect(await controller.createBlank()).toBe(false);
    expect(controller.state).toMatchObject({ phase: "empty", issue: "unknown" });
    expect(await controller.createBlank()).toBe(false);
    expect(await controller.checkLatest()).toBe(true);
    expect(documents.createBlank).toHaveBeenCalledExactlyOnceWith(fixture.identity.projectId, expect.any(AbortSignal));
    expect(controller.state).toMatchObject({ phase: "ready", issue: null, baseVersion: 1, document: { content: blankBody } });
  });

  it("离开写作后忽略空白初始化迟到结果，重新打开时只读服务", async () => {
    const fixture = setup();
    const { documents } = fixture;
    const controller = fixture.controller();
    documents.current.mockRejectedValueOnce(new ApiError("DOCUMENT_NOT_FOUND"));
    await controller.load();
    const pending = deferred<DocumentRead>();
    documents.createBlank.mockImplementationOnce(() => pending.promise);
    const creating = controller.createBlank();
    controller.pause();
    expect(documents.createBlank.mock.lastCall?.[1]?.aborted).toBe(true);
    pending.resolve(fixture.setRemote(fixture.reading(1, blankBody)));
    expect(await creating).toBe(false);
    expect(controller.state).toMatchObject({ phase: "empty", issue: "unknown", document: null });
    expect(await controller.load()).toBe(true);
    expect(controller.state).toMatchObject({ phase: "ready", issue: null, baseVersion: 1 });
    expect(documents.createBlank).toHaveBeenCalledTimes(1);
  });

  it("只在服务明确无正文后允许导入，保存来自主动操作", async () => {
    const fixture = setup();
    const { documents } = fixture;
    const controller = fixture.controller();
    documents.current.mockRejectedValueOnce(new ApiError("UNAUTHORIZED"));
    expect(await controller.load()).toBe(false);
    expect(controller.state.phase).toBe("error");
    expect(await controller.importLocal(snapshot("本机原稿"))).toBe(false);
    expect(documents.import).not.toHaveBeenCalled();

    documents.current.mockRejectedValueOnce(new ApiError("DOCUMENT_NOT_FOUND"));
    expect(await controller.load()).toBe(true);
    expect(controller.state.phase).toBe("empty");
    const local = snapshot("本机原稿");
    expect(await controller.importLocal(local)).toBe(true);
    expect(local).toEqual(snapshot("本机原稿"));
    expect(documents.import).toHaveBeenCalledWith(fixture.identity.projectId, { content: body("本机原稿") }, expect.any(AbortSignal));
    expect(controller.state.document?.version).toBe(1);

    const loadRevision = controller.state.loadRevision;
    expect(await controller.checkLatest()).toBe(true);
    expect(controller.state.loadRevision).toBe(loadRevision);
    expect(controller.edit(snapshot("保存前的草稿"))).toBe(true);
    await vi.waitFor(() => expect(controller.state.draftStatus).toBe("saved"));
    expect(documents.save).not.toHaveBeenCalled();
    expect(await controller.save()).toBe(true);
    expect(documents.save).toHaveBeenCalledWith(
      fixture.identity.projectId,
      fixture.id,
      { expected_version: 1, content: body("保存前的草稿") },
      expect.any(AbortSignal),
    );
    expect(controller.state).toMatchObject({ baseVersion: 2, dirty: false, loadRevision });
    await vi.waitFor(() => expect(fixture.entries.size).toBe(0));
  });

  it("保存冻结提交快照，期间输入继续作为新草稿留在同一编辑器", async () => {
    const fixture = setup();
    const controller = fixture.controller();
    await controller.load();
    const revision = controller.state.loadRevision;
    const pending = deferred<DocumentRead>();
    fixture.documents.save.mockImplementationOnce(() => pending.promise);
    controller.edit(snapshot("提交的内容"));
    const saving = controller.save();
    await vi.waitFor(() => expect(fixture.documents.save).toHaveBeenCalledTimes(1));
    expect(await controller.save()).toBe(false);
    controller.edit(snapshot("提交以后继续编辑"));
    const committed = fixture.reading(2, body("提交的内容"));
    fixture.setRemote(committed);
    pending.resolve(committed);
    expect(await saving).toBe(true);
    expect(controller.state).toMatchObject({
      baseVersion: 2,
      dirty: true,
      loadRevision: revision,
      snapshot: snapshot("提交以后继续编辑"),
    });
    await vi.waitFor(() =>
      expect([...fixture.entries.values()]).toEqual([expect.objectContaining({ baseVersion: 2, snapshot: snapshot("提交以后继续编辑") })]),
    );
  });

  it("409 后查新版不重发，只有成功归档仍保留原基线的草稿才载入新版", async () => {
    const fixture = setup();
    const controller = fixture.controller();
    await controller.load();
    controller.edit(snapshot("第一窗口草稿"));
    fixture.setRemote(fixture.reading(2, body("第二窗口已保存")));
    expect(await controller.save()).toBe(false);
    expect(controller.state).toMatchObject({ issue: "conflict", baseVersion: 1, snapshot: snapshot("第一窗口草稿") });
    expect(await controller.checkLatest()).toBe(true);
    expect(controller.state.latest?.version).toBe(2);
    expect(await controller.save()).toBe(false);
    expect(await controller.loadLatestPreservingDraft()).toBe(true);
    expect(controller.state).toMatchObject({ issue: null, baseVersion: 2, dirty: false, snapshot: snapshot("第二窗口已保存") });
    expect(controller.state.drafts).toHaveLength(1);
    const id = controller.state.drafts[0]!.id;
    expect(await controller.recoverDraft(id)).toBe(true);
    expect(controller.state).toMatchObject({ issue: "conflict", baseVersion: 1, dirty: true, snapshot: snapshot("第一窗口草稿") });
    expect(fixture.documents.save).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(fixture.entries.size).toBe(2));
  });

  it("网络丢失后只重查当前版本，内容及版本匹配才确认", async () => {
    const fixture = setup();
    const controller = fixture.controller();
    await controller.load();
    controller.edit(snapshot("响应丢失的正文"));
    fixture.documents.save.mockImplementationOnce(async (_project, _document, input) => {
      fixture.setRemote(fixture.reading(2, input.content));
      throw new ApiError("REQUEST_TIMEOUT");
    });
    expect(await controller.save()).toBe(false);
    expect(controller.state).toMatchObject({ issue: "unknown", dirty: true, baseVersion: 1 });
    expect(await controller.save()).toBe(false);
    expect(await controller.checkLatest()).toBe(true);
    expect(controller.state).toMatchObject({ issue: null, dirty: false, baseVersion: 2 });
    expect(fixture.documents.save).toHaveBeenCalledTimes(1);
  });

  it("重查发现服务仍处于原版本后，只能由用户以原版本重试", async () => {
    const fixture = setup();
    const controller = fixture.controller();
    await controller.load();
    controller.edit(snapshot("服务暂未确认"));
    fixture.documents.save.mockRejectedValueOnce(new ApiError("NETWORK_ERROR"));
    expect(await controller.save()).toBe(false);
    expect(await controller.checkLatest()).toBe(true);
    expect(controller.state).toMatchObject({ issue: null, dirty: true, baseVersion: 1 });
    expect(fixture.documents.save).toHaveBeenCalledTimes(1);
    expect(await controller.save()).toBe(true);
    expect(fixture.documents.save.mock.calls.map((call) => call[2].expected_version)).toEqual([1, 1]);
  });

  it("两个编辑实例各自留稿，重新进入仅读取，恢复原有基础版本", async () => {
    const fixture = setup();
    const first = fixture.controller();
    const second = fixture.controller();
    await first.load();
    await second.load();
    first.edit(snapshot("甲窗口草稿"));
    second.edit(snapshot("乙窗口草稿"));
    await vi.waitFor(() => expect(fixture.entries.size).toBe(2));
    first.dispose();
    second.dispose();
    fixture.setRemote(fixture.reading(2, body("其他实例写入")));
    const reopened = fixture.controller();
    expect(await reopened.load()).toBe(true);
    expect(reopened.state.dirty).toBe(false);
    expect(reopened.state.drafts.map((draft) => draft.snapshot)).toEqual(expect.arrayContaining([snapshot("甲窗口草稿"), snapshot("乙窗口草稿")]));
    const recovery = reopened.state.drafts.find((draft) => JSON.stringify(draft.snapshot).includes("甲窗口草稿"));
    expect(await reopened.recoverDraft(recovery!.id)).toBe(true);
    expect(reopened.state).toMatchObject({ issue: "conflict", baseVersion: 1, dirty: true, snapshot: snapshot("甲窗口草稿") });
    expect(fixture.documents.save).not.toHaveBeenCalled();
    expect(fixture.documents.import).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(fixture.entries.size).toBe(3));
  });

  it("结果未知时退出，重新进入可以从服务确认，但不会重新提交", async () => {
    const fixture = setup();
    const first = fixture.controller();
    await first.load();
    first.edit(snapshot("断线前发出的内容"));
    fixture.documents.save.mockImplementationOnce(async (_project, _document, input) => {
      fixture.setRemote(fixture.reading(2, input.content));
      throw new ApiError("NETWORK_ERROR");
    });
    expect(await first.save()).toBe(false);
    first.dispose();
    const reopened = fixture.controller();
    expect(await reopened.load()).toBe(true);
    expect(reopened.state).toMatchObject({ baseVersion: 2, dirty: false, snapshot: snapshot("断线前发出的内容") });
    expect(fixture.documents.save).toHaveBeenCalledTimes(1);
  });

  it("读取或保存的迟到结果不会改变已离开的绑定", async () => {
    const fixture = setup();
    const first = fixture.controller();
    const delayed = deferred<DocumentRead>();
    fixture.documents.current.mockImplementationOnce(() => delayed.promise);
    const loading = first.load();
    const oldSignal = fixture.documents.current.mock.calls[0]?.[1];
    first.dispose();
    const different = setup();
    const second = different.controller();
    await second.load();
    delayed.resolve(fixture.reading(1, body("旧绑定的正文")));
    expect(await loading).toBe(false);
    expect(oldSignal?.aborted).toBe(true);
    expect(first.state.document).toBeNull();
    expect(second.state.document?.project_id).toBe(different.identity.projectId);

    const pending = deferred<DocumentRead>();
    different.documents.save.mockImplementationOnce(() => pending.promise);
    second.edit(snapshot("切换前的草稿"));
    const saving = second.save();
    await vi.waitFor(() => expect(different.documents.save).toHaveBeenCalledTimes(1));
    second.dispose();
    pending.resolve(different.reading(2, body("切换前的草稿")));
    expect(await saving).toBe(false);
    expect(second.state.document?.version).toBe(1);
    expect([...different.entries.values()][0]?.snapshot).toEqual(snapshot("切换前的草稿"));
  });

  it("草稿存储失败保留编辑内容、提示下载并拒绝正式提交", async () => {
    const unavailable = async () => {
      throw new Error("IndexedDB is unavailable");
    };
    const fixture = setup({ list: unavailable, put: unavailable, removeIfUnchanged: unavailable });
    const controller = fixture.controller();
    expect(await controller.load()).toBe(true);
    expect(controller.state.draftError).toContain("无法读取");
    controller.edit(snapshot("保留的内存草稿"));
    await vi.waitFor(() => expect(controller.state.draftStatus).toBe("error"));
    expect(await controller.save()).toBe(false);
    expect(fixture.documents.save).not.toHaveBeenCalled();
    const download = controller.downloadDraft();
    expect(download?.filename).toBe("thesispilot-document-draft.json");
    expect(JSON.parse(download!.content)).toMatchObject({ baseVersion: 1, content: body("保留的内存草稿") });
    controller.dispose();

    const reopened = fixture.controller();
    expect(await reopened.load()).toBe(true);
    expect(reopened.state.snapshot).toEqual(snapshot("保留的内存草稿"));
    await vi.waitFor(() => expect(reopened.state.draftStatus).toBe("error"));
    expect(reopened.state.dirty).toBe(true);
  });
});
