<script setup lang="ts">
import { PhLightning, PhLightningSlash } from "@phosphor-icons/vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import { themeList, type ThemeId } from "@/design/tokens";
import { useAppearanceStore } from "@/stores/appearance";
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";

/** 方案坞：全局切换四套方案（圆形揭示转场）与动效强度。 */
const appearance = useAppearanceStore();
const route = useRoute();
const compact = computed(() => route.path.startsWith("/screens/"));
const expanded = ref(false);
watch(
  () => route.path,
  () => {
    expanded.value = false;
  },
);

function pick(id: ThemeId, event: MouseEvent) {
  appearance.setTheme(id, { x: event.clientX, y: event.clientY });
}
</script>

<template>
  <button v-if="compact" class="lab-dock-toggle" type="button" :aria-expanded="expanded" aria-controls="workspace-appearance" @click="expanded = !expanded">
    外观 <span aria-hidden="true">{{ expanded ? "×" : "◐" }}</span>
  </button>
  <Transition name="tp-dock">
    <div
      v-show="!compact || expanded"
      id="workspace-appearance"
      class="lab-dock"
      :class="{ 'lab-dock--popover': compact }"
      role="toolbar"
      aria-label="切换设计方案"
      @keydown.esc="expanded = false"
    >
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
  </Transition>
</template>
<style scoped>
.lab-dock-toggle {
  position: fixed;
  bottom: 16px;
  right: 20px;
  z-index: 35;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 7px 12px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-m);
  background: var(--tp-surface);
  color: var(--tp-text-muted);
  font-size: 12px;
  box-shadow: var(--tp-shadow-1);
}
.lab-dock-toggle:hover {
  color: var(--tp-text);
  border-color: var(--tp-line-strong);
}
.lab-dock.lab-dock--popover {
  left: auto;
  right: 20px;
  bottom: 60px;
  transform: none;
  max-width: calc(100vw - 32px);
}
@media (max-width: 600px) {
  .lab-dock-toggle {
    right: 12px;
    bottom: 12px;
  }
  .lab-dock.lab-dock--popover {
    right: 12px;
    bottom: 56px;
    flex-wrap: wrap;
  }
}
</style>
