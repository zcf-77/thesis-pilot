import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { generateContract, synchronizeContract } from "../../scripts/generate-api.mjs";

const temporaryDirectories: string[] = [];
const contract = (schemas: Record<string, unknown>) => ({ openapi: "3.1.0", components: { schemas } });

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    const target = resolve(directory);
    if (!target.startsWith(`${resolve(tmpdir())}${sep}`) || !basename(target).startsWith("thesis-pilot-contract-test-"))
      throw new Error("Refusing to remove a path outside this test's temporary directories");
    rmSync(target, { recursive: true });
  }
});

describe("OpenAPI 生成契约", () => {
  it("真实 OpenAPI 生成产物与已保存文件一致", () => {
    const input = fileURLToPath(new URL("../../../api/openapi.json", import.meta.url));
    const output = fileURLToPath(new URL("../../src/services/contracts/api.generated.ts", import.meta.url));
    expect(generateContract(JSON.parse(readFileSync(input, "utf8")))).toBe(readFileSync(output, "utf8"));
  });

  it("区分可省略、显式 null、引用和额外字段字典", () => {
    const generated = generateContract(
      contract({
        Item: { type: "object", additionalProperties: false, properties: { id: { type: "string", format: "uuid" } }, required: ["id"] },
        Page: {
          type: "object",
          properties: {
            item: { anyOf: [{ $ref: "#/components/schemas/Item" }, { type: "null" }] },
            optional: { type: "boolean" },
            values: { type: "object", additionalProperties: { type: "integer" } },
          },
          required: ["item", "values"],
        },
      }),
    );
    expect(generated).toContain('"item": (Item) | (null)');
    expect(generated).toContain('"optional"?: boolean');
    expect(generated).toContain('"values": Record<string, number>');
    expect(generated).toContain("export interface ApiTypes");
    expect(generated).not.toContain(": any");
  });

  it.each([
    { type: "string", pattern: "^secret$" },
    { type: "string", format: "unknown-format" },
    { type: "string", minimum: 1 },
    { type: "array" },
    { type: "tuple" },
    { type: "object", required: ["missing"] },
    { type: "string", enum: [12] },
    { anyOf: [{ type: "string" }], maxLength: 4 },
    { $ref: "#/components/schemas/Unknown" },
    { $ref: "https://example.invalid/schema" },
  ])("不支持的结构直接失败而不退化为 any：%j", (schema) => {
    expect(() => generateContract(contract({ Invalid: schema }))).toThrow("Unsupported OpenAPI schema");
  });

  it("重排对象键不改变生成结果，数组与语义变化会改变结果", () => {
    const first = contract({ Item: { type: "string", title: "Item", enum: ["one", "two"] } });
    const reordered = { components: { schemas: { Item: { enum: ["one", "two"], title: "Item", type: "string" } } }, openapi: "3.1.0" };
    expect(generateContract(first)).toBe(generateContract(reordered));
    expect(generateContract(first)).not.toBe(generateContract(contract({ Item: { type: "string", enum: ["one"] } })));
  });

  it("漂移检查失败不改写文件，正常生成后检查通过", () => {
    const directory = mkdtempSync(join(tmpdir(), "thesis-pilot-contract-test-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "openapi.json");
    const output = join(directory, "contract.ts");
    writeFileSync(input, JSON.stringify(contract({ Value: { type: "string" } })));
    writeFileSync(output, "original file");
    expect(() => synchronizeContract({ input, output, check: true })).toThrow("missing or stale");
    expect(readFileSync(output, "utf8")).toBe("original file");
    synchronizeContract({ input, output });
    expect(() => synchronizeContract({ input, output, check: true })).not.toThrow();
    writeFileSync(input, JSON.stringify(contract({ Value: { type: "integer" } })));
    expect(() => synchronizeContract({ input, output, check: true })).toThrow("missing or stale");
  });
});
