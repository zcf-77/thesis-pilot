export interface ImportChapter {
  anchor_id: string;
  kind: "heading" | "paragraph";
  level: number | null;
  editable: boolean;
  allowed_kinds: ("heading" | "paragraph")[];
}
export interface ChapterDraft {
  kind: "heading" | "paragraph";
  level: number;
}
export function chapterCorrections(chapters: readonly ImportChapter[], drafts: Record<string, ChapterDraft>) {
  const corrections: { anchor_id: string; kind: "heading" | "paragraph"; level: number | null }[] = [];
  for (const chapter of chapters) {
    const draft = drafts[chapter.anchor_id];
    if (!draft) continue;
    const level = draft.kind === "heading" ? draft.level : null;
    if (draft.kind === chapter.kind && level === chapter.level) continue;
    if (!chapter.editable || !chapter.allowed_kinds.includes(draft.kind)) throw new Error("该来源章节不支持这项校正，请保留原类型。");
    if (draft.kind === "heading" && (!Number.isInteger(draft.level) || draft.level < 1 || draft.level > 6)) throw new Error("标题级别必须为 1 至 6。");
    corrections.push({ anchor_id: chapter.anchor_id, kind: draft.kind, level });
  }
  if (corrections.length > 1000) throw new Error("一次最多校正 1000 个章节。");
  return corrections;
}
export function sourceEditablePaths(source: unknown): number[][] | undefined {
  if (!source || typeof source !== "object" || Array.isArray(source) || !("guard_contract" in source)) return;
  const contract = source.guard_contract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return;
  const record = contract as Record<string, unknown>;
  if (record.schema_version !== 1 || record.guard_version !== "source-projection-v1" || !Array.isArray(record.editable_paths)) return;
  if (
    record.editable_paths.some(
      (path) => !Array.isArray(path) || !path.length || path.length > 80 || path.some((index) => !Number.isSafeInteger(index) || Number(index) < 0),
    )
  )
    return;
  const paths = record.editable_paths as number[][];
  if (new Set(paths.map((path) => JSON.stringify(path))).size !== paths.length) return;
  return paths.map((path) => [...path]);
}
