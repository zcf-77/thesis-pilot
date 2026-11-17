import type { ChartData, Palette } from './types';
type Anchor = 'start' | 'middle' | 'end';
export interface ChartGeometry {
    bars: Array<{
        x: number;
        y: number;
        w: number;
        h: number;
        fill: string;
        label: string;
    }>;
    /** 折线 / 面积 / 扇区；`opacity` 只作用于填充（面积）。 */
    paths: Array<{
        d: string;
        fill: string;
        stroke: string;
        label: string;
        opacity?: number;
    }>;
    /** 数据标签、刻度标签与坐标轴标题；`rotate` = 竖排的数值轴标题。 */
    labels: Array<{
        x: number;
        y: number;
        text: string;
        anchor?: Anchor;
        rotate?: boolean;
    }>;
    legend: Array<{
        x: number;
        y: number;
        fill: string;
        text: string;
        line?: boolean;
    }>;
    /** 数值轴主网格线。 */
    grid: Array<{
        x1: number;
        x2: number;
        y1: number;
        y2: number;
    }>;
    axis: {
        x1: number;
        x2: number;
        y1: number;
        y2: number;
    } | null;
    font: number;
    title?: {
        x: number;
        y: number;
        text: string;
        size: number;
    };
}
type Rect = {
    x: number;
    y: number;
    width: number;
    height: number;
};
/** 数据标签的数值格式子集：首段、小数位、千分位、百分比（`%` 乘 100）与引号 / 字面量前后缀。 */
export declare function formatValue(v: number, code?: string): string;
/** SVG preview coordinates in pt; signed values share a zero baseline. */
export declare function chartGeometry(c: ChartData, r: Rect, palette: Palette, opts?: {
    font?: number;
}): ChartGeometry;
export {};
