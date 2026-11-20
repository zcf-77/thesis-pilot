import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { panelMotionHooks } from "../../src/lab/components/integration/motion.ts";

class TestElement {
  inert = false;
  private attributes = new Map<string, string>();
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
}

const original = globalThis.HTMLElement;
beforeEach(() => {
  globalThis.HTMLElement = TestElement as unknown as typeof HTMLElement;
});
afterEach(() => {
  globalThis.HTMLElement = original;
});

describe("面板退出时的可访问性", () => {
  it("离场立即 inert 且退出无障碍树，结束后恢复原状态", () => {
    const element = new TestElement() as unknown as HTMLElement;
    panelMotionHooks.onBeforeLeave(element);
    expect(element.inert).toBe(true);
    expect(element.getAttribute("aria-hidden")).toBe("true");
    panelMotionHooks.onAfterLeave(element);
    expect(element.inert).toBe(false);
    expect(element.getAttribute("aria-hidden")).toBeNull();
  });

  it("快速取消离场时保留已有的无障碍隐藏状态", () => {
    const element = new TestElement() as unknown as HTMLElement;
    element.inert = true;
    element.setAttribute("aria-hidden", "false");
    panelMotionHooks.onBeforeLeave(element);
    panelMotionHooks.onLeaveCancelled(element);
    expect(element.inert).toBe(true);
    expect(element.getAttribute("aria-hidden")).toBe("false");
  });
});
