<script setup lang="ts">
import { listMotionHooks } from "@/design/motion";
import { ref } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { usePreviewWorkspaceStore, type PreviewProject } from "../state/previewWorkspace";
import { useReviewState, reviewReportHtml } from "../state/reviewState";
import { downloadPreviewFile, escapeHtml, parsePreviewBackup, serializePreviewBackup, normalizeRestoredModules } from "../state/previewBackup";
import { startProjectJob } from "../state/jobState";
const workspace = usePreviewWorkspaceStore();
const review = useReviewState();
const status = ref("");
const error = ref("");
const prepared = ref<PreviewProject | null>(null);
const simulateDownloadFailure = ref(false);
interface ExportPayload {
  filename: string;
  content: string;
  type: string;
  title: string;
  version: number;
  projectId: string;
}
const lastExport = ref<ExportPayload | null>(null);
function exportFile(payload: ExportPayload) {
  lastExport.value = payload;
  error.value = "";
  status.value = "";
  const project = workspace.projects.find((p) => p.id === payload.projectId);
  if (!project) {
    error.value = "导出来源项目不存在，请重新准备文件。";
    return;
  }
  const task = startProjectJob(
    project,
    {
      title: payload.title,
      kind: "导出",
      route: "/screens/export",
      input: `正文 v${payload.version}`,
      snapshot: { docVersion: payload.version },
      sourceId: payload.filename,
    },
    { retry: () => exportFile(payload) },
  );
  const result = simulateDownloadFailure.value
    ? { ok: false as const, error: "模拟文件准备失败，所选版本与内容已保留。关闭故障模拟后可重试。" }
    : downloadPreviewFile(payload.filename, payload.content, payload.type);
  if (!result.ok) {
    error.value = result.error;
    task.finish("failed", result.error);
    return;
  }
  status.value = `${payload.title}已准备，浏览器已接收下载请求。`;
  task.finish("done", "文件已生成并交由浏览器下载，请在下载列表中确认保存位置。");
}
function download(filename: string, content: string, type: string, title: string, version = workspace.current.document.version) {
  exportFile({ filename, content, type, title, version, projectId: workspace.current.id });
}
function documentExport(format: "html" | "txt") {
  const p = workspace.current;
  const doc = new DOMParser().parseFromString(p.document.html, "text/html");
  const content =
    format === "html"
      ? `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>${escapeHtml(p.title)}</title><style>body{max-width:48em;margin:3em auto;padding:1em;font:17px/1.9 serif}table{border-collapse:collapse}td,th{border:1px solid #999;padding:.5em}</style><body>${p.document.html}</body></html>`
      : doc.body.innerText || doc.body.textContent || "";
  download(
    `thesispilot-v${p.document.version}.${format}`,
    content,
    format === "html" ? "text/html;charset=utf-8" : "text/plain;charset=utf-8",
    `正文 v${p.document.version} 的 ${format.toUpperCase()} 文件`,
  );
}
function backup() {
  download("thesispilot-project-backup.json", serializePreviewBackup(workspace.current), "application/json", "当前项目备份");
}
function changes() {
  const plain = (html: string) => new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  const history = workspace.current.document.history;
  const rows = history
    .slice(1)
    .map((v, i) => `v${history[i]!.version} → v${v.version} · ${v.at}\n成因：${v.cause}\n修改前：\n${plain(history[i]!.html)}\n修改后：\n${plain(v.html)}`);
  const writing = workspace.current.modules.writing as
    | { decisions?: unknown[]; history?: unknown[]; candidateHistory?: unknown[]; candidate?: unknown }
    | undefined;
  if (writing?.decisions?.length) rows.push("修订决定记录\n" + JSON.stringify(writing.decisions, null, 2));
  if (writing?.history?.length || writing?.candidateHistory?.length)
    rows.push("候选、差异、保护结果与来源\n" + JSON.stringify(writing.history ?? writing.candidateHistory, null, 2));
  else if (writing?.candidate) rows.push("当前候选与依据\n" + JSON.stringify(writing.candidate, null, 2));
  download("thesispilot-change-record.txt", rows.join("\n\n") || "当前项目尚无正文变更记录。", "text/plain;charset=utf-8", "实际版本与修订变更记录");
}
async function prepare(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  error.value = "";
  prepared.value = null;
  lastExport.value = null;
  if (!file) return;
  try {
    if (file.size > 24 * 1024 * 1024) throw new Error("备份超过24MB预览限制。");
    prepared.value = parsePreviewBackup(await file.text());
  } catch (e) {
    error.value = e instanceof Error ? e.message : "无法读取备份，现有项目未改变。";
  }
}
function restore() {
  if (!prepared.value) return;
  if (!workspace.recoverStorage()) {
    error.value = workspace.saveError;
    return;
  }
  const project = JSON.parse(JSON.stringify(prepared.value)) as PreviewProject;
  normalizeRestoredModules(project.modules, { projectCopy: true });
  project.id = crypto.randomUUID();
  for (const event of project.events ?? []) event.projectId = project.id;
  const jobs = project.modules.jobs as { jobs?: { id: string; projectId?: string }[] } | undefined;
  for (const job of jobs?.jobs ?? []) {
    job.id = crypto.randomUUID();
    job.projectId = project.id;
  }
  const inbox = project.modules.inbox as { suggestions?: { projectId?: string }[] } | undefined;
  for (const suggestion of inbox?.suggestions ?? []) if (suggestion.projectId) suggestion.projectId = project.id;
  project.title += "（恢复副本）";
  project.short = "恢复 · " + project.short;
  project.archived = false;
  workspace.projects.push(project);
  workspace.switchProject(project.id);
  const saved = workspace.persistNow();
  prepared.value = null;
  status.value = "已恢复为独立项目，原项目及历史完整保留。" + (saved ? "已保存在本机。" : "本地保存未成功，请保留备份并重试。");
}
</script>
<template>
  <div class="screen-page">
    <header class="screen-heading">
      <div>
        <p class="tp-label">Deliver · 把每一份努力，妥善留下</p>
        <h1 class="tp-display mt-3">导出与备份</h1>
        <p class="screen-lead">导出可阅读的文稿，或保存能够继续工作的项目备份。</p>
      </div>
      <TpStatus tone="info" :label="'正文 v' + workspace.current.document.version" />
    </header>
    <Transition name="tp-swap" mode="out-in">
      <p :key="status" v-if="status" class="studio-notice" role="status">{{ status }}</p>
    </Transition>
    <Transition name="tp-swap" mode="out-in">
      <div :key="error" v-if="error" role="alert" class="studio-notice">
        <p>{{ error }}</p>
        <TpButton v-if="lastExport" size="sm" class="mt-3" @click="exportFile(lastExport)">重试文件准备</TpButton>
      </div>
    </Transition>
    <div class="studio-grid">
      <section class="screen-panel studio-body studio-stack">
        <p class="tp-label">01 / Document</p>
        <h2 class="tp-title">论文与修改记录</h2>
        <p class="studio-copy">输出当前正文。HTML 保留基础标题、段落和表格；纯文本适合快速阅读与复制。</p>
        <div class="screen-actions">
          <TpButton variant="primary" @click="documentExport('html')">导出 HTML 文稿</TpButton><TpButton @click="documentExport('txt')">导出纯文本</TpButton
          ><TpButton variant="ghost" @click="changes">导出修改记录</TpButton>
        </div>
        <div class="studio-notice">
          <b>DOCX / PDF · 尚未接入转换</b>
          <p class="tp-caption mt-2">复杂分页、页眉页脚与公式保真不能保证。请先使用已支持格式，或在办公软件中继续排版。</p>
        </div>
      </section>
      <section class="screen-panel studio-body studio-stack">
        <p class="tp-label">02 / Review</p>
        <h2 class="tp-title">评审报告</h2>
        <p class="studio-copy">报告包含输入版本、检查范围、问题和未检查项。参考评分不代表导师成绩。</p>
        <TransitionGroup name="tp-list" tag="div" class="tp-list-group studio-stack" v-bind="listMotionHooks">
          <div v-for="report in review.reports.slice(0, 3)" :key="report.id" class="studio-row">
            <span>正文 v{{ report.input.docVersion }} · {{ report.input.scope }}</span
            ><TpButton
              size="sm"
              @click="
                download(
                  'thesispilot-review-' + report.input.docVersion + '.html',
                  reviewReportHtml(report),
                  'text/html;charset=utf-8',
                  '评审报告 v' + report.input.docVersion,
                  report.input.docVersion,
                )
              "
              >下载报告</TpButton
            >
          </div>
        </TransitionGroup>
        <RouterLink v-if="!review.reports.length" class="studio-link" to="/screens/review">先完成一次评审 ↗</RouterLink
        ><RouterLink v-else class="studio-link" to="/screens/review">查看全部报告 ↗</RouterLink>
      </section>
      <section class="screen-panel studio-body studio-stack">
        <p class="tp-label">03 / Keep</p>
        <h2 class="tp-title">完整项目备份</h2>
        <p class="studio-copy">保留文稿、版本、任务、反馈、资料、操作历史和已创建的模块状态。本机自动保存支持刷新继续，下载备份可用于换设备或额外留存。</p>
        <TpButton variant="primary" @click="backup">下载项目备份 JSON</TpButton>
        <p class="tp-caption">备份包含你输入的内容，请妥善保管。账户偏好与其他项目不包含在本文件中。</p>
      </section>
      <section class="screen-panel studio-body studio-stack">
        <p class="tp-label">04 / Continue</p>
        <h2 class="tp-title">从备份继续</h2>
        <p class="studio-copy">先检查文件，再恢复为独立项目。当前项目不会被覆盖。</p>
        <label class="tp-btn tp-btn--outline"
          >选择 JSON 备份<input class="studio-file-input" type="file" accept=".json,application/json" aria-label="选择 JSON 备份" @change="prepare"
        /></label>
        <Transition name="tp-swap" mode="out-in">
          <div :key="prepared.id" v-if="prepared" class="studio-notice studio-stack">
            <b>{{ prepared.title }}</b>
            <p class="tp-caption">
              正文 v{{ prepared.document.version }} · {{ prepared.document.history.length }} 个版本 · {{ Object.keys(prepared.modules).length }} 个模块
            </p>
            <div class="screen-actions">
              <TpButton variant="primary" @click="restore">恢复为新项目</TpButton><TpButton variant="ghost" @click="prepared = null">取消</TpButton>
            </div>
          </div>
        </Transition>
      </section>
    </div>
    <details class="tp-caption mt-6">
      <summary>预览场景 · 下载准备失败</summary>
      <label class="studio-check mt-3"
        ><input v-model="simulateDownloadFailure" type="checkbox" class="checkbox checkbox-sm" /><span>模拟文件准备失败，保留输入并允许重试</span></label
      >
    </details>
  </div>
</template>
