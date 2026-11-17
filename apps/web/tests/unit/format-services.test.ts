import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createServices } from "../../src/services/index.ts";
import { canonicalEditorJson } from "../../src/lab/state/editorAdapter.ts";
import { validateSourceGuardContract } from "../../src/services/validation.ts";
import { requireLegacyContent } from "../../src/services/documentContent.ts";

const encode = (value: string) => btoa(String.fromCharCode(...new TextEncoder().encode(value)));
const command = () => crypto.randomUUID();
afterEach(() => vi.useRealTimers());
async function fixture() {
  vi.useFakeTimers();
  const api = createServices({ mode: "mock", instanceId: "format-test" });
  const p = (await api.projects.create({ name: "合成格式项目" })).id;
  async function upload(text: string, kind: "other" | "requirements") {
    const receipt = await api.materials.upload(
      p,
      { name: "合成原稿", filename: "synthetic.txt", file_type: "text", kind, content_base64: encode(text) },
      command(),
    );
    await vi.advanceTimersByTimeAsync(2500);
    const job = await api.jobs.get(receipt.job.id);
    if (job.result?.kind !== "material_parse") throw Error("Synthetic parse failed");
    return { material_id: receipt.material.id, original_version_id: receipt.original.id, parse_version_id: job.result.parse_version_id };
  }
  const source = await upload("Synthetic manuscript 42.", "other");
  const imported = await api.documentSources.import(p, { ...source, command_id: command() });
  const d = imported.document_id;
  const rule = await upload("段落对齐：居中", "requirements");
  await api.materials.updateSourceBinding(p, { expected_version: 0, template_parse_version_id: null, requirement_parse_version_ids: [rule.parse_version_id] });
  const context = await api.formatRevisions.context(p, d);
  const input = {
    command_id: command(),
    base_version: context.document_version,
    binding_version_id: context.binding_version_id,
    source_guard_digest: context.source_guard_digest,
    selections: [{ rule_id: context.rules[0]!.id, target_anchor_ids: [context.targets[0]!.anchor_id] }],
  };
  return { api, p, d, context, input };
}
describe("SG19受控格式同契约", () => {
  it("paragraph默认null省略并保持旧JSON与hash输入，未知格式明确拒绝", () => {
    const json = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "合成正文" }] }] };
    expect(canonicalEditorJson(json)).toEqual(json);
    expect(canonicalEditorJson({ ...json, content: [{ ...json.content[0], attrs: { alignment: null } }] })).toEqual(json);
    expect(() => canonicalEditorJson({ ...json, content: [{ ...json.content[0], attrs: { alignment: "unsafe" } }] })).toThrow();
  });
  it("固定字面规则构建候选，未审阅拒绝采纳；逐项接受原子写正文和v2来源，撤销同步恢复", async () => {
    const { api, p, d, input, context } = await fixture();
    expect(context.rules[0]).toMatchObject({ field: "alignment", value: "center", evidence: "段落对齐：居中" });
    const created = await api.formatRevisions.create(p, d, input);
    expect(await api.formatRevisions.create(p, d, input)).toEqual(created);
    await expect(
      api.formatRevisions.apply(p, d, created.candidate_id, { command_id: command(), expected_revision: 1, expected_document_version: 1 }),
    ).rejects.toMatchObject({ code: "FORMAT_DECISION_REQUIRED" });
    const candidate = await api.formatRevisions.get(p, d, created.candidate_id);
    const decided = await api.formatRevisions.decide(p, d, candidate.id, {
      command_id: command(),
      expected_revision: 1,
      decisions: candidate.patches.map((patch) => ({ patch_id: patch.id, decision: "accept" })),
    });
    const applied = await api.formatRevisions.apply(p, d, candidate.id, {
      command_id: command(),
      expected_revision: decided.candidate_revision,
      expected_document_version: 1,
    });
    expect(applied.result_version).toBe(2);
    const formatted = await api.documents.current(p);
    expect(requireLegacyContent(formatted.content).json.content).toMatchObject([{ attrs: { alignment: "center" } }]);
    const source = await api.documentSources.current(p, d, 2);
    expect(source.guard_version).toBe("source-projection-v2");
    expect(source.guard_contract.format_overrides).toMatchObject([{ original_attrs: null, target_attrs: { alignment: "center" } }]);
    const rogue = structuredClone(requireLegacyContent(formatted.content));
    (rogue.json.content as { attrs: object }[])[0]!.attrs = { alignment: "right" };
    await expect(api.documents.save(p, d, { expected_version: 2, content: rogue })).rejects.toMatchObject({ code: "DOCUMENT_SOURCE_PROTECTED" });
    await api.formatRevisions.undo(p, d, applied.command_id, { command_id: command(), expected_document_version: 2 });
    expect((await api.documents.current(p)).content).toEqual((await api.documents.version(p, d, 1)).content);
    expect((await api.documentSources.current(p, d, 3)).guard_version).toBe("source-projection-v1");
  });
  it("正文或来源版本变更使候选不可采纳，未知规则和任意patch不能透传", async () => {
    const { api, p, d, input } = await fixture();
    await expect(
      api.formatRevisions.create(p, d, { ...input, selections: [{ rule_id: "unknown", target_anchor_ids: ["mock-text-1"] }] }),
    ).rejects.toMatchObject({ code: "FORMAT_RULE_INVALID" });
    await expect(api.formatRevisions.create(p, d, { ...input, patches: [] } as never)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const created = await api.formatRevisions.create(p, d, input);
    const current = await api.documents.current(p);
    await api.documents.save(p, d, { expected_version: 1, content: current.content });
    expect((await api.formatRevisions.get(p, d, created.candidate_id)).applicable).toBe(false);
    await expect(api.formatRevisions.create(p, d, { ...input, command_id: command() })).rejects.toMatchObject({ code: "FORMAT_STALE" });
  });
  it("格式历史恢复同时恢复guard，后续普通保存仍拒绝越权格式", async () => {
    const { api, p, d, input } = await fixture();
    const created = await api.formatRevisions.create(p, d, input);
    const candidate = await api.formatRevisions.get(p, d, created.candidate_id);
    const decided = await api.formatRevisions.decide(p, d, candidate.id, {
      command_id: command(),
      expected_revision: 1,
      decisions: candidate.patches.map((patch) => ({ patch_id: patch.id, decision: "accept" })),
    });
    await api.formatRevisions.apply(p, d, candidate.id, { command_id: command(), expected_revision: decided.candidate_revision, expected_document_version: 1 });
    await api.revisions.revert(p, d, { command_id: command(), expected_document_version: 2, target_version: 1 });
    expect((await api.documentSources.current(p, d, 3)).guard_version).toBe("source-projection-v1");
    await api.revisions.revert(p, d, { command_id: command(), expected_document_version: 3, target_version: 2 });
    expect((await api.documentSources.current(p, d, 4)).guard_version).toBe("source-projection-v2");
  });
  it("来源v2只接受精确格式覆盖，chapterId及未知字段不得被授权改写", async () => {
    const { api, p, d } = await fixture();
    const source = await api.documentSources.current(p, d, 1);
    const forged = {
      ...source,
      guard_version: "source-projection-v2",
      guard_contract: {
        ...source.guard_contract,
        schema_version: 2,
        guard_version: "source-projection-v2",
        format_overrides: [
          {
            anchor_id: "mock-text-1",
            editor_path: [0],
            node_type: "paragraph",
            original_attrs: null,
            target_attrs: { chapterId: "injected", alignment: "center" },
          },
        ],
      },
    };
    expect(() => validateSourceGuardContract(forged)).toThrow();
  });
});
