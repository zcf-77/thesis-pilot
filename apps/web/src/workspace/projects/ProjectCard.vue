<script setup lang="ts">
import { RouterLink } from "vue-router";
import TpButton from "@/components/ui/TpButton.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { ProjectRead } from "@/services";
import { feedbackRoute, materialsRoute, tasksRoute, writingRoute } from "../workspaceRoutes";
import { deadlineLabel, documentLabel, flowLabel, planningLabel, sourcesLabel, stageLabel, type Catalog, type ProjectFacts } from "./projectFacts";

defineProps<{ project: ProjectRead; current: boolean; catalog: Catalog; facts?: ProjectFacts; busy: boolean; editing: boolean }>();
defineEmits<{ edit: []; archive: [archived: boolean] }>();
</script>

<template>
  <article class="screen-panel studio-body studio-stack project-card" :aria-labelledby="`project-${project.id}`" :data-current="current || undefined">
    <div class="studio-row">
      <span class="tp-label">{{ stageLabel(project, catalog) }}</span>
      <TpStatus :tone="project.archived ? 'ghost' : current ? 'info' : 'neutral'" :label="project.archived ? '已归档' : current ? '当前项目' : '进行中'" />
    </div>
    <div>
      <h2 :id="`project-${project.id}`" class="tp-title">{{ project.name }}</h2>
      <p v-if="project.title && project.title !== project.name" class="tp-caption mt-2">{{ project.title }}</p>
    </div>
    <dl class="studio-facts">
      <dt>提交截止</dt>
      <dd>{{ deadlineLabel(project.deadline) }}</dd>
      <dt>绑定版本</dt>
      <dd>{{ flowLabel(project, catalog) }} · {{ facts ? sourcesLabel(facts.sources) : "读取模板与要求…" }}</dd>
      <dt>个人规划</dt>
      <dd>{{ planningLabel(project) }}</dd>
      <dt>正文</dt>
      <dd>{{ facts ? documentLabel(facts.document) : "读取正文…" }}</dd>
    </dl>
    <div class="screen-actions">
      <template v-if="project.archived">
        <TpButton variant="primary" :loading="busy" :disabled="busy" :label="`恢复项目：${project.name}`" @click="$emit('archive', false)">恢复项目</TpButton>
      </template>
      <template v-else>
        <RouterLink class="tp-btn tp-btn--primary" :to="writingRoute(project.id)">进入项目</RouterLink>
        <TpButton :disabled="busy || editing" :label="`编辑项目：${project.name}`" @click="$emit('edit')">编辑</TpButton>
        <TpButton variant="ghost" :loading="busy" :disabled="busy" :label="`归档项目：${project.name}`" @click="$emit('archive', true)">归档</TpButton>
      </template>
    </div>
    <nav v-if="!project.archived" class="screen-actions project-card__links" :aria-label="`${project.name} 的入口`">
      <RouterLink class="studio-link" :to="writingRoute(project.id)">文稿与版本 ↗</RouterLink>
      <RouterLink class="studio-link" :to="tasksRoute(project.id)">任务与证据 ↗</RouterLink>
      <RouterLink class="studio-link" :to="materialsRoute(project.id)">资料与绑定 ↗</RouterLink>
      <RouterLink class="studio-link" :to="feedbackRoute(project.id)">导师反馈 ↗</RouterLink>
    </nav>
  </article>
</template>

<style scoped>
.project-card {
  align-self: start;
}
.project-card__links {
  gap: 8px 16px;
}
</style>
