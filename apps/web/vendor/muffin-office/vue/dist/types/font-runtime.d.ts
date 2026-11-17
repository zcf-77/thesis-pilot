/** Only successfully loaded, original faces enter this map; OFL substitutions never do. */
export type RegisteredFontSource = 'uploaded' | 'local' | 'server';
export interface OriginalFontEntry {
    id: string;
    source: RegisteredFontSource;
    family: string;
    cssFamily: string;
    cssLatinFamily?: string;
    aliases: readonly string[];
}
export declare const originalFontKey: (name: string) => string;
export declare function rememberOriginalFont(entry: OriginalFontEntry): void;
export declare function forgetOriginalFont(id: string): void;
export declare function originalFont(name: string): OriginalFontEntry | undefined;
