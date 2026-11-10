<script setup lang="ts">
import {
  PhArrowUUpLeft,
  PhArrowUUpRight,
  PhColumnsPlusRight,
  PhListBullets,
  PhListNumbers,
  PhRowsPlusBottom,
  PhTable,
  PhTextB,
  PhTextItalic,
} from "@phosphor-icons/vue";
import { TableKit } from "@tiptap/extension-table";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, Extension, useEditor } from "@tiptap/vue-3";
import { computed, ref } from "vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSaveIndicator from "@/components/ui/TpSaveIndicator.vue";
import TpVersion from "@/components/ui/TpVersion.vue";

/**
 * 编辑器样张：真实的 Tiptap 3.33.1（StarterKit + TableKit），用于确认稿纸排版、工具栏与保护对象的视觉。
 * 设计阶段边界：
 *   - 数字 / 引用的“保护下划线”是装饰层（Decoration）的视觉示意，按正则识别；
 *     真正的保护校验属于全量实现中的编辑器适配层与修订服务。
 *   - 没有保存、版本与候选应用逻辑；状态栏的版本号为样例值。
 */
const protectKey = new PluginKey("tp-protect-preview");
const ProtectPreview = Extension.create({
  name: "tpProtectPreview",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: protectKey,
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            const pattern = /(\[\d+(?:[,，-]\d+)*\])|(\d+(?:\.\d+)?%)/g;
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              for (const match of node.text.matchAll(pattern)) {
                const from = pos + (match.index ?? 0);
                decorations.push(Decoration.inline(from, from + match[0].length, { class: "tp-protect", "data-kind": match[1] ? "citation" : "number" }));
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

const dirty = ref(false);
const selection = ref({ empty: true, chars: 0 });

const editor = useEditor({
  extensions: [StarterKit, TableKit.configure({ table: { resizable: false } }), ProtectPreview],
  editorProps: { attributes: { class: "tp-prose", "aria-label": "论文正文编辑区（样张）", spellcheck: "false" } },
  content: `
    <h2>3.2 协同过滤召回</h2>
    <p>本文采用基于物品的协同过滤算法完成候选商品的召回。对任意两件商品，先统计共同交互的用户数量，再按用户活跃度做惩罚，得到商品之间的相似度[5]。</p>
    <p>实验表明，该方法在自建数据集上的召回率达到 71.4%，较基线方法有明显提升[7]。但对于缺少交互记录的新上架商品，该方法难以给出有效召回，即冷启动问题。</p>
    <h3>3.2.1 相似度计算的三个步骤</h3>
    <ol><li><p>构建“用户—商品”交互矩阵；</p></li><li><p>计算商品两两之间的共现次数；</p></li><li><p>归一化并截取每件商品最相似的前 50 件。</p></li></ol>
    <table><tbody>
      <tr><th><p>方法</p></th><th><p>召回率</p></th><th><p>单次耗时</p></th></tr>
      <tr><td><p>热门商品（基线）</p></td><td><p>48.9%</p></td><td><p>3 ms</p></td></tr>
      <tr><td><p>物品协同过滤</p></td><td><p>71.4%</p></td><td><p>12 ms</p></td></tr>
    </tbody></table>
    <p>表 3-1 中的数据为自制样例，仅用于展示排版。</p>
  `,
  onUpdate: () => (dirty.value = true),
  onSelectionUpdate: ({ editor: e }) => {
    const { from, to, empty } = e.state.selection;
    selection.value = { empty, chars: empty ? 0 : e.state.doc.textBetween(from, to, "").length };
  },
});

const words = computed(() => {
  const text = editor.value?.getText() ?? "";
  const cjk = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9]+(?:\.[0-9]+)?%?/g)?.length ?? 0;
  return cjk + latin;
});

const is = (name: string, attrs?: Record<string, unknown>) => editor.value?.isActive(name, attrs) ?? false;
</script>

<template>
  <div class="tp-paper">
    <div class="tp-toolbar" role="toolbar" aria-label="正文格式">
      <button
        type="button"
        class="tp-tool tp-tip tp-tip--below"
        data-tip="撤销"
        aria-label="撤销"
        :disabled="!editor?.can().undo()"
        @click="editor?.chain().focus().undo().run()"
      >
        <TpIcon :icon="PhArrowUUpLeft" />
      </button>
      <button
        type="button"
        class="tp-tool tp-tip tp-tip--below"
        data-tip="重做"
        aria-label="重做"
        :disabled="!editor?.can().redo()"
        @click="editor?.chain().focus().redo().run()"
      >
        <TpIcon :icon="PhArrowUUpRight" />
      </button>
      <span class="tp-tool-sep" />
      <button
        v-for="level in [1, 2, 3] as const"
        :key="level"
        type="button"
        class="tp-tool"
        :aria-label="level + ' 级标题'"
        :aria-pressed="is('heading', { level })"
        @click="editor?.chain().focus().toggleHeading({ level }).run()"
      >
        H{{ level }}
      </button>
      <span class="tp-tool-sep" />
      <button type="button" class="tp-tool" aria-label="加粗" :aria-pressed="is('bold')" @click="editor?.chain().focus().toggleBold().run()">
        <TpIcon :icon="PhTextB" weight="bold" />
      </button>
      <button type="button" class="tp-tool" aria-label="斜体" :aria-pressed="is('italic')" @click="editor?.chain().focus().toggleItalic().run()">
        <TpIcon :icon="PhTextItalic" />
      </button>
      <span class="tp-tool-sep" />
      <button type="button" class="tp-tool" aria-label="无序列表" :aria-pressed="is('bulletList')" @click="editor?.chain().focus().toggleBulletList().run()">
        <TpIcon :icon="PhListBullets" />
      </button>
      <button type="button" class="tp-tool" aria-label="有序列表" :aria-pressed="is('orderedList')" @click="editor?.chain().focus().toggleOrderedList().run()">
        <TpIcon :icon="PhListNumbers" />
      </button>
      <span class="tp-tool-sep" />
      <button
        type="button"
        class="tp-tool tp-tip tp-tip--below"
        data-tip="插入 3×3 表格"
        aria-label="插入表格"
        @click="editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()"
      >
        <TpIcon :icon="PhTable" />
      </button>
      <button
        type="button"
        class="tp-tool tp-tip tp-tip--below"
        data-tip="在下方加一行"
        aria-label="在下方加一行"
        :disabled="!editor?.can().addRowAfter()"
        @click="editor?.chain().focus().addRowAfter().run()"
      >
        <TpIcon :icon="PhRowsPlusBottom" />
      </button>
      <button
        type="button"
        class="tp-tool tp-tip tp-tip--below"
        data-tip="在右侧加一列"
        aria-label="在右侧加一列"
        :disabled="!editor?.can().addColumnAfter()"
        @click="editor?.chain().focus().addColumnAfter().run()"
      >
        <TpIcon :icon="PhColumnsPlusRight" />
      </button>
      <span class="ml-auto flex items-center gap-3 pr-2">
        <TpSaveIndicator :state="dirty ? 'dirty' : 'saved'" at="14:32" />
        <TpVersion :v="13" prefix="正文 " />
      </span>
    </div>
    <div class="px-[clamp(1.25rem,5vw,3.5rem)] py-8">
      <EditorContent :editor="editor" />
    </div>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[0.75rem] text-fg-muted">
      <span>第 3 章 › 3.2 协同过滤召回</span>
      <span class="tp-mono">{{ words.toLocaleString() }} 字</span>
      <span>{{ selection.empty ? "光标" : "选区 " + selection.chars + " 字" }}</span>
      <span class="ml-auto flex items-center gap-3">
        <span class="inline-flex items-center gap-1"><span class="tp-protect" data-kind="number">12%</span>数字</span>
        <span class="inline-flex items-center gap-1"><span class="tp-protect" data-kind="citation">[1]</span>引用</span>
        <span>AI 不可修改</span>
      </span>
    </div>
  </div>
</template>
