<script setup lang="ts">
import { PhWarningCircle } from "@phosphor-icons/vue";
import { useId } from "vue";
import TpIcon from "./TpIcon.vue";

/** 表单项外壳：标签、必填 / 选填、帮助与错误。通过插槽参数把 id 与 aria 属性交给控件。 */
defineProps<{ label: string; hint?: string; error?: string; required?: boolean; optional?: boolean }>();
const id = useId();
</script>

<template>
  <div class="tp-field">
    <label class="tp-field__label" :for="id">
      {{ label }}
      <span v-if="required" class="tp-field__req" aria-hidden="true">*</span>
      <span v-if="optional" class="tp-field__opt">可稍后填写</span>
    </label>
    <slot :id="id" :invalid="!!error" :describedby="id + '-msg'" />
    <Transition name="tp-swap" mode="out-in">
      <p v-if="error" :id="id + '-msg'" :key="error" class="tp-field__error tp-shake" role="alert">
        <TpIcon :icon="PhWarningCircle" :size="14" weight="fill" />{{ error }}
      </p>
      <p v-else-if="hint" :id="id + '-msg'" class="tp-field__hint">{{ hint }}</p>
    </Transition>
  </div>
</template>
