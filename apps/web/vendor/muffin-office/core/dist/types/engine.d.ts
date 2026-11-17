export * from './document-selection';
import type { ConvertOptions, ConvertResult, ExportResult, InitResult, LayoutOptions, LayoutResult, Transaction, TransactionResult } from './types';
export interface EngineClientOptions {
    /** WASM 静态资源基址（其下为 pkg/、pkg-import/、pkg-layout/）；缺省为页面同源根目录。 */
    assetBase?: string | URL;
}
export declare class EngineClient {
    private onFatal;
    private options;
    private worker;
    private seq;
    private pending;
    constructor(onFatal: (message: string) => void, options?: EngineClientOptions);
    private ensure;
    /** 终止 Worker 并拒绝全部挂起请求；下次调用会新建 Worker。 */
    private fail;
    private timeout;
    private call;
    init(): Promise<InitResult>;
    openModel(modelJson: string): Promise<ConvertResult>;
    importOffice(bytes: ArrayBuffer, format: 'docx' | 'pptx', strict?: boolean): Promise<ConvertResult>;
    /** Word 规则段落排版（MO-42 L0）：返回各段断行；不分页、不替换预览渲染（L1）。 */
    layoutDocs(modelJson: string, opts?: LayoutOptions): Promise<LayoutResult>;
    convert(md: string, opts: ConvertOptions): Promise<ConvertResult>;
    transact(modelJson: string, transaction: Transaction): Promise<TransactionResult>;
    exportFile(modelJson: string, format: 'docx' | 'pptx', theme?: string): Promise<ExportResult>;
    dispose(): void;
}
