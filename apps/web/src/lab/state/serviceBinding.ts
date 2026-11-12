import type { ProjectRead } from "../../services/index.ts";

export interface RemoteProjectBinding {
  sourceKey: string;
  projectId: string;
  metadataVersion: number;
  createdAt: string;
  updatedAt: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const source = /^(mock|http):[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const timestamp = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));

export function validateRemoteBinding(value: unknown): value is RemoteProjectBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return (
    Object.keys(binding).length === 5 &&
    typeof binding.sourceKey === "string" &&
    source.test(binding.sourceKey) &&
    typeof binding.projectId === "string" &&
    uuid.test(binding.projectId) &&
    Number.isSafeInteger(binding.metadataVersion) &&
    Number(binding.metadataVersion) >= 1 &&
    timestamp(binding.createdAt) &&
    timestamp(binding.updatedAt)
  );
}

export function createRemoteBinding(project: ProjectRead, sourceKey: string): RemoteProjectBinding {
  const binding = {
    sourceKey,
    projectId: project.id,
    metadataVersion: project.version,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
  if (!validateRemoteBinding(binding)) throw new Error("项目关联无效，请重新读取服务端项目。");
  return binding;
}
