/** Strict, dependency-free OpenAPI 3.1 component contract generation. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const annotations = new Set(["title", "description", "default", "examples", "writeOnly"]);
const supported = new Set([
  ...annotations,
  "$ref",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "anyOf",
  "enum",
  "const",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "format",
  "pattern",
]);
const supportedTypes = new Set(["object", "array", "string", "integer", "number", "boolean", "null"]);
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const reservedTypeNames = new Set([
  "any",
  "unknown",
  "never",
  "void",
  "string",
  "number",
  "boolean",
  "object",
  "null",
  "undefined",
  "class",
  "interface",
  "type",
  "export",
  "import",
  "default",
  "const",
  "let",
  "var",
  "function",
  "ApiTypes",
  "SchemaName",
  "apiSchemas",
]);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function reject(location, reason) {
  throw new Error(`Unsupported OpenAPI schema at ${location}: ${reason}`);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])]),
  );
}

function literalMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "integer") return Number.isSafeInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return ["string", "boolean"].includes(type) && typeof value === type;
}

function inspectSchema(schema, schemas, location) {
  if (!record(schema)) reject(location, "schema must be an object");
  for (const key of Object.keys(schema)) {
    if (!supported.has(key)) reject(location, `unknown keyword ${key}`);
  }
  if (own(schema, "$ref")) {
    if (typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/components/schemas/")) reject(location, "only local component references are supported");
    const name = schema.$ref.slice("#/components/schemas/".length);
    if (!own(schemas, name)) reject(location, `unknown reference ${name}`);
    if (Object.keys(schema).some((key) => key !== "$ref" && !annotations.has(key))) reject(location, "reference siblings may only contain annotations");
    return;
  }
  if (own(schema, "anyOf")) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) reject(location, "anyOf must contain schemas");
    if (Object.keys(schema).some((key) => key !== "anyOf" && !annotations.has(key))) reject(location, "anyOf siblings may only contain annotations");
    schema.anyOf.forEach((branch, index) => inspectSchema(branch, schemas, `${location}.anyOf[${index}]`));
    return;
  }
  if (!supportedTypes.has(schema.type)) reject(location, `unknown or missing type ${String(schema.type)}`);
  if (own(schema, "enum")) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0 || !schema.enum.every((value) => literalMatches(value, schema.type)))
      reject(location, "enum values must match a supported scalar type");
  }
  if (own(schema, "const") && !literalMatches(schema.const, schema.type)) reject(location, "const must match a supported scalar type");
  if (own(schema, "const") && own(schema, "enum")) reject(location, "const and enum cannot be combined in this subset");
  for (const key of ["minimum", "maximum"]) {
    if (own(schema, key) && (!["number", "integer"].includes(schema.type) || typeof schema[key] !== "number" || !Number.isFinite(schema[key])))
      reject(location, `${key} requires a finite numeric bound on a number`);
  }
  for (const key of ["minLength", "maxLength"]) {
    if (own(schema, key) && (schema.type !== "string" || !Number.isSafeInteger(schema[key]) || schema[key] < 0))
      reject(location, `${key} requires a nonnegative integer bound on a string`);
  }
  for (const key of ["minItems", "maxItems"]) {
    if (own(schema, key) && (schema.type !== "array" || !Number.isSafeInteger(schema[key]) || schema[key] < 0))
      reject(location, `${key} requires a nonnegative integer bound on an array`);
  }
  if (own(schema, "format") && (schema.type !== "string" || !["uuid", "date-time", "date", "password"].includes(schema.format)))
    reject(location, "unknown string format");
  if (own(schema, "pattern")) {
    if (schema.type !== "string" || typeof schema.pattern !== "string") reject(location, "pattern requires a string schema and expression");
    try {
      new RegExp(schema.pattern);
    } catch {
      reject(location, "pattern must be a valid JavaScript regular expression");
    }
  }
  if (own(schema, "minimum") && own(schema, "maximum") && schema.minimum > schema.maximum) reject(location, "minimum exceeds maximum");
  if (own(schema, "minLength") && own(schema, "maxLength") && schema.minLength > schema.maxLength) reject(location, "minLength exceeds maxLength");
  if (own(schema, "minItems") && own(schema, "maxItems") && schema.minItems > schema.maxItems) reject(location, "minItems exceeds maxItems");
  if (schema.type !== "object" && ["properties", "required", "additionalProperties"].some((key) => own(schema, key)))
    reject(location, "object keywords require object type");
  if (schema.type !== "array" && own(schema, "items")) reject(location, "items requires array type");
  if (schema.type === "array") {
    if (!own(schema, "items")) reject(location, "array requires items");
    inspectSchema(schema.items, schemas, `${location}.items`);
  }
  if (schema.type === "object") {
    if (own(schema, "properties") && !record(schema.properties)) reject(location, "properties must be an object");
    const properties = schema.properties ?? {};
    if (
      own(schema, "required") &&
      (!Array.isArray(schema.required) ||
        schema.required.some((name) => typeof name !== "string" || !own(properties, name)) ||
        new Set(schema.required).size !== schema.required.length)
    )
      reject(location, "required must reference distinct declared properties");
    for (const [name, property] of Object.entries(properties)) {
      if (forbiddenKeys.has(name)) reject(location, `unsupported property name ${name}`);
      inspectSchema(property, schemas, `${location}.properties.${name}`);
    }
    if (own(schema, "additionalProperties") && typeof schema.additionalProperties !== "boolean") {
      if (Object.keys(properties).length > 0) reject(location, "typed additionalProperties with declared properties is not supported");
      inspectSchema(schema.additionalProperties, schemas, `${location}.additionalProperties`);
    }
  }
}

function renderType(schema, typeNames) {
  if (own(schema, "$ref")) return typeNames.get(schema.$ref.slice("#/components/schemas/".length));
  if (own(schema, "anyOf")) return schema.anyOf.map((branch) => `(${renderType(branch, typeNames)})`).join(" | ");
  if (own(schema, "const")) return JSON.stringify(schema.const);
  if (own(schema, "enum")) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.type === "array") return `Array<${renderType(schema.items, typeNames)}>`;
  if (schema.type === "object") {
    const properties = Object.entries(schema.properties ?? {}).sort(([first], [second]) => first.localeCompare(second, "en"));
    if (properties.length === 0) {
      const value = record(schema.additionalProperties)
        ? renderType(schema.additionalProperties, typeNames)
        : schema.additionalProperties === false
          ? "never"
          : "unknown";
      return `{ [key: string]: ${value} }`;
    }
    const required = new Set(schema.required ?? []);
    const fields = properties.map(([name, value]) => `  ${JSON.stringify(name)}${required.has(name) ? "" : "?"}: ${renderType(value, typeNames)};`);
    return `{\n${fields.join("\n")}\n}`;
  }
  return schema.type === "integer" ? "number" : schema.type;
}

/** Return a deterministic source file, rejecting every unsupported schema construct. */
export function generateContract(document) {
  if (!record(document) || typeof document.openapi !== "string" || !/^3\.1\.\d+$/.test(document.openapi)) reject("document", "expected OpenAPI 3.1");
  const schemas = document.components?.schemas;
  if (!record(schemas) || Object.keys(schemas).length === 0) reject("components.schemas", "at least one schema is required");
  const names = Object.keys(schemas).sort();
  const typeNames = new Map(names.map((name) => [name, name.replaceAll("-", "_")]));
  if (new Set(typeNames.values()).size !== names.length) reject("components.schemas", "TypeScript schema names collide after normalization");
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) || forbiddenKeys.has(name) || reservedTypeNames.has(name))
      reject(`components.schemas.${name}`, "unsupported TypeScript schema name");
    inspectSchema(schemas[name], schemas, `components.schemas.${name}`);
  }
  const hash = createHash("sha256")
    .update(JSON.stringify(stable(document)))
    .digest("hex");
  const declarations = names.map((name) => `export type ${typeNames.get(name)} = ${renderType(schemas[name], typeNames)};`).join("\n\n");
  const types = names.map((name) => `  ${JSON.stringify(name)}: ${typeNames.get(name)};`).join("\n");
  return `// Generated from apps/api/openapi.json. Do not edit manually.\n// Contract SHA-256: ${hash}\n/* oxlint-disable */\n// oxfmt-ignore-file\n\n${declarations}\n\nexport interface ApiTypes {\n${types}\n}\n\nexport const apiSchemas = ${JSON.stringify(stable(schemas), null, 2)} as const;\n\nexport type SchemaName = keyof ApiTypes;\n`;
}

/** Shared by CLI and tests: --check never rewrites the target. */
export function synchronizeContract({ input, output, check = false }) {
  const document = JSON.parse(readFileSync(input, "utf8"));
  const generated = generateContract(document);
  if (check) {
    if (!existsSync(output) || readFileSync(output, "utf8") !== generated)
      throw new Error("API contract is missing or stale. Run node scripts/generate-api.mjs and review the changes.");
  } else {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, generated, "utf8");
  }
  return generated;
}

function main(argv) {
  let input = resolve(webRoot, "../api/openapi.json");
  let output = resolve(webRoot, "src/services/contracts/api.generated.ts");
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--check") check = true;
    else if (["--input", "--output"].includes(option)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
      if (option === "--input") input = resolve(value);
      else output = resolve(value);
      index += 1;
    } else throw new Error(`Unknown option: ${option}`);
  }
  synchronizeContract({ input, output, check });
  process.stdout.write(check ? "API contract verified.\n" : "API contract generated.\n");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "API contract generation failed"}\n`);
    process.exitCode = 1;
  }
}
