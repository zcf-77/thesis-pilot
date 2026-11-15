import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import type { RevisionPatch, RevisionSelection } from "../../src/services/contracts/api.generated.ts";
import type { DocumentContent } from "../../src/services/documentContent.ts";
import { evaluateRevisionProtection, REVISION_POLICY } from "../../src/services/revisionProtection.ts";

interface Case {
  id: string;
  title: string;
  kind: "protection" | "scenario";
  variant_id?: string;
  human_review: { status: string };
  document: DocumentContent;
  selection: RevisionSelection;
  patches: RevisionPatch[];
  base_version: number;
  current_version: number;
  expected: {
    allowed: boolean;
    error_code: string | null;
    failed_rules: string[];
    unsupported_rules: string[];
    result_json?: unknown;
  };
  variants?: Case[];
}

const fixtures = JSON.parse(readFileSync(new URL("../../../api/tests/fixtures/revision-protection.json", import.meta.url), "utf8")) as {
  schema_version: number;
  policy_version: string;
  cases: Case[];
};

describe("正式稿前后端共用保护样例", () => {
  it("使用当前策略的统一样例数据", () => {
    expect(fixtures.schema_version).toBe(1);
    expect(fixtures.policy_version).toBe(REVISION_POLICY);
    expect(new Set(fixtures.cases.map((entry) => entry.id)).size).toBe(fixtures.cases.length);
  });

  for (const fixture of fixtures.cases.filter((entry) => entry.kind === "protection")) {
    for (const sample of [fixture, ...(fixture.variants ?? [])]) {
      it([fixture.id, fixture.title, sample.variant_id].filter(Boolean).join(" "), () => {
        const evaluate = () => evaluateRevisionProtection(sample.document, sample.selection, sample.patches, sample.base_version, sample.current_version);
        if (sample.expected.error_code) {
          expect(evaluate).toThrow(expect.objectContaining({ code: sample.expected.error_code }));
          return;
        }
        const result = evaluate();
        expect(result.content !== null).toBe(sample.expected.allowed);
        const rejected = result.checks.filter((item) => item.result === "fail").map((item) => item.rule);
        const unsupported = result.checks.filter((item) => item.result === "unsupported").map((item) => item.rule);
        expect(rejected).toEqual(expect.arrayContaining(sample.expected.failed_rules));
        expect(unsupported).toEqual(expect.arrayContaining(sample.expected.unsupported_rules));
        if (sample.expected.result_json) expect(result.content?.json).toEqual(sample.expected.result_json);
      });
    }
  }
});
