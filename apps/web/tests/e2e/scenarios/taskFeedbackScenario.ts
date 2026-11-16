import { expect, type Locator, type Page } from "@playwright/test";

export async function runTaskFeedbackScenario(
  page: Page,
  options: { suffix: string; step?: (label: string) => Promise<void>; screenshot?: (name: string) => Promise<void> },
) {
  page.setDefaultTimeout(15000);
  const step = options.step ?? (async () => {});
  const shot = options.screenshot ?? (async () => {});
  async function choose(scope: Locator, label: string | RegExp, option: string | RegExp) {
    await scope.getByRole("combobox", { name: label }).click();
    await page.getByRole("option", { name: option, exact: typeof option === "string" }).click();
  }
  async function submit(button: Locator, method: string, path: string, status = 200) {
    await expect(button).toBeEnabled();
    const reply = page.waitForResponse((r) => r.request().method() === method && new URL(r.url()).pathname === path);
    await button.click();
    const response = await reply;
    expect(response.status()).toBe(status);
    return response.json();
  }
  const sample = "本研究采用合成案例验证方法甲，结果仅用于系统演示。";
  const updated = `${sample}补充方法核对记录。`;
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill(`合成任务反馈 ${options.suffix}`);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page).toHaveURL(/\/write$/);
  const projectId = page.url().match(/projects\/([^/]+)\/write/)![1]!;
  const root = `/api/v1/projects/${projectId}`;
  await page.getByRole("button", { name: "创建空白正式稿", exact: true }).click();
  const editor = page.locator('[aria-label="论文正文编辑区"][contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.fill(sample);
  const initial = await (await page.request.get(`${root}/documents/current`)).json();
  const saved = await submit(page.getByRole("button", { name: "保存", exact: true }), "PATCH", `${root}/documents/${initial.id}`);
  expect(saved.version).toBe(2);
  await page.getByRole("link", { name: "论文任务", exact: true }).click();
  await page.getByRole("button", { name: "新增任务", exact: true }).click();
  const form = page.getByRole("form", { name: "任务编辑器", exact: true });
  const detail = page.getByRole("complementary", { name: "任务详情", exact: true });
  const taskTitle = `核对合成方法 ${options.suffix}`;
  await form.getByLabel("任务标题").fill(taskTitle);
  await form.getByLabel("验收条件").fill("已保存的合成方法段落有明确版本与核对记录。");
  let task = await submit(form.getByRole("button", { name: "保存任务", exact: true }), "POST", `${root}/tasks`, 201);
  expect(task.needs_review).toBe(true);
  await expect(form).toBeHidden();
  await detail.getByRole("checkbox", { name: "我已核对任务标准与关联证据" }).check();
  await expect(detail.getByRole("button", { name: "确认任务完成", exact: true })).toBeDisabled();
  await step("独立创建任务；缺少真实产物证据时不能确认完成");
  async function addEvidence(scope: Locator, text: string) {
    await choose(scope, /正文证据段落/, new RegExp(text.slice(0, 12)));
    await scope.getByRole("button", { name: "选择整段作为证据", exact: true }).click();
    await scope.getByRole("button", { name: "添加正文选区证据", exact: true }).click();
  }
  await detail.getByRole("button", { name: "编辑任务", exact: true }).click();
  await addEvidence(form, sample);
  task = await submit(form.getByRole("button", { name: "保存任务", exact: true }), "PATCH", `${root}/tasks/${task.id}`);
  expect(task.evidence_snapshots[0].reference.version).toBe(2);
  await detail.getByRole("checkbox", { name: "我已核对任务标准与关联证据" }).check();
  task = await submit(detail.getByRole("button", { name: "确认任务完成", exact: true }), "POST", `${root}/tasks/${task.id}/decisions`);
  expect(task.status).toBe("confirmed");
  await expect(detail.getByText("学生已确认", { exact: true }).first()).toBeVisible();
  await step("明确关联已保存正文v2，学生确认后保留精确版本证据");
  await shot("task-confirmed");
  await page.getByRole("link", { name: "写作", exact: true }).click();
  await expect(editor).toBeVisible();
  await editor.fill(updated);
  const newer = await submit(page.getByRole("button", { name: "保存", exact: true }), "PATCH", `${root}/documents/${initial.id}`);
  expect(newer.version).toBe(3);
  await page.getByRole("link", { name: "论文任务", exact: true }).click();
  await expect(detail.getByText(/需复核：.*产物证据版本已变化/)).toBeVisible();
  await expect(page.getByRole("button", { name: `选择任务 ${taskTitle}`, exact: true })).toContainText("已确认 · 需复核");
  await step("正文更新为v3后，旧确认保留但证据明确要求复核");
  await detail.getByLabel("返工原因").fill("合成正文已更新，重新核对版本证据。");
  task = await submit(detail.getByRole("button", { name: "记录返工", exact: true }), "POST", `${root}/tasks/${task.id}/decisions`);
  expect(task.status).toBe("rework");
  await detail.getByRole("button", { name: "编辑任务", exact: true }).click();
  await form.getByRole("button", { name: "移除证据 1", exact: true }).click();
  await addEvidence(form, updated);
  task = await submit(form.getByRole("button", { name: "保存任务", exact: true }), "PATCH", `${root}/tasks/${task.id}`);
  await detail.getByRole("checkbox", { name: "我已核对任务标准与关联证据" }).check();
  task = await submit(detail.getByRole("button", { name: "确认任务完成", exact: true }), "POST", `${root}/tasks/${task.id}/decisions`);
  expect(task.status).toBe("confirmed");
  expect(task.evidence_snapshots[0].reference.version).toBe(3);
  await expect(detail.getByText("学生已确认", { exact: true }).first()).toBeVisible();
  await expect(detail.getByRole("button", { name: "历史关联（1）· 展开", exact: true })).toBeVisible();
  await detail.getByRole("button", { name: /历史关联/ }).click();
  await expect(detail.getByRole("button", { name: /^恢复关联：正式稿 v2/ })).toBeVisible();
  await page.getByRole("button", { name: /^任务历史/ }).click();
  await expect(page.getByRole("region", { name: "任务历史", exact: true })).toContainText("合成正文已更新");
  await step("返工原因和旧证据保留，重新选v3证据后再确认");
  await page.getByRole("link", { name: "反馈", exact: true }).click();
  await page.getByRole("button", { name: "粘贴导师反馈", exact: true }).click();
  const original = "【合成反馈】请核对方法段落，并说明本轮检查的依据。";
  await page.getByLabel("导师反馈原文", { exact: false }).fill(original);
  const batch = await submit(page.getByRole("button", { name: "保存反馈原文", exact: true }), "POST", `${root}/feedback`, 201);
  expect(batch.original_text).toBe(original);
  await page.getByRole("button", { name: "选择整份原文", exact: true }).click();
  await page.getByRole("button", { name: "为选区建立人工解释", exact: true }).click();
  const interpretation = page.getByRole("region", { name: "人工反馈解释", exact: true });
  await interpretation.getByLabel("人工解释").fill("人工核对方法段落并关联合成正文版本，不宣称导师认可。");
  await choose(interpretation, "解释确定性", "人工已明确");
  await interpretation.getByRole("checkbox", { name: "我已核对本条解释与原文范围" }).check();
  await choose(interpretation, "任务关联方式", "关联已有任务");
  await choose(interpretation, "关联已有任务", taskTitle);
  await addEvidence(interpretation, updated);
  let item = await submit(interpretation.getByRole("button", { name: "保存人工解释", exact: true }), "POST", `${root}/feedback/${batch.id}/items`, 201);
  expect(item.origin).toBe("manual");
  expect(item.content.source_range.text).toBe(original);
  expect(item.content.task_id).toBe(task.id);
  await step("保留反馈原文，以人工解释关联已有任务及正文v3证据");
  item = await submit(interpretation.getByRole("button", { name: "学生标记已处理", exact: true }), "POST", `${root}/feedback/items/${item.id}/decisions`);
  expect(item.status).toBe("processed");
  await expect(page.getByText("学生处理不等于导师认可。", { exact: false })).toBeVisible();
  await shot("feedback-processed");
  item = await submit(interpretation.getByRole("button", { name: "撤销学生处理", exact: true }), "POST", `${root}/feedback/items/${item.id}/decisions`);
  expect(item.status).toBe("open");
  await interpretation.getByRole("button", { name: "查看反馈历史", exact: true }).click();
  await expect(page.getByRole("region", { name: "反馈历史", exact: true })).toBeVisible();
  const history = await (await page.request.get(`${root}/feedback/items/${item.id}/versions`)).json();
  expect(history.total).toBeGreaterThanOrEqual(3);
  expect((await (await page.request.get(`${root}/feedback/${batch.id}`)).json()).original_text).toBe(original);
  expect((await (await page.request.get(`${root}/tasks/${task.id}`)).json()).status).toBe("confirmed");
  await step("撤销学生处理保留历史，原文与任务确认保持不变");
  await page.reload();
  await expect(page.getByRole("heading", { name: "导师反馈", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp("查看反馈原文") })).toBeVisible();
  await shot("task-feedback-restored");
  return {
    projectId,
    taskId: task.id,
    feedbackId: batch.id,
    itemId: item.id,
    originalPreserved: true,
    staleEvidenceReviewed: true,
    studentHandlingUndone: true,
    modelUsed: false,
  };
}
