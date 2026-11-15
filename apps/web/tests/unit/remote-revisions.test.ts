import { describe, expect, it, vi } from "vite-plus/test";
import { ApiError, createServices, type BackendServices, type DocumentRead, type RevisionSelection } from "../../src/services/index.ts";
import type { EditorSnapshot } from "../../src/lab/state/editorAdapter.ts";
import { createRemoteDocumentController } from "../../src/lab/state/remoteDocuments.ts";
import { createRemoteRevisionsController } from "../../src/lab/state/remoteRevisions.ts";
import type { RevisionCommandRepository, StoredRevisionCommand } from "../../src/lab/state/revisionCommands.ts";
import { sameDocumentDraftScope, type DocumentDraft, type DocumentDraftRepository } from "../../src/lab/state/documentDrafts.ts";
import { REVISION_TRANSPORT_BYTES } from "../../src/services/revisionContent.ts";

const base = "本研究采用方法甲。";
const changed = "本研究使用方法甲。";
const textSnapshot = (text: string): EditorSnapshot => ({
  schemaVersion: 1,
  json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  chapters: [],
});
const textContent = (text: string): DocumentRead["content"] => ({ schema_version: 1, json: textSnapshot(text).json });
const selection: RevisionSelection = { textblock_path: [0], from: 1, to: base.length + 1, text: base };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function setup() {
  const services = createServices({ mode: "mock", instanceId: "review-unit" });
  const project = await services.projects.create({ name: "修订命令样例" });
  const document = await services.documents.import(project.id, { content: textContent(base) });
  const scope = { sourceKey: services.sourceKey, projectId: project.id, documentId: document.id, localProjectId: crypto.randomUUID() };
  const storedDrafts = new Map<string, DocumentDraft>();
  const drafts: DocumentDraftRepository = {
    list: async (identity) => [...storedDrafts.values()].filter((entry) => sameDocumentDraftScope(identity, entry)),
    put: async (draft) => {
      storedDrafts.set(draft.id, structuredClone(draft));
    },
    removeIfUnchanged: async (draft) => {
      if (storedDrafts.get(draft.id)?.revision === draft.revision) storedDrafts.delete(draft.id);
    },
  };
  const journal = new Map<string, StoredRevisionCommand>();
  const repository: RevisionCommandRepository = {
    list: async (identity) => [...journal.values()].filter((entry) => sameDocumentDraftScope(identity, entry)).map((entry) => structuredClone(entry)),
    add: async (entry) => {
      if (journal.has(entry.id)) throw new Error("same id already stored");
      journal.set(entry.id, structuredClone(entry));
    },
    remove: async (entry) => {
      journal.delete(entry.id);
    },
  };
  const formal = createRemoteDocumentController(services, scope, drafts);
  await formal.load();
  let view: string | null = "initial-formal-view";
  const connect = (overrides: Partial<BackendServices["revisions"]> = {}, selectedRepository = repository) =>
    createRemoteRevisionsController({ ...services, revisions: { ...services.revisions, ...overrides } }, scope, formal, {
      repository: selectedRepository,
      getViewIdentity: () => view,
    });
  return { services, scope, formal, connect, journal, repository, setView: (identity: string | null) => (view = identity) };
}

type Controller = ReturnType<typeof createRemoteRevisionsController>;

async function prepareAccepted(controller: Controller) {
  expect(await controller.generate(selection, "精简表述")).toBe(true);
  const candidate = controller.state.candidate!;
  expect(candidate.status).toBe("ready");
  expect(candidate.patches).toHaveLength(1);
  expect(await controller.decide(candidate.patches.map((patch) => ({ patch_id: patch.id, decision: "accepted" })))).toBe(true);
  expect(controller.state.candidate?.applicable).toBe(true);
}

describe("正式稿修订命令", () => {
  it("决定保持正式稿，采纳、撤销及恢复各加载独立结果版本", async () => {
    const { services, scope, formal, connect, journal } = await setup();
    const controller = connect();
    await prepareAccepted(controller);
    const reviewed = controller.state.candidate!;
    expect((await services.documents.current(scope.projectId)).version).toBe(1);
    expect(await controller.apply()).toBe(true);
    expect(controller.state.outcome).toBe("loaded");
    expect(formal.state.baseVersion).toBe(2);
    expect(formal.state.snapshot?.json).toEqual(textSnapshot(changed).json);
    const applyId = controller.state.candidate!.application_command_id!;
    const replayed = await services.revisions.apply(scope.projectId, scope.documentId, reviewed.id.toUpperCase(), {
      command_id: applyId.toUpperCase(),
      expected_document_version: 1,
      expected_revision: reviewed.revision,
    });
    expect(replayed).toMatchObject({ command_id: applyId, result_version: 2 });
    await expect(
      services.revisions.apply(scope.projectId, scope.documentId, reviewed.id, {
        command_id: applyId,
        expected_document_version: 2,
        expected_revision: reviewed.revision,
      }),
    ).rejects.toMatchObject({ code: "REVISION_COMMAND_CONFLICT" });
    expect((await services.documents.current(scope.projectId)).version).toBe(2);
    expect(await controller.undo(applyId)).toBe(true);
    expect(controller.state.candidate?.status).toBe("undone");
    expect(formal.state.baseVersion).toBe(3);
    expect(formal.state.snapshot?.json).toEqual(textSnapshot(base).json);
    expect(await controller.revert(2)).toBe(true);
    expect(formal.state.baseVersion).toBe(4);
    const history = await services.documents.versions(scope.projectId, scope.documentId);
    expect(history.items.map(({ version, source }) => [version, source])).toEqual([
      [4, "version_revert"],
      [3, "adoption_undo"],
      [2, "ai_adoption"],
      [1, "local_import"],
    ]);
    expect(journal.size).toBe(0);
  });

  it("采纳丢失应答后可按ID确认，期间输入的草稿保留旧基线", async () => {
    const { services, scope, formal, connect, journal } = await setup();
    const running = deferred<void>();
    const apply = vi.fn<BackendServices["revisions"]["apply"]>(async (project, document, candidate, input, signal) => {
      expect(journal.get(input.command_id)?.request).toMatchObject({ operation: "apply", input });
      await running.promise;
      await services.revisions.apply(project, document, candidate, input, signal);
      throw new ApiError("NETWORK_ERROR");
    });
    const original = connect({ apply });
    await prepareAccepted(original);
    const adopting = original.apply();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(formal.edit(textSnapshot("采纳期间手动输入的草稿"))).toBe(true);
    running.resolve();
    expect(await adopting).toBe(false);
    expect(original.state.pendingCommands[0]?.status).toBe("unknown");
    const id = original.state.pendingCommands[0]!.id;
    expect(await original.apply()).toBe(false);
    original.dispose();

    const check = vi.fn<BackendServices["revisions"]["command"]>((...args) => services.revisions.command(...args));
    const reopened = connect({ apply, command: check });
    expect(await reopened.load()).toBe(true);
    expect(reopened.state.pendingCommands[0]?.id).toBe(id);
    expect(await reopened.retryCommand(id)).toBe(false);
    expect(await reopened.checkCommand(id)).toBe(true);
    expect(check).toHaveBeenCalledWith(scope.projectId, scope.documentId, id, expect.any(AbortSignal));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(reopened.state).toMatchObject({ resultVersion: 2, outcome: "available", pendingCommands: [] });
    expect(formal.state).toMatchObject({ dirty: true, baseVersion: 1, snapshot: textSnapshot("采纳期间手动输入的草稿"), issue: "conflict" });
    expect(formal.state.latest?.version).toBe(2);
    expect((await services.documents.current(scope.projectId)).version).toBe(2);
    expect(journal.size).toBe(0);
  });

  it("查找命令返回404只更新恢复状态，用户重试仍发送相同ID和参数", async () => {
    const { services, connect } = await setup();
    const decide = vi
      .fn<BackendServices["revisions"]["decide"]>((...args) => services.revisions.decide(...args))
      .mockRejectedValueOnce(new ApiError("REQUEST_TIMEOUT"));
    const controller = connect({ decide });
    await controller.generate(selection, "简洁表述");
    const patchId = controller.state.candidate!.patches[0]!.id;
    expect(await controller.decide([{ patch_id: patchId, decision: "accepted" }])).toBe(false);
    const id = controller.state.pendingCommands[0]!.id;
    expect(await controller.checkCommand(id)).toBe(false);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(controller.state.pendingCommands[0]).toMatchObject({ id, canRetry: true, status: "not-found" });
    expect(await controller.retryCommand(id)).toBe(true);
    expect(decide.mock.calls[1]?.[3]).toEqual(decide.mock.calls[0]?.[3]);
    expect(controller.state.candidate?.decisions).toEqual([{ patch_id: patchId, decision: "accepted" }]);
  });

  it("返回第一页仍显示已选候选详情，分页总数与条目保持服务端事实", async () => {
    const { services, scope, connect } = await setup();
    await Promise.all(
      Array.from({ length: 21 }, (_, index) =>
        services.revisions.create(scope.projectId, scope.documentId, {
          command_id: crypto.randomUUID(),
          base_version: 1,
          selection,
          goal: "分页样例 " + (index + 1),
        }),
      ),
    );
    const controller = connect();
    await controller.load(20);
    expect(controller.state.items).toHaveLength(1);
    const selected = controller.state.candidate?.id;
    expect(selected).toBe(controller.state.items[0]?.id);
    await controller.load(0);
    expect(controller.state.candidate?.id).toBe(selected);
    expect(controller.state.total).toBe(21);
    expect(controller.state.items).toHaveLength(20);
    expect(controller.state.items.map((item) => item.id)).not.toContain(selected);
  });

  it("检查旧采纳固定回执时已加载的新版本不会回退", async () => {
    const { services, scope, formal, connect } = await setup();
    const finish = deferred<void>();
    const apply = vi.fn<BackendServices["revisions"]["apply"]>(async (...args) => {
      const receipt = await services.revisions.apply(...args);
      await finish.promise;
      return receipt;
    });
    const controller = connect({ apply });
    await prepareAccepted(controller);
    const adopting = controller.apply();
    await vi.waitFor(async () => expect((await services.documents.current(scope.projectId)).version).toBe(2));
    await services.documents.save(scope.projectId, scope.documentId, { expected_version: 2, content: textContent("另一窗口已确认的新稿") });
    await formal.checkLatest();
    expect(formal.state.baseVersion).toBe(3);
    finish.resolve();
    expect(await adopting).toBe(true);
    expect(controller.state).toMatchObject({ resultVersion: 2, outcome: "superseded" });
    expect(formal.state.snapshot?.json).toEqual(textSnapshot("另一窗口已确认的新稿").json);
    expect(formal.state.baseVersion).toBe(3);
  });

  it("退出旧正式视图后固定结果只供查看，即使切回来也不替换编辑器", async () => {
    const { services, formal, connect, setView } = await setup();
    const finish = deferred<void>();
    const apply = vi.fn<BackendServices["revisions"]["apply"]>(async (...args) => {
      const receipt = await services.revisions.apply(...args);
      await finish.promise;
      return receipt;
    });
    const controller = connect({ apply });
    await prepareAccepted(controller);
    const adopting = controller.apply();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    setView(null);
    setView("reopened-formal-view");
    finish.resolve();
    expect(await adopting).toBe(true);
    expect(controller.state).toMatchObject({ resultVersion: 2, outcome: "available" });
    expect(formal.state.baseVersion).toBe(1);
    expect(formal.state.latest?.version).toBe(2);
  });

  it("已离开绑定的迟到命令应答不能更新旧编辑器或另一项目", async () => {
    const { services, scope, formal, connect, journal } = await setup();
    const finished = deferred<void>();
    const oldApply = vi.fn<BackendServices["revisions"]["apply"]>(async (...args) => {
      const receipt = await services.revisions.apply(...args);
      await finished.promise;
      return receipt;
    });
    const controller = connect({ apply: oldApply });
    await prepareAccepted(controller);
    const applying = controller.apply();
    await vi.waitFor(async () => expect((await services.documents.current(scope.projectId)).version).toBe(2));
    const oldSignal = oldApply.mock.calls[0]?.[4];
    controller.dispose();
    const next = await setup();
    const nextController = next.connect();
    await nextController.load();
    finished.resolve();

    expect(oldSignal?.aborted).toBe(true);
    expect(await applying).toBe(false);
    expect(formal.state.baseVersion).toBe(1);
    expect(controller.state.resultVersion).toBeNull();
    expect(next.formal.state.baseVersion).toBe(1);
    expect(nextController.state.pendingCommands).toEqual([]);
    expect(journal.size).toBe(1);
  });

  it("生成期间确认取消后迟到候选不会恢复", async () => {
    const { services, scope, connect } = await setup();
    const finish = deferred<void>();
    const propose = vi.fn<BackendServices["revisions"]["propose"]>(async (...args) => {
      await finish.promise;
      return services.revisions.propose(...args);
    });
    const controller = connect({ propose });
    const generating = controller.generate(selection, "保留原句");
    await vi.waitFor(() => expect(propose).toHaveBeenCalledTimes(1));
    expect(controller.state.canCancel).toBe(true);
    expect(await controller.cancel()).toBe(true);
    finish.resolve();
    expect(await generating).toBe(false);
    expect(controller.state.candidate?.status).toBe("cancelled");
    expect(controller.state.candidate?.patches).toEqual([]);
    expect((await services.documents.current(scope.projectId)).version).toBe(1);
  });

  it("本机命令存储失败时不先发送远端写入", async () => {
    const { services, connect, repository } = await setup();
    const create = vi.fn<BackendServices["revisions"]["create"]>((...args) => services.revisions.create(...args));
    const controller = connect(
      { create },
      {
        ...repository,
        add: async () => {
          throw new Error("quota");
        },
      },
    );
    expect(await controller.generate(selection, "精简文字")).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(controller.state.storageError).toContain("本次未提交");
  });

  it("采纳后的候选完整输出超限时，候选、版本及回执一起保持原状态", async () => {
    const { services, scope } = await setup();
    const { projectId, documentId } = scope;
    const api = services.revisions;
    async function propose(text: string) {
      const created = await api.create(projectId, documentId, {
        command_id: crypto.randomUUID(),
        base_version: 1,
        selection,
        goal: "使用固定候选试验约定的字节预算",
      });
      const id = created.candidate_id!;
      const generating = await api.get(projectId, documentId, id);
      await api.propose(projectId, documentId, id, {
        command_id: crypto.randomUUID(),
        generation_token: generating.generation_token!,
        patches: [{ id: "p1", from: selection.from, to: selection.to, before: selection.text, after: text }],
      });
      return api.get(projectId, documentId, id);
    }

    const small = await propose("a");
    const outputBytes = new TextEncoder().encode(JSON.stringify({ ...small, document_version: Number.MAX_SAFE_INTEGER, applicable: false })).byteLength;
    const nearLimit = await propose("a".repeat(REVISION_TRANSPORT_BYTES - outputBytes - 10));
    await api.decide(projectId, documentId, nearLimit.id, {
      command_id: crypto.randomUUID(),
      expected_revision: nearLimit.revision,
      decisions: [{ patch_id: "p1", decision: "accepted" }],
    });
    const reviewed = await api.get(projectId, documentId, nearLimit.id);
    const commandId = crypto.randomUUID();
    await expect(
      api.apply(projectId, documentId, reviewed.id, {
        command_id: commandId,
        expected_revision: reviewed.revision,
        expected_document_version: 1,
      }),
    ).rejects.toMatchObject({ code: "REVISION_TOO_LARGE" });
    expect(await api.get(projectId, documentId, reviewed.id)).toEqual(reviewed);
    expect((await services.documents.current(projectId)).version).toBe(1);
    await expect(api.command(projectId, documentId, commandId)).rejects.toMatchObject({ code: "REVISION_COMMAND_NOT_FOUND" });
  });
});
