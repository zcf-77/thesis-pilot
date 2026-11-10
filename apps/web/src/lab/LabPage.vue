<script setup lang="ts">
defineProps<{ no: string; eyebrow: string; title: string; lead?: string }>();
</script>

<template>
  <article class="lab-wrap">
    <header class="lab-head">
      <p class="tp-label tp-enter"><span class="text-brand">{{ no }}</span> &nbsp;/&nbsp; {{ eyebrow }}</p>
      <h1 class="tp-display tp-enter mt-3" style="--i: 1">{{ title }}</h1>
      <p v-if="lead" class="lab-lead tp-enter" style="--i: 2">{{ lead }}</p>
      <div v-if="$slots.head" class="tp-enter mt-6" style="--i: 3"><slot name="head" /></div>
    </header>
    <slot />
  </article>
</template>
