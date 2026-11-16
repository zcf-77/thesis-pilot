import type { ProjectCreate, ProjectRead, ProjectUpdate } from "../../services/index.ts";

/** Project fields entered in the first-time setup and in project settings. */
export interface ProjectDraft {
  name: string;
  title: string;
  deadline: string;
  planning_mode: "none" | "personal";
  plan_note: string;
  existing_artifacts: string;
  flow_version_id: string;
  stage_id: string;
}

export const setupSteps = [
  { id: "basics", label: "题目与截止" },
  { id: "flow", label: "流程与阶段" },
  { id: "plan", label: "规划方式" },
  { id: "sources", label: "模板与要求" },
  { id: "start", label: "正文起点" },
] as const;
export type SetupStep = (typeof setupSteps)[number]["id"];

export function emptyDraft(): ProjectDraft {
  return { name: "", title: "", deadline: "", planning_mode: "none", plan_note: "", existing_artifacts: "", flow_version_id: "", stage_id: "" };
}

export function draftOf(project: ProjectRead): ProjectDraft {
  return {
    name: project.name,
    title: project.title,
    deadline: project.deadline ?? "",
    planning_mode: project.planning_mode,
    plan_note: project.plan_note,
    existing_artifacts: project.existing_artifacts,
    flow_version_id: project.flow_version_id ?? "",
    stage_id: project.stage_id ?? "",
  };
}

export function projectNameError(name: string) {
  const value = name.trim();
  return value && Array.from(value).length <= 200 ? "" : "请输入 1 至 200 个字符的项目名称。";
}

function normalized(draft: ProjectDraft) {
  return {
    name: draft.name.trim(),
    title: draft.title.trim(),
    deadline: draft.deadline || null,
    planning_mode: draft.planning_mode,
    plan_note: draft.plan_note.trim(),
    existing_artifacts: draft.existing_artifacts.trim(),
    flow_version_id: draft.flow_version_id || null,
    stage_id: draft.stage_id || null,
  };
}

export function createPayload(draft: ProjectDraft): ProjectCreate {
  return normalized(draft);
}

/** Only the fields that differ from the stored project, so a resumed setup never rewrites untouched metadata. */
export function changedFields(draft: ProjectDraft, project: ProjectRead): Omit<ProjectUpdate, "expected_version"> | null {
  const next = normalized(draft);
  const stored = normalized(draftOf(project));
  const changes = Object.fromEntries((Object.keys(next) as (keyof typeof next)[]).filter((key) => next[key] !== stored[key]).map((key) => [key, next[key]]));
  return Object.keys(changes).length ? changes : null;
}

/**
 * After an unconfirmed create, the refreshed directory may already hold the project.
 * Match it by exact name and creation time so the setup continues instead of creating a duplicate.
 */
export function findCreatedProject(items: readonly ProjectRead[], name: string, since: number, skewMs = 120_000) {
  const value = name.trim();
  return items
    .filter((item) => item.name === value && !item.archived && Date.parse(item.created_at) >= since - skewMs)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}

/** Unknown outcomes (network, 5xx, malformed response) must be verified before retrying a create. */
export function isUncertain(problem: { status?: number; code: string }) {
  return problem.status === undefined || problem.status >= 500 || problem.code === "INVALID_RESPONSE";
}
