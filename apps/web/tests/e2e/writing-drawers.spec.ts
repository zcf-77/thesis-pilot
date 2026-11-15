import { expect, test, type Locator, type Page } from "@playwright/test";
import { appUrl } from "./app-url.ts";

const paper = (page: Page) => page.getByLabel("论文正文编辑区", { exact: true });
const preset = (page: Page) => page.getByRole("button", { name: /^外观/ });
const drawers = {
  outline: { label: "章节目录", close: "关闭章节目录", surface: ".write-outline" },
  assistant: { label: "写作副驾", close: "关闭副驾抽屉", surface: ".write-copilot" },
  formal: { label: "修订与版本", close: "关闭副驾抽屉", surface: ".write-copilot" },
};

async function narrow(page: Page, reducedMotion: "reduce" | "no-preference") {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion });
}

async function waitForDrawerMotion(drawer: Locator) {
  await drawer.evaluate(async (modal) => {
    await new Promise<void>((ready) => requestAnimationFrame(() => requestAnimationFrame(() => ready())));
    const running = modal.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.allSettled(running.map((animation) => animation.finished));
  });
}

async function openByKeyboard(page: Page, label: string) {
  const opener = page.getByRole("radio", { name: label, exact: true });
  await opener.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: label, exact: true });
  await expect(drawer).toBeVisible();
  await expect.poll(() => drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  return { opener, drawer };
}

interface MotionSample {
  durations: number[];
  opacity: boolean;
  moved: boolean;
}

async function observeDrawerMotion(page: Page, selector: string) {
  return page.evaluateHandle((selector) => {
    const probe = { durations: [] as number[], opacity: false, moved: false, frame: 0 };
    let first: DOMRect | undefined;
    const sample = () => {
      const modal = document.querySelector("dialog:modal");
      const surface = modal?.matches(selector) ? modal : modal?.querySelector(selector);
      if (modal && surface) {
        const box = surface.getBoundingClientRect();
        if (first) {
          if ([box.x - first.x, box.y - first.y, box.width - first.width, box.height - first.height].some((delta) => Math.abs(delta) > 0.5)) probe.moved = true;
        } else first = box;
        for (const target of new Set([modal, surface])) {
          for (const animation of target.getAnimations()) {
            if (!(animation.effect instanceof KeyframeEffect)) continue;
            const duration = animation.effect.getComputedTiming().duration;
            if (typeof duration === "number" && duration > 0) probe.durations.push(duration);
            if (animation.effect.getKeyframes().some((keyframe) => "opacity" in keyframe)) probe.opacity = true;
          }
        }
      }
      probe.frame = requestAnimationFrame(sample);
    };
    sample();
    return probe;
  }, selector);
}

async function leavingFocusProbe(drawer: Locator, closeLabel: string) {
  return drawer.evaluateHandle((modal, label) => {
    const close = [...modal.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === label)!;
    const observed = { mountedInert: false, focusBlocked: false };
    const observer = new MutationObserver(() => {
      if (!modal.isConnected || !modal.contains(close.closest("[inert]"))) return;
      observer.disconnect();
      observed.mountedInert = true;
      close.focus();
      observed.focusBlocked = document.activeElement !== close;
    });
    observer.observe(modal, { attributes: true, subtree: true, attributeFilter: ["inert"] });
    return observed;
  }, closeLabel);
}

for (const [theme, themeId] of [
  ["晨雾", "chenwu"],
  ["夜航", "yehang"],
  ["荧光笔记", "yingguang"],
  ["朱墨", "zhumo"],
] as const) {
  test(theme + "窄屏的目录和副驾抽屉遮挡背景并保留焦点边界", async ({ page }) => {
    const reduced = themeId === "chenwu";
    await narrow(page, reduced ? "reduce" : "no-preference");
    await page.goto(appUrl("/screens/write"));
    await expect(paper(page)).toBeVisible();
    await preset(page).click();
    await page.getByRole("button", { name: "切换到方案：" + theme, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", themeId);
    await preset(page).click();
    if (reduced) await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");

    const behind = await paper(page).elementHandle();
    const dock = await preset(page).elementHandle();
    for (const configuration of [drawers.outline, drawers.assistant]) {
      const probe = reduced ? await observeDrawerMotion(page, configuration.surface) : null;
      const { opener, drawer } = await openByKeyboard(page, configuration.label);
      await waitForDrawerMotion(drawer);
      if (probe) {
        const measured: MotionSample = await probe.evaluate((result) => {
          cancelAnimationFrame(result.frame);
          return { durations: result.durations, opacity: result.opacity, moved: result.moved };
        });
        expect(measured.durations.length).toBeGreaterThan(0);
        expect(measured.durations.every((duration) => duration <= 120)).toBe(true);
        expect(measured).toMatchObject({ opacity: true, moved: false });
        await probe.dispose();
      }

      const paint = await drawer.evaluate(
        (modal, { surfaceSelector, dock }) => {
          const surface = modal.matches(surfaceSelector) ? modal : modal.querySelector(surfaceSelector)!;
          const panel = surface.getBoundingClientRect();
          const appearance = dock.getBoundingClientRect();
          const left = Math.max(panel.left, appearance.left);
          const right = Math.min(panel.right, appearance.right);
          const top = Math.max(panel.top, appearance.top);
          const bottom = Math.min(panel.bottom, appearance.bottom);
          const overlaps = right > left && bottom > top;
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const pixel = canvas.getContext("2d")!;
          for (let layer: Element | null = surface; layer && modal.contains(layer); layer = layer.parentElement) {
            pixel.fillStyle = "transparent";
            pixel.fillStyle = getComputedStyle(layer).backgroundColor;
            pixel.fillRect(0, 0, 1, 1);
          }
          const opaque = pixel.getImageData(0, 0, 1, 1).data[3] === 255;
          pixel.clearRect(0, 0, 1, 1);
          pixel.fillStyle = "transparent";
          pixel.fillStyle = getComputedStyle(modal.querySelector(".write-drawer-backdrop")!).backgroundColor;
          pixel.fillRect(0, 0, 1, 1);
          return {
            modal: modal.matches(":modal"),
            opaque,
            backdropAlpha: pixel.getImageData(0, 0, 1, 1).data[3],
            aboveAppearance: !overlaps || modal.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2)),
            withinViewport: panel.left >= 0 && panel.top >= 0 && panel.right <= innerWidth + 0.5 && panel.bottom <= innerHeight + 0.5,
            overflow: document.documentElement.scrollWidth - innerWidth,
          };
        },
        { surfaceSelector: configuration.surface, dock: dock! },
      );
      expect(paint).toMatchObject({ modal: true, opaque: true, aboveAppearance: true, withinViewport: true });
      expect(paint.backdropAlpha).toBeGreaterThan(0);
      expect(paint.overflow).toBeLessThanOrEqual(1);

      const close = drawer.getByRole("button", { name: configuration.close, exact: true });
      const hitArea = await close.boundingBox();
      expect(hitArea).not.toBeNull();
      expect(hitArea!.width).toBeGreaterThanOrEqual(36);
      expect(hitArea!.height).toBeGreaterThanOrEqual(36);
      await page.keyboard.press("Tab");
      await expect.poll(() => drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      expect(
        await drawer.evaluate((modal, editor) => {
          editor.focus();
          return modal.contains(document.activeElement);
        }, behind!),
      ).toBe(true);

      const leaving = await leavingFocusProbe(drawer, configuration.close);
      await page.keyboard.press("Escape");
      await expect.poll(() => leaving.jsonValue()).toEqual({ mountedInert: true, focusBlocked: true });
      await expect(opener).toBeFocused();
      await expect(drawer).toHaveCount(0);
      await leaving.dispose();

      // Reopen on the first available trigger after exit, then dismiss via the actual backdrop.
      await page.keyboard.press("Enter");
      await expect(drawer).toBeVisible();
      await waitForDrawerMotion(drawer);
      await expect(drawer.getByRole("button", { name: configuration.close, exact: true })).toBeEnabled();
      await page.mouse.click(3, 3);
      await expect(opener).toBeFocused();
      await expect(drawer).toHaveCount(0);
    }
  });
}

test("窄屏抽屉和稿源切换保留同一编辑器、独立草稿及正式稿撤销历史", async ({ page }) => {
  test.skip(process.env.TP_WRITING_DRAWERS_MOCK_E2E !== "1", "需要显式 Mock 模式构建验证正式稿。");
  await narrow(page, "reduce");
  await page.goto(appUrl("/screens/projects"));
  const projects = page.getByTestId("service-projects");
  await projects.getByRole("button", { name: "新建项目", exact: true }).click();
  await projects.getByRole("textbox", { name: "项目名称" }).fill("抽屉保留草稿回归样例");
  await projects.getByRole("button", { name: "保存名称", exact: true }).click();
  await projects.getByTestId("service-project-card").getByRole("button", { name: "打开工作区", exact: true }).click();

  const original = "本机原稿与正式稿的共同起点。";
  const formalDraft = "正式稿尚未提交的编辑。";
  const localDraft = "单独保留的本机编辑。";
  const local = page.getByRole("radio", { name: "本机原稿", exact: true });
  const formal = page.getByRole("radio", { name: "正式稿", exact: true });
  const editor = paper(page);
  const identity = await editor.elementHandle();
  await editor.fill(original);
  await formal.click();
  await page.getByRole("button", { name: "导入本机正文", exact: true }).click();
  await expect(page.locator(".screens-topbar")).toContainText("正式稿 v1");
  await editor.fill(formalDraft);
  await expect(page.locator(".screens-topbar")).toContainText("正式稿有未保存修改");

  const actions = await openByKeyboard(page, drawers.formal.label);
  await actions.drawer.getByRole("tab", { name: "版本", exact: true }).click();
  await expect(actions.drawer.locator(".tp-vt")).toContainText("v1");
  await actions.drawer.getByRole("tab", { name: "修订", exact: true }).click();
  await expect(actions.drawer.getByRole("textbox", { name: "修改目标", exact: true })).toBeVisible();
  await actions.drawer.getByRole("button", { name: drawers.formal.close, exact: true }).click();
  await expect(actions.opener).toBeFocused();
  const outline = await openByKeyboard(page, drawers.outline.label);
  await outline.drawer.getByRole("button", { name: drawers.outline.close, exact: true }).click();
  await expect(outline.opener).toBeFocused();
  await expect(editor).toContainText(formalDraft);

  await local.click();
  await expect(editor).toContainText(original);
  await editor.fill(localDraft);
  const assistant = await openByKeyboard(page, drawers.assistant.label);
  await page.keyboard.press("Escape");
  await expect(assistant.opener).toBeFocused();
  await formal.click();
  await expect(editor).toContainText(formalDraft);
  expect(await editor.evaluate((current, original) => current === original, identity!)).toBe(true);
  await editor.press("ControlOrMeta+z");
  await expect(editor).toContainText(original);
  await editor.press("ControlOrMeta+Shift+z");
  await expect(editor).toContainText(formalDraft);
  await expect(page.locator(".screens-topbar")).toContainText("基于正式稿 v1");

  await local.click();
  await expect(editor).toContainText(localDraft);
  expect(await editor.evaluate((current, original) => current === original, identity!)).toBe(true);
});
