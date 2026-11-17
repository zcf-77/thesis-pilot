export type Emu = number;
export interface Rect {
    x: Emu;
    y: Emu;
    w: Emu;
    h: Emu;
}
export type ThemeColorName = 'dk1' | 'lt1' | 'dk2' | 'lt2' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6' | 'hlink' | 'folHlink';
export type Color = {
    kind: 'rgb';
    value: string;
} | {
    kind: 'theme';
    value: ThemeColorName;
} | {
    kind: 'auto';
};
export type Palette = Record<ThemeColorName, string>;
export interface ThemeFonts {
    bodyZh: string;
    bodyLatin: string;
    headingZh: string;
    headingLatin: string;
    mono: string;
}
export type Align = 'start' | 'center' | 'end' | 'justify' | 'distributed';
export type VAlign = 'top' | 'center' | 'bottom';
export interface InlineProps {
    style?: string;
    font?: {
        kind: 'theme' | 'named';
        value: string;
    };
    fontEastAsia?: {
        kind: 'theme' | 'named';
        value: string;
    };
    lang?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: string;
    strike?: boolean;
    code?: boolean;
    color?: Color;
    highlight?: Color;
    size?: number;
    link?: {
        href: string;
        title?: string;
    };
    verticalAlign?: 'baseline' | 'superscript' | 'subscript';
    /** 字符间距（EMU，正值加宽；OOXML rPr `w:spacing`）。 */
    letterSpacing?: Emu;
}
export type Inline = {
    type: 'run';
    text: string;
    props?: InlineProps;
} | {
    type: 'break';
    kind?: 'line' | 'column';
} | {
    type: 'tab';
} | {
    type: 'image';
    resource: string;
    alt?: string;
    title?: string;
    width?: Emu;
    height?: Emu;
    /** 浮动定位（DOCX `wp:anchor`）：有值时不占行内位置，按参照框画在纸张上。 */
    anchor?: ImageAnchor;
} | {
    type: 'chart';
    chart: ChartData;
    alt?: string;
    width?: Emu;
    height?: Emu;
} | {
    type: 'footnote_ref';
    id: string;
} | {
    type: 'bookmark';
    name: string;
} | {
    type: 'field';
    kind: 'page_number' | 'num_pages' | 'date' | 'title' | 'author';
};
/** 浮动图定位：目前只承载页眉页脚里相对页面 / 版心、不环绕的图片（典型是"衬于文字下方"的水印）。 */
export interface ImageAnchor {
    x: AnchorPos;
    y: AnchorPos;
    /** 衬于文字下方；否则浮于文字上方。 */
    behindText?: boolean;
}
/** 单轴定位：`align` 有值时按参照框对齐（水平 左/中/右，垂直 上/中/下），否则取 `offset`（相对参照框左 / 上边）。 */
export interface AnchorPos {
    from: 'page' | 'margin';
    align?: 'start' | 'center' | 'end';
    offset?: Emu;
}
export type ListKind = 'bullet' | 'decimal' | 'lower_alpha' | 'upper_alpha' | 'lower_roman' | 'upper_roman' | 'chinese_counting' | 'chinese_paren' | 'task' | 'decimal_enclosed_circle';
export interface CellProps {
    width?: Emu;
    valign?: VAlign;
    shading?: Color;
    borders?: Borders;
}
export interface Border {
    style: 'none' | 'single' | 'double' | 'dashed' | 'dotted';
    width?: Emu;
    color?: Color;
}
export interface Borders {
    top?: Border;
    bottom?: Border;
    left?: Border;
    right?: Border;
    insideH?: Border;
    insideV?: Border;
}
export interface ParaProps {
    style?: string;
    align?: Align;
    spacing?: {
        before?: Emu;
        after?: Emu;
        line?: {
            kind: 'multiple' | 'exact' | 'at_least';
            value: number;
        };
    };
    indent?: {
        start?: Emu;
        end?: Emu;
        firstLine?: Emu;
        hanging?: Emu;
        /** 1/100 字；负的 firstLineChars 表示悬挂。 */
        startChars?: number;
        endChars?: number;
        firstLineChars?: number;
    };
    tabs?: TabStop[];
    snapToGrid?: boolean;
    kinsoku?: boolean;
    overflowPunct?: boolean;
    topLinePunct?: boolean;
    adjustRightInd?: boolean;
    listLabel?: ListLabel;
    run?: InlineProps;
    shading?: Color;
    pageBreakBefore?: boolean;
    keepWithNext?: boolean;
    keepLines?: boolean;
    widowControl?: boolean;
    autoSpaceDe?: boolean;
    autoSpaceDn?: boolean;
    outlineLevel?: number;
    borders?: Borders;
}
export interface TabStop {
    pos: Emu;
    kind: 'start' | 'center' | 'end' | 'decimal' | 'clear';
    leader?: 'none' | 'dot' | 'hyphen' | 'underscore';
}
/** 导入 Word 自动编号时算出的标签；预览排在首行行首。 */
export interface ListLabel {
    text: string;
    suffix?: 'tab' | 'space' | 'nothing';
    run?: InlineProps;
    level?: number;
}
export interface DocGrid {
    kind: 'lines' | 'lines_and_chars' | 'snap_to_chars';
    linePitch: Emu;
    /** 1/4096 pt，字距增量。 */
    charSpace?: number;
}
export interface PageProps {
    size: {
        width: Emu;
        height: Emu;
    };
    orientation: 'portrait' | 'landscape';
    margins: {
        top: Emu;
        bottom: Emu;
        left: Emu;
        right: Emu;
        header?: Emu;
        footer?: Emu;
        gutter?: Emu;
    };
    columns?: number;
    grid?: DocGrid;
}
export interface TableCell {
    id: string;
    colSpan?: number;
    rowSpan?: number;
    props?: CellProps;
    blocks: Block[];
}
export interface TableRow {
    id: string;
    height?: Emu;
    header?: boolean;
    cantSplit?: boolean;
    cells: TableCell[];
}
export interface Table {
    id: string;
    props?: {
        headerRows?: number;
        style?: string;
        width?: {
            kind: 'emu' | 'pct';
            value: number;
        };
        align?: Align;
        borders?: Borders;
        cellMargin?: Emu;
        cellMarginVertical?: Emu;
        layout?: 'fixed' | 'autofit';
    };
    colWidths?: Emu[];
    rows: TableRow[];
    caption?: Inline[];
}
export interface ListItem {
    id: string;
    checked?: boolean;
    blocks: Block[];
}
export type Block = {
    type: 'paragraph';
    id: string;
    props?: ParaProps;
    inlines: Inline[];
} | {
    type: 'heading';
    id: string;
    level: number;
    props?: ParaProps;
    inlines: Inline[];
} | {
    type: 'list';
    id: string;
    kind: ListKind;
    start?: number;
    items: ListItem[];
} | ({
    type: 'table';
} & Table) | {
    type: 'image';
    id: string;
    resource: string;
    alt?: string;
    width?: Emu;
    height?: Emu;
    caption?: Inline[];
    align?: Align;
} | {
    type: 'code_block';
    id: string;
    lang?: string;
    text: string;
} | {
    type: 'quote';
    id: string;
    blocks: Block[];
} | {
    type: 'container';
    id: string;
    kind: string;
    blocks: Block[];
} | {
    type: 'page_break';
    id: string;
} | {
    type: 'rule';
    id: string;
} | {
    type: 'toc';
    id: string;
    levels?: number;
    title?: string;
};
export interface Unsupported {
    kind: string;
    path: string;
    detail?: string;
}
export interface Meta {
    title?: string;
    subtitle?: string;
    author?: string;
    date?: string;
}
export interface Resource {
    id: string;
    mime: string;
    name?: string;
    data: {
        kind: 'bytes' | 'uri';
        value: string;
    };
    widthPx?: number;
    heightPx?: number;
}
export interface ThemeRef {
    name: string;
}
export type LayoutKind = 'title' | 'section' | 'bullets' | 'two_column' | 'image_text' | 'chart' | 'table' | 'quote' | 'timeline' | 'closing' | 'blank';
export interface HeaderFooter {
    blocks: Block[];
    firstPage?: Block[];
    evenPage?: Block[];
}
export interface Section {
    id: string;
    blocks: Block[];
    page?: PageProps;
    header?: HeaderFooter;
    footer?: HeaderFooter;
    breakKind?: 'next_page' | 'continuous' | 'even_page' | 'odd_page';
    pageNumberStart?: number;
}
/** OOXML `a:bodyPr`（导入 PPTX 时携带；缺省按 OOXML：左右 91 440、上下 45 720 EMU）。 */
export interface TextBody {
    insetLeft?: Emu;
    insetTop?: Emu;
    insetRight?: Emu;
    insetBottom?: Emu;
    anchor?: VAlign;
    autofit?: 'none' | 'shape' | 'normal';
    /** 1/1000 %（100 000 = 100%）。 */
    fontScale?: number;
    lineReduction?: number;
    wrap?: boolean;
}
export type LineDash = 'solid' | 'dot' | 'dash' | 'lg_dash' | 'dash_dot' | 'lg_dash_dot' | 'lg_dash_dot_dot' | 'sys_dash' | 'sys_dot' | 'sys_dash_dot' | 'sys_dash_dot_dot';
export interface Gradient {
    stops: Array<{
        pos: number;
        color: Color;
        alpha?: number;
    }>;
    /** 1/60 000 度。 */
    angle?: number;
    radial?: boolean;
}
/** 形状外观（导入 PPTX 保真）。 */
export interface ShapeStyle {
    geometry?: string;
    adjust?: Record<string, number>;
    /** 顺时针，1/60 000 度。 */
    rotation?: number;
    flipH?: boolean;
    flipV?: boolean;
    gradient?: Gradient;
    fillAlpha?: number;
    lineWidth?: Emu;
    lineDash?: LineDash;
    headArrow?: boolean;
    tailArrow?: boolean;
}
export interface SourceTheme {
    name?: string;
    colors?: Palette;
    headingLatin?: string;
    headingEa?: string;
    bodyLatin?: string;
    bodyEa?: string;
}
export interface Slot {
    kind: string;
    rect?: Rect;
    content: {
        type: string;
        inlines?: Inline[];
        blocks?: Block[];
        [key: string]: unknown;
    };
    body?: TextBody;
}
export interface FreeShape {
    id: string;
    kind: 'text_box' | 'picture' | 'rect' | 'line';
    rect: Rect;
    content?: Slot['content'];
    fill?: Color;
    line?: Color;
    style?: ShapeStyle;
    body?: TextBody;
}
export type MotionTarget = {
    kind: 'shape';
    id: string;
} | {
    kind: 'slot';
    slot: string;
};
/** 起始边：飞入从该边进入，擦除从该边开始揭示。 */
export type AnimationDirection = 'left' | 'right' | 'up' | 'down';
export interface SlideTransition {
    effect: 'fade';
    durationMs: number;
}
export interface SlideAnimation {
    target: MotionTarget;
    effect: 'appear' | 'fade' | 'fly_in' | 'wipe';
    /** 仅 fly_in / wipe 可用；省略时从左侧开始。 */
    direction?: AnimationDirection;
    trigger: 'on_click' | 'with_previous' | 'after_previous';
    durationMs: number;
    delayMs?: number;
}
export interface Slide {
    id: string;
    layout: LayoutKind;
    slots: Slot[];
    shapes?: FreeShape[];
    background?: Color;
    hidden?: boolean;
    notes?: string;
    transition?: SlideTransition;
    animations?: SlideAnimation[];
}
export interface DocsModel {
    kind: 'docs';
    schemaVersion: number;
    id: string;
    meta?: Meta;
    theme: ThemeRef;
    sections: Section[];
    unsupported?: Unsupported[];
    resources?: Resource[];
    footnotes?: Array<{
        id: string;
        blocks: Block[];
    }>;
}
export interface DocsPreviewContext {
    document?: DocsModel;
    name: string;
    /** 主题约束：controlled 时内核拒绝逐块覆盖字体 / 字号 / 行距（编辑器据此在本地同样拒绝）。 */
    constraints?: 'controlled' | 'open';
    palette: Palette;
    fonts: ThemeFonts;
    docs: {
        page: PageProps;
        bodyStyle?: string;
        headingStyles?: string[];
        header?: Block[];
        footer?: Block[];
    };
    styles: Record<string, {
        para: ParaProps;
        run: InlineProps;
    }>;
    characters: Record<string, InlineProps>;
    tables: Record<string, {
        props: Table['props'];
        cell: CellProps;
        headerCell: CellProps;
        run: InlineProps;
        headerRun: InlineProps;
    }>;
}
export interface SlidesModel {
    kind: 'slides';
    schemaVersion: number;
    id: string;
    meta?: Meta;
    theme: ThemeRef;
    size: {
        width: Emu;
        height: Emu;
    };
    slides: Slide[];
    unsupported?: Unsupported[];
    sourceTheme?: SourceTheme;
}
export type Model = DocsModel | SlidesModel;
export type ModelKind = Model['kind'];
export interface ThemeInfo {
    name: string;
    kind: ModelKind;
    displayName?: string;
    description?: string;
}
export interface ExportReport {
    unsupported: Unsupported[];
    bytes: number | null;
    theme: string;
    diagnosticsOnly?: boolean;
}
export interface SlotTextSpec {
    italic?: boolean;
    spaceBefore?: Emu;
    spaceAfter?: Emu;
    size: number;
    minSize?: number;
    align?: Align;
    valign?: VAlign;
    color?: Color;
    bold?: boolean;
    font?: 'body' | 'heading' | 'mono';
    bullet?: boolean;
    lineSpacing?: {
        kind: 'multiple';
        value: number;
    } | {
        kind: 'exact' | 'at_least';
        value: Emu;
    };
    levelIndent?: Emu;
}
export interface PlacedParagraph {
    level: number;
    bullet: boolean;
    align?: Align;
    inlines: Inline[];
    list?: {
        kind: ListKind;
        start?: number;
        checked?: boolean;
    };
    /** 段落显式间距（导入 PPTX）；缺省按槽规格。 */
    spacing?: ParaProps['spacing'];
    /** 段落显式缩进：start = marL，firstLine = indent（悬挂为负）。 */
    indent?: ParaProps['indent'];
}
export interface PlacedText {
    type: 'text';
    paragraphs: PlacedParagraph[];
    size: number;
    spec: SlotTextSpec;
    overflow: boolean;
    body?: TextBody;
}
export type ChartKind = 'bar' | 'column' | 'line' | 'pie' | 'doughnut' | 'area' | 'scatter' | 'combo';
/** IR 图表（office-model `ChartSpec`）；幻灯片槽内容与 Word 行内图表共用。 */
export interface ChartData {
    kind: ChartKind;
    title?: string;
    categories: string[];
    /** `kind`：组合图里本系列的绘制类型；`secondary`：挂右侧次数值轴。 */
    series: Array<{
        name: string;
        values: number[];
        kind?: ChartKind;
        secondary?: boolean;
    }>;
    legend?: boolean;
    dataLabels?: boolean;
    /** 显式配色 RRGGBB：每系列一色，饼 / 环为每扇区一色；缺省用主题强调色。 */
    colors?: string[];
    gridlines?: boolean;
    legendPosition?: 'top' | 'bottom' | 'left' | 'right';
    xTitle?: string;
    yTitle?: string;
    stacked?: boolean;
    /** 数值格式代码（如 `0.00`、`0"%"`、`#,##0`），数据标签按它显示。 */
    numberFormat?: string;
}
export interface ChartSpec extends ChartData {
    type: 'chart';
}
export type PlacedContent = PlacedText | {
    type: 'image';
    resource: string;
    alt?: string;
    fit?: string;
} | ChartSpec | ({
    type: 'table';
} & Table) | {
    type: 'timeline';
    items: Array<{
        date?: string;
        title: string;
        text?: string;
    }>;
};
export interface PlacedShape {
    id?: string;
    kind?: 'text_box' | 'picture' | 'rect' | 'line';
    line?: Color;
    slot: string;
    rect: Rect;
    content: PlacedContent;
    fill?: Color;
    style?: ShapeStyle;
}
export interface PlacedSlide {
    index: number;
    id: string;
    title: string;
    hidden: boolean;
    layout: LayoutKind;
    shapes: PlacedShape[];
    decorations: Array<{
        rect: Rect;
        fill: Color;
    }>;
    background?: Color;
    unsupported: Unsupported[];
}
export interface DeckLayout {
    resources?: Resource[];
    size: {
        width: Emu;
        height: Emu;
    };
    theme: string;
    palette: Palette;
    fonts: ThemeFonts;
    slides: PlacedSlide[];
}
export interface ConvertOptions {
    inputFormat?: 'markdown' | 'slide-plan';
    kind?: ModelKind;
    theme?: string;
}
export interface SourceNumbering {
    numId: string;
    level: number;
    format: string;
    template: string;
    start: number;
    current: number;
}
export interface SourceCaption {
    nodeId: string;
    text: string;
    prefix: string;
    chapter: number;
    sequence: number;
}
export interface SourceListItem {
    nodeId: string;
    itemId: string;
    numbering: SourceNumbering | null;
    items: SourceListItem[];
}
export type SourceEditableBlock = {
    kind: 'heading' | 'title';
    nodeId: string;
} | {
    kind: 'paragraph';
    nodeId: string;
    role: 'body' | 'note' | 'author' | 'recipient' | 'signature' | 'date';
} | {
    kind: 'list';
    nodeId: string;
    groupId: string;
    ordered: boolean;
    items: SourceListItem[];
} | {
    kind: 'table' | 'image';
    nodeId: string;
    caption: SourceCaption | null;
} | {
    kind: 'quote';
    nodeIds: string[];
} | {
    kind: 'pageBreak';
    beforeNodeId: string;
};
export interface SourceEditableBody {
    schema: 'office-editable-body/1';
    blocks: SourceEditableBlock[];
    bookmarks: string[];
}
export interface SourceFrontMatter {
    schema: 'office-front-matter/1';
    body?: SourceEditableBody | null;
    bodyOnly?: boolean;
    sourceSha256: string;
    sourceBytes: number;
    coverSectionId: string;
    tocSectionId: string;
    bodySectionId: string;
    cover: {
        key: 'projectName' | 'docType' | 'partName' | 'bidder' | 'date';
        nodeId: string;
        value: string;
    }[];
    toc: {
        nodeId: string;
        headingId: string;
        level: number;
        label: string;
        title: string;
        cachedPage: number;
    }[];
    fonts: {
        family: string;
        variant: string;
        sha256: string;
        bytes: number;
    }[];
    cachedFieldPaths: string[];
}
export interface SourceExternalRelationship {
    source: string;
    id: string;
    relationshipType: string;
    target: string;
}
export interface ConvertResult {
    docsPreview?: DocsPreviewContext;
    importReport?: {
        sourceFormat: 'docx' | 'pptx';
        frontMatter?: SourceFrontMatter;
        externalRelationships?: SourceExternalRelationship[];
        preserved: string[];
        converted: string[];
        unsupported: Unsupported[];
    };
    /** 仅 import-office：按需读入包 `pkg-import` 的解码后 WASM 字节数（MO-39 ⑨）。 */
    importWasmBytes?: number;
    model: Model;
    /** 引擎原样输出的 Model JSON（导出时原样回传，避免二次序列化差异）。 */
    modelJson: string;
    /** model_to_markdown 投影。 */
    markdown: string;
    /** Slides 才有。 */
    layout?: DeckLayout;
    pagination?: Array<{
        sourceSlide: string;
        outputSlide: string;
        part: number;
        total: number;
        repeatedSlots: string[];
    }>;
    /** Docs → docx 报告；Slides → pptx 报告。 */
    report: {
        format: 'docx' | 'pptx';
        data: ExportReport;
    };
    /** 前端层的回退提示（例如 frontmatter 主题与类别不符时改用默认主题）。 */
    warnings: string[];
    engineMs: number;
}
export interface InitResult {
    version: string;
    wasmBytes: number;
    themes: ThemeInfo[];
    engineMs: number;
}
export interface ExportResult {
    bytes: ArrayBuffer;
    format: 'docx' | 'pptx';
    engineMs: number;
}
export interface Transaction {
    txn: Array<Record<string, unknown>>;
    mode: 'preview' | 'apply';
    actor: string;
    track?: boolean;
    reason?: string;
}
export interface TransactionResult {
    document: ConvertResult;
    transaction: {
        diff: Array<{
            id: string;
            kind: string;
            summary: string;
            before?: unknown;
            after?: unknown;
        }>;
        new_ids?: string[];
    };
}
/** office-layout（MO-42 L0）：一段的一行。坐标单位 pt，相对段落可用区左边；字符下标为段落文字（不含编号标签）的 Unicode 标量下标。 */
export interface LayoutSegment {
    start: number;
    end: number;
    x: number;
    width: number;
    face: string;
    size: number;
    label?: boolean;
    tab?: boolean;
    gaps?: number;
}
export interface LayoutLine {
    start: number;
    end: number;
    x: number;
    width: number;
    height: number;
    baseline: number;
    extra?: number;
    text?: string;
    label?: string;
    segments: LayoutSegment[];
}
export interface ParagraphLayout {
    id: string;
    area: 'body' | 'cell' | 'header' | 'footer';
    width: number;
    spaceBefore: number;
    spaceAfter: number;
    height: number;
    lines: LayoutLine[];
    missingFaces?: string[];
}
export interface DocLayout {
    paragraphs: ParagraphLayout[];
    gridBaseSize?: number;
    missingFaces?: string[];
}
export interface LayoutOptions {
    /** 缺省制表位（pt），缺省 21。 */
    defaultTab?: number;
    /** 字符网格基准字号（pt）；缺省由引擎推断。 */
    gridBaseSize?: number;
    kerning?: boolean;
    withText?: boolean;
}
export interface LayoutResult {
    layout: DocLayout;
    /** 按需排版包 `pkg-layout` 的解码后 WASM 字节数（MO-42 ④）。 */
    layoutWasmBytes: number;
    /** 本次新加载的度量表字节数与 face。 */
    metricsBytes: number;
    metricsLoaded: string[];
    engineMs: number;
}
export type WorkerRequest = {
    id: number;
    op: 'init';
} | {
    id: number;
    op: 'layout-docs';
    modelJson: string;
    opts?: LayoutOptions;
} | {
    id: number;
    op: 'open-model';
    modelJson: string;
} | {
    id: number;
    op: 'import-office';
    bytes: ArrayBuffer;
    format: 'docx' | 'pptx';
    strict: boolean;
} | {
    id: number;
    op: 'convert';
    md: string;
    opts: ConvertOptions;
} | {
    id: number;
    op: 'transact';
    modelJson: string;
    transaction: Transaction;
} | {
    id: number;
    op: 'export';
    modelJson: string;
    format: 'docx' | 'pptx';
    theme?: string;
};
/** Worker 进度：按需模块（与排版度量表）已下载就绪、开始计算。计算超时从这里起算。 */
export type WorkerProgress = {
    id: number;
    stage: 'compute';
};
export type WorkerResponse = {
    id: number;
    ok: true;
    op: 'init';
    data: InitResult;
} | {
    id: number;
    ok: true;
    op: 'layout-docs';
    data: LayoutResult;
} | {
    id: number;
    ok: true;
    op: 'open-model';
    data: ConvertResult;
} | {
    id: number;
    ok: true;
    op: 'import-office';
    data: ConvertResult;
} | {
    id: number;
    ok: true;
    op: 'convert';
    data: ConvertResult;
} | {
    id: number;
    ok: true;
    op: 'transact';
    data: TransactionResult;
} | {
    id: number;
    ok: true;
    op: 'export';
    data: ExportResult;
} | {
    id: number;
    ok: false;
    error: string;
};
