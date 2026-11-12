import { describe, expect, it } from "vite-plus/test";
import { apiDevelopmentConfig } from "../../scripts/api-proxy.ts";

describe("本机开发代理凭据边界", () => {
  it("仅在HTTP开发服务器启用，预览与构建都不携带令牌配置", () => {
    expect(apiDevelopmentConfig({ VITE_SERVICE_MODE: "mock" }, "serve")).toEqual({ proxy: {}, plugins: [] });
    expect(apiDevelopmentConfig({ VITE_SERVICE_MODE: "http", TP_API_TOKEN: "PRIVATE" }, "build")).toEqual({ proxy: {}, plugins: [] });
  });
  it("拒绝跨机器代理、夹带URL凭据与未配置令牌", () => {
    const env = { VITE_SERVICE_MODE: "http", TP_API_TOKEN: "a-test-only-token-at-least-32-characters" };
    for (const target of ["https://example.invalid", "http://user:password@127.0.0.1:8000", "http://127.0.0.1:8000/private", "file:///private"])
      expect(() => apiDevelopmentConfig({ ...env, TP_API_TARGET: target }, "serve")).toThrow();
    expect(() => apiDevelopmentConfig({ VITE_SERVICE_MODE: "http" }, "serve")).toThrow();
  });
  it("合法目标只生成固定API代理，不把令牌放进可序列化配置", () => {
    const token = "private-test-token-at-least-32-characters";
    const config = apiDevelopmentConfig({ VITE_SERVICE_MODE: "http", TP_API_TOKEN: token }, "serve");
    expect(Object.keys(config.proxy)).toEqual(["/api/v1"]);
    expect(config.proxy["/api/v1"]?.target).toBe("http://127.0.0.1:8000");
    expect(JSON.stringify(config)).not.toContain(token);
    expect(config.plugins).toHaveLength(1);
  });
});
