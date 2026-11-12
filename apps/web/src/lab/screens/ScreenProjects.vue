<script setup lang="ts">
import { listMotionHooks } from "@/design/motion";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import { computed, ref } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { usePreviewWorkspaceStore, type PreviewProject } from "../state/previewWorkspace";
import { createSettingsState, type SettingsState } from "../state/settingsState";
import { validatePlanState, validatePlan } from "../state/planState";
const workspace = usePreviewWorkspaceStore();
const editing = ref<string | null>(null);
const formOpen = ref(false);
const title = ref("");
const deadline = ref("2026-12-25");
const planning = ref("");
const stage = ref("开题");
const error = ref("");
const showArchive = ref(false);
const importMessage = ref("");
const priorTitles = ref("");
const priorSource = ref("");
const priorConfirmed = ref(false);
const listed = computed(() => workspace.projects.filter((p) => p.archived === showArchive.value));
const availableStages = computed(() => {
  const project = workspace.projects.find((p) => p.id === editing.value);
  const settings = (project?.modules.settings as SettingsState | undefined) ?? createSettingsState();
  return (settings.workflowHistory.find((v) => v.version === (project?.workflowVersion ?? 1))?.stages ?? []).filter((s) => s.enabled).map((s) => s.name);
});
function open(project?: PreviewProject) {
  editing.value = project?.id ?? null;
  title.value = project?.title ?? "";
  deadline.value = project?.deadline ?? "2026-12-25";
  planning.value = project?.planning ?? "";
  stage.value = project?.stage ?? "开题";
  formOpen.value = true;
  error.value = "";
  priorTitles.value = "";
  priorSource.value = "";
  priorConfirmed.value = false;
}
function save() {
  const parsedDate = Date.parse(deadline.value);
  if (
    !title.value.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(deadline.value) ||
    !Number.isFinite(parsedDate) ||
    new Date(parsedDate).toISOString().slice(0, 10) !== deadline.value ||
    !availableStages.value.includes(stage.value)
  ) {
    error.value = "请填写论文题目、有效截止日期，并选择绑定流程中的阶段。";
    return;
  }
  const existing = editing.value ? workspace.projects.find((x) => x.id === editing.value) : undefined;
  if (existing && existing.deadline !== deadline.value && validatePlanState(existing.modules.plan)) {
    const problems = validatePlan(existing.modules.plan.tasks, deadline.value);
    if (problems.length) {
      error.value = problems.join(" ") + " 请先在计划页调整任务，项目尚未保存。";
      return;
    }
  }
  if (priorTitles.value.trim() && (!priorSource.value.trim() || !priorConfirmed.value)) {
    error.value = "请补充已有产物的来源，并确认这是你已核对的进展。不会自动标记阶段完成。";
    return;
  }
  const p = editing.value ? workspace.projects.find((x) => x.id === editing.value)! : workspace.createProject(title.value.trim());
  p.title = title.value.trim();
  p.short = p.title.length > 14 ? p.title.slice(0, 14) + "…" : p.title;
  p.deadline = deadline.value;
  p.planning = planning.value;
  if (validatePlanState(p.modules.plan)) {
    p.modules.plan.planning = planning.value;
    p.modules.plan.planningMode = planning.value.trim() ? "personal" : "none";
  }
  p.stage = stage.value;
  if (priorTitles.value.trim()) {
    p.priorWork ??= [];
    for (const item of priorTitles.value
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)) {
      p.priorWork.push({ title: item, source: priorSource.value.trim(), confirmedAt: new Date().toISOString() });
    }
  }
  formOpen.value = false;
}
function archive(p: PreviewProject) {
  if (p.id === workspace.activeId) {
    const next = workspace.projects.find((x) => !x.archived && x.id !== p.id);
    if (!next) {
      error.value = "请先创建或恢复另一个项目，再归档当前项目。";
      return;
    }
    workspace.switchProject(next.id);
  }
  p.archived = true;
}
async function importText(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".txt")) {
    importMessage.value = "当前仅支持纯文本导入。DOCX 需经解析后导入，现有文稿未改变；原件可在资料页保存。";
    return;
  }
  if (file.size > 1024 * 1024) {
    importMessage.value = "支持 1 MB 以内的 UTF-8 文本，现有文稿未改变。";
    return;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    if (!text.trim()) throw new Error("文件没有可导入的文字，请选择非空 UTF-8 文本。");
    const p = workspace.createProject(file.name.replace(/\.txt$/i, ""));
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    workspace.saveDocument(
      escaped
        .split(/\r?\n/)
        .map((x) => `<p>${x || "<br>"}</p>`)
        .join(""),
      "文本导入",
    );
    p.stage = "论文撰写";
    importMessage.value = "已创建独立项目并导入文本，可继续编辑。";
  } catch (e) {
    importMessage.value =
      e instanceof TypeError
        ? "无法读取 UTF-8 文本，请转换编码后重试；现有项目未改变。"
        : e instanceof Error
          ? e.message
          : "文件读取失败，现有项目未改变，可重新选择文件。";
  }
}
</script>
<template>
  <div class="screen-page">
    <header class="screen-heading">
      <div>
        <p class="tp-label">Projects · 每一程，都有来处</p>
        <h1 class="tp-display mt-3">论文项目</h1>
        <p class="screen-lead">从一张白纸开始，或带着已有的积累继续。</p>
      </div>
      <div class="screen-actions">
        <TpButton variant="primary" @click="open()">新建项目</TpButton
        ><label class="tp-btn tp-btn--outline"
          >导入已有论文<input class="studio-file-input" type="file" accept=".txt,.docx" aria-label="导入已有论文" @change="importText"
        /></label>
      </div>
    </header>
    <Transition name="tp-swap" mode="out-in">
      <p :key="importMessage" v-if="importMessage" role="status" class="studio-notice">{{ importMessage }}</p>
    </Transition>
    <Transition name="tp-swap" mode="out-in">
      <p :key="error" v-if="error && !formOpen" role="alert" class="studio-notice">{{ error }}</p>
    </Transition>
    <Transition name="tp-swap" mode="out-in">
      <form
        :key="editing ?? 'new-project'"
        v-if="formOpen"
        class="screen-panel studio-body studio-stack"
        @submit.prevent="save"
        @keydown.esc="formOpen = false"
      >
        <h2 class="tp-subheading">{{ editing ? "编辑项目" : "开始一个新项目" }}</h2>
        <TpField v-slot="{ id }" label="论文题目" required :error="error"
          ><input :id="id" v-model="title" class="tp-input" maxlength="160" autofocus
        /></TpField>
        <div class="studio-form-grid">
          <TpField v-slot="{ id }" label="重要截止日期" required><TpDatePicker :id="id" v-model="deadline" type="date" /></TpField
          ><TpField v-slot="{ id }" label="当前阶段"
            ><TpSelect
              :id="id"
              v-model="stage"
              :options="[
                ...(!availableStages.includes(stage) ? [{ value: stage, label: `${stage}（不在当前流程中）`, disabled: true }] : []),
                ...availableStages.map((stage) => ({ value: stage, label: stage })),
              ]"
          /></TpField>
        </div>
        <TpField v-slot="{ id }" label="个人规划" optional hint="可以暂不填写。系统会依据任务、产物和截止日期提醒，不推测你的效率。">
          <textarea :id="id" v-model="planning" rows="3" class="tp-input" />
        </TpField>
        <details class="studio-notice">
          <summary>登记已有进度与完成产物（可选）</summary>
          <div class="studio-stack mt-4">
            <TpField v-slot="{ id }" label="已有产物" optional hint="每行一项，例如开题报告、实验结果表。这里只登记事实，不自动完成任务。">
              <textarea :id="id" v-model="priorTitles" rows="3" class="tp-input" />
            </TpField>
            <TpField v-slot="{ id }" label="产物来源与版本" optional
              ><input :id="id" v-model="priorSource" class="tp-input" placeholder="例如：本地实验结果表 v2，已核对"
            /></TpField>
            <label class="studio-check"
              ><input v-model="priorConfirmed" type="checkbox" class="checkbox checkbox-sm" /><span
                >我已核对这些已有产物，之后会在任务中关联具体证据。</span
              ></label
            >
          </div>
        </details>
        <div class="screen-actions">
          <TpButton type="submit" variant="primary">{{ editing ? "保存项目" : "从空白文稿开始" }}</TpButton
          ><TpButton variant="ghost" @click="formOpen = false">取消</TpButton>
        </div>
      </form>
    </Transition>
    <div class="screen-actions">
      <TpButton :variant="!showArchive ? 'tonal' : 'ghost'" @click="showArchive = false">进行中的项目</TpButton
      ><TpButton :variant="showArchive ? 'tonal' : 'ghost'" @click="showArchive = true">归档项目</TpButton>
    </div>
    <TransitionGroup name="tp-list" tag="div" v-bind="listMotionHooks" class="tp-list-group studio-grid">
      <article v-for="p in listed" :key="p.id" class="screen-panel studio-body studio-stack">
        <div class="studio-row">
          <span class="tp-label">{{ p.stage }}</span
          ><TpStatus
            :tone="p.id === workspace.activeId ? 'info' : 'neutral'"
            :label="p.id === workspace.activeId ? '当前项目' : p.archived ? '已归档' : '进行中'"
          />
        </div>
        <h2 class="tp-title">{{ p.title }}</h2>
        <dl class="studio-facts">
          <dt>提交截止</dt>
          <dd>{{ p.deadline }}</dd>
          <dt>绑定版本</dt>
          <dd>
            流程 v{{ p.workflowVersion }} · {{ p.templateVersion ? "模板 v" + p.templateVersion : "模板未绑定" }} ·
            {{ p.requirementVersion ? "要求 v" + p.requirementVersion : "要求未绑定" }}
          </dd>
          <dt>个人规划</dt>
          <dd>{{ p.planning || "暂未填写 · 按已知节点推进" }}</dd>
          <dt>正文</dt>
          <dd>v{{ p.document.version }} · {{ p.document.history.length }} 条版本记录</dd>
        </dl>
        <details v-if="p.priorWork?.length" class="tp-caption">
          <summary>已登记 {{ p.priorWork.length }} 项已有产物</summary>
          <p v-for="(work, index) in p.priorWork" :key="index" class="mt-2">
            <b>{{ work.title }}</b> · {{ work.source }}<br />学生核对于 {{ new Date(work.confirmedAt).toLocaleString("zh-CN") }}
          </p>
        </details>
        <div class="screen-actions">
          <TpButton v-if="p.archived" variant="primary" @click="p.archived = false">恢复项目</TpButton
          ><template v-else
            ><RouterLink class="tp-btn tp-btn--primary" to="/screens/today" @click="workspace.switchProject(p.id)">进入项目</RouterLink
            ><TpButton @click="open(p)">编辑</TpButton><TpButton variant="ghost" @click="archive(p)">归档</TpButton></template
          >
        </div>
        <div v-if="!p.archived" class="screen-actions">
          <RouterLink class="studio-link" to="/screens/write?panel=versions" @click="workspace.switchProject(p.id)">文稿与版本 ↗</RouterLink>
          <RouterLink class="studio-link" to="/screens/plan" @click="workspace.switchProject(p.id)">任务与证据 ↗</RouterLink>
          <RouterLink class="studio-link" to="/screens/library" @click="workspace.switchProject(p.id)">资料与绑定 ↗</RouterLink>
          <RouterLink class="studio-link" to="/screens/feedback" @click="workspace.switchProject(p.id)">导师反馈 ↗</RouterLink>
          <RouterLink class="studio-link" to="/screens/review" @click="workspace.switchProject(p.id)">评审报告 ↗</RouterLink>
        </div>
      </article>
    </TransitionGroup>
    <Transition name="tp-swap">
      <section v-if="!listed.length" class="studio-empty">
        <h2 class="tp-subheading">这里还没有{{ showArchive ? "归档" : "进行中的" }}项目</h2>
        <p class="tp-caption mt-3">归档保留正文、版本与关联数据，可以随时恢复。</p>
      </section>
    </Transition>
  </div>
</template>
