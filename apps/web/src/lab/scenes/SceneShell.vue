<script setup lang="ts">
import { PhBell, PhBooks, PhCaretDown, PhChatTeardropText, PhCompass, PhNotePencil, PhPath, PhSealCheck, PhSlidersHorizontal } from "@phosphor-icons/vue";
import StageRoute from "@/components/domain/StageRoute.vue";
import TpAmbient from "@/components/ui/TpAmbient.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSaveIndicator from "@/components/ui/TpSaveIndicator.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import { project, stages } from "../fixtures";
import LabLogo from "../LabLogo.vue";

/**
 * 场景外壳（设计稿）：航线轨 + 航线条 + 舞台。
 * 仅用于展台展示“方案落到真实界面是什么样”，不是最终的应用外壳实现。
 */
defineProps<{ active: "today" | "write" | "plan" | "library" | "feedback" | "review" }>();
const nav = [
  { id: "today", label: "今日", icon: PhCompass },
  { id: "write", label: "写作", icon: PhNotePencil },
  { id: "plan", label: "计划", icon: PhPath },
  { id: "library", label: "资料", icon: PhBooks },
  { id: "feedback", label: "反馈", icon: PhChatTeardropText },
  { id: "review", label: "评审", icon: PhSealCheck },
] as const;
</script>

<template>
  <div class="sc tp-canvas">
    <TpAmbient />
    <nav class="sc-rail" aria-label="主导航（设计稿）">
      <LabLogo :size="34" />
      <div class="mt-5 grid gap-1">
        <span v-for="item in nav" :key="item.id" class="sc-rail__item" :class="{ 'is-active': item.id === active }">
          <TpIcon :icon="item.icon" :size="20" />
          <span>{{ item.label }}</span>
          <i v-if="item.id === 'feedback'" class="sc-rail__dot" />
        </span>
      </div>
      <div class="mt-auto grid justify-items-center gap-3">
        <span class="sc-rail__item"><TpIcon :icon="PhSlidersHorizontal" :size="20" /><span>配置台</span></span>
        <span class="tp-avatar tp-avatar--round" style="--av: var(--tp-accent)">林</span>
      </div>
    </nav>
    <div class="sc-col">
      <header class="sc-top">
        <div class="min-w-0">
          <p class="tp-label !text-[0.625rem]">当前项目</p>
          <p class="flex items-center gap-1 font-display text-[1.0625rem] leading-tight" style="font-weight: var(--tp-display-weight)">
            {{ project.short }}<TpIcon :icon="PhCaretDown" :size="12" weight="bold" class="text-fg-muted" />
          </p>
        </div>
        <div class="w-[25rem] shrink-0 pt-1"><StageRoute :stages="stages" compact /></div>
        <p class="ml-auto flex items-baseline gap-1.5 whitespace-nowrap text-[0.75rem] text-fg-muted">
          距论文提交<b class="tp-num text-[1.375rem] leading-none text-fg">44</b>天
        </p>
        <span class="h-5 w-px bg-line" />
        <TpSaveIndicator state="saved" at="14:32" />
        <TpVersion :v="project.docVersion" prefix="正文 " />
        <span class="relative grid size-8 place-items-center text-fg-muted">
          <TpIcon :icon="PhBell" :size="18" /><i class="sc-rail__dot !right-1 !top-1" />
        </span>
        <span class="inline-flex items-center gap-0.5"><kbd class="tp-kbd">⌘</kbd><kbd class="tp-kbd">K</kbd></span>
      </header>
      <div class="sc-main"><slot /></div>
    </div>
  </div>
</template>
