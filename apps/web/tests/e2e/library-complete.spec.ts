import { chooseOption } from "./select-option.ts";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { appUrl } from "./app-url.ts";

test("资料真实读取文本、下载原件并保留重复上传版本", async ({ page }) => {
  await page.goto(appUrl("/screens/library"));
  await page.getByRole("button", { name: "上传资料", exact: true }).first().click();
  const original = "自制测试原件\n  保留空格与换行 <b>文字</b>\n";
  await page.getByLabel("选择文件").setInputFiles({ name: "资料验收.txt", mimeType: "text/plain", buffer: Buffer.from(original) });
  await expect(page.locator(".library-paper-title")).toHaveText("资料验收.txt");
  await expect(page.locator(".library-file-row").filter({ hasText: "资料验收.txt" })).toContainText("解析成功");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载原件", exact: true }).click();
  const download = await downloadPromise;
  expect(await readFile((await download.path())!, "utf8")).toBe(original);
  await page.getByLabel("选择文件").setInputFiles({ name: "资料验收.txt", mimeType: "text/plain", buffer: Buffer.from("第二版原件") });
  await expect(page.locator(".library-file-row").filter({ hasText: "资料验收.txt" })).toContainText("解析成功");
  await expect(page.locator(".library-paper-number")).toContainText("V02");
  await page.getByRole("button", { name: "版本记录", exact: true }).click();
  await page
    .locator(".library-history")
    .getByRole("button", { name: /v1 · 上传原件/ })
    .click();
  await expect(page.locator(".library-paper-number")).toContainText("V01");
  await expect(page.locator(".library-excerpt-toggle + div.library-excerpt > blockquote")).toContainText("保留空格与换行 <b>文字</b>");
  await expect(page.getByText("历史版本 · 当前 v2")).toBeVisible();
});

test("证据深链接定位具体旧版本，未知版本不静默打开最新", async ({ page }) => {
  await page.goto(appUrl("/screens/library"));
  await page.locator(".library-file-row").filter({ hasText: "毕业论文模板" }).click();
  await page.getByRole("button", { name: "纠正提取结果", exact: true }).click();
  await page.getByLabel("提取文本", { exact: true }).fill("这是模板第四版提取结果。");
  await page.getByRole("button", { name: "保存提取新版本", exact: true }).click();
  await expect(page.locator(".library-paper-number")).toContainText("V04");
  await page.evaluate(() => {
    location.hash = "/screens/library?material=m2&version=3";
  });
  await expect(page.locator(".library-paper-number")).toContainText("V03");
  await expect(page.locator(".library-excerpt-toggle + div.library-excerpt > blockquote")).toContainText("三号黑体，居中");
  await expect(page.locator(".library-excerpt-toggle + div.library-excerpt > blockquote")).not.toContainText("第四版");
  await page.evaluate(() => {
    location.hash = "/screens/library?material=m2&version=999";
  });
  await expect(page.getByRole("heading", { name: "来源版本不可用", exact: true })).toBeVisible();
  await expect(page.getByText("请求的资料版本 v999 不存在于当前项目，未改用其他版本。", { exact: true })).toBeVisible();
  await expect(page.locator(".library-paper")).toHaveCount(0);
  await page.getByRole("button", { name: "查看该资料当前版本", exact: true }).click();
  await expect(page.locator(".library-paper-number")).toContainText("V04");
  await expect(page.locator(".library-excerpt-toggle + div.library-excerpt > blockquote")).toContainText("第四版");
  await page.evaluate(() => {
    location.hash = "/screens/library?material=m2&version=invalid";
  });
  await expect(page.getByText("来源版本号无效，无法确认这条证据对应的版本。", { exact: true })).toBeVisible();
  await expect(page.locator(".library-paper")).toHaveCount(0);
});

test("不支持格式保留原件，取消后迟到结果不会转成成功，手动补充生成版本", async ({ page }) => {
  await page.goto(appUrl("/screens/library"));
  await page.getByRole("button", { name: "上传资料", exact: true }).first().click();
  await page.getByLabel("选择文件").setInputFiles({ name: "未知格式.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0, 1, 2, 3]) });
  await page.getByRole("button", { name: "取消读取", exact: true }).click();
  await expect(page.locator(".library-detail-status")).toContainText("已取消");
  await page.waitForTimeout(800);
  await expect(page.locator(".library-detail-status")).toContainText("已取消");
  await page.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(page.locator(".library-detail")).toContainText("当前预览不支持此格式的内容解析");
  await page.getByRole("button", { name: "手动补充文本", exact: true }).click();
  await page.getByLabel("提取文本", { exact: true }).fill("经学生对照原件补充的文本。");
  await page.getByRole("button", { name: "保存提取新版本", exact: true }).click();
  await expect(page.locator(".library-paper-number")).toContainText("V02");
  await expect(page.locator(".library-excerpt-toggle + div.library-excerpt > blockquote")).toContainText("经学生对照原件补充的文本。");
  await page.getByRole("button", { name: "解除项目关联", exact: true }).click();
  await expect(page.getByRole("button", { name: "恢复关联", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "恢复关联", exact: true }).click();
  await expect(page.locator(".library-file-row").filter({ hasText: "未知格式.bin" })).toHaveCount(1);
});

test("要求纠正保留原文，规则集明确绑定并保留停用历史", async ({ page }) => {
  await page.goto(appUrl("/screens/library"));
  await page.getByRole("tab", { name: /论文要求/ }).click();
  await page.locator(".library-requirement-wrap").first().getByRole("button", { name: "编辑要求" }).click();
  await page.getByLabel("要求内容", { exact: true }).fill("正文字符不少于 10 字符（自制测试规则）");
  await page.getByLabel("参数", { exact: true }).fill("≥ 10");
  await page.getByLabel("适用范围", { exact: true }).fill("当前编辑稿纯文本");
  await page.getByRole("button", { name: "保存要求新版本", exact: true }).click();
  await expect(page.locator(".library-excerpt-toggle + div.library-excerpt > blockquote")).toContainText("正文字数不少于 12000 字");
  await page.getByRole("button", { name: "绑定要求集 v3", exact: true }).click();
  await expect(page.locator(".library-top-actions")).toContainText("要求集 v3");
  const row = page.locator(".library-requirement-wrap").filter({ hasText: "正文字符不少于 10 字符" });
  await row.getByRole("button", { name: "停用", exact: true }).click();
  await row.getByRole("button", { name: "历史", exact: true }).click();
  await expect(page.locator(".library-history").last()).toContainText("停用");
  await expect(page.locator(".library-history").last()).toContainText("原始提取样例");
  await expect(page.locator(".screens-topbar")).toContainText("v13");
});

test("模板解析纠正和绑定均保留正文，历史格式仍可查", async ({ page }) => {
  await page.goto(appUrl("/screens/library"));
  await page.getByRole("tab", { name: /^模板/ }).click();
  await page.locator(".library-file-row").filter({ hasText: "毕业论文模板" }).click();
  await page.getByRole("button", { name: "纠正模板解析项", exact: true }).click();
  await page.getByLabel("一级标题", { exact: true }).fill("二号黑体，居中（学生修正样例）");
  await page.getByRole("button", { name: "保存模板新版本", exact: true }).click();
  await page.getByRole("button", { name: "绑定此模板版本", exact: true }).click();
  await expect(page.locator(".library-top-actions")).toContainText("项目模板 v4");
  await expect(page.locator(".screens-topbar")).toContainText("v13");
  await page.getByRole("button", { name: "版本记录", exact: true }).click();
  await page
    .locator(".library-history")
    .getByRole("button", { name: /v3 · 自制样例/ })
    .click();
  await expect(page.locator(".library-definition")).toContainText("三号黑体，居中");
  await expect(page.locator(".library-definition")).not.toContainText("二号黑体");
  await page.getByRole("button", { name: "纠正模板解析项", exact: true }).click();
  await expect(page.getByLabel("一级标题", { exact: true })).toHaveValue("三号黑体，居中");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "审阅标题格式", exact: true }).click();
  await expect(page).toHaveURL(/screens\/write.*intent=format/);
  await expect(page.getByRole("article", { name: /修订候选：规范标题结构与对齐/ })).toBeVisible();
  await expect(page.locator(".screens-topbar")).toContainText("v13");
});

test("文献无结果可恢复，只取得摘要，收藏和多篇上下文可继续写作", async ({ page }) => {
  await page.goto(appUrl("/screens/library"));
  await page.getByRole("tab", { name: /文献索引/ }).click();
  await page.getByRole("searchbox", { name: "查询文献", exact: true }).fill("不存在的样例xyz");
  await expect(page.getByRole("heading", { name: "没有查询到文献" })).toBeVisible();
  await page.getByRole("button", { name: "清除文献筛选", exact: true }).click();
  await page.locator(".library-literature-row").filter({ hasText: "校园场景下" }).click();
  await page.getByRole("button", { name: "查看来源与取得内容", exact: true }).click();
  await expect(page.locator(".library-detail")).toContainText("全文不可访问");
  await expect(page.locator(".library-detail")).toContainText("自制摘要");
  await page.getByRole("button", { name: "加入项目收藏", exact: true }).click();
  await expect(page.getByRole("button", { name: "已加入项目收藏", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: /选择文献：面向稀疏交互/ }).check();
  await page.getByRole("checkbox", { name: /选择文献：校园场景下/ }).check();
  await page.getByRole("button", { name: "带 2 篇资料提问", exact: true }).click();
  await expect(page).toHaveURL(/screens\/write\?materials=L-012(?:%2C|,)L-020/);
  await expect(page.locator(".tiptap")).toBeVisible();
});

test("新上传模板保留业务类型，文字提取显示已识别与未知项", async ({ page }) => {
  await page.goto(appUrl("/screens/library"));
  await page.getByRole("button", { name: "上传资料", exact: true }).first().click();
  await chooseOption(page.getByLabel("资料分类", { exact: true }).first(), "category-0");
  await page.getByLabel("选择文件").setInputFiles({
    name: "标题模板.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("标题层级：一级标题 / 二级标题 / 三级标题\n一级标题：三号黑体，居中\n段落：首行缩进两字符"),
  });
  await expect(page.locator(".library-detail")).toContainText("模板结构与支持范围");
  await expect(page.locator(".library-definition")).toContainText("三号黑体，居中");
  await expect(page.locator(".library-definition")).toContainText("未知");
  await page.getByRole("button", { name: "绑定此模板版本", exact: true }).click();
  await expect(page.locator(".library-top-actions")).toContainText("项目模板 v1");
});

test("未核实来源禁止提问，补源取消保留旧状态，核验后固定新版本", async ({ page }) => {
  await page.goto(appUrl("/screens/library?tab=literature"));
  await page.locator(".library-literature-row").filter({ hasText: "二手交易平台用户行为分析" }).click();
  await expect(page.getByRole("button", { name: "带这篇资料提问", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "选择文献：二手交易平台用户行为分析" })).toBeDisabled();
  await page.getByRole("button", { name: "补充来源并核验", exact: true }).click();
  await page.getByLabel("来源记录", { exact: true }).fill("自制来源核对记录：本地样例文本，未访问外部出版数据库。");
  await page.getByLabel("实际取得的摘要", { exact: true }).fill("自制摘要仅介绍样例研究范围，不包含真实实验结论。");
  await page.getByLabel("核对说明", { exact: true }).fill("已人工核对本地自制内容来源与取得范围。");
  await page.getByRole("button", { name: "核验并保存来源版本", exact: true }).click();
  await page.getByRole("button", { name: "取消核验", exact: true }).click();
  await page.waitForTimeout(750);
  await expect(page.getByRole("button", { name: "带这篇资料提问", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "核验并保存来源版本", exact: true }).click();
  await expect(page.getByRole("button", { name: "带这篇资料提问", exact: true })).toBeEnabled();
  await expect(page.locator(".library-notice")).toContainText("来源 v2");
  await page.getByText("来源版本记录", { exact: true }).click();
  await expect(page.locator(".library-history")).toContainText("作者未知");
});

test("语义判断失败可重试，成功保留正文依据", async ({ page }) => {
  await page.goto(appUrl("/screens/library?tab=requirements"));
  const rule = page.locator(".library-requirement-wrap").filter({ hasText: "论证层次清晰" });
  await chooseOption(page.getByLabel("语义预览场景", { exact: true }), "failed");
  await rule.getByRole("button", { name: "运行语义预览", exact: true }).click();
  await expect(rule).toContainText("模拟请求超时");
  await chooseOption(page.getByLabel("语义预览场景", { exact: true }), "success");
  await rule.getByRole("button", { name: "运行语义预览", exact: true }).click();
  await expect(rule).toContainText("本地语义预览依据");
  await rule.getByText(/查看判断依据/).click();
  await expect(rule.locator("blockquote").first()).toContainText("实验");
  await expect(page.locator(".screens-topbar")).toContainText("v13");
});
