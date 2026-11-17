import type {
  EvidenceSnapshot,
  TaskContent,
  TaskRead,
  TaskVersionRead,
  FeedbackRead,
  FeedbackItemRead,
  FeedbackVersionRead,
  MaterialRead,
  MaterialOriginalRead,
  MaterialParseRead,
  ProjectRead,
} from "./contracts/api.generated.ts";
import type { TaskService, FeedbackService, PageQuery } from "./types.ts";
import type { MockDocuments } from "./mockDocuments.ts";
import { ApiError } from "./errors.ts";
import { taskFeedbackInput } from "./httpTasksFeedback.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";
import { resolveContentSelection, selectionText } from "./revisionProtectionV2.ts";

const clone = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
type Facts = { material: MaterialRead; original: MaterialOriginalRead; parse: MaterialParseRead };
type Evidence = NonNullable<TaskContent["evidence"]>;
const fail = (code: string, status = 409): never => {
  throw new ApiError(code, { status });
};
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function createMockTasksFeedback(
  before: (signal?: AbortSignal) => Promise<void>,
  requireProject: (id: string) => ProjectRead,
  documents: MockDocuments,
  facts: (projectId: string, materialId: string, originalId: string, parseId: string) => Facts,
): { tasks: TaskService; feedback: FeedbackService } {
  const tasks = new Map<string, TaskRead>();
  const batches = new Map<string, FeedbackRead>();
  const items = new Map<string, FeedbackItemRead>();
  const boards = new Map<string, number>();
  const taskHistory = new Map<string, TaskVersionRead[]>();
  const feedbackHistory = new Map<string, FeedbackVersionRead[]>();
  const commands = new Map<string, { fingerprint: string; result: unknown }>();
  const confirmedDependencies = new Map<string, Map<string, number>>();
  const project = (p: string) => {
    const id = requireUuid(p).toLowerCase();
    requireProject(id);
    return id;
  };
  const scoped = <T extends { project_id: string }>(store: Map<string, T>, p: string, id: string, code: string): T => {
    project(p);
    const result = store.get(requireUuid(id).toLowerCase());
    if (!result || result.project_id !== p.toLowerCase()) return fail(code, 404);
    return result;
  };
  const task = (p: string, id: string) => scoped(tasks, p, id, "TASK_NOT_FOUND");
  const batch = (p: string, id: string) => scoped(batches, p, id, "FEEDBACK_NOT_FOUND");
  const item = (p: string, id: string) => scoped(items, p, id, "FEEDBACK_NOT_FOUND");
  function command<T>(p: string, id: string, operation: string, input: unknown, apply: () => T): T {
    if (requireProject(p).archived) return fail("TASK_PROJECT_ARCHIVED");
    const key = requireUuid(id).toLowerCase();
    const previous = commands.get(key);
    if (previous) {
      if (previous.fingerprint !== stable({ operation, input, project: p })) return fail("TASK_COMMAND_CONFLICT");
      return clone(previous.result) as T;
    }
    const result = apply();
    commands.set(key, { fingerprint: stable({ operation, input, project: p }), result: clone(result) });
    return clone(result);
  }
  function snapshots(p: string, refs: Evidence = []): EvidenceSnapshot[] {
    if (new Set(refs.map(stable)).size !== refs.length) return fail("TASK_EVIDENCE_INVALID", 422);
    return refs.map((reference) => {
      try {
        let label: string;
        let fingerprint: string;
        if (reference.kind === "document") {
          const version = documents.revisionVersion(p, reference.document_id, reference.version);
          resolveContentSelection(version.content, reference.selection);
          label = selectionText(reference.selection);
          fingerprint = stable(reference);
        } else {
          const data = facts(p, reference.material_id, reference.original_id, reference.parse_version_id);
          if (!reference.anchor_ids.length || new Set(reference.anchor_ids).size !== reference.anchor_ids.length) return fail("TASK_EVIDENCE_INVALID", 422);
          const anchors = reference.anchor_ids.map((id) => data.parse.result.anchors.find((anchor) => anchor.id === id));
          if (anchors.some((anchor) => !anchor)) return fail("TASK_EVIDENCE_INVALID", 422);
          label = anchors.map((anchor) => anchor!.original_text).join("\n");
          fingerprint = stable({ reference, hashes: anchors.map((anchor) => anchor!.sha256) });
        }
        return { reference: clone(reference), label, fingerprint, stale: stale(p, reference) };
      } catch {
        return fail("TASK_EVIDENCE_INVALID", 422);
      }
    });
  }
  function stale(p: string, ref: Evidence[number]): boolean {
    try {
      if (ref.kind === "document") return documents.revisionCurrent(p, ref.document_id).version !== ref.version;
      const data = facts(p, ref.material_id, ref.original_id, ref.parse_version_id);
      return (
        !data.material.linked ||
        data.material.removed ||
        data.material.current_original_id !== ref.original_id ||
        data.original.latest_parse_id !== ref.parse_version_id
      );
    } catch {
      return true;
    }
  }
  function taskView(value: TaskRead): TaskRead {
    const result = clone(value);
    result.evidence_snapshots = result.evidence_snapshots.map((snapshot) => ({ ...snapshot, stale: stale(value.project_id, snapshot.reference) }));
    const reasons: string[] = [];
    if (!result.evidence_snapshots.length) reasons.push("evidence_missing");
    if (result.evidence_snapshots.some((snapshot) => snapshot.stale)) reasons.push("evidence_stale");
    if (result.content.chapter) {
      try {
        if (documents.revisionCurrent(value.project_id, result.content.chapter.document_id).version !== result.content.chapter.version)
          reasons.push("chapter_stale");
      } catch {
        reasons.push("chapter_stale");
      }
    }
    if (
      (result.content.depends_on ?? []).some((id) => {
        const dep = tasks.get(id);
        return (
          !dep ||
          dep.content.archived ||
          dep.status !== "confirmed" ||
          taskEvidenceStale(dep) ||
          (result.status === "confirmed" && confirmedDependencies.get(result.id)?.get(id) !== dep.version)
        );
      })
    )
      reasons.push("dependency_unconfirmed");
    const deadline = requireProject(value.project_id).deadline;
    if (deadline && [result.content.start_date, result.content.due_date, result.content.hard_deadline].some((date) => date && date > deadline))
      reasons.push("deadline_changed");
    result.review_reasons = reasons;
    result.needs_review = reasons.length > 0;
    return result;
  }
  const taskEvidenceStale = (value: TaskRead) => value.evidence_snapshots.some((snapshot) => stale(value.project_id, snapshot.reference));
  function validateContent(p: string, id: string, content: TaskContent) {
    const refs = content.depends_on ?? [];
    for (const ref of refs) {
      const dep = tasks.get(ref);
      if (!dep || dep.project_id !== p) return fail("TASK_DEPENDENCY_INVALID", 422);
      if (dep.content.archived || ref === id) return fail(ref === id ? "TASK_DEPENDENCY_CYCLE" : "TASK_DEPENDENCY_INVALID", 422);
    }
    const visited = new Set<string>();
    function visit(ref: string) {
      if (ref === id) return fail("TASK_DEPENDENCY_CYCLE", 422);
      if (visited.has(ref)) return;
      visited.add(ref);
      for (const next of task(p, ref).content.depends_on ?? []) visit(next);
    }
    refs.forEach(visit);
    if (content.chapter) {
      const version = documents.revisionVersion(p, content.chapter.document_id, content.chapter.version);
      const pending: unknown[] = [version.content.json];
      let found = false;
      while (pending.length) {
        const node = pending.pop() as { type?: string; attrs?: { chapterId?: string }; content?: unknown[] };
        if (node.type === "heading" && node.attrs?.chapterId === content.chapter.chapter_id) found = true;
        pending.push(...(node.content ?? []));
      }
      if (!found) return fail("TASK_CHAPTER_INVALID", 422);
    }
    const deadline = requireProject(p).deadline;
    if (deadline && [content.start_date, content.due_date, content.hard_deadline].some((date) => date && date > deadline))
      return fail("TASK_DEADLINE_CONFLICT", 422);
    return snapshots(p, content.evidence);
  }
  function saveTask(value: TaskRead, action: string, reason = "") {
    const valid = parseDto("TaskRead", value);
    tasks.set(value.id, valid);
    if (action === "create") boards.set(value.project_id, (boards.get(value.project_id) ?? 0) + 1);
    taskHistory.set(value.id, [
      ...(taskHistory.get(value.id) ?? []),
      { version: value.version, action, reason, snapshot: clone(taskView(valid)), created_at: value.updated_at },
    ]);
    return taskView(valid);
  }
  function createTask(p: string, content: TaskContent) {
    if ([...tasks.values()].filter((t) => t.project_id === p).length >= 500) return fail("TASK_LIMIT_REACHED", 422);
    const id = crypto.randomUUID();
    const evidence = snapshots(p, content.evidence);
    validateContent(p, id, content);
    const stamp = now();
    return saveTask(
      {
        id,
        project_id: p,
        version: 1,
        position: [...tasks.values()].filter((t) => t.project_id === p).length,
        origin: "manual",
        status: content.status ?? "todo",
        content: clone(content),
        evidence_snapshots: evidence,
        needs_review: false,
        review_reasons: [],
        created_at: stamp,
        updated_at: stamp,
      },
      "create",
    );
  }
  function page<T>(all: T[], query?: PageQuery) {
    const { limit, offset } = pageQuery(query);
    return { items: clone(all.slice(offset, offset + limit)), total: all.length, limit, offset };
  }
  const taskService: TaskService = {
    async list(p, query, signal) {
      await before(signal);
      p = project(p);
      const all = [...tasks.values()]
        .filter((t) => t.project_id === p)
        .sort((a, b) => a.position - b.position)
        .map(taskView)
        .map((t) => ({
          id: t.id,
          project_id: p,
          version: t.version,
          position: t.position,
          title: t.content.title,
          status: t.status,
          archived: t.content.archived ?? false,
          due_date: t.content.due_date ?? null,
          needs_review: t.needs_review,
          review_reasons: t.review_reasons,
          updated_at: t.updated_at,
        }));
      return parseDto("TaskPage", { ...page(all, query), board_version: boards.get(p) ?? 0 });
    },
    async get(p, id, signal) {
      await before(signal);
      return taskView(task(p, id));
    },
    async create(p, input, signal) {
      await before(signal);
      p = project(p);
      const data = taskFeedbackInput("TaskCreate", input);
      return command(p, data.command_id, "task.create", data, () => {
        if ((boards.get(p) ?? 0) !== data.expected_board_version) return fail("TASK_BOARD_CONFLICT");
        return createTask(p, data.content);
      });
    },
    async update(p, id, input, signal) {
      await before(signal);
      p = project(p);
      const data = taskFeedbackInput("TaskUpdate", input);
      return command(p, data.command_id, `task.update:${id}`, data, () => {
        const current = task(p, id);
        if (current.version !== data.expected_version) return fail("TASK_VERSION_CONFLICT");
        const evidence = validateContent(p, id, data.content);
        confirmedDependencies.delete(id);
        return saveTask(
          {
            ...current,
            version: current.version + 1,
            content: clone(data.content),
            status: data.content.status ?? "todo",
            evidence_snapshots: evidence,
            updated_at: now(),
          },
          "edit",
        );
      });
    },
    async reorder(p, input, signal) {
      await before(signal);
      p = project(p);
      const data = taskFeedbackInput("TaskReorder", input);
      return command(p, data.command_id, "task.reorder", data, () => {
        if ((boards.get(p) ?? 0) !== data.expected_board_version) return fail("TASK_BOARD_CONFLICT");
        const all = [...tasks.values()].filter((t) => t.project_id === p);
        if (new Set(data.task_ids).size !== all.length || data.task_ids.length !== all.length || all.some((t) => !data.task_ids.includes(t.id)))
          return fail("TASK_ORDER_INVALID", 422);
        data.task_ids.forEach((id, position) => {
          const old = tasks.get(id)!;
          if (old.position !== position) saveTask({ ...old, position, version: old.version + 1, updated_at: now() }, "reorder");
        });
        boards.set(p, (boards.get(p) ?? 0) + 1);
        return parseDto("BoardRead", { board_version: boards.get(p), task_ids: data.task_ids });
      });
    },
    async decide(p, id, input, signal) {
      await before(signal);
      p = project(p);
      const data = taskFeedbackInput("TaskDecision", input);
      return command(p, data.command_id, `task.decide:${id}`, data, () => {
        const current = task(p, id);
        if (current.version !== data.expected_version) return fail("TASK_VERSION_CONFLICT");
        if (current.content.archived) return fail("TASK_ARCHIVED");
        if (data.action !== "confirm") confirmedDependencies.delete(id);
        if (data.action === "confirm") {
          const view = taskView(current);
          if (view.needs_review) return fail("TASK_EVIDENCE_STALE");
          confirmedDependencies.set(id, new Map((current.content.depends_on ?? []).map((dep) => [dep, task(p, dep).version])));
        }
        return saveTask(
          {
            ...current,
            version: current.version + 1,
            status: data.action === "confirm" ? "confirmed" : data.action === "rework" ? "rework" : "todo",
            updated_at: now(),
          },
          data.action,
          data.reason,
        );
      });
    },
    async versions(p, id, query, signal) {
      await before(signal);
      task(p, id);
      return parseDto("TaskVersionPage", page([...(taskHistory.get(id) ?? [])].reverse(), query));
    },
  };
  function feedbackView(value: FeedbackItemRead) {
    const result = clone(value);
    result.evidence_snapshots = result.evidence_snapshots.map((e) => ({ ...e, stale: stale(value.project_id, e.reference) }));
    result.review_reasons = result.evidence_snapshots.some((e) => e.stale) ? ["evidence_stale"] : [];
    if (!result.evidence_snapshots.length) result.review_reasons.push("evidence_missing");
    if (!result.content.source_checked) result.review_reasons.push("source_unchecked");
    if (result.content.certainty === "uncertain" && !result.content.correction?.trim()) result.review_reasons.push("interpretation_uncertain");
    if (result.content.task_id && task(result.project_id, result.content.task_id).content.archived) result.review_reasons.push("task_archived");
    result.needs_review = result.review_reasons.length > 0;
    return result;
  }
  function saveItem(value: FeedbackItemRead, action: string, reason = "") {
    const valid = parseDto("FeedbackItemRead", value);
    items.set(value.id, valid);
    feedbackHistory.set(value.id, [
      ...(feedbackHistory.get(value.id) ?? []),
      { version: value.version, action, reason, snapshot: clone(feedbackView(valid)), created_at: value.updated_at },
    ]);
    const root = batches.get(value.batch_id)!;
    root.item_count = [...items.values()].filter((i) => i.batch_id === root.id).length;
    return feedbackView(valid);
  }
  function prepareContent(p: string, b: FeedbackRead, content: FeedbackItemRead["content"]) {
    if (!content.interpretation.trim()) return fail("FEEDBACK_INTERPRETATION_INVALID", 422);
    const range = content.source_range;
    if (range.from >= range.to || b.original_text.slice(range.from, range.to) !== range.text || /[\uD800-\uDFFF]/u.test(range.text))
      return fail("FEEDBACK_RANGE_INVALID", 422);
    if (content.task_id && content.new_task) return fail("FEEDBACK_TASK_INVALID", 422);
    if (content.task_id) task(p, content.task_id);
    const evidence = snapshots(p, content.evidence);
    if (content.new_task) validateContent(p, "new-feedback-task", content.new_task);
    const next = clone(content);
    if (content.new_task) {
      next.task_id = createTask(p, content.new_task).id;
      next.new_task = null;
    }
    return { content: next, evidence };
  }
  const feedback: FeedbackService = {
    async list(p, query, signal) {
      await before(signal);
      p = project(p);
      return parseDto(
        "FeedbackPage",
        page(
          [...batches.values()]
            .filter((b) => b.project_id === p)
            .reverse()
            .map(({ original_text: _text, ...summary }) => summary),
          query,
        ),
      );
    },
    async create(p, input, signal) {
      await before(signal);
      p = project(p);
      const data = taskFeedbackInput("FeedbackCreate", input);
      return command(p, data.command_id, "feedback.create", data, () => {
        if (!data.original_text.trim()) return fail("FEEDBACK_ORIGINAL_INVALID", 422);
        const id = crypto.randomUUID();
        const value = parseDto("FeedbackRead", {
          id,
          project_id: p,
          origin: "manual",
          preview: data.original_text.slice(0, 200),
          item_count: 0,
          created_at: now(),
          original_text: data.original_text,
        });
        batches.set(id, value);
        return value;
      });
    },
    async get(p, id, signal) {
      await before(signal);
      return clone(batch(p, id));
    },
    async items(p, id, query, signal) {
      await before(signal);
      batch(p, id);
      return parseDto(
        "FeedbackItemPage",
        page(
          [...items.values()]
            .filter((i) => i.batch_id === id)
            .map(feedbackView)
            .map((i) => ({
              id: i.id,
              batch_id: i.batch_id,
              version: i.version,
              status: i.status,
              preview: i.content.interpretation.slice(0, 200),
              certainty: i.content.certainty,
              task_id: i.content.task_id ?? null,
              needs_review: i.needs_review,
              review_reasons: i.review_reasons,
              updated_at: i.updated_at,
            })),
          query,
        ),
      );
    },
    async item(p, id, signal) {
      await before(signal);
      return feedbackView(item(p, id));
    },
    async createItem(p, id, input, signal) {
      await before(signal);
      p = project(p);
      const data = taskFeedbackInput("FeedbackItemCreate", input);
      return command(p, data.command_id, `feedback.item.create:${id}`, data, () => {
        const root = batch(p, id);
        if ([...items.values()].filter((value) => value.batch_id === id).length >= 200) return fail("FEEDBACK_LIMIT_REACHED", 422);
        const prepared = prepareContent(p, root, data.content);
        const stamp = now();
        return saveItem(
          {
            id: crypto.randomUUID(),
            batch_id: id,
            project_id: p,
            version: 1,
            origin: "manual",
            status: "open",
            content: prepared.content,
            evidence_snapshots: prepared.evidence,
            needs_review: false,
            review_reasons: [],
            created_at: stamp,
            updated_at: stamp,
          },
          "create",
        );
      });
    },
    async updateItem(p, id, input, signal) {
      await before(signal);
      p = project(p);
      const data = taskFeedbackInput("FeedbackItemUpdate", input);
      return command(p, data.command_id, `feedback.item.update:${id}`, data, () => {
        const current = item(p, id);
        if (current.version !== data.expected_version) return fail("FEEDBACK_VERSION_CONFLICT");
        const prepared = prepareContent(p, batch(p, current.batch_id), data.content);
        return saveItem(
          { ...current, version: current.version + 1, status: "open", content: prepared.content, evidence_snapshots: prepared.evidence, updated_at: now() },
          "edit",
        );
      });
    },
    async decide(p, id, input, signal) {
      await before(signal);
      p = project(p);
      const data = taskFeedbackInput("FeedbackDecision", input);
      return command(p, data.command_id, `feedback.decide:${id}`, data, () => {
        const current = item(p, id);
        if (current.version !== data.expected_version) return fail("FEEDBACK_VERSION_CONFLICT");
        if (data.action === "processed") {
          if (feedbackView(current).needs_review) return fail("FEEDBACK_REVIEW_REQUIRED");
        }
        return saveItem(
          { ...current, version: current.version + 1, status: data.action === "processed" ? "processed" : "open", updated_at: now() },
          data.action,
          data.reason,
        );
      });
    },
    async versions(p, id, query, signal) {
      await before(signal);
      item(p, id);
      return parseDto("FeedbackVersionPage", page([...(feedbackHistory.get(id) ?? [])].reverse(), query));
    },
  };
  return { tasks: taskService, feedback };
}
