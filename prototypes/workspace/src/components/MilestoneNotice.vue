<script setup lang="ts">
import { Check, ArrowUpRight, X } from "@lucide/vue";
defineProps<{ chapter: string }>();
defineEmits<{ review: []; later: []; dismiss: [] }>();
</script>

<template>
  <aside class="milestone-notice" aria-label="章节完成建议">
    <span class="notice-icon"><Check :size="17" /></span>
    <div class="notice-copy">
      <strong>{{ chapter }}已标记完成</strong><span>现在可以检查这一章的内容与格式。</span>
    </div>
    <button class="btn btn-sm notice-review" @click="$emit('review')">
      查看评审示例<ArrowUpRight :size="13" /></button
    ><button class="btn btn-ghost btn-sm" @click="$emit('later')">稍后</button
    ><button class="btn btn-ghost icon-button" aria-label="忽略本次建议" @click="$emit('dismiss')">
      <X :size="15" />
    </button>
  </aside>
</template>
