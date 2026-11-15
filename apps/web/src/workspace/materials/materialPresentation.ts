export const MAX_MATERIAL_BYTES = 8 * 1024 * 1024;
export type MaterialFormat = "docx" | "text" | "pdf";
export const materialCategories = [
  { value: "template", label: "论文模板" },
  { value: "requirements", label: "论文要求" },
  { value: "literature", label: "文献资料" },
  { value: "other", label: "其他资料" },
];

export function materialFormat(file: { name: string; type: string }): MaterialFormat | undefined {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension === "docx") return "docx";
  if (extension === "pdf") return "pdf";
  if (["txt", "text", "md"].includes(extension ?? "") || file.type === "text/plain") return "text";
  return undefined;
}

export function materialFileError(file: { name: string; size: number; type: string }): string {
  if (
    Array.from(file.name).length > 255 ||
    /[\\/:]/.test(file.name) ||
    Array.from(file.name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return "文件名不能超过 255 个字符，且不能包含路径或控制字符。";
  if (file.size < 1) return "文件为空，请选择包含内容的文件。";
  if (file.size > MAX_MATERIAL_BYTES) return "文件超过 8 MiB，请选择更小的文件。";
  if (!materialFormat(file)) return "请选择 DOCX、UTF-8 文本或 PDF 文件。";
  return "";
}

export function materialSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MiB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} B`;
}

export function materialTaskMatches(
  job: { project_id: string; resource_scope?: unknown; input_snapshot?: unknown },
  projectId: string,
  originalId: string,
): boolean {
  const scope = job.resource_scope ?? job.input_snapshot;
  return (
    job.project_id === projectId &&
    !!scope &&
    typeof scope === "object" &&
    !Array.isArray(scope) &&
    "original_version_id" in scope &&
    scope.original_version_id === originalId
  );
}

export function bytesToBase64(bytes: Uint8Array): string {
  let raw = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) raw += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(raw);
}

export function taskUpdateAllowed(
  current: { id: string; status: string; updated_at: string } | undefined,
  next: { id: string; status: string; updated_at: string },
): boolean {
  if (!current || current.id !== next.id) return true;
  const active = (status: string) => status === "queued" || status === "running";
  return Date.parse(next.updated_at) >= Date.parse(current.updated_at) && (active(current.status) || !active(next.status));
}
