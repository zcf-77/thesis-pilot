export interface FormatTarget {
  anchor_id: string;
  kind: string;
  title: string;
}
export interface FormatRule {
  field: string;
  scope: string;
}
export interface FormatCandidateState {
  base_version: number;
  status: string;
  applicable: boolean;
}
export function compatibleFormatTargets<T extends FormatTarget>(targets: readonly T[], rule?: FormatRule): T[] {
  if (!rule) return [];
  const kind = rule.scope;
  if (kind !== "heading" && kind !== "paragraph") return [];
  if ((kind === "paragraph" && rule.field !== "alignment") || (kind === "heading" && !["level", "templateAlign", "templateWeight"].includes(rule.field)))
    return [];
  return targets.filter((target) => target.kind === kind);
}
export function formatCandidateCurrent(candidate: FormatCandidateState, version: number, editable: boolean): boolean {
  return editable && candidate.status === "ready" && candidate.applicable && candidate.base_version === version;
}
const names: Record<string, string> = { level: "标题层级", templateAlign: "标题对齐", templateWeight: "标题字重", alignment: "段落对齐" };
export function formatFieldLabel(field: string): string {
  return names[field] ?? field;
}
export function formatValueLabel(field: string, value: unknown): string {
  if (value === null || value === undefined) return "未设置（沿用正文样式）";
  if (typeof value !== "string" && typeof value !== "number") return "无法解析的格式值";
  if (field === "level") return `${String(value)} 级标题`;
  return (
    (
      {
        left: "左对齐",
        start: "左对齐",
        center: "居中",
        right: "右对齐",
        end: "右对齐",
        justify: "两端对齐",
        "600": "半粗体 600",
        "700": "粗体 700",
      } as Record<string, string>
    )[String(value)] ?? String(value)
  );
}
