import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { DocumentRead, DocumentSave } from "../../src/services/contracts/api.generated.ts";
import { appUrl } from "./app-url.ts";

const projectId = "bede0e27-8ba6-43db-a5a2-a52aae3551d9";
const documentId = "9a403fae-1ad6-4430-85d9-8053ed123261";
const timestamp = "2026-11-17T08:00:00.000Z";
const project = { id: projectId, name: "跨窗口正文草稿样例", version: 1, created_at: timestamp, updated_at: timestamp };

async function installDocumentRoutes(context: BrowserContext) {
  let current: DocumentRead | undefined;
  const writes: { method: string; expectedVersion?: number }[] = [];
  await context.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const error = (status: number, code: string) => route.fulfill({ status, json: { error: { code, message: code, request_id: projectId } } });
    if (path === "/api/v1/projects" && method === "GET") {
      return route.fulfill({ json: { items: [project], total: 1, limit: 20, offset: 0 } });
    }
    if (path === `/api/v1/projects/${projectId}` && method === "GET") {
      return route.fulfill({ json: project });
    }
    const documents = `/api/v1/projects/${projectId}/documents`;
    if (path === `${documents}/current` && method === "GET") {
      return current ? route.fulfill({ json: current }) : error(404, "DOCUMENT_NOT_FOUND");
    }
    if (path === documents && method === "POST") {
      writes.push({ method });
      if (current) return error(409, "DOCUMENT_ALREADY_EXISTS");
      const input = request.postDataJSON() as { content: DocumentRead["content"] };
      current = { id: documentId, project_id: projectId, version: 1, content: input.content, created_at: timestamp, updated_at: timestamp };
      return route.fulfill({ status: 201, json: current });
    }
    if (path === `${documents}/${documentId}` && method === "PATCH") {
      if (!current) return error(404, "DOCUMENT_NOT_FOUND");
      const input = request.postDataJSON() as DocumentSave;
      writes.push({ method, expectedVersion: input.expected_version });
      if (current.version !== input.expected_version) return error(409, "DOCUMENT_VERSION_CONFLICT");
      current = { ...current, version: current.version + 1, content: input.content };
      return route.fulfill({ json: current });
    }
    return error(404, "HTTP_ERROR");
  });
  return { writes, current: () => current };
}

async function openWorkspace(page: Page) {
  await page.goto(appUrl("/screens/projects"));
  await page.getByTestId("service-project-card").filter({ hasText: project.name }).getByRole("button", { name: "打开工作区" }).click();
  await expect(editor(page)).toBeVisible();
}

const editor = (page: Page) => page.getByLabel("论文正文编辑区", { exact: true });
const official = (page: Page) => page.getByRole("radio", { name: "正式稿", exact: true });

async function storedDrafts(page: Page): Promise<{ id: string; baseVersion: number; snapshot: unknown }[]> {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((database) => database.name === "thesis-pilot-document-drafts")) return [];
    const connection = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("thesis-pilot-document-drafts", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = connection.transaction("drafts", "readonly").objectStore("drafts").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      connection.close();
    }
  });
}

test.describe("正式稿的浏览器草稿恢复", () => {
  test.skip(process.env.TP_DOCUMENT_DRAFT_E2E !== "1", "需要显式 HTTP 模式构建，测试仅拦截 HTTP 响应。");

  test("跨窗口保持草稿分离，冲突后载入新版且刷新不发送写入", async ({ context, page }) => {
    const server = await installDocumentRoutes(context);
    await openWorkspace(page);
    await editor(page).fill("保留的本机原稿");
    await official(page).click();
    const importLocal = page.getByRole("button", { name: "导入本机正文", exact: true });
    await expect(importLocal).toBeVisible();
    expect(server.writes).toEqual([]);
    await importLocal.click();
    await expect(editor(page)).toContainText("保留的本机原稿");

    const other = await context.newPage();
    await openWorkspace(other);
    await official(other).click();
    await expect(editor(other)).toContainText("保留的本机原稿");
    await editor(page).fill("窗口甲编辑");
    await editor(other).fill("窗口乙编辑");
    await expect
      .poll(async () => {
        const records = await storedDrafts(page);
        return {
          ids: new Set(records.map((record) => record.id)).size,
          versions: records.map((record) => record.baseVersion),
          hasFirst: records.some((record) => JSON.stringify(record.snapshot).includes("窗口甲编辑")),
          hasSecond: records.some((record) => JSON.stringify(record.snapshot).includes("窗口乙编辑")),
        };
      })
      .toEqual({ ids: 2, versions: [1, 1], hasFirst: true, hasSecond: true });
    expect(server.writes).toEqual([{ method: "POST" }]);

    await page.getByRole("button", { name: /^保存(?:正式稿)?$/ }).click();
    await expect.poll(() => server.current()?.version).toBe(2);
    await other.getByRole("button", { name: /^保存(?:正式稿)?$/ }).click();
    await other.getByRole("button", { name: "检查最新版本", exact: true }).click();
    await expect(editor(other)).toContainText("窗口乙编辑");
    await other.getByRole("button", { name: "保留草稿并载入新版", exact: true }).click();
    await expect(editor(other)).toContainText("窗口甲编辑");
    expect(server.writes).toEqual([{ method: "POST" }, { method: "PATCH", expectedVersion: 1 }, { method: "PATCH", expectedVersion: 1 }]);

    await other.reload();
    await official(other).click();
    await expect(editor(other)).toContainText("窗口乙编辑");
    expect(JSON.stringify(server.current()?.content)).toContain("窗口甲编辑");
    expect(server.writes).toHaveLength(3);
    await other.getByRole("radio", { name: "本机原稿", exact: true }).click();
    await expect(editor(other)).toContainText("保留的本机原稿");
  });

  test("正式稿捕获失败会阻止提交旧草稿，切换稿源后仍可修正并保存", async ({ context, page }) => {
    const server = await installDocumentRoutes(context);
    await openWorkspace(page);
    const manuscript = editor(page);
    await manuscript.fill("独立保留的本机原稿");
    await official(page).click();
    await page.getByRole("button", { name: "导入本机正文", exact: true }).click();
    await expect(manuscript).toHaveAttribute("contenteditable", "true");

    const save = page.getByRole("button", { name: "保存", exact: true });
    await manuscript.fill("此前可捕获、尚未提交的草稿");
    await expect(save).toBeEnabled();
    await expect.poll(async () => (await storedDrafts(page)).map((draft) => JSON.stringify(draft.snapshot)).join("")).toContain("此前可捕获、尚未提交的草稿");

    // ProseMirror accepts this pasted list, but the supported snapshot range stops at 10000.
    await manuscript.press("ControlOrMeta+End");
    await manuscript.evaluate((element) => {
      const clipboard = new DataTransfer();
      clipboard.setData("text/html", '<ol start="10001"><li><p>当前编辑含超限编号</p></li><li><p>切换后仍保留此项</p></li></ol>');
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
    });
    const error = page.getByRole("alert").filter({ hasText: "文档结构版本" });
    const invalidList = manuscript.locator('ol[start="10001"]');
    const saveStatus = page.locator(".screens-topbar").getByRole("status");
    await expect(manuscript).toContainText("当前编辑含超限编号");
    await expect(invalidList).toContainText("切换后仍保留此项");
    await expect(error).toBeVisible();
    await expect(saveStatus).toHaveText("当前编辑未保存");
    await expect(manuscript).toHaveAttribute("contenteditable", "true");
    await expect(save).toBeDisabled();

    await save.scrollIntoViewIfNeeded();
    const bounds = await save.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await manuscript.press("ControlOrMeta+s");
    expect(server.writes).toEqual([{ method: "POST" }]);

    await page.getByRole("radio", { name: "本机原稿", exact: true }).click();
    await expect(manuscript).toContainText("独立保留的本机原稿");
    await expect(error).toHaveCount(0);
    await official(page).click();
    await expect(invalidList).toContainText("切换后仍保留此项");
    await expect(error).toBeVisible();
    await expect(saveStatus).toHaveText("当前编辑未保存");
    await expect(save).toBeDisabled();
    await manuscript.press("ControlOrMeta+s");
    expect(server.writes).toEqual([{ method: "POST" }]);
    expect(server.current()?.version).toBe(1);

    await manuscript.fill("完成修正的正式稿");
    await expect(invalidList).toHaveCount(0);
    await expect(error).toHaveCount(0);
    await expect(save).toBeEnabled();
    await manuscript.press("ControlOrMeta+s");
    await expect.poll(() => server.current()?.version).toBe(2);
    await expect(saveStatus).toHaveText("正式稿已保存");
    expect(server.writes).toEqual([{ method: "POST" }, { method: "PATCH", expectedVersion: 1 }]);
    expect(server.current()?.content.json).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "完成修正的正式稿" }] }],
    });
  });
});
