import { expect, test, type Page } from "@playwright/test";
import type { BlockedEvent } from "@muffin-office/vue/docs-editor";
import type { DocsModel } from "@muffin-office/core/types";
import type { DocsSnapshot } from "../../src/workspace/editor/docsSnapshot.ts";

interface HarnessWindow {
  __harness: {
    state(): string;
    editor(): { setSelection(selection: unknown): void; focus(): void } | undefined;
    model(): DocsModel;
    text(node: string): string | undefined;
    blocked(): BlockedEvent[];
    transactions(): number;
    snapshot(): { lost: string[]; snapshot: DocsSnapshot };
  };
}

const shots = process.env.DOCS_EDITOR_SHOTS;
const THEMES = ["zhumo", "yingguang", "yehang", "chenwu"] as const;

async function open(page: Page, query = "") {
  await page.goto(`/tests/editor/docs-editor.html${query}`);
  await expect(page.locator('[data-state="ready"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("docs-editor-surface")).toBeVisible();
}

async function caret(page: Page, node: string, offset: number) {
  await page.evaluate(
    ([id, at]) => {
      const harness = (window as unknown as HarnessWindow).__harness;
      const editor = harness.editor()!;
      editor.focus();
      editor.setSelection({ anchor: { node: id, offset: at }, focus: { node: id, offset: at } });
    },
    [node, offset] as const,
  );
  await page.waitForTimeout(50);
}

const text = (page: Page, node: string) => page.evaluate((id) => (window as unknown as HarnessWindow).__harness.text(id), node);

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

test("v2 快照挂载、打字、撤销与粘贴都经由模型", async ({ page, context }) => {
  await open(page);
  await shot(page, "mounted-zhumo");
  await caret(page, "p-tail", 9);
  await page.keyboard.type("补充");
  expect(await text(page, "p-tail")).toBe("结论部分在此处续写补充。");

  await page.keyboard.press("ControlOrMeta+Z");
  await expect.poll(() => text(page, "p-tail")).toBe("结论部分在此处续写。");
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await expect.poll(() => text(page, "p-tail")).toBe("结论部分在此处续写补充。");

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("（粘贴）"));
  await caret(page, "p-method", 0);
  await page.keyboard.press("ControlOrMeta+V");
  await expect.poll(() => text(page, "p-method")).toBe("（粘贴）采用协同过滤与内容特征融合的方式构建候选集，并按活跃度做对数惩罚。");
});

test("中文输入法合成结束后一次提交，撤销回到合成前", async ({ page }) => {
  await open(page);
  await caret(page, "p-tail", 0);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "zhong", selectionStart: 5, selectionEnd: 5 });
  await cdp.send("Input.imeSetComposition", { text: "zhongwen", selectionStart: 8, selectionEnd: 8 });
  const during = await page.evaluate(() => (window as unknown as HarnessWindow).__harness.transactions());
  await cdp.send("Input.insertText", { text: "中文" });
  await expect.poll(() => text(page, "p-tail")).toBe("中文结论部分在此处续写。");
  expect(during).toBe(0);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__harness.transactions())).toBe(1);
  await expect(page.getByTestId("docs-editor-surface")).not.toContainText("zhong");
  await page.keyboard.press("ControlOrMeta+Z");
  await expect.poll(() => text(page, "p-tail")).toBe("结论部分在此处续写。");
});

test("受保护区间拦截输入并给出提示，保护随编辑移动", async ({ page }) => {
  await open(page);
  const before = await text(page, "p-intro");
  await caret(page, "p-intro", 29);
  await page.keyboard.type("9");
  await page.keyboard.press("Backspace");
  expect(await text(page, "p-intro")).toBe(before);
  const blocked = await page.evaluate(() => (window as unknown as HarnessWindow).__harness.blocked());
  expect(blocked.map((event) => [event.rangeId, event.kind])).toEqual([
    ["pr-number", "number"],
    ["pr-number", "number"],
  ]);
  await expect(page.getByRole("status").first()).toHaveText("数字受保护，修改没有生效。正文保持不变；如需改动，请通过候选审阅采纳。");

  await caret(page, "p-lock", 3);
  await page.keyboard.type("改");
  expect(await text(page, "p-lock")).toBe("本节实验数据均来自作者自建的模拟数据集。");
  await shot(page, "protected-blocked");

  await caret(page, "p-intro", 0);
  await page.keyboard.type("新");
  const { lost, snapshot } = await page.evaluate(() => (window as unknown as HarnessWindow).__harness.snapshot());
  expect(lost).toEqual([]);
  expect(snapshot.protections.slice(0, 2).map((item) => item.anchor)).toEqual([
    { node: "p-intro", start: 28, end: 33 },
    { node: "p-intro", start: 38, end: 41 },
  ]);
});

test("叠加层随编辑移动但不写回模型", async ({ page }) => {
  await open(page);
  const highlighted = () =>
    page.evaluate(() =>
      [...(CSS.highlights.get("mo-doc-insert") ?? [])].map((painted) => {
        const range = document.createRange();
        range.setStart(painted.startContainer, painted.startOffset);
        range.setEnd(painted.endContainer, painted.endOffset);
        return range.toString();
      }),
    );
  await expect.poll(highlighted).toEqual(["协同过滤"]);
  await caret(page, "p-method", 0);
  await page.keyboard.type("我们");
  await expect.poll(highlighted).toEqual(["协同过滤"]);
  const json = JSON.stringify(await page.evaluate(() => (window as unknown as HarnessWindow).__harness.model()));
  expect(json).not.toMatch(/candidate|review|highlight|cand-1/);
  expect(await text(page, "p-method")).toBe("我们采用协同过滤与内容特征融合的方式构建候选集，并按活跃度做对数惩罚。");
});

for (const theme of THEMES)
  test(`主题 ${theme}：桌面取语义令牌，纸面保持白底`, async ({ page }) => {
    await open(page, `?theme=${theme}`);
    const colors = await page.evaluate(() => {
      const editor = document.querySelector(".mo-docs-editor")!;
      const probe = document.createElement("div");
      probe.style.background = "var(--tp-surface-sunken)";
      document.querySelector(".tp-docs-editor")!.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const paper = document.querySelector(".doc-paper, .doc-sheet");
      return { desk: getComputedStyle(editor).backgroundColor, expected, paper: paper ? getComputedStyle(paper).backgroundColor : "missing" };
    });
    expect(colors.desk).toBe(colors.expected);
    expect(colors.paper).toBe("rgb(255, 255, 255)");
    await shot(page, `theme-${theme}`);
  });

test("减弱动效与窄屏", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "?theme=yehang&motion=reduced");
  const viewport = page.locator(".mo-docs-editor__viewport");
  expect(await viewport.evaluate((element) => [getComputedStyle(element).scrollBehavior, getComputedStyle(element).transitionDuration])).toEqual([
    "auto",
    "0s",
  ]);
  await caret(page, "p-tail", 9);
  await page.keyboard.type("窄");
  expect(await text(page, "p-tail")).toBe("结论部分在此处续写窄。");
  await shot(page, "narrow-yehang-reduced");
});
