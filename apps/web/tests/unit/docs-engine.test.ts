import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { DocsModel } from "@muffin-office/core/types";

const behavior = vi.hoisted(() => ({
  init: "ok" as "ok" | "fail",
  open: "ok" as "ok" | "invalid" | "crash" | "slides",
  created: [] as Array<{ assetBase: unknown; disposed: boolean }>,
}));

vi.mock("@muffin-office/core", () => ({
  EngineClient: class {
    private readonly record: { assetBase: unknown; disposed: boolean };
    private readonly onFatal: (message: string) => void;
    constructor(onFatal: (message: string) => void, options: { assetBase?: unknown }) {
      this.onFatal = onFatal;
      this.record = { assetBase: options.assetBase, disposed: false };
      behavior.created.push(this.record);
    }
    async init() {
      if (behavior.init === "fail") throw new Error("WASM HTTP 404");
      return { version: "test-engine", wasmBytes: 1, themes: [], engineMs: 0 };
    }
    async openModel(modelJson: string) {
      const model = JSON.parse(modelJson) as DocsModel;
      if (behavior.open === "invalid") throw new Error("schema: missing field `id`");
      if (behavior.open === "crash") {
        this.onFatal("Worker 错误：脚本加载失败");
        throw new Error("Worker 错误：脚本加载失败");
      }
      if (behavior.open === "slides") return { model: { ...model, kind: "slides" }, warnings: [] };
      return { model, docsPreview: { name: "gongwen" }, warnings: ["w"] };
    }
    dispose() {
      this.record.disposed = true;
    }
  },
}));

const { createDocsEngine, disposeDocsEngine, DocsEngineError, loadDocsEngine } = await import("../../src/workspace/editor/engine.ts");

const model = { kind: "docs", schemaVersion: 1, id: "d", theme: { name: "gongwen" }, sections: [] } as DocsModel;
const assetBase = "http://127.0.0.1/app/mo/";

afterEach(async () => {
  behavior.init = "ok";
  behavior.open = "ok";
  behavior.created.length = 0;
  await disposeDocsEngine();
});

describe("编辑器内核接入", () => {
  it("初始化并返回校验后的模型与预览上下文", async () => {
    const engine = await createDocsEngine({ assetBase });
    expect(engine.version).toBe("test-engine");
    expect(behavior.created[0].assetBase).toBe(assetBase);
    await expect(engine.open(model)).resolves.toEqual({ model, context: { name: "gongwen" }, warnings: ["w"] });
  });

  it("加载失败给出三段式错误并释放 Worker", async () => {
    behavior.init = "fail";
    const error = await createDocsEngine({ assetBase }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DocsEngineError);
    expect(error).toMatchObject({ code: "ENGINE_LOAD_FAILED", detail: "WASM HTTP 404" });
    expect((error as Error).message).toBe("编辑器内核未能加载。正文和已保存的版本不受影响；请检查网络后重新打开文档。");
    expect(behavior.created[0].disposed).toBe(true);
  });

  it("区分模型校验失败与内核崩溃", async () => {
    const engine = await createDocsEngine({ assetBase });
    behavior.open = "invalid";
    await expect(engine.open(model)).rejects.toMatchObject({ code: "MODEL_INVALID" });
    behavior.open = "slides";
    await expect(engine.open(model)).rejects.toMatchObject({ code: "MODEL_INVALID" });
    behavior.open = "crash";
    await expect(engine.open(model)).rejects.toMatchObject({ code: "ENGINE_CRASHED" });
    behavior.open = "ok";
    engine.dispose();
    await expect(engine.open(model)).rejects.toMatchObject({ code: "ENGINE_CRASHED" });
  });

  it("共用实例在失败后可重新加载", async () => {
    behavior.init = "fail";
    await expect(loadDocsEngine({ assetBase })).rejects.toMatchObject({ code: "ENGINE_LOAD_FAILED" });
    behavior.init = "ok";
    const first = await loadDocsEngine({ assetBase });
    expect(await loadDocsEngine({ assetBase })).toBe(first);
    await disposeDocsEngine();
    expect(behavior.created.at(-1)?.disposed).toBe(true);
  });
});
