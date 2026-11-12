import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "./app-url.ts";
import { openSelect } from "./select-option.ts";

test("自定义选择框支持方向键、禁用项和取消，原生下拉不再出现", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(appUrl("/components"));
  const trigger = page.getByRole("combobox", { name: "流程版本", exact: true });
  await expect(page.locator("select")).toHaveCount(0);
  await expect(trigger).toHaveAttribute("data-value", "flow-v3");
  await trigger.focus();
  const opening = await measureMotion(page, ".tp-select__popover:popover-open", "", async () => {
    await trigger.press("Enter");
  });
  expect(opening.records.some((record) => record.duration > 0 && record.properties.includes("opacity"))).toBe(true);
  const listbox = await openSelect(trigger);
  await expect(listbox.getByRole("option", { name: "示例流程 · v1（已停用）", exact: true })).toBeDisabled();
  await trigger.press("End");
  await trigger.press("Enter");
  await expect(trigger).toHaveAttribute("data-value", "flow-v2");
  await expect(trigger).toBeFocused();

  await trigger.press("Enter");
  await trigger.press("ArrowDown");
  await expect(listbox.locator('[data-value="flow-v3"]')).toHaveClass(/is-active/);
  await expect(listbox.locator('[data-value="flow-v2"]')).toHaveAttribute("aria-selected", "true");
  await trigger.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toHaveAttribute("data-value", "flow-v2");
  await expect(trigger).toBeFocused();
});

test("配置选择框搜索无结果可恢复，Esc先关闭选项并保留编辑草稿", async ({ page }) => {
  await page.goto(appUrl("/screens/settings"));
  await page.getByRole("button", { name: "编辑配置", exact: true }).click();
  const draft = page.getByRole("textbox", { name: "配置名称", exact: true });
  await draft.fill("暂未保存的智能体名称");
  const trigger = page.getByRole("combobox", { name: "关联模型", exact: true });
  const before = await trigger.getAttribute("data-value");
  const listbox = await openSelect(trigger);
  const popup = listbox.locator("..");
  await popup.getByRole("searchbox", { name: "搜索选项", exact: true }).fill("并不存在的模型代号-98765");
  await expect(listbox.getByRole("option")).toHaveCount(0);
  await expect(listbox.getByRole("status")).toContainText("没有匹配的选项");
  await listbox.getByRole("button", { name: "清空搜索", exact: true }).click();
  await expect(listbox.getByRole("option").first()).toBeVisible();
  const search = popup.getByRole("searchbox", { name: "搜索选项", exact: true });
  await search.fill("键盘清空无结果-98765");
  await expect(listbox.getByRole("option")).toHaveCount(0);
  const emptyClear = listbox.getByRole("button", { name: "清空搜索", exact: true });
  await emptyClear.focus();
  await emptyClear.press("Enter");
  await expect(search).toHaveValue("");
  await expect(listbox.getByRole("option").first()).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(trigger).toHaveAttribute("data-value", before!);
  await search.fill("键盘清空搜索栏-98765");
  const searchClear = popup.getByRole("button", { name: "清空选项搜索", exact: true });
  await searchClear.focus();
  await searchClear.press("Space");
  await expect(search).toHaveValue("");
  await expect(listbox.getByRole("option").first()).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(trigger).toHaveAttribute("data-value", before!);
  await popup.getByRole("searchbox", { name: "搜索选项", exact: true }).press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toHaveAttribute("data-value", before!);
  await expect(draft).toHaveValue("暂未保存的智能体名称");
  await expect(page.getByRole("button", { name: "保存配置", exact: true })).toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.press("Escape");
  await expect(draft).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "综合助手", exact: true })).toBeVisible();
});

for (const [theme, name] of [
  ["zhumo", "朱墨"],
  ["yingguang", "荧光笔记"],
  ["yehang", "夜航"],
  ["chenwu", "晨雾"],
]) {
  test(`390px自定义选项浮层不越界并继承${name}主题`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(appUrl("/screens/projects"));
    await page.getByRole("button", { name: /^外观/ }).click();
    await page.getByRole("button", { name: `切换到方案：${name}`, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.getByRole("button", { name: /^外观/ }).click();
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    const trigger = page.getByRole("combobox", { name: "当前阶段", exact: true });
    const listbox = await openSelect(trigger);
    const popup = listbox.locator("..");
    await expect(popup).toHaveAttribute("data-theme", theme);
    await popup.evaluate(async (element) => {
      await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
    });
    const bounds = await popup.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    for (const property of ["--tp-surface-raised", "--tp-text", "--tp-radius-m"]) {
      const fromTrigger = await trigger.evaluate((element, prop) => getComputedStyle(element).getPropertyValue(prop).trim(), property);
      const fromPopup = await popup.evaluate((element, prop) => getComputedStyle(element).getPropertyValue(prop).trim(), property);
      expect(fromPopup).toBeTruthy();
      expect(fromPopup).toBe(fromTrigger);
    }
    await expect(page.locator('select, input[type="date"], input[type="time"], input[type="datetime-local"]')).toHaveCount(0);
    await trigger.press("Escape");
    await expect(page.getByRole("heading", { name: "开始一个新项目", exact: true })).toBeVisible();
  });
}

test("自绘日历可跨月查看和选择日期，取消不改原输入或关闭表单", async ({ page }) => {
  await page.goto(appUrl("/screens/projects"));
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const input = page.getByRole("textbox", { name: "重要截止日期", exact: true });
  await input.fill("2026-11-14");
  const trigger = input.locator("..").getByRole("button", { name: "打开日期选择器", exact: true });
  await trigger.click();
  const calendar = page.getByRole("dialog", { name: "选择日期", exact: true });
  await expect(calendar.getByRole("gridcell", { name: "2026-11-14", exact: true })).toHaveAttribute("aria-selected", "true");
  await calendar.getByRole("gridcell", { name: "2026-11-20", exact: true }).click();
  await expect(input).toHaveValue("2026-11-20");
  await expect(calendar).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await calendar.getByRole("button", { name: "下个月", exact: true }).click();
  await expect(calendar).toContainText("2026 年 12 月");
  await page.keyboard.press("Escape");
  await expect(calendar).toBeHidden();
  await expect(input).toHaveValue("2026-11-20");
  await expect(page.getByRole("heading", { name: "开始一个新项目", exact: true })).toBeVisible();
});

test("自绘时间选项在点击应用前保留原值，应用后保存小时与分钟", async ({ page }) => {
  await page.goto(appUrl("/screens/account"));
  const input = page.getByRole("textbox", { name: "静默开始", exact: true });
  await input.fill("23:00");
  await input.locator("..").getByRole("button", { name: "打开时间选择器", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "选择时间", exact: true });
  await picker.getByRole("listbox", { name: "小时", exact: true }).getByRole("option", { name: "09", exact: true }).click();
  await picker.getByRole("listbox", { name: "分钟", exact: true }).getByRole("option", { name: "30", exact: true }).click();
  await expect(input).toHaveValue("23:00");
  await picker.getByRole("button", { name: "应用时间", exact: true }).click();
  await expect(input).toHaveValue("09:30");
  await expect(picker).toBeHidden();
});

interface MotionRecord {
  duration: number;
  properties: string[];
}
interface MotionProbe {
  records: MotionRecord[];
  samples: number;
  moved: boolean;
  raf: number;
}

/** Sample running browser animations during the real action; no classes or animations are injected. */
async function measureMotion(page: Page, selector: string, text: string, action: () => Promise<void>): Promise<Omit<MotionProbe, "raf">> {
  await page.evaluate(
    ({ selector, text }) => {
      const probe: MotionProbe = { records: [], samples: 0, moved: false, raf: 0 };
      (window as Window & { __tpMotionProbe?: MotionProbe }).__tpMotionProbe = probe;
      function sample() {
        for (const element of document.querySelectorAll<HTMLElement>(selector)) {
          if (text && !element.textContent?.includes(text)) continue;
          probe.samples += 1;
          const transform = getComputedStyle(element).transform;
          if (transform !== "none" && !new DOMMatrix(transform).isIdentity) probe.moved = true;
          for (const animation of element.getAnimations()) {
            if (!(animation.effect instanceof KeyframeEffect)) continue;
            const duration = animation.effect.getComputedTiming().duration;
            if (typeof duration !== "number") continue;
            const properties = [...new Set(animation.effect.getKeyframes().flatMap((frame) => Object.keys(frame)))];
            probe.records.push({ duration, properties });
          }
        }
        probe.raf = requestAnimationFrame(sample);
      }
      sample();
    },
    { selector, text },
  );
  await action();
  const target = page.locator(selector).filter({ hasText: text }).first();
  await target.waitFor({ state: "visible" });
  await target.evaluate(async (element) => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
  });
  return page.evaluate(() => {
    const scope = window as Window & { __tpMotionProbe?: MotionProbe };
    const probe = scope.__tpMotionProbe!;
    cancelAnimationFrame(probe.raf);
    delete scope.__tpMotionProbe;
    return { records: probe.records, samples: probe.samples, moved: probe.moved };
  });
}

for (const motion of ["full", "reduced"] as const) {
  test(`项目表单和新增卡片实际播放${motion === "full" ? "完整" : "减弱"}动效`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(appUrl("/screens/projects"));
    if (motion === "reduced") {
      await page.getByRole("button", { name: /^外观/ }).click();
      await page.getByRole("button", { name: "切换为减弱动效", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
      await page.getByRole("button", { name: /^外观/ }).click();
    }
    const formMotion = await measureMotion(page, ".screen-page form", "开始一个新项目", async () => {
      await page.getByRole("button", { name: "新建项目", exact: true }).click();
    });
    const deadline = page.getByRole("textbox", { name: "重要截止日期", exact: true });
    const calendarMotion = await measureMotion(page, ".tp-date-panel:popover-open", "", async () => {
      await deadline.locator("..").getByRole("button", { name: "打开日期选择器", exact: true }).click();
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "开始一个新项目", exact: true })).toBeVisible();
    const title = `控件动效验证项目-${motion}`;
    await page.getByRole("textbox", { name: "论文题目", exact: true }).fill(title);
    const listMotion = await measureMotion(page, ".studio-grid > article", title, async () => {
      await page.getByRole("button", { name: "从空白文稿开始", exact: true }).click();
    });
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    for (const observed of [formMotion, calendarMotion, listMotion]) {
      expect(observed.samples).toBeGreaterThan(0);
      expect(observed.records.some((record) => record.duration > 0 && record.properties.includes("opacity"))).toBe(true);
      if (motion === "reduced") {
        expect(observed.records.every((record) => record.duration <= 120)).toBe(true);
        expect(observed.moved).toBe(false);
      }
    }
  });
}
