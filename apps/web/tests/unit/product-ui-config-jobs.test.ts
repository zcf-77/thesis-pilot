import { describe, expect, it } from "vite-plus/test";
import type { JobDetail, JobRead } from "../../src/services/index.ts";
import {
  artifactPresentation,
  fixedInput,
  jobNextStep,
  jobScopeSummary,
  jobSourceAction,
  kindOptions,
  type JobKind,
} from "../../src/workspace/jobs/jobPresentation.ts";

const projectId = "15e786c6-7ed2-4058-8bef-00fa087ae510";
const time = "2026-11-19T08:00:00Z";
function job(kind: JobKind, status: JobRead["status"] = "succeeded", scope: JobRead["resource_scope"] = null): JobRead {
  return {
    id: crypto.randomUUID(),
    kind,
    project_id: projectId,
    status,
    attempt: 1,
    result: null,
    error_code: null,
    created_at: time,
    updated_at: time,
    resource_scope: scope,
  };
}
function artifact(result: JobDetail["artifacts"][number]["result"]): JobDetail["artifacts"][number] {
  return {
    id: crypto.randomUUID(),
    attempt_id: crypto.randomUUID(),
    job_id: crypto.randomUUID(),
    kind: result.kind,
    created_at: time,
    schema_version: 1,
    result,
  };
}

describe("W-E 配置与任务展示映射", () => {
  it("类型筛选覆盖正式工作区的全部现有任务，不暴露预览诊断类型", () => {
    const expected: JobKind[] = [
      "document_inspection",
      "content_revision",
      "material_parse",
      "office_import",
      "review",
      "literature_search",
      "feedback_decomposition",
      "plan_adjustment",
      "configuration_probe",
      "document_export",
      "change_record",
      "project_backup",
      "project_restore",
    ];
    expect(kindOptions.map((item) => item.value)).toEqual(["all", ...expected]);
    expect(kindOptions.map((item) => item.value)).not.toContain("diagnostic");
  });

  it("列表只呈现固定范围与真实下一步，不给不支持通用重试的任务伪按钮依据", () => {
    expect(jobScopeSummary(job("document_inspection", "succeeded", { document_id: crypto.randomUUID(), document_version: 7 }))).toBe("正式稿 v7");
    expect(jobScopeSummary(job("document_export", "succeeded", { document_id: crypto.randomUUID(), document_version: 3, format: "docx" }))).toBe(
      "正文 v3 · DOCX",
    );
    expect(jobNextStep(job("review", "failed"))).toContain("回来源页");
    expect(jobNextStep(job("configuration_probe", "failed"))).toContain("重试原固定输入");
    expect(jobNextStep(job("review", "running"))).toContain("不推算进度");
    expect(jobNextStep(job("content_revision"))).toContain("不会自动采纳");
    expect(jobSourceAction(job("review"))?.to).toMatchObject({ name: "workspace-review", params: { projectId } });
    expect(jobSourceAction(job("project_restore"))?.to).toMatchObject({ name: "workspace-projects" });
  });

  it("固定输入技术详情递归移除凭据和别名，同时保留可核查配置", () => {
    const text = fixedInput({
      resource_scope: null,
      input_snapshot: null,
      configuration: {
        kind: "api",
        base_url: "https://api.deepseek.com",
        credential_ref: "deepseek-default",
        nested: { Authorization: "synthetic-not-for-display", access_token: "synthetic-not-for-display" },
      } as unknown as JobDetail["configuration"],
    });
    expect(text).toContain("base_url");
    expect(text).not.toContain("credential_ref");
    expect(text).not.toContain("deepseek-default");
    expect(text).not.toContain("synthetic-not-for-display");
    expect(text).not.toContain("Authorization");
  });

  it("配置试跑产物使用白名单摘要并保留实际返回内容", () => {
    const view = artifactPresentation(
      artifact({
        kind: "configuration_probe",
        schema_version: 1,
        job_id: crypto.randomUUID(),
        project_id: projectId,
        config_version_id: crypto.randomUUID(),
        config_kind: "prompt",
        version_ids: { prompt: crypto.randomUUID() },
        model_used: false,
        requested_model: null,
        response_model: null,
        writes_performed: false,
        content: "自制固定输入的渲染结果",
      }),
    );
    expect(view.testid).toBe("configuration-probe-result");
    expect(view.content).toBe("自制固定输入的渲染结果");
    expect(view.facts).toContainEqual({ label: "配置类型", value: "提示词" });
    expect(view.facts).toContainEqual({ label: "正式内容", value: "未写入" });
  });

  it("计划、评审和 Word 导入产物显示实际结果，不把候选当成正式修改", () => {
    const plan = artifactPresentation(
      artifact({
        kind: "plan_adjustment",
        schema_version: 1,
        job_id: crypto.randomUUID(),
        project_id: projectId,
        adjustment_id: crypto.randomUUID(),
        proposal_id: crypto.randomUUID(),
        item_count: 3,
        blocked_count: 1,
        model_used: true,
        requested_model: "deepseek-flash",
        response_model: "deepseek-flash",
        writes_performed: false,
      }),
    );
    expect(plan.facts).toContainEqual({ label: "受阻项", value: "1 项" });
    expect(plan.facts).toContainEqual({ label: "正式计划", value: "未写入" });

    const review = artifactPresentation(
      artifact({
        kind: "review",
        schema_version: 1,
        job_id: crypto.randomUUID(),
        project_id: projectId,
        review_id: crypto.randomUUID(),
        report_id: crypto.randomUUID(),
        document_id: crypto.randomUUID(),
        document_version: 4,
        model_used: true,
        requested_model: "deepseek-v4-pro",
        response_model: "deepseek-v4-pro",
        writes_performed: false,
      }),
    );
    expect(review.facts).toContainEqual({ label: "正文版本", value: "v4" });

    const imported = artifactPresentation(
      artifact({
        kind: "office_import",
        schema_version: 1,
        job_id: crypto.randomUUID(),
        project_id: projectId,
        import_id: crypto.randomUUID(),
        block_count: 18,
        chapter_count: 4,
        object_count: 2,
        loss_count: 1,
        original_sha256: "a".repeat(64),
        model_used: false,
        writes_performed: false,
      }),
    );
    expect(imported.facts).toContainEqual({ label: "识别范围", value: "4 个章节 · 18 个内容块" });
    expect(imported.facts).toContainEqual({ label: "原始文件", value: "原件已保留" });
  });
});
