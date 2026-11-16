import { describe, expect, it } from "vite-plus/test";
import { EditorState } from "@tiptap/pm/state";
import { canonicalEditorJson } from "../../src/lab/state/editorAdapter.ts";
import { editorSnapshotSchema } from "../../src/lab/state/editorSchema.ts";
import { sourceEditablePaths } from "../../src/workspace/document-import/importDraft.ts";
import { sourceDocumentEditAllowed, sourceGuardPlugin } from "../../src/workspace/document-import/sourceGuard.ts";
import { compatibleFormatTargets, formatCandidateCurrent, formatValueLabel } from "../../src/workspace/formatting/formatPresentation.ts";

describe("SG19 明确范围与候选状态", () => {
  const targets = [
    { anchor_id: "h", kind: "heading", title: "标题" },
    { anchor_id: "p", kind: "paragraph", title: "段落" },
  ];
  it("规则与目标必须类型兼容，不识别的字段或范围不产生目标", () => {
    expect(compatibleFormatTargets(targets)).toEqual([]);
    expect(compatibleFormatTargets(targets, { field: "alignment", scope: "paragraph" })).toEqual([targets[1]]);
    expect(compatibleFormatTargets(targets, { field: "templateAlign", scope: "heading" })).toEqual([targets[0]]);
    expect(compatibleFormatTargets(targets, { field: "alignment", scope: "all" })).toEqual([]);
    expect(compatibleFormatTargets(targets, { field: "text", scope: "paragraph" })).toEqual([]);
  });
  it("旧版本、依据过期、已采纳、未保存都禁止再次采纳", () => {
    const candidate = { base_version: 3, status: "ready", applicable: true };
    expect(formatCandidateCurrent(candidate, 3, true)).toBe(true);
    expect(formatCandidateCurrent(candidate, 4, true)).toBe(false);
    expect(formatCandidateCurrent({ ...candidate, applicable: false }, 3, true)).toBe(false);
    expect(formatCandidateCurrent({ ...candidate, status: "applied" }, 3, true)).toBe(false);
    expect(formatCandidateCurrent(candidate, 3, false)).toBe(false);
  });
  it("差异读出原始默认样式与具体建议", () => {
    expect(formatValueLabel("alignment", null)).toContain("未设置");
    expect(formatValueLabel("alignment", "justify")).toBe("两端对齐");
    expect(formatValueLabel("level", 2)).toBe("2 级标题");
  });
});

describe("SG19 编辑器来源格式保护", () => {
  const plain = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "样本 42 [1]" }] }] };
  const formatted = { type: "doc", content: [{ type: "paragraph", attrs: { alignment: "justify" }, content: [{ type: "text", text: "样本 42 [1]" }] }] };
  it("新段落默认null不改变旧canonical JSON", () => {
    const withNull = structuredClone(plain) as typeof plain & { content: { attrs?: { alignment: null } }[] };
    withNull.content[0]!.attrs = { alignment: null };
    expect(canonicalEditorJson(withNull)).toEqual(plain);
    expect(canonicalEditorJson(formatted)).toEqual(formatted);
    expect(editorSnapshotSchema.nodeFromJSON(formatted).firstChild?.attrs.alignment).toBe("justify");
  });
  it("来源v1保持兼容，v2拒绝缺少授权映射及非法结构/身份改动", () => {
    const v1 = { guard_contract: { schema_version: 1, guard_version: "source-projection-v1", editable_paths: [[0]] } };
    expect(sourceEditablePaths(v1)).toEqual([[0]]);
    const entry = { anchor_id: "p0", editor_path: [0], node_type: "paragraph", original_attrs: null, target_attrs: { alignment: "justify" } };
    const guard = { schema_version: 2, guard_version: "source-projection-v2", editable_paths: [[0]], format_overrides: [entry] };
    expect(sourceEditablePaths({ guard_contract: guard })).toEqual([[0]]);
    expect(sourceEditablePaths({ guard_contract: { ...guard, format_overrides: undefined } })).toBeUndefined();
    expect(sourceEditablePaths({ guard_contract: { ...guard, format_overrides: [{ ...entry, target_attrs: { chapterId: "forged" } }] } })).toBeUndefined();
    expect(sourceEditablePaths({ guard_contract: { ...guard, format_overrides: [entry, entry] } })).toBeUndefined();
  });
  it("新版授权格式可编辑文字，但普通事务仍不能修改格式或锁定对象", () => {
    const edited = structuredClone(formatted);
    edited.content[0]!.content[0]!.text = "样本 42 [1]，补充说明";
    expect(sourceDocumentEditAllowed(formatted, edited, [[0]])).toBe(true);
    expect(sourceDocumentEditAllowed(formatted, plain, [[0]])).toBe(false);
    const rejected: string[] = [];
    const guard = sourceGuardPlugin({
      getPolicy: () => ({ mode: "source", baseline: formatted, editablePaths: [[0]] }),
      bypass: () => false,
      onReject: (message) => rejected.push(message),
    });
    const state = EditorState.create({ doc: editorSnapshotSchema.nodeFromJSON(formatted), plugins: [guard] });
    const outcome = state.applyTransaction(state.tr.setNodeMarkup(0, undefined, { alignment: "left" }));
    expect(outcome.transactions).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    const locked = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "锁定", marks: [{ type: "aiLock" }] }] }] };
    expect(sourceDocumentEditAllowed(locked, locked, [[0]])).toBe(false);
  });
});
