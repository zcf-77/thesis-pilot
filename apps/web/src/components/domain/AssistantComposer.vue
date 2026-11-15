<script setup lang="ts">
import { PhArrowUp, PhStop } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";

/**
 * 输入区。草稿由上层按“项目 × 助手”保存（v-model），切换助手或模块不丢。
 * running 时发送键变为停止键（emit cancel）。
 */
const draft = defineModel<string>({ required: true });
const props = defineProps<{ running?: boolean; placeholder?: string; disabled?: boolean; label?: string; sendLabel?: string; draftPersisted?: boolean }>();
const emit = defineEmits<{ send: [text: string]; cancel: [] }>();

function send(event?: KeyboardEvent | MouseEvent) {
  if (props.disabled || props.running || (event instanceof KeyboardEvent && event.isComposing)) return;
  const text = draft.value.trim();
  if (!text) return;
  emit("send", text);
}
</script>

<template>
  <div class="tp-composer">
    <textarea
      v-model="draft"
      rows="2"
      :placeholder="placeholder ?? '问点什么，或说明你想怎么改…'"
      :aria-label="label ?? '给助手的消息'"
      @keydown.enter.exact.prevent="send"
    />
    <div class="flex items-center gap-2">
      <slot name="tools" />
      <span v-if="draft && !running && draftPersisted !== false" class="tp-caption !text-[0.6875rem]">草稿已保留</span>
      <span class="tp-caption ml-auto !text-[0.6875rem]"><kbd class="tp-kbd">Enter</kbd> 发送</span>
      <TpButton v-if="running" variant="outline" size="sm" icon-only label="停止生成" @click="$emit('cancel')"
        ><TpIcon :icon="PhStop" weight="fill"
      /></TpButton>
      <TpButton v-else variant="primary" size="sm" icon-only :label="sendLabel ?? '发送'" :disabled="disabled || !draft.trim()" @click="send"
        ><TpIcon :icon="PhArrowUp" weight="bold"
      /></TpButton>
    </div>
  </div>
</template>
