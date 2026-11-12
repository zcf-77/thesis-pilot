import { previewRewrite, type TextPatch } from "../state/writingGuards.ts";
import type { WritingRequest, WritingStep, WritingSession, WritingContext, WritingSource } from "../state/writingState.ts";
import { writingConstraintAdvice } from "./writingConstraints.ts";

/** 引用只接受与资料服务同一规范化快照完全一致的来源，版本或核验变化均拒绝。 */
export function citationSourcesCurrent(sources: WritingSource[], current: Pick<WritingSource, "id" | "version" | "verify" | "text">[]): boolean {
  return (
    sources.length > 0 &&
    sources.every(
      (source) =>
        source.verify === "verified" &&
        current.some((item) => item.id === source.id && item.verify === "verified" && item.version === source.version && item.text === source.text),
    )
  );
}

/** 当前稿只在选区字面及所属章节仍一致时承接旧范围；不把旧选区贴上新版本。 */
export function reconcileWritingContext(
  context: WritingContext,
  version: number,
  textAt: (from: number, to: number) => string,
  chapterAt: (position: number) => { id: string; title: string } | undefined,
): WritingContext {
  const selection = context.selection;
  if (!selection.text) return { ...context, selectionVersion: version };
  const chapter = chapterAt(selection.from);
  if (textAt(selection.from, selection.to) !== selection.text || (context.chapter?.id && chapter?.id && context.chapter.id !== chapter.id))
    throw new Error(`此助手的选区来自正文 v${context.selectionVersion ?? "未知"}，内容或章节已变化。请切换到该助手并重新选择文字；未发送过期输入。`);
  return { ...context, selectionVersion: version, chapter };
}

/** 格式请求始终使用格式助手身份，不能借用当前选中助手绕过配置停用。 */
export function captureFormatIntent(sessions: WritingSession[], capture: (session: WritingSession) => WritingRequest): WritingRequest {
  const session = sessions.find((item) => item.kind === "format");
  if (!session) throw new Error("格式助手不可用，请检查配置；当前正文保持不变。");
  const request = capture(session);
  if (request.agent !== "format") throw new Error("格式请求的执行身份不一致，已停止生成。");
  return request;
}

/** 可替换的本地服务：接收固定输入，返回候选数据，永远不持有编辑器或正式写入权限。 */
export function prepareTextPatches(request: WritingRequest, replacement = ""): TextPatch[] {
  const s = request.selection;
  if (replacement.trim()) return [{ id: "h1", from: s.from, to: s.to, before: s.text, after: replacement }];
  return [...s.text.matchAll(/[^。！？!?]+[。！？!?]?/g)].map((match, index) => ({
    id: `h${index + 1}`,
    from: s.from + (match.index ?? 0),
    to: s.from + (match.index ?? 0) + match[0].length,
    before: match[0],
    after: previewRewrite(match[0]),
  }));
}
export function assistantPreview(request: WritingRequest, partial = false): { text: string; steps: WritingStep[] } {
  const basis = `正文 v${request.version}，${request.chapter || "未限定章节"}；${request.sources.length} 项固定来源。`;
  const selected = request.selection.text;
  const content = selected
    ? `选区共 ${selected.length} 字。可按“${request.prompt}”起草表达候选，保留数字和引用，再逐项采纳。`
    : "尚未选择文字。请先选择待讨论的段落，避免根据未知正文给出结论。";
  const lit = request.sources.length
    ? request.sources.map((s) => `${s.title}（v${s.version}，${s.coverage}）：${s.text.slice(0, 180) || "仅题录，不能推断研究结论"}`).join("\n")
    : "未提供可核实文献。请先在资料空间选择来源；不补造题录或结论。";
  const result: Record<string, string> = {
    content,
    lit,
    format: `当前模板 v${request.templateVersion || "未绑定"}、要求 v${request.requirementVersion || "未绑定"}。可审阅支持的标题层级候选，页眉页脚和分页仍需保留原件核对。`,
    progress: "阶段与任务进度以计划空间的证据和学生确认为准；可以检查实际截止、依赖并请求调整候选。此回复不会变更计划。",
    review: `${selected ? "已取得选区，可检查表达和结构。" : "尚未取得具体范围。"}完整报告请在评审空间发起，报告与修改候选分开决定。`,
  };
  for (const agent of ["content", "lit", "format", "progress", "review"] as const)
    result[agent] += `\n本次约束处理：${writingConstraintAdvice(request, agent)}`;
  const steps: WritingStep[] =
    request.agent === "general"
      ? ["content", "lit", "review"].map((agent, i) => ({
          id: `${request.id}-${agent}`,
          agent: agent as WritingStep["agent"],
          title: ["表达与选区", "来源与引用", "检查范围"][i]!,
          status: partial && agent === "lit" ? "failed" : "done",
          result: partial && agent === "lit" ? "模拟来源服务暂不可用；其他结果保留，可单独重试。" : result[agent]!,
        }))
      : [];
  return {
    text: `本地模拟 · ${basis}\n${request.agent === "general" ? steps.map((s) => `${s.title}：${s.result}`).join("\n") + `\n综合约束：${writingConstraintAdvice(request, "general")}` : result[request.agent]}`,
    steps,
  };
}
