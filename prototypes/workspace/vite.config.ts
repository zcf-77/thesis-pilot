import { defineConfig } from "vite-plus";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [vue(), tailwindcss()],
  build: { modulePreload: false },
  server: { host: "127.0.0.1", port: 18743, strictPort: true },
  lint: {
    options: { typeAware: true, typeCheck: true },
  },
  fmt: {
    ignorePatterns: ["pnpm-lock.yaml", "dist/**", "test-results/**", "playwright-report/**"],
  },
});
