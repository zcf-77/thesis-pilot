<script setup lang="ts">
/** 样张：一块展示区 + 一行说明。plain 时不套卡片（样张本身就是卡片或需要露出画布）。 */
defineProps<{ name?: string; note?: string; plain?: boolean }>();
</script>

<template>
  <figure class="lab-spec">
    <div class="lab-spec__stage" :class="plain ? '!p-0' : 'tp-card'"><slot /></div>
    <figcaption v-if="name || note" class="lab-spec__cap">
      <b v-if="name">{{ name }}</b>
      <span v-if="note">{{ note }}</span>
    </figcaption>
  </figure>
</template>
