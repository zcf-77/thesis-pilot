<script setup lang="ts">
import { storeToRefs } from "pinia";
import { RouterLink, RouterView, useRoute } from "vue-router";
import TpAmbient from "@/components/ui/TpAmbient.vue";
import { useAppearanceStore } from "@/stores/appearance";
import { labNav } from "@/router";
import LabDock from "./LabDock.vue";
import LabLogo from "./LabLogo.vue";

const { theme } = storeToRefs(useAppearanceStore());
const route = useRoute();
</script>

<template>
  <div class="lab tp-canvas" :class="{ 'lab--screens': route.meta.screenPreview }" :data-theme="theme">
    <TpAmbient />
    <aside v-if="!route.meta.screenPreview" class="lab-side">
      <RouterLink to="/" class="lab-brand" aria-label="毕设智途 设计展台首页">
        <LabLogo :size="36" />
        <span>
          <span class="lab-brand__name block">毕设智途</span>
          <span class="tp-label block !text-[0.625rem]">Design Lab · v0.1</span>
        </span>
      </RouterLink>
      <nav class="lab-nav" aria-label="展台目录">
        <RouterLink v-for="item in labNav" :key="item.path" :to="item.path" class="lab-nav__item" :class="{ 'is-exact-only': item.path === '/' }">
          <span class="lab-nav__no">{{ item.no }}</span>
          <span class="lab-nav__title">{{ item.title }}</span>
          <span class="lab-nav__desc">{{ item.desc }}</span>
        </RouterLink>
      </nav>
      <p class="tp-caption mt-auto px-1.5 !text-[0.6875rem] !leading-relaxed">
        本展台是设计阶段产物：所有组件为真实 Vue 组件，数据为自制样例。业务流程、Mock 服务与编辑器适配在方案确认后实现。
      </p>
    </aside>
    <main class="lab-main">
      <RouterView v-slot="{ Component, route }">
        <Transition name="tp-page" mode="out-in">
          <component :is="Component" :key="route.meta.screenPreview ? 'screens' : route.path" />
        </Transition>
      </RouterView>
    </main>
    <LabDock />
  </div>
</template>
