import type { ApiTypes, NotificationRead, SchemaName } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { NotificationEventQuery, NotificationQuery, NotificationService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

type Request = <Name extends SchemaName>(path: string, schema: Name, method?: string, body?: unknown, signal?: AbortSignal) => Promise<ApiTypes[Name]>;
const TABS = new Set(["active", "snoozed", "dismissed"]);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const base = (projectId: string) => `/projects/${requireUuid(projectId)}/notifications`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function owned<T extends { project_id: string }>(value: T, projectId: string): T {
  if (!same(value.project_id, projectId)) throw new ApiError("INVALID_RESPONSE");
  return value;
}
function notice(value: NotificationRead, projectId: string, id?: string): NotificationRead {
  owned(value, projectId);
  if ((id !== undefined && !same(value.id, id)) || (value.status === "snoozed") !== (value.snooze_until !== null)) throw new ApiError("INVALID_RESPONSE");
  return value;
}
function paged<T extends { items: unknown[]; limit: number; offset: number; total: number }>(value: T, limit: number, offset: number): T {
  if (value.limit !== limit || value.offset !== offset || value.items.length > limit || value.total < value.items.length)
    throw new ApiError("INVALID_RESPONSE");
  return value;
}

/** 输入在发送前按同一 schema 校验；延后截止时间统一为带时区的 ISO 文本。 */
export function notificationInput<Name extends "NotificationTransition" | "ProgressNoteCreate">(name: Name, input: ApiTypes[Name]): ApiTypes[Name] {
  const data = parseDto(name, { ...input, command_id: input.command_id.toLowerCase() }, true);
  if ("action" in data) {
    const until = data.snooze_until ?? null;
    if ((data.action === "snooze") !== (until !== null)) throw new ApiError("VALIDATION_ERROR", { status: 422 });
    if (until !== null) {
      const time = Date.parse(until);
      if (!/(Z|[+-]\d{2}:\d{2})$/.test(until) || Number.isNaN(time)) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      return { ...data, snooze_until: new Date(time).toISOString() };
    }
    return { ...data, snooze_until: null };
  }
  if ("text" in data && (!data.text.trim() || Array.from(data.text).length > 2000 || LONE_SURROGATE.test(data.text)))
    throw new ApiError("VALIDATION_ERROR", { status: 422 });
  return data;
}

export function createHttpNotifications(request: Request): NotificationService {
  return {
    async list(p, query: NotificationQuery = {}, signal) {
      const { limit, offset } = pageQuery(query);
      const tab = query.tab ?? "active";
      if (!TABS.has(tab)) throw new ApiError("VALIDATION_ERROR", { status: 422 });
      const value = paged(await request(`${base(p)}?tab=${tab}&limit=${limit}&offset=${offset}`, "NotificationPage", "GET", undefined, signal), limit, offset);
      value.items.forEach((item) => notice(item, p));
      return value;
    },
    async unreadCount(p, signal) {
      return owned(await request(`${base(p)}/unread-count`, "UnreadCount", "GET", undefined, signal), p);
    },
    async refresh(p, signal) {
      return owned(await request(`${base(p)}/refresh`, "RefreshResult", "POST", undefined, signal), p);
    },
    async get(p, id, signal) {
      return notice(await request(`${base(p)}/${requireUuid(id)}`, "NotificationRead", "GET", undefined, signal), p, id);
    },
    async transition(p, id, input, signal) {
      const path = `${base(p)}/${requireUuid(id)}/transitions`;
      return notice(await request(path, "NotificationRead", "POST", notificationInput("NotificationTransition", input), signal), p, id);
    },
    async addProgressNote(p, id, input, signal) {
      const path = `${base(p)}/${requireUuid(id)}/progress-notes`;
      return notice(await request(path, "NotificationRead", "POST", notificationInput("ProgressNoteCreate", input), signal), p, id);
    },
    async events(p, query: NotificationEventQuery = {}, signal) {
      const { limit, offset } = pageQuery(query);
      const filter = query.notificationId ? `&notification_id=${requireUuid(query.notificationId).toLowerCase()}` : "";
      return paged(
        await request(`${base(p)}/events?limit=${limit}&offset=${offset}${filter}`, "NotificationEventPage", "GET", undefined, signal),
        limit,
        offset,
      );
    },
  };
}
