import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createPinia, setActivePinia } from "pinia";
import { usePreviewWorkspaceStore } from "../../src/lab/state/previewWorkspace.ts";
import { parsePreviewBackup, serializePreviewBackup, validatePreviewProject } from "../../src/lab/state/previewBackup.ts";
import { createRemoteBinding, validateRemoteBinding } from "../../src/lab/state/serviceBinding.ts";
import type { ProjectRead } from "../../src/services/index.ts";

const project: ProjectRead = {
  id: "7c271e90-7b6a-4cde-9e29-9d4b70d2e5c4",
  name: "接口项目",
  version: 1,
  created_at: "2026-11-14T12:00:00Z",
  updated_at: "2026-11-14T12:00:00Z",
};

beforeEach(() => setActivePinia(createPinia()));

describe("接口项目与本机资料关联", () => {
  it("打开与改名保留本地ID、正文版本、规划和历史", () => {
    const workspace = usePreviewWorkspaceStore();
    const local = workspace.openServiceProject(project, "http:local-api");
    const id = local.id;
    expect(id).not.toBe(project.id);
    local.planning = "本人规划";
    workspace.saveDocument("<p>本机正文 1200 [1]</p>");
    const document = JSON.stringify(local.document);
    const count = workspace.projects.length;
    const updated = workspace.openServiceProject({ ...project, name: "新名称", version: 2 }, "http:local-api");
    expect(updated.id).toBe(id);
    expect(updated.planning).toBe("本人规划");
    expect(JSON.stringify(updated.document)).toBe(document);
    expect(updated.remoteBinding?.metadataVersion).toBe(2);
    expect(workspace.projects).toHaveLength(count);
    // Persistence validates serialized JSON; optional ViewModel properties may
    // still be undefined before that boundary removes them.
    expect(validatePreviewProject(JSON.parse(JSON.stringify(updated)))).toBe(true);
  });
  it("同一远端ID按实例隔离，旧元数据不能覆盖新版本", () => {
    const workspace = usePreviewWorkspaceStore();
    const a = workspace.openServiceProject({ ...project, version: 3 }, "http:server-a");
    const b = workspace.openServiceProject(project, "http:server-b");
    expect(a.id).not.toBe(b.id);
    expect(() => workspace.openServiceProject(project, "http:server-a")).toThrow("过期");
    expect(a.remoteBinding?.metadataVersion).toBe(3);
  });
  it("浏览器保存保留合法关联，导入独立备份去关联且原项目不变", () => {
    const local = usePreviewWorkspaceStore().openServiceProject(project, "mock:local-mock");
    expect(validatePreviewProject(JSON.parse(JSON.stringify(local)))).toBe(true);
    const imported = parsePreviewBackup(serializePreviewBackup(local));
    expect(imported.remoteBinding).toBeUndefined();
    expect(local.remoteBinding?.projectId).toBe(project.id);
  });
  it("拒绝非法绑定及夹带凭据，失败不创建本机项目", () => {
    const workspace = usePreviewWorkspaceStore();
    const count = workspace.projects.length;
    const binding = createRemoteBinding(project, "http:local-api");
    expect(validateRemoteBinding({ ...binding, token: "must-not-persist" })).toBe(false);
    expect(validateRemoteBinding({ ...binding, metadataVersion: 0 })).toBe(false);
    expect(() => workspace.openServiceProject(project, "http:wrong/instance")).toThrow();
    expect(workspace.projects).toHaveLength(count);
  });
});
