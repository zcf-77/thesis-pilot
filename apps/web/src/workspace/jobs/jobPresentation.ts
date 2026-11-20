import { computed, ref, type Ref } from "vue";
import type { RouteLocationRaw } from "vue-router";
import { assistantJobLink, canRerunServiceJob, createServiceJobsState, isActiveServiceJob, serviceJobFailure } from "../../lab/state/serviceJobs.ts";
import type { BackendServices, JobDetail, JobRead } from "../../services/index.ts";
import { isInspectionInput, isMaterialInput, isProbeScope } from "../../services/validation.ts";
import { withoutCredentials } from "../configurations/configurationEditor.ts";
import { configurationsRoute, exportRoute, feedbackRoute, materialsRoute, projectsRoute, reviewRoute, tasksRoute, writingRoute } from "../workspaceRoutes.ts";

export type JobKind = JobRead["kind"];
type Attempt = JobDetail["attempts"][number];
type Artifact = JobDetail["artifacts"][number];

export const kindOptions: { value: JobKind | "all"; label: string }[] = [
  { value: "all", label: "全部类型" },
  { value: "document_inspection", label: "正文结构检查" },
  { value: "content_revision", label: "内容修订" },
  { value: "material_parse", label: "资料解析" },
  { value: "office_import", label: "Word 导入" },
  { value: "review", label: "论文评审" },
  { value: "literature_search", label: "文献检索" },
  { value: "feedback_decomposition", label: "反馈意见整理" },
  { value: "plan_adjustment", label: "计划调整" },
  { value: "configuration_probe", label: "配置试跑" },
  { value: "document_export", label: "正文导出" },
  { value: "change_record", label: "修改说明" },
  { value: "project_backup", label: "项目备份" },
  { value: "project_restore", label: "从备份恢复" },
];

export const attemptStatus: Record<Attempt["status"], { label: string; tone: "info" | "success" | "danger" | "ghost" | "warning"; live?: boolean }> = {
  running: { label: "执行中", tone: "info", live: true },
  succeeded: { label: "已完成", tone: "success" },
  failed: { label: "失败", tone: "danger" },
  cancelled: { label: "已取消", tone: "ghost" },
  lease_expired: { label: "执行中断", tone: "warning" },
};

export function attemptDiagnosis(attempt: Pick<Attempt, "status" | "error_code">) {
  switch (attempt.status) {
    case "running":
      return "正在执行，结果通过校验后才会保存。";
    case "succeeded":
      return "执行完成，结果已通过校验。";
    case "cancelled":
      return "已取消；之后返回的结果不会写入。";
    case "lease_expired":
      return "执行进程中断，本次没有产生结果。";
    case "failed":
      return serviceJobFailure({ status: "failed", error_code: attempt.error_code } as JobRead);
  }
}

/** Every attempt of a job runs on the same fixed input, scope and configuration. */
export function fixedInput(job: Pick<JobDetail, "resource_scope" | "input_snapshot" | "configuration">) {
  return JSON.stringify(
    withoutCredentials({ resource_scope: job.resource_scope ?? null, input_snapshot: job.input_snapshot ?? null, configuration: job.configuration ?? null }),
    null,
    2,
  );
}

export function jobScopeSummary(job: JobRead): string {
  const scope = job.resource_scope;
  if (isInspectionInput(scope)) return `正式稿 v${scope.document_version}`;
  if (isProbeScope(scope)) return `固定配置链 · ${Object.keys(scope.version_ids).length} 个版本`;
  if (isMaterialInput(scope)) return "固定资料原件与解析范围";
  switch (job.kind) {
    case "content_revision":
      return "固定选区、目标与资料范围";
    case "document_export":
      return scope && "format" in scope && "document_version" in scope
        ? `正文 v${scope.document_version} · ${String(scope.format).toUpperCase()}`
        : "固定正文版本";
    case "change_record":
      return scope && "from_version" in scope ? `正文 v${scope.from_version} → v${scope.to_version}` : "固定版本范围";
    case "review":
      return "固定正文、量表与执行配置";
    case "literature_search":
      return "固定检索条件与来源";
    case "feedback_decomposition":
      return "固定反馈原文范围";
    case "plan_adjustment":
      return "固定计划与调整请求";
    case "project_backup":
      return "项目数据备份";
    case "project_restore":
      return "固定备份包与校验摘要";
    case "office_import":
      return "固定 Word 原件";
    default:
      return "固定输入";
  }
}

/** A truthful next action; tasks without a generic retry contract return to their source workflow. */
export function jobNextStep(job: JobRead): string {
  if (job.status === "queued") return "等待执行；可取消，离开页面不会取消。";
  if (job.status === "running") return "服务端执行中；不推算进度，可取消。";
  if (job.status === "failed") return canRerunServiceJob(job) ? "可重试原固定输入，或回来源调整后重新发起。" : "回来源页核对输入后重新发起。";
  if (job.status === "cancelled") return canRerunServiceJob(job) ? "已取消；可用原固定输入创建新任务。" : "已取消；回来源页重新发起。";
  switch (job.kind) {
    case "content_revision":
      return "候选已生成；回助手会话审阅，不会自动采纳。";
    case "review":
      return "报告已生成；打开评审空间查看依据与未检查项。";
    case "document_export":
    case "change_record":
    case "project_backup":
      return "文件已生成；前往导出与备份下载。";
    case "material_parse":
    case "office_import":
      return "结果已保存；查看来源、识别范围与保留事项。";
    case "literature_search":
      return "检索结果已保存；回资料页查看取得范围。";
    case "feedback_decomposition":
      return "拆解候选已生成；回反馈页逐项审阅。";
    case "plan_adjustment":
      return "调整候选已生成；回计划页审阅，正式计划未改。";
    case "project_restore":
      return "恢复已完成；打开项目目录核对新项目。";
    default:
      return "结果已保存；可查看产物与固定输入。";
  }
}

export function jobSourceAction(job: JobRead): { label: string; to: RouteLocationRaw } | undefined {
  const projectId = job.project_id;
  switch (job.kind) {
    case "content_revision": {
      const to = assistantJobLink(job);
      return to ? { label: "返回助手会话审阅", to } : { label: "打开写作台", to: writingRoute(projectId) };
    }
    case "document_inspection":
      return { label: "打开写作台", to: writingRoute(projectId) };
    case "material_parse":
      return { label: "查看资料与解析版本", to: materialsRoute(projectId, isMaterialInput(job.resource_scope) ? job.resource_scope.material_id : undefined) };
    case "office_import": {
      const scope = job.resource_scope;
      return { label: "查看导入原件", to: materialsRoute(projectId, scope && "material_id" in scope ? scope.material_id : undefined) };
    }
    case "review":
      return { label: "打开评审空间", to: reviewRoute(projectId) };
    case "literature_search":
      return { label: "查看文献结果", to: materialsRoute(projectId) };
    case "feedback_decomposition":
      return { label: "返回反馈审阅", to: feedbackRoute(projectId) };
    case "plan_adjustment":
      return { label: "返回计划审阅", to: tasksRoute(projectId) };
    case "configuration_probe":
      return { label: "打开配置台", to: configurationsRoute };
    case "document_export":
    case "change_record":
    case "project_backup":
      return { label: "前往导出与备份", to: exportRoute(projectId) };
    case "project_restore":
      return { label: "打开项目目录", to: projectsRoute };
    default:
      return undefined;
  }
}

export type ArtifactPresentation = {
  id: string;
  title: string;
  facts: { label: string; value: string }[];
  content?: string;
  testid: string;
};

const configKindLabels = { api: "AI 接口", model: "模型", prompt: "提示词", agent: "智能体" } as const;
const bytes = (value: number) => `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value / 1024)} KB`;
const model = (requested: string | null, response: string | null) => [
  { label: "请求模型", value: requested ?? "未请求模型" },
  { label: "响应模型", value: response ?? "未调用或未返回模型" },
];

/** Whitelisted business summaries only; raw structures stay in the technical disclosure. */
export function artifactPresentation(artifact: Artifact): ArtifactPresentation {
  const result = artifact.result;
  const base = { id: artifact.id, testid: `${result.kind}-result` };
  switch (result.kind) {
    case "document_inspection":
      return {
        ...base,
        title: "结构统计",
        testid: "inspection-result",
        facts: [
          { label: "输入版本", value: `正式稿 v${result.document_version}` },
          { label: "节点", value: String(result.node_count) },
          { label: "段落", value: String(result.paragraph_count) },
          { label: "标题", value: String(result.heading_count) },
          { label: "表格", value: String(result.table_count) },
          ...(result.text_characters !== null ? [{ label: "文本字符", value: String(result.text_characters) }] : []),
        ],
      };
    case "configuration_probe":
      return {
        ...base,
        title: result.model_used ? "真实模型试跑结果" : "配置检查与渲染结果",
        testid: "configuration-probe-result",
        facts: [
          { label: "配置类型", value: configKindLabels[result.config_kind] },
          ...model(result.requested_model, result.response_model),
          { label: "正式内容", value: "未写入" },
        ],
        content: result.content,
      };
    case "material_parse":
      return {
        ...base,
        title: "资料解析结果",
        testid: "material-parse-result",
        facts: [
          { label: "解析文本", value: `${result.text_characters} 字符` },
          { label: "来源锚点", value: `${result.anchor_count} 个` },
          { label: "模型与正式稿", value: "未调用模型，未写入正式稿" },
        ],
      };
    case "content_revision":
      return {
        ...base,
        title: "修订候选",
        facts: [
          { label: "基础正文", value: `v${result.document_version}` },
          ...model(result.requested_model, result.response_model),
          { label: "正式稿", value: "未写入；候选仍待审阅" },
        ],
      };
    case "document_export":
      return {
        ...base,
        title: "导出文件",
        facts: [
          { label: "文件", value: result.filename },
          { label: "格式与大小", value: `${result.format.toUpperCase()} · ${bytes(result.byte_size)}` },
          { label: "正文版本", value: `v${result.document_version}` },
        ],
      };
    case "change_record":
      return {
        ...base,
        title: "修改说明",
        facts: [
          { label: "文件", value: result.filename },
          { label: "版本范围", value: `v${result.from_version} → v${result.to_version}` },
          { label: "变更记录", value: `${result.version_count} 项` },
          { label: "大小", value: bytes(result.byte_size) },
        ],
      };
    case "review":
      return {
        ...base,
        title: "评审报告",
        facts: [
          { label: "正文版本", value: `v${result.document_version}` },
          ...model(result.requested_model, result.response_model),
          { label: "正式稿", value: "未写入" },
        ],
      };
    case "literature_search":
      return {
        ...base,
        title: "文献检索结果",
        facts: [
          { label: "来源", value: result.source === "crossref" ? "Crossref" : "OpenAlex" },
          { label: "结果", value: `${result.item_count} 条` },
          { label: "正式稿", value: "未写入" },
        ],
      };
    case "feedback_decomposition":
      return {
        ...base,
        title: "反馈拆解候选",
        facts: [
          ...model(result.requested_model, result.response_model),
          { label: "候选", value: `${result.suggestion_count} 项` },
          { label: "正式任务", value: "未自动创建或完成" },
        ],
      };
    case "plan_adjustment":
      return {
        ...base,
        title: "计划调整候选",
        facts: [
          ...model(result.requested_model, result.response_model),
          { label: "调整项", value: `${result.item_count} 项` },
          { label: "受阻项", value: `${result.blocked_count} 项` },
          { label: "正式计划", value: "未写入" },
        ],
      };
    case "project_backup":
      return {
        ...base,
        title: "项目备份包",
        facts: [
          { label: "文件", value: result.filename },
          { label: "格式与大小", value: `ThesisPilot 备份 · ${bytes(result.byte_size)}` },
        ],
      };
    case "project_restore":
      return {
        ...base,
        title: "项目恢复结果",
        facts: [
          { label: "恢复结果", value: "已创建独立项目" },
          { label: "中断任务", value: `${result.interrupted_jobs} 项保持中断` },
        ],
      };
    case "office_import":
      return {
        ...base,
        title: "Word 导入结果",
        facts: [
          { label: "识别范围", value: `${result.chapter_count} 个章节 · ${result.block_count} 个内容块` },
          { label: "保留事项", value: `${result.loss_count} 项` },
          { label: "原始文件", value: "原件已保留" },
        ],
      };
  }
}

/**
 * The shared job state lists by status only. A second state over the same services adds the API's `kind`
 * filter, keeping its own records so cancel and retry stay validated against the rows it shows.
 */
export function useKindFilteredJobs(
  services: Pick<BackendServices, "sourceKey" | "jobs" | "projects">,
  projectId: Readonly<Ref<string | undefined>>,
  workspaceId: string | undefined,
) {
  const kind = ref<JobKind | "all">("all");
  const scopedProject = computed(() => (kind.value === "all" || !workspaceId ? undefined : projectId.value));
  const scoped = createServiceJobsState(
    {
      ...services,
      jobs: { ...services.jobs, list: (query, signal) => services.jobs.list({ ...query, kind: kind.value === "all" ? query.kind : kind.value }, signal) },
    },
    scopedProject,
    workspaceId,
  );
  function changeKind(next: JobKind | "all", status: JobRead["status"] | "all") {
    if (next === kind.value) return;
    // Passing through "all" resets the scoped state synchronously, so rows of the previous kind never linger.
    kind.value = "all";
    kind.value = next;
    if (next !== "all" && status !== "all") scoped.changeFilter(status);
  }
  return { kind, scoped, active: computed(() => scopedProject.value !== undefined), changeKind };
}

export { isActiveServiceJob };
