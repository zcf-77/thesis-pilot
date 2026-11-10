<script setup lang="ts">
import { PhBookmarkSimple, PhChatsCircle, PhCheck, PhSealQuestion, PhWarning } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { LiteratureView } from "@/domain/types";

/**
 * 文献卡。“取得范围”三段条如实显示拿到了什么（题录 / 摘要 / 全文）：
 * 没拿到的是虚线空位；助手的回答不得超出实心部分。
 */
defineProps<{ item: LiteratureView; selected?: boolean }>();
defineEmits<{ save: [id: string]; toggle: [id: string] }>();
</script>

<template>
  <article class="tp-card tp-card--interactive p-4" :class="{ '!border-brand': selected }">
    <header class="flex items-start gap-3">
      <label class="mt-0.5 flex items-center">
        <input
          type="checkbox"
          class="checkbox checkbox-primary checkbox-sm"
          :checked="selected"
          :aria-label="'选择用于提问：' + item.title"
          @change="$emit('toggle', item.id)"
        />
      </label>
      <div class="min-w-0 flex-1">
        <h3 class="tp-subheading !text-[0.9375rem] leading-snug">{{ item.title }}</h3>
        <p class="tp-caption mt-1">{{ item.meta }}</p>
      </div>
    </header>
    <div class="mt-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="tp-label mb-1.5">取得范围</p>
        <div class="tp-cover">
          <span class="tp-cover__seg" :class="{ 'is-on': item.coverage.biblio }">题录</span>
          <span class="tp-cover__seg" :class="{ 'is-on': item.coverage.abstract }">摘要</span>
          <span class="tp-cover__seg" :class="{ 'is-on': item.coverage.fulltext }">全文</span>
        </div>
      </div>
      <TpStatus v-if="item.verify === 'verified'" tone="success" label="来源可回溯" size="sm" />
      <TpStatus v-else-if="item.verify === 'conflict'" tone="warning" label="题录冲突" size="sm" />
      <TpStatus v-else tone="ghost" label="来源无法核实" size="sm" />
    </div>
    <p v-if="item.note" class="mt-2.5 flex items-start gap-1.5 text-[0.75rem] text-fg-muted">
      <TpIcon :icon="item.verify === 'conflict' ? PhWarning : PhSealQuestion" :size="14" class="mt-0.5" />{{ item.note }}
    </p>
    <footer class="mt-3 flex items-center gap-2 border-t border-line pt-3">
      <TpButton size="sm" :variant="item.saved ? 'tonal' : 'outline'" :disabled="item.saved" @click="$emit('save', item.id)">
        <TpIcon :icon="item.saved ? PhCheck : PhBookmarkSimple" />{{ item.saved ? "已在项目资料" : "保存到资料" }}
      </TpButton>
      <TpButton size="sm" variant="pencil" :disabled="item.verify === 'unverified'" class="ml-auto" @click="$emit('toggle', item.id)"
        ><TpIcon :icon="PhChatsCircle" />用它提问</TpButton
      >
    </footer>
  </article>
</template>
