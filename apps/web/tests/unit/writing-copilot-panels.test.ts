import { describe, expect, it } from "vite-plus/test";
import type { FormatContext, FormatRead, RevisionRead } from "../../src/services/contracts/api.generated.ts";
import { candidateHighlights, candidateHint, CANDIDATE_GROUP, hunkSegments } from "../../src/workspace/writing-assistant/candidateReview.ts";
import { nodeSelectionOf, selectionUsable } from "../../src/workspace/writing-assistant/copilotPanel.ts";
import { formatHighlights, formatStatusView, FORMAT_GROUP } from "../../src/workspace/writing-format/formatPanel.ts";
import { formatValueLabel } from "../../src/workspace/formatting/formatPresentation.ts";
import { evidenceKey } from "../../src/workspace/tasks/taskBoard.ts";
import { evidenceLabel } from "../../src/workspace/tasks/taskFeedbackDraft.ts";

describe("任务证据：v2 节点选区", () => {
  it("证据键与标签按节点与标量偏移区分，旧路径证据仍可读", () => {
    const node = { kind: "document" as const, document_id: "D1", version: 4, selection: { node_id: "n1", start: 1, end: 3, expected_text: "研究" } };
    expect(evidenceKey(node)).toBe(JSON.stringify(["document", "d1", 4, "n1", 1, 3]));
    expect(evidenceKey({ ...node, selection: { ...node.selection, start: 2 } })).not.toBe(evidenceKey(node));
    expect(evidenceLabel(node)).toBe("正文 v4 · 段落 1–3 · 研究");
    expect(evidenceLabel({ ...node, selection: { textblock_path: [0], from: 2, to: 4, text: "研究" } })).toContain("路径 0");
  });
});

const candidate = (fields: Partial<RevisionRead> = {}): RevisionRead =>
  ({
    id: "c1",
    project_id: "p",
    document_id: "d",
    base_version: 3,
    document_version: 3,
    revision: 2,
    status: "ready",
    result_version: null,
    created_at: "2026-11-19T00:00:00Z",
    updated_at: "2026-11-19T00:00:00Z",
    content_schema_version: 2,
    selection: { node_id: "n1", start: 0, end: 10, expected_text: "本研究采用方法甲，样本" },
    goal: "润色",
    policy_version: "text-protection-v2",
    producer: "deterministic_preview",
    generation_token: null,
    patches: [
      { id: "a", start: 0, end: 3, before: "本研究", after: "该研究" },
      { id: "b", start: 3, end: 5, before: "采用", after: "使用" },
      { id: "c", start: 6, end: 8, before: "方法", after: "办法" },
    ],
    decisions: [
      { patch_id: "a", decision: "accepted" },
      { patch_id: "b", decision: "rejected" },
      { patch_id: "c", decision: "pending" },
    ],
    checks: [],
    applicable: true,
    application_command_id: null,
    ...fields,
  }) as RevisionRead;

describe("内容助手面板：选区与纸面差异", () => {
  it("纸面选区转为服务端节点选区；空白或空选区不可用", () => {
    expect(nodeSelectionOf({ node: "n1", start: 2, end: 4, text: "研究" })).toEqual({ node_id: "n1", start: 2, end: 4, expected_text: "研究" });
    expect(selectionUsable(null)).toBe(false);
    expect(selectionUsable({ node: "n1", start: 2, end: 2, text: "" })).toBe(false);
    expect(selectionUsable({ node: "n1", start: 2, end: 4, text: "  " })).toBe(false);
    expect(selectionUsable({ node: "n1", start: 2, end: 4, text: "研究" })).toBe(true);
  });

  it("已接受片段标为写入、待定片段铅笔标记、已拒绝片段不画；失败检查以批注色定位", () => {
    const highlights = candidateHighlights(
      candidate({ checks: [{ rule: "number", result: "fail", detail: "x", patch_id: "c", start: 6, end: 8, from: null, to: null }] }),
    );
    expect(highlights).toEqual([
      { id: "c1:a", group: CANDIDATE_GROUP, anchor: { node: "n1", start: 0, end: 3 }, tone: "insert" },
      { id: "c1:c", group: CANDIDATE_GROUP, anchor: { node: "n1", start: 6, end: 8 }, tone: "mark" },
      { id: "c1:check:number", group: CANDIDATE_GROUP, anchor: { node: "n1", start: 6, end: 8 }, tone: "comment" },
    ]);
  });

  it("片段差异附带选区内前后文，按标量切分不切开 emoji", () => {
    const selection = { node_id: "n", start: 2, end: 10, expected_text: "😀本研究采用方法" };
    expect(hunkSegments(selection, { id: "a", start: 6, end: 8, before: "采用", after: "使用" })).toEqual([
      { t: "eq", text: "😀本研究" },
      { t: "del", text: "采用" },
      { t: "ins", text: "使用" },
      { t: "eq", text: "方法" },
    ]);
    expect(hunkSegments(selection, { id: "b", start: 2, end: 3, before: "😀", after: "" })).toEqual([
      { t: "del", text: "😀" },
      { t: "eq", text: "本研究采用方法" },
    ]);
  });

  it("已结束或旧结构的候选不画差异", () => {
    expect(candidateHighlights(candidate({ status: "applied" }))).toEqual([]);
    expect(candidateHighlights(candidate({ status: "cancelled" }))).toEqual([]);
    expect(candidateHighlights(candidate({ selection: { textblock_path: [0], from: 1, to: 3, text: "本研" }, patches: [] }))).toEqual([]);
  });

  it("刚采纳、正文尚未载入采纳结果时不再叠加撤销或版本提示；之后至多一条说明", () => {
    const applied = candidate({ status: "applied", result_version: 5 });
    // 采纳回执已说明正在重新载入：载入前的“不是最新版本”“已有新版本”都不提示。
    expect(candidateHint(applied, 4, false)).toBeNull();
    expect(candidateHint(applied, 5, true)).toBeNull();
    expect(candidateHint(applied, 5, false)).toBe("ineligible");
    expect(candidateHint(applied, 6, false)).toBe("moved");
    expect(candidateHint(candidate({ status: "ready" }), 4, false)).toBe("ineligible");
    expect(candidateHint(candidate({ status: "ready" }), 4, true)).toBeNull();
    expect(candidateHint(candidate({ status: "undone", result_version: 6 }), 5, false)).toBeNull();
  });
});

describe("安全格式面板：受影响段落", () => {
  const context = {
    content_schema_version: 2,
    document_version: 5,
    binding_version_id: "b",
    binding_version: 1,
    template_parse_version_id: "t",
    requirement_parse_version_ids: [],
    source_guard_digest: "0".repeat(64),
    targets: [
      { anchor_id: "a1", node_id: "h1", editor_path: null, kind: "heading", title: "第一章", attrs: { level: 2 } },
      { anchor_id: "a2", node_id: "p1", editor_path: null, kind: "paragraph", title: "正文", attrs: { align: "start" } },
    ],
    rules: [{ id: "r1", parse_version_id: "t", anchor_id: "x", field: "level", value: 1, evidence: "标题层级：1", scope: "heading" }],
  } as FormatContext;
  const read = (fields: Partial<FormatRead> = {}) =>
    ({
      id: "f1",
      document_id: "d",
      project_id: "p",
      base_version: 5,
      document_version: 5,
      revision: 1,
      status: "ready",
      applicable: true,
      content_schema_version: 2,
      patches: [{ id: "format-1", anchor_id: "a1", node_id: "h1", editor_path: null, field: "level", before: 2, after: 1, rule_id: "r1", evidence: "e" }],
      decisions: [{ patch_id: "format-1", decision: "pending" }],
      application_command_id: null,
      created_at: "2026-11-19T00:00:00Z",
      updated_at: "2026-11-19T00:00:00Z",
      ...fields,
    }) as FormatRead;

  it("挑选范围时标出已选兼容目标；查看候选时标出涉及段落，接受后改为写入色", () => {
    expect(formatHighlights({ context, rule: context.rules[0], selected: ["a1", "a2"], version: 5 })).toEqual([
      { id: "target:h1", group: FORMAT_GROUP, anchor: { node: "h1" }, tone: "format" },
    ]);
    expect(formatHighlights({ context, selected: [], candidate: read(), version: 5 })).toEqual([
      { id: "patch:h1", group: FORMAT_GROUP, anchor: { node: "h1" }, tone: "format" },
    ]);
    expect(
      formatHighlights({ context, selected: [], candidate: read({ decisions: [{ patch_id: "format-1", decision: "accept" }] }), version: 5 })[0]?.tone,
    ).toBe("insert");
    expect(formatHighlights({ context, selected: [], candidate: read({ decisions: [{ patch_id: "format-1", decision: "reject" }] }), version: 5 })).toEqual([]);
    expect(formatHighlights({ context, selected: [], candidate: read(), version: 6 })).toEqual([]);
  });

  it("状态与内核对齐值的读法", () => {
    expect(formatStatusView(read(), 5).label).toBe("待审阅");
    expect(formatStatusView(read(), 6).label).toBe("已过期");
    expect(formatStatusView(read({ status: "applied" }), 6).label).toBe("已采纳");
    expect(formatValueLabel("alignment", "start")).toBe("左对齐");
    expect(formatValueLabel("templateAlign", "end")).toBe("右对齐");
  });
});
