import type { DocsModel } from "@muffin-office/core/types";
import { blockText, indexDoc, isTextBlock, mapAnchor, type MapStep, type TransactionMeta } from "@muffin-office/vue/docs-editor/core";
import { scalarLength, scalarToUtf16, sliceScalar, utf16ToScalar, type PreviewAnchor } from "@muffin-office/vue/docs-anchors";
import type { ProtectionAnchor } from "./docsSnapshot.ts";

/**
 * 锚点与偏移：快照、DocsEditor 与服务端一律用 Unicode 标量；浏览器文字 API 与旧 ProseMirror 位置用 UTF-16。
 * 段内文字投影与 MuffinOffice 一致：run 按文字，换行写作 \n、制表写作 \t、其余行内对象写作 U+FFFC，各占 1。
 */
export { scalarLength, scalarToUtf16, sliceScalar, utf16ToScalar };
export type { MapStep, PreviewAnchor };

export interface Utf16Range {
  node: string;
  start: number;
  end: number;
}

/** 段落 / 标题的文字投影；节点不存在或不是文字块时为 undefined。 */
export function textBlockText(model: DocsModel, node: string): string | undefined {
  const index = indexDoc(model);
  const entry = index.blocks.get(node);
  return entry && isTextBlock(entry.block) ? blockText(index, node) : undefined;
}

/** 锚点覆盖的文字（整块保护返回整段文字；非文字块返回 undefined）。 */
export function anchorText(model: DocsModel, anchor: ProtectionAnchor): string | undefined {
  const text = textBlockText(model, anchor.node);
  if (text === undefined) return undefined;
  if (anchor.start === undefined || anchor.end === undefined) return text;
  const length = scalarLength(text);
  if (anchor.start < 0 || anchor.end > length || anchor.start > anchor.end) return undefined;
  return sliceScalar(text, anchor.start, anchor.end);
}

/** 标量区间 → UTF-16 区间（仅段内区间）。 */
export function anchorToUtf16(model: DocsModel, anchor: ProtectionAnchor): Utf16Range | undefined {
  if (anchor.start === undefined || anchor.end === undefined) return undefined;
  const text = textBlockText(model, anchor.node);
  if (text === undefined) return undefined;
  const start = scalarToUtf16(text, anchor.start);
  const end = scalarToUtf16(text, anchor.end);
  return start === undefined || end === undefined || start > end ? undefined : { node: anchor.node, start, end };
}

/** UTF-16 区间 → 标量区间；落在代理对中间或越界时拒绝（undefined）。 */
export function anchorFromUtf16(model: DocsModel, range: Utf16Range): ProtectionAnchor | undefined {
  const text = textBlockText(model, range.node);
  if (text === undefined) return undefined;
  const start = utf16ToScalar(text, range.start);
  const end = utf16ToScalar(text, range.end);
  return start === undefined || end === undefined || start > end ? undefined : { node: range.node, start, end };
}

/** 多次事务的映射步骤按顺序拼接。 */
export function stepsOf(metas: readonly Pick<TransactionMeta, "steps">[]): MapStep[] {
  return metas.flatMap((meta) => meta.steps);
}

/** 让锚点跟随编辑；所在节点被删除时返回 undefined。 */
export function followAnchor(anchor: PreviewAnchor, steps: readonly MapStep[]): PreviewAnchor | undefined {
  return steps.length ? mapAnchor(anchor, steps) : anchor;
}

/** 批量跟随编辑（候选差异、评审命中等宿主自己的叠加数据），丢弃已失效的条目。 */
export function followAnchors<T extends { anchor: PreviewAnchor }>(items: readonly T[], steps: readonly MapStep[]): T[] {
  if (!steps.length) return [...items];
  return items.flatMap((item) => {
    const anchor = mapAnchor(item.anchor, steps);
    return anchor ? [{ ...item, anchor }] : [];
  });
}
