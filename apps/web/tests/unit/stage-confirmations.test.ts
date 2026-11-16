import { describe, expect, it } from "vite-plus/test";
import { createServices, type ProjectRead, type StageConfirm } from "../../src/services/index.ts";
import type { FlowCreate } from "../../src/services/contracts/api.generated.ts";
import { createHttpStageConfirmations } from "../../src/services/httpStageConfirmations.ts";
import { thesisWordCount } from "../../src/lab/services/libraryService.ts";
import { manuscriptCharacters, nextTasks, stageClock, loadDecisions } from "../../src/workspace/today/todayFacts.ts";

const command = () => crypto.randomUUID();
const text = "合成开题报告正文 42。";
const content = { schema_version: 1 as const, json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } };
const flow: FlowCreate = {
  name: "合成流程",
  stages: [
    { id: "proposal", name: "开题", deliverables: ["开题报告", "文献清单"], conditions: ["学生核对研究范围"], start: "2026-11-01", deadline: "2026-11-30" },
    { id: "writing", name: "写作", deliverables: ["论文初稿"], conditions: ["学生核对初稿"], dependencies: ["proposal"] },
    { id: "survey", name: "调研", deliverables: ["调研记录"], conditions: ["学生核对"], dependencies: ["proposal"] },
  ],
};

async function fixture() {
  const api = createServices({ mode: "mock", instanceId: "stage-test" });
  const created = await api.projectFlows.create(flow);
  const project = await api.projects.create({ name: "合成项目", deadline: "2026-12-31", flow_version_id: created.current_version_id, stage_id: "proposal" });
  const document = await api.documents.import(project.id, { content });
  const evidence = [{ kind: "document" as const, document_id: document.id, version: 1, selection: { textblock_path: [0], from: 1, to: 3, text: "合成" } }];
  const task = await api.tasks.create(project.id, {
    command_id: command(),
    expected_board_version: 0,
    content: { title: "完成开题报告", acceptance: "可复核", evidence },
  });
  const confirmed = await api.tasks.decide(project.id, task.id, { command_id: command(), expected_version: 1, action: "confirm" });
  return { api, flow: created, project, document, task: confirmed };
}
const confirmInput = (project: ProjectRead, values: Partial<StageConfirm> = {}): StageConfirm => ({
  command_id: command(),
  expected_project_version: project.version,
  flow_version_id: project.flow_version_id!,
  stage_id: project.stage_id!,
  document_version: 1,
  note: "已核对开题报告 v1",
  next_stage_id: "writing",
  ...values,
});

describe("阶段完成确认同契约", () => {
  it("任务与资料只作为只读事实，阶段需学生确认后才推进", async () => {
    const { api, project, task } = await fixture();
    const progress = await api.stageConfirmations.progress(project.id);
    expect(progress.binding).toBe("ready");
    expect(progress.current?.confirmed).toBe(false);
    expect(progress.current?.deliverables[0]).toMatchObject({ name: "开题报告", status: "confirmed_task", task_ids: [task.id] });
    expect(progress.current?.next_stages.map((item) => item.id)).toEqual(["writing", "survey"]);
    expect(progress.evidence_candidates).toEqual([{ task_id: task.id, version: task.version, title: "完成开题报告" }]);
    expect(progress.stages.map((item) => item.state)).toEqual(["current", "upcoming", "upcoming"]);
    expect((await api.stageConfirmations.history(project.id)).total).toBe(0);
  });

  it("确认与项目阶段同步 CAS；重复点击重放同一结果，旧版本被拒", async () => {
    const { api, project, task } = await fixture();
    const input = confirmInput(project, { evidence: [{ task_id: task.id, version: task.version }] });
    const [first, replay] = await Promise.all([api.stageConfirmations.confirm(project.id, input), api.stageConfirmations.confirm(project.id, input)]);
    expect(replay).toEqual(first);
    expect(first.project).toMatchObject({ stage_id: "writing", version: project.version + 1 });
    expect(first.confirmation).toMatchObject({ kind: "confirm", stage_name: "开题", resulting_stage_name: "写作", document_version: 1 });
    expect((await api.projects.get(project.id)).stage_id).toBe("writing");
    await expect(api.stageConfirmations.confirm(project.id, confirmInput(project))).rejects.toMatchObject({ code: "STAGE_VERSION_CONFLICT" });
    await expect(api.stageConfirmations.confirm(project.id, { ...input, note: "不同" })).rejects.toMatchObject({ code: "STAGE_COMMAND_CONFLICT" });
    const progress = await api.stageConfirmations.progress(project.id);
    expect(progress.stages.map((item) => item.state)).toEqual(["confirmed", "current", "upcoming"]);
    expect(progress.revocable_id).toBe(first.confirmation.id);
    expect(progress.current?.entered_at).toBe(first.confirmation.created_at);
  });

  it("前置、下一阶段、正文与依据版本均由服务端复验", async () => {
    const { api, project, task } = await fixture();
    for (const [values, code] of [
      [{ next_stage_id: null }, "STAGE_NEXT_INVALID"],
      [{ document_version: 2 }, "STAGE_DOCUMENT_STALE"],
      [{ stage_id: "writing", next_stage_id: null }, "STAGE_NOT_CURRENT"],
      [{ evidence: [{ task_id: task.id, version: task.version + 1 }] }, "STAGE_EVIDENCE_STALE"],
    ] as const)
      await expect(api.stageConfirmations.confirm(project.id, confirmInput(project, values as Partial<StageConfirm>))).rejects.toMatchObject({ code });
    await expect(api.stageConfirmations.confirm(project.id, confirmInput(project, { note: "  " }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const skipped = await api.projects.create({ name: "跳过开题", flow_version_id: project.flow_version_id, stage_id: "writing" });
    const view = await api.stageConfirmations.progress(skipped.id);
    expect(view.current?.prerequisites).toEqual([{ stage_id: "proposal", name: "开题", confirmed: false }]);
    await expect(api.stageConfirmations.confirm(skipped.id, confirmInput(skipped, { document_version: null, next_stage_id: null }))).rejects.toMatchObject({
      code: "STAGE_PREREQUISITE_UNCONFIRMED",
    });
    expect((await api.projects.get(project.id)).version).toBe(project.version);
  });

  it("撤销最近一次确认只追加记录并恢复前一阶段", async () => {
    const { api, project } = await fixture();
    const first = await api.stageConfirmations.confirm(project.id, confirmInput(project));
    const revoked = await api.stageConfirmations.revoke(project.id, first.confirmation.id, {
      command_id: command(),
      expected_project_version: first.project.version,
      note: "",
    });
    expect(revoked.project.stage_id).toBe("proposal");
    expect(revoked.confirmation).toMatchObject({ kind: "revoke", revokes_id: first.confirmation.id });
    await expect(
      api.stageConfirmations.revoke(project.id, first.confirmation.id, { command_id: command(), expected_project_version: revoked.project.version, note: "" }),
    ).rejects.toMatchObject({ code: "STAGE_REVOKE_CONFLICT" });
    const history = await api.stageConfirmations.history(project.id);
    expect(history.items.map((item) => [item.kind, item.revoked_by_id])).toEqual([
      ["revoke", null],
      ["confirm", revoked.confirmation.id],
    ]);
    const other = await api.projects.create({ name: "其他项目" });
    await expect(
      api.stageConfirmations.revoke(other.id, first.confirmation.id, { command_id: command(), expected_project_version: 1, note: "" }),
    ).rejects.toMatchObject({ code: "STAGE_CONFIRMATION_NOT_FOUND" });
  });

  it("HTTP 适配校验路径、规范化输入并拒绝跨项目响应", async () => {
    const calls: { path: string; method?: string; body?: unknown }[] = [];
    const project = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    let response: unknown;
    const service = createHttpStageConfirmations((async (path: string, _schema: string, method?: string, body?: unknown) => {
      calls.push({ path, method, body });
      return response;
    }) as never);
    response = { project_id: crypto.randomUUID() };
    await expect(service.progress(project)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    response = { confirmation: { project_id: project.toLowerCase() }, project: { id: project.toLowerCase() } };
    await service.confirm(project, {
      command_id: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
      expected_project_version: 1,
      flow_version_id: "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC",
      stage_id: " proposal ",
      note: "说明",
    });
    expect(calls.at(-1)).toMatchObject({
      path: `/projects/${project}/stage-confirmations`,
      method: "POST",
      body: { command_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", stage_id: "proposal", evidence: [], document_version: null, next_stage_id: null },
    });
    await expect(
      service.confirm(project, {
        command_id: command(),
        expected_project_version: 1,
        flow_version_id: command(),
        stage_id: "a",
        note: "说明",
        next_stage_id: "a",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    response = { confirmation: { project_id: project.toLowerCase(), revokes_id: crypto.randomUUID() }, project: { id: project.toLowerCase() } };
    await expect(service.revoke(project, command(), { command_id: command(), expected_project_version: 2, note: "" })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});

describe("今日页派生事实", () => {
  it("字数与写作页口径一致，标题、表格与参考文献后不计", () => {
    const doc = {
      schema_version: 1 as const,
      json: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1, chapterId: "c1" }, content: [{ type: "text", text: "第一章 绪论" }] },
          { type: "paragraph", content: [{ type: "text", text: "正文 一二 三。" }, { type: "hardBreak" }, { type: "text", text: "四" }] },
          {
            type: "table",
            content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "表格" }] }] }] }],
          },
          { type: "heading", attrs: { level: 1, chapterId: "c2" }, content: [{ type: "text", text: "参考文献" }] },
          { type: "paragraph", content: [{ type: "text", text: "文献甲" }] },
        ],
      },
    };
    const html = "<h1>第一章 绪论</h1><p>正文 一二 三。<br>四</p><table><tr><td><p>表格</p></td></tr></table><h1>参考文献</h1><p>文献甲</p>";
    expect(manuscriptCharacters(doc as never)).toBe(thesisWordCount(html));
    expect(manuscriptCharacters(doc as never)).toBe(7);
  });

  it("阶段时间只来自进入记录或配置起止日期，缺失即未知", () => {
    const now = new Date("2026-11-11T04:00:00Z");
    expect(stageClock(null, null, null, now)).toMatchObject({ known: false, percent: null });
    expect(stageClock(null, "2026-11-01", "2026-11-21", now)).toMatchObject({ known: true, days: 10, percent: 50, since: "2026-11-01" });
    expect(stageClock("2026-11-09T18:00:00Z", "2026-11-01", null, now)).toMatchObject({ days: 1, percent: null, since: "2026-11-10" });
  });

  it("接下来只列未确认、未归档任务并按截止排序", () => {
    const base = { project_id: "p", version: 1, needs_review: false, review_reasons: [], updated_at: "" };
    const items = [
      { ...base, id: "a", position: 0, title: "无期限", status: "todo", archived: false, due_date: null },
      { ...base, id: "b", position: 1, title: "已确认", status: "confirmed", archived: false, due_date: "2026-11-01" },
      { ...base, id: "c", position: 2, title: "较晚", status: "doing", archived: false, due_date: "2026-12-01" },
      { ...base, id: "d", position: 3, title: "归档", status: "todo", archived: true, due_date: "2026-10-01" },
      { ...base, id: "e", position: 4, title: "较早", status: "verify", archived: false, due_date: "2026-11-20" },
    ] as never[];
    expect(nextTasks(items).map((item: { id: string }) => item.id)).toEqual(["e", "c", "a"]);
  });

  it("等你决定只统计真实接口中的待处理对象", async () => {
    const { api, project, document } = await fixture();
    const batch = await api.feedback.create(project.id, { command_id: command(), original_text: "请补充实验数据。" });
    const item = await api.feedback.createItem(project.id, batch.id, {
      command_id: command(),
      content: { source_range: { from: 0, to: 4, text: "请补充实" }, interpretation: "补实验", certainty: "certain", source_checked: true },
    });
    const result = await loadDecisions(api, project.id, document.id, new AbortController().signal);
    expect(result.map((entry) => [entry.kind, entry.count, entry.error])).toEqual([
      ["revision", 0, ""],
      ["format", 0, ""],
      ["feedback", 1, ""],
    ]);
    expect(result[2]!.target).toEqual({ batch: batch.id, item: item.id });
    const none = await loadDecisions(api, project.id, null, new AbortController().signal);
    expect(none[0]).toMatchObject({ count: 0, error: "" });
  });
});
