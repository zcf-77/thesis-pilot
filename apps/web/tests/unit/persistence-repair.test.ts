import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { makeProject, usePreviewWorkspaceStore } from "../../src/lab/state/previewWorkspace.ts";
import { downloadPreviewFile, parsePreviewBackup, serializePreviewBackup, safeDocumentHtml } from "../../src/lab/state/previewBackup.ts";
import { WORKSPACE_STORAGE_KEY, type StoragePort } from "../../src/lab/services/persistence.ts";

class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  fail = false;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail) throw new Error("quota");
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
let storage: MemoryStorage;
const stores: Pinia[] = [];
function workspace() {
  const pinia = createPinia();
  stores.push(pinia);
  setActivePinia(pinia);
  return usePreviewWorkspaceStore();
}
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => {
  stores.splice(0).forEach(disposePinia);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("本地持久化与数据恢复", () => {
  it("技术论文正文中的URL和事件属性语法可保存、刷新及备份往返", () => {
    const html =
      '<h2>浏览器安全</h2><p>JavaScript URL 示例：javascript:alert(1)</p><p>事件属性语法 onclick=handler 属于本文讨论对象。</p><p>CSS 函数 url(example.svg) 与 expression(x) 是讨论内容。</p><p><code>&lt;script&gt; 与 &lt;img onerror=alert(1)&gt;</code></p><p title="技术示例 > onclick=handler javascript:alert(1)">文字与属性值都保持原样。</p>';
    const first = workspace();
    expect(safeDocumentHtml(html)).toBe(true);
    first.saveDocument(html, "技术论文输入");
    expect(first.persistNow()).toBe(true);
    const reloaded = workspace();
    expect(reloaded.storageRecoveryRequired).toBe(false);
    expect(reloaded.current.document.html).toBe(html);
    expect(parsePreviewBackup(serializePreviewBackup(reloaded.current)).document.html).toBe(html);
  });

  it("标签属性检查仍拒绝真实执行属性、危险URL和危险CSS", () => {
    for (const html of [
      "<script>alert(1)</script>",
      '<p onclick="handler()">文字</p>',
      "<p ONCLICK=handler()>文字</p>",
      '<a href="javascript:alert(1)">文字</a>',
      '<a href="&#106;avascript:alert(1)">文字</a>',
      '<a href="java&#x73;cript&colon;alert(1)">文字</a>',
      '<a href="data:text/html,x">文字</a>',
      '<a href="https://example.invalid&#10;javascript:alert(1)">文字</a>',
      '<p style="background-image:url(https://example.invalid)">文字</p>',
      '<p style="width:expression(alert(1))">文字</p>',
      '<p title="safe" onclick="alert(1)">文字</p>',
      '<a href="https://example.invalid" href="javascript:x">文字</a>',
    ])
      expect(safeDocumentHtml(html), html).toBe(false);
    expect(
      safeDocumentHtml(
        '<h2 data-chapter-id="chapter-1" style="text-align:center;font-weight:700">安全格式</h2><table style="min-width:50px"><tbody><tr><td colspan="1" rowspan="1" data-colwidth="50"><p>单元格</p></td></tr></tbody></table>',
      ),
    ).toBe(true);
    expect(safeDocumentHtml('<a href="https://example.invalid/?a=1&amp;b=2" title="url(x) > onclick=y">正常来源</a>')).toBe(true);
  });

  it("不可恢复内容不得覆盖上次有效存储或显示已保存", () => {
    const state = workspace();
    expect(state.persistNow()).toBe(true);
    const previous = storage.getItem(WORKSPACE_STORAGE_KEY);
    state.saveDocument('<p onclick="alert(1)">非法导入内容</p>');
    expect(state.persistNow()).toBe(false);
    expect(state.saveStatus).toBe("failed");
    expect(state.saveError).toContain("未通过恢复校验");
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe(previous);
    expect(state.current.document.html).toContain("非法导入内容");
  });

  it("刷新实例恢复两个项目、正文版本、偏好与事件，不仅恢复当前文本", () => {
    const first = workspace();
    const originalId = first.activeId;
    first.saveDocument("<h2>实验</h2><p>自制结果。</p>", "写入自制正文");
    first.recordEvent("完成核对", "学生自报", "/screens/plan", { type: "task-confirmed", objectId: "t1", sourceVersion: 14 });
    first.createProject("独立项目");
    first.saveDocument("<p>第二份正文</p>");
    first.userName = "自制昵称";
    first.quietStart = "23:30";
    expect(first.persistNow()).toBe(true);
    const reloaded = workspace();
    expect(reloaded.projects).toHaveLength(2);
    expect(reloaded.userName).toBe("自制昵称");
    expect(reloaded.quietStart).toBe("23:30");
    expect(reloaded.current.document.html).toBe("<p>第二份正文</p>");
    reloaded.switchProject(originalId);
    expect(reloaded.current.document.version).toBe(14);
    expect(reloaded.current.document.history).toHaveLength(2);
    expect(reloaded.events[0]?.objectId).toBe("t1");
  });

  it("存储失败保留内存与上次有效落盘，重试后刷新可继续", () => {
    const first = workspace();
    first.persistNow();
    const saved = storage.getItem(WORKSPACE_STORAGE_KEY);
    storage.fail = true;
    first.saveDocument("<p>不能丢失的本地草稿</p>");
    expect(first.persistNow()).toBe(false);
    expect(first.saveStatus).toBe("failed");
    expect(first.saveError).toContain("保存失败");
    expect(first.current.document.html).toContain("不能丢失");
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe(saved);
    storage.fail = false;
    expect(first.retrySave()).toBe(true);
    expect(workspace().current.document.html).toContain("不能丢失");
  });

  it("损坏本地数据不被初始化样例静默覆盖，明确重置后才恢复写入", () => {
    storage.setItem(WORKSPACE_STORAGE_KEY, "{broken");
    const state = workspace();
    expect(state.storageRecoveryRequired).toBe(true);
    state.saveDocument("<p>临时保留</p>");
    expect(state.persistNow()).toBe(false);
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe("{broken");
    expect(state.resetWorkspace()).toBe(true);
    expect(workspace().storageRecoveryRequired).toBe(false);
  });

  it("备份包含当前项目事件且拒绝错项目事件和重复文稿历史版本", () => {
    const state = workspace();
    state.recordEvent("自制事件", "核对来源", "/screens/plan");
    const raw = serializePreviewBackup(state.current);
    expect(parsePreviewBackup(raw).events).toHaveLength(1);
    const bad = JSON.parse(raw);
    bad.project.events[0].projectId = "different-project";
    expect(() => parsePreviewBackup(JSON.stringify(bad))).toThrow();
    const project = makeProject();
    project.document.history.push({ ...project.document.history[0]! });
    expect(() => parsePreviewBackup(serializePreviewBackup(project))).toThrow();
  });

  it("严格拒绝通知非法状态以及任务负数尝试计数", () => {
    const p = makeProject();
    p.modules.inbox = {
      triggerKeys: [],
      lastTriggers: {},
      suggestions: [
        { id: "bad", title: "x", detail: "x", basis: "x", uncertainty: "x", route: "/screens/inbox", state: "unknown-state", at: "x", offline: [] },
      ],
    };
    expect(() => parsePreviewBackup(serializePreviewBackup(p))).toThrow();
    delete p.modules.inbox;
    p.modules.jobs = {
      jobs: [{ id: "bad", title: "x", kind: "导出", status: "done", attempt: -1, input: "x", diagnosis: "x", at: "x", route: "/screens/export", token: -1 }],
    };
    expect(() => parsePreviewBackup(serializePreviewBackup(p))).toThrow();
  });

  it("下载准备抛错返回可恢复失败，不报告成功", () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      throw new Error("blocked");
    });
    const result = downloadPreviewFile("test.txt", "自制内容", "text/plain");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("原内容已保留");
  });
});
