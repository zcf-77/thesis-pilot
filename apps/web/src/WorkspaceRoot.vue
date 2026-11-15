<script setup lang="ts">
import { storeToRefs } from "pinia";
import TpDefs from "@/components/ui/TpDefs.vue";
import TpToastHost from "@/components/ui/TpToastHost.vue";
import { provideThemeScope } from "@/design/theme";
import { useAppearanceStore } from "@/stores/appearance";
import WorkspaceApp from "@/workspace/WorkspaceApp.vue";

const { theme } = storeToRefs(useAppearanceStore());
provideThemeScope(theme);
</script>

<template>
  <TpDefs />
  <WorkspaceApp />
  <TpToastHost />
</template>
