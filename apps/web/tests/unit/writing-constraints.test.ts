import { describe, expect, it } from "vite-plus/test";
import { createLibraryState, libraryLiteratureSnapshot } from "../../src/lab/state/libraryState.ts";
import { captureWritingConstraints, writingConstraintAdvice, writingConstraintBasis } from "../../src/lab/services/writingConstraints.ts";
import { assistantPreview, citationSourcesCurrent } from "../../src/lab/services/writingAssistant.ts";
import type { WritingRequest, WritingSource } from "../../src/lab/state/writingState.ts";

const input = { requirementVersion: 2, templateVersion: 3, documentVersion: 13, html: "<h1>自制论文</h1><h2>系统设计</h2><p>已有正文。</p>" };
function request(): WritingRequest {
  return {
    id: "r1",
    projectId: "p1",
    agent: "general",
    prompt: "润色",
    version: 13,
    requirementVersion: 2,
    templateVersion: 3,
    chapter: "系统设计",
    selection: { from: 1, to: 6, text: "已有正文。", valid: true },
    sources: [],
    config: [],
    at: "测试",
    constraints: captureWritingConstraints(createLibraryState(true), input),
  };
}
describe("写作绑定规范与引用快照", () => {
  it("要求使用绑定旧集及原来源，判定不混入最新规则，模板不回退当前条目", () => {
    const library = createLibraryState(true);
    library.requirements[0]!.param = "≤ 1";
    library.requirements.push({ ...library.requirements[0]!, id: "new", param: "≥ 999999" });
    library.materials.find((item) => item.id === "m2")!.templateItems[0]!.value = "新未绑定模板项";
    const snapshot = captureWritingConstraints(library, input);
    const rule = snapshot.requirements.rules.find((item) => item.id === "R-003")!;
    expect(rule.param).toBe("≥ 12000");
    expect(rule.verdict).toBe("fail");
    expect(rule.verdictNote).toContain("当前 5");
    expect(rule.source).toMatchObject({ materialId: "m1", version: 2, original: "正文字数不少于 12000 字" });
    expect(snapshot.template.items[0]!.value).not.toBe("新未绑定模板项");
    library.requirementSets[0]!.items[0]!.param = "修改后";
    library.materials.find((item) => item.id === "m2")!.versions[0]!.templateItems![0]!.value = "修改后";
    expect(rule.param).toBe("≥ 12000");
    expect(snapshot.template.items[0]!.value).not.toBe("修改后");
  });
  it("未判定、冲突及停用来源原文完整保留，停用规则不进入助手执行建议", () => {
    const captured = request();
    expect(captured.constraints!.requirements.rules.find((item) => item.id === "R-006")!.verdict).toBe("conflict");
    expect(captured.constraints!.requirements.rules.find((item) => item.id === "R-021")!.verdict).toBe("unknown");
    expect(captured.constraints!.template.items.some((item) => item.state === "unknown")).toBe(true);
    const disabled = captured.constraints!.requirements.rules.find((item) => !item.enabled)!;
    expect(writingConstraintBasis(captured).join("\n")).toContain("已停用，不执行");
    expect(writingConstraintAdvice(captured, "general")).not.toContain(disabled.id);
    expect(writingConstraintAdvice(captured, "general")).toContain("先澄清冲突");
    expect(writingConstraintAdvice(captured, "format")).toContain("保留未判定");
  });
  it("综合与专业共同消费实际约束，当前规则通过也不冒充全文合规", () => {
    const captured = request();
    for (const agent of ["general", "content", "progress", "review"] as const) {
      const response = assistantPreview({ ...captured, agent });
      expect(response.text).toContain("12000");
      expect(response.text).toContain("不视为完成字数要求");
    }
    expect(assistantPreview({ ...captured, agent: "lit" }).text).toContain("参考文献不少于 15 篇");
    expect(assistantPreview({ ...captured, agent: "format" }).text).toContain("三号黑体");
    captured.constraints!.requirements.rules[0]!.verdict = "pass";
    expect(writingConstraintAdvice(captured, "content")).toContain("未覆盖全文学术与格式要求");
  });
  it("缺失和未绑定分别记录，不能用最新规则或模板填补", () => {
    const library = createLibraryState(true);
    const missing = captureWritingConstraints(library, { ...input, requirementVersion: 99, templateVersion: 99 });
    expect(missing.requirements).toMatchObject({ state: "missing", rules: [] });
    expect(missing.template).toMatchObject({ state: "missing", items: [] });
    const unbound = captureWritingConstraints(library, { ...input, requirementVersion: 0, templateVersion: 0 });
    expect(unbound.requirements.state).toBe("unbound");
    expect(unbound.template.state).toBe("unbound");
    const source = library.materials.find((item) => item.id === "m1")!;
    source.removed = true;
    expect(captureWritingConstraints(library, input).requirements.rules[0]!.verdict).toBe("nosource");
  });
  it("引用按资料服务完整组合快照比对，正文节选未改但题录或核验变化同样拒绝", () => {
    const library = createLibraryState(true);
    const literature = library.literature.find((item) => item.verify === "verified")!;
    const canonical = libraryLiteratureSnapshot(literature)!;
    const source: WritingSource = { ...canonical, coverage: "已取得摘要与全文节选" };
    expect(source.text).toContain(literature.sourceText);
    expect(source.text).toContain(literature.abstractText);
    expect(citationSourcesCurrent([source], [canonical])).toBe(true);
    expect(citationSourcesCurrent([source], [{ ...canonical, version: canonical.version + 1 }])).toBe(false);
    expect(citationSourcesCurrent([source], [{ ...canonical, verify: "unverified" }])).toBe(false);
    literature.sourceText += "更正题录";
    expect(citationSourcesCurrent([source], [libraryLiteratureSnapshot(literature)!])).toBe(false);
    expect(citationSourcesCurrent([source], [])).toBe(false);
  });
});
