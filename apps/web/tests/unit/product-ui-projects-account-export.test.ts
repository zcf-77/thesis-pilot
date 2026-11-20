import { effectScope, nextTick, type EffectScope } from "vue";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { BackendServices } from "../../src/services/index.ts";
import type { WorkspaceProfile } from "../../src/services/workspace.ts";
import { documentFormats, formatLabel, isOfficeFormat } from "../../src/workspace/export/useExports.ts";
import { projectTimeLabel, useProjectFacts } from "../../src/workspace/projects/projectFacts.ts";
import { mergeProfileDraft, profileDraft } from "../../src/workspace/workspaceProfile.ts";

const profile: WorkspaceProfile = {
  id: "15e786c6-7ed2-4058-8bef-00fa087ae510",
  version: 1,
  display_name: "我",
  notifications_enabled: true,
  quiet_start: "22:00",
  quiet_end: "08:00",
  show_deferred: false,
};
const scopes: EffectScope[] = [];
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()));

describe("项目、账户与导出公共页专项回归", () => {
  it("项目时间只展示可解析事实，无效值不伪装成日期", () => {
    expect(projectTimeLabel("2026-11-19T08:00:00.000Z")).toContain("2026");
    expect(projectTimeLabel("not-a-time")).toBe("时间未知");
  });

  it("连续重读项目详情时，较慢的旧响应不能覆盖最新正文版本", async () => {
    const projectId = profile.id;
    const pending: ((value: { version: number }) => void)[] = [];
    const services = {
      materials: { sourceBinding: () => new Promise(() => {}) },
      documents: { current: () => new Promise<{ version: number }>((resolve) => pending.push(resolve)) },
    } as unknown as Pick<BackendServices, "materials" | "documents">;
    const scope = effectScope();
    scopes.push(scope);
    const state = scope.run(() => useProjectFacts(services))!;
    state.load(projectId);
    state.load(projectId, true);
    expect(pending).toHaveLength(2);

    pending[1]!({ version: 8 });
    await nextTick();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(state.facts.get(projectId)?.document).toEqual({ state: "ready", value: 8 });
    pending[0]!({ version: 3 });
    await nextTick();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(state.facts.get(projectId)?.document).toEqual({ state: "ready", value: 8 });
  });

  it("正文格式清单覆盖真实 DOCX、PDF、HTML、Markdown 与 TXT 服务选项", () => {
    expect(documentFormats.map((item) => item.value)).toEqual(["docx", "pdf", "html", "markdown", "txt"]);
    expect(formatLabel.docx).toContain("DOCX");
    expect(formatLabel.txt).toContain("TXT");
    expect(isOfficeFormat("docx")).toBe(true);
    expect(isOfficeFormat("pdf")).toBe(true);
    expect(isOfficeFormat("txt")).toBe(false);
  });

  it("冲突合并保留本地延后建议选择，同时接收未编辑字段的最新值", () => {
    const latest: WorkspaceProfile = {
      ...profile,
      version: 2,
      display_name: "另一窗口",
      notifications_enabled: false,
      quiet_end: "09:00",
      show_deferred: false,
    };
    const local = { ...profileDraft(profile), show_deferred: true };
    expect(mergeProfileDraft(profileDraft(profile), local, latest)).toEqual({
      display_name: "另一窗口",
      notifications_enabled: false,
      quiet_start: "22:00",
      quiet_end: "09:00",
      show_deferred: true,
    });
    expect(mergeProfileDraft(profileDraft(profile), profileDraft(profile), { ...latest, show_deferred: true }).show_deferred).toBe(true);
  });
});
