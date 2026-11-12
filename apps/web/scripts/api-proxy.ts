import type { Plugin, ProxyOptions } from "vite-plus";

export interface ApiDevelopmentConfig {
  proxy: Record<string, ProxyOptions>;
  plugins: Plugin[];
}

/** Development-only credentials stay in the Vite process and out of browser assets. */
export function apiDevelopmentConfig(environment: Record<string, string>, command: string): ApiDevelopmentConfig {
  if (command !== "serve" || environment.VITE_SERVICE_MODE !== "http") return { proxy: {}, plugins: [] };
  let target: URL;
  try {
    target = new URL(environment.TP_API_TARGET || "http://127.0.0.1:8000");
  } catch {
    throw new Error("开发代理 API 地址无效。");
  }
  if (
    !["http:", "https:"].includes(target.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  )
    throw new Error("开发代理只接受无凭据、无附加路径的本机 HTTP(S) API 地址。");
  const token = environment.TP_API_TOKEN || "";
  if (token.length < 32 || /[\r\n]/.test(token)) throw new Error("HTTP 联调需在 Vite 服务端配置至少 32 字符的 TP_API_TOKEN。");

  return {
    proxy: {
      "/api/v1": {
        target: target.origin,
        changeOrigin: true,
        timeout: 15_000,
        proxyTimeout: 15_000,
        configure(proxy) {
          proxy.on("proxyReq", (request) => request.setHeader("Authorization", `Bearer ${token}`));
        },
      },
    },
    plugins: [
      {
        name: "thesispilot:local-api-origin",
        configureServer(server) {
          // A local development proxy is not a public authentication gateway.
          server.middlewares.use((request, response, next) => {
            if (!request.url?.startsWith("/api/v1") || !request.headers.origin) return next();
            let sameOrigin = false;
            try {
              sameOrigin = new URL(request.headers.origin).host === request.headers.host;
            } catch {
              /* Invalid origins remain rejected. */
            }
            if (sameOrigin) return next();
            response.statusCode = 403;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: { code: "DEV_PROXY_ORIGIN_REJECTED", message: "本机联调不接受跨来源请求", request_id: "dev-proxy" } }));
          });
        },
      },
    ],
  };
}
