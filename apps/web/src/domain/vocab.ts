import type { Tone } from "../design/tone.ts";
import type { AgentKind, CandidateStatus, JobStatus, ParseStatus, RunStepStatus, TaskStatus, Verdict } from "./types.ts";

/**
 * 状态词汇表：业务状态 → 文案 + 语气。
 * 所有模块从这里取状态的说法与颜色，保证“同一对象在不同功能中的状态一致”。
 */
export interface StatusWord {
  label: string;
  tone: Tone;
  live?: boolean;
  /** 给设计与文案的说明：这个状态意味着什么、不意味着什么 */
  means: string;
}

export const candidateStatus: Record<CandidateStatus, StatusWord> = {
  generating: { label: "生成中", tone: "pencil", live: true, means: "AI 正在起草；可取消，取消后迟到的结果不生效" },
  pending: { label: "待审阅", tone: "pencil", means: "已生成，正文未改动，等待学生决定" },
  invalid: { label: "校验失败", tone: "danger", means: "被程序校验拦下（保护项 / 越界 / 结构无效），不可采纳" },
  adopted: { label: "已采纳", tone: "seal", means: "学生明确采纳，已形成新正文版本" },
  undone: { label: "已撤销", tone: "neutral", means: "已恢复采纳前的正文并形成新版本，原采纳记录保留" },
  rejected: { label: "已拒绝", tone: "neutral", means: "学生拒绝，正文未改动" },
  cancelled: { label: "已取消", tone: "ghost", means: "生成被取消；之后到达的结果被丢弃" },
  expired: { label: "已过期", tone: "stale", means: "所基于的正文版本已变化，需重新生成或重新审阅" },
};

export const taskStatus: Record<TaskStatus, StatusWord> = {
  todo: { label: "待开始", tone: "neutral", means: "尚未开始，不带任何评价" },
  doing: { label: "进行中", tone: "info", means: "学生标记为进行中，尚无需确认的产物" },
  verify: { label: "待核验", tone: "warning", means: "已有可观察的产物，等学生本人确认；系统不会代为确认" },
  confirmed: { label: "学生已确认", tone: "seal", means: "学生确认完成；不等于质量评价，也不等于导师认可" },
};

export const jobStatus: Record<JobStatus, StatusWord> = {
  queued: { label: "排队中", tone: "neutral", means: "已提交，等待执行，可取消" },
  running: { label: "执行中", tone: "info", live: true, means: "正在执行，可取消" },
  done: { label: "已完成", tone: "success", means: "全部子项完成，结果可查看" },
  partial: { label: "部分完成", tone: "warning", means: "部分结果可用，其余失败或未执行，需明确列出" },
  failed: { label: "失败", tone: "danger", means: "未产生结果；原数据保留，可重试" },
  cancelled: { label: "已取消", tone: "ghost", means: "被取消；迟到结果不恢复任务" },
};

export const runStepStatus: Record<RunStepStatus, StatusWord> = {
  waiting: { label: "等待", tone: "neutral", means: "排在后面，尚未开始" },
  running: { label: "执行中", tone: "info", live: true, means: "该子任务正在执行" },
  done: { label: "完成", tone: "success", means: "该子任务完成，结果已返回" },
  failed: { label: "失败", tone: "danger", means: "该子任务失败，不影响其他子任务的结果" },
  cancelled: { label: "已取消", tone: "ghost", means: "被学生取消，不再产生结果" },
};

export const parseStatus: Record<ParseStatus, StatusWord> = {
  waiting: { label: "等待解析", tone: "neutral", means: "已上传，原件已保存" },
  processing: { label: "解析中", tone: "info", live: true, means: "模拟解析进行中，原件已保存" },
  parsed: { label: "解析成功", tone: "success", means: "结构与格式项已提取；不代表都能编辑或导出" },
  partial: { label: "部分识别", tone: "warning", means: "有未识别内容，已列出，可手动纠正" },
  failed: { label: "解析失败", tone: "danger", means: "原件保留，可重试或手动录入" },
};

export const verdict: Record<Verdict, StatusWord> = {
  pass: { label: "符合", tone: "success", means: "硬规则由程序检查通过" },
  fail: { label: "不符合", tone: "danger", means: "硬规则由程序检查未通过" },
  advice: { label: "语义建议", tone: "pencil", means: "AI 给出的带依据判断，不是结论" },
  unknown: { label: "尚不能判定", tone: "ghost", means: "缺少标准或内容，不伪装为合规" },
  conflict: { label: "要求互相矛盾", tone: "warning", means: "两份来源说法不一，需学生或老师澄清" },
  nosource: { label: "来源缺失", tone: "ghost", means: "找不到原文依据，暂不执行" },
};

export const agents: Record<AgentKind, { name: string; short: string; duty: string }> = {
  general: { name: "综合助手", short: "综", duty: "理解意图，协调专业助手，汇总结果" },
  lit: { name: "文献查询", short: "献", duty: "检索样例文献，说明取得范围" },
  content: { name: "内容辅助", short: "文", duty: "针对选区提出修订候选" },
  format: { name: "格式规范", short: "格", duty: "按模板与要求检查格式" },
  progress: { name: "进度管控", short: "程", duty: "解释延期原因，给出计划调整候选" },
  review: { name: "论文评审", short: "评", duty: "只评审、不修改，输出问题清单" },
};
