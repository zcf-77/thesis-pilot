import { describe, expect, it } from "vite-plus/test";
import { splitFeedbackOriginal, validateFeedbackState } from "../../src/lab/state/feedbackState.ts";
import { analyzeFeedback, feedbackSections, locateFeedback } from "../../src/lab/services/feedbackService.ts";

describe("导师反馈原文边界", () => {
  it("整理后的范围逐字对应原文，保留空格、CRLF与字面HTML", () => {
    const original = "  说明数据来源。\r\n\r\n<img src=x>\n 保留  两个空格。 ";
    const parts = splitFeedbackOriginal(original);
    expect(parts.map((part) => part.text)).toEqual(["  说明数据来源。", "<img src=x>", " 保留  两个空格。 "]);
    for (const part of parts) expect(original.slice(part.start, part.end)).toBe(part.text);
  });
  it("过多段落明确拒绝，不悄悄截断", () => {
    const original = Array.from({ length: 51 }, (_, i) => `意见 ${i}`).join("\n");
    expect(() => splitFeedbackOriginal(original)).toThrow("超过 50");
    expect(original.split("\n")).toHaveLength(51);
  });
  it("损坏的反馈备份不能作为有效状态恢复", () => {
    const bad = { entries: [{ original: "已保留", segment: null }], nextPastedId: 1 };
    expect(validateFeedbackState(bad)).toBe(false);
    expect(validateFeedbackState({ entries: [], nextPastedId: 0 })).toBe(false);
    expect(validateFeedbackState({ entries: [], nextPastedId: 1 })).toBe(true);
  });
  it("备份中的原文范围、重复ID及分配计数器必须一致", () => {
    const entry = {
      id: "F-P01",
      batchId: "F-P01",
      status: "interpreted",
      source: "粘贴文字",
      title: "原文",
      summary: "待整理",
      original: "原文",
      date: "",
      locate: "",
      task: "",
      suggestion: "原文",
      excerpt: "",
      evidence: [],
      ambiguous: true,
      handled: false,
      verified: false,
      segment: { start: 0, end: 2, text: "原文" },
    };
    expect(validateFeedbackState({ entries: [entry], nextPastedId: 2 })).toBe(true);
    expect(validateFeedbackState({ entries: [entry, entry], nextPastedId: 2 })).toBe(false);
    expect(validateFeedbackState({ entries: [entry], nextPastedId: 1 })).toBe(false);
    expect(validateFeedbackState({ entries: [{ ...entry, segment: null }], nextPastedId: 2 })).toBe(false);
    expect(validateFeedbackState({ entries: [{ ...entry, segment: { start: 0, end: 2, text: "被改" } }], nextPastedId: 2 })).toBe(false);
  });
  it("一段多意见有可核对任务、验收及原文范围，模糊指代不猜定位", () => {
    const original = "请补充架构说明。实验至少两个基线。还有那个图不太行。";
    const sections = feedbackSections('<h2 id="architecture">3.1 总体架构</h2><p>已有架构正文。</p><h2>3.2 对比实验</h2><p>已有实验正文。</p>');
    const proposals = analyzeFeedback(original, sections);
    expect(proposals).toHaveLength(3);
    expect(proposals[0]!.task).toBe("补充架构说明");
    expect(proposals[0]!.locate).toBe("3.1 总体架构");
    expect(proposals[1]!.acceptance).toContain("两个基线");
    expect(proposals[2]!.ambiguous).toBe(true);
    expect(proposals[2]!.locate).toBe("");
    for (const { segment } of proposals) expect(original.slice(segment.start, segment.end)).toBe(segment.text);
    expect(locateFeedback("3.1 总体架构", sections)?.id).toBe("architecture");
    expect(locateFeedback("不存在的位置", sections)).toBeUndefined();
  });
  it("模拟拆解超过50条明确失败，旧分段及完整原文仍可用", () => {
    const original = "请核对。".repeat(51);
    expect(() => analyzeFeedback(original, [])).toThrow("超过 50");
    expect(original).toBe("请核对。".repeat(51));
  });
});
