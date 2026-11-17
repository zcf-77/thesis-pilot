export interface EmbeddedFonts {
    /** 归一后的 Office 字体名 → 本次注册的 CSS 族名。 */
    families: ReadonlyMap<string, string>;
    /** Same original faces restricted to ASCII, for mixed Latin/East Asian font slots. */
    latinFamilies?: ReadonlyMap<string, string>;
    /** 跳过的字体及原因（受限授权、解码失败等），供报告。 */
    skipped: string[];
    /** 已加入 document.fonts 的字体；换文档时交给 releaseEmbeddedFonts 卸掉。 */
    faces: readonly FontFace[];
}
/**
 * 读 DOCX 字节里的内嵌字体并注册；没有内嵌字体时返回 undefined。族名每次加载唯一，
 * 不影响正在显示的文档；调用方在新文档生效（或导入失败）时负责 release 旧的（或这份）。
 */
export declare function loadDocxEmbeddedFonts(bytes: ArrayBuffer): Promise<EmbeddedFonts | undefined>;
/** 从 document.fonts 卸掉一份文档注册的内嵌字体。 */
export declare function releaseEmbeddedFonts(fonts: EmbeddedFonts | undefined): void;
/**
 * ECMA-376 Part 1 §17.8.1 字体混淆：fontKey 是 GUID，去掉括号与横线后按 16 字节倒序作密钥，
 * 与字体文件前 32 字节逐字节异或。
 */
export declare function deobfuscate(data: Uint8Array, fontKeyGuid: string): Uint8Array | undefined;
/** OS/2 fsType 低 4 位为 2（Restricted License embedding）时不得使用。 */
export declare function restrictedLicense(font: Uint8Array): boolean;
