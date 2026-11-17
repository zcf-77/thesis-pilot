import { inject, provide, type InjectionKey, type Ref } from "vue";
import type { PreviewHighlight } from "@muffin-office/vue/docs-anchors";
import type { DocsModel } from "@muffin-office/core/types";
import type { WritingAnchor, WritingPanelDocument, WritingSelection } from "./panels.ts";

/**
 * 写作上下文：面板内部的深层组件可注入使用，与面板 props/emits 等价。
 * 写入一律经服务端命令完成；写作页在 reload() 后重载正文并清空撤销栈。
 */
export interface WritingContext {
  document: Readonly<Ref<WritingPanelDocument | null>>;
  selection: Readonly<Ref<WritingSelection | null>>;
  eligible: Readonly<Ref<boolean>>;
  /** 滚动到锚点并闪烁；返回是否找到。 */
  focus(anchor: WritingAnchor): Promise<boolean>;
  /** 按组替换纸面叠加层；空数组清除该组。 */
  setOverlays(group: string, highlights: readonly PreviewHighlight[]): void;
  clearOverlays(group?: string): void;
  /** 服务端已生成新版本时调用：重新读取正式稿。 */
  reload(): Promise<void>;
  /** 打开副驾中的某个面板。 */
  openPanel(id: string): void;
  /** 编辑器当前模型（含未保存的编辑），只读。 */
  model(): DocsModel | null;
}

const key: InjectionKey<WritingContext> = Symbol("writing-context");

export function provideWritingContext(context: WritingContext) {
  provide(key, context);
}

export function useWritingContext(): WritingContext | undefined {
  return inject(key, undefined);
}
