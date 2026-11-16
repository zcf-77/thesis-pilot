import { describe, expect, it } from "vite-plus/test";
import type { TaskRead, TaskSummary, TaskVersionRead } from "../../src/services/index.ts";
import {
  activeEvidence,
  archivedEvidence,
  boardProgress,
  evidenceKey,
  feedbackFor,
  filterTasks,
  isOverdue,
  mergeDetail,
  readAll,
  staleIds,
  stageViews,
  statusFor,
  successorsOf,
} from "../../src/workspace/tasks/taskBoard.ts";

const P = "00000000-0000-4000-8000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
function summary(n: number, patch: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: id(n),
    project_id: P,
    title: `任务${n}`,
    status: "todo",
    archived: false,
    due_date: null,
    needs_review: false,
    review_reasons: [],
    position: n,
    updated_at: "2026-11-18T00:00:00Z",
    version: 1,
    ...patch,
  };
}
const docEvidence = (version: number, from = 1) => ({
  kind: "document" as const,
  document_id: "00000000-0000-4000-8000-0000000002AA",
  version,
  selection: { textblock_path: [0], from, to: from + 4, text: "合成正文" },
});
function read(n: number, patch: Partial<TaskRead> = {}, content: Partial<TaskRead["content"]> = {}): TaskRead {
  return {
    id: id(n),
    project_id: P,
    version: 1,
    position: n,
    status: "todo",
    needs_review: false,
    review_reasons: [],
    evidence_snapshots: [],
    created_at: "2026-11-18T00:00:00Z",
    updated_at: "2026-11-18T00:00:00Z",
    content: { title: `任务${n}`, acceptance: "验收", ...content },
    ...patch,
  };
}

describe("正式计划页的确定性派生", () => {
  it("进度只计学生已确认且证据有效的未归档任务，需复核单独计数", () => {
    const items = [
      summary(1, { status: "confirmed" }),
      summary(2, { status: "confirmed", needs_review: true }),
      summary(3, { status: "verify" }),
      summary(4, { status: "confirmed", archived: true }),
    ];
    expect(boardProgress(items)).toEqual({ valid: 1, review: 1, total: 3 });
    expect(statusFor(items[1]!)).toEqual({ label: "已确认 · 需复核", tone: "warning" });
    expect(filterTasks(items, "open").map((item) => item.id)).toEqual([id(3)]);
    expect(filterTasks(items, "all")).toHaveLength(4);
  });

  it("已延期由预计完成日期计算，已确认或已归档不再标记", () => {
    expect(isOverdue(summary(1, { due_date: "2026-11-17" }), "2026-11-18")).toBe(true);
    expect(isOverdue(summary(1, { due_date: "2026-11-18" }), "2026-11-18")).toBe(false);
    expect(isOverdue(summary(1, { due_date: "2026-11-01", status: "confirmed" }), "2026-11-18")).toBe(false);
    expect(isOverdue(summary(1, { due_date: "2026-11-01", archived: true }), "2026-11-18")).toBe(false);
  });

  it("详情缓存按版本补读，迟到的旧版本不能覆盖新版本", () => {
    let cache = mergeDetail(new Map(), read(1, { version: 3 }));
    cache = mergeDetail(cache, read(1, { version: 2 }, { title: "旧" }));
    expect(cache.get(id(1))?.version).toBe(3);
    expect(staleIds([summary(1, { version: 3 }), summary(2)], cache)).toEqual([id(2)]);
  });

  it("后续任务由其他任务的依赖反查，依赖ID大小写不影响匹配", () => {
    const cache = new Map([
      [id(2), read(2, {}, { depends_on: [id(1).toUpperCase()] })],
      [id(3), read(3, {}, { depends_on: [] })],
    ]);
    const result = successorsOf(id(1), [summary(1), summary(2), summary(3)], cache);
    expect(result.tasks.map((item) => item.id)).toEqual([id(2)]);
    expect(result.complete).toBe(true);
    expect(successorsOf(id(1), [summary(1), summary(2, { version: 2 })], cache).complete).toBe(false);
  });

  it("限流读取单条失败不阻断其他条目，并发不超过上限", async () => {
    let running = 0;
    let peak = 0;
    const { results, failures } = await readAll(
      ["a", "b", "c", "d", "e"],
      async (value) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running--;
        if (value === "c") throw new Error("失败");
        return value;
      },
      new AbortController().signal,
      2,
    );
    expect(peak).toBeLessThanOrEqual(2);
    expect(results.sort()).toEqual(["a", "b", "d", "e"]);
    expect(failures).toEqual(["c"]);
  });

  it("当前证据取服务端快照标签与过期状态；已解除证据从版本历史去重恢复", () => {
    const current = docEvidence(3);
    const old = docEvidence(2);
    const task = read(
      1,
      { evidence_snapshots: [{ fingerprint: "f3", label: "正式稿 v3 · 合成正文", reference: current, stale: false }] },
      { evidence: [current] },
    );
    expect(activeEvidence(task)).toEqual([{ key: evidenceKey(current), reference: current, label: "正式稿 v3 · 合成正文", stale: false }]);
    const versions = [1, 2, 3].map((version): TaskVersionRead => ({
      version,
      action: "edit",
      reason: "",
      created_at: "2026-11-18T00:00:00Z",
      snapshot: read(1, {
        version,
        evidence_snapshots: [
          { fingerprint: `f${version}`, label: version === 3 ? "正式稿 v3" : "正式稿 v2", reference: version === 3 ? current : old, stale: false },
        ],
      }),
    }));
    const past = archivedEvidence(task, versions);
    expect(past).toHaveLength(1);
    expect(past[0]!.reference).toEqual(old);
    expect(evidenceKey({ ...old, document_id: old.document_id.toLowerCase() })).toBe(evidenceKey(old));
  });

  it("导师反馈回链按条目task_id匹配；阶段航线按绑定版本顺序且跳过停用阶段", () => {
    const feedback = [
      { id: "i1", batch_id: "b1", task_id: id(1).toUpperCase() },
      { id: "i2", batch_id: "b1", task_id: null },
    ] as never[];
    expect(feedbackFor(id(1), feedback)).toHaveLength(1);
    const stages = [
      { id: "s1", name: "开题", conditions: [], deliverables: [] },
      { id: "s2", name: "停用", conditions: [], deliverables: [], enabled: false },
      { id: "s3", name: "中期", conditions: [], deliverables: [], deadline: "2026-12-01" },
      { id: "s4", name: "答辩", conditions: [], deliverables: [] },
    ];
    expect(stageViews(stages, "s3").map((stage) => [stage.id, stage.state, stage.date])).toEqual([
      ["s1", "done", undefined],
      ["s3", "current", "12.01"],
      ["s4", "upcoming", undefined],
    ]);
    expect(stageViews(stages, "missing").every((stage) => stage.state === "upcoming")).toBe(true);
  });
});
