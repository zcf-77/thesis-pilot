import { describe, expect, it } from "vite-plus/test";
import {
  candidateNeedsReview,
  formatAssistantTime,
  isNearMessageBottom,
  messageScrollPositions,
  reconcileCandidateChoice,
  RUN_VIEW,
  runIsActive,
  scrollTopAfterEarlierMessages,
} from "../../src/workspace/assistant/assistantView.ts";
import { candidateHint, hunkSegments } from "../../src/workspace/writing-assistant/candidateReview.ts";

const candidate = (id: string, status: "ready" | "invalid" | "applied" = "ready", base = 3) => ({ id, status, base_version: base });

describe("助手产品界面状态与阅读连续性", () => {
  it("只把当前版本且待审阅的候选计入待处理，不把旧稿或未采纳生成混为可写结果", () => {
    expect(candidateNeedsReview(candidate("a"), 3)).toBe(true);
    expect(candidateNeedsReview(candidate("b", "invalid"), 3)).toBe(true);
    expect(candidateNeedsReview(candidate("old", "ready", 2), 3)).toBe(false);
    expect(candidateNeedsReview(candidate("done", "applied"), 3)).toBe(false);
  });

  it("后台新候选到达时保留当前审阅对象，当前对象消失才回退到最新项", () => {
    const items = [candidate("new"), candidate("current"), candidate("old")];
    expect(reconcileCandidateChoice("current", items)).toBe("current");
    expect(reconcileCandidateChoice("missing", items)).toBe("new");
    expect(reconcileCandidateChoice("", [])).toBe("");
  });

  it("运行状态只表达真实排队和执行，不提供伪造进度", () => {
    expect(Object.keys(RUN_VIEW)).toEqual(["queued", "running", "succeeded", "failed", "cancelled"]);
    expect(runIsActive({ status: "queued" })).toBe(true);
    expect(runIsActive({ status: "running" })).toBe(true);
    expect(runIsActive({ status: "failed" })).toBe(false);
    expect(runIsActive(undefined)).toBe(false);
  });

  it("在消息底部才跟随新回复，阅读旧消息时保留位置", () => {
    expect(isNearMessageBottom(168, 500, 300)).toBe(true);
    expect(isNearMessageBottom(100, 500, 300)).toBe(false);
  });

  it("加载更早消息按新增高度补偿，不把原阅读内容推出视口", () => {
    expect(scrollTopAfterEarlierMessages(20, 500, 740)).toBe(260);
    expect(scrollTopAfterEarlierMessages(0, 0, 200)).toBe(200);
  });

  it("滚动记忆按完整会话键隔离，不进入消息事实", () => {
    const keyA = JSON.stringify(["service-a", "writing", "project-a", "session-a"]);
    const keyB = JSON.stringify(["service-a", "writing", "project-a", "session-b"]);
    messageScrollPositions.set(keyA, 240);
    messageScrollPositions.set(keyB, 48);
    expect(messageScrollPositions.get(keyA)).toBe(240);
    expect(messageScrollPositions.get(keyB)).toBe(48);
    messageScrollPositions.delete(keyA);
    messageScrollPositions.delete(keyB);
  });

  it("采纳结果尚未载入时不显示误导性的陈旧提示，后续新版本才转入历史恢复", () => {
    expect(candidateHint({ status: "applied", result_version: 5 }, 4, true)).toBeNull();
    expect(candidateHint({ status: "applied", result_version: 5 }, 6, true)).toBe("moved");
    expect(candidateHint({ status: "ready", result_version: null }, 4, false)).toBe("ineligible");
  });

  it("候选差异按 Unicode 标量截取上下文，长消息中的字符不会从代理对中间断开", () => {
    const selection = { node_id: "node", start: 2, end: 8, expected_text: "甲😀乙丙丁戊己庚" };
    const patch = { id: "patch", start: 4, end: 5, before: "丙", after: "新" };
    const text = hunkSegments(selection, patch)
      .map((item) => item.text)
      .join("");
    expect(text).toContain("😀");
    expect(text).toContain("新");
    expect(text).not.toContain("\uFFFD");
  });

  it("无效时间不冒充真实时间", () => {
    expect(formatAssistantTime("not-a-time")).toBe("时间未知");
  });
});
