import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, lazyPlugins, loadEnv } from "vite-plus";
import { singleFile } from "./scripts/vite-single-file.ts";
import { apiDevelopmentConfig } from "./scripts/api-proxy.ts";
import { muffinOfficeAssets } from "./scripts/vite-muffin-office.ts";

// https://viteplus.dev/config/
export default defineConfig(({ command, mode }) => {
  const workspace = mode === "workspace";
  const environment = { ...loadEnv(mode, process.cwd(), ""), ...process.env } as Record<string, string>;
  const api = apiDevelopmentConfig(environment, workspace ? "build" : command);
  return {
    // 相对路径：构建产物可以从任意子路径或 file:// 打开
    base: "./",
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
      // 供应的 MuffinOffice 包把 vue 作为对等依赖，确保与应用共用同一份运行时
      dedupe: ["vue"],
    },
    // 供应包已是构建产物：不预构建，其中的 Worker（new URL + import.meta.url）交给本项目打包
    optimizeDeps: { exclude: ["@muffin-office/core", "@muffin-office/vue"] },
    worker: { format: "es" as const },
    plugins: lazyPlugins(() => [
      vue(),
      tailwindcss(),
      ...(workspace
        ? [
            {
              name: "thesispilot:workspace-entry",
              transformIndexHtml: {
                order: "pre" as const,
                handler: (html: string) => html.replace("/src/main.ts", "/src/workspace-main.ts").replaceAll(" · 设计语言与组件展台", ""),
              },
            },
            muffinOfficeAssets(fileURLToPath(new URL("./vendor/muffin-office", import.meta.url))),
          ]
        : [
            singleFile("thesispilot-design-lab.html"),
            ...api.plugins,
            // 开发服务器同样提供编辑器内核资源；设计展台构建不写入
            ...(command === "serve" ? [muffinOfficeAssets(fileURLToPath(new URL("./vendor/muffin-office", import.meta.url)))] : []),
          ]),
    ]),
    server: { host: "127.0.0.1", proxy: api.proxy },
    build: {
      // 设计展台阶段：字体与样式全部内联，供 singleFile 产出单文件
      outDir: workspace ? "dist-workspace" : "dist",
      assetsInlineLimit: workspace ? 4096 : 8 * 1024 * 1024,
      cssCodeSplit: false,
      chunkSizeWarningLimit: 8192,
    },
    preview: { port: 4173, strictPort: true },
    fmt: {
      printWidth: 160,
      ignorePatterns: [
        "dist/**",
        "dist-workspace/**",
        "tokens/**",
        "src/design/styles/generated/**",
        "src/services/contracts/api.generated.ts",
        "vendor/**",
        "docs/**",
        "licenses/**",
        "pnpm-lock.yaml",
        "*.md",
      ],
    },
    lint: {
      jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
      rules: { "vite-plus/prefer-vite-plus-imports": "error" },
      options: { typeAware: true, typeCheck: true },
      ignorePatterns: ["dist/**", "dist-workspace/**", "tokens/**", "vendor/**"],
    },
    test: {
      include: ["tests/unit/**/*.test.ts"],
      environment: "node",
    },
  };
});
