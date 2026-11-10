<script setup lang="ts">
import type { PlanBarView } from "@/domain/types";

/**
 * 计划调整对比。
 *   candidate  调整候选：原计划位置是空心虚框，建议位置是铅笔条 —— 正式计划未变
 *   adopted    学生采纳后：铅笔条落墨为实心
 *   kept       学生保留原计划：铅笔条消失
 * 硬截止是一条不可移动的红线；候选不得越过它。
 */
defineProps<{ bars: PlanBarView[]; days: number; hardAt: number; hardLabel: string; state: "candidate" | "adopted" | "kept"; weeks: string[] }>();
</script>

<template>
  <div class="tp-plan" :style="{ '--days': days }">
    <div class="tp-plan__row !absolute inset-x-0 top-0" aria-hidden="true">
      <span />
      <span class="grid grid-cols-4"><span v-for="w in weeks" :key="w" class="tp-mono text-fg-faint">{{ w }}</span></span>
    </div>
    <div v-for="bar in bars" :key="bar.id" class="tp-plan__row">
      <span class="truncate" :class="bar.newStart !== undefined && state !== 'kept' ? 'font-semibold' : 'text-fg-muted'">{{ bar.title }}</span>
      <span class="tp-plan__lane">
        <template v-if="bar.newStart !== undefined && bar.newEnd !== undefined">
          <span v-if="state !== 'kept'" class="tp-plan__bar tp-plan__bar--was" :style="{ '--s': bar.start, '--e': bar.end }" />
          <span
            class="tp-plan__bar"
            :class="state === 'candidate' ? 'tp-plan__bar--pencil' : 'tp-plan__bar--ink'"
            :style="{ '--s': state === 'kept' ? bar.start : bar.newStart, '--e': state === 'kept' ? bar.end : bar.newEnd }"
          />
        </template>
        <span v-else class="tp-plan__bar tp-plan__bar--ink" :style="{ '--s': bar.start, '--e': bar.end }" />
      </span>
    </div>
    <span class="tp-plan__hard" :style="{ '--at': hardAt }"><span>{{ hardLabel }}</span></span>
  </div>
</template>
