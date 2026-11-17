import type { DocsModel, DocsPreviewContext } from "@muffin-office/core/types";

/** 内核静态资源相对页面的目录（构建时写入 `assets/mo/pkg/`，随其他构建产物由正式服务提供；开发服务器同址提供）。 */
export const MUFFIN_OFFICE_ASSET_DIR = "assets/mo/";

export type DocsEngineErrorCode = "ENGINE_LOAD_FAILED" | "ENGINE_CRASHED" | "MODEL_INVALID";

const messages: Record<DocsEngineErrorCode, string> = {
  ENGINE_LOAD_FAILED: "编辑器内核未能加载。正文和已保存的版本不受影响；请检查网络后重新打开文档。",
  ENGINE_CRASHED: "编辑器内核意外停止。已保存的版本不受影响；请重新打开文档。",
  MODEL_INVALID: "正文结构未通过内核校验，没有打开编辑。已保存的版本保持不变；请恢复其他历史版本或联系维护者。",
};

/** 三段式错误：发生了什么、什么保持不变、下一步。内核原始信息只放在 detail，供排查，不直接展示。 */
export class DocsEngineError extends Error {
  readonly code: DocsEngineErrorCode;
  readonly detail?: string;

  constructor(code: DocsEngineErrorCode, detail?: string) {
    super(messages[code]);
    this.name = "DocsEngineError";
    this.code = code;
    this.detail = detail;
  }
}

export interface OpenedDocsModel {
  /** 内核校验后的模型（validate_project_model 输出，节点 ID 与文字不变）。 */
  model: DocsModel;
  /** DocsEditor 的 context：主题样式、调色板（docs_preview_context）。 */
  context: DocsPreviewContext;
  warnings: string[];
}

export interface DocsEngine {
  readonly version: string;
  /** 校验模型并取得预览上下文；正式导入导出不在浏览器里做。 */
  open(model: DocsModel): Promise<OpenedDocsModel>;
  dispose(): void;
}

export interface DocsEngineOptions {
  /** 内核资源基址；缺省为页面同目录下的 `assets/mo/`，兼容 `base: "./"` 与同源服务。 */
  assetBase?: string | URL;
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 新建一个内核实例：懒加载 @muffin-office/core 与 Worker，初始化失败时已释放 Worker。 */
export async function createDocsEngine(options: DocsEngineOptions = {}): Promise<DocsEngine> {
  let core: typeof import("@muffin-office/core");
  try {
    core = await import("@muffin-office/core");
  } catch (error) {
    throw new DocsEngineError("ENGINE_LOAD_FAILED", describe(error));
  }
  let fatal: string | undefined;
  const assetBase = options.assetBase ?? new URL(MUFFIN_OFFICE_ASSET_DIR, document.baseURI);
  const client = new core.EngineClient((message) => (fatal = message), { assetBase });
  let version: string;
  try {
    version = (await client.init()).version;
  } catch (error) {
    client.dispose();
    throw new DocsEngineError("ENGINE_LOAD_FAILED", describe(error));
  }
  let disposed = false;
  return {
    version,
    async open(model) {
      if (disposed) throw new DocsEngineError("ENGINE_CRASHED", "engine disposed");
      fatal = undefined;
      let result: Awaited<ReturnType<typeof client.openModel>>;
      try {
        result = await client.openModel(JSON.stringify(model));
      } catch (error) {
        throw new DocsEngineError(fatal ? "ENGINE_CRASHED" : "MODEL_INVALID", fatal ?? describe(error));
      }
      if (result.model.kind !== "docs" || !result.docsPreview) throw new DocsEngineError("MODEL_INVALID", `kind=${result.model.kind}`);
      return { model: result.model, context: result.docsPreview, warnings: result.warnings };
    },
    dispose() {
      disposed = true;
      client.dispose();
    },
  };
}

let shared: Promise<DocsEngine> | undefined;

/** 页面共用的内核实例；加载失败后下次调用重新加载。 */
export function loadDocsEngine(options: DocsEngineOptions = {}): Promise<DocsEngine> {
  shared ??= createDocsEngine(options).catch((error: unknown) => {
    shared = undefined;
    throw error;
  });
  return shared;
}

/** 释放共用实例（离开编辑页或测试结束时）。 */
export async function disposeDocsEngine(): Promise<void> {
  const current = shared;
  shared = undefined;
  if (current) (await current.catch(() => undefined))?.dispose();
}
