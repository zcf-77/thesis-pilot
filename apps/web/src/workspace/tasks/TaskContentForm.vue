<script setup lang="ts">
import { computed, shallowRef } from "vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import type { BackendServices, DocumentRead } from "@/services";
import EvidencePicker from "./EvidencePicker.vue";
import { documentTextblocks, type TaskContentDraft } from "./taskFeedbackDraft";
const props = defineProps<{
  services: BackendServices;
  projectId: string;
  taskId?: string;
  tasks: { id: string; title: string; archived: boolean }[];
  disabled?: boolean;
}>();
const draft = defineModel<TaskContentDraft>({ required: true });
const document = shallowRef<DocumentRead>();
const chapters = computed(() => (document.value ? documentTextblocks(document.value.content.json).filter((item) => item.chapterId) : []));
const chapterId = computed({
  get: () => draft.value.chapter?.chapter_id ?? "",
  set: (id: string) => {
    draft.value.chapter = id && document.value ? { document_id: document.value.id, version: document.value.version, chapter_id: id } : null;
  },
});
</script>
<template>
  <div class="studio-stack">
    <TpField v-slot="{ id }" label="任务标题" required
      ><input :id="id" v-model="draft.title" class="tp-input" maxlength="200" required :disabled="disabled"
    /></TpField>
    <TpField v-slot="{ id }" label="任务说明">
      <textarea :id="id" v-model="draft.description" class="tp-input" rows="3" maxlength="4000" :disabled="disabled" />
    </TpField>
    <TpField v-slot="{ id }" label="验收条件" required>
      <textarea :id="id" v-model="draft.acceptance" class="tp-input" rows="2" maxlength="4000" required :disabled="disabled" />
    </TpField>
    <div class="task-dates">
      <TpField v-slot="{ id }" label="开始日期"
        ><TpDatePicker :id="id" :model-value="draft.start_date ?? ''" :disabled="disabled" @update:model-value="draft.start_date = $event || null"
      /></TpField>
      <TpField v-slot="{ id }" label="预计完成日期"
        ><TpDatePicker :id="id" :model-value="draft.due_date ?? ''" :disabled="disabled" @update:model-value="draft.due_date = $event || null"
      /></TpField>
      <TpField v-slot="{ id }" label="硬截止日期"
        ><TpDatePicker :id="id" :model-value="draft.hard_deadline ?? ''" :disabled="disabled" @update:model-value="draft.hard_deadline = $event || null"
      /></TpField>
    </div>
    <TpField v-slot="{ id }" label="任务工作状态"
      ><TpSelect
        :id="id"
        v-model="draft.status"
        :disabled="disabled"
        :options="[
          { value: 'todo', label: '待开始' },
          { value: 'doing', label: '进行中' },
          { value: 'verify', label: '待验收' },
        ]"
    /></TpField>
    <fieldset v-if="tasks.some((task) => task.id !== taskId)" class="task-dependencies">
      <legend class="tp-caption">前置依赖任务</legend>
      <label v-for="task in tasks.filter((item) => item.id !== taskId)" :key="task.id"
        ><input
          v-model="draft.depends_on"
          type="checkbox"
          class="checkbox checkbox-sm"
          :value="task.id"
          :disabled="disabled || (task.archived && !draft.depends_on.includes(task.id))"
        /><span>{{ task.title }}{{ task.archived ? "（已归档）" : "" }}</span></label
      >
    </fieldset>
    <TpField v-slot="{ id }" label="关联章节"
      ><TpSelect
        :id="id"
        v-model="chapterId"
        :disabled="disabled"
        :options="[
          { value: '', label: '不关联章节' },
          ...chapters.map((item) => ({ value: item.chapterId!, label: `${item.label} · v${document?.version}` })),
          ...(draft.chapter && !chapters.some((item) => item.chapterId === draft.chapter?.chapter_id)
            ? [{ value: draft.chapter.chapter_id, label: `原关联章节 ${draft.chapter.chapter_id} · v${draft.chapter.version}` }]
            : []),
        ]"
    /></TpField>
    <p v-if="draft.chapter" class="tp-caption">章节固定在正文 v{{ draft.chapter.version }}，不会自动追改绑定。</p>
    <EvidencePicker v-model="draft.evidence" :services="services" :project-id="projectId" :disabled="disabled" @document="document = $event" />
    <label class="task-archive"
      ><input v-model="draft.archived" type="checkbox" class="checkbox checkbox-sm" :disabled="disabled" />归档此任务（保留历史与依赖）</label
    >
  </div>
</template>
<style scoped>
.task-dates {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.task-dependencies {
  border: 1px solid var(--tp-line);
  padding: 12px;
  border-radius: var(--tp-radius-s);
  display: grid;
  gap: 8px;
}
.task-dependencies label,
.task-archive {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
@media (max-width: 640px) {
  .task-dates {
    grid-template-columns: 1fr;
  }
}
</style>
