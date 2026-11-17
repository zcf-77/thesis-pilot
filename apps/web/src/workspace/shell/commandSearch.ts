import type { BackendServices, ProjectRead } from "../../services/index.ts";
import { ApiError, asApiError } from "../../services/errors.ts";

const PAGE = 100;
const MAX_ROWS = 2000;

export interface SearchRow {
  id: string;
  label: string;
  detail?: string;
}

export interface DocumentHeading {
  chapterId: string;
  level: number;
  title: string;
}

interface EditorNode {
  type?: unknown;
  text?: unknown;
  attrs?: unknown;
  content?: unknown;
}

function nodeText(node: EditorNode): string {
  if (typeof node.text === "string") return node.text;
  return Array.isArray(node.content) ? node.content.map((child) => nodeText(child as EditorNode)).join("") : "";
}

/** Headings carry a stable chapter identity; untitled headings stay searchable under a neutral name. */
export function documentHeadings(json: unknown): DocumentHeading[] {
  const found: DocumentHeading[] = [];
  const pending: EditorNode[] = [json as EditorNode];
  while (pending.length) {
    const node = pending.shift();
    if (!node || typeof node !== "object") continue;
    const attrs = (node.attrs ?? {}) as { chapterId?: unknown; level?: unknown };
    if (node.type === "heading" && typeof attrs.chapterId === "string") {
      found.push({ chapterId: attrs.chapterId, level: typeof attrs.level === "number" ? attrs.level : 1, title: nodeText(node).trim() || "未命名章节" });
      continue;
    }
    if (Array.isArray(node.content)) pending.push(...(node.content as EditorNode[]));
  }
  return found;
}

async function collect<T>(load: (offset: number) => Promise<{ items: T[]; offset: number; total: number }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ;) {
    const page = await load(offset);
    if (page.offset !== offset || page.items.length > PAGE) throw new ApiError("INVALID_RESPONSE");
    rows.push(...page.items);
    offset += page.items.length;
    if (!page.items.length || offset >= page.total || rows.length >= MAX_ROWS) return rows;
  }
}

type Services = Pick<BackendServices, "projects" | "tasks" | "materials" | "documents">;

export const searchSources = ["tasks", "materials", "chapters", "projects"] as const;
export type SearchSource = (typeof searchSources)[number];

/** Each source is read once per palette visit and belongs to the project it was read for. */
export async function loadSearchSource(services: Services, source: SearchSource, projectId: string | undefined, signal: AbortSignal): Promise<SearchRow[]> {
  if (source === "projects") {
    const projects = await collect<ProjectRead>((offset) => services.projects.list({ offset, limit: PAGE }, signal));
    return projects.map((project) => ({ id: project.id, label: project.name, detail: project.archived ? "已归档" : undefined }));
  }
  if (!projectId) return [];
  if (source === "tasks") {
    const tasks = await collect((offset) => services.tasks.list(projectId, { offset, limit: PAGE }, signal));
    if (tasks.some((task) => task.project_id !== projectId)) throw new ApiError("INVALID_RESPONSE");
    return tasks.map((task) => ({ id: task.id, label: task.title, detail: task.archived ? "已归档" : undefined }));
  }
  if (source === "materials") {
    const materials = await collect((offset) => services.materials.list(projectId, { offset, limit: PAGE }, signal));
    if (materials.some((material) => material.project_id !== projectId)) throw new ApiError("INVALID_RESPONSE");
    return materials.map((material) => ({ id: material.id, label: material.name }));
  }
  try {
    const document = await services.documents.current(projectId, signal);
    if (document.project_id !== projectId) throw new ApiError("INVALID_RESPONSE");
    // v2 snapshots carry derived chapters (id = heading block id); v1 keeps its chapterId headings.
    const headings =
      document.content.schema_version === 2
        ? (document.content.json.chapters ?? []).map((chapter) => ({ chapterId: chapter.id, title: chapter.title.trim() || "未命名章节" }))
        : documentHeadings(document.content.json);
    return headings.map((heading) => ({ id: heading.chapterId, label: heading.title }));
  } catch (error) {
    if (asApiError(error).code === "DOCUMENT_NOT_FOUND") return [];
    throw error;
  }
}

export function matchRows(rows: SearchRow[], needle: string, limit = 6): SearchRow[] {
  if (!needle) return [];
  return rows.filter((row) => row.label.toLocaleLowerCase().includes(needle)).slice(0, limit);
}
