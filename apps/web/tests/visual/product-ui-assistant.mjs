import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const origin = process.env.TP_ASSISTANT_TEST_ORIGIN || "http://127.0.0.1:7100";
const output = path.resolve("test-results/product-ui-assistant");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const checks = [];
page.on("pageerror", (error) => errors.push(error.message));
const record = (name, detail = "通过") => checks.push({ name, detail });
const fixture = () => page.evaluate(() => window.__assistantFixture.state());
async function scenario(value) {
  await page.evaluate((next) => window.__assistantFixture.setScenario(next), value);
  await page.waitForTimeout(100);
}
async function theme(value) {
  await page.evaluate((next) => window.__assistantFixture.setTheme(next), value);
  await page.evaluate(() => document.fonts.ready);
}
async function motion(value) {
  await page.evaluate((next) => window.__assistantFixture.setMotion(next), value);
}
async function chooseSession(name) {
  await page.getByRole("combobox", { name: "当前内容会话", exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
}
async function animations() {
  return page.evaluate(() =>
    document.getAnimations().map((animation) => {
      const timing = animation.effect?.getTiming();
      return { target: animation.effect?.target?.className ?? "", duration: Number(timing?.duration ?? 0) };
    }),
  );
}

try {
  await page.goto(`${origin}/tests/visual/product-ui-assistant.html`);
  await expect(page.getByRole("region", { name: "内容助手", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "候选审阅", exact: true })).toBeVisible();
  await expect(page.locator(".assistant-session.screen-panel")).toHaveCount(0);
  record("默认层级", "当前对话、运行与候选同屏，无嵌套会话卡片");

  const review = page.getByRole("region", { name: "候选审阅", exact: true });
  await review.getByRole("button", { name: "接受", exact: true }).first().click();
  await expect(review.getByText("已接受，尚未写入", { exact: true })).toBeVisible();
  expect((await fixture()).counters.apply).toBe(0);
  await review.getByRole("button", { name: "采纳所选（1）", exact: true }).click();
  await expect(review.locator(".candidate-review__head")).toContainText("已采纳");
  expect((await fixture()).counters.apply).toBe(1);
  expect((await fixture()).version).toBe(4);
  await review.getByRole("button", { name: "撤销采纳", exact: true }).click();
  await expect(review.locator(".candidate-review__head")).toContainText("已撤销");
  expect((await fixture()).counters.undo).toBe(1);
  expect((await fixture()).version).toBe(5);
  record("逐项决定与受控写入", "接受不写稿；采纳 1 次；撤销 1 次；版本 3 → 4 → 5");

  await scenario("invalid");
  await expect(page.getByText("1 项检查需要处理", { exact: true })).toBeVisible();
  await expect(page.getByText("候选改变了实验数字 42，必须恢复原值。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "接受", exact: true }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: /采纳所选/ })).toBeDisabled();
  record("保护失败", "违规数字原因可见，对应接受与采纳不可用");

  await scenario("stale");
  await expect(page.getByText("已过期", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /采纳所选/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "返回对话重新选择", exact: true })).toBeVisible();
  record("陈旧候选", "保留两份内容说明，禁止覆盖并提供重新选择入口");

  await scenario("failed");
  await expect(page.locator(".assistant-run__error")).toBeVisible();
  await expect(page.getByText("MODEL_NOT_CONFIGURED", { exact: true })).toBeHidden();
  await page.getByText("错误详情", { exact: true }).click();
  await expect(page.getByText("MODEL_NOT_CONFIGURED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试固定输入", exact: true }).click();
  await expect(page.locator(".assistant-run")).toHaveAttribute("data-status", "queued");
  expect((await fixture()).counters.retry).toBe(1);
  await expect(page.locator(".assistant-pagination")).toContainText("/ 25");
  record("失败与重试", "默认显示可读原因，错误码进详情；重试不新增重复消息");

  await scenario("running");
  await expect(page.locator(".assistant-run")).toHaveAttribute("data-status", "running");
  await expect(page.locator(".tp-progress")).toHaveCount(0);
  await page.getByRole("button", { name: "取消运行", exact: true }).click();
  await expect(page.locator(".assistant-run")).toHaveAttribute("data-status", "cancelled");
  expect((await fixture()).counters.cancel).toBe(1);
  record("运行与取消", "只有真实状态，无伪造进度；服务端终态及时呈现");

  await scenario("ready");
  const composer = page.getByLabel("内容修订目标（本机草稿）", { exact: true });
  await composer.fill("甲会话的独立草稿");
  await chooseSession("文献综述讨论");
  await expect(page.getByRole("region", { name: "内容助手会话：文献综述讨论", exact: true })).toBeVisible();
  await page.getByLabel("内容修订目标（本机草稿）", { exact: true }).fill("乙会话的独立草稿");
  await chooseSession("第三章内容修订");
  await expect(page.getByLabel("内容修订目标（本机草稿）", { exact: true })).toHaveValue("甲会话的独立草稿");
  await page.reload();
  await expect(page.getByLabel("内容修订目标（本机草稿）", { exact: true })).toHaveValue("甲会话的独立草稿");
  record("独立草稿", "会话切换与刷新均恢复到对应会话，未发送内容不进入消息");

  await page.getByRole("button", { name: "上下文", exact: true }).click();
  await page.getByRole("combobox", { name: "内容助手版本", exact: true }).click();
  await page.getByRole("option", { name: "合成内容助手 · v1", exact: true }).click();
  await page.getByRole("checkbox", { name: "已核对本次版本与资料范围", exact: true }).check();
  const input = page.getByLabel("内容修订目标（本机草稿）", { exact: true });
  await input.fill("只调整论证衔接，保留全部数字与引用。");
  await input.press("Enter");
  await expect(page.locator(".assistant-run")).toHaveAttribute("data-status", "queued");
  const sent = await fixture();
  expect(sent.counters.createRun).toBe(1);
  expect(sent.lastInput.document_version).toBe(3);
  expect(sent.lastInput.selection.node_id).toBe("paragraph-a");
  expect(sent.lastInput.agent_config_version_id).toBe("99999999-9999-4999-8999-999999999999");
  record("固定上下文发送", "正文 v3、节点选区与配置版本进入同一次请求");

  await scenario("ready");
  const messageScroll = page.getByLabel("会话消息", { exact: true });
  const before = await messageScroll.evaluate((element) => element.scrollTop);
  await page.getByRole("button", { name: "更早消息", exact: true }).click();
  await expect(page.locator(".assistant-pagination")).toContainText("1–20 / 25");
  const after = await messageScroll.evaluate((element) => element.scrollTop);
  expect(after).toBeGreaterThan(before);
  record("长消息分页", "加载更早内容后按新增高度补偿滚动位置");

  const reviewTab = page.getByRole("radio", { name: /候选审阅/ });
  const conversationTab = page.getByRole("radio", { name: "当前对话", exact: true });
  await conversationTab.focus();
  await conversationTab.press("ArrowRight");
  await expect(reviewTab).toHaveAttribute("aria-checked", "true");
  await reviewTab.press("ArrowLeft");
  await expect(conversationTab).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: /候选审阅/ }).click();
  const fullAnimations = await animations();
  expect(fullAnimations.length).toBeGreaterThan(0);
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  await motion("reduced");
  await page.getByRole("radio", { name: "当前对话", exact: true }).click();
  const reducedAnimations = await animations();
  expect(reducedAnimations.length).toBeGreaterThan(0);
  expect(Math.max(...reducedAnimations.map((item) => item.duration))).toBeLessThanOrEqual(100);
  record("键盘与真实动效", "方向键切换；完整模式有过渡；减弱模式实际动画不超过 100ms");

  const themes = ["zhumo", "yingguang", "yehang", "chenwu"];
  for (const id of themes) {
    await theme(id);
    await scenario("ready");
    await motion("reduced");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("region", { name: "候选审阅", exact: true })).toBeVisible();
    const metrics = await page.evaluate(() => ({
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      panelWidth: document.querySelector(".assistant-harness__paper").scrollWidth,
      panelClient: document.querySelector(".assistant-harness__paper").clientWidth,
      theme: document.documentElement.dataset.theme,
      motion: document.documentElement.dataset.motion,
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.panelWidth).toBeLessThanOrEqual(metrics.panelClient + 1);
    expect(metrics.theme).toBe(id);
    expect(metrics.motion).toBe("reduced");
    await page.screenshot({ path: path.join(output, `${id}-390-ready.png`), fullPage: true, animations: "disabled" });
    record(`${id} / 390px`, "无页面或面板横向溢出，长消息与候选可读");
  }

  await writeFile(path.join(output, "results.json"), JSON.stringify({ origin, checks, errors }, null, 2) + "\n");
  expect(errors).toEqual([]);
  console.log(`PASS: ${checks.length} 项助手浏览器检查，四主题 390px 截图已保存。`);
  console.log(output);
} finally {
  await browser.close();
}
