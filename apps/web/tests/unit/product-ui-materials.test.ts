import { describe, expect, it } from "vite-plus/test";
import type { LiteratureEntry } from "../../src/workspace/materials/useLiterature.ts";
import { coverageLabel, coverageNote, literatureMeta } from "../../src/workspace/materials/literaturePresentation.ts";

function record(coverage: "biblio" | "abstract", abstract: string | null): LiteratureEntry["record"] {
  return {
    source: "crossref",
    source_id: "synthetic-source",
    doi: null,
    title: "自制文献题名",
    authors: [],
    year: null,
    venue: null,
    publisher: null,
    work_type: null,
    abstract,
    source_url: null,
    coverage,
  };
}

describe("资料页文献取得范围呈现", () => {
  it("仅题录时不暗示已取得摘要或全文，缺失题录字段也不补造", () => {
    const item = record("biblio", null);
    expect(coverageLabel(item)).toBe("仅题录");
    expect(coverageNote(item)).toBe("仅取得题录；摘要未取得，全文未取得。");
    expect(coverageNote(item)).not.toContain("已取得题录与摘要");
    expect(literatureMeta(item)).toBe("来源未提供作者、年份与刊名");
  });

  it("有摘要时仍明确全文未取得，不能把摘要当作研究结论依据", () => {
    const item = record("abstract", "自制摘要");
    expect(coverageLabel(item)).toBe("题录与摘要");
    expect(coverageNote(item)).toContain("已取得题录与摘要");
    expect(coverageNote(item)).toContain("全文未取得");
    expect(coverageNote(item)).toContain("页码与结论仍需从原文核对");
  });
});
