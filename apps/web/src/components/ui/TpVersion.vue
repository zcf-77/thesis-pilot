<script setup lang="ts">
/** 版本标记：对象的具体版本，以及它“基于哪个版本”。stale 表示所基于的版本已不是当前版本。 */
defineProps<{ v: number | string; prefix?: string; base?: number | string; stale?: boolean }>();
</script>

<template>
  <span class="tp-ver" :class="{ 'tp-ver--stale': stale }">
    <template v-if="prefix">{{ prefix }}</template>
    <b>v{{ v }}</b>
    <template v-if="base !== undefined">← v{{ base }}</template>
  </span>
</template>
