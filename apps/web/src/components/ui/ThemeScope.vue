<script setup lang="ts">
import { provideThemeScope } from "@/design/theme";
import type { ThemeId } from "@/design/tokens";

/** 在子树内局部应用一套方案（方案对比、场景预览）。 */
const props = defineProps<{ theme: ThemeId; canvas?: boolean }>();
provideThemeScope(() => props.theme);
</script>

<template>
  <div :data-theme="theme" :class="{ 'tp-canvas': canvas }">
    <slot />
  </div>
</template>
