import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite-plus";

/**
 * 页面相对路径：正式工作区构建为 `base: "./"`，运行时以 document.baseURI 解析。
 * 放在 assets/ 下：正式服务只公开 index.html、favicon 与 assets/，内核资源随其他构建产物一起提供。
 */
export const MUFFIN_OFFICE_ASSET_DIR = "assets/mo/";
const PUBLIC_PREFIX = `/${MUFFIN_OFFICE_ASSET_DIR}pkg/`;
const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".wasm": "application/wasm" };

/**
 * MuffinOffice 内核（office-wasm）的静态资源：开发服务器从 vendor 目录直接提供，正式工作区构建时
 * 原样写入 `assets/mo/pkg/`。设计展台单文件构建不使用本插件，产物里不含编辑器与 WASM。
 */
export function muffinOfficeAssets(vendorDir: string): Plugin {
  const wasmDir = join(vendorDir, "office-wasm");
  const files = () => (existsSync(wasmDir) ? readdirSync(wasmDir).filter((name) => name.endsWith(".js") || name.endsWith(".wasm")) : []);
  const typeOf = (name: string) => TYPES[name.slice(name.lastIndexOf("."))];
  return {
    name: "thesispilot:muffin-office-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? "").split("?")[0];
        if (!path.startsWith(PUBLIC_PREFIX)) return next();
        const name = path.slice(PUBLIC_PREFIX.length);
        if (!files().includes(name)) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader("Content-Type", typeOf(name));
        response.setHeader("Cache-Control", "no-cache");
        response.end(readFileSync(join(wasmDir, name)));
      });
    },
    generateBundle() {
      const names = files();
      if (!names.length) this.error("缺少 vendor/muffin-office/office-wasm 产物，请先运行 vendor:muffin-office");
      for (const name of names) this.emitFile({ type: "asset", fileName: `${MUFFIN_OFFICE_ASSET_DIR}pkg/${name}`, source: readFileSync(join(wasmDir, name)) });
    },
  };
}
