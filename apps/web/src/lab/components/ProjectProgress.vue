<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import StageRoute from "@/components/domain/StageRoute.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpDialog from "@/components/ui/TpDialog.vue";
import TpSaveIndicator from "@/components/ui/TpSaveIndicator.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import { usePreviewWorkspaceStore } from "../state/previewWorkspace";
import { useSettingsState } from "../state/settingsState";
import { projectDeadlineSummary, projectStageProgress, savedClock, type StageProgressState } from "../state/projectProgress";

const workspace = usePreviewWorkspaceStore();
const settings = useSettingsState();
const now = ref(new Date());
const open = ref(false);
const confirmed = computed(() =>
  ((workspace.current.modules.stageProgress as StageProgressState | undefined)?.confirmations ?? [])
    .filter((item) => item.workflowVersion === workspace.current.workflowVersion)
    .map((item) => item.stageId),
);
const progress = computed(() =>
  projectStageProgress(settings.value.workflowHistory, workspace.current.workflowVersion, workspace.current.stage, confirmed.value),
);
const deadline = computed(() => projectDeadlineSummary(workspace.current.deadline, now.value));
const at = computed(() => savedClock(workspace.lastPersistedAt || workspace.current.document.savedAt));
const progressLabel = computed(() =>
  progress.value.known
    ? `当前阶段：${workspace.current.stage}，第 ${progress.value.currentIndex + 1} / ${progress.value.stages.length} 阶段`
    : progress.value.issue,
);
let timer: ReturnType<typeof setInterval> | undefined;
const refreshClock = () => (now.value = new Date());
onMounted(() => {
  timer = setInterval(refreshClock, 60_000);
  window.addEventListener("focus", refreshClock);
  document.addEventListener("visibilitychange", refreshClock);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  window.removeEventListener("focus", refreshClock);
  document.removeEventListener("visibilitychange", refreshClock);
});
</script>

<template>
  <div class="project-progress">
    <div class="project-progress__content">
      <div class="project-progress__route" :class="{ 'is-unknown': !progress.known }">
        <div v-if="progress.stages.length" class="project-progress__route-scroll">
          <StageRoute :stages="progress.stages" compact />
        </div>
        <span v-else class="project-progress__unknown">{{ progress.issue }}</span>
        <span v-if="progress.stages.length && !progress.known" class="project-progress__issue">阶段待核对</span>
        <button type="button" class="project-progress__open" aria-label="查看毕设阶段进度" :title="progressLabel + '；点击查看完成条件'" @click="open = true" />
      </div>
      <div class="project-progress__meta">
        <span
          class="project-progress__deadline"
          :data-state="deadline.kind"
          :aria-label="deadline.label"
          :title="'项目提交截止：' + (workspace.current.deadline || '未设置')"
        >
          <template v-if="deadline.kind === 'future'">距论文提交 <b class="tp-num">{{ deadline.days }}</b> 天</template>
          <template v-else-if="deadline.kind === 'overdue'">已逾期 <b class="tp-num">{{ Math.abs(deadline.days!) }}</b> 天</template>
          <template v-else>{{ deadline.label }}</template>
        </span>
        <div class="project-progress__saved" :title="workspace.saveError || '此浏览器本地保存；可下载项目备份'">
          <TpSaveIndicator :state="workspace.saveStatus" :at="at" @retry="workspace.retrySave()" />
        </div>
        <TpVersion :v="workspace.current.document.version" prefix="正文 " />
      </div>
    </div>
    <TpDialog v-model:open="open" title="毕设阶段与完成条件" :description="progressLabel">
      <p class="project-progress__explanation">航线显示项目当前所处阶段，不代表论文质量。查看条件不会切换阶段；完成确认在今日页进行。</p>
      <p v-if="progress.issue" class="project-progress__warning">{{ progress.issue }}，请在流程配置中核对项目绑定。</p>
      <ol class="project-progress__details">
        <li v-for="(stage, index) in progress.sourceStages" :key="stage.id" :data-current="index === progress.currentIndex">
          <header>
            <b>{{ stage.name }}</b
            ><span>{{ confirmed.includes(stage.id) ? "学生已确认" : index === progress.currentIndex ? "当前阶段" : "尚未登记确认" }}</span>
          </header>
          <p><span>完成条件</span>{{ stage.condition || "尚未配置" }}</p>
          <p><span>所需产物</span>{{ stage.deliverables || "尚未配置" }}</p>
          <p><span>阶段截止</span>{{ stage.deadline || "尚未设置" }}</p>
        </li>
      </ol>
      <template #actions>
        <RouterLink to="/screens/settings?tab=workflow" class="tp-btn tp-btn--ghost" @click="open = false">查看流程配置</RouterLink>
        <RouterLink to="/screens/plan" class="tp-btn tp-btn--outline" @click="open = false">查看计划</RouterLink>
        <TpButton variant="primary" @click="open = false">关闭</TpButton>
      </template>
    </TpDialog>
  </div>
</template>

<style scoped>
.project-progress {
  flex: 1;
  min-width: 0;
  container-type: inline-size;
}
.project-progress__content {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) max-content;
  align-items: center;
  gap: 20px;
}
.project-progress__route {
  position: relative;
  min-width: 0;
  max-width: 480px;
  padding: 8px 0;
}
.project-progress__route-scroll {
  min-width: 0;
  overflow-x: auto;
  padding: 4px 0;
}
.project-progress__route :deep(.tp-route) {
  min-width: 280px;
}
.project-progress__open {
  position: absolute;
  inset: 0;
  cursor: pointer;
  border-radius: var(--tp-radius-s);
  background: transparent;
}
.project-progress__open:focus-visible {
  outline: 2px solid var(--tp-focus);
  outline-offset: 2px;
}
.project-progress__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  min-width: 0;
  font-size: 12px;
  color: var(--tp-text-muted);
}
.project-progress__deadline {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}
.project-progress__deadline b {
  color: var(--tp-text);
  font-size: 24px;
  line-height: 1;
}
.project-progress__deadline[data-state="overdue"],
.project-progress__deadline[data-state="overdue"] b {
  color: var(--tp-danger-content);
}
.project-progress__saved {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  border-left: 1px solid var(--tp-line);
  padding-left: 12px;
  white-space: nowrap;
}
.project-progress__preview {
  font-size: 11px;
}
.project-progress__unknown,
.project-progress__issue {
  color: var(--tp-text-muted);
  font-size: 12px;
}
.project-progress__issue {
  display: block;
  margin-top: 4px;
  text-align: center;
}
.project-progress__explanation,
.project-progress__warning {
  font-size: 13px;
  line-height: 1.7;
  color: var(--tp-text-muted);
  margin-bottom: 16px;
}
.project-progress__warning {
  padding: 12px;
  border: 1px dashed var(--tp-ghost-line);
}
.project-progress__details {
  display: grid;
  gap: 12px;
  max-height: 48vh;
  overflow-y: auto;
}
.project-progress__details li {
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  padding: 12px 16px;
}
.project-progress__details li[data-current="true"] {
  border-color: var(--tp-accent);
  background-color: color-mix(in srgb, var(--tp-accent) 5%, var(--tp-surface));
}
.project-progress__details header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.project-progress__details header > span,
.project-progress__details p {
  font-size: 12px;
  line-height: 1.7;
}
.project-progress__details p {
  overflow-wrap: anywhere;
}
.project-progress__details p > span {
  display: inline-block;
  color: var(--tp-text-muted);
  margin-right: 12px;
}
@container (max-width: 580px) {
  .project-progress__content {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
  .project-progress__route {
    max-width: none;
    padding: 4px 0;
  }
  .project-progress__meta {
    justify-content: center;
    gap: 8px;
    padding-bottom: 4px;
  }
  .project-progress__deadline b {
    font-size: 20px;
  }
  .project-progress__saved {
    padding-left: 8px;
  }
}
</style>
