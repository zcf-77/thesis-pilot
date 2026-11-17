import { describe, expect, it } from "vite-plus/test";
import { effectScope, nextTick } from "vue";
import type { CitationCandidateRead, CitationListRead, LiteratureEntryRead } from "../../src/services/contracts/api.generated.ts";
import { ApiError } from "../../src/services/errors.ts";
import { checkCandidate, checkCitations } from "../../src/services/httpCitations.ts";
import { createServices } from "../../src/services/index.ts";
import type { BackendServices } from "../../src/services/types.ts";
import type { DocsSnapshot } from "../../src/workspace/editor/docsSnapshot.ts";
import { assistantLiteratureScope, useAssistantLiterature } from "../../src/workspace/writing-citations/assistantLiterature.ts";
import { candidateOverlays, citedFocus, insertionContext, nodeText, placementOf } from "../../src/workspace/writing-citations/citationView.ts";
import { useCitations } from "../../src/workspace/writing-citations/useCitations.ts";
import { formatWritingAnchor, writingAnchorLink, writingAnchorRoute } from "../../src/workspace/workspaceRoutes.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const DOCUMENT = "22222222-2222-4222-8222-222222222222";
const ENTRY = "33333333-3333-4333-8333-333333333333";
const CANDIDATE = "44444444-4444-4444-8444-444444444444";

const snapshot = {
  schemaVersion: 2,
  model: {
    kind: "docs",
    schemaVersion: 1,
    id: "doc",
    theme: { name: "default" },
    sections: [
      {
        id: "s1",
        blocks: [
          { type: "heading", id: "h1", level: 1, inlines: [{ type: "run", text: "第一章" }] },
          { type: "paragraph", id: "p1", inlines: [{ type: "run", text: "🙂协同过滤" }, { type: "break" }, { type: "run", text: "研究" }] },
          {
            type: "list",
            id: "l1",
            kind: "bullet",
            items: [{ id: "i1", blocks: [{ type: "paragraph", id: "p2", inlines: [{ type: "run", text: "列表段" }] }] }],
          },
        ],
      },
    ],
  },
  protections: [],
  chapters: [],
} as unknown as DocsSnapshot;

function candidate(changes: Partial<CitationCandidateRead> = {}): CitationCandidateRead {
  return {
    id: CANDIDATE,
    project_id: PROJECT,
    document_id: DOCUMENT,
    base_version: 3,
    document_version: 3,
    entry: { id: ENTRY, title: "Synthetic study", removed: false },
    entry_version: 1,
    placement: { node_id: "p1", offset: 5 },
    number: 2,
    status: "ready",
    revision: 1,
    policy_version: "citations-1/gbt7714-2015-numeric-1",
    preview: {
      entry_id: ENTRY,
      number: 2,
      reused: false,
      marker: { node: "p1", offset: 5, text: "[2]" },
      reference: { node: "r2", new: true, text: "[2] Synthetic study[Z]." },
      heading: { node: "ref", new: false },
      renumbered: [{ entry_id: ENTRY, before: 1, after: 2 }],
      changes: [
        { kind: "marker", node: "p1", start: 5, after: "[2]" },
        { kind: "marker_renumber", node: "p2", start: 0, end: 3, before: "[1]", after: "[2]" },
        { kind: "reference", node: "r1", before: "[1] A", after: "[1] B" },
        { kind: "reference_new", node: "r2", after: "[2] Synthetic study[Z]." },
      ],
    },
    result_version: null,
    applicable: true,
    stale: false,
    application_command_id: null,
    undoable: false,
    created_at: "2026-11-19T00:00:00Z",
    updated_at: "2026-11-19T00:00:00Z",
    ...changes,
  };
}

describe("引用面板的纸面定位", () => {
  it("按标量读取段落文字，只有正文段落可作为插入点", () => {
    expect(nodeText(snapshot, "p1")).toEqual({ type: "paragraph", text: "🙂协同过滤\n研究" });
    expect(nodeText(snapshot, "p2")?.text).toBe("列表段");
    expect(nodeText(snapshot, "l1")).toBeNull();
    expect(placementOf(snapshot, { node: "p1", start: 1, end: 5, text: "协同过滤" })).toEqual({ node_id: "p1", offset: 5 });
    expect(placementOf(snapshot, { node: "h1", start: 0, end: 0, text: "" })).toBeNull();
    expect(placementOf(snapshot, { node: "p1", start: 0, end: 99, text: "" })).toBeNull();
    expect(placementOf(snapshot, null)).toBeNull();
    // 表情符号按 1 个标量计数，前后文按标量截取。
    expect(insertionContext(snapshot, "p1", 1)).toEqual({ before: "🙂", after: "协同过滤\n研究" });
  });
  it("候选只在待审阅且未过期时画铅笔标记：插入点、重新编号与改写条目", () => {
    const highlights = candidateOverlays(candidate(), snapshot);
    expect(highlights.map((item) => [item.tone, item.anchor])).toEqual([
      ["insert", { node: "p1", start: 4, end: 5 }],
      ["format", { node: "p2", start: 0, end: 3 }],
      ["format", { node: "r1" }],
    ]);
    expect(highlights.every((item) => item.group === "citations")).toBe(true);
    expect(candidateOverlays(candidate({ stale: true, applicable: false }), snapshot)).toEqual([]);
    expect(candidateOverlays(candidate({ status: "rejected", applicable: false }), snapshot)).toEqual([]);
    const atStart = candidate({ placement: { node_id: "p1", offset: 0 } });
    atStart.preview.changes = [{ kind: "marker", node: "p1", start: 0, after: "[2]" }];
    expect(candidateOverlays(atStart, snapshot)[0]!.anchor).toEqual({ node: "p1", start: 0, end: 1 });
  });
  it("已引用文献定位到首个标记，没有标记时退到参考文献条目", () => {
    const item: CitationListRead["items"][number] = {
      entry_id: ENTRY,
      number: 1,
      title: "t",
      removed: false,
      reference_node: "r1",
      reference_text: "[1] t",
      markers: [{ protection_id: "m", node: "p1", start: 2, end: 5 }],
    };
    expect(citedFocus(item)).toEqual({ node: "p1", start: 2, end: 5 });
    expect(citedFocus({ ...item, markers: [] })).toEqual({ node: "r1" });
  });
});

describe("引用接口的响应守卫", () => {
  it("候选必须属于本文档、编号与预览一致、过期后不可采纳", () => {
    expect(checkCandidate(candidate(), PROJECT, DOCUMENT)).toBeTruthy();
    for (const broken of [
      candidate({ document_id: PROJECT }),
      candidate({ stale: true }),
      candidate({ status: "applied" }),
      candidate({ number: 3 }),
      candidate({ undoable: true }),
    ])
      expect(() => checkCandidate(broken, PROJECT, DOCUMENT)).toThrow(ApiError);
  });
  it("引用列表按 1..n 编号，旧版正文没有受管引用", () => {
    const list: CitationListRead = {
      document_id: DOCUMENT,
      document_version: 3,
      schema_version: 2,
      references_heading: "ref",
      consistent: true,
      items: [{ entry_id: ENTRY, number: 1, title: "t", removed: false, reference_node: "r1", reference_text: "[1] t", markers: [] }],
    };
    expect(checkCitations(list, DOCUMENT, 3)).toBe(list);
    expect(() => checkCitations({ ...list, items: [{ ...list.items[0]!, number: 2 }] }, DOCUMENT)).toThrow(ApiError);
    expect(() => checkCitations({ ...list, schema_version: 1 }, DOCUMENT)).toThrow(ApiError);
  });
});

describe("写作页深链锚点", () => {
  it("锚点可往返，格式不对时忽略而不猜测", () => {
    expect(formatWritingAnchor({ node: "N1", start: 3, end: 8 })).toBe("N1@3-8");
    expect(writingAnchorLink({ chapterId: "c1", anchor: "N1@3-8" })).toEqual({ chapterId: "c1", anchor: { node: "N1", start: 3, end: 8 } });
    expect(writingAnchorLink({ anchor: "chapter-a" })).toEqual({ anchor: { node: "chapter-a" } });
    expect(writingAnchorLink({ anchor: "N1@9-3" })).toEqual({});
    expect(writingAnchorLink({ anchor: ["x"], chapterId: "" })).toEqual({});
    expect(writingAnchorRoute(PROJECT, { chapterId: "c1" })).toEqual({ name: "workspace-writing", params: { projectId: PROJECT }, query: { chapterId: "c1" } });
  });
});

describe("文献交给内容助手", () => {
  it("按服务实例与项目隔离，最多 10 篇，移出项目文献后自动去掉", () => {
    const scope = assistantLiteratureScope("http:one", PROJECT);
    const store = useAssistantLiterature(() => scope);
    const other = useAssistantLiterature(() => assistantLiteratureScope("http:two", PROJECT));
    const entry = (index: number) => ({ id: `e${index}`, version: 1, record: { title: `T${index}` } }) as unknown as LiteratureEntryRead;
    for (let index = 0; index < 10; index++) expect(store.add(entry(index))).toBe(true);
    expect(store.add(entry(10))).toBe(false);
    expect(other.items.value).toEqual([]);
    store.sync([
      { id: "e0", version: 2, removed: false },
      { id: "e1", version: 1, removed: true },
    ]);
    expect(store.items.value).toEqual([{ entryId: "e0", version: 2, title: "T0" }]);
    store.remove("e0");
    expect(store.has("e0")).toBe(false);
  });
});

describe("引用面板数据与命令", () => {
  function fake(overrides: Partial<BackendServices["citations"]> = {}) {
    const entry = {
      id: ENTRY,
      project_id: PROJECT,
      removed: false,
      version: 1,
      verification: "unverified",
      record: { title: "Synthetic study", authors: [], coverage: "biblio" },
    } as unknown as LiteratureEntryRead;
    const calls: string[] = [];
    const services = {
      sourceKey: "http:one",
      literature: { entries: async () => ({ items: [entry], total: 1, limit: 100, offset: 0 }) },
      citations: {
        list: async () => ({ document_id: DOCUMENT, document_version: 3, schema_version: 2, references_heading: null, consistent: true, items: [] }),
        candidates: async (_p: string, _d: string, query?: { status?: string }) => ({
          items: query?.status === "ready" ? [candidate()] : [],
          total: query?.status === "ready" ? 1 : 0,
          limit: 20,
          offset: 0,
        }),
        create: async (_p: string, _d: string, input: { base_version: number }) => {
          calls.push(`create:${input.base_version}`);
          return candidate({ id: "55555555-5555-4555-8555-555555555555" });
        },
        apply: async (_p: string, _d: string, _c: string, input: { expected_document_version: number }) => {
          calls.push(`apply:${input.expected_document_version}`);
          return candidate({ status: "applied", applicable: false, result_version: 4, document_version: 4, undoable: true });
        },
        ...overrides,
      },
    } as unknown as BackendServices;
    return { services, calls };
  }
  it("读取文献、引用与候选；采纳以当前版本作 CAS 并要求写作页重载", async () => {
    const { services, calls } = fake();
    const document = { id: DOCUMENT, version: 3, snapshot };
    const scope = effectScope();
    const state = scope.run(() => useCitations({ services: () => services, projectId: () => PROJECT, document: () => document }))!;
    await state.load();
    expect(state.entryId.value).toBe(ENTRY);
    expect(state.ready.value).toHaveLength(1);
    expect(state.overlays.value).toHaveLength(3);
    await state.create({ node_id: "p1", offset: 1 });
    expect(calls).toEqual(["create:3"]);
    expect(await state.apply(state.ready.value[0]!)).toBe(true);
    expect(calls).toEqual(["create:3", "apply:3"]);
    scope.stop();
  });
  it("命令失败如实显示错误；版本变化后迟到的读取不覆盖新版本", async () => {
    let release: () => void = () => {};
    const slow = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    const { services } = fake({
      apply: async () => {
        throw new ApiError("CITATION_STALE", { status: 409 });
      },
      list: async () => {
        if (first) {
          first = false;
          await slow;
          return { document_id: DOCUMENT, document_version: 3, schema_version: 2, references_heading: "old", consistent: true, items: [] };
        }
        return { document_id: DOCUMENT, document_version: 4, schema_version: 2, references_heading: "new", consistent: true, items: [] };
      },
    });
    let document = { id: DOCUMENT, version: 3, snapshot };
    const scope = effectScope();
    const state = scope.run(() => useCitations({ services: () => services, projectId: () => PROJECT, document: () => document }))!;
    const stale = state.load();
    document = { id: DOCUMENT, version: 4, snapshot };
    await state.load();
    release();
    await stale;
    await nextTick();
    expect(state.list.value?.references_heading).toBe("new");
    expect(await state.apply(candidate())).toBeUndefined();
    expect(state.actionError.value).toContain("已过期");
    scope.stop();
  });
  it("Mock 与 HTTP 同契约：没有项目文献时明确拒绝生成候选", async () => {
    const services = createServices({ mode: "mock", instanceId: "cite-test" });
    const project = await services.projects.create({ name: "引用 Mock 项目" });
    const document = await services.documents.createBlank(project.id);
    const citations = await services.citations.list(project.id, document.id);
    expect(citations.items).toEqual([]);
    await expect(
      services.citations.create(project.id, document.id, {
        command_id: crypto.randomUUID(),
        base_version: document.version,
        entry_id: ENTRY,
        placement: { node_id: "p1", offset: 0 },
      }),
    ).rejects.toMatchObject({ code: "CITATION_SCHEMA_UNSUPPORTED" });
  });
});
