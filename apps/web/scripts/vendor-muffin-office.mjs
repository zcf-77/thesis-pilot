/**
 * MuffinOffice 供应（vendoring）：从 muffin-office 源码快照构建 ThesisPilot 所需的最小产物。
 *
 *   node scripts/vendor-muffin-office.mjs --from <muffin-office 目录> --rev <提交> [--source-note <来源说明>]
 *   node scripts/vendor-muffin-office.mjs --from <muffin-office 目录> --rev <提交> --verify
 *
 * 来源是 git 检出时核对 HEAD 与 --rev、且构建输入没有未提交修改；来源是 `git archive` 解出的快照
 * （无 .git）时必须用 --source-note 写明来源。两种情况都对构建输入计算树哈希并写入 VENDOR.json。
 * 构建只在临时副本上进行：按序应用 vendor/muffin-office/patches/*.patch，来源目录保持只读。
 * --verify 重新构建并逐文件比对 SHA-256，不改写 vendor 目录。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite-plus";
import vue from "@vitejs/plugin-vue";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = join(webRoot, "vendor", "muffin-office");
const patchesDir = join(vendorRoot, "patches");
/** 构建输入：树哈希、临时副本与 git 洁净检查共用这一份清单。 */
const INPUTS = ["Cargo.toml", "Cargo.lock", "LICENSE", "NOTICE", "crates", "packages/core", "packages/vue"];
const SOURCE_SKIP_DIRS = new Set(["node_modules", "dist", "target", ".git"]);
/** 产物目录里 pnpm 为工作区包建立的链接目录不属于供应内容。 */
const OUTPUT_SKIP_DIRS = new Set(["node_modules"]);
const SKIP_FILES = new Set([".DS_Store"]);
/** vendor 根目录下由本脚本生成的条目；patches 是手写输入，不在此列。 */
const GENERATED = ["core", "vue", "office-wasm", "fixtures", "schema", "VENDOR.json", "LICENSE-GRANT.md", "THIRD-PARTY-RUST.txt"];
const WORKER_PLACEHOLDER = "__MUFFIN_OFFICE_WORKER_URL__";

function fail(message) {
  console.error(`vendor-muffin-office: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { verify: false };
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next || next.startsWith("--")) fail(`${name} 缺少取值`);
      return next;
    };
    if (name === "--from") options.from = resolve(value());
    else if (name === "--rev") options.rev = value();
    else if (name === "--source-note") options.sourceNote = value();
    else if (name === "--work-dir") options.workDir = resolve(value());
    else if (name === "--cargo-target-dir") options.cargoTargetDir = resolve(value());
    else if (name === "--verify") options.verify = true;
    else fail(`未知参数 ${name}`);
  }
  if (!options.from || !options.rev) fail("用法：--from <muffin-office 目录> --rev <提交> [--source-note <来源说明>] [--verify]");
  if (!/^[0-9a-f]{7,40}$/.test(options.rev)) fail("--rev 必须是 7–40 位十六进制提交号");
  return options;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 256 * 1024 * 1024, ...options }).trim();
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** 递归列出文件（相对路径，统一 / 分隔，排序）。 */
function listFiles(root, base = root, skip = SOURCE_SKIP_DIRS, out = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) listFiles(path, base, skip, out);
    } else if (entry.isFile() && !SKIP_FILES.has(entry.name)) out.push(relative(base, path).split(sep).join("/"));
  }
  return out.sort(byCodeUnit);
}

function inputFiles(root) {
  const files = [];
  for (const input of INPUTS) {
    const path = join(root, input);
    if (!existsSync(path)) fail(`来源缺少构建输入 ${input}`);
    if (statSync(path).isDirectory()) files.push(...listFiles(path, root));
    else files.push(input);
  }
  return files.sort(byCodeUnit);
}

/** 树哈希：每行 `路径\0SHA-256\n`，按路径排序后整体取 SHA-256。 */
function treeHash(root, files) {
  const hash = createHash("sha256");
  for (const file of files) hash.update(`${file}\0${sha256(readFileSync(join(root, file)))}\n`);
  return hash.digest("hex");
}

function verifySource(options, recorded) {
  const gitEntry = join(options.from, ".git");
  if (existsSync(gitEntry)) {
    const head = run("git", ["rev-parse", "HEAD"], { cwd: options.from });
    const wanted = run("git", ["rev-parse", "--verify", `${options.rev}^{commit}`], { cwd: options.from });
    if (head !== wanted) fail(`来源 HEAD ${head} 与 --rev ${options.rev}（${wanted}）不一致`);
    const dirty = run("git", ["status", "--porcelain", "--untracked-files=no", "--", ...INPUTS], { cwd: options.from });
    if (dirty) fail(`来源构建输入有未提交修改：\n${dirty}`);
    return { kind: "git", commit: head, note: options.sourceNote ?? `git 检出 ${head}` };
  }
  const note = options.sourceNote ?? (options.verify ? recorded?.source.note : undefined);
  if (!note) fail("来源不是 git 检出：必须用 --source-note 说明快照来源（例如 git archive 的仓库与提交）");
  return { kind: "archive", commit: options.rev, note };
}

function toolVersions() {
  const read = (name) => JSON.parse(readFileSync(join(webRoot, "node_modules", name, "package.json"), "utf8")).version;
  const lock = readFileSync(join(workDirGlobal, "Cargo.lock"), "utf8");
  const bindgen = /name = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock)?.[1] ?? "unknown";
  return {
    rustc: run("rustc", ["--version"]),
    cargo: run("cargo", ["--version"]),
    wasmPack: run("wasm-pack", ["--version"]),
    wasmBindgen: bindgen,
    node: process.version,
    vite: `${JSON.parse(readFileSync(join(webRoot, "node_modules", "vite", "package.json"), "utf8")).name}@${read("vite")}`,
    vitePlus: read("vite-plus"),
    pluginVue: read("@vitejs/plugin-vue"),
    vueTsc: read("vue-tsc"),
    typescript: read("typescript"),
  };
}

let workDirGlobal = "";

function prepareWorkDir(options, files) {
  // 固定路径：配合 --remap-path-prefix 让 RUSTFLAGS 稳定，cargo 依赖缓存可复用。
  const work = options.workDir ?? join(tmpdir(), "thesispilot-muffin-office-work");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  for (const file of files) {
    mkdirSync(dirname(join(work, file)), { recursive: true });
    cpSync(join(options.from, file), join(work, file));
  }
  workDirGlobal = work;
  const patches = existsSync(patchesDir)
    ? readdirSync(patchesDir)
        .filter((name) => name.endsWith(".patch"))
        .sort()
    : [];
  for (const patch of patches) run("patch", ["-p1", "--forward", "--batch", "--quiet", "-i", join(patchesDir, patch)], { cwd: work });
  return { work, patches };
}

function buildWasm(work, out, cargoTarget) {
  const commit = /commit-hash: (\S+)/.exec(run("rustc", ["-vV"]))?.[1] ?? "unknown";
  const home = homedir();
  // 与上游 scripts/build_wasm.sh 相同的路径脱敏，产物不含本机路径，重复构建字节一致。
  const remap = [
    `--remap-path-prefix=${home}/.cargo/registry/src=/reg`,
    `--remap-path-prefix=${home}/.cargo/git/checkouts=/git`,
    `--remap-path-prefix=${work}=/src`,
    "--remap-path-prefix=crates=/src",
    `--remap-path-prefix=/rustc/${commit}=/rust`,
    "-C debuginfo=0",
  ].join(" ");
  const env = { ...process.env, RUSTFLAGS: remap, CARGO_TARGET_DIR: cargoTarget };
  const target = join(out, "office-wasm");
  execFileSync("wasm-pack", ["build", "crates/office-wasm", "--target", "web", "--release", "--no-pack", "--out-dir", target, "--", "--locked"], {
    cwd: work,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  for (const name of readdirSync(target)) if (!name.startsWith("office_wasm")) rmSync(join(target, name), { recursive: true, force: true });
  const schemas = join(out, "schema");
  mkdirSync(schemas, { recursive: true });
  for (const kind of ["model", "op", "transaction"]) {
    const schema = run("cargo", ["run", "--locked", "--quiet", "-p", "office-cli", "--", "schema", kind], { cwd: work, env });
    writeFileSync(join(schemas, `${kind}.schema.json`), `${JSON.stringify(JSON.parse(schema), null, 2)}\n`);
  }
  const tree = run(
    "cargo",
    ["tree", "--offline", "--locked", "-p", "office-wasm", "--target", "wasm32-unknown-unknown", "-e", "normal", "--prefix", "none", "--format", "{p} {l}"],
    {
      cwd: work,
      env,
    },
  );
  const crates = [
    ...new Set(
      tree
        .split("\n")
        .filter((line) => line && !line.startsWith("office-"))
        .map((line) =>
          line
            .replace(/ \(proc-macro\)/, "")
            .replace(/ \(\/[^)]*\)/, "")
            .replace(/ \(\*\)/, ""),
        ),
    ),
  ].sort();
  writeFileSync(
    join(out, "THIRD-PARTY-RUST.txt"),
    `# office-wasm 在 wasm32-unknown-unknown 上的运行时 Rust 依赖（名称 版本 许可证）\n# cargo tree --offline --locked -p office-wasm --target wasm32-unknown-unknown -e normal\n${crates.join("\n")}\n`,
  );
}

/** 把 engine.ts 里的 Worker 地址换成占位，产物里再还原为指向同目录 office.worker.js 的标准写法，交给宿主 Vite 打包。 */
function workerUrlPlugin() {
  return {
    name: "thesispilot:muffin-office-worker-url",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("/engine.ts")) return null;
      const pattern = "new URL('./office.worker.ts', import.meta.url)";
      if (!code.includes(pattern)) throw new Error("engine.ts 中找不到 Worker 地址写法，请核对上游改动");
      return code.replace(pattern, WORKER_PLACEHOLDER);
    },
  };
}

const quiet = { logLevel: "warn", configFile: false, envDir: false, mode: "production" };
/** 产物压缩：不携带上游源码注释与本机路径，重复构建字节一致。 */
const output = { minify: true, sourcemap: false, target: "es2022", reportCompressedSize: false, copyPublicDir: false };

async function buildCore(work, out) {
  const root = join(work, "packages", "core");
  const dist = join(out, "core", "dist");
  const common = { ...quiet, root, build: { outDir: dist, ...output } };
  await build({
    ...common,
    build: {
      ...common.build,
      emptyOutDir: true,
      lib: { entry: { "office.worker": join(root, "src", "office.worker.ts") }, formats: ["es"], fileName: (_, name) => `${name}.js` },
    },
  });
  await build({
    ...common,
    plugins: [workerUrlPlugin()],
    build: {
      ...common.build,
      emptyOutDir: false,
      lib: { entry: { engine: join(root, "src", "engine.ts") }, formats: ["es"], fileName: (_, name) => `${name}.js` },
    },
  });
  const enginePath = join(dist, "engine.js");
  const engine = readFileSync(enginePath, "utf8");
  if (engine.split(WORKER_PLACEHOLDER).length !== 2) fail("core/dist/engine.js 中 Worker 地址占位不唯一");
  writeFileSync(enginePath, engine.replace(WORKER_PLACEHOLDER, 'new URL("./office.worker.js",import.meta.url)'));
  const tsconfig = join(root, "tsconfig.vendor.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        strict: true,
        skipLibCheck: true,
        declaration: true,
        emitDeclarationOnly: true,
        allowImportingTsExtensions: true,
        noEmitOnError: false,
        rootDir: "src",
        outDir: join(dist, "types"),
        types: [],
      },
      files: ["src/engine.ts", "src/types.ts"],
    }),
  );
  runTsc(join(webRoot, "node_modules", "typescript", "bin", "tsc"), tsconfig, root);
  writeJson(join(out, "core", "package.json"), {
    name: "@muffin-office/core",
    version: "0.2.0-dev",
    private: true,
    license: "SEE LICENSE IN ../LICENSE-GRANT.md",
    type: "module",
    sideEffects: false,
    exports: {
      ".": { types: "./dist/types/engine.d.ts", import: "./dist/engine.js" },
      "./types": { types: "./dist/types/types.d.ts" },
    },
  });
}

async function buildVue(work, out) {
  const root = join(work, "packages", "vue");
  const dist = join(out, "vue", "dist");
  await build({
    ...quiet,
    root,
    plugins: [vue()],
    build: {
      outDir: dist,
      emptyOutDir: true,
      ...output,
      cssCodeSplit: false,
      lib: {
        entry: {
          "docs-editor": join(root, "src", "docs-editor-entry.ts"),
          "docs-editor-core": join(root, "src", "docs-editor", "index.ts"),
          "docs-anchors": join(root, "src", "docs-anchors.ts"),
        },
        formats: ["es"],
        fileName: (_, name) => `${name}.js`,
        cssFileName: "style",
      },
      rolldownOptions: { external: [/^vue$/, /^@muffin-office\/core(\/.*)?$/], output: { chunkFileNames: "chunks/[name]-[hash].js" } },
    },
  });
  const tsconfig = join(root, "tsconfig.vendor.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        jsx: "preserve",
        strict: true,
        skipLibCheck: true,
        declaration: true,
        emitDeclarationOnly: true,
        allowImportingTsExtensions: true,
        noEmitOnError: false,
        rootDir: "src",
        outDir: join(dist, "types"),
        types: [],
        // 只引用已生成的 core 声明，避免把 core 源码卷入本包的声明输出。
        paths: { "@muffin-office/core/*": [join(out, "core", "dist", "types", "*")], vue: [join(webRoot, "node_modules", "vue")] },
      },
      files: ["src/docs-editor-entry.ts", "src/docs-editor/index.ts", "src/docs-anchors.ts"],
    }),
  );
  runTsc(join(webRoot, "node_modules", "vue-tsc", "bin", "vue-tsc.js"), tsconfig, root);
  writeJson(join(out, "vue", "package.json"), {
    name: "@muffin-office/vue",
    version: "0.2.0-dev",
    private: true,
    license: "SEE LICENSE IN ../LICENSE-GRANT.md",
    type: "module",
    sideEffects: ["*.css"],
    exports: {
      "./docs-editor": { types: "./dist/types/docs-editor-entry.d.ts", import: "./dist/docs-editor.js" },
      "./docs-editor/core": { types: "./dist/types/docs-editor/index.d.ts", import: "./dist/docs-editor-core.js" },
      "./docs-anchors": { types: "./dist/types/docs-anchors.d.ts", import: "./dist/docs-anchors.js" },
      "./style.css": "./dist/style.css",
    },
    dependencies: { "@muffin-office/core": "workspace:*" },
    peerDependencies: { vue: "^3.5.0" },
  });
}

/** 上游源码按 TS 5.7 编写：声明照常生成，类型诊断只作提示，不阻断供应。 */
function runTsc(bin, tsconfig, cwd) {
  try {
    execFileSync(process.execPath, [bin, "-p", tsconfig], { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    const lines = output.split("\n").filter((line) => /error TS/.test(line));
    console.warn(`vendor-muffin-office: ${relative(workDirGlobal, cwd)} 声明生成有 ${lines.length} 条类型诊断（不阻断）：\n${lines.slice(0, 20).join("\n")}`);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function licenseGrant(source) {
  return `# MuffinOffice 使用授权说明

MuffinOffice（muffin-office）是本仓库所有者的专有软件，著作权归其所有，不开源。

本目录只包含为 ThesisPilot 构建的产物：\`@muffin-office/core\` 与 \`@muffin-office/vue\` 的编译输出（ES 模块与类型声明）、office-wasm 的 WebAssembly 模块、文档操作一致性金标与模型 JSON Schema。不含 TypeScript/Rust 源码、服务端程序、容器镜像与服务端许可文件。

授权范围：仅用于 ThesisPilot 的开发、演示与赛事评审。不得再分发、再许可、出售或单独使用本目录中的任何文件，不得据此制作衍生作品或对外提供服务。获得 ThesisPilot 仓库访问权限不等于获得 MuffinOffice 的任何其他权利。

第三方组件按其各自许可证提供；office-wasm 的 Rust 依赖清单见 \`THIRD-PARTY-RUST.txt\`。

来源：${source.note}（提交 ${source.commit}）。构建方式与逐文件哈希见 \`VENDOR.json\`，可用 \`node scripts/vendor-muffin-office.mjs --from <来源> --rev <提交> --verify\` 复核。
`;
}

function fileHashes(root, names) {
  const files = {};
  for (const name of names) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    const list = statSync(path).isDirectory() ? listFiles(path, root, OUTPUT_SKIP_DIRS) : [name];
    for (const file of list) files[file] = sha256(readFileSync(join(root, file)));
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => byCodeUnit(a, b)));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const recorded = existsSync(join(vendorRoot, "VENDOR.json")) ? JSON.parse(readFileSync(join(vendorRoot, "VENDOR.json"), "utf8")) : undefined;
  if (options.verify && !recorded) fail("--verify 需要已有的 VENDOR.json");
  let source = verifySource(options, recorded);
  const files = inputFiles(options.from);
  const sourceTree = treeHash(options.from, files);
  if (options.verify) {
    if (recorded.source.treeSha256 !== sourceTree) fail(`来源树哈希 ${sourceTree} 与记录 ${recorded.source.treeSha256} 不一致`);
    if (!recorded.source.rev.startsWith(source.commit) && !source.commit.startsWith(recorded.source.rev))
      fail(`来源提交 ${source.commit} 与记录 ${recorded.source.rev} 不一致`);
    // 复核按记录的提交与来源说明重建授权说明：同一提交的版本库检出与归档快照得到同一份产物。
    source = { ...source, commit: recorded.source.rev, note: options.sourceNote ?? recorded.source.note };
  }
  const { work, patches } = prepareWorkDir(options, files);
  const out = join(work, ".vendor-out");
  mkdirSync(out, { recursive: true });
  const cargoTarget = options.cargoTargetDir ?? join(tmpdir(), "thesispilot-muffin-office-cargo");
  console.log(`vendor-muffin-office: 构建 office-wasm（CARGO_TARGET_DIR=${cargoTarget}）`);
  buildWasm(work, out, cargoTarget);
  console.log("vendor-muffin-office: 构建 @muffin-office/core 与 @muffin-office/vue");
  const cwd = process.cwd();
  process.chdir(work);
  try {
    await buildCore(work, out);
    await buildVue(work, out);
  } finally {
    process.chdir(cwd);
  }
  mkdirSync(join(out, "fixtures"), { recursive: true });
  cpSync(join(work, "packages", "vue", "tests", "fixtures", "doc-ops-conformance.json"), join(out, "fixtures", "doc-ops-conformance.json"));
  writeFileSync(join(out, "LICENSE-GRANT.md"), licenseGrant(source));
  const produced = fileHashes(
    out,
    GENERATED.filter((name) => name !== "VENDOR.json"),
  );
  const patchHashes = Object.fromEntries(patches.map((name) => [`patches/${name}`, sha256(readFileSync(join(patchesDir, name)))]));

  if (options.verify) {
    const expected = recorded.files;
    const actualOnDisk = fileHashes(
      vendorRoot,
      GENERATED.filter((name) => name !== "VENDOR.json"),
    );
    const problems = [];
    for (const [file, hash] of Object.entries(produced)) {
      if (expected[file] !== hash) problems.push(`重建结果与记录不同：${file}`);
      if (actualOnDisk[file] !== hash) problems.push(`仓库文件与重建结果不同：${file}`);
    }
    for (const file of Object.keys(expected)) if (!(file in produced)) problems.push(`记录中的文件未重建：${file}`);
    for (const file of Object.keys(actualOnDisk)) if (!(file in produced)) problems.push(`仓库中多出未记录文件：${file}`);
    for (const [file, hash] of Object.entries(patchHashes)) if (recorded.patches[file] !== hash) problems.push(`补丁与记录不同：${file}`);
    for (const file of Object.keys(recorded.patches)) if (!(file in patchHashes)) problems.push(`记录中的补丁不存在：${file}`);
    if (problems.length) fail(`校验失败：\n${problems.join("\n")}`);
    console.log(`vendor-muffin-office: 校验通过（${Object.keys(produced).length} 个文件，来源树 ${sourceTree}）`);
    return;
  }

  const vendor = {
    name: "muffin-office",
    source: { rev: source.commit, kind: source.kind, note: source.note, inputs: INPUTS, treeSha256: sourceTree, inputFiles: files.length },
    tools: toolVersions(),
    build: {
      wasm: "wasm-pack build crates/office-wasm --target web --release --no-pack -- --locked（RUSTFLAGS 与上游 build_wasm.sh 相同的路径脱敏）",
      js: "vite-plus build（lib，ES 模块，压缩，构建时工作目录为临时副本）；声明由 tsc / vue-tsc --emitDeclarationOnly 生成",
      schema: "cargo run --locked -p office-cli -- schema model|op|transaction",
      command: "node scripts/vendor-muffin-office.mjs --from <来源> --rev <提交> [--source-note <说明>] [--verify]",
    },
    patches: patchHashes,
    files: produced,
  };
  writeFileSync(join(out, "VENDOR.json"), `${JSON.stringify(vendor, null, 2)}\n`);
  mkdirSync(vendorRoot, { recursive: true });
  for (const name of GENERATED) rmSync(join(vendorRoot, name), { recursive: true, force: true });
  for (const name of GENERATED) if (existsSync(join(out, name))) cpSync(join(out, name), join(vendorRoot, name), { recursive: true });
  const bytes = Object.keys(produced).reduce((sum, file) => sum + statSync(join(vendorRoot, file)).size, 0);
  console.log(
    `vendor-muffin-office: 已写入 ${relative(webRoot, vendorRoot)}（${Object.keys(produced).length} 个文件，${(bytes / 1024 / 1024).toFixed(2)} MiB，来源树 ${sourceTree}）`,
  );
}

await main();
