import type { SliceBlock } from './commands.ts';
export declare const SLICE_MIME = "application/x-muffin-docs-slice+json";
export declare function sliceToText(slice: readonly SliceBlock[]): string;
export declare function sliceToHtml(slice: readonly SliceBlock[]): string;
/** 私有片段：只保留行内节点与段落属性；资源型对象（图片、图表、脚注引用）不跨文档携带。 */
export declare function serializeSlice(slice: readonly SliceBlock[]): string;
export declare function parseSlice(json: string): SliceBlock[] | undefined;
/** 只用到的 DOM 能力（浏览器 Node 与测试替身都满足）。 */
export interface HtmlNode {
    readonly nodeType: number;
    readonly nodeName: string;
    readonly childNodes: ArrayLike<HtmlNode>;
    readonly nodeValue: string | null;
    getAttribute?(name: string): string | null;
}
/** 解析后的 HTML 文档体 → 段落片段。未知标签只取其文字，对象类标签整体丢弃。 */
export declare function htmlToSlice(root: HtmlNode): SliceBlock[];
