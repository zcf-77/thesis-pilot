import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import type { DocsProtection, RevisionNodePatch, RevisionNodeSelection, RevisionPatch, RevisionSelection } from "../../src/services/contracts/api.generated.ts";
import { convertLegacyContent } from "../../src/services/docsContent.ts";
import type { DocsDocumentContent, DocumentContent } from "../../src/services/documentContent.ts";
import { createServices } from "../../src/services/index.ts";
import {
  evaluateNodeProtection,
  nodeText,
  REVISION_POLICY_V2,
  resolveContentSelection,
  resolveNodeSelection,
} from "../../src/services/revisionProtectionV2.ts";
import { documentTextblocks } from "../../src/workspace/tasks/taskFeedbackDraft.ts";

type Json = Record<string, unknown>;
const run = (text: string, props?: Json) => ({ type: "run", text, ...(props ? { props } : {}) });
function v2(inlines: Json[], protections: DocsProtection[] = [], extra: Json[] = []): DocsDocumentContent {
  return {
    schema_version: 2,
    json: {
      schemaVersion: 2,
      model: {
        kind: "docs",
        schemaVersion: 1,
        id: "doc",
        theme: { name: "default" },
        sections: [{ id: "sec", blocks: [{ type: "paragraph", id: "p", inlines }, ...extra] }],
      },
      protections,
      chapters: [],
    },
  } as unknown as DocsDocumentContent;
}
const select = (content: DocumentContent, start: number, end: number, node = "p"): RevisionNodeSelection => ({
  node_id: node,
  start,
  end,
  expected_text: Array.from(nodeText(content, node)!).slice(start, end).join(""),
});
const patch = (content: DocumentContent, start: number, end: number, after: string, id = "p1", node = "p"): RevisionNodePatch => ({
  id,
  start,
  end,
  before: Array.from(nodeText(content, node)!).slice(start, end).join(""),
  after,
});
const outcome = (result: ReturnType<typeof evaluateNodeProtection>) => ({
  allowed: result.content !== null,
  failed: result.checks.filter((item) => item.result === "fail").map((item) => item.rule),
  unsupported: result.checks.filter((item) => item.result === "unsupported").map((item) => item.rule),
});

interface Case {
  id: string;
  title: string;
  kind: string;
  variant_id?: string;
  document: DocumentContent;
  selection: RevisionSelection;
  patches: RevisionPatch[];
  base_version: number;
  current_version: number;
  expected: { allowed: boolean; error_code: string | null; failed_rules: string[]; unsupported_rules: string[] };
  variants?: Case[];
}
const fixtures = JSON.parse(readFileSync(new URL("../../../api/tests/fixtures/revision-protection.json", import.meta.url), "utf8")) as { cases: Case[] };

/** v1 样例 → v2：同一转换器生成节点 ID 与锁定保护，UTF-16 位置换算为段内标量；切开代理对的样例没有标量对应，预期为原文不一致。 */
function migrate(sample: Case) {
  if (sample.document.schema_version !== 1) throw new Error("v1 fixture expected");
  const content: DocsDocumentContent = { schema_version: 2, json: convertLegacyContent(sample.document.json, "fx") };
  const block = documentTextblocks(sample.document.json).find((item) => JSON.stringify(item.path) === JSON.stringify(sample.selection.textblock_path));
  const node = `fx-n-${sample.selection.textblock_path.join("-")}`;
  const scalar = (position: number) => {
    const offset = position - (block?.position ?? 0);
    const head = (block?.text ?? "").slice(0, offset);
    return /[\uD800-\uDBFF]$/u.test(head) ? undefined : Array.from(head).length;
  };
  const start = scalar(sample.selection.from);
  const end = scalar(sample.selection.to);
  const selection: RevisionNodeSelection = { node_id: node, start: start ?? -1, end: end ?? -1, expected_text: sample.selection.text };
  const patches = sample.patches.map((item) => ({
    id: item.id,
    start: scalar(item.from) ?? -1,
    end: scalar(item.to) ?? -1,
    before: item.before,
    after: item.after,
  }));
  return { content, selection, patches };
}

describe("v1 保护样例迁移到 v2（同一规则）", () => {
  // 结构差异：v1 对整块对象 / 非文字子节点的拒绝在 v2 中由节点种类与保护表达，不做逐条对应。
  const structural = new Set(["SG04-P20", "SG04-P24", "SG04-P27"]);
  for (const fixture of fixtures.cases.filter((entry) => entry.kind === "protection" && !structural.has(entry.id))) {
    for (const sample of [fixture, ...(fixture.variants ?? [])]) {
      it([fixture.id, fixture.title, sample.variant_id].filter(Boolean).join(" "), () => {
        const { content, selection, patches } = migrate(sample);
        const evaluate = () => evaluateNodeProtection(content, selection, patches, sample.base_version, sample.current_version);
        if (sample.expected.error_code) {
          expect(evaluate).toThrow(expect.objectContaining({ code: sample.expected.error_code }));
          return;
        }
        const result = outcome(evaluate());
        expect(result.allowed).toBe(sample.expected.allowed);
        expect(result.failed).toEqual(expect.arrayContaining(sample.expected.failed_rules));
        expect(result.unsupported).toEqual(expect.arrayContaining(sample.expected.unsupported_rules));
      });
    }
  }
});

describe("v2 节点选区与快照保护", () => {
  it("emoji 与扩展 B 汉字按标量计数，采纳后文字与保护位移正确", () => {
    const content = v2([run("😀𠀀甲方法乙。数据为12。")], [{ id: "n1", kind: "number", anchor: { node: "p", start: 9, end: 11 } }]);
    const selection = select(content, 2, 5);
    expect(selection.expected_text).toBe("甲方法");
    const result = evaluateNodeProtection(content, selection, [patch(content, 2, 3, "丙丁")], 1, 1);
    expect(outcome(result)).toEqual({ allowed: true, failed: [], unsupported: [] });
    const next = result.content as DocsDocumentContent;
    expect(nodeText(next, "p")).toBe("😀𠀀丙丁方法乙。数据为12。");
    expect(next.json.protections?.[0]?.anchor).toEqual({ node: "p", start: 10, end: 12 });
  });

  it("偏移切进非 BMP 字符的 UTF-16 中段时原文不一致", () => {
    const content = v2([run("😀甲")]);
    expect(() => resolveNodeSelection(content, { node_id: "p", start: 0, end: 1, expected_text: "\ud83d" })).toThrow(
      expect.objectContaining({ code: "REVISION_ANCHOR_INVALID" }),
    );
  });

  it("跨行内对象或跨不同格式 run 的选区不支持", () => {
    const content = v2([run("前文"), { type: "break", kind: "line" }, run("后文"), run("加粗", { bold: true })]);
    expect(nodeText(content, "p")).toBe("前文\n后文加粗");
    expect(() => resolveNodeSelection(content, select(content, 1, 4))).toThrow(expect.objectContaining({ code: "REVISION_UNSUPPORTED" }));
    expect(() => resolveNodeSelection(content, select(content, 4, 6))).toThrow(expect.objectContaining({ code: "REVISION_UNSUPPORTED" }));
    expect(() => resolveNodeSelection(content, select(content, 3, 5))).not.toThrow();
    const field = v2([run("见"), { type: "field", kind: "page_number" }, run("页")]);
    expect(() => resolveNodeSelection(field, select(field, 0, 3))).toThrow(expect.objectContaining({ code: "REVISION_UNSUPPORTED" }));
    const mixed = v2([run("采用"), run("方法", { bold: true }), run("完成")]);
    expect(() => resolveNodeSelection(mixed, select(mixed, 1, 5))).toThrow(expect.objectContaining({ code: "REVISION_UNSUPPORTED" }));
  });

  describe("Word 导入把同格式文字拆成多个 run", () => {
    const props = { font: { kind: "named", value: "Times New Roman" }, fontEastAsia: { kind: "named", value: "宋体" }, lang: "zh-CN", size: 1200 };
    const parts = ["常规组中，A 修复了 ", "6", " 条草稿失配，成功", "率为 ", "71.4%", "，说明该方法基本上是有效果的。"];
    const text = parts.join("");
    const length = Array.from(text).length;
    const imported = (protections: DocsProtection[] = []) =>
      v2(
        parts.map((part) => run(part, { ...props })),
        protections,
      );

    it("整段跨同格式 run 可修订，采纳后保留格式并合并为一个 run", () => {
      const content = imported();
      const after = text.replace("基本上是有效果的", "基本有效");
      const result = evaluateNodeProtection(content, select(content, 0, length), [patch(content, 0, length, after, "model-replacement")], 1, 1);
      expect(outcome(result)).toEqual({ allowed: true, failed: [], unsupported: [] });
      const block = (result.content as DocsDocumentContent).json.model.sections[0]!.blocks[0]! as unknown as { inlines: Json[] };
      expect(block.inlines).toEqual([run(after, props)]);
    });

    it("候选删掉或改动数字时数字检查不通过", () => {
      const content = imported();
      for (const after of [text.replace("为 71.4%", "约七成"), text.replace("6", "7")])
        expect(outcome(evaluateNodeProtection(content, select(content, 0, length), [patch(content, 0, length, after)], 1, 1))).toMatchObject({
          allowed: false,
          failed: ["number"],
        });
    });

    it("跨 run 边界的补丁保留格式，其后的保护区间随文字位移", () => {
      const number = Array.from(text.slice(0, text.indexOf("71.4%"))).length;
      const content = imported([{ id: "n", kind: "number", anchor: { node: "p", start: number, end: number + 5 } }]);
      const start = Array.from(text.slice(0, text.indexOf("成功率为"))).length;
      const result = evaluateNodeProtection(content, select(content, 0, length), [patch(content, start, start + 4, "修复成功率达到")], 1, 1);
      expect(outcome(result)).toEqual({ allowed: true, failed: [], unsupported: [] });
      const next = result.content as DocsDocumentContent;
      expect(nodeText(next, "p")).toBe(text.replace("成功率为", "修复成功率达到"));
      expect(next.json.protections?.[0]?.anchor).toEqual({ node: "p", start: number + 3, end: number + 8 });
      expect((next.json.model.sections[0]!.blocks[0]! as unknown as { inlines: Json[] }).inlines).toHaveLength(1);
    });
  });

  it("保护区间相交拒绝，紧邻边界放行", () => {
    const protections: DocsProtection[] = [
      { id: "c", kind: "citation", anchor: { node: "p", start: 2, end: 5 } },
      { id: "l", kind: "lock", anchor: { node: "p", start: 7, end: 9 } },
      { id: "f", kind: "formula", anchor: { node: "p", start: 10, end: 11 } },
    ];
    const content = v2([run("前文〔一〕中文锁定句x后")], protections);
    const at = (start: number, end: number, after: string) =>
      outcome(evaluateNodeProtection(content, select(content, 0, 12), [patch(content, start, end, after)], 1, 1));
    expect(at(0, 2, "上文")).toMatchObject({ allowed: true });
    expect(at(1, 3, "文字")).toMatchObject({ allowed: false, failed: ["citation"] });
    expect(at(5, 7, "英文")).toMatchObject({ allowed: true });
    expect(at(6, 8, "字锁")).toMatchObject({ allowed: false, failed: ["lock"] });
    expect(at(10, 11, "y")).toMatchObject({ allowed: false, failed: ["formula"] });
  });

  it("整节点保护覆盖所在表格单元格中的段落；原件保护与锁定同规则", () => {
    const table = {
      type: "table",
      id: "t",
      rows: [{ id: "r", cells: [{ id: "cell", blocks: [{ type: "paragraph", id: "q", inlines: [run("单元格文字")] }] }] }],
    };
    const content = v2([run("正文")], [{ id: "o", kind: "object", anchor: { node: "cell" } }], [table]);
    const result = evaluateNodeProtection(content, select(content, 0, 2, "q"), [patch(content, 0, 2, "表内", "x", "q")], 1, 1);
    expect(outcome(result)).toMatchObject({ allowed: false, failed: ["structure"] });
    const source = v2([run("原件正文")], [{ id: "s", kind: "source", anchor: { node: "p" } }]);
    expect(outcome(evaluateNodeProtection(source, select(source, 0, 2), [patch(source, 0, 2, "原文")], 1, 1))).toMatchObject({ failed: ["lock"] });
  });

  it("补丁写入换行、制表或对象占位符属于结构修改", () => {
    const content = v2([run("第一句。第二句。")]);
    for (const after of ["第一句。\n", "第一\t句。", "第一句￼"])
      expect(outcome(evaluateNodeProtection(content, select(content, 0, 4), [patch(content, 0, 4, after)], 1, 1))).toMatchObject({
        allowed: false,
        failed: ["structure"],
      });
  });

  it("补丁越出选区、重叠或版本落后分别失败", () => {
    const content = v2([run("本研究采用方法甲。")]);
    const selection = select(content, 0, 5);
    expect(outcome(evaluateNodeProtection(content, selection, [patch(content, 3, 7, "改用方法")], 1, 1)).failed).toContain("range");
    expect(
      outcome(evaluateNodeProtection(content, selection, [patch(content, 0, 3, "该研究", "a"), patch(content, 2, 4, "究使", "b")], 1, 1)).failed,
    ).toContain("overlap");
    expect(outcome(evaluateNodeProtection(content, selection, [patch(content, 3, 5, "使用")], 1, 2)).failed).toEqual(["version"]);
  });

  it("结构版本不一致时明确拒绝", () => {
    const content = v2([run("文字")]);
    expect(() => resolveContentSelection(content, { textblock_path: [0], from: 1, to: 3, text: "文字" })).toThrow(
      expect.objectContaining({ code: "DOCMODEL_ANCHOR_SCHEMA_MISMATCH" }),
    );
    expect(() =>
      resolveContentSelection({ schema_version: 1, json: { type: "doc", content: [{ type: "paragraph" }] } } as DocumentContent, {
        node_id: "p",
        start: 0,
        end: 1,
        expected_text: "文",
      }),
    ).toThrow(expect.objectContaining({ code: "DOCMODEL_ANCHOR_SCHEMA_MISMATCH" }));
  });
});

describe("v2 内容候选 Mock 服务（与服务端同契约）", () => {
  async function setup() {
    const api = createServices({ mode: "mock", instanceId: `rev-v2-${crypto.randomUUID()}` });
    const projectId = (await api.projects.create({ name: "v2 候选样例" })).id;
    const legacy = await api.documents.import(projectId, {
      content: {
        schema_version: 1,
        json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "本研究采用方法甲，样本为30个。" }] }] },
      },
    });
    const upgraded = await api.documents.upgradeSchema(projectId, legacy.id, { command_id: crypto.randomUUID(), expected_version: 1 });
    const document = upgraded.document;
    const node = (document.content as DocsDocumentContent).json.model.sections[0]!.blocks[0]! as unknown as { id: string };
    return { api, projectId, document, node: node.id };
  }

  it("生成、审阅、采纳生成新 v2 版本，撤销恢复原文；重复命令幂等", async () => {
    const { api, projectId, document, node } = await setup();
    const selection = { node_id: node, start: 0, end: 8, expected_text: "本研究采用方法甲" };
    const create = { command_id: crypto.randomUUID(), base_version: document.version, selection, goal: "润色" };
    const created = await api.revisions.create(projectId, document.id, create);
    await expect(api.revisions.create(projectId, document.id, create)).resolves.toEqual(created);
    let candidate = await api.revisions.get(projectId, document.id, created.candidate_id!);
    expect(candidate).toMatchObject({ content_schema_version: 2, policy_version: REVISION_POLICY_V2, status: "generating" });
    await api.revisions.propose(projectId, document.id, candidate.id, {
      command_id: crypto.randomUUID(),
      generation_token: candidate.generation_token!,
      patches: [{ id: "p1", start: 3, end: 5, before: "采用", after: "使用" }],
    });
    candidate = await api.revisions.get(projectId, document.id, candidate.id);
    expect(candidate.status).toBe("ready");
    expect(candidate.checks.every((check) => check.result === "pass")).toBe(true);
    await api.revisions.decide(projectId, document.id, candidate.id, {
      command_id: crypto.randomUUID(),
      expected_revision: candidate.revision,
      decisions: [{ patch_id: "p1", decision: "accepted" }],
    });
    candidate = await api.revisions.get(projectId, document.id, candidate.id);
    const apply = { command_id: crypto.randomUUID(), expected_revision: candidate.revision, expected_document_version: document.version };
    const applied = await api.revisions.apply(projectId, document.id, candidate.id, apply);
    expect(applied.result_version).toBe(document.version + 1);
    await expect(api.revisions.apply(projectId, document.id, candidate.id, apply)).resolves.toEqual(applied);
    const current = await api.documents.current(projectId);
    expect(current.content.schema_version).toBe(2);
    expect(nodeText(current.content, node)).toBe("本研究使用方法甲，样本为30个。");
    await expect(api.revisions.apply(projectId, document.id, candidate.id, { ...apply, command_id: crypto.randomUUID() })).rejects.toMatchObject({
      code: "REVISION_REVIEW_CONFLICT",
    });
    await api.revisions.undo(projectId, document.id, applied.command_id, { command_id: crypto.randomUUID(), expected_document_version: current.version });
    expect(nodeText((await api.documents.current(projectId)).content, node)).toBe("本研究采用方法甲，样本为30个。");
  });

  it("保护失败不能接受；旧版本候选过期；v1 形状补丁不接收", async () => {
    const { api, projectId, document, node } = await setup();
    const selection = { node_id: node, start: 9, end: 15, expected_text: "样本为30个" };
    const created = await api.revisions.create(projectId, document.id, {
      command_id: crypto.randomUUID(),
      base_version: document.version,
      selection,
      goal: "改",
    });
    const candidate = await api.revisions.get(projectId, document.id, created.candidate_id!);
    await expect(
      api.revisions.propose(projectId, document.id, candidate.id, {
        command_id: crypto.randomUUID(),
        generation_token: candidate.generation_token!,
        patches: [{ id: "x", from: 10, to: 16, before: "样本为30个", after: "样本为31个" }],
      }),
    ).rejects.toMatchObject({ code: "REVISION_PATCH_INVALID" });
    await api.revisions.propose(projectId, document.id, candidate.id, {
      command_id: crypto.randomUUID(),
      generation_token: candidate.generation_token!,
      patches: [{ id: "p1", start: 12, end: 14, before: "30", after: "31" }],
    });
    const invalid = await api.revisions.get(projectId, document.id, candidate.id);
    expect(invalid.status).toBe("invalid");
    expect(invalid.checks.find((check) => check.rule === "number")).toMatchObject({ result: "fail", patch_id: "p1", start: 12, end: 14 });
    await expect(
      api.revisions.decide(projectId, document.id, candidate.id, {
        command_id: crypto.randomUUID(),
        expected_revision: invalid.revision,
        decisions: [{ patch_id: "p1", decision: "accepted" }],
      }),
    ).rejects.toMatchObject({ code: "REVISION_PROTECTION_FAILED" });
  });
});
