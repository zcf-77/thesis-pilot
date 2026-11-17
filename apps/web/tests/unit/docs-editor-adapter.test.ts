import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import type { DocsModel } from "@muffin-office/core/types";
import { applyOps, DocOpsError, DocsEditorController, type BlockedEvent, type DocOp, type TransactionMeta } from "@muffin-office/vue/docs-editor/core";
import { anchorFromUtf16, anchorText, anchorToUtf16, followAnchors, stepsOf, textBlockText } from "../../src/workspace/editor/anchors.ts";
import {
  createDocsSnapshot,
  deriveChapters,
  DocsSnapshotError,
  isDocsSnapshot,
  isLegacySnapshot,
  parseDocsSnapshot,
  snapshotSchemaVersion,
  type DocsProtection,
} from "../../src/workspace/editor/docsSnapshot.ts";
import { describeBlocked, protectionsFromRanges, toProtectedRanges } from "../../src/workspace/editor/protections.ts";

function sampleModel(): DocsModel {
  return {
    kind: "docs",
    schemaVersion: 1,
    id: "doc-sample",
    theme: { name: "gongwen" },
    sections: [
      {
        id: "s1",
        blocks: [
          { type: "heading", id: "ch-1", level: 1, inlines: [{ type: "run", text: "第一章 绪论" }] },
          { type: "paragraph", id: "p1", inlines: [{ type: "run", text: "准确率提升到 71.4%，见文献 [3]。" }] },
          { type: "heading", id: "ch-1-1", level: 2, inlines: [{ type: "run", text: "研究背景" }] },
          {
            type: "list",
            id: "l1",
            kind: "bullet",
            items: [{ id: "li1", blocks: [{ type: "paragraph", id: "p2", inlines: [{ type: "run", text: "第一点" }] }] }],
          },
          {
            type: "table",
            id: "t1",
            rows: [{ id: "r1", cells: [{ id: "c1", blocks: [{ type: "paragraph", id: "p3", inlines: [{ type: "run", text: "表格不计字" }] }] }] }],
          },
          { type: "heading", id: "ch-2", level: 1, inlines: [{ type: "run", text: "参考文献" }] },
          { type: "paragraph", id: "p4", inlines: [{ type: "run", text: "[3] 某作者. 某论文." }] },
        ],
      },
    ],
  };
}

const protections: DocsProtection[] = [
  { id: "pr-number", kind: "number", anchor: { node: "p1", start: 7, end: 12 } },
  { id: "pr-citation", kind: "citation", anchor: { node: "p1", start: 17, end: 20 }, binding: "lit-3" },
  { id: "pr-table", kind: "object", anchor: { node: "t1" } },
];

function snapshot(overrides: Record<string, unknown> = {}) {
  return { schemaVersion: 2, model: sampleModel(), protections, chapters: [], ...overrides };
}

describe("正文快照 v2", () => {
  it("校验通过并按标题块重算章节", () => {
    const parsed = parseDocsSnapshot(snapshot());
    expect(parsed.protections).toEqual(protections);
    expect(parsed.chapters).toEqual([
      { id: "ch-1", level: 1, title: "第一章 绪论", block: 0, end: 5, words: 22 },
      { id: "ch-1-1", level: 2, title: "研究背景", block: 2, end: 5, words: 3 },
      { id: "ch-2", level: 1, title: "参考文献", block: 5, end: 7, words: 0 },
    ]);
    expect(isDocsSnapshot(snapshot())).toBe(true);
    expect(createDocsSnapshot(sampleModel(), protections).chapters.map((chapter) => chapter.id)).toEqual(["ch-1", "ch-1-1", "ch-2"]);
  });

  it("输入的章节只校验结构，不覆盖正文事实", () => {
    const stale = [{ id: "ch-1", level: 3, title: "旧标题", block: 9, end: 9, words: 0 }];
    expect(parseDocsSnapshot(snapshot({ chapters: stale })).chapters[0]).toMatchObject({ level: 1, title: "第一章 绪论" });
    expect(() => parseDocsSnapshot(snapshot({ chapters: [{ id: "ch-1" }] }))).toThrow(DocsSnapshotError);
  });

  it("拒绝重复节点、内嵌图片字节、未知字段与孤立代理字符", () => {
    const duplicate = sampleModel();
    duplicate.sections[0].blocks.push({ type: "paragraph", id: "p1", inlines: [] });
    const bytes = { ...sampleModel(), resources: [{ id: "img", mime: "image/png", data: { kind: "bytes" as const, value: "AAAA" } }] };
    const lone = sampleModel();
    lone.sections[0].blocks.push({ type: "paragraph", id: "p9", inlines: [{ type: "run", text: "坏" + String.fromCharCode(0xd800) }] });
    for (const [value, reason] of [
      [snapshot({ model: duplicate }), "重复"],
      [snapshot({ model: bytes }), "uri"],
      [snapshot({ model: lone }), "代理"],
      [snapshot({ extra: true }), "未知字段"],
      [snapshot({ schemaVersion: 1 }), "schemaVersion"],
    ] as const) {
      try {
        parseDocsSnapshot(value);
        throw new Error("应当拒绝");
      } catch (error) {
        expect(error).toBeInstanceOf(DocsSnapshotError);
        expect((error as DocsSnapshotError).reason).toContain(reason);
        expect((error as Error).message).toBe("正文快照的结构不受支持，没有载入。当前正文保持不变；请恢复其他历史版本或联系维护者。");
      }
    }
  });

  it("保护区间必须落在正文段落内且不越界", () => {
    const cases: DocsProtection[] = [
      { id: "x", kind: "lock", anchor: { node: "p1", start: 3, end: 3 } },
      { id: "x", kind: "lock", anchor: { node: "p1", start: 0, end: 99 } },
      { id: "x", kind: "lock", anchor: { node: "t1", start: 0, end: 1 } },
      { id: "x", kind: "lock", anchor: { node: "missing" } },
      { id: "x", kind: "unknown" as DocsProtection["kind"], anchor: { node: "p1" } },
    ];
    for (const item of cases) expect(isDocsSnapshot(snapshot({ protections: [item] }))).toBe(false);
    expect(isDocsSnapshot(snapshot({ protections: [protections[0], protections[0]] }))).toBe(false);
  });

  it("识别 v1 快照与结构版本", () => {
    const legacy = { schemaVersion: 1, json: { type: "doc", content: [] }, chapters: [] };
    expect(isLegacySnapshot(legacy)).toBe(true);
    expect(isLegacySnapshot(snapshot())).toBe(false);
    expect(snapshotSchemaVersion(legacy)).toBe(1);
    expect(snapshotSchemaVersion(snapshot())).toBe(2);
    expect(snapshotSchemaVersion({ schemaVersion: 3 })).toBeUndefined();
  });

  it("参考文献之后的正文不计入字数", () => {
    const model = sampleModel();
    model.sections[0].blocks.splice(5, 0, { type: "paragraph", id: "p-extra", inlines: [{ type: "run", text: "十个字的附加段落内容" }] });
    expect(deriveChapters(model)[1].words).toBe(13);
  });
});

describe("锚点与偏移", () => {
  const model = (): DocsModel => ({
    ...sampleModel(),
    sections: [
      { id: "s1", blocks: [{ type: "paragraph", id: "e", inlines: [{ type: "run", text: "a😀b" }, { type: "tab" }, { type: "run", text: "中文" }] }] },
    ],
  });

  it("标量与 UTF-16 互换，拒绝切开代理对", () => {
    expect(textBlockText(model(), "e")).toBe("a😀b\t中文");
    expect(anchorToUtf16(model(), { node: "e", start: 1, end: 4 })).toEqual({ node: "e", start: 1, end: 5 });
    expect(anchorFromUtf16(model(), { node: "e", start: 1, end: 5 })).toEqual({ node: "e", start: 1, end: 4 });
    expect(anchorFromUtf16(model(), { node: "e", start: 2, end: 5 })).toBeUndefined();
    expect(anchorText(model(), { node: "e", start: 4, end: 6 })).toBe("中文");
    expect(anchorText(model(), { node: "e" })).toBe("a😀b\t中文");
    expect(textBlockText(model(), "missing")).toBeUndefined();
  });

  it("叠加锚点随编辑移动，节点删除后丢弃", () => {
    const controller = new DocsEditorController({ doc: sampleModel() });
    const metas: TransactionMeta[] = [];
    const listening = new DocsEditorController({ doc: sampleModel(), onTransaction: (_txn, meta) => metas.push(meta) });
    listening.setSelection({ anchor: { node: "p1", offset: 0 }, focus: { node: "p1", offset: 0 } });
    expect(listening.insertText("新")).toBe(true);
    const overlays = followAnchors([{ id: "o1", group: "candidate", anchor: { node: "p1", start: 7, end: 12 } }], stepsOf(metas));
    expect(overlays[0].anchor).toMatchObject({ node: "p1", start: 8, end: 13 });
    expect(controller.doc).toEqual(sampleModel());
  });
});

describe("保护映射与拦截", () => {
  it("区间内输入被拦截并发 blocked，模型不变；区间外输入后保护随之移动", () => {
    const blocked: BlockedEvent[] = [];
    const base = parseDocsSnapshot(snapshot());
    const controller = new DocsEditorController({ doc: base.model, onBlocked: (event) => blocked.push(event) });
    controller.setProtectedRanges(toProtectedRanges(base.protections));
    const before = controller.doc;
    controller.setSelection({ anchor: { node: "p1", offset: 8 }, focus: { node: "p1", offset: 8 } });
    expect(controller.insertText("9")).toBe(false);
    expect(blocked).toMatchObject([{ rangeId: "pr-number", kind: "number" }]);
    expect(controller.doc).toBe(before);
    expect(describeBlocked(blocked[0])).toBe("数字受保护，修改没有生效。正文保持不变；如需改动，请通过候选审阅采纳。");

    controller.setSelection({ anchor: { node: "p1", offset: 0 }, focus: { node: "p1", offset: 0 } });
    expect(controller.insertText("实验")).toBe(true);
    const readback = protectionsFromRanges(base.protections, controller.protected);
    expect(readback.lost).toEqual([]);
    expect(readback.protections).toEqual([
      { id: "pr-number", kind: "number", anchor: { node: "p1", start: 9, end: 14 } },
      { id: "pr-citation", kind: "citation", anchor: { node: "p1", start: 19, end: 22 }, binding: "lit-3" },
      { id: "pr-table", kind: "object", anchor: { node: "t1" } },
    ]);
    const saved = createDocsSnapshot(controller.doc, readback.protections);
    expect(anchorText(saved.model, saved.protections[0].anchor)).toBe("71.4%");
    expect(anchorText(saved.model, saved.protections[1].anchor)).toBe("[3]");
  });

  it("整块保护的表格不能删除或修改", () => {
    const blocked: BlockedEvent[] = [];
    const base = parseDocsSnapshot(snapshot());
    const controller = new DocsEditorController({ doc: base.model, onBlocked: (event) => blocked.push(event) });
    controller.setProtectedRanges(toProtectedRanges(base.protections));
    controller.setSelection({ anchor: { node: "p3", offset: 0 }, focus: { node: "p3", offset: 0 } });
    expect(controller.insertText("改")).toBe(false);
    expect(blocked.at(-1)).toMatchObject({ rangeId: "pr-table", kind: "object" });
  });

  it("读回时丢失的保护单独列出", () => {
    expect(protectionsFromRanges(protections, toProtectedRanges(protections.slice(1))).lost).toEqual(["pr-number"]);
  });
});

describe("供应产物与 MuffinOffice 内核金标一致", () => {
  const fixture = JSON.parse(readFileSync(new URL("../../vendor/muffin-office/fixtures/doc-ops-conformance.json", import.meta.url), "utf8")) as {
    schema: string;
    cases: Array<{ name: string; model: DocsModel; txn: DocOp[]; expected?: DocsModel; error?: string; kernelOnly?: boolean }>;
  };
  const kernelOnly = new Set(["doc.set_section_page", "meta.set", "theme.apply"]);

  it("金标格式", () => {
    expect(fixture.schema).toBe("doc-ops-conformance/1");
    expect(fixture.cases.length).toBeGreaterThanOrEqual(100);
  });

  for (const item of fixture.cases.filter((entry) => !entry.kernelOnly))
    it(item.name, () => {
      const input = structuredClone(item.model);
      if (item.txn.some((op) => kernelOnly.has((op as { op: string }).op)) && item.error == null) {
        expect(() => applyOps(item.model, item.txn)).toThrow(DocOpsError);
      } else if (item.error != null) {
        expect(() => applyOps(item.model, item.txn)).toThrow(item.error);
      } else {
        const result = applyOps(item.model, item.txn);
        expect(JSON.parse(JSON.stringify(result.doc))).toEqual(item.expected);
        expect(JSON.parse(JSON.stringify(applyOps(result.doc, result.inverse).doc))).toEqual(item.model);
      }
      expect(item.model).toEqual(input);
    });
});
