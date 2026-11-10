<script setup lang="ts">
import { PhBellSimpleZ, PhChatCenteredText, PhClock, PhLightbulb, PhWarning, PhX } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpMenu from "@/components/ui/TpMenu.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { SuggestionView } from "@/domain/types";

/**
 * 主动建议卡。每条建议必须能回答“为什么是现在、凭什么这么说、有什么不确定”。
 *   view     查看并处理（跳到关联对象）
 *   snooze   延后（之后可在收件箱重新访问）
 *   dismiss  忽略本条
 *   supply   学生补充线下进展（“未观察到编辑”≠“没有工作”）
 */
defineProps<{ suggestion: SuggestionView }>();
defineEmits<{ view: [id: string]; snooze: [id: string, until: string]; dismiss: [id: string]; supply: [id: string] }>();
</script>

<template>
  <article class="tp-card tp-sug" :data-level="suggestion.level" :class="{ 'opacity-70': suggestion.state === 'snoozed' }">
    <header class="flex items-start gap-2.5">
      <span class="tp-sev" :data-sev="suggestion.level === 'important' ? 'minor' : 'advice'">
        <TpIcon :icon="suggestion.level === 'important' ? PhWarning : PhLightbulb" :size="15" />
      </span>
      <div class="min-w-0 flex-1">
        <h3 class="tp-subheading !text-[0.9375rem]">{{ suggestion.title }}</h3>
        <p class="mt-0.5 text-[0.8125rem] text-fg-muted">{{ suggestion.body }}</p>
      </div>
      <TpStatus v-if="suggestion.state === 'unread'" tone="info" label="未读" size="sm" />
      <TpStatus v-else-if="suggestion.state === 'snoozed'" tone="ghost" :label="'延后至 ' + suggestion.snoozedUntil" size="sm" />
    </header>
    <dl class="tp-sug__why">
      <dt>触发</dt>
      <dd>{{ suggestion.event }} · <span class="tp-mono">{{ suggestion.at }}</span></dd>
      <dt>依据</dt>
      <dd>
        <ul class="list-inside list-disc marker:text-fg-faint">
          <li v-for="b in suggestion.basis" :key="b">{{ b }}</li>
        </ul>
      </dd>
      <template v-if="suggestion.uncertainty">
        <dt>不确定</dt>
        <dd>{{ suggestion.uncertainty }}</dd>
      </template>
      <dt>关联</dt>
      <dd class="flex flex-wrap gap-1.5"><span v-for="r in suggestion.related" :key="r" class="tp-evi">{{ r }}</span></dd>
    </dl>
    <footer class="mt-3 flex flex-wrap items-center gap-2">
      <TpButton variant="primary" size="sm" @click="$emit('view', suggestion.id)">查看并处理</TpButton>
      <TpButton v-if="suggestion.uncertainty" variant="outline" size="sm" @click="$emit('supply', suggestion.id)"
        ><TpIcon :icon="PhChatCenteredText" />我有线下进展</TpButton
      >
      <span class="ml-auto flex items-center gap-1">
        <TpMenu align="end">
          <template #trigger="{ toggle, open }">
            <TpButton variant="ghost" size="sm" :aria-expanded="open" @click="toggle"><TpIcon :icon="PhBellSimpleZ" />延后</TpButton>
          </template>
          <button class="tp-menu__item" role="menuitem" @click="$emit('snooze', suggestion.id, '今晚 20:00')"><TpIcon :icon="PhClock" />今晚 20:00</button>
          <button class="tp-menu__item" role="menuitem" @click="$emit('snooze', suggestion.id, '明天 09:00')"><TpIcon :icon="PhClock" />明天上午</button>
          <button class="tp-menu__item" role="menuitem" @click="$emit('snooze', suggestion.id, '下周一')"><TpIcon :icon="PhClock" />下周一</button>
        </TpMenu>
        <TpButton variant="ghost" size="sm" icon-only label="忽略这条建议" class="tp-tip" data-tip="忽略" @click="$emit('dismiss', suggestion.id)"
          ><TpIcon :icon="PhX"
        /></TpButton>
      </span>
    </footer>
  </article>
</template>
