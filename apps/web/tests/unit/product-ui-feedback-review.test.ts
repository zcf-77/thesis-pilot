import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parse } from "vue/compiler-sfc";
import type { ReviewIssue, ReviewReportRead } from "../../src/services/contracts/api.generated.ts";
import { basisLabel, locationLabel, matchesHistory, scoreDims, uncheckedItems } from "../../src/workspace/review/reviewView.ts";

const source = (path: string) => readFileSync(resolve("src/workspace", path), "utf8");
const template = (path: string) => parse(source(path), { filename: path }).descriptor.template?.content ?? "";

describe("W-E 反馈页产品路径与保护边界", () => {
  it("保留录入、真实拆解、取消重试、逐项决定、纠正、关联、处理撤销和历史", () => {
    const page = source("WorkspaceFeedback.vue");
    const split = source("feedback/FeedbackSplitPanel.vue");
    for (const capability of [
      "feedback.create(",
      "feedback.createItem(",
      "feedback.updateItem(",
      "feedback.decide(",
      "feedback.versions(",
      "rebaseEvidence",
      "decide('processed')",
      "decide('reopen')",
    ]) {
      expect(page).toContain(capability);
    }
    for (const capability of ["feedbackSplits.create(", "feedbackSplits.cancel(", "feedbackSplits.retry(", "feedbackSplits.decide("]) {
      expect(split).toContain(capability);
    }
    for (const action of ["采纳", "修改后采纳", "拒绝", "撤销采纳", "撤销拒绝", "建议决定记录"]) {
      expect(split).toContain(action);
    }
  });

  it("原文阅读态不重复摘录，技术范围进详情，学生印章只出现一次", () => {
    const page = template("WorkspaceFeedback.vue");
    const readingView = page.split('<div v-else key="view">')[1]?.split("</details>")[0] ?? "";
    expect(readingView).toContain("selected.content.interpretation");
    expect(readingView).not.toContain("selected.content.source_range.text");
    expect(readingView).toContain("解释详情");
    expect(readingView).toContain("UTF-16");
    expect(page.match(/<TpSeal\b/g)).toHaveLength(1);
    expect(page).toContain("这是你的处理声明，不代表导师已认可。");
    expect(template("feedback/FeedbackOriginal.vue")).toContain('tabindex="0"');
  });

  it("反馈与拆解的真实列表、详情和表单都接入共享过渡", () => {
    const page = source("WorkspaceFeedback.vue");
    const split = source("feedback/FeedbackSplitPanel.vue");
    for (const text of [page, split]) {
      expect(text).toContain('name="tp-swap"');
      expect(text).toContain('name="tp-list"');
      expect(text).toContain("listMotionHooks");
    }
    expect(page).toContain("panelMotionHooks");
    expect(split).toContain("panelMotionHooks");
  });
});

describe("W-E 评审页固定输入、报告与仅评审边界", () => {
  it("保留固定版本、真实任务、报告字段、历史、两种下载与任务追溯", () => {
    const page = source("review/WorkspaceReview.vue");
    for (const capability of [
      "document_version: document.value.version",
      "chapter_id: scope.value === WHOLE ? null : scope.value",
      "rubric_version: rubric.value",
      "agent_config_version_id: agent.value",
      "reviews.create(",
      "reviews.cancel(",
      "reviews.retry(",
      "reviews.report(",
      "reviews.download(",
      "jobRoute(project.id, selected.job_id",
    ]) {
      expect(page).toContain(capability);
    }
    for (const content of ["report.content.issues", "scoreDims(report)", "uncheckedItems(report)", "report.content.limitations"]) {
      expect(page).toContain(content);
    }
    expect(page.match(/aria-label="评审执行状态"/g)).toHaveLength(1);
    expect(page).toContain("报告详情与执行追溯");
    expect(page).not.toContain("documents.save(");
    expect(page).not.toContain("revisions.create(");
  });

  it("报告、历史和问题筛选使用稳定 ID 与共享过渡", () => {
    const page = source("review/WorkspaceReview.vue");
    expect(page).toContain('class="screen-panel review-report"');
    expect(page).toContain("listMotionHooks");
    expect(page).toContain("panelMotionHooks");
    expect(page).toContain(':key="issue.id"');
    expect(page).toContain(':key="item.id"');
    expect(page).not.toContain("Review report ·");
    expect(page).not.toContain("在交稿之前");
  });
});

describe("评审报告展示事实", () => {
  const report = {
    content: {
      scores: [
        { dimension_id: "known", name: "论证", full: 20, score: 16, reason: "有段落依据" },
        { dimension_id: "unknown", name: "格式", full: 10, score: null, reason: "缺少模板" },
      ],
      unchecked: [{ item: "引用全文", reason: "未取得全文", origin: "system" }],
    },
  } as ReviewReportRead;

  it("空分不变成 0，未检查项保留原因", () => {
    expect(scoreDims(report).map((item) => item.score)).toEqual([16, null]);
    expect(scoreDims(report)[1]?.note).toBe("缺少模板");
    expect(uncheckedItems(report)).toEqual(["引用全文：未取得全文"]);
  });

  it("位置与依据不猜测，历史搜索覆盖范围、版本与状态", () => {
    const issue: ReviewIssue = {
      id: "issue",
      severity: "advice",
      title: "无法定位的问题",
      explanation: "缺少可核对片段",
      direction: "先补充位置",
      basis_status: "missing",
      location: { status: "unlocated", chapter_id: null, chapter_title: null, block_index: null, quote: null, start: null, end: null },
      basis: [],
    };
    expect(locationLabel(issue)).toBe("无法定位");
    expect(basisLabel(issue)).toBe("缺依据");
    const review = {
      scope_title: "第二章 方法",
      created_at: "2026-11-19T08:00:00Z",
      document_version: 7,
      status: "succeeded",
      agent_name: "评审助手",
    } as import("../../src/services/contracts/api.generated.ts").ReviewRead;
    expect(matchesHistory(review, "方法")).toBe(true);
    expect(matchesHistory(review, "v7")).toBe(true);
    expect(matchesHistory(review, "报告已生成")).toBe(true);
    expect(matchesHistory(review, "不存在")).toBe(false);
  });
});
