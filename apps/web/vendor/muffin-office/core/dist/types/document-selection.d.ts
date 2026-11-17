import type { PageMapFragment, PageMapLine, PageMapRect } from './page-map';
export type DocumentRect = PageMapRect;
export interface DocumentTextSource {
    readonly text: string;
}
/** 选区只读页图片段里的这几项；整份 `PageMap` 可以直接传入。 */
type PageFragment = Pick<PageMapFragment, 'id' | 'rect' | 'span' | 'repeated'> & {
    readonly lines: readonly Pick<PageMapLine, 'rect' | 'span' | 'caretStops'>[];
};
export interface DocumentSelectionMap<Source extends DocumentTextSource> {
    readonly sources: Readonly<Record<string, Source>>;
    readonly pages: readonly {
        readonly pageIndex: number;
        readonly region: string;
        readonly fragments: readonly PageFragment[];
    }[];
}
export interface DocumentPoint {
    readonly sourceId: string;
    readonly offset: number;
    /** Identifies which line owns a boundary shared with the next line. */
    readonly line?: number;
}
export interface DocumentRange {
    readonly anchor: DocumentPoint;
    readonly focus: DocumentPoint;
}
export interface DocumentSelectionRect extends DocumentRect {
    readonly pageIndex: number;
}
/**
 * Interaction geometry in page-local points and UTF-16 offsets. Fragment order supplies logical
 * reading order, including table and column order; the SDK does not infer order from page x/y.
 * Selection geometry supports monotone caret positions within a line.
 */
export declare class DocumentSelection<Source extends DocumentTextSource> {
    private readonly lines;
    private readonly byPage;
    private readonly bySource;
    private readonly sources;
    constructor(map: DocumentSelectionMap<Source>, selectable: (source: Source, region: string) => boolean);
    private point;
    private line;
    hit(pageIndex: number, x: number, y: number, fragmentId?: string): DocumentPoint | null;
    bounds(range: DocumentRange): readonly [DocumentPoint, DocumentPoint] | null;
    caret(point: DocumentPoint): DocumentSelectionRect | null;
    rectangles(range: DocumentRange): DocumentSelectionRect[];
    text(range: DocumentRange, separator?: string): string;
    lineEdge(point: DocumentPoint, edge: 'start' | 'end'): DocumentPoint | null;
    vertical(point: DocumentPoint, direction: -1 | 1, x: number): DocumentPoint | null;
}
export {};
