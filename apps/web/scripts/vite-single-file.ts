import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite-plus";

/**
 * 构建结束后，把 dist/index.html 引用的脚本、样式与图标内联成一个可以直接双击打开的 HTML。
 * 仅服务于“设计展台”阶段的评审交付；进入全量实现后可以从 vite.config.ts 移除。
 * 前提：build.assetsInlineLimit 足够大（字体已以 data URI 进入 CSS），且没有动态 import。
 */
export function singleFile(outName: string): Plugin {
  let outDir = "dist";
  return {
    name: "thesispilot:single-file",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const read = (rel: string) => readFileSync(resolve(outDir, rel), "utf8");
      let html = read("index.html");
      html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g, (_m, href: string) => "<style>" + read(href) + "</style>");
      html = html.replace(
        /<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g,
        (_m, src: string) => '<script type="module">' + read(src).replace(/<\/script/g, "<\\/script") + "</script>",
      );
      html = html.replace(/<link rel="icon"[^>]*href="\.\/([^"]+)"[^>]*>/g, (_m, href: string) => {
        const svg = readFileSync(resolve(outDir, href));
        return '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,' + svg.toString("base64") + '" />';
      });
      if (/(src|href)="\.\/assets\//.test(html)) {
        this.warn("单文件产物中仍有未内联的资源引用");
      }
      writeFileSync(resolve(outDir, outName), html);
      this.info(outName + " " + (Buffer.byteLength(html) / 1024 / 1024).toFixed(2) + " MB");
    },
  };
}
