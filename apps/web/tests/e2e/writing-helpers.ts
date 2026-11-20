import { expect, type Page } from "@playwright/test";

/**
 * 正式写作页（MuffinOffice 纸面）回归的共用操作。纸面由 DocsEditor 自绘：输入走 beforeinput，
 * 不能用 locator.fill；页码、页眉页脚也在纸面内，断言正文请用 toContainText 或读服务端快照。
 */
export const manuscript = (page: Page) => page.locator('[aria-label="论文正文编辑区"][contenteditable="true"]');

/** 选中全文并替换为给定文字（一次输入事务）。 */
export async function replaceManuscript(page: Page, text: string) {
  const surface = manuscript(page);
  await expect(surface).toBeVisible({ timeout: 30_000 });
  await surface.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
  for (const line of text.split(/\r?\n/).filter(Boolean)) await expect(surface).toContainText(line);
}

/** 把光标放到某个段落（按节点 ID）末尾。 */
export async function caretAtEnd(page: Page, node: string) {
  const block = page.locator(`[data-node-id="${node}"]`).first();
  await block.scrollIntoViewIfNeeded();
  const box = await block.boundingBox();
  if (!box) throw new Error(`段落 ${node} 不在纸面上`);
  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
}

/** 在段落开头选中若干个字（键盘扩选，与学生操作一致）。 */
export async function selectAtStart(page: Page, node: string, length: number) {
  const block = page.locator(`[data-node-id="${node}"]`).first();
  await block.scrollIntoViewIfNeeded();
  const box = await block.boundingBox();
  if (!box) throw new Error(`段落 ${node} 不在纸面上`);
  await page.mouse.click(box.x + 1, box.y + box.height / 2);
  for (let index = 0; index < length; index++) await page.keyboard.press("Shift+ArrowRight");
}

/** 点击“保存”并返回保存请求的状态码。 */
export async function saveManuscript(page: Page, projectId: string): Promise<number> {
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes(`/projects/${projectId}/documents/`));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  return (await saved).status();
}

/** 自制合成论文（v2 快照）：章节、普通段落、一张表与参考文献；不含任何真实内容。 */
export function syntheticThesis(chapters = 4) {
  const run = (text: string) => ({ type: "run", text });
  const blocks: unknown[] = [];
  for (let chapter = 1; chapter <= chapters; chapter++) {
    blocks.push({ type: "heading", id: `ch-${chapter}`, level: 1, inlines: [run(`第${chapter}章 自制章节${chapter}`)] });
    blocks.push({ type: "heading", id: `sec-${chapter}`, level: 2, inlines: [run(`${chapter}.1 自制小节`)] });
    for (let paragraph = 1; paragraph <= 3; paragraph++)
      blocks.push({ type: "paragraph", id: `p-${chapter}-${paragraph}`, inlines: [run(`第${chapter}章第${paragraph}段：自制合成文字，用于写作页回归。`)] });
  }
  blocks.push({ type: "heading", id: "refs", level: 1, inlines: [run("参考文献")] });
  blocks.push({ type: "paragraph", id: "ref-1", inlines: [run("[1] 自制样例作者. 示例文献[J]. 2025.")] });
  return {
    schemaVersion: 2,
    model: { kind: "docs", schemaVersion: 1, id: "synthetic", theme: { name: "minimal" }, sections: [{ id: "s-1", blocks }] },
    protections: [],
    chapters: [],
  };
}
