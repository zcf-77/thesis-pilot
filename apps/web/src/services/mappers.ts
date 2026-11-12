import type { JobRead, ProjectRead } from "./contracts/api.generated.ts";

export function toProjectView(project: ProjectRead) {
  return {
    id: project.id,
    title: project.name,
    metadataVersion: project.version,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

export function toJobView(job: JobRead) {
  return {
    id: job.id,
    projectId: job.project_id,
    kind: job.kind,
    status: job.status === "succeeded" ? ("done" as const) : job.status,
    attempt: job.attempt,
    result: job.result,
    errorCode: job.error_code,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}
