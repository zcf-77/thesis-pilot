const messages: Record<string, string> = {
  AUTH_NOT_CONFIGURED: "服务尚未配置访问凭据，请检查联调配置。",
  UNAUTHORIZED: "当前连接未通过认证，请重新配置连接。",
  VALIDATION_ERROR: "输入不符合接口约定，请检查后重试。",
  HTTP_ERROR: "请求的资源或操作不可用。",
  INTERNAL_ERROR: "服务暂时无法完成请求，请稍后重试。",
  NOT_READY: "服务依赖尚未就绪，请稍后重试。",
  PROJECT_NOT_FOUND: "项目不存在，请刷新目录。",
  PROJECT_VERSION_CONFLICT: "项目已被其他操作修改。请重新读取，核对名称后再保存。",
  JOB_NOT_FOUND: "任务不存在，请刷新列表。",
  JOB_STATE_CONFLICT: "任务已经结束，不能再取消。",
  JOB_IDEMPOTENCY_CONFLICT: "此请求标识已用于不同任务，请重新发起。",
  DOCUMENT_NOT_FOUND: "此项目尚无正式稿，或该正文已不可访问。",
  DOCUMENT_VERSION_NOT_FOUND: "指定的正文版本不存在。",
  DOCUMENT_ALREADY_EXISTS: "此项目已有正式稿，请读取后继续。",
  DOCUMENT_VERSION_CONFLICT: "正式稿已更新。当前草稿已保留，请先查看最新版本。",
  DOCUMENT_STRUCTURE_INVALID: "正文结构不受支持，当前草稿已保留。",
  DOCUMENT_TOO_LARGE: "正文超过可保存大小，当前草稿已保留。",
  REQUEST_CANCELLED: "请求已取消。",
  REQUEST_TIMEOUT: "请求超时，尚不能确认服务端结果；请先查询状态再决定重试。",
  NETWORK_ERROR: "无法连接服务。当前输入已保留，请检查连接后重试。",
  INVALID_RESPONSE: "服务响应不符合已约定的数据结构，已停止应用结果。",
  INVALID_CONFIGURATION: "服务连接配置无效，请检查模式、接口路径和实例标识。",
};

export class ApiError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly requestId?: string;

  constructor(code: string, options: { status?: number; requestId?: string } = {}) {
    super(messages[code] ?? "服务暂时无法完成请求，请根据请求标识排查。");
    this.name = "ApiError";
    this.code = code;
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ApiError("REQUEST_CANCELLED");
}

/** Service messages never copy raw transport exceptions or response bodies. */
export function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError("NETWORK_ERROR");
}
