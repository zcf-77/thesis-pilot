<script setup lang="ts">
import { onMounted, ref } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";

defineProps<{ busy?: boolean; disabled?: boolean; error?: string }>();
const text = defineModel<string>({ required: true });
const emit = defineEmits<{ save: []; cancel: []; input: [] }>();
const input = ref<HTMLTextAreaElement>();

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.defaultPrevented) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("cancel");
  } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    emit("save");
  }
}
onMounted(() => input.value?.focus());
defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <form
    id="feedback-entry"
    class="screen-panel feedback-entry"
    aria-labelledby="feedback-entry-title"
    novalidate
    @submit.prevent="emit('save')"
    @keydown="onKeydown"
  >
    <header class="feedback-entry__head">
      <div>
        <p class="tp-label">保留导师原话</p>
        <h2 id="feedback-entry-title" class="tp-heading">粘贴反馈文字</h2>
      </div>
      <span class="tp-caption">完整保留原话，后续整理与处理分别记录</span>
    </header>
    <TpField v-slot="{ id, invalid, describedby }" label="反馈原文" required :error="error" hint="保留你粘贴的全部文字与换行。最多 10,000 个字符。">
      <textarea
        :id="id"
        ref="input"
        v-model="text"
        class="tp-input feedback-entry__input"
        rows="6"
        :disabled="disabled"
        :aria-invalid="invalid || undefined"
        :aria-describedby="describedby"
        placeholder="在这里粘贴导师的反馈…"
        @input="emit('input')"
      />
    </TpField>
    <footer class="feedback-entry__footer">
      <p class="tp-caption">Enter 换行 · Ctrl / ⌘ + Enter 保存 · Esc 取消</p>
      <div>
        <TpButton variant="ghost" :disabled="busy || disabled" @click="emit('cancel')">取消</TpButton
        ><TpButton type="submit" variant="primary" :loading="busy" :disabled="disabled">保存反馈</TpButton>
      </div>
    </footer>
  </form>
</template>

<style scoped>
.feedback-entry {
  padding: 24px 32px;
}
.feedback-entry__head,
.feedback-entry__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
}
.feedback-entry__head {
  margin-bottom: 20px;
}
.feedback-entry__head h2 {
  margin-top: 8px;
}
.feedback-entry__input {
  width: 100%;
  min-height: 180px;
  height: auto;
  resize: vertical;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.feedback-entry__footer {
  margin-top: 20px;
}
.feedback-entry__footer > div {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
@media (max-width: 760px) {
  .feedback-entry {
    padding: 20px;
  }
  .feedback-entry__head {
    align-items: start;
    flex-direction: column;
    gap: 12px;
  }
}
</style>
