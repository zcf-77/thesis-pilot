<script setup lang="ts">
import { PhCheckCircle, PhInfo, PhPencilSimpleLine, PhSealCheck, PhWarning, PhWarningOctagon, PhX } from "@phosphor-icons/vue";
import type { Component } from "vue";
import { useToastStore, type ToastItem } from "@/stores/toast";
import TpButton from "./TpButton.vue";
import TpIcon from "./TpIcon.vue";

/** 轻提示宿主（L5）。全应用只挂载一次。 */
const store = useToastStore();
const icons: Record<ToastItem["tone"], Component> = {
  neutral: PhInfo,
  info: PhInfo,
  success: PhCheckCircle,
  warning: PhWarning,
  danger: PhWarningOctagon,
  pencil: PhPencilSimpleLine,
  seal: PhSealCheck,
};
</script>

<template>
  <Teleport to="body">
    <TransitionGroup tag="div" name="tp-toast" class="tp-toasts" role="region" aria-label="通知">
      <div v-for="toast in store.items" :key="toast.id" class="tp-toast" :data-tone="toast.tone" :role="toast.tone === 'danger' ? 'alert' : 'status'">
        <span class="tp-toast__icon"><TpIcon :icon="icons[toast.tone]" :size="16" /></span>
        <div class="min-w-0 flex-1">
          <p class="tp-toast__title">{{ toast.title }}</p>
          <p v-if="toast.desc" class="tp-toast__desc">{{ toast.desc }}</p>
          <TpButton v-if="toast.action" class="mt-2" size="sm" variant="tonal" @click="(toast.action.run(), store.dismiss(toast.id))">
            {{ toast.action.label }}
          </TpButton>
        </div>
        <TpButton variant="ghost" size="sm" icon-only label="关闭提示" class="-mr-1 -mt-1" @click="store.dismiss(toast.id)"
          ><TpIcon :icon="PhX" :size="13"
        /></TpButton>
        <span v-if="toast.duration > 0" class="tp-toast__timer" :style="{ animationDuration: toast.duration + 'ms' }" aria-hidden="true" />
      </div>
    </TransitionGroup>
  </Teleport>
</template>
