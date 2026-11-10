<script setup lang="ts">
import { PhArrowRight, PhCheck } from "@phosphor-icons/vue";
import ThemeScope from "@/components/ui/ThemeScope.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import type { ThemeDef } from "@/design/tokens";
import { useAppearanceStore } from "@/stores/appearance";
import ScaledFrame from "./scenes/ScaledFrame.vue";
import SceneToday from "./scenes/SceneToday.vue";
import SceneWorkbench from "./scenes/SceneWorkbench.vue";

/** 方案卡：用方案自己的样子介绍自己（嵌套主题），附一张缩小的真实场景。 */
defineProps<{ theme: ThemeDef; letter: string; scene?: "write" | "today" }>();
const appearance = useAppearanceStore();
</script>

<template>
  <ThemeScope :theme="theme.id" canvas class="lab-tcard">
    <div class="lab-tcard__scene">
      <ScaledFrame inert>
        <SceneToday v-if="scene === 'today'" />
        <SceneWorkbench v-else />
      </ScaledFrame>
    </div>
    <div class="lab-tcard__body">
      <p class="tp-label">方案 {{ letter }} · {{ theme.en }}</p>
      <h3 class="tp-title mt-1 flex items-center gap-3">
        {{ theme.name }}
        <span class="flex gap-1">
          <i
            v-for="c in ['action', 'pencil', 'seal', 'success', 'warning'] as const"
            :key="c"
            class="lab-dot"
            :style="{ background: theme.contrastAs?.[c] ?? theme.color[c] }"
          />
        </span>
      </h3>
      <p class="mt-1.5 text-[0.9375rem] text-fg-muted">{{ theme.tagline }}</p>
      <div class="mt-4 flex items-center gap-2">
        <TpButton
          v-if="appearance.theme !== theme.id"
          variant="primary"
          size="sm"
          @click="appearance.setTheme(theme.id, { x: $event.clientX, y: $event.clientY })"
        >
          全站换成它<TpIcon :icon="PhArrowRight" />
        </TpButton>
        <TpButton v-else variant="tonal" size="sm" disabled><TpIcon :icon="PhCheck" weight="bold" />当前方案</TpButton>
        <span class="tp-caption ml-auto">{{ theme.mood.join(" · ") }}</span>
      </div>
    </div>
  </ThemeScope>
</template>
