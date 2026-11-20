<script setup lang="ts">
import { RouterLink } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { ProjectRead } from "@/services";
import { feedbackRoute, materialsRoute, reviewRoute, tasksRoute, todayRoute, writingRoute } from "../workspaceRoutes";
import { deadlineLabel, documentLabel, flowLabel, projectTimeLabel, sourcesLabel, stageLabel, type Catalog, type ProjectFacts } from "./projectFacts";

defineProps<{ project: ProjectRead; current: boolean; catalog: Catalog; facts?: ProjectFacts; busy: boolean; editing: boolean }>();
defineEmits<{ edit: []; archive: [archived: boolean]; retry: [] }>();
</script>

<template>
  <article class="screen-panel project-card" :aria-labelledby="`project-${project.id}`" :data-current="current || undefined">
    <div class="project-card__body">
      <div class="project-card__topline">
        <span class="tp-label">{{ stageLabel(project, catalog) }}</span>
        <TpStatus :tone="project.archived ? 'ghost' : current ? 'info' : 'neutral'" :label="project.archived ? '已归档' : current ? '当前项目' : '进行中'" />
      </div>
      <div class="project-card__heading">
        <h2 :id="`project-${project.id}`" class="tp-heading">{{ project.name }}</h2>
        <p v-if="project.title && project.title !== project.name" class="tp-caption">{{ project.title }}</p>
      </div>
      <dl class="project-card__summary">
        <div>
          <dt>提交截止</dt>
          <dd>{{ deadlineLabel(project.deadline) }}</dd>
        </div>
        <div>
          <dt>正式稿</dt>
          <dd>{{ facts ? documentLabel(facts.document) : "正在读取…" }}</dd>
        </div>
      </dl>
    </div>

    <details class="project-card__details">
      <summary>项目详情</summary>
      <div class="project-card__facts">
        <dl class="studio-facts">
          <dt>项目流程</dt>
          <dd>{{ flowLabel(project, catalog) }}</dd>
          <dt>模板与要求</dt>
          <dd>{{ facts ? sourcesLabel(facts.sources) : "正在读取…" }}</dd>
          <dt>规划方式</dt>
          <dd>{{ project.planning_mode === "none" ? "暂不规划，按已知节点推进" : "个人规划" }}</dd>
          <template v-if="project.planning_mode === 'personal' && project.plan_note.trim()">
            <dt>规划内容</dt>
            <dd class="project-card__preserve">{{ project.plan_note }}</dd>
          </template>
          <template v-if="project.existing_artifacts.trim()">
            <dt>已有产物</dt>
            <dd class="project-card__preserve">{{ project.existing_artifacts }}</dd>
          </template>
          <dt>最近更新</dt>
          <dd><time :datetime="project.updated_at">{{ projectTimeLabel(project.updated_at) }}</time></dd>
        </dl>
        <TpButton
          v-if="catalog.state === 'failed' || facts?.sources.state === 'failed' || facts?.document.state === 'failed'"
          size="sm"
          variant="ghost"
          @click="$emit('retry')"
          >重新读取项目详情</TpButton
        >
      </div>
    </details>

    <div class="screen-actions project-card__actions">
      <template v-if="project.archived">
        <TpButton variant="primary" :loading="busy" :disabled="busy" :label="`恢复项目：${project.name}`" @click="$emit('archive', false)">恢复项目</TpButton>
      </template>
      <template v-else>
        <RouterLink class="tp-btn tp-btn--primary" :to="writingRoute(project.id)">进入项目</RouterLink>
        <TpButton :disabled="busy || editing" :label="`编辑项目：${project.name}`" @click="$emit('edit')">编辑</TpButton>
        <TpButton variant="ghost" :loading="busy" :disabled="busy" :label="`归档项目：${project.name}`" @click="$emit('archive', true)">归档</TpButton>
      </template>
    </div>
    <nav v-if="!project.archived" class="project-card__links" :aria-label="`${project.name} 的入口`">
      <RouterLink :to="todayRoute(project.id)">今日与建议</RouterLink>
      <RouterLink :to="writingRoute(project.id)">文稿与版本</RouterLink>
      <RouterLink :to="tasksRoute(project.id)">任务与证据</RouterLink>
      <RouterLink :to="materialsRoute(project.id)">资料与绑定</RouterLink>
      <RouterLink :to="feedbackRoute(project.id)">导师反馈</RouterLink>
      <RouterLink :to="reviewRoute(project.id)">评审与报告</RouterLink>
    </nav>
  </article>
</template>

<style scoped>
.project-card {
  align-self: start;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  transition:
    border-color var(--tp-dur-fast) var(--tp-ease-standard),
    box-shadow var(--tp-dur-fast) var(--tp-ease-standard);
}
.project-card[data-current] {
  border-color: var(--tp-accent);
}
.project-card__body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px 24px 16px;
}
.project-card__topline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}
.project-card__topline > .tp-label {
  min-width: 0;
  padding-top: 5px;
  overflow-wrap: anywhere;
}
.project-card__topline > .tp-status {
  flex: none;
}
.project-card__heading {
  min-width: 0;
}
.project-card__heading h2,
.project-card__heading p {
  overflow-wrap: anywhere;
}
.project-card__heading p {
  margin-top: 8px;
  line-height: 1.7;
}
.project-card__summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin: 0;
}
.project-card__summary div {
  min-width: 0;
  padding-top: 12px;
  border-top: 1px solid var(--tp-line);
}
.project-card__summary dt {
  color: var(--tp-text-muted);
  font-size: 12px;
}
.project-card__summary dd {
  margin-top: 4px;
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.project-card__details {
  margin: 0 24px;
  border-top: 1px solid var(--tp-line);
  color: var(--tp-text-muted);
}
.project-card__details > summary {
  display: flex;
  min-height: 40px;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
}
.project-card__details > summary:hover {
  color: var(--tp-text);
}
.project-card__facts {
  padding: 4px 0 16px;
}
.project-card__facts .tp-btn {
  margin-top: 12px;
}
.project-card__preserve {
  color: var(--tp-text);
  white-space: pre-wrap;
}
.project-card__actions {
  padding: 16px 24px 20px;
  margin-top: auto;
}
.project-card__links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 12px 24px;
  border-top: 1px solid var(--tp-line);
  background: var(--tp-surface-sunken);
}
.project-card__links a {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  color: var(--tp-text-muted);
  font-size: 12px;
  text-underline-offset: 4px;
}
.project-card__links a:hover {
  color: var(--tp-accent);
  text-decoration: underline;
}
@media (max-width: 480px) {
  .project-card__body {
    padding: 20px 20px 12px;
  }
  .project-card__details {
    margin-inline: 20px;
  }
  .project-card__actions {
    padding: 12px 20px 16px;
  }
  .project-card__links {
    padding-inline: 20px;
  }
  .project-card__summary {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
}
</style>
