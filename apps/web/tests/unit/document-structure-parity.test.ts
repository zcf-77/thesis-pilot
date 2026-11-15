import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { prepareEditorSnapshot } from "../../src/lab/state/editorAdapter.ts";

interface StructureCase {
  name: string;
  valid: boolean;
  json: unknown;
  canonical?: unknown;
}

const cases = JSON.parse(readFileSync(new URL("../../../api/tests/fixtures/document-structure.json", import.meta.url), "utf-8")) as StructureCase[];

describe("正文结构与后端共用样例", () => {
  it.each(cases)("$name", ({ valid, json, canonical }) => {
    const input = { schemaVersion: 1, json: structuredClone(json), chapters: [] };
    if (valid) {
      const prepared = prepareEditorSnapshot(input);
      expect(prepared.json).toEqual(canonical ?? json);
      expect(prepareEditorSnapshot(prepared)).toEqual(prepared);
    } else {
      expect(() => prepareEditorSnapshot(input)).toThrow();
    }
    expect(input.json).toEqual(json);
  });
});
