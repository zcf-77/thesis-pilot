export type AgentRole = "all" | "literature" | "writing" | "format" | "progress" | "review";
export type AssistantMode = "combined" | "specialist";
export type PanelLayout = "single" | "split";

export interface ChatMessage {
  id: string;
  author: "student" | "assistant";
  text: string;
}
export interface SelectionContext {
  from: number;
  to: number;
  text: string;
  version: number;
  plainText: boolean;
}
export interface RevisionCandidate {
  id: string;
  original: string;
  proposed: string;
  reason: string;
  from: number;
  to: number;
  baseVersion: number;
  status: "pending" | "accepted" | "rejected";
}
export interface ReviewIssue {
  id: string;
  title: string;
  detail: string;
  evidence: string;
  section: string;
  severity: "需补充" | "建议完善";
}
export interface ReviewReportData {
  version: number;
  score: number;
  dimensions: { label: string; score: number; max: number }[];
  issues: ReviewIssue[];
  unchecked: string[];
}
export interface OutlineItem {
  id: string;
  title: string;
  level: number;
  position: number;
}
