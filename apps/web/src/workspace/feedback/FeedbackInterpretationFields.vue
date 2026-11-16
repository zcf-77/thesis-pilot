<script setup lang="ts">
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import { copy, type FeedbackDraft } from "../tasks/taskFeedbackDraft";
import type { SourceRange } from "./feedbackSelection";

const props = defineProps<{ disabled?: boolean; range?: SourceRange }>();
const draft = defineModel<FeedbackDraft>({ required: true });

function useRange() {
  if (!props.range) return;
  draft.value.source_range = copy(props.range);
  draft.value.source_checked = false;
}
</script>

<template>
  <blockquote class="feedback-segment">
    <span class="tp-caption">对应原文 UTF-16 {{ draft.source_range.from }}–{{ draft.source_range.to }} · 原文范围保持不变</span>
    <p>{{ draft.source_range.text }}</p>
  </blockquote>
  <TpButton
    v-if="range && (range.from !== draft.source_range.from || range.to !== draft.source_range.to)"
    size="sm"
    variant="ghost"
    :disabled="disabled"
    @click="useRange"
    >改用当前原文选区</TpButton
  >
  <TpField v-slot="{ id }" label="人工解释" required>
    <textarea :id="id" v-model="draft.interpretation" class="tp-input" rows="3" maxlength="4000" :disabled="disabled" />
  </TpField>
  <TpField v-slot="{ id }" label="解释确定性"
    ><TpSelect
      :id="id"
      v-model="draft.certainty"
      :disabled="disabled"
      :options="[
        { value: 'uncertain', label: '有歧义 / 缺少材料，待核对' },
        { value: 'certain', label: '人工已明确' },
      ]"
  /></TpField>
  <TpField v-slot="{ id }" label="纠正 / 澄清说明" :hint="draft.certainty === 'uncertain' ? '有歧义时写下你向导师确认的结果或自己的澄清。' : undefined">
    <textarea :id="id" v-model="draft.correction" class="tp-input" rows="2" maxlength="4000" :disabled="disabled" />
  </TpField>
  <label class="feedback-check"
    ><input v-model="draft.source_checked" type="checkbox" class="checkbox checkbox-sm" :disabled="disabled" /><span>我已核对本条解释与原文范围</span></label
  >
</template>

<style scoped>
.feedback-segment {
  margin: 0;
  padding: 12px 16px;
  border-left: 2px solid var(--tp-line-strong);
  background: var(--tp-surface);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.feedback-segment p {
  margin-top: 8px;
  line-height: 1.7;
}
.feedback-check {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}
</style>
