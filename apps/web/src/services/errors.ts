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
  PROJECT_FLOW_NOT_FOUND: "流程不存在，请刷新流程列表。",
  PROJECT_FLOW_VERSION_NOT_FOUND: "指定流程版本不存在，请重新选择。",
  PROJECT_FLOW_VERSION_CONFLICT: "流程已在其他窗口修改，请读取最新版本后重试。",
  PROJECT_FLOW_BINDING_INVALID: "请同时选择流程版本和阶段，或同时清除关联。",
  PROJECT_FLOW_DISABLED: "该流程已停用，请选择其他流程。",
  PROJECT_FLOW_STAGE_INVALID: "所选阶段不存在或已停用，请重新选择。",
  PROJECT_VERSION_CONFLICT: "项目已被其他操作修改。请重新读取，核对名称后再保存。",
  JOB_NOT_FOUND: "任务不存在，请刷新列表。",
  MATERIAL_NOT_FOUND: "资料不存在，请刷新资料列表。",
  MATERIAL_ORIGINAL_NOT_FOUND: "原件版本不存在，请重新读取原件列表。",
  MATERIAL_PARSE_NOT_FOUND: "解析版本不存在，请重新读取解析历史。",
  MATERIAL_VERSION_CONFLICT: "资料已在其他窗口更新，请保留输入并载入最新版本。",
  MATERIAL_IDEMPOTENCY_CONFLICT: "上传请求标识已用于不同内容，请核对原上传结果。",
  MATERIAL_UPLOAD_KEY_CONFLICT: "上传或解析请求标识已用于不同内容，请先核对原请求结果。",
  MATERIAL_BASE64_INVALID: "原件编码无效，请重新选择文件。",
  MATERIAL_FILE_TYPE_INVALID: "文件名称或内容与所选类型不一致，请重新选择文件。",
  MATERIAL_UPLOAD_INCOMPLETE: "上传记录尚不完整，请先重新读取上传结果。",
  MATERIAL_BINDING_CONFLICT: "项目来源绑定已更新，请载入最新绑定后再保存。",
  MATERIAL_BINDING_INVALID: "请选择本项目中可用且包含所需来源条目的解析版本。",
  MATERIAL_BINDING_NOT_FOUND: "指定来源绑定历史不存在。",
  MATERIAL_SOURCES_TOO_LARGE: "选定来源过大，请选择较小的适用范围。",
  MATERIAL_TOO_LARGE: "原件或上传请求超过8MiB文件限制，请缩小文件后重试。",
  MATERIAL_UNSUPPORTED_TYPE: "当前解析器不支持此文件类型，原件仍已保留。",
  MATERIAL_PARSE_INVALID: "原件无法按所选类型解析，原件仍已保留。",
  MATERIAL_PARSE_LIMIT_EXCEEDED: "原件解析超过安全处理范围，原件仍已保留。",
  MATERIAL_ORIGINAL_CORRUPT: "原件摘要不一致，已停止解析，请检查原件。",
  MATERIAL_PARSER_VERSION_UNAVAILABLE: "固定解析器版本不可用，请重新发起解析。",
  MATERIAL_PARSE_CONFLICT: "原件已有更新的解析结果，请载入最新结果后再解析。",
  PROJECT_SOURCE_BINDING_CONFLICT: "项目来源绑定已更新，请载入最新绑定后再保存。",
  PROJECT_SOURCE_BINDING_INVALID: "请选择本项目中类型正确且可用的解析版本。",
  PROJECT_SOURCE_BINDING_VERSION_NOT_FOUND: "指定来源绑定历史不存在。",
  JOB_STATE_CONFLICT: "当前状态无法执行此操作，请查看最新任务状态。",
  JOB_KIND_UNAVAILABLE: "当前工作区不支持此任务类型。",
  JOB_INPUT_INVALID: "该任务的固定输入无效，请返回来源检查版本。",
  AI_CONFIG_NOT_FOUND: "配置不存在，请刷新配置列表。",
  AI_CONFIG_VERSION_NOT_FOUND: "指定配置版本不存在，请重新选择。",
  AI_CONFIG_VERSION_CONFLICT: "配置已在其他窗口更新，请载入最新版本后重试。",
  AI_CONFIG_NAME_CONFLICT: "同一配置库中已有此名称，请换一个名称后保存。",
  AI_CONFIG_DISABLED: "引用配置已停用，请选择启用中的配置版本。",
  AI_CONFIG_REFERENCE_INVALID: "引用链不完整或类型不匹配，请检查关联版本。",
  AI_CONFIG_VARIABLE_INVALID: "提示词变量与声明不一致，请检查后重试。",
  AI_CONFIG_SCHEMA_INVALID: "输入或输出结构约束无效，请检查配置。",
  AI_CONFIG_KIND_MISMATCH: "配置类型不能修改，请复制为新配置。",
  MODEL_NOT_CONFIGURED: "模型服务尚未配置可用凭据。",
  MODEL_AUTH_FAILED: "模型服务认证失败，请检查服务端凭据。",
  MODEL_RATE_LIMITED: "模型服务限流，请稍后手动重试。",
  MODEL_TIMEOUT: "模型服务响应超时，请确认任务状态后重试。",
  MODEL_UNAVAILABLE: "模型服务暂时不可用，请稍后手动重试。",
  MODEL_INVALID_RESPONSE: "模型响应不符合约定，未作为成功结果应用。",
  MODEL_OUTPUT_TOO_LARGE: "模型输出超过限制，请缩小试跑输入。",
  MODEL_RETRY_LIMIT_REACHED: "已达到该固定配置允许的显式重试总次数。",
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
