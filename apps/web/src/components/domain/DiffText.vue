<script setup lang="ts">
import type { DiffSegment, HunkDecision } from "@/domain/types";

/**
 * 差异文本。
 *   mode="candidate"  铅笔语法：新增是铅笔色虚线下划线，删除是铅笔删除线 —— 表示“提议”
 *   mode="history"    事实语法：绿 / 红 —— 表示两个已存在版本之间的差别
 * decision：accepted 时新增文字“落墨”为正文色、删除文字消失；rejected 时恢复原文。
 */
withDefaults(defineProps<{ segments: DiffSegment[]; mode?: "candidate" | "history"; decision?: HunkDecision }>(), { mode: "candidate", decision: "pending" });

const kindLabel = { number: "数字", citation: "引用", formula: "公式", lock: "锁定" } as const;
</script>

<template>
  <span>
    <template v-for="(seg, i) in segments" :key="i">
      <span v-if="seg.t === 'eq'">{{ seg.text }}</span>
      <span
        v-else-if="seg.t === 'protect'"
        class="tp-protect tp-tip"
        :class="{ 'is-violated': seg.violated }"
        :data-kind="seg.kind"
        :data-tip="(seg.violated ? '候选改动了受保护的' : '受保护的') + kindLabel[seg.kind ?? 'lock'] + (seg.violated ? '，已拦截' : '，AI 不可修改')"
        tabindex="0"
        >{{ seg.text }}</span
      >
      <template v-else-if="mode === 'history'">
        <ins v-if="seg.t === 'ins'" class="tp-hist-ins no-underline">{{ seg.text }}</ins>
        <del v-else class="tp-hist-del">{{ seg.text }}</del>
      </template>
      <template v-else-if="seg.t === 'ins'">
        <ins v-if="decision !== 'rejected'" class="tp-cand-ins" :class="{ 'is-inked': decision === 'accepted' }">{{ seg.text }}</ins>
      </template>
      <template v-else>
        <del v-if="decision === 'pending'" class="tp-cand-del">{{ seg.text }}</del>
        <span v-else-if="decision === 'rejected'">{{ seg.text }}</span>
      </template>
    </template>
  </span>
</template>
