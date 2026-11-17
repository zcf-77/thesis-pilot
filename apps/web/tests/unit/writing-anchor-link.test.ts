import { describe, expect, it } from "vite-plus/test";
import type { LocationQuery } from "vue-router";
import {
  formatWritingAnchor,
  parseWritingAnchor,
  reviewLocationRoute,
  writingAnchorLink,
  writingAnchorRoute,
  type WritingAnchor,
} from "../../src/workspace/workspaceRoutes.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";

/** 生成的路由经 URL 编解码后交给写作页解析，与浏览器里的深链一致。 */
function throughUrl(route: unknown): LocationQuery {
  const query = (route as { query: Record<string, string> }).query;
  const search = new URLSearchParams(query).toString();
  return Object.fromEntries(new URLSearchParams(search)) as LocationQuery;
}

describe("正文锚点深链：生成 ↔ 解析", () => {
  it.each<WritingAnchor>([
    { node: "01JCHAPTER0000000000000000" },
    { node: "p-1-2", start: 0, end: 4 },
    { node: "p-1-2", start: 7, end: 7 },
    { node: "n@x", start: 2, end: 9 },
    { node: "N1", start: 0, end: Number.MAX_SAFE_INTEGER },
  ])("往返保持锚点 %o", (anchor) => {
    expect(parseWritingAnchor(formatWritingAnchor(anchor))).toEqual(anchor);
    const query = throughUrl(writingAnchorRoute(PROJECT, { chapterId: "ch-1", anchor }));
    expect(writingAnchorLink(query)).toEqual({ chapterId: "ch-1", anchor });
  });

  it("评审定位链接（带区间、无区间、仅章节）都能被写作页解析", () => {
    const ranged = throughUrl(reviewLocationRoute(PROJECT, { chapter_id: "c1", node_id: "N1", start: 3, end: 8 }, "r1"));
    expect(writingAnchorLink(ranged)).toEqual({ chapterId: "c1", anchor: { node: "N1", start: 3, end: 8 } });
    const node = throughUrl(reviewLocationRoute(PROJECT, { chapter_id: "c1", node_id: "N2", start: null, end: null }, "r1"));
    expect(writingAnchorLink(node)).toEqual({ chapterId: "c1", anchor: { node: "N2" } });
    const chapter = throughUrl(reviewLocationRoute(PROJECT, { chapter_id: "c1" }, "r1"));
    expect(writingAnchorLink(chapter)).toEqual({ chapterId: "c1" });
  });

  it("非法值不猜测位置", () => {
    for (const raw of ["", "N1@9-3", "N1@99999999999999999-1", "N1@9007199254740992-9007199254740993", "x".repeat(241), "y".repeat(201) + "@1-2"])
      expect(parseWritingAnchor(raw)).toBeUndefined();
    for (const raw of [undefined, null, 3, ["N1@1-2"], { node: "N1" }]) expect(parseWritingAnchor(raw)).toBeUndefined();
    // 不完整的区间不是区间：整体视为节点 ID，找不到时写作页提示位置已不在正文。
    expect(parseWritingAnchor("N1@3")).toEqual({ node: "N1@3" });
    expect(parseWritingAnchor("N1:3-8")).toEqual({ node: "N1:3-8" });
    expect(writingAnchorLink({ anchor: "N1@9-3", chapterId: "c".repeat(201) })).toEqual({});
  });
});
