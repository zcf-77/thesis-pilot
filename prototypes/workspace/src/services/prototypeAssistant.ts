import type { AgentRole, ReviewReportData } from "../types";

// 演示适配层：显式固定回复，无外部请求；正式服务按相同边界替换。
export interface AssistantService {
  reply(role: AgentRole, question: string, selectedText: string): Promise<string>;
  revise(text: string): Promise<{ proposed: string; reason: string }>;
  review(version: number): Promise<ReviewReportData>;
}

export const prototypeAssistant: AssistantService = {
  async reply(role, _question, selectedText) {
    const replies: Record<AgentRole, string> = {
      all: "可以先明确本章要回答的问题，再检查各段落是否围绕这个问题展开。选中正文后，可以在这里查看一条修订示例，决定是否采纳。",
      literature:
        "可从“毕业论文过程管理”“学习进度监测”“人机协同写作”三个方向组织检索词。本原型未连接文献数据库，因此不提供虚构的论文题录或检索结果。",
      writing:
        "检查段落时，可先区分研究背景、待解决问题与本文目标。选中一段文字后，点击“润色选区”查看修改前后的对照。",
      format:
        "当前展示自制模板的标题层级、正文与表格样式。学校正式字号、页边距和引用格式需从上传规范中提取；本次不据示例样式认定格式合规。",
      progress:
        "先完成当前章节，再核对任务对应的产物。章节完成由你确认；提醒只能提出下一步建议，不会自动修改计划或把任务标为完成。",
      review:
        "你可以单独查看问题清单与参考评分。原型报告使用固定样例，供体验定位和报告流程，不是对这篇论文的真实评分。",
    };
    return selectedText ? `已关联所选文字。${replies[role]}` : replies[role];
  },
  async revise(text) {
    return {
      proposed: text
        .replaceAll("系统可以根据", "系统根据")
        .replaceAll("对毕业论文的进度进行持续跟踪", "持续跟踪毕业论文进度")
        .replaceAll("在必要的时候", "在关键节点")
        .replaceAll("每一个阶段的任务", "阶段任务")
        .replaceAll("进行持续跟踪", "持续跟踪")
        .replaceAll("不断调整工作", "调整工作安排"),
      reason: "压缩重复表达，保留原段落的目标与职责。",
    };
  },
  async review(version) {
    return {
      version,
      score: 78,
      dimensions: [
        { label: "内容完整性", score: 25, max: 35 },
        { label: "结构与论证", score: 25, max: 30 },
        { label: "规范与表达", score: 28, max: 35 },
      ],
      issues: [
        {
          id: "scope",
          title: "研究目标还可进一步明确",
          detail: "补充能够验证目标达成的条件，并说明验证方式。",
          evidence: "“在保留判断权的同时获得适时帮助”",
          section: "1.2 研究目标",
          severity: "建议完善",
        },
        {
          id: "validation",
          title: "实现与验证内容尚待补充",
          detail: "以真实实现、测试条件和运行结果支撑结论。",
          evidence: "“本章待补充实际实现过程、测试条件及结果”",
          section: "4 实现与验证",
          severity: "需补充",
        },
        {
          id: "references",
          title: "参考文献尚未整理",
          detail: "检索、阅读并核验来源后，再按所用规范整理题录。",
          evidence: "“待补充已检索、阅读并核验的文献来源”",
          section: "参考文献",
          severity: "需补充",
        },
      ],
      unchecked: ["真实文献与研究数据核验", "学校正式模板匹配", "DOCX 分页与公式保真"],
    };
  },
};
