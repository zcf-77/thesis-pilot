import type { LiteratureEntry, LiteratureResult } from "./useLiterature.ts";

type SourceRecord = LiteratureResult | LiteratureEntry["record"];
type Tone = "success" | "warning" | "danger" | "ghost" | "info";

/** Only fields the source returned; missing values are left out instead of guessed. */
export function literatureMeta(record: SourceRecord): string {
  const authors = record.authors.length > 3 ? `${record.authors.slice(0, 3).join("、")} 等` : record.authors.join("、");
  return [authors, record.year?.toString(), record.venue].filter(Boolean).join(" · ") || "来源未提供作者、年份与刊名";
}

export const coverageLabel = (record: SourceRecord) => (record.coverage === "abstract" ? "题录与摘要" : "仅题录");

export function verificationView(entry: LiteratureEntry): { tone: Tone; label: string; note: string } {
  const detail = entry.verification_detail;
  switch (entry.verification) {
    case "verified":
      return { tone: "success", label: "DOI 已回查", note: "Crossref 登记的题名与年份与本条一致。" };
    case "conflict":
      return {
        tone: "warning",
        label: "题录冲突",
        note:
          detail.reason === "year_mismatch"
            ? `登记年份为 ${detail.registry_year ?? "未提供"}，与本条不一致；引用前请核对原文。`
            : `登记题名为“${detail.registry_title ?? "未提供"}”，与本条不一致；引用前请核对原文。`,
      };
    case "not_found":
      return { tone: "danger", label: "DOI 未登记", note: "Crossref 中查不到这个 DOI；不能把它当作已核实来源。" };
    default:
      return {
        tone: "ghost",
        label: "未核实",
        note: detail.reason === "no_doi" ? "来源没有提供 DOI，无法回查；引用前请自行核对出处。" : "回查时来源暂不可用，本条保持未核实；可稍后重新核验。",
      };
  }
}

export const versionActionLabel: Record<string, string> = {
  saved: "保存到项目文献",
  verified: "重新核验",
  removed: "移出项目文献",
  restored: "恢复到项目文献",
};

export function formatInstant(value: string): string {
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
