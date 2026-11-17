/**
 * 预览字体解析（MO-41）：Office 源文件里的字体名 → 自托管 OFL 替身的规范族名。
 *
 * 规范族名的 @font-face 由 `scripts/gen_web_fonts.py --write` 生成在 `frontend/public/fonts/fonts.css`
 * （宿主页面需加载该 CSS；没加载时这些族名不存在，浏览器按栈里后面的名字回退）。
 * 原名排在替身前面（2026-11-06 沐风拍板，改 MO-41 ③）：本机装了真字体（仿宋_GB2312、方正小标宋简体…）
 * 就用真字体，与同机 Word 一致；没装才落到替身。代价是装没装字体的机器看到的不同，排版引擎度量仍按替身。
 */
export declare const FONT_FAMILIES: {
    readonly fangsong: "MO Fangsong";
    readonly kaiti: "MO Kaiti";
    readonly heiti: "MO Heiti";
    readonly songti: "MO Songti";
    readonly title: "MO Title";
    readonly serif: "MO Serif";
    readonly sans: "MO Sans";
    readonly calibri: "MO Calibri";
    readonly inter: "MO Inter";
};
export type FontSlot = keyof typeof FONT_FAMILIES;
/** 半角西文替身族名的后缀（`MO Songti` → `MO Songti HW`）。 */
export declare const HALF_WIDTH_SUFFIX = " HW";
/** 该字体的 ASCII 是否按 0.5em 半角排；是则返回半角替身族名。 */
export declare function halfWidthFamily(name: string | undefined | null): string | undefined;
/** 字体名归一键（大小写、空白、下划线 / 横线差异不计）；内嵌字体表按它查。 */
export declare function fontKey(name: string): string;
/** Office 字体名 → 规范族名；未知返回 undefined。 */
export declare function webFontFamily(name: string | undefined | null): string | undefined;
/**
 * 一段文字的 CSS font-family：西文名、东亚名依次展开为"内嵌字体 → 本机原名 → 半角替身 → 槽替身"，
 * 最后以汉字槽兜缺字、再落通用族。
 * `embedded`：当前文档内嵌字体（归一名 → 已注册族名），见 embedded-fonts.ts。
 * `generic` 缺省 serif（Word 正文多为衬线，兜底宋体槽）；演示传 sans-serif（兜底黑体槽）；monospace 不加汉字兜底以免西文落到宋体。
 */
export declare function cssFontStack(names: Array<string | undefined | null>, generic?: 'serif' | 'sans-serif' | 'monospace', embedded?: ReadonlyMap<string, string>, embeddedLatinFamilies?: ReadonlyMap<string, string>): string;
