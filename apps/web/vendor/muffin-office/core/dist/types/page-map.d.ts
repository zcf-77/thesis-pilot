import type { Border, Color, InlineProps } from './types';
export interface PageMapRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}
/** 待补充短标签：`start/end` 是原文里完整标记的范围，`displayStart/displayEnd` 是显示文字的字符边界。 */
export interface PageMapPlaceholder {
    readonly start: number;
    readonly end: number;
    readonly displayStart: number;
    readonly displayEnd: number;
    readonly requirement: string;
}
export interface PageMapSpan {
    readonly sourceId: string;
    readonly start: number;
    readonly end: number;
    readonly placeholder?: PageMapPlaceholder;
}
export interface PageMapCaretStop {
    readonly offset: number;
    readonly x: number;
}
export interface PageMapLine {
    readonly rect: PageMapRect;
    readonly baselineY: number;
    readonly span?: PageMapSpan;
    readonly caretStops: readonly PageMapCaretStop[];
}
export interface PageMapFragment {
    readonly id: string;
    readonly paragraphId: string;
    readonly rect: PageMapRect;
    readonly span?: PageMapSpan;
    /** 重复表头等再次出现的片段，指向同一来源范围。 */
    readonly repeated: boolean;
    readonly lines: readonly PageMapLine[];
}
export interface PageMapSource {
    readonly chapterId?: string;
    readonly blockId?: string;
    /** 相对输入文档的 JSON Pointer；`docx-layout/1` 没有 JSON 文档，为空串。 */
    readonly textPath: string;
    /** 输入原文，来源偏移以它为准。 */
    readonly text: string;
    readonly displayText: string;
    readonly kind: 'cover' | 'title' | 'heading' | 'text' | 'image' | 'generated';
    readonly placeholders: readonly PageMapPlaceholder[];
}
interface PageMapGlyph {
    readonly x: number;
    readonly y: number;
    readonly text: string;
    readonly advance: number;
    readonly faceId: string;
    readonly size: number;
    /** 字形自身的横向缩放，不作用于 x 与 advance。 */
    readonly scaleX: number;
    readonly style: InlineProps;
}
export type PageMapDraw = (PageMapGlyph & {
    readonly type: 'text';
    readonly span?: PageMapSpan;
    readonly generated: boolean;
}) | (PageMapGlyph & {
    readonly type: 'leader';
    readonly count: number;
    readonly generated: true;
}) | {
    readonly type: 'image';
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly resourceId: string;
    readonly sourceId?: string;
} | {
    readonly type: 'rect';
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly color: Color;
} | {
    readonly type: 'line';
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
    readonly border: Border;
};
export type PageMapRegion = 'cover' | 'toc' | 'body';
export interface PageMapPage {
    readonly pageIndex: number;
    readonly region: PageMapRegion;
    readonly regionPageIndex: number;
    readonly sectionIndex: number;
    /** 封面、目录与双面填充页为 null。 */
    readonly pageNumber: number | null;
    readonly size: {
        readonly w: number;
        readonly h: number;
    };
    readonly bodyRect: PageMapRect;
    readonly fragments: readonly PageMapFragment[];
    readonly draws: readonly PageMapDraw[];
}
export interface PageMapFont {
    readonly id: string;
    readonly sha256: string;
    readonly mime: string;
    readonly url: string;
    readonly dataBase64?: string;
}
export interface PageMapResource {
    readonly id: string;
    readonly mime: string;
    readonly dataBase64: string;
    readonly sha256: string;
}
export interface PageMap {
    readonly schema: 'office-page-map/1' | 'office-page-map/2';
    readonly unit: 'pt';
    readonly offsetUnit: 'utf16';
    readonly inputDigest: string;
    readonly layoutDigest: string;
    /** 版本 1 与带出件的响应必有；版本 2 的纯预览没有。 */
    readonly docxSha256?: string;
    readonly engineBuild: string;
    readonly fontManifestId: string;
    readonly pageCount: number;
    readonly regions: readonly {
        readonly kind: PageMapRegion;
        readonly firstPageIndex: number;
        readonly pageCount: number;
    }[];
    readonly sources: Readonly<Record<string, PageMapSource>>;
    readonly toc: readonly {
        readonly chapterId: string;
        readonly targetPageIndex: number;
        readonly targetPageNumber: number;
    }[];
    readonly pages: readonly PageMapPage[];
    readonly fonts: readonly PageMapFont[];
    readonly resources: readonly PageMapResource[];
    readonly warnings: readonly {
        readonly code: string;
        readonly path: string;
        readonly message: string;
    }[];
    readonly artifacts?: {
        readonly docx?: {
            readonly base64: string;
            readonly sha256: string;
        };
        readonly pdf?: {
            readonly base64: string;
            readonly sha256: string;
        };
    };
}
/**
 * 核对页图在绘制前必须成立的身份、页序、几何数值和引用关系，通过后返回同一个对象。
 * 来源偏移与光标位的合法性由 `DocumentSelection` 在建立选区索引时核对。
 */
export declare function assertPageMap(value: unknown): PageMap;
export {};
