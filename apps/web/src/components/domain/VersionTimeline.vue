<script setup lang="ts">
import { PhArrowCounterClockwise, PhArrowsClockwise, PhDownloadSimple, PhFilePlus, PhFloppyDisk, PhSealCheck } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import type { VersionView } from "@/domain/types";

/**
 * 正文版本时间线。
 * 恢复不会删除历史：恢复 v10 会产生一个内容等于 v10 的新版本。
 */
defineProps<{ versions: VersionView[]; readOnly?: boolean; hideWords?: boolean }>();
defineEmits<{ restore: [v: number]; compare: [v: number] }>();
const icons = {
  blank: PhFilePlus,
  manual: PhFloppyDisk,
  adopt: PhSealCheck,
  restore: PhArrowCounterClockwise,
  import: PhDownloadSimple,
  undo: PhArrowCounterClockwise,
  upgrade: PhArrowsClockwise,
};
const causes = { blank: "创建空白稿", manual: "手动保存", adopt: "采纳候选", restore: "恢复", import: "导入", undo: "撤销采纳", upgrade: "升级正文结构" };
</script>

<template>
  <TransitionGroup tag="ol" name="tp-list" v-bind="listMotionHooks" class="tp-vt tp-list-group">
    <li v-for="ver in versions" :key="ver.v" class="tp-vt__item" :class="{ 'is-current': ver.current }" :data-cause="ver.cause">
      <span class="tp-vt__dot"><TpIcon :icon="icons[ver.cause]" :size="12" /></span>
      <div class="min-w-0">
        <p class="flex flex-wrap items-center gap-2">
          <span class="tp-mono !text-[0.8125rem] font-semibold">v{{ ver.v }}</span>
          <span class="tp-caption">{{ causes[ver.cause] }}</span>
          <TpStatus v-if="ver.current" tone="neutral" label="当前" size="sm" />
        </p>
        <p v-if="ver.summary" class="text-[0.8125rem] leading-snug">{{ ver.summary }}</p>
        <p class="tp-mono mt-0.5 text-fg-faint">{{ ver.at }}<template v-if="!hideWords"> · {{ ver.words.toLocaleString() }} 字</template></p>
      </div>
      <div class="flex gap-1">
        <TpButton size="sm" variant="ghost" @click="$emit('compare', ver.v)">对比</TpButton>
        <TpButton v-if="!readOnly && !ver.current" size="sm" variant="outline" @click="$emit('restore', ver.v)">恢复</TpButton>
      </div>
    </li>
  </TransitionGroup>
</template>
