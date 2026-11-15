import { describe, expect, it } from "vite-plus/test";
import type { Tone } from "../../src/design/tone.ts";
import { agents, candidateStatus, jobStatus, parseStatus, runStepStatus, taskStatus, verdict, type StatusWord } from "../../src/domain/vocab.ts";

const tones: Tone[] = ["neutral", "info", "success", "warning", "danger", "pencil", "seal", "ghost", "stale"];
const groups: Record<string, Record<string, StatusWord>> = { candidateStatus, taskStatus, jobStatus, runStepStatus, parseStatus, verdict };

describe("状态词汇表", () => {
  it("每个状态都有文案、合法语气与含义说明", () => {
    for (const [name, words] of Object.entries(groups)) {
      for (const [key, word] of Object.entries(words)) {
        expect(word.label.length, name + "." + key).toBeGreaterThan(0);
        expect(tones, name + "." + key).toContain(word.tone);
        // 含义说明要写清“意味着什么”，不能只是把状态名换个说法
        expect(word.means.length, name + "." + key).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("候选生命周期包含已撤销且保留其余状态", () => {
    expect(Object.keys(candidateStatus).sort()).toEqual(["adopted", "cancelled", "expired", "generating", "invalid", "pending", "rejected", "undone"]);
  });

  it("印章语气只用于学生的决定", () => {
    const sealed = Object.entries(groups).flatMap(([name, words]) =>
      Object.entries(words)
        .filter(([, w]) => w.tone === "seal")
        .map(([key]) => name + "." + key),
    );
    expect(sealed.sort()).toEqual(["candidateStatus.adopted", "taskStatus.confirmed"]);
  });

  it("铅笔语气只用于 AI 的提议", () => {
    const pencil = Object.entries(groups).flatMap(([name, words]) =>
      Object.entries(words)
        .filter(([, w]) => w.tone === "pencil")
        .map(([key]) => name + "." + key),
    );
    expect(pencil.sort()).toEqual(["candidateStatus.generating", "candidateStatus.pending", "verdict.advice"]);
  });

  it("未知类结论使用留白语气，不使用成功语气", () => {
    expect(verdict.unknown.tone).toBe("ghost");
    expect(verdict.nosource.tone).toBe("ghost");
    expect(candidateStatus.cancelled.tone).toBe("ghost");
    expect(candidateStatus.expired.tone).toBe("stale");
  });

  it("综合助手与五类专业助手齐全", () => {
    expect(Object.keys(agents).sort()).toEqual(["content", "format", "general", "lit", "progress", "review"]);
  });
});
