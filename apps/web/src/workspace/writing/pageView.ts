/** 一页纸在视口坐标中的上下沿。 */
export interface PageBox {
  top: number;
  bottom: number;
}

/**
 * 状态栏页码（从 1 起）：光标所在页仍在视口内时显示光标页，否则显示视口中线所在页；
 * 页与页之间的空隙算作下一页。页面按文档顺序自上而下排列，按需读取各页位置。
 */
export function pageInView(count: number, box: (index: number) => PageBox, viewTop: number, viewBottom: number, cursor: number): number {
  if (count <= 0 || viewBottom <= viewTop) return cursor;
  if (cursor >= 1 && cursor <= count) {
    const page = box(cursor - 1);
    if (page.bottom > viewTop && page.top < viewBottom) return cursor;
  }
  const middle = (viewTop + viewBottom) / 2;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (box(mid).bottom < middle) low = mid + 1;
    else high = mid;
  }
  return low + 1;
}
