<script setup lang="ts">
import {
  PhArrowUUpLeft,
  PhArrowUUpRight,
  PhArrowsOutLineHorizontal,
  PhEraser,
  PhEye,
  PhListMagnifyingGlass,
  PhLockKey,
  PhLockKeyOpen,
  PhMagnifyingGlassMinus,
  PhMagnifyingGlassPlus,
  PhRowsPlusBottom,
  PhRowsPlusTop,
  PhShieldCheck,
  PhSidebar,
  PhSplitVertical,
  PhStackMinus,
  PhTable,
  PhTextAlignCenter,
  PhTextAlignJustify,
  PhTextAlignLeft,
  PhTextAlignRight,
  PhTextB,
  PhTextIndent,
  PhTextItalic,
  PhTextOutdent,
  PhTextStrikethrough,
  PhTextSubscript,
  PhTextSuperscript,
  PhTextUnderline,
} from "@phosphor-icons/vue";
import type { FormatState } from "@muffin-office/vue/docs-editor";
import type { Component } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpTabs from "@/components/ui/TpTabs.vue";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { StyleOption, StyleValue } from "./structure.ts";

/**
 * 功能区：开始 / 插入 / 审阅 / 视图。按钮状态来自编辑器的格式状态与 can()，内核没有的命令不显示。
 * 本组件只发出意图，命令由写作页交给 DocsEditor 执行。
 */
export type RibbonTab = "home" | "insert" | "review" | "view";
export type RibbonMark = "bold" | "italic" | "underline" | "strike" | "superscript" | "subscript";
export type RibbonAlign = "start" | "center" | "end" | "justify";
export type RibbonAction =
  | { type: "undo" }
  | { type: "redo" }
  | { type: "mark"; mark: RibbonMark }
  | { type: "align"; align: RibbonAlign }
  | { type: "indent" }
  | { type: "outdent" }
  | { type: "clear" }
  | { type: "style"; value: StyleValue }
  | { type: "table" }
  | { type: "page-break" }
  | { type: "row-above" }
  | { type: "row-below" }
  | { type: "row-delete" }
  | { type: "lock" }
  | { type: "unlock" }
  | { type: "inspect" }
  | { type: "outline" }
  | { type: "protections" }
  | { type: "zoom"; zoom: number | "fit-width" };

const props = defineProps<{
  format: FormatState | null;
  canUndo: boolean;
  canRedo: boolean;
  /** 正文可编辑（非只读、已载入、无阻断）。 */
  editable: boolean;
  /** 原件导入的正文只允许改映射文字：格式与结构命令不可用。 */
  textOnly: boolean;
  hasSelection: boolean;
  styleOptions: StyleOption[];
  styleValue?: StyleValue;
  table: { insertRow: boolean; deleteRow: boolean };
  lock: { available: boolean; locked: boolean; reason: string };
  inspection: { busy: boolean; disabled: boolean; link?: { to: RouteLocationRaw; label: string }; error?: string };
  view: { outline: boolean; outlineToggle: boolean; protections: boolean; zoom: number | "fit-width" };
}>();
const tab = defineModel<RibbonTab>("tab", { required: true });
const emit = defineEmits<{ action: [action: RibbonAction] }>();

const tabs: { value: RibbonTab; label: string }[] = [
  { value: "home", label: "开始" },
  { value: "insert", label: "插入" },
  { value: "review", label: "审阅" },
  { value: "view", label: "视图" },
];
const marks: { mark: RibbonMark; label: string; icon: Component; key?: string }[] = [
  { mark: "bold", label: "加粗", icon: PhTextB, key: "B" },
  { mark: "italic", label: "斜体", icon: PhTextItalic, key: "I" },
  { mark: "underline", label: "下划线", icon: PhTextUnderline, key: "U" },
  { mark: "strike", label: "删除线", icon: PhTextStrikethrough },
  { mark: "superscript", label: "上标", icon: PhTextSuperscript },
  { mark: "subscript", label: "下标", icon: PhTextSubscript },
];
const aligns: { align: RibbonAlign; label: string; icon: Component }[] = [
  { align: "start", label: "左对齐", icon: PhTextAlignLeft },
  { align: "center", label: "居中", icon: PhTextAlignCenter },
  { align: "end", label: "右对齐", icon: PhTextAlignRight },
  { align: "justify", label: "两端对齐", icon: PhTextAlignJustify },
];
const ZOOMS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2];
const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
const formatting = () => props.editable && !props.textOnly && props.hasSelection;
const pressed = (value: boolean | "mixed" | undefined) => (value === "mixed" ? "mixed" : value === true);
function zoomStep(direction: 1 | -1) {
  const current = props.view.zoom === "fit-width" ? 1 : props.view.zoom;
  const next = direction > 0 ? ZOOMS.find((value) => value > current + 0.001) : [...ZOOMS].reverse().find((value) => value < current - 0.001);
  if (next) emit("action", { type: "zoom", zoom: next });
}
const zoomLabel = (zoom: number | "fit-width") => (zoom === "fit-width" ? "适应页宽" : `${Math.round(zoom * 100)}%`);
defineExpose({ zoomLabel });
</script>

<template>
  <div class="writing-ribbon">
    <TpTabs v-model="tab" :tabs="tabs" label="功能区" class="writing-ribbon__tabs" />
    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <div :key="tab" class="writing-ribbon__tools" role="toolbar" :aria-label="tabs.find((item) => item.value === tab)?.label + '工具'">
        <template v-if="tab === 'home'">
          <button
            class="tp-tool"
            type="button"
            aria-label="撤销"
            :title="`撤销（${mod}Z）`"
            :disabled="!editable || !canUndo"
            @click="emit('action', { type: 'undo' })"
          >
            <TpIcon :icon="PhArrowUUpLeft" />
          </button>
          <button
            class="tp-tool"
            type="button"
            aria-label="重做"
            :title="`重做（${mod}Shift+Z）`"
            :disabled="!editable || !canRedo"
            @click="emit('action', { type: 'redo' })"
          >
            <TpIcon :icon="PhArrowUUpRight" />
          </button>
          <span class="tp-tool-sep" />
          <TpSelect
            class="writing-ribbon__style"
            aria-label="段落样式"
            :model-value="styleValue"
            :options="styleOptions"
            :placeholder="format ? '多种样式' : '段落样式'"
            :disabled="!formatting()"
            @change="emit('action', { type: 'style', value: $event as StyleValue })"
          />
          <span class="tp-tool-sep" />
          <button
            v-for="item in marks"
            :key="item.mark"
            class="tp-tool"
            type="button"
            :aria-label="item.label"
            :title="item.key ? `${item.label}（${mod}${item.key}）` : item.label"
            :aria-pressed="pressed(format?.[item.mark])"
            :disabled="!formatting()"
            @click="emit('action', { type: 'mark', mark: item.mark })"
          >
            <TpIcon :icon="item.icon" />
          </button>
          <span class="tp-tool-sep" />
          <button
            v-for="item in aligns"
            :key="item.align"
            class="tp-tool"
            type="button"
            :aria-label="item.label"
            :title="item.label"
            :aria-pressed="format?.align === item.align"
            :disabled="!formatting()"
            @click="emit('action', { type: 'align', align: item.align })"
          >
            <TpIcon :icon="item.icon" />
          </button>
          <span class="tp-tool-sep" />
          <button class="tp-tool" type="button" aria-label="减少缩进" title="减少缩进" :disabled="!formatting()" @click="emit('action', { type: 'outdent' })">
            <TpIcon :icon="PhTextOutdent" />
          </button>
          <button class="tp-tool" type="button" aria-label="增加缩进" title="增加缩进" :disabled="!formatting()" @click="emit('action', { type: 'indent' })">
            <TpIcon :icon="PhTextIndent" />
          </button>
          <button class="tp-tool" type="button" aria-label="清除格式" title="清除格式" :disabled="!formatting()" @click="emit('action', { type: 'clear' })">
            <TpIcon :icon="PhEraser" />
          </button>
        </template>

        <template v-else-if="tab === 'insert'">
          <button class="tp-tool tp-tool--text" type="button" :disabled="!formatting()" @click="emit('action', { type: 'table' })">
            <TpIcon :icon="PhTable" /><span>表格</span>
          </button>
          <button class="tp-tool tp-tool--text" type="button" :disabled="!formatting()" @click="emit('action', { type: 'page-break' })">
            <TpIcon :icon="PhSplitVertical" /><span>分页符</span>
          </button>
          <template v-if="format?.inTable">
            <span class="tp-tool-sep" />
            <button
              class="tp-tool tp-tool--text"
              type="button"
              :disabled="!editable || textOnly || !table.insertRow"
              @click="emit('action', { type: 'row-above' })"
            >
              <TpIcon :icon="PhRowsPlusTop" /><span>上方插入行</span>
            </button>
            <button
              class="tp-tool tp-tool--text"
              type="button"
              :disabled="!editable || textOnly || !table.insertRow"
              @click="emit('action', { type: 'row-below' })"
            >
              <TpIcon :icon="PhRowsPlusBottom" /><span>下方插入行</span>
            </button>
            <button
              class="tp-tool tp-tool--text"
              type="button"
              :disabled="!editable || textOnly || !table.deleteRow"
              @click="emit('action', { type: 'row-delete' })"
            >
              <TpIcon :icon="PhStackMinus" /><span>删除行</span>
            </button>
          </template>
        </template>

        <template v-else-if="tab === 'review'">
          <button
            v-if="!lock.locked"
            class="tp-tool tp-tool--text"
            type="button"
            :disabled="!editable || !lock.available"
            :title="lock.reason || '锁定后 AI 候选不能改动这段文字，保存后生效'"
            @click="emit('action', { type: 'lock' })"
          >
            <TpIcon :icon="PhLockKey" /><span>锁定选区</span>
          </button>
          <button v-else class="tp-tool tp-tool--text" type="button" :disabled="!editable" @click="emit('action', { type: 'unlock' })">
            <TpIcon :icon="PhLockKeyOpen" /><span>解除锁定</span>
          </button>
          <span class="tp-tool-sep" />
          <button
            class="tp-tool tp-tool--text"
            type="button"
            :disabled="inspection.disabled || inspection.busy"
            :aria-busy="inspection.busy || undefined"
            @click="emit('action', { type: 'inspect' })"
          >
            <TpIcon :icon="PhShieldCheck" /><span>检查正文结构</span>
          </button>
          <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
            <span v-if="inspection.error" :key="inspection.error" class="writing-ribbon__note is-danger" role="alert">{{ inspection.error }}</span>
            <RouterLink v-else-if="inspection.link" :key="inspection.link.label" :to="inspection.link.to" class="writing-ribbon__note studio-link">{{
              inspection.link.label
            }}</RouterLink>
          </Transition>
        </template>

        <template v-else>
          <button
            v-if="view.outlineToggle"
            class="tp-tool tp-tool--text"
            type="button"
            :aria-pressed="view.outline"
            @click="emit('action', { type: 'outline' })"
          >
            <TpIcon :icon="PhSidebar" /><span>导航窗格</span>
          </button>
          <button class="tp-tool tp-tool--text" type="button" :aria-pressed="view.protections" @click="emit('action', { type: 'protections' })">
            <TpIcon :icon="PhEye" /><span>显示保护标记</span>
          </button>
          <span class="tp-tool-sep" />
          <button
            class="tp-tool tp-tool--text"
            type="button"
            :aria-pressed="view.zoom === 'fit-width'"
            @click="emit('action', { type: 'zoom', zoom: 'fit-width' })"
          >
            <TpIcon :icon="PhArrowsOutLineHorizontal" /><span>适应页宽</span>
          </button>
          <button class="tp-tool tp-tool--text" type="button" :aria-pressed="view.zoom === 1" @click="emit('action', { type: 'zoom', zoom: 1 })">
            <TpIcon :icon="PhListMagnifyingGlass" /><span>100%</span>
          </button>
          <button class="tp-tool" type="button" aria-label="缩小" title="缩小" @click="zoomStep(-1)"><TpIcon :icon="PhMagnifyingGlassMinus" /></button>
          <span class="writing-ribbon__zoom" aria-live="polite">{{ zoomLabel(view.zoom) }}</span>
          <button class="tp-tool" type="button" aria-label="放大" title="放大" @click="zoomStep(1)"><TpIcon :icon="PhMagnifyingGlassPlus" /></button>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.writing-ribbon {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-bottom: 1px solid var(--tp-line);
  background: var(--tp-surface);
}
.writing-ribbon__tabs {
  padding: 0 12px;
  border-bottom: 1px solid var(--tp-line);
}
.writing-ribbon__tabs :deep(.tp-tabs__tab) {
  padding: 8px 10px;
  font-size: 12.5px;
}
.writing-ribbon__tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  min-width: 0;
  min-height: 44px;
  padding: 6px 10px;
}
.writing-ribbon__tools > * {
  flex: none;
}
.writing-ribbon .tp-tool {
  min-width: 32px;
  height: 32px;
}
.tp-tool--text {
  display: inline-flex;
  gap: 6px;
  padding: 0 10px;
  font-weight: 500;
  white-space: nowrap;
}
.writing-ribbon__style {
  width: 120px;
}
.writing-ribbon__style :deep(.tp-select__trigger),
.writing-ribbon__style :deep(button) {
  min-height: 32px;
}
.writing-ribbon__note {
  margin-left: 8px;
  font-size: 12px;
  white-space: nowrap;
}
.writing-ribbon__note.is-danger {
  color: var(--tp-danger);
}
.writing-ribbon__zoom {
  min-width: 64px;
  text-align: center;
  font-family: var(--tp-font-mono);
  font-size: 12px;
  color: var(--tp-text-muted);
  font-variant-numeric: tabular-nums;
}
@media (max-width: 599px) {
  .writing-ribbon__tabs {
    padding: 0 6px;
  }
  /* 窄屏不换行：工具条横向滚动，纸面高度保持稳定。 */
  .writing-ribbon__tools {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 6px;
  }
}
</style>
