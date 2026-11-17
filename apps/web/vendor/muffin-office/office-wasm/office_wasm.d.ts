/* tslint:disable */
/* eslint-disable */

/**
 * 内置主题：`[{name, kind, displayName, description}]`。
 */
export function builtin_themes(): string;

export function docs_preview_context(theme_name: string): string;

/**
 * 引擎版本（`CARGO_PKG_VERSION`）。
 */
export function engine_version(): string;

/**
 * Slides Model → 每页几何：`{"size","theme","palette","fonts","slides":[...]}`（EMU）。
 */
export function layout_deck(model_json: string, theme_name?: string | null): string;

/**
 * Markdown → Model JSON。`opts_json`：`{"id_seed"?,"now_ms"?,"theme"?,"kind"?: "docs"|"slides"}`，可为 `"{}"`。
 */
export function md_to_model(md: string, opts_json: string): string;

/**
 * Docs Model → DOCX 字节。`theme_name` 为空用模型里的主题。
 */
export function model_to_docx(model_json: string, theme_name?: string | null): Uint8Array;

/**
 * 同 [`model_to_docx`]，返回 `{"unsupported":[...],"bytes":n,"theme":name}`。
 */
export function model_to_docx_report(model_json: string, theme_name?: string | null): string;

/**
 * Model JSON → Markdown 投影。
 */
export function model_to_markdown(model_json: string): string;

/**
 * Slides Model → PPTX 字节。`theme_name` 为空用模型里的主题。
 */
export function model_to_pptx(model_json: string, theme_name?: string | null): Uint8Array;

/**
 * Validate export content without calculating a ZIP byte count; bytes is null.
 */
export function model_to_pptx_diagnostics(model_json: string, theme_name?: string | null): string;

/**
 * 同 [`model_to_pptx`]，返回 `{"unsupported":[...],"bytes":n,"theme":name}`。
 */
export function model_to_pptx_report(model_json: string, theme_name?: string | null): string;

/**
 * Explicit pagination → {model, pages, sourceSlides}; input model is unchanged.
 */
export function paginate_model(model_json: string, options_json: string): string;

/**
 * Slide Plan JSON → { model, warnings }. No network or file access.
 */
export function plan_to_model(source: string, opts_json: string): string;

/**
 * 执行事务：`{"model": Model, "result": TxnResult}`。
 */
export function txn(model_json: string, txn_json: string): string;

export function validate_project_model(model_json: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly builtin_themes: (a: number) => void;
    readonly docs_preview_context: (a: number, b: number, c: number) => void;
    readonly engine_version: (a: number) => void;
    readonly layout_deck: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly md_to_model: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly model_to_docx: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly model_to_docx_report: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly model_to_markdown: (a: number, b: number, c: number) => void;
    readonly model_to_pptx: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly model_to_pptx_diagnostics: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly model_to_pptx_report: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly paginate_model: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly plan_to_model: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly txn: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly validate_project_model: (a: number, b: number, c: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export4: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
