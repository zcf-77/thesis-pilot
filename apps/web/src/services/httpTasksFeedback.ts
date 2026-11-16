import type { ApiTypes, SchemaName } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { TaskService, FeedbackService, PageQuery } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

type Request = <Name extends SchemaName>(path: string, schema: Name, method?: string, body?: unknown, signal?: AbortSignal) => Promise<ApiTypes[Name]>;
const base = (projectId: string) => `/projects/${requireUuid(projectId)}`;
const taskPath = (p: string, id: string) => `${base(p)}/tasks/${requireUuid(id)}`;
const itemPath = (p: string, id: string) => `${base(p)}/feedback/items/${requireUuid(id)}`;
const batchPath = (p: string, id: string) => `${base(p)}/feedback/${requireUuid(id)}`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function identity<T extends { project_id: string; id: string }>(value: T, p: string, id?: string): T {
  if (!same(value.project_id, p) || (id !== undefined && !same(value.id, id))) throw new ApiError("INVALID_RESPONSE");
  return value;
}
function paged<T extends { items: unknown[]; limit: number; offset: number; total: number }>(value: T, query?: PageQuery): T {
  const { limit, offset } = pageQuery(query);
  if (value.limit !== limit || value.offset !== offset || value.items.length > limit || value.total < value.items.length)
    throw new ApiError("INVALID_RESPONSE");
  return value;
}
const suffix = (query?: PageQuery) => {
  const { limit, offset } = pageQuery(query);
  return `?limit=${limit}&offset=${offset}`;
};
export function taskFeedbackInput<
  Name extends
    | "TaskCreate"
    | "TaskUpdate"
    | "TaskDecision"
    | "TaskReorder"
    | "FeedbackCreate"
    | "FeedbackItemCreate"
    | "FeedbackItemUpdate"
    | "FeedbackDecision",
>(name: Name, input: ApiTypes[Name]): ApiTypes[Name] {
  const ids = new Set(["command_id", "document_id", "material_id", "original_id", "parse_version_id", "task_id"]);
  function normalize(value: unknown, key = ""): unknown {
    if (typeof value === "string") {
      if (/[\uD800-\uDFFF]/u.test(value)) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      return ids.has(key) || key === "depends_on" || key === "task_ids" ? value.toLowerCase() : value;
    }
    if (Array.isArray(value)) return value.map((item) => normalize(item, key));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, normalize(item, field)]));
    return value;
  }
  const normalized = normalize(input) as Record<string, unknown>;
  const content = normalized.content;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const fields = content as Record<string, unknown>;
    normalized.content =
      "acceptance" in fields
        ? {
            description: "",
            start_date: null,
            due_date: null,
            hard_deadline: null,
            depends_on: [],
            chapter: null,
            evidence: [],
            archived: false,
            status: "todo",
            ...fields,
            title: typeof fields.title === "string" ? fields.title.trim() : fields.title,
          }
        : { correction: "", task_id: null, new_task: null, evidence: [], ...fields };
  }
  if (name === "FeedbackCreate" || name === "FeedbackItemCreate") normalized.expected_version ??= 0;
  const data = parseDto(name, normalized, true);
  if ("content" in data && "acceptance" in data.content) {
    const content = data.content;
    const dates = [content.start_date, content.due_date, content.hard_deadline].filter((value): value is string => typeof value === "string");
    if (
      !content.title.trim() ||
      !content.acceptance.trim() ||
      dates.some((value, i) => i > 0 && value < dates[i - 1]!) ||
      new Set(content.depends_on ?? []).size !== (content.depends_on ?? []).length
    )
      throw new ApiError("VALIDATION_ERROR", { status: 422 });
  }
  if ("content" in data && "source_range" in data.content && data.content.new_task) {
    const normalizedTask = taskFeedbackInput("TaskCreate", { command_id: data.command_id, expected_board_version: 0, content: data.content.new_task });
    return parseDto(name, { ...data, content: { ...data.content, new_task: normalizedTask.content } }, true);
  }
  if ("action" in data && data.action === "rework" && !data.reason?.trim()) throw new ApiError("VALIDATION_ERROR", { status: 422 });
  return data;
}
export function createHttpTasks(request: Request): TaskService {
  return {
    async list(p, query, signal) {
      const value = paged(await request(`${base(p)}/tasks${suffix(query)}`, "TaskPage", "GET", undefined, signal), query);
      value.items.forEach((item) => identity(item, p));
      return value;
    },
    async create(p, input, signal) {
      return identity(await request(`${base(p)}/tasks`, "TaskRead", "POST", taskFeedbackInput("TaskCreate", input), signal), p);
    },
    async get(p, id, signal) {
      return identity(await request(taskPath(p, id), "TaskRead", "GET", undefined, signal), p, id);
    },
    async update(p, id, input, signal) {
      return identity(await request(taskPath(p, id), "TaskRead", "PATCH", taskFeedbackInput("TaskUpdate", input), signal), p, id);
    },
    async reorder(p, input, signal) {
      return request(`${base(p)}/tasks/reorder`, "BoardRead", "POST", taskFeedbackInput("TaskReorder", input), signal);
    },
    async decide(p, id, input, signal) {
      return identity(await request(`${taskPath(p, id)}/decisions`, "TaskRead", "POST", taskFeedbackInput("TaskDecision", input), signal), p, id);
    },
    async versions(p, id, query, signal) {
      const value = paged(await request(`${taskPath(p, id)}/versions${suffix(query)}`, "TaskVersionPage", "GET", undefined, signal), query);
      value.items.forEach((item) => identity(item.snapshot, p, id));
      return value;
    },
  };
}
export function createHttpFeedback(request: Request): FeedbackService {
  return {
    async list(p, query, signal) {
      const value = paged(await request(`${base(p)}/feedback${suffix(query)}`, "FeedbackPage", "GET", undefined, signal), query);
      value.items.forEach((item) => identity(item, p));
      return value;
    },
    async create(p, input, signal) {
      return identity(await request(`${base(p)}/feedback`, "FeedbackRead", "POST", taskFeedbackInput("FeedbackCreate", input), signal), p);
    },
    async get(p, id, signal) {
      return identity(await request(batchPath(p, id), "FeedbackRead", "GET", undefined, signal), p, id);
    },
    async items(p, id, query, signal) {
      const value = paged(await request(`${batchPath(p, id)}/items${suffix(query)}`, "FeedbackItemPage", "GET", undefined, signal), query);
      if (value.items.some((item) => !same(item.batch_id, id))) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async item(p, id, signal) {
      return identity(await request(itemPath(p, id), "FeedbackItemRead", "GET", undefined, signal), p, id);
    },
    async createItem(p, id, input, signal) {
      const value = identity(await request(`${batchPath(p, id)}/items`, "FeedbackItemRead", "POST", taskFeedbackInput("FeedbackItemCreate", input), signal), p);
      if (!same(value.batch_id, id)) throw new ApiError("INVALID_RESPONSE");
      return value;
    },
    async updateItem(p, id, input, signal) {
      return identity(await request(itemPath(p, id), "FeedbackItemRead", "PATCH", taskFeedbackInput("FeedbackItemUpdate", input), signal), p, id);
    },
    async decide(p, id, input, signal) {
      return identity(await request(`${itemPath(p, id)}/decisions`, "FeedbackItemRead", "POST", taskFeedbackInput("FeedbackDecision", input), signal), p, id);
    },
    async versions(p, id, query, signal) {
      const value = paged(await request(`${itemPath(p, id)}/versions${suffix(query)}`, "FeedbackVersionPage", "GET", undefined, signal), query);
      value.items.forEach((item) => identity(item.snapshot, p, id));
      return value;
    },
  };
}
