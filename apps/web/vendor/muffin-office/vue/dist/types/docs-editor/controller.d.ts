import type { DocsModel, InlineProps } from '../types';
import type { PreviewAnchor } from '../docs-anchors.ts';
import type { DocOp } from './ops.ts';
import type { DocPoint, MapStep } from './mapping.ts';
import { Transform } from './commands.ts';
import type { CommandContext, DocSelection, FormatState, MarkName, SliceBlock } from './commands.ts';
export type TransactionSource = 'input' | 'composition' | 'command' | 'paste' | 'cut' | 'drop' | 'undo' | 'redo' | 'api';
/** 与内核事务同形：原样交给 `EngineClient.transact` 即可。 */
export interface KernelTransaction {
    txn: DocOp[];
    mode: 'apply';
    actor: string;
    reason?: string;
    track?: boolean;
}
export interface TransactionMeta {
    source: TransactionSource;
    /** 命令名，如 insertText / splitBlock / bold。 */
    intent: string;
    /** 会话内递增序号。 */
    seq: number;
    /** 位置映射步骤：宿主用 mapAnchor 让自己的锚点跟随这次编辑。 */
    steps: MapStep[];
    /** 逆操作（撤销这次事务）。 */
    inverse: DocOp[];
    selectionBefore: DocSelection | null;
    selectionAfter: DocSelection | null;
    /** 事务前后的模型（结构共享）；宿主可直接采用 `docAfter`，不必等内核往返。 */
    docBefore: DocsModel;
    docAfter: DocsModel;
}
export type ProtectedKind = 'number' | 'citation' | 'formula' | 'lock' | 'opaque' | (string & {});
export interface ProtectedRange {
    id: string;
    /** 带偏移 = 段内文字区间；只给节点 = 整块（表格、图片、公式块等）。 */
    anchor: PreviewAnchor;
    kind: ProtectedKind;
}
export interface BlockedEvent {
    /** 被撞到的受保护区间；宿主否决、只读、内核约束拒绝时为空串。 */
    rangeId: string;
    kind: ProtectedKind | 'host' | 'readonly' | 'constraint';
    source: TransactionSource;
    intent: string;
    message?: string;
}
export interface ControllerOptions {
    doc: DocsModel;
    /** 事务署名，缺省 `user:local`；宿主应注入真实身份。 */
    actor?: string;
    constraints?: 'controlled';
    newId?: () => string;
    readOnly?: boolean;
    /** 受保护区间内是否连格式也不许改（缺省 true）。 */
    protectFormatting?: boolean;
    historyLimit?: number;
    now?: () => number;
    /** 同步否决：返回 false 则事务不落地。用于宿主自己的版本 / 保护校验。 */
    beforeTransaction?: (transaction: KernelTransaction, meta: TransactionMeta) => boolean | void;
    onTransaction?: (transaction: KernelTransaction, meta: TransactionMeta) => void;
    onBlocked?: (event: BlockedEvent) => void;
    /** 文档、选区、待用格式或撤销栈有变化。 */
    onState?: () => void;
}
export interface RunInfo {
    source: TransactionSource;
    intent: string;
    /** 相同键、光标连续、间隔短的事务并成一步撤销。 */
    coalesce?: string;
}
/** 26 位 ULID 字面（与内核 NodeId 同形）：48 位毫秒时间戳 + 80 位随机。 */
export declare function createId(now?: number): string;
export type CommandName = MarkName | 'runProps' | 'align' | 'indent' | 'outdent' | 'lineSpacing' | 'paraProps' | 'heading' | 'style' | 'clearFormatting' | 'insertText' | 'insertParagraph' | 'insertLineBreak' | 'insertTab' | 'deleteBackward' | 'deleteForward' | 'table.insertRowAbove' | 'table.insertRowBelow' | 'table.deleteRow' | 'table.nextCell' | 'table.prevCell' | 'table.insertColumn' | 'table.deleteColumn' | 'table.mergeCells' | 'table.splitCell' | 'list.toggle' | 'undo' | 'redo';
export declare class DocsEditorController {
    doc: DocsModel;
    selection: DocSelection | null;
    marks: InlineProps | null;
    readOnly: boolean;
    private options;
    private protectedRanges;
    private undoStack;
    private redoStack;
    /** 保存点对应的撤销栈深度；-1 表示保存点已不可达。 */
    private savedDepth;
    private seq;
    constructor(options: ControllerOptions);
    /** 运行期调整署名、主题约束等（属性随宿主变化时用）。 */
    configure(options: Partial<Pick<ControllerOptions, 'actor' | 'constraints' | 'protectFormatting'>>): void;
    private context;
    /** 换入外部模型（重新加载、宿主采纳了候选等）。撤销栈缺省清空：旧的逆操作对新模型不再成立。 */
    setDoc(doc: DocsModel, keep?: {
        history?: boolean;
    }): void;
    private clampSelection;
    /** 视图同步来的选区。位置变了就丢弃待用格式。 */
    setSelection(selection: DocSelection | null): void;
    setProtectedRanges(ranges: readonly ProtectedRange[]): void;
    /** 受保护区间的当前位置（已随本地编辑移动）。 */
    get protected(): readonly ProtectedRange[];
    get state(): FormatState | null;
    get canUndo(): boolean;
    get canRedo(): boolean;
    get dirty(): boolean;
    markSaved(): void;
    clearHistory(): void;
    /** 事务是否改动了受保护内容：按内容比对（文字、行内对象，可选连格式），与用哪种操作无关。 */
    private violation;
    private mapProtected;
    private blocked;
    /**
     * 执行一个命令。返回 true 表示状态有变化（落了事务，或只移动了选区 / 待用格式）。
     * 撞到受保护区间、被宿主否决、被主题约束拒绝时发 blocked 并返回 false，状态不变。
     */
    run(make: (ctx: CommandContext) => Transform | null, info: RunInfo): boolean;
    private clampTo;
    private mapped;
    private commit;
    private pushHistory;
    private travel;
    undo(): boolean;
    redo(): boolean;
    insertText(text: string, source?: TransactionSource): boolean;
    /** 把模型区间换成文字：输入法合成结束、拼写替换。一次事务，不与前后输入合并。 */
    replaceRange(a: DocPoint, b: DocPoint, text: string, source?: TransactionSource): boolean;
    deleteRange(a: DocPoint, b: DocPoint, source?: TransactionSource, intent?: string): boolean;
    deleteBackward(unit?: 'char' | 'word'): boolean;
    deleteForward(unit?: 'char' | 'word'): boolean;
    splitBlock(): boolean;
    /** 当前选区内容（复制 / 剪切）。 */
    slice(): SliceBlock[];
    paste(slice: readonly SliceBlock[], source?: TransactionSource): boolean;
    cut(): boolean;
    selectAll(): boolean;
    private command;
    exec(name: CommandName, args?: unknown): boolean;
    /** 工具栏的可用状态。内核没有对应操作的命令（列操作、合并单元格、列表）恒为 false。 */
    can(name: CommandName): boolean;
}
