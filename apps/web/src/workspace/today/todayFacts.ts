import type { BackendServices, DocumentRead, TaskSummary } from "../../services/index.ts";
import { ApiError, asApiError } from "../../services/errors.ts";

type Node = { type?: string; text?: string; content?: Node[] };
const REFERENCES = /^(?:\d*[.、\s]*)?参考文献\s*$/u;
const nodeText = (node: Node): string => node.text ?? (node.content ?? []).map(nodeText).join("");

/**
 * Same counting rule as the writing page (`thesisWordCount` over editor HTML): body text only,
 * headings and tables excluded, everything from a “参考文献” heading on excluded, non-whitespace characters.
 */
export function manuscriptCharacters(content: DocumentRead["content"]): number {
  let count = 0;
  let stopped = false;
  const visit = (node: Node) => {
    if (stopped) return;
    if (node.type === "heading") {
      if (REFERENCES.test(nodeText(node).trim())) stopped = true;
      return;
    }
    if (node.type === "table") return;
    if (typeof node.text === "string") for (const character of node.text) if (!/\s/u.test(character)) count += 1;
    for (const child of node.content ?? []) visit(child);
  };
  visit(content.json as Node);
  return count;
}

function calendarDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / 86_400_000 : null;
}

export function shanghaiDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export interface StageClock {
  known: boolean;
  days: number | null;
  percent: number | null;
  since: string | null;
}

/** Elapsed time in the current stage: entry record first, configured stage start second; never invented. */
export function stageClock(enteredAt: string | null | undefined, start: string | null | undefined, deadline: string | null | undefined, now: Date): StageClock {
  const since = enteredAt ? shanghaiDate(new Date(enteredAt)) : (start ?? null);
  const from = since ? calendarDay(since) : null;
  const today = Number.isFinite(now.getTime()) ? calendarDay(shanghaiDate(now)) : null;
  if (from === null || today === null) return { known: false, days: null, percent: null, since: null };
  const days = Math.max(0, today - from);
  const end = deadline ? calendarDay(deadline) : null;
  const percent = end !== null && end > from ? Math.min(100, Math.max(0, Math.round(((today - from) / (end - from)) * 100))) : null;
  return { known: true, days, percent, since };
}

/** Three nearest unconfirmed tasks; undated tasks follow dated ones in board order. */
export function nextTasks(items: TaskSummary[], limit = 3): TaskSummary[] {
  return items
    .filter((item) => item.status !== "confirmed" && !item.archived)
    .sort((a, b) => (a.due_date ?? "9999-99-99").localeCompare(b.due_date ?? "9999-99-99") || a.position - b.position)
    .slice(0, limit);
}

export async function loadAllTasks(services: BackendServices, projectId: string, signal: AbortSignal): Promise<TaskSummary[]> {
  const result: TaskSummary[] = [];
  let board: number | undefined;
  for (let offset = 0; ;) {
    const page = await services.tasks.list(projectId, { limit: 100, offset }, signal);
    if (board !== undefined && board !== page.board_version) throw new ApiError("TASK_BOARD_CONFLICT", { status: 409 });
    board = page.board_version;
    result.push(...page.items);
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) return result;
  }
}

export async function loadDocument(services: BackendServices, projectId: string, signal: AbortSignal): Promise<DocumentRead | null> {
  try {
    return await services.documents.current(projectId, signal);
  } catch (error) {
    if (asApiError(error).code === "DOCUMENT_NOT_FOUND") return null;
    throw error;
  }
}

export interface DecisionSource {
  kind: "revision" | "format" | "feedback";
  count: number;
  capped: boolean;
  error: string;
  target?: { batch: string; item: string };
}

const CAP = 200;
async function countPaged<T>(read: (offset: number) => Promise<{ items: T[]; total: number }>, match: (item: T) => boolean) {
  let count = 0;
  for (let offset = 0; ;) {
    const page = await read(offset);
    count += page.items.filter(match).length;
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) return { count, capped: false };
    if (offset >= CAP) return { count, capped: true };
  }
}

async function settle(kind: DecisionSource["kind"], work: () => Promise<Omit<DecisionSource, "kind" | "error">>): Promise<DecisionSource> {
  try {
    return { kind, error: "", ...(await work()) };
  } catch (error) {
    if (asApiError(error).code === "REQUEST_CANCELLED") throw error;
    return { kind, count: 0, capped: false, error: asApiError(error).message };
  }
}

/** Only sources with a real API: pending manuscript revisions, format candidates and open feedback items. */
export async function loadDecisions(services: BackendServices, projectId: string, documentId: string | null, signal: AbortSignal): Promise<DecisionSource[]> {
  const revision = settle("revision", () =>
    documentId
      ? countPaged(
          (offset) => services.revisions.list(projectId, documentId, { limit: 50, offset }, signal),
          (item) => item.status === "ready",
        )
      : Promise.resolve({ count: 0, capped: false }),
  );
  const format = settle("format", () =>
    documentId
      ? countPaged(
          (offset) => services.formatRevisions.list(projectId, documentId, { limit: 50, offset }, signal),
          (item) => item.status === "ready",
        )
      : Promise.resolve({ count: 0, capped: false }),
  );
  const feedback = settle("feedback", async () => {
    let count = 0;
    let capped = false;
    let target: DecisionSource["target"];
    for (let offset = 0; ;) {
      const batches = await services.feedback.list(projectId, { limit: 100, offset }, signal);
      for (const batch of batches.items) {
        for (let itemOffset = 0; ;) {
          const items = await services.feedback.items(projectId, batch.id, { limit: 100, offset: itemOffset }, signal);
          for (const item of items.items.filter((entry) => entry.status === "open")) {
            count += 1;
            target ??= { batch: batch.id, item: item.id };
          }
          itemOffset += items.items.length;
          if (!items.items.length || itemOffset >= items.total) break;
          if (itemOffset >= CAP) {
            capped = true;
            break;
          }
        }
      }
      offset += batches.items.length;
      if (!batches.items.length || offset >= batches.total) break;
      if (offset >= CAP) {
        capped = true;
        break;
      }
    }
    return { count, capped, ...(target ? { target } : {}) };
  });
  return Promise.all([revision, format, feedback]);
}
