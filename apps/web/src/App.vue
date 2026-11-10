<script setup lang="ts">
import { storeToRefs } from "pinia";
import { provideThemeScope } from "@/design/theme";
import TpDefs from "@/components/ui/TpDefs.vue";
import TpToastHost from "@/components/ui/TpToastHost.vue";
import { useAppearanceStore } from "@/stores/appearance";
import LabShell from "@/lab/LabShell.vue";

const { theme } = storeToRefs(useAppearanceStore());
provideThemeScope(theme);
</script>

<template>
  <TpDefs />
  <LabShell />
  <TpToastHost />
</template>
