<script setup lang="ts">
import TpCountUp from "@/components/ui/TpCountUp.vue";
import TpRing from "@/components/ui/TpRing.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import type { ScoreDimView } from "@/domain/types";

/**
 * 评审摘要：分项参考评分 + 未检查项。
 * 参考分是模拟量表的结果，不是教师成绩；未能评分的维度用“留白”空环，不给 0 分也不给平均分。
 * stale=true 表示报告基于旧稿。
 */
withDefaults(defineProps<{ dims: ScoreDimView[]; docVersion: number; currentVersion: number; unchecked: string[]; basis?: string }>(), {
  basis: "模拟评分 · 非教师成绩",
});
</script>

<template>
  <section class="tp-card p-5" :class="{ 'tp-stale': docVersion !== currentVersion }">
    <header class="flex flex-wrap items-center gap-2">
      <h3 class="tp-heading">分项参考评分</h3>
      <TpStatus tone="ghost" :label="basis" size="sm" />
      <span class="ml-auto flex items-center gap-2">
        <TpVersion :v="docVersion" prefix="评审输入 正文 " :stale="docVersion !== currentVersion" />
        <TpStatus v-if="docVersion !== currentVersion" tone="stale" :label="'基于旧稿 · 当前 v' + currentVersion" size="sm" />
      </span>
    </header>
    <div class="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
      <div v-for="(d, i) in dims" :key="d.id" class="tp-enter flex flex-col items-center gap-2 text-center" :style="{ '--i': i }">
        <TpRing v-if="d.score !== null" :value="(d.score / d.full) * 100" :label="d.name + '参考分'" :size="76">
          <span class="tp-num text-[1.375rem] leading-none"><TpCountUp :value="d.score" /></span>
        </TpRing>
        <span v-else class="tp-ghost grid size-[76px] place-items-center !rounded-full text-[0.6875rem] font-semibold">不能判定</span>
        <p class="text-[0.8125rem] font-semibold leading-tight">{{ d.name }}<span class="tp-mono ml-1 text-fg-faint">/{{ d.full }}</span></p>
        <p v-if="d.note" class="tp-caption !text-[0.6875rem] !leading-snug">{{ d.note }}</p>
      </div>
    </div>
    <div v-if="unchecked.length" class="tp-ghost mt-5 p-3">
      <p class="tp-label mb-1.5">未检查项 · {{ unchecked.length }}</p>
      <ul class="grid gap-1 text-[0.8125rem]">
        <li v-for="u in unchecked" :key="u">· {{ u }}</li>
      </ul>
    </div>
  </section>
</template>
