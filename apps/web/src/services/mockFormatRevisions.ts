import type {
  FormatContext,
  FormatRead,
  FormatPatch,
  FormatRule,
  FormatCommandRead,
  JsonObject,
  MaterialRead,
  MaterialOriginalRead,
  MaterialParseRead,
  ProjectRead,
  ProjectSourceBindingRead,
} from "./contracts/api.generated.ts";
import type { FormatRevisionService } from "./types.ts";
import type { MockDocuments } from "./mockDocuments.ts";
import type { MockDocumentSources } from "./mockDocumentSources.ts";
import { ApiError, throwIfAborted } from "./errors.ts";
import { formatInput } from "./httpFormatRevisions.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

const clone = <T>(value: T): T => structuredClone(value);
const fail = (code: string, status = 409): never => {
  throw new ApiError(`FORMAT_${code}`, { status });
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (record(value))
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const hash = async (value: unknown) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value))))].map((b) => b.toString(16).padStart(2, "0")).join("");
type Node = { type: string; attrs?: JsonObject; content?: Node[] };
function at(json: unknown, path: number[]): Node {
  let node = json as Node;
  for (const index of path) {
    if (!node.content?.[index]) return fail("TARGET_INVALID", 422);
    node = node.content[index]!;
  }
  return node;
}
type Facts = { material: MaterialRead; original: MaterialOriginalRead; parse: MaterialParseRead };
function rules(data: Facts): FormatRule[] {
  const out: FormatRule[] = [];
  const align: Record<string, string> = { 左对齐: "left", 居中: "center", 右对齐: "right", 两端对齐: "justify" };
  const directives: [RegExp, FormatRule["field"], FormatRule["scope"]][] = [
    [/^标题层级[：:]\s*([1-6])$/u, "level", "heading"],
    [/^标题对齐[：:]\s*(左对齐|居中)$/u, "templateAlign", "heading"],
    [/^标题字重[：:]\s*(600|700)$/u, "templateWeight", "heading"],
    [/^段落对齐[：:]\s*(左对齐|居中|右对齐|两端对齐)$/u, "alignment", "paragraph"],
  ];
  for (const anchor of data.parse.result.anchors)
    for (const [pattern, field, scope] of directives) {
      const match = pattern.exec(anchor.original_text.trim());
      if (match)
        out.push({
          id: `${data.parse.id}:${anchor.id}:${field}`,
          parse_version_id: data.parse.id,
          anchor_id: anchor.id,
          field,
          value: field === "level" ? Number(match[1]) : (align[match[1]!] ?? match[1]!),
          evidence: anchor.original_text,
          scope,
        });
    }
  for (const item of data.parse.result.template_items) {
    if (item.state !== "recognized" || item.anchor_ids.length !== 1) continue;
    const anchor = data.parse.result.anchors.find((a) => a.id === item.anchor_ids[0]);
    if (!anchor || item.scope !== `${anchor.kind}:${anchor.id}`) continue;
    let field: FormatRule["field"] | undefined;
    let value: FormatRule["value"] = String(item.value);
    const scope = anchor.kind === "heading" ? "heading" : "paragraph";
    if (item.field === "outline_level" && typeof item.value === "number" && Number.isInteger(item.value) && item.value >= 0 && item.value <= 5) {
      field = "level";
      value = item.value + 1;
    }
    if (item.field === "alignment" && ["left", "center", "right", "both"].includes(String(item.value))) {
      if (scope === "paragraph") {
        field = "alignment";
        value = item.value === "both" ? "justify" : String(item.value);
      } else if (item.value === "left" || item.value === "center") {
        field = "templateAlign";
        value = item.value;
      }
    }
    if (field)
      out.push({
        id: `${data.parse.id}:${item.id}`,
        parse_version_id: data.parse.id,
        anchor_id: anchor.id,
        field,
        value,
        evidence: `${anchor.original_text}\n${item.field}=${String(item.value)}；${item.note}`,
        scope,
      });
  }
  return out;
}
export function createMockFormatRevisions(
  before: (signal?: AbortSignal) => Promise<void>,
  project: (id: string) => ProjectRead,
  documents: MockDocuments,
  sources: MockDocumentSources,
  bindingCurrent: (p: string) => ProjectSourceBindingRead,
  parseData: (p: string, id: string) => Facts,
): FormatRevisionService {
  const candidates = new Map<string, FormatRead>();
  const contexts = new Map<string, FormatContext>();
  const receipts = new Map<string, { fingerprint: string; value: FormatCommandRead }>();
  function document(p: string, d: string) {
    project(requireUuid(p));
    return documents.revisionCurrent(p, requireUuid(d));
  }
  function candidate(p: string, d: string, id: string) {
    document(p, d);
    const value = candidates.get(requireUuid(id));
    if (!value || value.project_id !== p || value.document_id !== d) return fail("NOT_FOUND", 404);
    return value;
  }
  async function context(p: string, d: string): Promise<FormatContext> {
    const current = document(p, d);
    if (current.content.schema_version === 2) return fail("SOURCE_REQUIRED", 422);
    let source;
    try {
      source = sources.mapping(p, d, current.version);
    } catch {
      return fail("SOURCE_REQUIRED", 422);
    }
    const binding = bindingCurrent(p);
    if (!binding.current_version_id) return fail("BINDING_REQUIRED", 422);
    const parseIds = [...(binding.template_parse_version_id ? [binding.template_parse_version_id] : []), ...binding.requirement_parse_version_ids];
    const allRules: FormatRule[] = [];
    for (const id of parseIds) {
      let data;
      try {
        data = parseData(p, id);
      } catch {
        return fail("SOURCE_STALE");
      }
      if (data.material.removed || !data.material.linked || data.material.kind !== (id === binding.template_parse_version_id ? "template" : "requirements"))
        return fail("SOURCE_STALE");
      allRules.push(...rules(data));
    }
    if (allRules.length > 1000 || new Set(allRules.map((r) => r.id)).size !== allRules.length) return fail("RULE_INVALID", 422);
    const paths = source.guard_contract.editable_paths as number[][];
    const sourceData = parseData(p, source.parse_version_id);
    const targets = paths.flatMap((path) => {
      const node = at(current.content.json, path);
      if (node.type !== "heading" && node.type !== "paragraph") return [];
      const anchor =
        sourceData.parse.result.anchors.find((a) => stable(a.editor_path) === stable(path)) ??
        (paths.length === 1 && sourceData.parse.result.anchors.length === 1 ? sourceData.parse.result.anchors[0] : undefined);
      if (!anchor) return [];
      return [
        {
          anchor_id: anchor.id,
          editor_path: path,
          kind: node.type as "heading" | "paragraph",
          title: anchor.original_text.slice(0, 200),
          attrs: node.attrs ?? null,
        },
      ];
    });
    return parseDto("FormatContext", {
      document_version: current.version,
      binding_version_id: binding.current_version_id,
      binding_version: binding.version,
      template_parse_version_id: binding.template_parse_version_id,
      requirement_parse_version_ids: binding.requirement_parse_version_ids,
      source_guard_digest: await hash(source.guard_contract),
      targets,
      rules: allRules,
    });
  }
  async function read(p: string, d: string, value: FormatRead) {
    const current = document(p, d);
    let applicable = false;
    if (value.status === "ready" && value.base_version === current.version) {
      try {
        applicable = stable(await context(p, d)) === stable(contexts.get(value.id));
      } catch {
        /* Stale or missing sources make the candidate review-only. */
      }
    }
    return clone({ ...value, document_version: current.version, applicable });
  }
  function review(value: FormatRead, revision: number) {
    if (value.revision !== revision || value.revision >= Number.MAX_SAFE_INTEGER) return fail("REVIEW_CONFLICT");
    if (value.status !== "ready") return fail("STATE_CONFLICT");
  }
  function replay(p: string, d: string, id: string, op: FormatCommandRead["operation"], target: string | null, input: unknown) {
    document(p, d);
    if (project(p).archived) return fail("PROJECT_ARCHIVED");
    const key = `${d}:${requireUuid(id)}`;
    const fingerprint = stable({ op, target, input });
    const prior = receipts.get(key);
    if (prior && prior.fingerprint !== fingerprint) return fail("COMMAND_CONFLICT");
    return { key, fingerprint, prior: prior?.value };
  }
  function receipt(
    state: ReturnType<typeof replay>,
    id: string,
    value: FormatRead,
    operation: FormatCommandRead["operation"],
    base: number,
    result: number | null = null,
  ) {
    const output = parseDto("FormatCommandRead", {
      command_id: id,
      candidate_id: value.id,
      candidate_revision: value.revision,
      operation,
      base_version: base,
      result_version: result,
    });
    receipts.set(state.key, { fingerprint: state.fingerprint, value: output });
    return clone(output);
  }
  function advance(value: FormatRead) {
    value.revision++;
    value.updated_at = new Date().toISOString();
  }
  function sourceFresh(p: string, frozen: FormatContext) {
    if (bindingCurrent(p).current_version_id !== frozen.binding_version_id) return fail("SOURCE_STALE");
    for (const id of [...(frozen.template_parse_version_id ? [frozen.template_parse_version_id] : []), ...frozen.requirement_parse_version_ids]) {
      const data = parseData(p, id);
      if (data.material.removed || !data.material.linked || data.material.kind !== (id === frozen.template_parse_version_id ? "template" : "requirements"))
        return fail("SOURCE_STALE");
    }
  }
  const service: FormatRevisionService = {
    async context(p, d, signal) {
      await before(signal);
      return context(p, d);
    },
    async create(p, d, input, signal) {
      await before(signal);
      const data = formatInput("FormatCreate", input);
      const state = replay(p, d, data.command_id, "create", null, data);
      if (state.prior) return clone(state.prior);
      const frozen = await context(p, d);
      throwIfAborted(signal);
      sourceFresh(p, frozen);
      if (document(p, d).version !== data.base_version || frozen.document_version !== data.base_version) return fail("STALE");
      if (data.binding_version_id !== frozen.binding_version_id || data.source_guard_digest !== frozen.source_guard_digest) return fail("SOURCE_STALE");
      const patches: FormatPatch[] = [];
      const slots = new Set<string>();
      for (const selection of data.selections) {
        const rule = frozen.rules.find((r) => r.id === selection.rule_id);
        if (!rule) return fail("RULE_INVALID", 422);
        for (const anchorId of selection.target_anchor_ids) {
          const target = frozen.targets.find((t) => t.anchor_id === anchorId);
          if (!target || target.kind !== rule.scope || slots.has(`${anchorId}:${rule.field}`)) return fail("TARGET_INVALID", 422);
          slots.add(`${anchorId}:${rule.field}`);
          const previous = target.attrs?.[rule.field] ?? null;
          if (previous === rule.value) continue;
          patches.push({
            id: `format-${patches.length + 1}`,
            anchor_id: anchorId,
            editor_path: target.editor_path,
            field: rule.field,
            before: previous,
            after: rule.value,
            rule_id: rule.id,
            evidence: rule.evidence,
          });
        }
      }
      if (!patches.length || patches.length > 1000) return fail("NO_CHANGE", 422);
      const stamp = new Date().toISOString();
      const value = parseDto("FormatRead", {
        id: crypto.randomUUID(),
        project_id: p,
        document_id: d,
        base_version: data.base_version,
        document_version: data.base_version,
        revision: 1,
        status: "ready",
        applicable: true,
        patches,
        decisions: patches.map((patch) => ({ patch_id: patch.id, decision: "pending" })),
        application_command_id: null,
        created_at: stamp,
        updated_at: stamp,
      });
      candidates.set(value.id, value);
      contexts.set(value.id, clone(frozen));
      return receipt(state, data.command_id, value, "create", data.base_version);
    },
    async get(p, d, id, signal) {
      await before(signal);
      return read(p, d, candidate(p, d, id));
    },
    async list(p, d, query, signal) {
      await before(signal);
      document(p, d);
      const { limit, offset } = pageQuery(query);
      const all = [...candidates.values()].filter((c) => c.document_id === d).reverse();
      return parseDto("FormatPage", {
        items: await Promise.all(all.slice(offset, offset + limit).map((c) => read(p, d, c))),
        total: all.length,
        limit,
        offset,
      });
    },
    async decide(p, d, id, input, signal) {
      await before(signal);
      const data = formatInput("FormatDecide", input);
      const state = replay(p, d, data.command_id, "decide", id, data);
      if (state.prior) return clone(state.prior);
      const value = candidate(p, d, id);
      review(value, data.expected_revision);
      if (data.decisions.some((choice) => !value.patches.some((patch) => patch.id === choice.patch_id))) return fail("DECISION_INVALID", 422);
      const decisions = value.decisions.map((choice) => data.decisions.find((update) => update.patch_id === choice.patch_id) ?? choice);
      value.decisions = clone(decisions);
      advance(value);
      return receipt(state, data.command_id, value, "decide", value.base_version);
    },
    async apply(p, d, id, input, signal) {
      await before(signal);
      const data = formatInput("FormatApply", input);
      const state = replay(p, d, data.command_id, "apply", id, data);
      if (state.prior) return clone(state.prior);
      const value = candidate(p, d, id);
      review(value, data.expected_revision);
      const frozen = await context(p, d);
      throwIfAborted(signal);
      sourceFresh(p, frozen);
      review(value, data.expected_revision);
      const current = document(p, d);
      if (current.version !== data.expected_document_version || current.version !== value.base_version) return fail("STALE");
      if (stable(frozen) !== stable(contexts.get(id))) return fail("SOURCE_STALE");
      if (value.decisions.some((choice) => choice.decision === "pending")) return fail("DECISION_REQUIRED", 422);
      const accepted = value.patches.filter((patch) => value.decisions.some((choice) => choice.patch_id === patch.id && choice.decision === "accept"));
      if (!accepted.length) return fail("NO_ACCEPTED_PATCHES", 422);
      const content = clone(current.content);
      const source = sources.mapping(p, d, current.version);
      const contract = clone(source.guard_contract);
      const overlays = new Map<string, JsonObject>(
        (Array.isArray(contract.format_overrides) ? contract.format_overrides : [])
          .filter((overlay): overlay is JsonObject => record(overlay))
          .map((overlay) => [stable(overlay.editor_path), clone(overlay)]),
      );
      for (const patch of accepted) {
        // Mock 的原件来源只覆盖 v1 正文；v2 来源正文在 context 阶段即返回 FORMAT_SOURCE_REQUIRED。
        const path = patch.editor_path;
        if (!path) return fail("TARGET_INVALID", 422);
        const node = at(content.json, path);
        if ((node.attrs?.[patch.field] ?? null) !== patch.before) return fail("STALE");
        const previous = clone(node.attrs ?? null);
        node.attrs = { ...node.attrs, [patch.field]: patch.after };
        const prior = overlays.get(stable(path));
        overlays.set(stable(path), {
          anchor_id: patch.anchor_id,
          editor_path: path,
          node_type: node.type,
          original_attrs: prior ? prior.original_attrs! : previous,
          target_attrs: clone(node.attrs),
        });
      }
      contract.schema_version = 2;
      contract.guard_version = "source-projection-v2";
      contract.format_overrides = [...overlays.values()].filter(
        (overlay) => stable(overlay.original_attrs) !== stable(overlay.target_attrs),
      ) as typeof contract.format_overrides;
      const saved = sources.appendFormat(p, d, current.version, content, contract, "ai_adoption");
      value.status = "applied";
      value.application_command_id = data.command_id;
      advance(value);
      return receipt(state, data.command_id, value, "apply", current.version, saved.version);
    },
    async undo(p, d, applicationId, input, signal) {
      await before(signal);
      const data = formatInput("FormatUndo", input);
      const state = replay(p, d, data.command_id, "undo", applicationId, data);
      if (state.prior) return clone(state.prior);
      const applied = receipts.get(`${d}:${requireUuid(applicationId)}`)?.value;
      if (!applied || applied.operation !== "apply") return fail("UNDO_CONFLICT");
      const value = candidate(p, d, applied.candidate_id);
      const current = document(p, d);
      if (value.status !== "applied" || applied.result_version !== current.version || current.version !== data.expected_document_version)
        return fail("UNDO_CONFLICT");
      const original = documents.revisionVersion(p, d, applied.base_version);
      const mapping = sources.mapping(p, d, applied.base_version);
      const saved = sources.appendFormat(p, d, current.version, original.content, mapping.guard_contract, "adoption_undo");
      value.status = "undone";
      advance(value);
      return receipt(state, data.command_id, value, "undo", current.version, saved.version);
    },
    async command(p, d, id, signal) {
      await before(signal);
      document(p, d);
      const value = receipts.get(`${d}:${requireUuid(id)}`)?.value;
      if (!value) return fail("COMMAND_NOT_FOUND", 404);
      return clone(value);
    },
  };
  const writes = new Map<string, Promise<unknown>>();
  function write<T>(d: string, action: () => Promise<T>): Promise<T> {
    const prior = writes.get(d) ?? Promise.resolve();
    const pending = prior.catch(() => undefined).then(action);
    writes.set(d, pending);
    void pending
      .finally(() => {
        if (writes.get(d) === pending) writes.delete(d);
      })
      .catch(() => undefined);
    return pending;
  }
  return {
    ...service,
    create: (p, d, input, signal) => write(d, () => service.create(p, d, input, signal)),
    decide: (p, d, id, input, signal) => write(d, () => service.decide(p, d, id, input, signal)),
    apply: (p, d, id, input, signal) => write(d, () => service.apply(p, d, id, input, signal)),
    undo: (p, d, id, input, signal) => write(d, () => service.undo(p, d, id, input, signal)),
  };
}
