<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";
import { PhBell } from "@phosphor-icons/vue";
import TpIcon from "@/components/ui/TpIcon.vue";

/** L1 介入：只在导航上显示未读数，不弹出、不打断写作。 */
const props = defineProps<{ to: RouteLocationRaw; count: number; current: boolean }>();
const label = computed(() => (props.count ? `收件箱，${props.count} 条未读提醒` : "收件箱"));
</script>

<template>
  <RouterLink :to="to" class="screens-tool" title="收件箱" :aria-label="label" :aria-current="current ? 'page' : undefined"
    ><TpIcon :icon="PhBell" :size="18" /><span v-if="count" class="screens-unread inbox-bell__count" aria-hidden="true">{{
      count > 9 ? "9+" : count
    }}</span></RouterLink
  >
</template>
