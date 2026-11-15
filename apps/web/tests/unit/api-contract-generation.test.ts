import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { generateContract } from "../../scripts/generate-api.mjs";

const contract = (schemas: Record<string, unknown>) => ({ openapi: "3.1.0", components: { schemas } });
const branch = (tag: string) => ({
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: { kind: { type: "string", const: tag } },
});
const tagged = () => ({
  oneOf: [{ $ref: "#/components/schemas/First" }, { $ref: "#/components/schemas/Second" }],
  discriminator: { propertyName: "kind", mapping: { first: "#/components/schemas/First", second: "#/components/schemas/Second" } },
});
const taggedContract = (schema: unknown = tagged()) => contract({ First: branch("first"), Second: branch("second"), Choice: schema });
const emittedSchemas = (text: string) => JSON.parse(text.split("export const apiSchemas = ")[1]!.split(" as const;")[0]!);

describe("严格生成配置契约", () => {
  it("真实 OpenAPI 能生成，保留实际 discriminator 与字典约束", () => {
    const document = JSON.parse(readFileSync(new URL("../../../api/openapi.json", import.meta.url), "utf8"));
    const generated = generateContract(document);
    expect(emittedSchemas(generated)).toEqual(document.components.schemas);
    expect(generated).toContain('"content": (APIConfigContent) | (ModelConfigContent) | (PromptConfigContent) | (AgentConfigContent)');
    expect(generated).toContain('{ [key in "api" | "model" | "prompt" | "agent"]?: string }');
  });

  it("oneOf 输出联合类型并原样保存恰一匹配的运行时契约", () => {
    const generated = generateContract(taggedContract());
    expect(generated).toContain("export type Choice = (First) | (Second)");
    expect(emittedSchemas(generated).Choice).toEqual(tagged());
    const overlapping = { oneOf: [{ type: "integer" }, { type: "number" }] };
    expect(emittedSchemas(generateContract(contract({ Number: overlapping }))).Number).toEqual(overlapping);
  });

  it.each([
    { oneOf: [] },
    { oneOf: [{ type: "string" }], anyOf: [{ type: "string" }] },
    { oneOf: [{ type: "string" }], unevaluatedProperties: false },
    { type: "string", discriminator: { propertyName: "kind", mapping: {} } },
  ])("未知或不受支持的联合约束拒绝生成：%j", (schema) => {
    expect(() => generateContract(contract({ Invalid: schema }))).toThrow("Unsupported OpenAPI schema");
  });

  it.each([
    { propertyName: "kind", mapping: { first: "https://example.invalid/First", second: "#/components/schemas/Second" } },
    { propertyName: "kind", mapping: { wrong: "#/components/schemas/First", second: "#/components/schemas/Second" } },
    { propertyName: "kind", mapping: { first: "#/components/schemas/First" } },
    { propertyName: "kind", mapping: { first: "#/components/schemas/First", second: "#/components/schemas/First" } },
    { propertyName: "missing", mapping: { first: "#/components/schemas/First", second: "#/components/schemas/Second" } },
    { propertyName: "kind", mapping: { first: "#/components/schemas/First", second: "#/components/schemas/Second" }, unknown: true },
  ])("discriminator 必须完整映射到匹配常量的本地分支：%j", (discriminator) => {
    expect(() => generateContract(taggedContract({ ...tagged(), discriminator }))).toThrow("Unsupported OpenAPI schema");
  });

  it("拒绝可选 tag 和内联 discriminator 分支，避免假定可以鉴别", () => {
    const document = contract({ First: { ...branch("first"), required: [] }, Second: branch("second"), Choice: tagged() });
    expect(() => generateContract(document)).toThrow("required string const");
    expect(() => generateContract(taggedContract({ ...tagged(), oneOf: [branch("first"), branch("second")] }))).toThrow("reference branches");
  });

  it("字典有限键输出可选映射，保留键校验和属性数量上下界", () => {
    const schema = { type: "object", propertyNames: { enum: ["api", "model"] }, additionalProperties: { type: "integer" }, minProperties: 1, maxProperties: 2 };
    const generated = generateContract(contract({ Versions: schema }));
    expect(generated).toContain('export type Versions = { [key in "api" | "model"]?: number }');
    expect(emittedSchemas(generated).Versions).toEqual(schema);
  });

  it("patternProperties 不把未匹配键误判禁止，并保留所有匹配规则", () => {
    const patterns = { "^x": { type: "string", minLength: 1 }, x$: { type: "string", maxLength: 4 } };
    const open = generateContract(contract({ Dictionary: { type: "object", patternProperties: patterns } }));
    expect(open).toContain("export type Dictionary = { [key: string]: unknown }");
    const closed = generateContract(contract({ Dictionary: { type: "object", patternProperties: patterns, additionalProperties: false } }));
    expect(closed).toContain("export type Dictionary = { [key: string]: string }");
    expect(emittedSchemas(closed).Dictionary.patternProperties).toEqual(patterns);
  });

  it.each([
    { type: "object", minProperties: -1 },
    { type: "object", maxProperties: 1.5 },
    { type: "object", minProperties: 3, maxProperties: 2 },
    { type: "array", items: { type: "string" }, maxProperties: 2 },
    { type: "object", propertyNames: { type: "integer" } },
    { type: "object", propertyNames: { enum: [1] } },
    { type: "object", propertyNames: { pattern: "[" } },
    { type: "object", propertyNames: { unknown: true } },
    { type: "object", patternProperties: { "[": { type: "string" } } },
    { type: "object", patternProperties: { "^x": { type: "string", unknown: true } } },
    { type: "object", patternProperties: [] },
    { type: "string", patternProperties: { "^x": { type: "string" } } },
  ])("无效字典 schema 必须在生成阶段拒绝：%j", (schema) => {
    expect(() => generateContract(contract({ Invalid: schema }))).toThrow("Unsupported OpenAPI schema");
  });
});
