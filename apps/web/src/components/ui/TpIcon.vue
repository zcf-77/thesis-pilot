<script setup lang="ts">
import type { Component } from "vue";
import { useThemeScope } from "@/design/theme";
import type { IconWeight } from "@/design/tokens";

/** 图标：字重跟随当前方案（朱墨 regular / 荧光 bold / 晨雾 duotone …），可单独覆盖。 */
withDefaults(defineProps<{ icon: Component; size?: number | string; weight?: IconWeight }>(), { size: 16 });
const scope = useThemeScope();
</script>

<template>
  <component :is="icon" :size="size" :weight="weight ?? scope.def.value.icon" aria-hidden="true" class="shrink-0" />
</template>
