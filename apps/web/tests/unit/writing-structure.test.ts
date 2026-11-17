import { describe, expect, it } from "vite-plus/test";
import { defineComponent } from "vue";
import type { DocsModel, DocsPreviewContext } from "@muffin-office/core/types";
import { sourceTextOnly } from "../../src/workspace/writing/commands.ts";
import { pageInView } from "../../src/workspace/writing/pageView.ts";
import { availablePanels, type WritingPanelDefinition } from "../../src/workspace/writing/panels.ts";
import { chapterAt, lockAt, outlineRows, readStructure, styleOptions, styleValue } from "../../src/workspace/writing/structure.ts";
import { diffVersions, textParts } from "../../src/workspace/writing/versionDiff.ts";

const run = (text: string) => ({ type: "run" as const, text });
const doc = (blocks: unknown[]): DocsModel =>
  ({ kind: "docs", schemaVersion: 1, id: "d", theme: { name: "minimal" }, sections: [{ id: "s", blocks }] }) as DocsModel;

describe("写作页结构：目录、当前章、字数与锁定", () => {
  const model = doc([
    { type: "paragraph", id: "front", inlines: [run("摘 要")] },
    { type: "heading", id: "ch-1", level: 2, inlines: [run("1 绪论")] },
    { type: "paragraph", id: "p-1", inlines: [run("正文一段")] },
    {
      type: "table",
      id: "t",
      rows: [{ id: "r", cells: [{ id: "c", blocks: [{ type: "paragraph", id: "cell-p", inlines: [run("表格")] }] }] }],
    },
    { type: "heading", id: "ch-1-1", level: 3, inlines: [run("1.1 背景")] },
    { type: "paragraph", id: "p-2", inlines: [run("背景")] },
    { type: "heading", id: "refs", level: 2, inlines: [run("参考文献")] },
    { type: "paragraph", id: "ref-1", inlines: [run("[1] 不计入字数")] },
  ]);

  it("章节由标题派生，表格内节点归属所在章节，全文字数与章节同一口径并止于参考文献", () => {
    const structure = readStructure(model);
    expect(structure.chapters.map((chapter) => [chapter.id, chapter.words])).toEqual([
      ["ch-1", 6],
      ["ch-1-1", 2],
      ["refs", 0],
    ]);
    expect(structure.words).toBe(8);
    expect(chapterAt(structure, "cell-p")?.id).toBe("ch-1");
    expect(chapterAt(structure, "p-2")?.id).toBe("ch-1-1");
    expect(chapterAt(structure, "front")).toBeUndefined();
    expect(outlineRows(structure.chapters).map((row) => row.depth)).toEqual([0, 1, 0]);
  });

  it("锁定查找按段内区间重叠判断，光标在锁定内也能解除", () => {
    const ranges = [{ id: "lock", kind: "lock", anchor: { node: "p-1", start: 2, end: 4 } }];
    expect(lockAt(ranges, "p-1", 0, 3)?.id).toBe("lock");
    expect(lockAt(ranges, "p-1", 0, 2)).toBeUndefined();
    expect(lockAt(ranges, "p-1", 3, 3)?.id).toBe("lock");
    expect(lockAt([{ id: "n", kind: "number", anchor: { node: "p-1", start: 0, end: 4 } }], "p-1", 0, 1)).toBeUndefined();
  });

  it("状态栏页码：光标页在视口内时显示光标页，滚动离开后显示视口中线所在页", () => {
    // 五页纸，每页高 1000，页间距 20；视口高 800。
    const pages = Array.from({ length: 5 }, (_, index) => ({ top: index * 1020, bottom: index * 1020 + 1000 }));
    const read: number[] = [];
    const box = (index: number) => (read.push(index), pages[index]!);
    expect(pageInView(5, box, 0, 800, 1)).toBe(1);
    // 滚到第 3 页中部，光标仍在第 1 页：跟随视口。
    expect(pageInView(5, box, 2200, 3000, 1)).toBe(3);
    // 光标页仍有一部分在视口内时保持光标页。
    expect(pageInView(5, box, 1900, 2700, 2)).toBe(2);
    // 视口中线落在页间空隙时算下一页；没有光标时同样按视口。
    expect(pageInView(5, box, 610, 1410, 0)).toBe(2);
    // 尚无页面或视口无高度时退回光标页。
    expect(pageInView(0, box, 0, 800, 3)).toBe(3);
    read.length = 0;
    pageInView(5, box, 4200, 5000, 0);
    expect(read.length).toBeLessThanOrEqual(3);
  });

  it("段落样式选项来自主题，标题与正文样式不重复列出", () => {
    const context = {
      docs: { bodyStyle: "Normal", headingStyles: ["Heading1", "Heading2"] },
      styles: { Normal: {}, Heading1: {}, Heading2: {}, Caption: {} },
    } as unknown as DocsPreviewContext;
    const format = { heading: 0, style: "Caption" } as Parameters<typeof styleOptions>[1];
    expect(styleOptions(context, format).map((option) => option.label)).toEqual(["正文", "标题 1", "标题 2", "标题 3", "题注"]);
    expect(styleValue(context, format)).toBe("s:Caption");
    expect(styleValue(context, { ...format!, heading: 2 })).toBe("h2");
    expect(styleValue(context, { ...format!, style: "Normal" })).toBe("p");
    expect(styleValue(context, { ...format!, heading: "mixed" })).toBeUndefined();
  });
});

describe("版本对比与原件编辑限制", () => {
  it("按文字对齐段落：修改、新增、删除分别列出，首尾公共部分裁剪", () => {
    const before = doc([
      { type: "heading", id: "a1", level: 1, inlines: [run("第一章")] },
      { type: "paragraph", id: "a2", inlines: [run("召回率为 63%。")] },
      { type: "paragraph", id: "a3", inlines: [run("后来删去的一段。")] },
      { type: "paragraph", id: "a4", inlines: [run("不变的结尾。")] },
    ]);
    const after = doc([
      { type: "heading", id: "b1", level: 1, inlines: [run("第一章")] },
      { type: "paragraph", id: "b2", inlines: [run("召回率为 71%。")] },
      { type: "paragraph", id: "b4", inlines: [run("不变的结尾。")] },
      { type: "paragraph", id: "b5", inlines: [run("新写的一段。")] },
    ]);
    const diff = diffVersions(before, after);
    expect({ changed: diff.changed, added: diff.added, removed: diff.removed }).toEqual({ changed: 1, added: 1, removed: 1 });
    const changed = diff.rows.find((row) => row.kind === "changed")!;
    expect([changed.before, changed.after]).toEqual(["a2", "b2"]);
    expect(changed.parts).toEqual([
      { kind: "same", text: "召回率为 " },
      { kind: "del", text: "63" },
      { kind: "ins", text: "71" },
      { kind: "same", text: "%。" },
    ]);
    expect(diff.rows.find((row) => row.kind === "removed")?.before).toBe("a3");
    expect(diff.rows.find((row) => row.kind === "added")?.after).toBe("b5");
    expect(textParts("😀甲", "😀乙")).toEqual([
      { kind: "same", text: "😀" },
      { kind: "del", text: "甲" },
      { kind: "ins", text: "乙" },
    ]);
  });

  it("原件导入的正文只放行映射段落内的文字替换", () => {
    const allow = sourceTextOnly(new Set(["p-1"]));
    const txn = (ops: unknown[]) => ({ txn: ops, mode: "apply", actor: "user:test" }) as Parameters<typeof allow>[0];
    expect(allow(txn([{ op: "doc.replace_text", id: "p-1", range: { start: 0, end: 1 }, text: "改" }]))).toBe(true);
    expect(allow(txn([{ op: "doc.replace_text", id: "p-2", text: "改" }]))).toBe(false);
    expect(allow(txn([{ op: "doc.set_run_props", id: "p-1", props: { bold: true } }]))).toBe(false);
    expect(allow(txn([{ op: "doc.insert_block", at: { kind: "end" }, block: { type: "paragraph", id: "x", inlines: [] } }]))).toBe(false);
  });
});

describe("副驾面板注册表", () => {
  const panel = (id: string, order: number, placement: WritingPanelDefinition["placement"]): WritingPanelDefinition => ({
    id,
    label: id,
    order,
    placement,
    component: defineComponent({ render: () => null }),
  });
  it("按正文状态筛选并排序：导入只在空项目出现，常驻面板两种状态都有", () => {
    const panels = [panel("export", 50, "document"), panel("assistant", 10, "document"), panel("import", 40, "empty"), panel("help", 95, "always")];
    expect(availablePanels(panels, true).map((item) => item.id)).toEqual(["assistant", "export", "help"]);
    expect(availablePanels(panels, false).map((item) => item.id)).toEqual(["import", "help"]);
  });
});
