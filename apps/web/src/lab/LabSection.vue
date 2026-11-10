<script setup lang="ts">
import { vReveal } from "./reveal";

defineProps<{ id?: string; title: string; desc?: string }>();
</script>

<template>
  <section :id="id" v-reveal class="lab-sec lab-reveal">
    <div class="lab-sec__head">
      <h2 class="tp-title">{{ title }}</h2>
      <p v-if="desc" class="lab-sec__desc">{{ desc }}</p>
    </div>
    <slot />
  </section>
</template>
