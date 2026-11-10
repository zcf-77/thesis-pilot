<script setup lang="ts">
import { PhArrowBendDownRight, PhCheck, PhPencilSimple, PhQuestion, PhQuotes, PhSealCheck, PhTarget } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import type { FeedbackView } from "@/domain/types";

/**
 * 导师反馈卡。三层材质对应三种“谁说的”：
 *   原文   墨（实线引用块）—— 导师原话，永远原样保留
 *   拆解   铅笔 —— AI 的理解，学生可以纠正
 *   已处理 印章 —— 学生的声明；不是导师认可（本轮没有该状态，也不显示占位）
 */
defineProps<{ feedback: FeedbackView }>();
defineEmits<{ correct: [itemId: string]; handle: [itemId: string]; locate: [itemId: string] }>();
const flags = { ambiguous: "有歧义，需你判断", unlocated: "无法定位到章节", "needs-material": "缺少材料" } as const;
</script>

<template>
  <article class="tp-card p-4">
    <header class="mb-3 flex flex-wrap items-center gap-2 text-[0.75rem] text-fg-muted">
      <TpIcon :icon="PhQuotes" :size="15" weight="fill" class="text-fg" />
      <span class="font-semibold text-fg">{{ feedback.source }}</span>
      <span class="tp-mono">{{ feedback.at }}</span>
      <TpVersion :v="feedback.docVersion" prefix="针对正文 " />
    </header>
    <blockquote class="tp-fb__quote">{{ feedback.original }}</blockquote>
    <p class="tp-label mt-4 mb-2 flex items-center gap-1.5 !text-pencil-content"><TpIcon :icon="PhArrowBendDownRight" :size="13" />AI 拆解 · 可纠正</p>
    <div>
      <div v-for="item in feedback.items" :key="item.id" class="tp-fb__item" :class="item.handled ? 'tp-ink' : item.flag ? 'tp-ghost' : 'tp-pencil'">
        <span
          class="tp-task__check !size-5 !mt-0.5"
          :style="item.handled ? { background: 'var(--tp-seal)', borderColor: 'var(--tp-seal)', color: 'var(--tp-seal-content)' } : undefined"
        >
          <TpIcon v-if="item.handled" :icon="PhCheck" :size="11" weight="bold" />
          <TpIcon v-else-if="item.flag" :icon="PhQuestion" :size="11" weight="bold" />
        </span>
        <div class="min-w-0">
          <p class="text-[0.875rem] font-medium leading-snug">{{ item.text }}</p>
          <p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-fg-muted">
            <button
              v-if="item.locate"
              type="button"
              class="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2"
              @click="$emit('locate', item.id)"
            >
              <TpIcon :icon="PhTarget" :size="12" />{{ item.locate }}
            </button>
            <TpStatus v-if="item.flag" tone="ghost" :label="flags[item.flag]" size="sm" />
            <span v-if="item.taskTitle">任务：{{ item.taskTitle }}</span>
            <span v-if="item.correctedByStudent" class="text-fg">已由你纠正</span>
          </p>
        </div>
        <div class="flex items-center gap-1">
          <TpSeal v-if="item.handled" text="已处理" />
          <template v-else>
            <TpButton
              variant="ghost"
              size="sm"
              icon-only
              :label="'纠正：' + item.text"
              class="tp-tip"
              data-tip="纠正含义或定位"
              @click="$emit('correct', item.id)"
              ><TpIcon :icon="PhPencilSimple"
            /></TpButton>
            <TpButton variant="seal" size="sm" :disabled="!!item.flag" @click="$emit('handle', item.id)"><TpIcon :icon="PhSealCheck" />标记已处理</TpButton>
          </template>
        </div>
      </div>
    </div>
    <p class="tp-caption mt-3">“已处理”是你的声明，会关联修改证据；它不代表导师已认可。</p>
  </article>
</template>
