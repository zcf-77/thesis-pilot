<script setup lang="ts">
/**
 * 按钮。强调阶梯（每个区域只允许一个最高级）：
 *   seal    决定：采纳 / 确认完成 —— 会改变正式论文或正式计划
 *   primary 主行动：当前区域最重要的普通操作
 *   pencil  发起 AI 请求 —— 只产生候选
 *   tonal / outline / ghost  次要、三级操作
 *   danger  破坏性操作
 */
const props = withDefaults(
  defineProps<{
    variant?: "primary" | "seal" | "pencil" | "tonal" | "outline" | "ghost" | "danger";
    size?: "sm" | "md" | "lg";
    type?: "button" | "submit";
    loading?: boolean;
    disabled?: boolean;
    block?: boolean;
    iconOnly?: boolean;
    /** 仅图标按钮必须提供可访问名称 */
    label?: string;
  }>(),
  { variant: "outline", size: "md", type: "button" },
);
const emit = defineEmits<{ click: [event: MouseEvent] }>();

function onClick(event: MouseEvent) {
  if (props.loading || props.disabled) return;
  emit("click", event);
}
</script>

<template>
  <button
    :type="type"
    class="tp-btn"
    :class="['tp-btn--' + variant, size !== 'md' ? 'tp-btn--' + size : '', { 'tp-btn--block': block, 'tp-btn--icon': iconOnly, 'is-loading': loading }]"
    :disabled="disabled"
    :aria-busy="loading || undefined"
    :aria-label="label"
    @click="onClick"
  >
    <span v-if="loading" class="tp-btn__spinner" aria-hidden="true" />
    <slot />
  </button>
</template>
