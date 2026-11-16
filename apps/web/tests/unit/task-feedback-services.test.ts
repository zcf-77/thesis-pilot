import { describe, expect, it } from "vite-plus/test";
import { createServices, type TaskContent, type FeedbackContent } from "../../src/services/index.ts";

const text = "Synthetic evidence 42.";
const content = { schema_version: 1 as const, json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } };
const command = () => crypto.randomUUID();
async function fixture() {
  const api = createServices({ mode: "mock", instanceId: "task-feedback-test" });
  const project = await api.projects.create({ name: "合成任务项目", deadline: "2026-12-31" });
  const document = await api.documents.import(project.id, { content });
  const evidence = [
    { kind: "document" as const, document_id: document.id, version: 1, selection: { textblock_path: [0], from: 1, to: text.length + 1, text } },
  ];
  const task: TaskContent = { title: "人工任务", acceptance: "核对选区与版本", evidence };
  return { api, p: project.id, document, task, evidence };
}
describe("SG09A人工任务与反馈同契约", () => {
  it("并发创建按看板CAS仅允许一条；幂等重放不重复写入且跨项目不能读取", async () => {
    const { api, p, task } = await fixture();
    const input = { command_id: command(), expected_board_version: 0, content: task };
    const [first, replay] = await Promise.all([api.tasks.create(p, input), api.tasks.create(p, input)]);
    expect(replay).toEqual(first);
    await expect(api.tasks.create(p, { ...input, command_id: command() })).rejects.toMatchObject({ code: "TASK_BOARD_CONFLICT" });
    const other = await api.projects.create({ name: "另一个合成项目" });
    await expect(api.tasks.get(other.id, first.id)).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
    expect((await api.tasks.list(p)).total).toBe(1);
    await expect(api.tasks.create(other.id, { ...input, expected_board_version: 0 })).rejects.toMatchObject({ code: "TASK_COMMAND_CONFLICT" });
  });
  it("循环依赖与越期写入被拒；排序版本和不可变历史保留", async () => {
    const { api, p, task } = await fixture();
    const a = await api.tasks.create(p, { command_id: command(), expected_board_version: 0, content: task });
    const b = await api.tasks.create(p, { command_id: command(), expected_board_version: 1, content: { ...task, title: "依赖任务", depends_on: [a.id] } });
    await expect(api.tasks.update(p, a.id, { command_id: command(), expected_version: 1, content: { ...task, depends_on: [b.id] } })).rejects.toMatchObject({
      code: "TASK_DEPENDENCY_CYCLE",
    });
    await expect(api.tasks.update(p, a.id, { command_id: command(), expected_version: 1, content: { ...task, due_date: "2027-01-01" } })).rejects.toMatchObject(
      { code: "TASK_DEADLINE_CONFLICT" },
    );
    await api.tasks.reorder(p, { command_id: command(), expected_board_version: 2, task_ids: [b.id, a.id] });
    expect((await api.tasks.get(p, a.id)).version).toBe(2);
    expect((await api.tasks.versions(p, a.id)).items.map((v) => [v.version, v.action])).toEqual([
      [2, "reorder"],
      [1, "create"],
    ]);
    expect((await api.tasks.list(p)).items.map((t) => t.id)).toEqual([b.id, a.id]);
  });
  it("确认后正文变更令证据陈旧，返工理由与原确认历史保留", async () => {
    const { api, p, task, document } = await fixture();
    const a = await api.tasks.create(p, { command_id: command(), expected_board_version: 0, content: task });
    await api.tasks.decide(p, a.id, { command_id: command(), expected_version: 1, action: "confirm" });
    await api.documents.save(p, document.id, {
      expected_version: 1,
      content: { ...content, json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Changed evidence 42." }] }] } },
    });
    expect((await api.tasks.get(p, a.id)).needs_review).toBe(true);
    await expect(api.tasks.decide(p, a.id, { command_id: command(), expected_version: 2, action: "confirm" })).rejects.toMatchObject({
      code: "TASK_EVIDENCE_STALE",
    });
    await expect(api.tasks.decide(p, a.id, { command_id: command(), expected_version: 2, action: "rework", reason: " " })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const rework = await api.tasks.decide(p, a.id, { command_id: command(), expected_version: 2, action: "rework", reason: "正文版本已变化" });
    expect(rework.status).toBe("rework");
    expect((await api.tasks.versions(p, a.id)).items[0]).toMatchObject({ action: "rework", reason: "正文版本已变化" });
    expect((await api.tasks.versions(p, a.id)).items[1]!.snapshot.needs_review).toBe(false);
  });
  it("反馈UTF16精确定位、原文不可变，纠正及证据核对前不得学生已处理", async () => {
    const { api, p, evidence } = await fixture();
    const original = "😀请补证据。";
    const batch = await api.feedback.create(p, { command_id: command(), original_text: original });
    const data: FeedbackContent = {
      source_range: { from: 2, to: original.length, text: original.slice(2) },
      interpretation: "人工解释",
      certainty: "uncertain",
      source_checked: false,
      evidence,
    };
    await expect(
      api.feedback.createItem(p, batch.id, { command_id: command(), content: { ...data, source_range: { from: 1, to: 2, text: original.slice(1, 2) } } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      api.feedback.createItem(p, batch.id, { command_id: command(), content: { ...data, source_range: { from: 1, to: 2, text: "😀" } } }),
    ).rejects.toMatchObject({ code: "FEEDBACK_RANGE_INVALID" });
    const item = await api.feedback.createItem(p, batch.id, { command_id: command(), content: data });
    await expect(api.feedback.decide(p, item.id, { command_id: command(), expected_version: 1, action: "processed" })).rejects.toMatchObject({
      code: "FEEDBACK_REVIEW_REQUIRED",
    });
    const corrected = await api.feedback.updateItem(p, item.id, {
      command_id: command(),
      expected_version: 1,
      content: { ...data, source_checked: true, correction: "已人工核对原文含义" },
    });
    const processed = await api.feedback.decide(p, item.id, { command_id: command(), expected_version: corrected.version, action: "processed" });
    expect(processed.status).toBe("processed");
    expect(await api.feedback.get(p, batch.id)).toMatchObject({ original_text: original, item_count: 1 });
    expect((await api.feedback.versions(p, item.id)).items.map((v) => v.version)).toEqual([3, 2, 1]);
  });
  it("反馈新建任务为原子操作，失败不留下任务；陈旧证据不能再次标记处理", async () => {
    const { api, p, task, evidence, document } = await fixture();
    const batch = await api.feedback.create(p, { command_id: command(), original_text: "补证据" });
    const data: FeedbackContent = {
      source_range: { from: 0, to: 3, text: "补证据" },
      interpretation: "人工拆解",
      certainty: "certain",
      source_checked: true,
      evidence,
      new_task: task,
    };
    await expect(
      api.feedback.createItem(p, batch.id, { command_id: command(), content: { ...data, evidence: [{ ...evidence[0]!, version: 999 }] } }),
    ).rejects.toMatchObject({ code: "TASK_EVIDENCE_INVALID" });
    expect((await api.tasks.list(p)).total).toBe(0);
    const item = await api.feedback.createItem(p, batch.id, { command_id: command(), content: data });
    expect(item.content.task_id).toBeTruthy();
    expect(item.content.new_task).toBeNull();
    await api.documents.save(p, document.id, { expected_version: 1, content });
    await expect(api.feedback.decide(p, item.id, { command_id: command(), expected_version: 1, action: "processed" })).rejects.toMatchObject({
      code: "FEEDBACK_REVIEW_REQUIRED",
    });
  });
  it("HTTP拒绝跨项目响应与客户端伪造证据字段", async () => {
    const { api, p, task } = await fixture();
    const a = await api.tasks.create(p, { command_id: command(), expected_board_version: 0, content: task });
    const http = createServices({
      mode: "http",
      instanceId: "task-http",
      baseUrl: "/api/v1",
      fetch: async () => new Response(JSON.stringify({ ...a, project_id: crypto.randomUUID() }), { headers: { "Content-Type": "application/json" } }),
    });
    await expect(http.tasks.get(p, a.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(
      http.tasks.create(p, {
        command_id: command(),
        expected_board_version: 0,
        content: { ...task, evidence: [{ ...task.evidence![0]!, label: "伪造标签" }] },
      } as never),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
