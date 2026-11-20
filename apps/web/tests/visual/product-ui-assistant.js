import { createApp, defineComponent, h, ref } from "vue";
import TpDefs from "../../src/components/ui/TpDefs.vue";
import { provideThemeScope } from "../../src/design/theme.ts";
import WritingAssistantPanel from "../../src/workspace/writing-assistant/WritingAssistantPanel.vue";
import "../../src/design/styles/index.css";
import "../../src/lab/lab.css";
const clone = (value) => structuredClone(value);
const now = "2026-11-19T08:00:00.000Z";
const projectId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const sessionAId = "33333333-3333-4333-8333-333333333333";
const sessionBId = "44444444-4444-4444-8444-444444444444";
const runId = "55555555-5555-4555-8555-555555555555";
const candidateId = "66666666-6666-4666-8666-666666666666";
const jobId = "77777777-7777-4777-8777-777777777777";
const configId = "88888888-8888-4888-8888-888888888888";
const agentVersionId = "99999999-9999-4999-8999-999999999999";
const text = "本研究采用自制方法完成分析。实验数字 42 与引用[1]必须保持，原句需要更清晰地说明论证关系。";
const project = {
  id: projectId,
  name: "合成论文项目",
  title: "合成论文项目",
  archived: false,
  created_at: now,
  updated_at: now,
  deadline: null,
  existing_artifacts: "",
  flow_version_id: null,
  stage_id: null,
  plan_note: "",
  planning_mode: "none",
  version: 1,
};
const document = ref({ id: documentId, version: 3, snapshot: {} });
const selection = ref({ node: "paragraph-a", start: 0, end: Array.from(text).length, text });
const scenario = ref("ready");
const resetKey = ref(0);
const theme = ref("yingguang");
const motion = ref("full");
const counters = { apply: 0, undo: 0, cancel: 0, retry: 0, createRun: 0 };
let lastInput;
let sessions = [];
let messages = new Map();
let runs = [];
let candidates = [];
let contexts = new Map();
function baseCandidate() {
  return {
    id: candidateId,
    project_id: projectId,
    document_id: documentId,
    base_version: 3,
    document_version: 3,
    revision: 1,
    goal: "在不改变实验事实的前提下，使论证关系更清楚。",
    selection: { node_id: "paragraph-a", start: 0, end: Array.from(text).length, expected_text: text },
    patches: [
      { id: "patch-a", start: 0, end: 13, before: "本研究采用自制方法完成分析。", after: "本研究通过自制方法完成分析，并明确各步骤之间的关系。" },
      { id: "patch-b", start: 36, end: 44, before: "原句需要更清晰地说明论证关系。", after: "据此可更准确地理解结果。" },
    ],
    checks: ["version", "range", "number", "citation", "formula", "lock", "overlap", "structure"].map((rule) => ({
      rule,
      result: "pass",
      detail: rule === "number" ? "实验数字与单位保持不变。" : "检查符合当前保护策略。",
    })),
    decisions: [
      { patch_id: "patch-a", decision: "pending" },
      { patch_id: "patch-b", decision: "pending" },
    ],
    applicable: true,
    producer: "model_run",
    run_id: runId,
    application_command_id: null,
    result_version: null,
    generation_token: null,
    generation_error_code: null,
    policy_version: "visual-fixture",
    content_schema_version: 2,
    status: "ready",
    created_at: now,
    updated_at: now,
  };
}
function makeMessages(sessionId) {
  if (sessionId === sessionBId) return [];
  return Array.from({ length: 25 }, (_, index) => ({
    id: `${String(index + 1).padStart(4, "0")}-0000-4000-8000-000000000000`,
    session_id: sessionId,
    run_id: index === 24 ? runId : null,
    seq: index + 1,
    role: index % 2 === 0 ? "user" : "assistant",
    content:
      index === 24
        ? "我保留实验数字、引用与锁定句，并把修改整理为两个候选片段。第一段补充步骤关系，第二段收束论证。你可以逐项接受或拒绝；只有点击采纳后才会写入正式正文。此回复为浏览器夹具中的自制长消息，用来检查换行、滚动与候选来源，不代表真实模型调用。"
        : index % 2 === 0
          ? `第 ${index + 1} 条合成修改目标：保持事实不变。`
          : `第 ${index + 1} 条合成回复：候选尚未采纳，正文保持不变。`,
    created_at: new Date(Date.parse(now) + index * 60_000).toISOString(),
  }));
}
function reset(next) {
  scenario.value = next;
  document.value = { id: documentId, version: 3, snapshot: {} };
  counters.apply = counters.undo = counters.cancel = counters.retry = counters.createRun = 0;
  lastInput = undefined;
  sessions = [
    { id: sessionAId, project_id: projectId, role: "content", title: "第三章内容修订", archived: false, version: 1, created_at: now, updated_at: now },
    { id: sessionBId, project_id: projectId, role: "content", title: "文献综述讨论", archived: false, version: 1, created_at: now, updated_at: now },
  ];
  if (next === "empty") sessions = [];
  messages = new Map(sessions.map((item) => [item.id, makeMessages(item.id)]));
  const candidate = baseCandidate();
  const run = {
    id: runId,
    project_id: projectId,
    session_id: sessionAId,
    job_id: jobId,
    trigger_message_id: "0025-0000-4000-8000-000000000000",
    result_message_id: "0025-0000-4000-8000-000000000000",
    source_run_id: null,
    candidate_id: candidateId,
    document_id: documentId,
    document_version: 3,
    purpose: "content_revision",
    status: "succeeded",
    error_code: null,
    created_at: now,
    updated_at: now,
  };
  if (next === "invalid") {
    candidate.status = "invalid";
    candidate.applicable = false;
    candidate.checks = candidate.checks.map((check) =>
      check.rule === "number" ? { ...check, result: "fail", patch_id: "patch-a", detail: "候选改变了实验数字 42，必须恢复原值。", start: 14, end: 16 } : check,
    );
  } else if (next === "stale") {
    candidate.base_version = 2;
    run.document_version = 2;
  } else if (next === "failed") {
    candidate.status = "failed";
    candidate.applicable = false;
    candidate.patches = [];
    candidate.generation_error_code = "MODEL_NOT_CONFIGURED";
    run.status = "failed";
    run.error_code = "MODEL_NOT_CONFIGURED";
    run.result_message_id = null;
  } else if (next === "running") {
    candidate.status = "generating";
    candidate.applicable = false;
    candidate.patches = [];
    candidate.decisions = [];
    run.status = "running";
    run.result_message_id = null;
  }
  runs = next === "empty" ? [] : [run];
  candidates = next === "empty" ? [] : [candidate];
  contexts = new Map([
    [
      runId,
      {
        document_id: documentId,
        document_version: run.document_version,
        selection: clone(candidate.selection),
        goal: candidate.goal,
        agent_config_version_id: agentVersionId,
        source_binding_version_id: null,
        material_sources: [],
        literature_entries: [],
      },
    ],
  ]);
  resetKey.value++;
}
const config = {
  id: configId,
  name: "合成内容助手",
  kind: "agent",
  enabled: true,
  current_version_id: agentVersionId,
  content: { kind: "agent", role: "content" },
};
const agentVersion = { id: agentVersionId, name: "合成内容助手", version: 1, content: { kind: "agent", role: "content" } };
const serviceDouble = {
  sourceKey: "assistant-visual-fixture",
  assistantSessions: {
    async list() {
      return { items: clone(sessions), total: sessions.length, limit: 50, offset: 0 };
    },
    async get(_project, id) {
      const value = sessions.find((item) => item.id === id);
      if (!value) throw new Error("会话不存在");
      return clone(value);
    },
    async create(_project, input) {
      const created = {
        id: crypto.randomUUID(),
        project_id: projectId,
        role: "content",
        title: input.title,
        archived: false,
        version: 1,
        created_at: now,
        updated_at: now,
      };
      sessions = [created, ...sessions];
      messages.set(created.id, []);
      return clone(created);
    },
    async update(_project, id, input) {
      const value = sessions.find((item) => item.id === id);
      Object.assign(value, input, { version: value.version + 1 });
      return clone(value);
    },
    async messages(_project, id, query = {}) {
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 20;
      const values = messages.get(id) ?? [];
      return { items: clone(values.slice(offset, offset + limit)), total: values.length, limit, offset };
    },
    async runs(_project, id, query = {}) {
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 20;
      const values = runs.filter((item) => item.session_id === id);
      return { items: clone(values.slice(offset, offset + limit)), total: values.length, limit, offset };
    },
    async run(_project, id) {
      return clone(runs.find((item) => item.id === id));
    },
    async context(_project, id) {
      return { run_id: id, input: clone(contexts.get(id)), context_snapshot: {}, configuration_snapshot: {} };
    },
    async createRun(_project, id, command) {
      counters.createRun++;
      lastInput = clone(command.input);
      const session = sessions.find((item) => item.id === id);
      const message = {
        id: crypto.randomUUID(),
        session_id: id,
        run_id: null,
        seq: (messages.get(id)?.length ?? 0) + 1,
        role: "user",
        content: command.input.goal,
        created_at: new Date().toISOString(),
      };
      messages.set(id, [...(messages.get(id) ?? []), message]);
      const newRun = {
        id: crypto.randomUUID(),
        project_id: projectId,
        session_id: id,
        job_id: crypto.randomUUID(),
        trigger_message_id: message.id,
        result_message_id: null,
        source_run_id: null,
        candidate_id: crypto.randomUUID(),
        document_id: command.input.document_id,
        document_version: command.input.document_version,
        purpose: "content_revision",
        status: "queued",
        error_code: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      message.run_id = newRun.id;
      const candidate = baseCandidate();
      candidate.id = newRun.candidate_id;
      candidate.run_id = newRun.id;
      candidate.base_version = command.input.document_version;
      candidate.document_version = command.input.document_version;
      candidate.goal = command.input.goal;
      candidate.selection = clone(command.input.selection);
      candidate.status = "generating";
      candidate.applicable = false;
      candidate.patches = [];
      candidate.decisions = [];
      candidates = [candidate, ...candidates];
      runs = [newRun, ...runs];
      contexts.set(newRun.id, clone(command.input));
      session.version++;
      return { session: clone(session), message: clone(message), run: clone(newRun), job: { id: newRun.job_id } };
    },
    async cancel(_project, id) {
      counters.cancel++;
      const run = runs.find((item) => item.id === id);
      run.status = "cancelled";
      run.updated_at = new Date().toISOString();
      const candidate = candidates.find((item) => item.id === run.candidate_id);
      if (candidate) candidate.status = "cancelled";
      return clone(run);
    },
    async retry(_project, id) {
      counters.retry++;
      const original = runs.find((item) => item.id === id);
      const input = clone(contexts.get(id));
      const newRun = {
        ...original,
        id: crypto.randomUUID(),
        job_id: crypto.randomUUID(),
        candidate_id: crypto.randomUUID(),
        source_run_id: id,
        status: "queued",
        error_code: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const candidate = baseCandidate();
      candidate.id = newRun.candidate_id;
      candidate.run_id = newRun.id;
      candidate.status = "generating";
      candidate.applicable = false;
      candidate.patches = [];
      candidate.decisions = [];
      runs = [newRun, ...runs];
      candidates = [candidate, ...candidates];
      contexts.set(newRun.id, input);
      return { session: clone(sessions.find((item) => item.id === original.session_id)), run: clone(newRun), job: { id: newRun.job_id } };
    },
  },
  revisions: {
    async list() {
      return {
        items: candidates.map((item) => ({
          id: item.id,
          project_id: item.project_id,
          document_id: item.document_id,
          base_version: item.base_version,
          document_version: item.document_version,
          revision: item.revision,
          status: item.status,
          result_version: item.result_version,
          created_at: item.created_at,
          updated_at: item.updated_at,
        })),
        total: candidates.length,
        limit: 20,
        offset: 0,
      };
    },
    async get(_project, _document, id) {
      return clone(candidates.find((item) => item.id === id));
    },
    async decide(_project, _document, id, input) {
      const candidate = candidates.find((item) => item.id === id);
      candidate.decisions = clone(input.decisions);
      candidate.revision++;
      candidate.updated_at = new Date().toISOString();
      return { candidate_id: id, result_version: null };
    },
    async apply(_project, _document, id) {
      counters.apply++;
      const candidate = candidates.find((item) => item.id === id);
      candidate.status = "applied";
      candidate.result_version = document.value.version + 1;
      candidate.application_command_id = crypto.randomUUID();
      return { candidate_id: id, result_version: candidate.result_version };
    },
    async cancel(_project, _document, id) {
      const candidate = candidates.find((item) => item.id === id);
      candidate.status = "cancelled";
      return { candidate_id: id, result_version: null };
    },
    async undo(_project, _document, applicationId) {
      counters.undo++;
      const candidate = candidates.find((item) => item.application_command_id === applicationId);
      candidate.status = "undone";
      candidate.result_version = document.value.version + 1;
      return { candidate_id: candidate.id, result_version: candidate.result_version };
    },
  },
  aiConfigs: {
    async list() {
      return { items: [clone(config)], total: 1, limit: 100, offset: 0 };
    },
    async versions() {
      return { items: [clone(agentVersion)], total: 1, limit: 100, offset: 0 };
    },
  },
  materials: {
    async list() {
      return { items: [], total: 0, limit: 100, offset: 0 };
    },
    async sourceBindingVersions() {
      return { items: [], total: 0, limit: 100, offset: 0 };
    },
    async sourceBinding() {
      return {
        project_id: projectId,
        current_version_id: null,
        template_parse_version_id: null,
        requirement_parse_version_ids: [],
        version: 0,
        updated_at: null,
      };
    },
  },
  literature: {
    async entries() {
      return { items: [], total: 0, limit: 100, offset: 0 };
    },
  },
};
const App = defineComponent({
  setup() {
    provideThemeScope(theme);
    return () =>
      h("main", { class: "assistant-harness" }, [
        h(TpDefs),
        h("div", { class: "assistant-harness__paper" }, [
          h(WritingAssistantPanel, {
            key: resetKey.value,
            services: serviceDouble,
            project,
            document: document.value,
            selection: selection.value,
            eligible: true,
            onChanged: () => (document.value = { ...document.value, version: document.value.version + 1 }),
          }),
        ]),
      ]);
  },
});
reset("ready");
createApp(App).mount("#app");
// 仅供对应浏览器测试驱动的合成夹具，不进入正式应用或业务存储。
window.__assistantFixture = {
  setTheme(value) {
    theme.value = value;
    window.document.documentElement.dataset.theme = value;
  },
  setMotion(value) {
    motion.value = value;
    window.document.documentElement.dataset.motion = value;
  },
  setScenario(value) {
    reset(value);
  },
  state() {
    return { scenario: scenario.value, version: document.value.version, counters: clone(counters), lastInput: clone(lastInput), motion: motion.value };
  },
};
