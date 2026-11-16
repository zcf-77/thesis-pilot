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

export type MaterialKind = "template" | "requirements" | "literature" | "other";
export type MaterialTab = "materials" | "templates" | "requirements" | "literature";
export const tabKind: Record<MaterialTab, MaterialKind | undefined> = {
  materials: undefined,
  templates: "template",
  requirements: "requirements",
  literature: "literature",
};

export function materialExtension(filename: string | undefined): string {
  const extension = filename?.includes(".") ? filename.split(".").at(-1) : undefined;
  return (extension || "file").slice(0, 5).toUpperCase();
}

export function materialStem(filename: string): string {
  return Array.from(filename.replace(/\.[^.]+$/, "").trim() || filename)
    .slice(0, 200)
    .join("");
}

type ParseTone = "neutral" | "info" | "success" | "warning" | "danger" | "ghost";
export interface MaterialParseState {
  key: "loading" | "queued" | "running" | "complete" | "partial" | "failed" | "unsupported" | "cancelled" | "unknown";
  label: string;
  tone: ParseTone;
  live?: boolean;
  active: boolean;
}

/** Row and detail status come from the latest task for the original plus the newest parse summary. */
export function materialParseState(
  job: { status: string; error_code?: string | null } | undefined,
  summary: { status: "complete" | "partial" } | undefined,
  loading = false,
): MaterialParseState {
  if (job?.status === "queued") return { key: "queued", label: "等待解析", tone: "neutral", active: true };
  if (job?.status === "running") return { key: "running", label: "解析中", tone: "info", live: true, active: true };
  if (summary?.status === "complete") return { key: "complete", label: "解析成功", tone: "success", active: false };
  if (summary?.status === "partial") return { key: "partial", label: "部分识别", tone: "warning", active: false };
  if (job?.status === "failed" && job.error_code === "MATERIAL_UNSUPPORTED_TYPE")
    return { key: "unsupported", label: "暂不支持解析", tone: "ghost", active: false };
  if (job?.status === "failed") return { key: "failed", label: "解析失败", tone: "danger", active: false };
  if (job?.status === "cancelled") return { key: "cancelled", label: "已取消", tone: "ghost", active: false };
  if (loading) return { key: "loading", label: "读取中", tone: "neutral", active: false };
  return { key: "unknown", label: "状态未知", tone: "ghost", active: false };
}

export interface MaterialFragment {
  id: string;
  label: string;
  text: string;
  editable: boolean;
  markup: boolean;
}

const anchorKindLabel: Record<string, string> = {
  text: "行",
  paragraph: "段落",
  heading: "标题",
  table: "表格",
  formula: "公式",
  image: "图片",
  section: "分节设置",
  style: "样式",
};

/** Prefer source anchors as fragments so each excerpt stays traceable; fall back to numbered lines. */
export function materialFragments(result: {
  plain_text: string;
  anchors: { id: string; kind: string; part: string; line?: number | null; original_text: string; editable?: boolean }[];
}): MaterialFragment[] {
  if (result.anchors.length) {
    const seen = new Map<string, number>();
    return result.anchors
      .filter((anchor) => anchor.original_text.trim())
      .map((anchor) => {
        const index = (seen.get(anchor.kind) ?? 0) + 1;
        seen.set(anchor.kind, index);
        const kind = anchorKindLabel[anchor.kind] ?? "来源";
        return {
          id: anchor.id,
          label: anchor.line ? `第 ${anchor.line} 行` : `${kind} ${index}`,
          text: anchor.original_text,
          editable: anchor.editable !== false,
          markup: anchor.kind === "section" || anchor.kind === "style",
        };
      });
  }
  return result.plain_text
    .split("\n")
    .map((text, index) => ({ id: `line-${index + 1}`, label: `第 ${index + 1} 行`, text, editable: true, markup: false }))
    .filter((item) => item.text.trim());
}

const templateFieldLabel: Record<string, string> = {
  page_width: "纸张宽度",
  page_height: "纸张高度",
  page_orientation: "纸张方向",
  page_size: "纸张",
  margin_top: "上边距",
  margin_bottom: "下边距",
  margin_left: "左边距",
  margin_right: "右边距",
  margin_header: "页眉距离",
  margin_footer: "页脚距离",
  margin_gutter: "装订线",
  font_family: "字体",
  font_family_ascii: "西文字体",
  font_family_hAnsi: "西文字体（高位）",
  font_family_eastAsia: "中文字体",
  font_family_cs: "复杂文种字体",
  font_size: "字号",
  body_font: "正文字体",
  body_font_size: "正文字号",
  line_spacing: "行距",
  alignment: "对齐",
  outline_level: "大纲级别",
  spacing_before: "段前",
  spacing_after: "段后",
  spacing_line: "行距值",
  spacing_lineRule: "行距规则",
};
export const templateField = (field: string) => templateFieldLabel[field] ?? field;

/** Scopes are `kind:anchorId`; only the kind is meaningful to a reader, the anchor is reachable by link. */
export function templateScope(scope: string): string {
  const kind = scope.split(":")[0] ?? scope;
  return ({ body: "正文", document: "全文", references: "参考文献", title: "标题", ...anchorKindLabel } as Record<string, string>)[kind] ?? kind;
}

export function templateValue(item: { value: string | number | boolean | null; unit?: string | null }): string {
  if (item.value === null) return "—";
  if (typeof item.value === "number" && item.unit === "twip") return `${(item.value / 566.929).toFixed(2)} cm`;
  if (typeof item.value === "number" && item.unit === "half_point") return `${item.value / 2} 磅`;
  if (typeof item.value === "number" && item.unit === "zero_based") return `第 ${item.value + 1} 级`;
  if (item.unit === "raw_ooxml" || !item.unit) return String(item.value);
  return `${String(item.value)} ${item.unit}`;
}

export function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  const lower = text.toLowerCase();
  let offset = 0;
  for (let index = lower.indexOf(needle); index >= 0; index = lower.indexOf(needle, offset)) {
    if (index > offset) parts.push({ text: text.slice(offset, index), match: false });
    parts.push({ text: text.slice(index, index + needle.length), match: true });
    offset = index + needle.length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), match: false });
  return parts;
}

export const matchesQuery = (text: string, query: string) => !query.trim() || text.toLowerCase().includes(query.trim().toLowerCase());

export function materialTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
