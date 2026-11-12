import { describe, expect, it } from "vite-plus/test";
import {
  addLibraryVersion,
  boundLibraryRequirements,
  createLibraryState,
  currentLibraryVersion,
  snapshotLibraryRequirements,
  validateLibraryState,
  libraryRequirementResult,
  libraryLiteratureSnapshot,
  materialBusinessKind,
} from "../../src/lab/state/libraryState.ts";
import { extractLibraryRequirements, parseLibraryText, thesisWordCount, wordTarget, semanticLibraryPreview } from "../../src/lab/services/libraryService.ts";

describe("资料版本及要求来源保护", () => {
  it("纠正提取产生新版本，旧原件与旧文本保留", () => {
    const material = createLibraryState().materials[0]!;
    const before = structuredClone(currentLibraryVersion(material));
    addLibraryVersion(material, { extracted: "学生纠正的提取文本" }, "纠正");
    expect(material.versions[0]).toEqual(before);
    expect(currentLibraryVersion(material).extracted).toBe("学生纠正的提取文本");
    expect(currentLibraryVersion(material).dataUrl).toBe(before.dataUrl);
    expect(material.version).toBe(before.version + 1);
  });

  it("修改要求不改变旧绑定版本和原文", () => {
    const state = createLibraryState();
    const original = state.requirements[0]!.original;
    state.requirements[0]!.text = "新的解释";
    state.requirementsVersion += 1;
    snapshotLibraryRequirements(state);
    expect(boundLibraryRequirements(state, 2)[0]!.text).toBe(original);
    expect(boundLibraryRequirements(state, 3)[0]!.text).toBe("新的解释");
    expect(boundLibraryRequirements(state, 3)[0]!.original).toBe(original);
  });

  it("新项目没有继承样例私有资料或要求", () => {
    const state = createLibraryState(false);
    expect(state.materials).toEqual([]);
    expect(state.requirements).toEqual([]);
    expect(state.templateBinding).toBeNull();
    expect(state.requirementsVersion).toBe(0);
    expect(validateLibraryState(state)).toBe(true);
    expect(state.literature.every((item) => item.sourceText.includes("自制样例库"))).toBe(true);
  });

  it("损坏资料状态被拒绝，不能恢复缺失版本或错误类型", () => {
    const good = createLibraryState();
    expect(validateLibraryState(good)).toBe(true);
    expect(validateLibraryState(null)).toBe(false);
    expect(validateLibraryState({ ...good, requirements: [null] })).toBe(false);
    expect(validateLibraryState({ ...good, materials: [{ ...good.materials[0], versions: [] }] })).toBe(false);
    expect(validateLibraryState({ ...good, literature: [{ ...good.literature[0], coverage: null }] })).toBe(false);
  });
});

describe("资料修复：来源、规则与可采纳上下文", () => {
  it("改分类显示名不改变模板业务类型", () => {
    const material = createLibraryState().materials.find((x) => x.id === "m2")!;
    material.category = "学校专属模板";
    expect(materialBusinessKind(material)).toBe("template");
    const original = structuredClone(currentLibraryVersion(material));
    addLibraryVersion(material, { templateItems: [{ name: "一级标题", value: "居左", support: "学生纠正" }] }, "新版本");
    expect(material.versions[0]).toEqual(original);
    addLibraryVersion(material, { ...original, templateItems: [{ name: "一级标题", value: "居中", support: "学生纠正" }] }, "纠正旧版");
    expect(currentLibraryVersion(material).version).toBe(5);
    expect(currentLibraryVersion(material).extracted).toBe(original.extracted);
  });

  it("模板结构逐项识别并保留未知与冲突来源", () => {
    const result = parseLibraryText("一级标题：三号黑体居中\n一级标题：四号黑体居左\n段落：首行缩进两字符", true);
    expect(result.templateItems.find((x) => x.name === "一级标题")?.state).toBe("conflict");
    expect(result.templateItems.find((x) => x.name === "一级标题")?.source).toBe("第1行、第2行");
    expect(result.templateItems.find((x) => x.name === "页边距")?.state).toBe("unknown");
    expect(result.fragments[2]).toEqual({ id: "line-3", line: 3, text: "段落：首行缩进两字符" });
  });

  it("规范逐条提取且由学生启用，原始来源不丢", () => {
    const state = createLibraryState();
    const items = extractLibraryRequirements(
      state.materials[0]!,
      2,
      "正文字数不少于 100 字。\n参考文献不少于 3 篇，近五年文献占比不低于三分之一。\n论证须有文献支撑。",
    );
    expect(items).toHaveLength(4);
    expect(items.map((x) => x.ruleType)).toEqual(["characters", "references", "recentReferences", "semantic"]);
    expect(items.every((x) => !x.enabled && x.sourceVersion === 2 && x.original === x.text)).toBe(true);
  });

  it("相同字数规则换ID仍执行，计数解码实体且排除非正文", () => {
    const state = createLibraryState();
    const rule = { ...state.requirements[0]!, id: "new-rule", param: "≥ 4" };
    const html = "<h1>标题不算</h1><p>A&amp;B&#x1f600;</p><table><tr><td>表格不算</td></tr></table><h2>参考文献</h2><p>也不算</p>";
    expect(thesisWordCount(html)).toBe(4);
    expect(libraryRequirementResult(rule, html, state).verdict).toBe("pass");
    expect(libraryRequirementResult({ ...rule, param: "≥ 5" }, html, state).verdict).toBe("fail");
  });

  it("来源缺失和版本不存在不能判为通过", () => {
    const state = createLibraryState();
    const rule = { ...state.requirements[0]!, param: "≥ 1" };
    expect(libraryRequirementResult({ ...rule, sourceMaterialId: "missing" }, "<p>足够文字</p>", state).verdict).toBe("nosource");
    expect(libraryRequirementResult({ ...rule, sourceVersion: 999 }, "<p>足够文字</p>", state).verdict).toBe("nosource");
  });

  it("互斥规则动态产生冲突，纠正或停用后解除", () => {
    const state = createLibraryState();
    const first = state.requirements[0]!;
    first.param = "≥ 100";
    const other = { ...first, id: "second", param: "≤ 50" };
    state.requirements.push(other);
    expect(libraryRequirementResult(first, "<p>正文</p>", state).verdict).toBe("conflict");
    expect(wordTarget(state.requirements).target).toBeNull();
    other.param = "≤ 200";
    expect(libraryRequirementResult(first, "<p>正文</p>", state).verdict).toBe("fail");
    expect(wordTarget(state.requirements).target).toBe(100);
  });

  it("参考文献篇数与近年比例来自实际参考文献章节", () => {
    const state = createLibraryState();
    const rule = { ...state.requirements[1]!, text: "参考文献不少于2篇", param: "≥ 2", scope: "参考文献", ruleType: "references" as const };
    expect(libraryRequirementResult(rule, "<p>引用[1][2]</p>", state).verdict).toBe("unknown");
    const html = `<h2>参考文献</h2><ol><li>自制条目甲 ${new Date().getFullYear()}</li><li>自制条目乙 2010</li></ol>`;
    expect(libraryRequirementResult(rule, html, state).verdict).toBe("pass");
    const recent = { ...rule, ruleType: "recentReferences" as const, text: "近五年占比", param: "≥ 1/3" };
    expect(libraryRequirementResult(recent, html, state).verdict).toBe("pass");
    expect(libraryRequirementResult(recent, html.replace("2010", "年份未知"), state).verdict).toBe("unknown");
  });

  it("语义预览保留正文依据，输入变化后须重新检查", () => {
    const state = createLibraryState();
    const rule = state.requirements.find((x) => x.kind === "semantic" && x.enabled)!;
    const html = "<p>实验结果来自自制数据，召回率为 82.6%，需要进一步比较基线。</p>";
    const preview = semanticLibraryPreview(rule, html);
    expect(preview.evidence[0]).toContain("82.6%");
    state.semanticChecks = { [rule.id]: { status: "done", inputVersion: 13, requirementVersion: rule.version, token: "t", ...preview } };
    expect(libraryRequirementResult(rule, html, state, 13).verdict).toBe("advice");
    expect(libraryRequirementResult(rule, html, state, 14).verdict).toBe("unknown");
    expect(semanticLibraryPreview(rule, "<p></p>").evidence).toEqual([]);
  });

  it("未核实文献不能生成上下文，快照与后续来源独立", () => {
    const state = createLibraryState();
    expect(libraryLiteratureSnapshot(state.literature.find((x) => x.verify !== "verified")!)).toBeNull();
    const source = state.literature[0]!;
    const snapshot = libraryLiteratureSnapshot(source)!;
    source.abstractText = "后来的内容";
    source.version = 2;
    expect(snapshot.version).toBe(1);
    expect(snapshot.text).not.toContain("后来的内容");
    expect(snapshot.coverage).not.toBe(source.coverage);
  });

  it("恢复拒绝非法快照、语义状态和模板操作", () => {
    const state = createLibraryState();
    state.contextSources = [libraryLiteratureSnapshot(state.literature[0]!)!];
    expect(validateLibraryState(state)).toBe(true);
    expect(validateLibraryState({ ...state, contextSources: [{ ...state.contextSources[0], verify: "unverified" }] })).toBe(false);
    expect(
      validateLibraryState({
        ...state,
        semanticChecks: { r: { status: "fake", inputVersion: 1, requirementVersion: 1, token: "t", explanation: "", evidence: [] } },
      }),
    ).toBe(false);
    expect(validateLibraryState({ ...state, formatRequest: { operation: "replace-all" } })).toBe(false);
  });
});
