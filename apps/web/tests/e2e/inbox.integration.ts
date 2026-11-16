import { expect, test, type Page } from "@playwright/test";

const day = (offset: number) => {
  const date = new Date(Date.now() + offset * 86400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
};

async function api(page: Page, method: string, path: string, data?: unknown) {
  const origin = new URL(page.url()).origin;
  const response = await page.request.fetch(`/api/v1${path}`, { method, data, headers: { Origin: origin } });
  expect(response.ok(), `${method} ${path} → ${response.status()}`).toBe(true);
  return response.status() === 204 ? undefined : response.json();
}

test("真实任务与截止事实生成持久提醒：查看、补充线下进展、延后、忽略与放回", async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByLabel("工作区访问口令").fill(process.env.TP_WORKSPACE_TEST_ACCESS_KEY!);
  await page.getByRole("button", { name: "解锁工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();

  // 静默时段会让新提醒只记录不计未读；本用例临时关闭静默窗口，结束时还原原偏好。
  const session = await api(page, "GET", "/workspace/session");
  const original = session.profile;
  const quietOff = await api(page, "PATCH", "/workspace/profile", {
    expected_version: original.version,
    display_name: original.display_name,
    notifications_enabled: true,
    quiet_start: "00:00",
    quiet_end: "00:00",
    show_deferred: false,
  });
  try {
    const suffix = crypto.randomUUID().slice(0, 8);
    const project = await api(page, "POST", "/projects", { name: `合成提醒 ${suffix}`, deadline: day(10) });
    const root = `/projects/${project.id}`;
    const board = (await api(page, "GET", `${root}/tasks`)).board_version;
    const overdue = await api(page, "POST", `${root}/tasks`, {
      command_id: crypto.randomUUID(),
      expected_board_version: board,
      content: { title: `整理合成实验记录 ${suffix}`, acceptance: "记录可复核", due_date: day(-3) },
    });
    await api(page, "POST", `${root}/tasks`, {
      command_id: crypto.randomUUID(),
      expected_board_version: board + 1,
      content: { title: `合成章节草稿 ${suffix}`, acceptance: "章节可审阅", hard_deadline: day(1) },
    });

    await page.goto(`/#/projects/${project.id}/write`);
    const bell = page.getByRole("link", { name: /^收件箱/ });
    await expect(bell).toHaveAccessibleName("收件箱，3 条未读提醒");
    await bell.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/inbox$`));
    const cards = page.locator(".inbox-notice");
    await expect(cards).toHaveCount(3);
    const late = cards.filter({ hasText: `留意「整理合成实验记录 ${suffix}」的期限` });
    await expect(late).toContainText("触发");
    await expect(late).toContainText(`预计完成 ${day(-3)} · 已过 3 天`);
    await expect(late).toContainText("尚未确认不等于没有工作");
    await expect(page.locator('select, input[type="date"], input[type="datetime-local"]')).toHaveCount(0);

    // 补充线下进展：Esc 取消不写入；Ctrl+Enter 保存原话且不确认任务。
    await late.getByRole("button", { name: "补充线下进展", exact: true }).click();
    const note = late.getByLabel("线下进展");
    await note.fill("临时输入");
    await note.press("Escape");
    await expect(note).toHaveCount(0);
    await late.getByRole("button", { name: "补充线下进展", exact: true }).click();
    await late.getByLabel("线下进展").fill("已在实验室完成两组合成对照，数据待整理");
    const saved = page.waitForResponse((r) => r.url().endsWith("/progress-notes") && r.request().method() === "POST");
    await late.getByLabel("线下进展").press("Control+Enter");
    expect((await saved).status()).toBe(200);
    await expect(late).toContainText("我的补充");
    await expect(late).toContainText("已读");
    await expect(bell).toHaveAccessibleName("收件箱，2 条未读提醒");
    expect((await api(page, "GET", `${root}/tasks/${overdue.id}`)).status).toBe("todo");

    // 延后：TpDatePicker 预填明天 09:00；保存后切到已延后，放回待留意恢复。
    const soon = cards.filter({ hasText: `合成章节草稿 ${suffix}` });
    await soon.getByRole("button", { name: "延后", exact: true }).click();
    await soon.getByRole("button", { name: "保存延后时间", exact: true }).click();
    await expect(page.getByRole("tab", { name: "已延后" })).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/tab=snoozed/);
    const snoozed = page.locator(".inbox-notice").filter({ hasText: `合成章节草稿 ${suffix}` });
    await expect(snoozed).toContainText("延后至");
    await snoozed.getByRole("button", { name: "放回待留意", exact: true }).click();
    await expect(snoozed).toHaveCount(0);

    // 忽略后刷新不再生成；在已忽略中可放回。
    await page.getByRole("tab", { name: "待留意" }).click();
    const deadline = page.locator(".inbox-notice").filter({ hasText: "论文提交截止临近" });
    await deadline.getByRole("button", { name: "忽略", exact: true }).click();
    await expect(deadline).toHaveCount(0);
    expect((await api(page, "POST", `${root}/notifications/refresh`)).created).toBe(0);
    await page.getByRole("tab", { name: "已忽略" }).click();
    await expect(page.locator(".inbox-notice").filter({ hasText: "论文提交截止临近" })).toHaveCount(1);

    await page.getByRole("tab", { name: "操作记录" }).click();
    const history = page.locator(".studio-history-row");
    await expect(history.filter({ hasText: "补充线下进展" })).toContainText("已在实验室完成两组合成对照");
    await expect(history.filter({ hasText: "忽略提醒" })).toHaveCount(1);

    // 查看并处理：标记已读并深链到任务。
    await page.getByRole("tab", { name: "待留意" }).click();
    await page
      .locator(".inbox-notice")
      .filter({ hasText: `合成章节草稿 ${suffix}` })
      .getByRole("button", { name: "查看并处理", exact: true })
      .click();
    await expect(page).toHaveURL(/\/tasks\?task=/);
    await expect(bell).toHaveAccessibleName("收件箱");
  } finally {
    await api(page, "PATCH", "/workspace/profile", {
      expected_version: quietOff.version,
      display_name: original.display_name,
      notifications_enabled: original.notifications_enabled,
      quiet_start: original.quiet_start,
      quiet_end: original.quiet_end,
      show_deferred: original.show_deferred,
    });
  }
});
