import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { makeProject, usePreviewWorkspaceStore, type PreviewEditorSnapshot } from "../../src/lab/state/previewWorkspace.ts";
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
function paragraphSnapshot(text: string) {
  return {
    schemaVersion: 1,
    json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
    chapters: [],
  } satisfies PreviewEditorSnapshot;
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
    const invalidHtml = '<p onclick="alert(1)">非法导入内容</p>';
    expect(() => state.saveDocument(invalidHtml)).toThrow("本次未保存");
    expect(state.current.document.html).not.toBe(invalidHtml);
    state.current.document.html = invalidHtml;
    state.current.document.history.at(-1)!.html = invalidHtml;
    expect(state.persistNow()).toBe(false);
    expect(state.saveStatus).toBe("failed");
    expect(state.saveError).toContain("未通过恢复校验");
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe(previous);
    expect(state.current.document.html).toContain("非法导入内容");
  });

  it("无论 HTML 是否变化，无法无损读取的结构均不改动当前稿或历史", () => {
    const state = workspace();
    const html = "<p>自制段落</p>";
    const snapshot = paragraphSnapshot("自制段落");
    state.saveDocument(html, "初次写入", snapshot);
    expect(state.persistNow()).toBe(true);
    const before = state.current.document;
    const beforeJson = JSON.stringify(before);
    const persisted = storage.getItem(WORKSPACE_STORAGE_KEY);
    const invalid = paragraphSnapshot("越界属性");
    Object.assign(invalid.json.content[0]!, { attrs: { preservedSourceId: "source-1" } });

    for (const input of [html, "<p>另一段</p>"]) {
      expect(() => state.saveDocument(input, "无效结构", invalid)).toThrow();
      expect(state.current.document).toBe(before);
      expect(JSON.stringify(state.current.document)).toBe(beforeJson);
      expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe(persisted);
    }
    expect(() => state.saveDocument("<p>纯 HTML 覆盖</p>")).toThrow("已有结构快照");
    expect(state.current.document).toBe(before);
  });

  it("结构变化独立记录版本，并在刷新和备份时保留当前稿和历史", () => {
    const state = workspace();
    const html = "<p>保护段落 1200 [1]</p>";
    const snapshot = paragraphSnapshot("保护段落 1200 [1]");
    const previousVersion = state.saveDocument(html, "初次写入", snapshot);
    const marked = paragraphSnapshot("保护段落 1200 [1]");
    Object.assign(marked.json.content[0]!.content[0]!, { marks: [{ type: "aiLock" }] });
    const version = state.saveDocument(html, "锁定内容", marked);
    expect(version).toBe(previousVersion + 1);
    expect(state.saveDocument("<p>保护段落 1200 &#91;1&#93;</p>", "相同结构", marked)).toBe(version);
    expect(state.persistNow()).toBe(true);

    const reloaded = workspace().current;
    expect(reloaded.document.version).toBe(version);
    expect(reloaded.document.structure).toMatchObject(marked);
    expect(reloaded.document.history.at(-1)?.structure).toMatchObject(marked);
    expect(reloaded.document.history.at(-2)?.structure).toMatchObject(snapshot);
    expect(parsePreviewBackup(serializePreviewBackup(reloaded)).document).toEqual(reloaded.document);
  });

  it("显式转换旧 HTML 只附加结构，保留原文及版本元数据", () => {
    const state = workspace();
    const html = "<p>旧格式&#32;正文</p>";
    const version = state.saveDocument(html, "导入");
    const original = state.current.document;
    const expected = { projectId: state.current.id, version };
    const snapshot = paragraphSnapshot("旧格式 正文");
    expect(() => state.attachLegacyDocumentStructure({ ...expected, version: version - 1 }, snapshot)).toThrow("版本已变化");
    const invalid = { ...snapshot, json: { type: "doc", content: [{ type: "unknown" }] } };
    expect(() => state.attachLegacyDocumentStructure(expected, invalid)).toThrow();
    expect(state.current.document).toBe(original);
    expect(state.attachLegacyDocumentStructure(expected, snapshot)).toBe(version);
    expect(state.current.document).toMatchObject({
      ...original,
      structure: snapshot,
      history: [...original.history.slice(0, -1), { ...original.history.at(-1)!, structure: snapshot }],
    });
    expect(original.structure).toBeUndefined();
    expect(original.history.at(-1)?.structure).toBeUndefined();
    snapshot.json.content[0]!.content[0]!.text = "调用方之后改动的文本";
    expect(state.current.document.structure).toMatchObject(paragraphSnapshot("旧格式 正文"));
    expect(() => state.attachLegacyDocumentStructure(expected, snapshot)).toThrow("已有结构快照");
    expect(state.persistNow()).toBe(true);
    expect(workspace().current.document).toEqual(state.current.document);
  });

  it("旧实现只保存于当前版本的结构会随下一次保存留在对应历史中", () => {
    const state = workspace();
    const html = "<h2>旧标题</h2>";
    const originalVersion = state.saveDocument(html, "导入");
    const oldSnapshot: PreviewEditorSnapshot = {
      schemaVersion: 1,
      json: { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "旧标题" }] }] },
      chapters: [{ id: "unassigned-0", title: "旧标题", level: 2, position: 0, end: 5, words: 0 }],
    };
    state.current.document.structure = oldSnapshot;
    expect(state.persistNow()).toBe(true);
    const restored = workspace();
    expect(restored.current.document.structure).toEqual(oldSnapshot);
    expect(restored.current.document.history.at(-1)?.structure).toBeUndefined();

    const updatedSnapshot: PreviewEditorSnapshot = {
      ...oldSnapshot,
      json: { type: "doc", content: [{ type: "heading", attrs: { level: 2, chapterId: "old-heading" }, content: [{ type: "text", text: "旧标题" }] }] },
    };
    expect(restored.saveDocument('<h2 data-chapter-id="old-heading">旧标题</h2>', "补充章节身份", updatedSnapshot)).toBe(originalVersion + 1);
    expect(restored.current.document.history.at(-2)).toMatchObject({ version: originalVersion, html, structure: oldSnapshot });
  });

  it("备份和本机恢复逐项拒绝当前稿或任一历史中的未知结构", () => {
    const state = workspace();
    state.saveDocument("<p>历史</p>", "写入", paragraphSnapshot("历史"));
    state.saveDocument("<p>当前</p>", "更新", paragraphSnapshot("当前"));
    expect(state.persistNow()).toBe(true);
    const persisted = storage.getItem(WORKSPACE_STORAGE_KEY)!;
    const current = state.current.document;
    const invalid = paragraphSnapshot("未知属性");
    Object.assign(invalid.json.content[0]!, { attrs: { preservedSourceId: "source-1" } });

    for (const index of [null, 1, 2]) {
      const backup = JSON.parse(serializePreviewBackup(state.current));
      const broken = JSON.parse(persisted);
      for (const doc of [backup.project.document, broken.projects[0].document]) {
        const target = index === null ? doc : doc.history[index];
        target.structure = invalid;
      }
      const rawBackup = JSON.stringify(backup);
      expect(() => parsePreviewBackup(rawBackup)).toThrow("保留原文件");
      const rawWorkspace = JSON.stringify(broken);
      storage.setItem(WORKSPACE_STORAGE_KEY, rawWorkspace);
      const rejected = workspace();
      expect(rejected.storageRecoveryRequired).toBe(true);
      expect(rejected.persistNow()).toBe(false);
      expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe(rawWorkspace);
      expect(state.current.document).toBe(current);
    }
  });

  it("正文结构的合法嵌套在本地和备份恢复时使用统一校验", () => {
    const state = workspace();
    let nested: unknown = paragraphSnapshot("深层引用").json.content[0];
    let html = "<p>深层引用</p>";
    for (let i = 0; i < 24; i += 1) {
      nested = { type: "blockquote", content: [nested] };
      html = "<blockquote>" + html + "</blockquote>";
    }
    state.saveDocument(html, "写入引用", { schemaVersion: 1, json: { type: "doc", content: [nested] }, chapters: [] });
    expect(state.persistNow()).toBe(true);
    const reloaded = workspace();
    expect(reloaded.storageRecoveryRequired).toBe(false);
    expect(reloaded.current.document).toEqual(state.current.document);
    expect(parsePreviewBackup(serializePreviewBackup(reloaded.current)).document).toEqual(state.current.document);
  });

  it("备份文档结构和元数据都拒绝原型相关键", () => {
    const state = workspace();
    state.saveDocument("<p>安全内容</p>", "写入", paragraphSnapshot("安全内容"));
    const raw = serializePreviewBackup(state.current);
    for (const path of ["project", "document", "history", "structure"] as const) {
      const backup = JSON.parse(raw);
      const targets = {
        project: backup.project,
        document: backup.project.document,
        history: backup.project.document.history.at(-1),
        structure: backup.project.document.structure.json.content[0],
      };
      Object.defineProperty(targets[path], "__proto__", { value: { injected: true }, enumerable: true });
      expect(() => parsePreviewBackup(JSON.stringify(backup))).toThrow("未通过校验");
    }
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
