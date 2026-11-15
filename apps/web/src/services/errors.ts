const messages: Record<string, string> = {
  AUTH_NOT_CONFIGURED: "服务尚未配置访问凭据，请检查联调配置。",
  UNAUTHORIZED: "当前连接未通过认证，请重新配置连接。",
  WORKSPACE_SESSION_REQUIRED: "工作区会话已失效，请重新进入。",
  WORKSPACE_ACCESS_DENIED: "访问密钥不正确。",
  WORKSPACE_ORIGIN_REJECTED: "请从工作区的本机地址进入。",
  WORKSPACE_PROFILE_CONFLICT: "偏好已在其他窗口更新，请读取最新设置后继续。",
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
  REVISION_NOT_FOUND: "这条修订候选不存在，请重新读取。",
  REVISION_COMMAND_NOT_FOUND: "尚未查到本次操作结果，请继续查询或使用原请求重试。",
  REVISION_STALE: "正文版本已变化，当前候选不能覆盖新稿。",
  REVISION_STATE_CONFLICT: "候选状态已变化，请重新读取后操作。",
  REVISION_REVIEW_CONFLICT: "审阅决定已被修改，请重新读取。",
  REVISION_COMMAND_CONFLICT: "本次请求与原操作内容不同，已停止提交。",
  REVISION_POLICY_STALE: "这条候选使用的保护规则已更新，请重新生成。",
  REVISION_UNDO_CONFLICT: "采纳后已有其他版本，请先查看历史再决定恢复。",
  REVISION_ANCHOR_INVALID: "选区定位或原文不匹配，请重新选择。",
  REVISION_PATCH_INVALID: "候选包含重叠、越界或无效修改，不能采纳。",
  REVISION_PROTECTION_FAILED: "候选未通过内容保护检查，正文保持不变。",
  REVISION_UNSUPPORTED: "当前选区包含暂不支持的结构或保护表达，请保留原文。",
  REVISION_NOTHING_ACCEPTED: "请先选择要接受的修改。",
  REVISION_NO_CHANGE: "没有可以写入的变化。",
  REVISION_TOO_LARGE: "本次修订内容过大，请缩小选区后重试。",
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
