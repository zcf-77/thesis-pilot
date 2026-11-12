import type { ApiTypes, SchemaName } from "./contracts/api.generated.ts";
import { ApiError, throwIfAborted } from "./errors.ts";
import type { BackendServices, CreateServicesOptions } from "./types.ts";
import { pageQuery, parseDto, requireIdempotencyKey, requireUuid } from "./validation.ts";

function safeRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : undefined;
}

function responseError(response: Response, body: unknown): ApiError {
  let code = "HTTP_ERROR";
  let requestId = safeRequestId(response.headers.get("X-Request-ID"));
  try {
    const parsed = parseDto("ErrorResponse", body);
    if (/^[A-Z][A-Z0-9_]{1,79}$/.test(parsed.error.code)) code = parsed.error.code;
    requestId ??= safeRequestId(parsed.error.request_id);
  } catch {
    // The error body is untrusted and may contain private content or an HTML proxy page.
  }
  return new ApiError(code, { status: response.status, requestId });
}

export function createHttpServices(options: CreateServicesOptions, sourceKey: string): BackendServices {
  const baseUrl = (options.baseUrl ?? "/api/v1").replace(/\/$/, "");
  if (!/^\/(?!\/)[A-Za-z0-9/_-]+$/.test(baseUrl)) throw new ApiError("INVALID_CONFIGURATION");
  const transport = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!transport || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new ApiError("INVALID_CONFIGURATION");

  async function request<Name extends SchemaName>(
    path: string,
    schema: Name,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
    extraHeaders: Record<string, string> = {},
  ): Promise<ApiTypes[Name]> {
    throwIfAborted(signal);
    const controller = new AbortController();
    let timedOut = false;
    let abortListener: (() => void) | undefined;
    const cancellation = new Promise<never>((_, reject) => {
      abortListener = () => reject(new ApiError(timedOut ? "REQUEST_TIMEOUT" : "REQUEST_CANCELLED"));
      controller.signal.addEventListener("abort", abortListener, { once: true });
    });
    const forwardAbort = () => controller.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const perform = async (): Promise<ApiTypes[Name]> => {
      const response = await transport!(baseUrl + path, {
        method,
        credentials: "same-origin",
        redirect: "error",
        signal: controller.signal,
        headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extraHeaders },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      if (text.length > 1_000_000) throw new ApiError("INVALID_RESPONSE", { status: response.status });
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        if (!response.ok) throw responseError(response, null);
        throw new ApiError("INVALID_RESPONSE", { status: response.status });
      }
      if (!response.ok) throw responseError(response, parsed);
      return parseDto(schema, parsed);
    };
    try {
      return await Promise.race([perform(), cancellation]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) throw new ApiError(timedOut ? "REQUEST_TIMEOUT" : "REQUEST_CANCELLED");
      throw new ApiError("NETWORK_ERROR");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
      if (abortListener) controller.signal.removeEventListener("abort", abortListener);
    }
  }

  return {
    sourceKey,
    projects: {
      async list(query, signal) {
        const { limit, offset } = pageQuery(query);
        return request(`/projects?limit=${limit}&offset=${offset}`, "ProjectPage", "GET", undefined, signal);
      },
      async create(input, signal) {
        const data = parseDto("ProjectCreate", { ...input, name: typeof input.name === "string" ? input.name.trim() : input.name }, true);
        return request("/projects", "ProjectRead", "POST", data, signal);
      },
      async get(id, signal) {
        return request(`/projects/${requireUuid(id)}`, "ProjectRead", "GET", undefined, signal);
      },
      async update(id, input, signal) {
        const data = parseDto("ProjectUpdate", { ...input, name: typeof input.name === "string" ? input.name.trim() : input.name }, true);
        return request(`/projects/${requireUuid(id)}`, "ProjectRead", "PATCH", data, signal);
      },
    },
    jobs: {
      async list(query, signal) {
        const { limit, offset } = pageQuery(query);
        return request(`/jobs?project_id=${requireUuid(query.project_id)}&limit=${limit}&offset=${offset}`, "JobPage", "GET", undefined, signal);
      },
      async create(input, idempotencyKey, signal) {
        const data = parseDto("JobCreate", { kind: "diagnostic", ...input }, true);
        return request("/jobs", "JobRead", "POST", data, signal, { "Idempotency-Key": requireIdempotencyKey(idempotencyKey) });
      },
      async get(id, signal) {
        return request(`/jobs/${requireUuid(id)}`, "JobRead", "GET", undefined, signal);
      },
      async cancel(id, signal) {
        return request(`/jobs/${requireUuid(id)}/cancel`, "JobRead", "POST", undefined, signal);
      },
    },
  };
}
