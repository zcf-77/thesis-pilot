export interface PageSource {
    element: HTMLElement;
    first: boolean;
    restart?: number;
}
/**
 * 一页的起点：第 `source` 个硬分页源里，顶层子节点 `id` 的哪一部分排在页首。
 * fresh 整个节点；text 段落已排掉前 `part` 个字素端点；rows 表格从第 `part` 行续排（重复表头）；caption 只剩题注。
 * 页的版面只取决于起点与其后的内容，所以起点相同、其后内容未变的页可以原样复用（增量续排的依据）。
 */
export interface PageCursor {
    source: number;
    id: string;
    kind: 'fresh' | 'text' | 'rows' | 'caption';
    part: number;
}
export interface PageInfo {
    cursor: PageCursor;
    first: boolean;
    number: number;
}
export interface PaginationOptions {
    /** 从第 `page` 页（全文页下标）按给定起点续排；之前的页不动。 */
    resume?: {
        page: number;
        info: PageInfo;
    };
    /** 每开新页前询问：返回 true 即在此收敛停止（该页及之后沿用旧页）。 */
    stop?: (page: number, info: PageInfo) => boolean;
    /** 返回 true 期间逐页发布且不让出主线程（编辑时让受影响的页同帧更新）。 */
    urgent?: () => boolean;
    /** 段落 `id` 从第 `part` 个端点起排时，上一次在该页排下了多少个端点（拆段二分的起点提示）。 */
    splitHint?: (id: string, part: number) => number | undefined;
}
export interface PaginationResult {
    papers: HTMLElement[];
    warnings: string[];
    /** 与 papers 一一对应的页起点。 */
    infos: PageInfo[];
    /** 因 stop 收敛而结束时，未排的那一页的下标与起点。 */
    stopped?: {
        page: number;
        info: PageInfo;
    };
}
export interface PaginationBatch extends PaginationResult {
    complete: boolean;
}
/** 续排后把总页数写进各页的 NUMPAGES 域（整篇分页由 paginateDocs 自己写）。 */
export declare function setPageTotal(papers: Iterable<Element>, total: number): void;
/** 复用的旧页换了页序 / 页码时更新标签与页码域。 */
export declare function renumberPaper(paper: HTMLElement, index: number, number: number): void;
export declare function paginateDocs(sources: PageSource[], measure: HTMLElement, cancelled: () => boolean, onProgress?: (completedPages: number) => void, onBatch?: (batch: PaginationBatch) => void | Promise<void>, options?: PaginationOptions): Promise<PaginationResult>;
