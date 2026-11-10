<script setup lang="ts">
import { PhArrowCounterClockwise, PhDownloadSimple, PhFloppyDisk, PhSealCheck } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { VersionView } from "@/domain/types";

/**
 * 正文版本时间线。保存、采纳、恢复、导入是四种不同的成因。
 * 恢复不会删除历史：恢复 v10 会产生一个内容等于 v10 的新版本。
 */
defineProps<{ versions: VersionView[] }>();
defineEmits<{ restore: [v: number]; compare: [v: number] }>();
const icons = { manual: PhFloppyDisk, adopt: PhSealCheck, restore: PhArrowCounterClockwise, import: PhDownloadSimple };
const causes = { manual: "手动保存", adopt: "采纳候选", restore: "恢复", import: "导入" };
</script>

<template>
  <TransitionGroup tag="ol" name="tp-list" class="tp-vt">
    <li v-for="ver in versions" :key="ver.v" class="tp-vt__item" :class="{ 'is-current': ver.current }" :data-cause="ver.cause">
      <span class="tp-vt__dot"><TpIcon :icon="icons[ver.cause]" :size="12" /></span>
      <div class="min-w-0">
        <p class="flex flex-wrap items-center gap-2">
          <span class="tp-mono !text-[0.8125rem] font-semibold">v{{ ver.v }}</span>
          <span class="tp-caption">{{ causes[ver.cause] }}</span>
          <TpStatus v-if="ver.current" tone="neutral" label="当前" size="sm" />
        </p>
        <p class="text-[0.8125rem] leading-snug">{{ ver.summary }}</p>
        <p class="tp-mono mt-0.5 text-fg-faint">{{ ver.at }} · {{ ver.words.toLocaleString() }} 字</p>
      </div>
      <div class="flex gap-1">
        <TpButton size="sm" variant="ghost" @click="$emit('compare', ver.v)">对比</TpButton>
        <TpButton v-if="!ver.current" size="sm" variant="outline" @click="$emit('restore', ver.v)">恢复</TpButton>
      </div>
    </li>
  </TransitionGroup>
</template>
