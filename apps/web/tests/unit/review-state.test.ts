import { describe, expect, it } from "vite-plus/test";
import {
  buildPreviewReport,
  extractReviewScope,
  reviewSectionOptions,
  reviewReportHtml,
  validateReviewState,
  type ReviewInput,
  type ReviewState,
} from "../../src/lab/state/reviewState.ts";
import { captureBusinessConfig, createSettingsState } from "../../src/lab/state/settingsState.ts";

function input(): ReviewInput {
  return {
    projectId: "sample-project",
    title: "自制论文样例",
    docVersion: 13,
    templateVersion: 3,
    requirementVersion: 2,
    rubricVersion: 1,
    scope: "3.1 总体架构",
    html: "<h3>3.1 总体架构</h3><p>样例内容 [1]</p>",
    text: "3.1 总体架构 样例内容 [1]",
    headings: ["3.1 总体架构"],
  };
}

describe("仅评审的快照、导出与备份保护", () => {
  it("纯结构章节提取区分同名与空标题，按稳定ID保留正确边界", () => {
    const html =
      '<h2></h2><p>空标题内容</p><h2 data-chapter-id="first">同名章</h2><p>第一章</p><h3>子节</h3><p>子节内容</p><h2 data-chapter-id="second">同名章</h2><p>第二章</p><h2>末章</h2><p>末章内容</p>';
    const sections = reviewSectionOptions(html);
    expect(sections.find((item) => item.id === "second")?.label).toBe("同名章（第2处）");
    const second = extractReviewScope(html, "second");
    expect(second.text).toContain("第二章");
    expect(second.text).not.toContain("第一章");
    expect(second.text).not.toContain("末章内容");
    expect(extractReviewScope(html, "first").text).toContain("子节内容");
    expect(extractReviewScope(html, "不存在").text).toBe("");
  });
  it("评审配置及要求固定在报告，导出包含当次依据，损坏快照拒绝恢复", () => {
    const source = input();
    source.configSnapshot = captureBusinessConfig(createSettingsState(), "review").snapshot;
    source.requirementSnapshot = {
      version: 2,
      items: [
        {
          id: "rule",
          text: "字数要求",
          param: "≥ 12000",
          kind: "hard",
          sourceMaterialId: "material",
          sourceVersion: 1,
          verdict: "unknown",
          note: "资料尚不足",
        },
      ],
    };
    const report = buildPreviewReport(source);
    source.configSnapshot[0]!.version = 9;
    source.requirementSnapshot.items[0]!.text = "改变后的要求";
    expect(report.input.configSnapshot![0]!.version).toBe(1);
    expect(report.input.requirementSnapshot!.items[0]!.text).toBe("字数要求");
    expect(reviewReportHtml(report)).toContain("执行配置与固定依据");
    expect(reviewReportHtml(report)).toContain("字数要求");
    expect(report.unchecked).toContain("字数要求：资料尚不足");
    const state: ReviewState = { reports: [report], selectedId: report.id, run: null };
    expect(validateReviewState(state)).toBe(true);
    report.input.configSnapshot![0]!.content.keyRef = "private-key";
    expect(validateReviewState(state)).toBe(false);
  });
  it("生成报告复制输入，之后正文或标题变化不会追改报告", () => {
    const source = input();
    const report = buildPreviewReport(source);
    source.docVersion += 1;
    source.text = "后续修改";
    source.headings[0] = "新章节";
    expect(report.input.docVersion).toBe(13);
    expect(report.input.text).toContain("样例内容");
    expect(report.input.headings).toEqual(["3.1 总体架构"]);
    expect(report.dims.filter((d) => d.score === null)).toHaveLength(3);
  });

  it("导出转义用户文字，不把论文中的 HTML 作为可执行页面", () => {
    const source = input();
    source.title = '<img src=x onerror="alert(1)">';
    source.text = "<script>alert('input')</script>";
    const html = reviewReportHtml(buildPreviewReport(source));
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
  });

  it("损坏报告、无效选择及异常运行不能通过恢复校验", () => {
    const report = buildPreviewReport(input());
    const state: ReviewState = { reports: [report], selectedId: report.id, run: null };
    expect(validateReviewState(state)).toBe(true);
    expect(validateReviewState({ ...state, selectedId: "missing" })).toBe(false);
    expect(validateReviewState({ ...state, reports: [{ ...report, input: { ...report.input, docVersion: -1 } }] })).toBe(false);
    expect(validateReviewState({ ...state, reports: [{ ...report, dims: [{ id: "a", name: "a", score: 100, full: 25 }] }] })).toBe(false);
    expect(validateReviewState({ ...state, run: { id: "bad", input: input(), status: "running", scenario: "normal", attempt: 0, diagnosis: "" } })).toBe(false);
  });

  it("部分完成保留可得检查结果，并明确未完成来源核验", () => {
    const report = buildPreviewReport(input(), true);
    expect(report.partial).toBe(true);
    expect(report.issues.map((i) => i.id)).not.toContain("citation");
    expect(report.unchecked).toContain("本次模拟来源不可用，引用扫描未完成");
  });
});
