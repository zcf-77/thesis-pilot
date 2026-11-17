// DocsEditor 冒烟检查页（仅开发服务器，不进入正式导航）：用自制的合成论文片段挂载 v2 快照，
// 供 tests/e2e/docs-editor-smoke.editor.ts 在真实 Chrome 中检查输入、输入法、撤销、粘贴、保护拦截与主题。
import { createApp, defineComponent, h, ref, shallowRef } from "vue";
import type { DocsModel, DocsPreviewContext } from "@muffin-office/core/types";
import { DocsEditor, type BlockedEvent } from "@muffin-office/vue/docs-editor";
import type { PreviewHighlight } from "@muffin-office/vue/docs-anchors";
import { textBlockText } from "../../src/workspace/editor/anchors.ts";
import { createDocsSnapshot, parseDocsSnapshot, type DocsSnapshot } from "../../src/workspace/editor/docsSnapshot.ts";
import { DocsEngineError, loadDocsEngine } from "../../src/workspace/editor/engine.ts";
import { describeBlocked, protectionsFromRanges, toProtectedRanges } from "../../src/workspace/editor/protections.ts";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "zhumo";
document.documentElement.dataset.motion = params.get("motion") ?? "full";

const run = (text: string) => ({ type: "run" as const, text });
const sample: DocsSnapshot = parseDocsSnapshot({
  schemaVersion: 2,
  model: {
    kind: "docs",
    schemaVersion: 1,
    id: "harness-doc",
    theme: { name: "gongwen" },
    sections: [
      {
        id: "s1",
        blocks: [
          { type: "heading", id: "ch-intro", level: 1, inlines: [run("第一章 绪论")] },
          { type: "paragraph", id: "p-intro", inlines: [run("本研究在校园二手交易数据上评估推荐算法，召回率提升到 71.4%，与文献 [3] 的结论一致。")] },
          { type: "paragraph", id: "p-lock", inlines: [run("本节实验数据均来自作者自建的模拟数据集。")] },
          { type: "heading", id: "ch-method", level: 2, inlines: [run("1.1 研究方法")] },
          { type: "paragraph", id: "p-method", inlines: [run("采用协同过滤与内容特征融合的方式构建候选集，并按活跃度做对数惩罚。")] },
          {
            type: "table",
            id: "t-metrics",
            rows: [
              {
                id: "r-head",
                cells: [
                  { id: "c-h1", blocks: [{ type: "paragraph", id: "p-h1", inlines: [run("指标")] }] },
                  { id: "c-h2", blocks: [{ type: "paragraph", id: "p-h2", inlines: [run("数值")] }] },
                ],
              },
              {
                id: "r-1",
                cells: [
                  { id: "c-11", blocks: [{ type: "paragraph", id: "p-11", inlines: [run("召回率")] }] },
                  { id: "c-12", blocks: [{ type: "paragraph", id: "p-12", inlines: [run("71.4%")] }] },
                ],
              },
            ],
          },
          { type: "paragraph", id: "p-tail", inlines: [run("结论部分在此处续写。")] },
        ],
      },
    ],
  },
  protections: [
    { id: "pr-number", kind: "number", anchor: { node: "p-intro", start: 27, end: 32 } },
    { id: "pr-citation", kind: "citation", anchor: { node: "p-intro", start: 37, end: 40 }, binding: "lit-3" },
    { id: "pr-lock", kind: "lock", anchor: { node: "p-lock" } },
    { id: "pr-table", kind: "object", anchor: { node: "t-metrics" } },
  ],
  chapters: [],
});

const overlays: PreviewHighlight[] = [
  { id: "cand-1", group: "candidate", tone: "insert", anchor: { node: "p-method", start: 2, end: 6 } },
  { id: "review-1", group: "review", tone: "comment", anchor: { node: "p-tail", start: 0, end: 4 } },
];

type EditorHandle = InstanceType<typeof DocsEditor>;

const Harness = defineComponent({
  setup() {
    const state = ref<"loading" | "ready" | "error">("loading");
    const message = ref("");
    const model = shallowRef<DocsModel>(sample.model);
    const context = shallowRef<DocsPreviewContext>();
    const editor = ref<EditorHandle>();
    const blocked: BlockedEvent[] = [];
    let transactions = 0;
    const ranges = toProtectedRanges(sample.protections);

    // 检查页位于 tests/editor/ 下；内核资源由开发服务器在站点根目录的 mo/ 提供。
    loadDocsEngine({ assetBase: new URL("/mo/", location.origin) })
      .then((engine) => engine.open(sample.model))
      .then((opened) => {
        model.value = opened.model;
        context.value = opened.context;
        state.value = "ready";
      })
      .catch((error: unknown) => {
        state.value = "error";
        message.value = error instanceof DocsEngineError ? error.message : String(error);
      });

    Object.assign(window, {
      __harness: {
        state: () => state.value,
        editor: () => editor.value,
        model: () => editor.value?.getModel() ?? model.value,
        text: (node: string) => textBlockText(editor.value?.getModel() ?? model.value, node),
        blocked: () => blocked.map((event) => ({ ...event })),
        transactions: () => transactions,
        snapshot: () => {
          const current = editor.value!.getModel();
          const readback = protectionsFromRanges(sample.protections, editor.value!.controller.protected);
          return { lost: readback.lost, snapshot: createDocsSnapshot(current, readback.protections) };
        },
      },
    });

    return () =>
      h("div", { class: "harness", "data-state": state.value }, [
        h("p", { class: "harness__status", role: "status" }, message.value),
        context.value
          ? h("div", { class: "tp-docs-editor harness__editor" }, [
              h(DocsEditor, {
                ref: editor,
                model: model.value,
                context: context.value,
                protectedRanges: ranges,
                overlays,
                actor: "user:harness",
                ariaLabel: "论文正文",
                onTransaction: () => {
                  transactions++;
                  message.value = "";
                },
                onBlocked: (event: BlockedEvent) => {
                  blocked.push(event);
                  message.value = describeBlocked(event);
                },
              }),
            ])
          : null,
      ]);
  },
});

const style = document.createElement("style");
style.textContent = `
  body { margin: 0; background: var(--tp-canvas); color: var(--tp-text); font-family: var(--tp-font-body); }
  .harness { display: flex; flex-direction: column; height: 100vh; }
  .harness__status { margin: 0; min-height: 36px; padding: 8px 16px; font-size: 13px; color: var(--tp-text-muted); border-bottom: 1px solid var(--tp-line); }
  .harness__editor { flex: 1; min-height: 0; }
`;
document.head.append(style);
createApp(Harness).mount("#harness");
