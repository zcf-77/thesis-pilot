<script setup lang="ts">
import { PhX } from "@phosphor-icons/vue";
import TpIcon from "./TpIcon.vue";

/** 标签：上下文范围、筛选条件、关联对象。removable 时可移除。 */
defineProps<{ active?: boolean; removable?: boolean; removeLabel?: string }>();
defineEmits<{ remove: [] }>();
</script>

<template>
  <span class="tp-chip" :class="{ 'tp-chip--active': active }">
    <slot />
    <button v-if="removable" type="button" class="tp-chip__x" :aria-label="removeLabel ?? '移除'" @click="$emit('remove')">
      <TpIcon :icon="PhX" :size="11" weight="bold" />
    </button>
  </span>
</template>
