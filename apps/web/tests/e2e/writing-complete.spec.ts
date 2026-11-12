import { expect, test } from "@playwright/test";
import { appUrl } from "./app-url.ts";

test("实际选区候选先审阅再采纳，撤销追加历史而保留内容", async ({ page }) => {
  await page.goto(appUrl("/screens/write"));
  const editor = page.getByLabel("论文正文编辑区", { exact: true });
  await editor.fill("本系统采用 1200 条记录，召回率为 82.6% [1]。");
  await editor.press("ControlOrMeta+Home");
  await page.getByRole("button", { name: "选中当前段落", exact: true }).click();
  await page.getByRole("tab", { name: "审阅", exact: true }).click();
  await page.getByLabel("候选文字", { exact: true }).fill("本系统使用 1200 条记录，召回率为 82.6% [1]。");
  await page.getByRole("button", { name: "生成修订预览", exact: true }).click();
  await expect(page.getByRole("button", { name: "接受第 1 处修改" })).toBeVisible();
  await expect(editor).toContainText("本系统采用");
  await page.getByRole("button", { name: "接受第 1 处修改" }).click();
  await expect(editor).toContainText("本系统采用");
  await page.getByRole("button", { name: /采纳所选/ }).click();
  await expect(editor).toContainText("本系统使用");
  await page.getByRole("button", { name: "撤销采纳", exact: true }).click();
  await expect(editor).toContainText("本系统采用");
  await page.getByRole("tab", { name: "版本", exact: true }).click();
  await expect(page.locator(".tp-vt")).toContainText("撤销采纳并保留历史");
});

test("保护数字与旧版本，不允许候选直接覆盖新稿", async ({ page }) => {
  await page.goto(appUrl("/screens/write"));
  const editor = page.getByLabel("论文正文编辑区", { exact: true });
  await editor.fill("采用 1200 条记录 [1]。");
  await editor.press("ControlOrMeta+Home");
  await page.getByRole("button", { name: "选中当前段落", exact: true }).click();
  await page.getByRole("tab", { name: "审阅", exact: true }).click();
  const replacement = page.getByLabel("候选文字", { exact: true });
  await replacement.fill("使用 1300 条记录 [1]。");
  await page.getByRole("button", { name: "生成修订预览", exact: true }).click();
  await expect(page.getByRole("button", { name: "接受第 1 处修改" })).toBeDisabled();
  await expect(editor).toContainText("1200");
  await page.getByRole("tab", { name: "审阅", exact: true }).click();
  await replacement.fill("使用 1200 条记录 [1]。");
  await page.getByRole("button", { name: "生成修订预览", exact: true }).click();
  await expect(page.getByRole("button", { name: "接受第 1 处修改" })).toBeEnabled();
  await editor.fill("我的新内容 1200 [1]。");
  await expect(page.getByText("已过期", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /采纳所选/ })).toHaveCount(0);
});

test("锁定选区拒绝AI改写，本人仍可以手动编辑", async ({ page }) => {
  await page.goto(appUrl("/screens/write"));
  const editor = page.getByLabel("论文正文编辑区", { exact: true });
  await editor.fill("这句话需要锁定。");
  await editor.press("ControlOrMeta+Home");
  await page.getByRole("button", { name: "选中当前段落", exact: true }).click();
  await page.getByRole("button", { name: "锁定选区供 AI 保护" }).click();
  await expect(editor.locator('[data-ai-lock="true"]')).toContainText("这句话需要锁定");
  await page.getByRole("tab", { name: "审阅", exact: true }).click();
  await page.getByLabel("候选文字", { exact: true }).fill("换成另一句话。");
  await page.getByRole("button", { name: "生成修订预览", exact: true }).click();
  await expect(page.getByRole("button", { name: "接受第 1 处修改" })).toBeDisabled();
  await expect(editor).toContainText("这句话需要锁定");
  await editor.fill("本人手动修正仍可保存。");
  await expect(editor).toHaveText("本人手动修正仍可保存。");
});

test("助手草稿相互隔离，取消后不追加迟到回复", async ({ page }) => {
  await page.goto(appUrl("/screens/write"));
  const general = page.getByRole("region", { name: "综合助手会话", exact: true });
  const generalDraft = general.getByLabel("给助手的消息", { exact: true });
  const contentDraft = page.getByRole("region", { name: "内容辅助会话", exact: true }).getByLabel("给助手的消息", { exact: true });
  await page.getByRole("radio", { name: "综合", exact: true }).click();
  await expect(generalDraft).toBeVisible();
  await generalDraft.fill("综合助手草稿");
  await page.getByRole("radio", { name: "专业", exact: true }).click();
  await expect(contentDraft).toBeVisible();
  await expect(contentDraft).toHaveValue("");
  await contentDraft.fill("内容助手草稿");
  await page.getByRole("radio", { name: "综合", exact: true }).click();
  await expect(generalDraft).toBeVisible();
  await expect(generalDraft).toHaveValue("综合助手草稿");
  await general.getByRole("button", { name: "发送", exact: true }).click();
  await general.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect(page.getByText("本次已取消，正文与已有消息保留。")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.locator(".write-message.assistant")).toHaveCount(0);
});

test("切开引用括号或数字中部的选区不能绕过保护", async ({ page }) => {
  await page.goto(appUrl("/screens/write"));
  const editor = page.getByLabel("论文正文编辑区", { exact: true });
  for (const example of [
    { text: "引用[1]", offset: 4, length: 1, after: "）" },
    { text: "1200", offset: 1, length: 2, after: "20万" },
  ]) {
    await editor.fill(example.text);
    const selected = await editor.evaluate((element, range) => {
      (element as HTMLElement).focus();
      const block = element.firstElementChild!;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const locate = (offset: number) => {
        let used = 0;
        for (const node of nodes) {
          if (offset <= used + node.length) return { node, offset: offset - used };
          used += node.length;
        }
        throw new Error("选区超出实际文本块");
      };
      const from = locate(range.offset);
      const to = locate(range.offset + range.length);
      const selection = window.getSelection()!;
      selection.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
      document.dispatchEvent(new Event("selectionchange"));
      return selection.toString();
    }, example);
    expect(selected).toBe(example.text.slice(example.offset, example.offset + example.length));
    await expect(page.locator(".write-paper-status")).toContainText(`已选 ${example.length} 字`);
    await page.getByRole("tab", { name: "审阅", exact: true }).click();
    await expect(page.locator(".write-selection-text")).toHaveText(selected);
    await page.getByLabel("候选文字", { exact: true }).fill(example.after);
    await page.getByRole("button", { name: "生成修订预览", exact: true }).click();
    await expect(page.getByRole("button", { name: "接受第 1 处修改" })).toBeDisabled();
    await expect(page.locator(".tp-hunk__blocked")).toContainText(example.text.includes("[") ? "引用" : "数字");
    await expect(page.getByRole("button", { name: /采纳所选/ })).toHaveCount(0);
    await expect(editor).toHaveText(example.text);
  }
});

test("复杂文档导入拒绝覆盖，历史版本入口只查看", async ({ page }) => {
  await page.goto(appUrl("/screens/write?version=99"));
  await expect(page.getByText(/历史快照在本预览中不可用/)).toBeVisible();
  const editor = page.getByLabel("论文正文编辑区", { exact: true });
  const initial = await editor.textContent();
  await page.getByRole("tab", { name: "对象", exact: true }).click();
  await page.getByLabel("导入已有论文", { exact: true }).setInputFiles({
    name: "sample.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("unsupported test fixture"),
  });
  await expect(page.getByText(/当前只支持 UTF-8 纯文本导入/)).toBeVisible();
  await expect(editor).toHaveText(initial!);
});

test("已核实引用经专用候选追加，采纳与撤销保留原段落", async ({ page }) => {
  await page.goto(appUrl("/screens/write"));
  const editor = page.getByLabel("论文正文编辑区", { exact: true });
  await editor.fill("这里是我的原段落，包含 1200 条记录 [1]。");
  await page.getByRole("link", { name: "资料", exact: true }).click();
  await page.getByRole("tab", { name: /文献索引/ }).click();
  await page.locator(".library-literature-row").filter({ hasText: "面向稀疏交互" }).click();
  await page.getByRole("button", { name: "准备引用候选", exact: true }).click();
  await expect(page).toHaveURL(/citation=/);
  await editor.press("ControlOrMeta+Home");
  await page.getByRole("button", { name: "选中当前段落", exact: true }).click();
  await page.getByRole("tab", { name: "审阅", exact: true }).click();
  await page.getByRole("button", { name: "生成修订预览", exact: true }).click();
  await expect(page.getByRole("button", { name: "接受第 1 处修改" })).toBeEnabled();
  await page.getByRole("button", { name: "接受第 1 处修改" }).click();
  await page.getByRole("button", { name: /采纳所选/ }).click();
  await expect(editor).toContainText("这里是我的原段落，包含 1200 条记录 [1]。");
  await expect(editor).toContainText("[L-012]");
  await page.getByRole("button", { name: "撤销采纳", exact: true }).click();
  await expect(editor).toHaveText("这里是我的原段落，包含 1200 条记录 [1]。");
});

test("候选完整历史在生成下一条与刷新后保留", async ({ page }) => {
  await page.goto(appUrl("/screens/write"));
  const editor = page.getByLabel("论文正文编辑区", { exact: true });
  await editor.fill("本系统采用混合推荐方法。");
  for (const goal of ["第一次表达调整", "第二次表达调整"]) {
    await editor.press("ControlOrMeta+Home");
    await page.getByRole("button", { name: "选中当前段落", exact: true }).click();
    await page.getByRole("tab", { name: "审阅", exact: true }).click();
    await page.getByLabel("修改目标", { exact: true }).fill(goal);
    await page.getByRole("button", { name: "生成修订预览", exact: true }).click();
    await expect(page.getByRole("button", { name: "接受第 1 处修改" })).toBeVisible();
    await page.getByRole("button", { name: "全部拒绝", exact: true }).click();
  }
  await page.reload();
  await page.getByRole("tab", { name: "版本", exact: true }).click();
  await page.getByText("完整修订历史（2）", { exact: true }).click();
  await page.getByRole("button", { name: /第一次表达调整/ }).click();
  await expect(page.getByRole("heading", { name: "第一次表达调整", exact: true })).toBeVisible();
  await expect(page.locator(".write-inset")).toContainText("原数字和引用由程序保护");
});
