<script setup lang="ts">
import { PhLightning, PhLightningSlash } from "@phosphor-icons/vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import { themeList, type ThemeId } from "@/design/tokens";
import { useAppearanceStore } from "@/stores/appearance";

/** 方案坞：全局切换四套方案（圆形揭示转场）与动效强度。 */
const appearance = useAppearanceStore();

function pick(id: ThemeId, event: MouseEvent) {
  appearance.setTheme(id, { x: event.clientX, y: event.clientY });
}
</script>

<template>
  <div class="lab-dock" role="toolbar" aria-label="切换设计方案">
    <button
      v-for="t in themeList"
      :key="t.id"
      type="button"
      class="lab-dock__theme"
      :aria-pressed="appearance.theme === t.id"
      :aria-label="'切换到方案：' + t.name"
      @click="pick(t.id, $event)"
    >
      <span
        class="lab-dock__glyph"
        :style="{
          background: t.contrastAs?.canvas ?? t.color.canvas,
          color: t.color.text,
          fontFamily: t.vars['font-display'],
          fontWeight: t.vars['display-weight'],
          boxShadow: 'inset 0 -5px 0 ' + (t.id === 'zhumo' ? t.color.seal : t.color.action),
        }"
        aria-hidden="true"
        >{{ t.glyph }}</span
      >
      {{ t.name }}
    </button>
    <span class="mx-0.5 h-6 w-px bg-line" aria-hidden="true" />
    <button
      type="button"
      class="lab-dock__theme tp-tip !px-2.5"
      :aria-pressed="appearance.motion === 'reduced'"
      :data-tip="appearance.motion === 'full' ? '动效：完整（点击切到减弱）' : '动效：减弱（点击切回完整）'"
      :aria-label="appearance.motion === 'full' ? '切换为减弱动效' : '切换为完整动效'"
      @click="appearance.toggleMotion()"
    >
      <TpIcon :icon="appearance.motion === 'full' ? PhLightning : PhLightningSlash" :size="16" />
    </button>
  </div>
</template>
