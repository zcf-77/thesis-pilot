import { describe, expect, it } from "vite-plus/test";
import { allChecksPass, textToHtml, validateTextPatches, validateCitationAppend, type GuardInput } from "../../src/lab/state/writingGuards.ts";

const original = "采用 1200 条记录，召回率 82.6% [1]。";
function input(overrides: Partial<GuardInput> = {}): GuardInput {
  return {
    baseVersion: 13,
    currentVersion: 13,
    selectionFrom: 1,
    selectionTo: original.length + 1,
    context: { from: 1, text: original },
    patches: [{ id: "h1", from: 1, to: original.length + 1, before: original, after: original.replace("采用", "使用") }],
    textAt: () => original,
    locked: () => false,
    ...overrides,
  };
}
describe("写作候选的确定性应用检查", () => {
  it("核实引用只能精确追加，普通润色仍拒绝新增数字引用", () => {
    const test = input();
    const appendix = "样例来源 [L-012]。";
    test.patches[0]!.after = `${original}\n${appendix}`;
    expect(allChecksPass(validateTextPatches(test))).toBe(false);
    expect(allChecksPass(validateCitationAppend(test, appendix, true))).toBe(true);
    expect(allChecksPass(validateCitationAppend(test, appendix, false))).toBe(false);
    test.patches[0]!.after = test.patches[0]!.after.replace("1200", "1300");
    expect(allChecksPass(validateCitationAppend(test, appendix, true))).toBe(false);
  });
  it("引用新增仍受旧版本、锁定和受保护对象边界约束", () => {
    const appendix = "来源 [L-012]";
    const test = input();
    test.patches[0]!.after = `${original}\n${appendix}`;
    expect(allChecksPass(validateCitationAppend({ ...test, currentVersion: 14 }, appendix, true))).toBe(false);
    expect(allChecksPass(validateCitationAppend({ ...test, locked: () => true }, appendix, true))).toBe(false);
    const split = input({
      selectionFrom: 1,
      selectionTo: 3,
      context: { from: 1, text: "1200" },
      textAt: () => "12",
      patches: [{ id: "x", from: 1, to: 3, before: "12", after: `12\n${appendix}` }],
    });
    expect(allChecksPass(validateCitationAppend(split, appendix, true))).toBe(false);
  });
  it("仅表达改变且数字引用保留时允许", () => expect(allChecksPass(validateTextPatches(input()))).toBe(true));
  it("拒绝旧版本、原文改变、越界及重叠片段", () => {
    for (const override of [{ currentVersion: 14 }, { textAt: () => "已编辑" }, { selectionTo: 2 }, { patches: [...input().patches, ...input().patches] }])
      expect(allChecksPass(validateTextPatches(input(override)))).toBe(false);
  });
  it("数字、引用的删除、替换和新增均拒绝", () => {
    for (const after of [original.replace("1200", "1300"), original.replace("[1]", "[2]"), original + " [3]", original.replace("82.6%", "")]) {
      const test = input();
      test.patches[0]!.after = after;
      expect(allChecksPass(validateTextPatches(test))).toBe(false);
    }
  });
  it("锁定、公式、未知复杂选区保守拒绝", () => {
    expect(allChecksPass(validateTextPatches(input({ locked: () => true })))).toBe(false);
    expect(allChecksPass(validateTextPatches(input({ unsupported: true })))).toBe(false);
    const test = input();
    test.patches[0]!.after += " x=y";
    expect(validateTextPatches(test).find((c) => c.id === "formula")?.result).toBe("unsupported");
    expect(allChecksPass(validateTextPatches(test))).toBe(false);
  });
  it("空采纳不改变正文", () => expect(allChecksPass(validateTextPatches(input({ patches: [] })))).toBe(false));
  it("科学计数法与全角数字保持字面保护", () => {
    for (const [before, after] of [
      ["1e3 条", "1 和 3 条"],
      ["１２３ 条", "123 条"],
    ]) {
      const checks = validateTextPatches(
        input({
          selectionTo: before!.length + 1,
          context: { from: 1, text: before! },
          textAt: () => before!,
          patches: [{ id: "h1", from: 1, to: before!.length + 1, before: before!, after: after! }],
        }),
      );
      expect(checks.find((c) => c.id === "number")?.result).toBe("fail");
    }
  });
  it("选区切开数字或引用对象时拒绝，不能只比较补丁内部", () => {
    for (const [context, before, after, kind] of [
      ["引用[1]", "]", "）", "citation"],
      ["引用[甲]", "甲", "乙", "citation"],
      ["1200", "20", "20万", "number"],
      ["82.6%", ".", "，", "number"],
    ] as const) {
      const offset = context.indexOf(before);
      const from = 1 + offset;
      const to = from + before.length;
      const checks = validateTextPatches(
        input({
          context: { from: 1, text: context },
          selectionFrom: from,
          selectionTo: to,
          patches: [{ id: "h1", from, to, before, after }],
          textAt: (a, b) => context.slice(a - 1, b - 1),
        }),
      );
      expect(checks.find((c) => c.id === kind)?.result, context).toBe("fail");
      expect(allChecksPass(checks)).toBe(false);
    }
  });
  it("对最终组合重新校验，阻止普通文字删除将相邻数字合并", () => {
    const context = "12甲34乙56";
    const patches = [
      { id: "h1", from: 3, to: 4, before: "甲", after: "" },
      { id: "h2", from: 6, to: 7, before: "乙", after: "" },
    ];
    for (const accepted of [patches, [patches[0]!], [patches[1]!]]) {
      const checks = validateTextPatches(
        input({
          context: { from: 1, text: context },
          selectionFrom: 1,
          selectionTo: context.length + 1,
          patches: accepted,
          textAt: (a, b) => context.slice(a - 1, b - 1),
        }),
      );
      expect(checks.find((c) => c.id === "number")?.result).toBe("fail");
    }
  });
  it("公式在选区外但同文本块仍保守拒绝，不能通过只选变量绕过", () => {
    const context = "公式 x=y";
    const from = context.indexOf("x") + 1;
    const checks = validateTextPatches(
      input({
        context: { from: 1, text: context },
        selectionFrom: from,
        selectionTo: from + 1,
        patches: [{ id: "h1", from, to: from + 1, before: "x", after: "z" }],
        textAt: (a, b) => context.slice(a - 1, b - 1),
      }),
    );
    expect(checks.find((c) => c.id === "formula")?.result).toBe("unsupported");
  });
  it("合法局部表达修改保留文本块其它数字引用，无差异候选不采纳", () => {
    const context = "采用 1200 条 [1]。";
    const valid = input({
      context: { from: 1, text: context },
      selectionFrom: 1,
      selectionTo: 3,
      patches: [{ id: "h1", from: 1, to: 3, before: "采用", after: "使用" }],
      textAt: (a, b) => context.slice(a - 1, b - 1),
    });
    expect(allChecksPass(validateTextPatches(valid))).toBe(true);
    valid.patches[0]!.after = "采用";
    expect(allChecksPass(validateTextPatches(valid))).toBe(false);
  });
  it("纯文本导入转义字面HTML并保留行", () =>
    expect(textToHtml("<img src=x onerror=alert(1)>\n下一行")).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p><p>下一行</p>"));
});
