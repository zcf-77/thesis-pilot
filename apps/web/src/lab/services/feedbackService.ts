export interface FeedbackSection {
  id: string;
  title: string;
  text: string;
}
export interface FeedbackProposal {
  segment: { start: number; end: number; text: string };
  suggestion: string;
  task: string;
  locate: string;
  acceptance: string;
  ambiguous: boolean;
  uncertainty: string;
}
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
export function feedbackSections(html: string): FeedbackSection[] {
  return [...html.matchAll(/<(h[1-6]|p|li)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)]
    .map((match, index) => ({
      id: /(?:data-chapter-id|data-section-id|id)=["']([^"']+)["']/.exec(match[0])?.[1] ?? `block-${index}`,
      title: match[1]!.toLowerCase().startsWith("h") ? plain(match[2]!).trim() : `正文片段 ${index + 1}`,
      text: plain(match[2]!).trim(),
    }))
    .filter((section) => section.text);
}
export function locateFeedback(text: string, sections: FeedbackSection[]) {
  if (!text.trim()) return undefined;
  const exact = sections.find((section) => section.title === text || section.id === text);
  if (exact) return exact;
  const number = /\d+(?:\.\d+)+/.exec(text)?.[0];
  return sections.find((section) => (number && section.title.startsWith(number + " ")) || (section.title.length > 3 && text.includes(section.title)));
}

/** A declared deterministic Mock: no model call and no invented teacher intent. */
export function analyzeFeedback(original: string, sections: FeedbackSection[]): FeedbackProposal[] {
  const clauses = [...original.matchAll(/[^。！？!?；;\r\n]+[。！？!?；;]?/g)].filter((match) => match[0].trim());
  if (clauses.length > 50) throw new Error("这段原文超过 50 个意见片段，请使用手动整理或缩小范围；原文保持完整。");
  return clauses.map((match) => {
    const text = match[0].trim();
    const keywords = ["架构", "实验", "文献", "摘要", "绪论", "实现", "测试", "结论"].filter((word) => text.includes(word));
    const matches = sections.filter((section) => keywords.some((word) => section.title.includes(word)));
    const explicit = locateFeedback(text, sections);
    const section = explicit ?? (matches.length === 1 ? matches[0] : undefined);
    const ambiguous = /那个|这个|不太行|再看看|有问题|不清楚|不明确/.test(text) || !section;
    const target = text.replace(/^(?:另外|还有|请|建议|需要|应当|应该)[，,\s]*/, "").replace(/[。！？!?；;]$/, "");
    return {
      segment: { start: match.index, end: match.index + match[0].length, text: match[0] },
      suggestion: `模拟理解：${target}。请对照原话核对，未补充原话以外的实验数据或结论。`,
      task: target.slice(0, 80),
      locate: section?.title ?? "",
      acceptance: `对照原话「${text}」核对实际修改，关联对应版本与具体片段；涉及数量/引用时保留依据。`,
      ambiguous,
      uncertainty: ambiguous ? "原话指向或当前章节位置尚不充分，需要你补充并确认。" : "位置是依据关键词给出的模拟建议，采纳前请核对实际章节。",
    };
  });
}
