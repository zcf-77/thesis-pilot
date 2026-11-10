<script setup lang="ts">
import { PhArrowRight, PhArrowUpRight, PhFlagPennant } from "@phosphor-icons/vue";
import StageRoute from "@/components/domain/StageRoute.vue";
import TaskCard from "@/components/domain/TaskCard.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpCountUp from "@/components/ui/TpCountUp.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpProgress from "@/components/ui/TpProgress.vue";
import TpRing from "@/components/ui/TpRing.vue";
import { agents } from "@/domain/vocab";
import { stages, tasks } from "../fixtures";
import SceneShell from "./SceneShell.vue";

/** 场景 · 今日：一句话告诉学生“今天最要紧的一件事”，其余按“下一步 / 等你决定 / 进度”三栏展开。 */
const waiting = [
  { agent: "content", title: "3 处修订候选", sub: "3.2 协同过滤召回 · 基于正文 v12" },
  { agent: "progress", title: "1 份计划调整候选", sub: "影响 3 个任务 · 不移动硬截止" },
] as const;
</script>

<template>
  <SceneShell active="today">
    <div class="sc-today">
      <section class="sc-hero">
        <div class="min-w-0">
          <p class="tp-label">11 月 11 日 · 周三 · 论文撰写阶段第 12 天</p>
          <h2 class="tp-display-xl mt-3 !text-[3.25rem]">下午好，知夏。</h2>
          <p class="mt-3 max-w-[34rem] text-[1.0625rem] leading-relaxed text-fg-muted">
            今天只有一件要紧事：<span class="tp-mark font-semibold text-fg">确认第 3 章初稿</span>。其余的我先替你盯着，到重要节点再来找你。
          </p>
          <div class="mt-5 flex gap-2.5">
            <TpButton variant="primary" size="lg">去确认<TpIcon :icon="PhArrowRight" /></TpButton>
            <TpButton variant="ghost" size="lg">看本周计划</TpButton>
          </div>
        </div>
        <div class="tp-card tp-corners sc-count">
          <p class="tp-label">距论文提交</p>
          <p class="flex items-baseline gap-2">
            <span class="tp-num sc-count__num"><TpCountUp :value="44" :duration="1400" /></span><span class="text-[1.125rem] font-semibold">天</span>
          </p>
          <TpProgress :value="38" label="撰写阶段已用时间" />
          <p class="tp-caption mt-2.5 flex items-center gap-1.5"><TpIcon :icon="PhFlagPennant" :size="13" />硬截止 12-25 · 计划调整不会移动它</p>
        </div>
      </section>

      <section class="tp-card px-6 py-5"><StageRoute :stages="stages" /></section>

      <section class="grid grid-cols-[1.25fr_1fr_0.8fr] gap-4">
        <div class="grid content-start gap-2.5">
          <p class="tp-label">下一步</p>
          <TaskCard v-for="t in tasks.slice(0, 2)" :key="t.id" :task="{ ...t, acceptance: undefined }" />
        </div>
        <div class="grid content-start gap-2.5">
          <p class="tp-label">等你决定 · AI 的提议在你采纳前不会生效</p>
          <div v-for="w in waiting" :key="w.title" class="tp-pencil flex items-center gap-3 px-3.5 py-3">
            <span class="tp-avatar tp-avatar--sm" :data-agent="w.agent">{{ agents[w.agent].short }}</span>
            <span class="min-w-0 flex-1">
              <b class="block text-[0.875rem] leading-snug">{{ w.title }}</b>
              <span class="tp-caption block truncate">{{ w.sub }}</span>
            </span>
            <TpIcon :icon="PhArrowUpRight" :size="16" class="text-pencil-content" />
          </div>
          <div class="tp-ghost flex items-center gap-3 px-3.5 py-3">
            <span class="min-w-0 flex-1">
              <b class="block text-[0.875rem] leading-snug text-fg">1 条导师意见有歧义</b>
              <span class="tp-caption block">“那个图不太行” —— 需要你判断指哪张图</span>
            </span>
          </div>
        </div>
        <div class="tp-card grid content-start gap-3 p-4">
          <p class="tp-label">进度 · 不代表质量</p>
          <div class="flex items-center gap-4">
            <TpRing :value="40" :size="84" :stroke="8" label="已确认任务比例"
              ><span class="tp-num text-[1.5rem] leading-none">2<span class="text-[0.875rem] text-fg-faint">/5</span></span></TpRing
            >
            <p class="text-[0.8125rem] leading-snug text-fg-muted"><b class="block text-fg">已确认任务</b>由你本人确认，系统不会代劳</p>
          </div>
          <div>
            <p class="mb-1.5 flex justify-between text-[0.75rem] text-fg-muted">正文字数<span class="tp-mono text-fg">8,460 / 12,000</span></p>
            <TpProgress :value="70" label="正文字数" tone="neutral" />
          </div>
        </div>
      </section>
    </div>
  </SceneShell>
</template>
