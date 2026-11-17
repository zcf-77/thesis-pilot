import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "./app-url.ts";

/**
 * 设计展台的端到端检查。对象是“组件与设计语法是否按规范工作”，不是业务流程
 * （业务流程、Mock 服务与编辑器适配在方案确认后实现并另行测试）。
 */

const routes = ["/", "/directions", "/grammar", "/tokens", "/components", "/domain", "/motion", "/layouts", "/spec"];

async function open(page: Page, route: string) {
  await page.goto(appUrl(route));
  await page.evaluate(() => document.fonts.ready);
}

test.describe("展台可用性", () => {
  for (const route of routes) {
    test("页面 " + route + " 加载且没有运行时错误", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await open(page, route);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
});

test.describe("方案与外观偏好", () => {
  test("方案坞切换方案，并在刷新后保持", async ({ page }) => {
    await open(page, "/components");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "yingguang");
    await page.getByRole("button", { name: "切换到方案：夜航" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "yehang");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "yehang");
    await expect(page.getByRole("button", { name: "切换到方案：夜航" })).toHaveAttribute("aria-pressed", "true");
  });

  test("嵌套主题互不串味：同一页里四个方案的主按钮各用各的主行动色", async ({ page }) => {
    await open(page, "/motion");
    const bg = (theme: string) =>
      page
        .locator('#persona [data-theme="' + theme + '"] .tp-btn--primary')
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg("zhumo")).toBe("rgb(27, 29, 33)");
    expect(await bg("yingguang")).toBe("rgb(255, 229, 0)");
    expect(await bg("yehang")).toBe("rgb(200, 242, 58)");
    // 荧光笔记的硬投影只出现在它自己的作用域里
    const shadow = (theme: string) =>
      page
        .locator('#persona [data-theme="' + theme + '"] .tp-btn--primary')
        .first()
        .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(await shadow("yingguang")).toContain("2px 2px 0px");
    expect(await shadow("zhumo")).not.toContain("2px 2px 0px");
  });

  test("减弱动效：切换后根元素标记为 reduced，时长令牌被压缩", async ({ page }) => {
    await open(page, "/motion");
    await page.getByRole("button", { name: "切换为减弱动效" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    const dur = await page.locator(".lab").evaluate((el) => getComputedStyle(el).getPropertyValue("--tp-dur-deliberate").trim());
    // 压缩器可能把 120ms 写成 .12s，这里统一换算成毫秒再比较
    const ms = dur.endsWith("ms") ? parseFloat(dur) : parseFloat(dur) * 1000;
    expect(ms).toBe(120);
  });
});

test.describe("设计语法：铅笔 → 墨水 → 印章", () => {
  test("候选在采纳前是铅笔；学生采纳后落墨并盖章；撤销回到待审阅", async ({ page }) => {
    await open(page, "/domain");
    const card = page.locator("#revision").getByRole("article", { name: /润色 3\.2 节第 4 段/ });
    const frame = page.locator("#revision .tp-pf").first();
    await expect(frame).not.toHaveClass(/is-inked/);
    await expect(card.getByText("待审阅")).toBeVisible();
    // 勾选接受不等于生效：仍然是铅笔，删除线还在
    await expect(card.locator("del.tp-cand-del").first()).toBeVisible();
    await expect(card.locator("ins.is-inked")).toHaveCount(0);

    await card.getByRole("button", { name: /采纳所选（2）/ }).click();
    await expect(frame).toHaveClass(/is-inked/);
    await expect(card.locator(".tp-seal", { hasText: "已采纳" })).toBeVisible();
    await expect(card.locator("ins.is-inked")).toHaveCount(2);
    // 第 3 处没有被接受：恢复为原文，不带铅笔样式
    await expect(card.getByText("但是新商品效果不太好，因为没有交互数据。")).toBeVisible();
    await expect(card.getByText("形成 v13")).toBeVisible();

    await card.getByRole("button", { name: "撤销采纳" }).click();
    await expect(frame).not.toHaveClass(/is-inked/);
    await expect(card.getByText("待审阅")).toBeVisible();
  });

  test("没有任何片段被接受时，不能采纳", async ({ page }) => {
    await open(page, "/domain");
    const card = page.locator("#revision").getByRole("article", { name: /润色 3\.2 节第 4 段/ });
    await card.getByRole("button", { name: "接受第 1 处修改" }).click();
    await card.getByRole("button", { name: "接受第 2 处修改" }).click();
    await expect(card.getByRole("button", { name: /采纳所选（0）/ })).toBeDisabled();
  });

  test("被程序拦截的候选没有采纳入口，受保护片段的接受键禁用", async ({ page }) => {
    await open(page, "/domain");
    const card = page.locator("#revision").getByRole("article", { name: /把实验结论写得更有说服力/ });
    await expect(card.getByText("校验失败")).toBeVisible();
    await expect(card.getByRole("button", { name: /采纳所选/ })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "接受第 1 处修改" })).toBeDisabled();
    await expect(card.locator(".tp-protect.is-violated")).toHaveText("78.2%");
  });

  test("过期候选不提供采纳，只提供基于当前版本重新生成", async ({ page }) => {
    await open(page, "/domain");
    const card = page.locator("#revision").getByRole("article", { name: /统一 3\.1 节的术语写法/ });
    await expect(card.getByText("已过期")).toBeVisible();
    await expect(card.getByRole("button", { name: /采纳所选/ })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "基于 v13 重新生成" })).toBeVisible();
  });

  test("任务只能由学生确认：确认后出现印章，已确认计数 +1", async ({ page }) => {
    await open(page, "/domain");
    const section = page.locator("#task");
    await expect(section.getByText("已确认 2 / 5")).toBeVisible();
    const task = section.getByRole("article").filter({ hasText: "完成第 3 章「系统设计」初稿" });
    await task.getByRole("button", { name: "确认完成" }).click();
    await expect(task.locator(".tp-seal", { hasText: "已确认" })).toBeVisible();
    await expect(section.getByText("已确认 3 / 5")).toBeVisible();
  });

  test("计划调整候选：采纳前是铅笔条，采纳后落墨；保留原计划则铅笔条消失", async ({ page }) => {
    await open(page, "/domain");
    const section = page.locator("#plan");
    await expect(section.locator(".tp-plan__bar--pencil")).toHaveCount(4);
    await section.getByRole("button", { name: "采纳调整" }).click();
    await expect(section.locator(".tp-plan__bar--pencil")).toHaveCount(0);
    await expect(section.getByText("已采纳 · 计划 v4 → v5")).toBeVisible();
    await section.getByRole("button", { name: "重置" }).click();
    await section.getByRole("button", { name: "保留原计划" }).click();
    await expect(section.locator(".tp-plan__bar--pencil")).toHaveCount(0);
    await expect(section.locator(".tp-plan__bar--was")).toHaveCount(0);
  });

  test("评审报告在正文更新后标记为“基于旧稿”", async ({ page }) => {
    await open(page, "/domain");
    const section = page.locator("#review");
    const badge = section.locator(".tp-status", { hasText: "基于旧稿" });
    await expect(badge).toHaveCount(0);
    await section.getByRole("radio", { name: "正文已更新到 v14" }).click();
    await expect(badge).toHaveText("基于旧稿 · 当前 v14");
    await expect(section.locator(".tp-stale")).toHaveCount(1);
  });
});

test.describe("基础组件", () => {
  test("表单校验：空提交给出可执行的错误；修正后通过", async ({ page }) => {
    await open(page, "/components");
    const form = page.locator("#forms form");
    await form.getByRole("button", { name: "创建项目" }).click();
    await expect(form.getByRole("alert").filter({ hasText: "请填写论文题目" })).toBeVisible();
    await expect(form.getByRole("alert").filter({ hasText: "请选择论文提交截止日期" })).toBeVisible();
    await form.getByLabel("论文题目").fill("太短");
    await form.getByLabel("论文题目").blur();
    await expect(form.getByRole("alert").filter({ hasText: "题目至少 6 个字" })).toBeVisible();
    await form.getByLabel("论文题目").fill("校园二手交易平台的推荐算法设计与实现");
    await form.getByLabel("论文提交截止").fill("2027-05-20");
    await form.getByRole("button", { name: "创建项目" }).click();
    await expect(form.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "表单校验通过" })).toBeVisible();
  });

  test("对话框：焦点进入、Tab 不逃出、Esc 关闭后焦点回到触发按钮", async ({ page }) => {
    await open(page, "/components");
    const trigger = page.locator("#feedback").getByRole("button", { name: "对话框", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "正文已经更新" });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("分段选择可以用方向键操作", async ({ page }) => {
    await open(page, "/components");
    const group = page.getByRole("radiogroup", { name: "AI 模式" });
    await group.getByRole("radio", { name: "综合助手" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(group.getByRole("radio", { name: "专业助手" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("当前：多个专业助手各自对话")).toBeVisible();
  });

  test("失败提示不会自动消失，并带下一步操作", async ({ page }) => {
    await open(page, "/components");
    await page.locator("#feedback").getByRole("button", { name: "失败", exact: true }).click();
    const alert = page.getByRole("alert").filter({ hasText: "导出失败" });
    await expect(alert).toBeVisible();
    await page.waitForTimeout(5000);
    await expect(alert).toBeVisible();
    await alert.getByRole("button", { name: "重试" }).click();
    await expect(alert).toHaveCount(0);
  });

  test("仅图标的按钮都有可访问名称", async ({ page }) => {
    for (const route of ["/components", "/domain"]) {
      await open(page, route);
      const unnamed = await page
        .locator("button")
        .evaluateAll((nodes) =>
          nodes.filter((n) => !(n.textContent ?? "").trim() && !n.getAttribute("aria-label") && !n.getAttribute("title")).map((n) => n.outerHTML.slice(0, 120)),
        );
      expect(unnamed, route).toEqual([]);
    }
  });
});

test.describe("编辑器样张（Tiptap 3.33.1）", () => {
  test("可以输入、字数随之变化、撤销后恢复", async ({ page }) => {
    await open(page, "/domain");
    const editor = page.locator("#editor .ProseMirror");
    await editor.scrollIntoViewIfNeeded();
    const count = page.locator("#editor").getByText(/^\d[\d,]* 字$/);
    const before = await count.textContent();
    await editor.locator("p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type("新增一句用于测试的文字。");
    await expect(editor).toContainText("新增一句用于测试的文字。");
    await expect(count).not.toHaveText(before ?? "");
    await expect(page.locator("#editor").getByText("有未保存的修改")).toBeVisible();
    for (let i = 0; i < 30; i++) await page.keyboard.press("ControlOrMeta+z");
    await expect(editor).not.toContainText("新增一句用于测试的文字。");
    await expect(count).toHaveText(before ?? "");
  });

  test("可以插入表格并设置标题", async ({ page }) => {
    await open(page, "/domain");
    const root = page.locator("#editor");
    const editor = root.locator(".ProseMirror");
    await editor.scrollIntoViewIfNeeded();
    await expect(editor.locator("table")).toHaveCount(1);
    await editor.locator("p").last().click();
    await root.getByRole("button", { name: "插入表格" }).click();
    await expect(editor.locator("table")).toHaveCount(2);
    await editor.locator("p").first().click();
    await root.getByRole("button", { name: "1 级标题" }).click();
    await expect(editor.locator("h1")).toHaveCount(1);
  });

  test("数字与引用被标为受保护对象（视觉示意）", async ({ page }) => {
    await open(page, "/domain");
    const editor = page.locator("#editor .ProseMirror");
    await expect(editor.locator('.tp-protect[data-kind="number"]', { hasText: "71.4%" }).first()).toBeVisible();
    await expect(editor.locator('.tp-protect[data-kind="citation"]', { hasText: "[7]" })).toBeVisible();
  });
});
