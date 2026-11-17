import type { Block } from "@muffin-office/core/types";
import {
  Transform,
  createId,
  indexDoc,
  orderedRange,
  type CommandContext,
  type DocsEditorController,
  type KernelTransaction,
} from "@muffin-office/vue/docs-editor/core";

/**
 * 编辑器没有现成命令、但内核与服务端操作子集都支持的插入：在光标所在的顶层块之后插入一个块
 * （doc.insert_block），作为一次可撤销的事务，受保护区间与宿主否决同样生效。
 */
function insertAfterCursor(controller: DocsEditorController, intent: string, make: () => { block: Block; caret?: string }): boolean {
  return controller.run(
    (ctx: CommandContext) => {
      const range = orderedRange(indexDoc(ctx.doc), ctx.selection);
      if (!range) return null;
      for (const section of ctx.doc.sections) {
        const top = section.blocks.find((block: Block) => contains(block, range.to.node));
        if (!top) continue;
        const { block, caret } = make();
        const tr = new Transform(ctx.doc, ctx.constraints ? { constraints: ctx.constraints } : undefined);
        tr.step({ op: "doc.insert_block", section: section.id, at: { kind: "after", id: top.id }, block });
        if (caret) tr.selection = { anchor: { node: caret, offset: 0 }, focus: { node: caret, offset: 0 } };
        return tr;
      }
      return null;
    },
    { source: "command", intent },
  );
}

function contains(block: Block, node: string): boolean {
  if (block.id === node) return true;
  if (block.type === "list") return block.items.some((item) => item.id === node || item.blocks.some((child) => contains(child, node)));
  if (block.type === "table")
    return block.rows.some((row) => row.id === node || row.cells.some((cell) => cell.id === node || cell.blocks.some((child) => contains(child, node))));
  if (block.type === "quote" || block.type === "container") return block.blocks.some((child) => contains(child, node));
  return false;
}

const line = { style: "single" as const };

/** 3 × 3 表格，首行为表头、带网格线（等同 Word 的“网格型”）；光标落在第一个单元格。 */
export function insertTable(controller: DocsEditorController, rows = 3, columns = 3): boolean {
  return insertAfterCursor(controller, "insertTable", () => {
    const paragraphs: string[] = [];
    const block: Block = {
      type: "table",
      id: createId(),
      props: { headerRows: 1, borders: { top: line, bottom: line, left: line, right: line, insideH: line, insideV: line } },
      rows: Array.from({ length: rows }, (_, row) => ({
        id: createId(),
        ...(row === 0 ? { header: true } : {}),
        cells: Array.from({ length: columns }, () => {
          const paragraph = createId();
          paragraphs.push(paragraph);
          return { id: createId(), blocks: [{ type: "paragraph" as const, id: paragraph, inlines: [] }] };
        }),
      })),
    };
    return { block, caret: paragraphs[0] };
  });
}

export function insertPageBreak(controller: DocsEditorController): boolean {
  return insertAfterCursor(controller, "insertPageBreak", () => ({ block: { type: "page_break", id: createId() } }));
}

/** 原件导入的正文：只允许改动映射为可编辑的段落 / 标题内的文字。 */
export function sourceTextOnly(editable: ReadonlySet<string>) {
  return (transaction: KernelTransaction) => transaction.txn.every((op) => op.op === "doc.replace_text" && editable.has(op.id));
}
