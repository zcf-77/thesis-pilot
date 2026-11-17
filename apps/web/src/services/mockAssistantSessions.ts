import type {
  AssistantContentInput,
  AssistantMessageRead,
  AssistantRunContext,
  AssistantRunRead,
  AssistantSessionRead,
  ConfigurationProbeConfiguration,
  JobRead,
  MaterialRead,
  MaterialOriginalRead,
  MaterialParseRead,
} from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import { assistantInput } from "./httpAssistantSessions.ts";
import type { MockDocuments } from "./mockDocuments.ts";
import type { AssistantSessionService, JobService, MaterialService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";
import { resolveContentSelection, selectionText } from "./revisionProtectionV2.ts";

const clone = <T>(value: T): T => structuredClone(value);
const timestamp = () => new Date().toISOString();
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
type Facts = { material: MaterialRead; original: MaterialOriginalRead; parse: MaterialParseRead };
export function createMockAssistantSessions(
  before: (signal?: AbortSignal) => Promise<void>,
  requireProject: (id: string) => unknown,
  documents: MockDocuments,
  materials: MaterialService,
  factsFor: (projectId: string, materialId: string, originalId: string, parseId: string) => Facts,
  configuration: (versionId: string) => ConfigurationProbeConfiguration,
  jobs: JobService,
  enqueue: (projectId: string, runId: string, sourceJobId?: string) => JobRead,
): AssistantSessionService {
  const sessions = new Map<string, AssistantSessionRead>();
  const messages = new Map<string, AssistantMessageRead[]>();
  const runs = new Map<string, AssistantRunRead>();
  const contexts = new Map<string, AssistantRunContext>();
  const commands = new Map<string, { fingerprint: string; promise: Promise<string> }>();
  function session(projectId: string, sessionId: string) {
    requireProject(requireUuid(projectId));
    const value = sessions.get(requireUuid(sessionId).toLowerCase());
    if (!value || value.project_id !== projectId.toLowerCase()) throw new ApiError("ASSISTANT_SESSION_NOT_FOUND", { status: 404 });
    return value;
  }
  function run(projectId: string, runId: string) {
    requireProject(requireUuid(projectId));
    const value = runs.get(requireUuid(runId).toLowerCase());
    if (!value || value.project_id !== projectId.toLowerCase()) throw new ApiError("ASSISTANT_RUN_NOT_FOUND", { status: 404 });
    return value;
  }
  async function readRun(projectId: string, runId: string) {
    const value = run(projectId, runId);
    const job = await jobs.get(value.job_id, undefined, projectId);
    const next = parseDto("AssistantRunRead", { ...value, status: job.status, error_code: job.error_code, updated_at: job.updated_at });
    runs.set(value.id, next);
    return clone(next);
  }
  function page<T>(items: T[], query?: { limit?: number; offset?: number }) {
    const { limit, offset } = pageQuery(query);
    return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
  }
  async function idle(projectId: string, sessionId: string) {
    const current = session(projectId, sessionId);
    if (current.archived) throw new ApiError("ASSISTANT_SESSION_ARCHIVED", { status: 409 });
    for (const value of runs.values())
      if (value.session_id === current.id) {
        const latest = await readRun(projectId, value.id);
        if (latest.status === "queued" || latest.status === "running") throw new ApiError("ASSISTANT_SESSION_BUSY", { status: 409 });
      }
  }
  function currentDocument(projectId: string, input: AssistantContentInput) {
    const document = documents.revisionCurrent(projectId.toLowerCase(), input.document_id.toLowerCase());
    if (document.version !== input.document_version) throw new ApiError("ASSISTANT_CONTEXT_STALE", { status: 409 });
    resolveContentSelection(document.content, input.selection);
    return document;
  }
  async function freeze(projectId: string, sessionId: string, input: AssistantContentInput) {
    currentDocument(projectId, input);
    const binding = await materials.sourceBinding(projectId);
    if (binding.current_version_id !== input.source_binding_version_id) throw new ApiError("ASSISTANT_CONTEXT_STALE", { status: 409 });
    const config = configuration(input.agent_config_version_id);
    if (config.config_kind !== "agent" || config.agent?.role !== "content") throw new ApiError("ASSISTANT_AGENT_INVALID", { status: 422 });
    const selected = (input.material_sources ?? []).map((source) => {
      const facts = factsFor(projectId, source.material_id, source.original_version_id, source.parse_version_id);
      if (!facts.material.linked || facts.material.removed) throw new ApiError("ASSISTANT_SOURCE_INVALID", { status: 422 });
      const anchors = source.anchor_ids.map((id) => {
        const anchor = facts.parse.result.anchors.find((entry) => entry.id === id);
        if (!anchor) throw new ApiError("ASSISTANT_SOURCE_INVALID", { status: 422 });
        return { anchor_id: anchor.id, text: anchor.original_text, part: anchor.part, line: anchor.line ?? null, xml_path: anchor.xml_path ?? null };
      });
      return {
        material_id: source.material_id,
        original_version_id: source.original_version_id,
        parse_version_id: source.parse_version_id,
        filename: facts.original.filename,
        original_sha256: facts.original.sha256,
        anchors,
      };
    });
    const context = {
      schema_version: 1,
      selection_text: selectionText(input.selection),
      goal: input.goal,
      materials: selected,
      project_sources: { binding },
      history: (messages.get(sessionId.toLowerCase()) ?? [])
        .slice(-10)
        .map((message) => ({ message_id: message.id, role: message.role, content: message.content })),
      simulation_notice: "本地模拟会话；未调用真实模型，运行将以MODEL_NOT_CONFIGURED失败。",
      model_used: false,
    };
    if (new TextEncoder().encode(JSON.stringify(context)).byteLength > 256 * 1024 || new TextEncoder().encode(JSON.stringify(config)).byteLength > 80 * 1024)
      throw new ApiError("ASSISTANT_CONTEXT_TOO_LARGE", { status: 413 });
    return { context, config };
  }
  async function execute(projectId: string, commandId: string, operation: string, payload: unknown, action: () => Promise<string>) {
    const key = requireUuid(commandId).toLowerCase();
    const fingerprint = stable([projectId.toLowerCase(), operation, payload]);
    const previous = commands.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ApiError("ASSISTANT_COMMAND_CONFLICT", { status: 409 });
      return previous.promise;
    }
    const promise = action();
    commands.set(key, { fingerprint, promise });
    try {
      return await promise;
    } catch (cause) {
      commands.delete(key);
      throw cause;
    }
  }
  function recordRun(
    projectId: string,
    sessionId: string,
    input: AssistantContentInput,
    context: unknown,
    config: unknown,
    trigger: AssistantMessageRead,
    source?: AssistantRunRead,
  ) {
    const current = session(projectId, sessionId);
    const id = crypto.randomUUID();
    const createdAt = timestamp();
    const job = enqueue(projectId, id, source?.job_id);
    const frozen = parseDto("AssistantRunContext", {
      run_id: id,
      input: clone(input),
      context_snapshot: clone(context),
      configuration_snapshot: clone(config),
    });
    const value = parseDto("AssistantRunRead", {
      id,
      project_id: projectId.toLowerCase(),
      session_id: current.id,
      purpose: "content_revision",
      job_id: job.id,
      status: "queued",
      trigger_message_id: trigger.id,
      result_message_id: null,
      candidate_id: null,
      source_run_id: source?.id ?? null,
      document_id: input.document_id,
      document_version: input.document_version,
      error_code: null,
      created_at: createdAt,
      updated_at: createdAt,
    });
    const updated = parseDto("AssistantSessionRead", { ...current, version: current.version + 1, updated_at: createdAt });
    sessions.set(current.id, updated);
    runs.set(id, value);
    contexts.set(id, frozen);
    return { run: value, job, session: updated };
  }
  async function receipt(projectId: string, runId: string) {
    const value = await readRun(projectId, runId);
    const message = (messages.get(value.session_id) ?? []).find((entry) => entry.id === value.trigger_message_id);
    if (!message) throw new ApiError("ASSISTANT_RUN_INVALID");
    return {
      session: clone(session(projectId, value.session_id)),
      message: clone(message),
      run: value,
      job: await jobs.get(value.job_id, undefined, projectId),
    };
  }
  return {
    async list(projectId, query = {}, signal) {
      await before(signal);
      requireProject(requireUuid(projectId));
      if (query.include_archived !== undefined && typeof query.include_archived !== "boolean") throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const ordered = [...sessions.values()]
        .filter((value) => value.project_id === projectId.toLowerCase() && (query.include_archived || !value.archived))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
      return clone(parseDto("AssistantSessionPage", page(ordered, query)));
    },
    async create(projectId, input, signal) {
      await before(signal);
      requireProject(requireUuid(projectId));
      const data = assistantInput("AssistantSessionCreate", input);
      const now = timestamp();
      const value = parseDto("AssistantSessionRead", {
        id: crypto.randomUUID(),
        project_id: projectId.toLowerCase(),
        title: data.title,
        role: "content",
        version: 1,
        archived: false,
        created_at: now,
        updated_at: now,
      });
      sessions.set(value.id, value);
      messages.set(value.id, []);
      return clone(value);
    },
    async get(projectId, sessionId, signal) {
      await before(signal);
      return clone(session(projectId, sessionId));
    },
    async update(projectId, sessionId, input, signal) {
      await before(signal);
      const data = assistantInput("AssistantSessionUpdate", input);
      const previous = session(projectId, sessionId);
      if (previous.version !== data.expected_version) throw new ApiError("ASSISTANT_SESSION_VERSION_CONFLICT", { status: 409 });
      const { expected_version: _expected, ...changes } = data;
      const next = parseDto("AssistantSessionRead", { ...previous, ...changes, version: previous.version + 1, updated_at: timestamp() });
      sessions.set(previous.id, next);
      return clone(next);
    },
    async messages(projectId, sessionId, query, signal) {
      await before(signal);
      const current = session(projectId, sessionId);
      if (pageQuery(query).limit > 50) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      return clone(parseDto("AssistantMessagePage", page(messages.get(current.id) ?? [], query)));
    },
    async createRun(projectId, sessionId, input, signal) {
      await before(signal);
      const data = assistantInput("AssistantRunCreate", input);
      const runId = await execute(projectId, data.command_id, "create", [sessionId.toLowerCase(), data], async () => {
        let current = session(projectId, sessionId);
        if (current.version !== data.expected_session_version) throw new ApiError("ASSISTANT_SESSION_VERSION_CONFLICT", { status: 409 });
        await idle(projectId, current.id);
        const frozen = await freeze(projectId, current.id, data.input);
        await before(signal);
        current = session(projectId, current.id);
        if (current.version !== data.expected_session_version) throw new ApiError("ASSISTANT_SESSION_VERSION_CONFLICT", { status: 409 });
        currentDocument(projectId, data.input);
        configuration(data.input.agent_config_version_id);
        const id = crypto.randomUUID();
        const message = parseDto("AssistantMessageRead", {
          id,
          session_id: current.id,
          seq: (messages.get(current.id) ?? []).length + 1,
          role: "user",
          content: data.input.goal,
          run_id: null,
          created_at: timestamp(),
        });
        const created = recordRun(projectId, current.id, data.input, frozen.context, frozen.config, message);

        messages.set(current.id, [...(messages.get(current.id) ?? []), message]);
        return created.run.id;
      });
      return parseDto("AssistantRunReceipt", await receipt(projectId, runId));
    },
    async runs(projectId, sessionId, query, signal) {
      await before(signal);
      const current = session(projectId, sessionId);
      const values = await Promise.all([...runs.values()].filter((value) => value.session_id === current.id).map((value) => readRun(projectId, value.id)));
      values.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
      return clone(parseDto("AssistantRunPage", page(values, query)));
    },
    async run(projectId, runId, signal) {
      await before(signal);
      return readRun(projectId, runId);
    },
    async context(projectId, runId, signal) {
      await before(signal);
      const value = run(projectId, runId);
      return clone(contexts.get(value.id)!);
    },
    async cancel(projectId, runId, input, signal) {
      await before(signal);
      const data = assistantInput("AssistantRunCommand", input);
      const id = await execute(projectId, data.command_id, "cancel", runId.toLowerCase(), async () => {
        const value = run(projectId, runId);
        await jobs.cancel(value.job_id, signal, projectId);
        return value.id;
      });
      return readRun(projectId, id);
    },
    async retry(projectId, runId, input, signal) {
      await before(signal);
      const data = assistantInput("AssistantRunCommand", input);
      const id = await execute(projectId, data.command_id, "retry", runId.toLowerCase(), async () => {
        const original = await readRun(projectId, runId);
        if (!["failed", "cancelled"].includes(original.status)) throw new ApiError("ASSISTANT_RUN_RETRY_INVALID", { status: 409 });
        await idle(projectId, original.session_id);
        const saved = contexts.get(original.id)!;
        const refreshed = await freeze(projectId, original.session_id, saved.input);
        if (stable(refreshed.config) !== stable(saved.configuration_snapshot)) throw new ApiError("ASSISTANT_CONTEXT_STALE", { status: 409 });
        let root = original;
        while (root.source_run_id) root = run(projectId, root.source_run_id);
        let count = 0;
        let pending = [root.id];
        while (pending.length) {
          const children = [...runs.values()].filter((value) => value.source_run_id && pending.includes(value.source_run_id));
          count += children.length;
          pending = children.map((value) => value.id);
        }
        if (count >= (refreshed.config.api?.max_retries ?? 0)) throw new ApiError("MODEL_RETRY_LIMIT_REACHED", { status: 409 });
        await before(signal);
        currentDocument(projectId, saved.input);
        if (session(projectId, original.session_id).archived) throw new ApiError("ASSISTANT_SESSION_ARCHIVED", { status: 409 });
        if ([...runs.values()].some((value) => value.session_id === original.session_id && ["queued", "running"].includes(value.status)))
          throw new ApiError("ASSISTANT_SESSION_BUSY", { status: 409 });
        const message = messages.get(original.session_id)!.find((entry) => entry.id === original.trigger_message_id)!;
        return recordRun(projectId, original.session_id, saved.input, saved.context_snapshot, saved.configuration_snapshot, message, original).run.id;
      });
      const result = await receipt(projectId, id);
      return parseDto("AssistantRunRetryReceipt", { session: result.session, run: result.run, job: result.job });
    },
  };
}
