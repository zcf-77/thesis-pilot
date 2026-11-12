import { createServices, type BackendServices } from "./index.ts";

export type ServiceMode = "preview" | "mock" | "http";

const configuredMode = import.meta.env.VITE_SERVICE_MODE || "preview";
if (!["preview", "mock", "http"].includes(configuredMode)) throw new Error("VITE_SERVICE_MODE 必须为 preview、mock 或 http。");
const mode = configuredMode as ServiceMode;
const instanceId = import.meta.env.VITE_API_INSTANCE || (mode === "mock" ? "local-mock" : "");
if (mode === "http" && !instanceId) throw new Error("HTTP 接入必须显式配置 VITE_API_INSTANCE，以隔离不同服务的数据关联。");

const services: BackendServices | null =
  mode === "preview" ? null : createServices({ mode, instanceId, baseUrl: import.meta.env.VITE_API_BASE_URL || "/api/v1" });
const runtime = {
  mode,
  services,
  sourceLabel: mode === "preview" ? "本机预览" : mode === "mock" ? "本地模拟服务" : "服务端项目",
};

/** The selected backend is explicit and stable for this app session. Never fall back on failure. */
export function useBackendServices() {
  return runtime;
}
