import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, lazyPlugins, loadEnv } from "vite-plus";
import { singleFile } from "./scripts/vite-single-file.ts";
import { apiDevelopmentConfig } from "./scripts/api-proxy.ts";

// https://viteplus.dev/config/
export default defineConfig(({ command, mode }) => {
  const environment = { ...loadEnv(mode, process.cwd(), ""), ...process.env } as Record<string, string>;
  const api = apiDevelopmentConfig(environment, command);
  return {
    // 相对路径：构建产物可以从任意子路径或 file:// 打开
    base: "./",
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    plugins: lazyPlugins(() => [vue(), tailwindcss(), singleFile("thesispilot-design-lab.html"), ...api.plugins]),
    server: { host: "127.0.0.1", proxy: api.proxy },
    build: {
      // 设计展台阶段：字体与样式全部内联，供 singleFile 产出单文件
      assetsInlineLimit: 8 * 1024 * 1024,
      cssCodeSplit: false,
      chunkSizeWarningLimit: 8192,
    },
    preview: { port: 4173, strictPort: true },
    fmt: {
      printWidth: 160,
      ignorePatterns: [
        "dist/**",
        "tokens/**",
        "src/design/styles/generated/**",
        "src/services/contracts/api.generated.ts",
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
      ignorePatterns: ["dist/**", "tokens/**"],
    },
    test: {
      include: ["tests/unit/**/*.test.ts"],
      environment: "node",
    },
  };
});
