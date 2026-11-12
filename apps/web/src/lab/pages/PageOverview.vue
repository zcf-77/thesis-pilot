<script setup lang="ts">
import { PhArrowRight } from "@phosphor-icons/vue";
import { storeToRefs } from "pinia";
import { RouterLink } from "vue-router";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpPencilFrame from "@/components/ui/TpPencilFrame.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import { themeList, themes } from "@/design/tokens";
import { useAppearanceStore } from "@/stores/appearance";
import { labNav } from "@/router";
import LabSection from "../LabSection.vue";
import ScaledFrame from "../scenes/ScaledFrame.vue";
import SceneWorkbench from "../scenes/SceneWorkbench.vue";
import ThemeCard from "../ThemeCard.vue";

const { theme } = storeToRefs(useAppearanceStore());
const letters = ["A", "B", "C", "D"];
const decisions = [
  { no: "1", q: "视觉方案选哪一套？", a: "A 朱墨 / B 荧光笔记 / C 夜航 / D 晨雾，也可以指定组合（例如“白天 A，夜间 C”）。", to: "/directions" },
  { no: "2", q: "应用外壳用哪种布局？", a: "甲 书桌（推荐）/ 乙 卷轴 / 丙 航图。", to: "/layouts" },
  { no: "3", q: "“铅笔 · 墨水 · 印章”这套语法是否认可？", a: "它决定候选、任务、反馈、评审在全站的统一表达。", to: "/grammar" },
  { no: "4", q: "动效要多强？", a: "完整（默认）/ 克制（只保留签名动效）。可在底部方案坞右侧实时切换感受。", to: "/motion" },
];
</script>

<template>
  <article class="lab-wrap">
    <header class="lab-cover">
      <p class="tp-label tp-enter">毕设智途 ThesisPilot · 设计语言 v0.1 · 待确认稿</p>
      <h1 class="lab-cover__title tp-enter" style="--i: 1">
        <span class="lab-cover__pencil">铅笔提议，</span><br />
        <span class="tp-mark" style="--delay: 900ms">墨水落定。</span>
        <TpSeal class="lab-cover__seal" text="学生决定" size="lg" />
      </h1>
      <p class="lab-lead tp-enter" style="--i: 2">
        产品原则只有一句话：<b class="text-fg">AI 主动判断并提供帮助，重要节点介入，学生最终决定。</b>这份设计稿把它翻译成一套看得见的语法 —— AI
        的一切提议都是<span class="tp-cand-ins">铅笔</span>，学生采纳后才变成墨水，每个决定都留下一枚印章。下面是这套语法落在四种气质上的样子。
      </p>
    </header>

    <RouterLink to="/screens/today" class="tp-card tp-card--interactive mt-8 flex items-center gap-4 p-5">
      <span class="tp-mono text-brand">DESIGN / 12</span>
      <span class="min-w-0 flex-1"
        ><b class="tp-subheading block">打开全套页面设计</b><span class="tp-caption">七个工作空间与五个公共入口 · Vue 交互预览，可切换四套主题</span></span
      >
      <TpIcon :icon="PhArrowRight" :size="20" />
    </RouterLink>

    <section class="tp-enter mt-10" style="--i: 3">
      <div class="lab-frame">
        <ScaledFrame><SceneWorkbench autoplay /></ScaledFrame>
      </div>
      <p class="lab-spec__cap">
        <b>写作台 · {{ themes[theme].name }}</b>
        <span>真实组件拼出的界面，正在循环演示「候选待审阅 → 学生采纳 → 落墨盖章」。也可以直接点右侧的 ✓ / ✕ 与「采纳所选」。用底部的方案坞切换四套方案。</span>
      </p>
    </section>

    <LabSection
      title="一套语法，四种气质"
      desc="四套方案共用同一批组件与同一份令牌契约，区别只在令牌取值与一层很薄的“签名样式”。所以选定之后不是重画，而是保留一套、删掉三套。"
    >
      <div class="lab-grid lab-grid--2">
        <ThemeCard v-for="(t, i) in themeList" :key="t.id" :theme="t" :letter="letters[i]" />
      </div>
    </LabSection>

    <LabSection title="这一轮请你确认四件事" desc="确认后进入全量实现：信息架构落地、Mock 服务、编辑器适配与 F01—F20 的完整流程。">
      <div class="grid gap-3">
        <RouterLink v-for="d in decisions" :key="d.no" :to="d.to" class="tp-card tp-card--interactive lab-decide">
          <span class="tp-num lab-decide__no">{{ d.no }}</span>
          <span class="min-w-0">
            <b class="tp-subheading block">{{ d.q }}</b>
            <span class="text-fg-muted">{{ d.a }}</span>
          </span>
          <TpIcon :icon="PhArrowRight" :size="18" class="text-fg-muted" />
        </RouterLink>
      </div>
    </LabSection>

    <LabSection title="本稿包含" desc="全部是可运行的 Vue 3 + TypeScript + Tailwind CSS + daisyUI 源码，不是图片。">
      <div class="lab-grid lab-grid--4">
        <RouterLink v-for="item in labNav.filter((n) => n.path !== '/')" :key="item.path" :to="item.path" class="tp-card tp-card--interactive block p-4">
          <p class="tp-mono text-brand">{{ item.no }}</p>
          <p class="tp-subheading mt-1">{{ item.title }}</p>
          <p class="tp-caption mt-0.5">{{ item.desc }}</p>
        </RouterLink>
      </div>
      <div class="mt-6 grid gap-4 sm:grid-cols-3">
        <TpPencilFrame>
          <div class="p-4">
            <p class="tp-label !text-pencil-content">铅笔 · 还没做</p>
            <p class="tp-hand mt-1 text-pencil-content">业务流程、Mock 服务、编辑器适配层、E2E 测试 —— 方案确认后实现。</p>
          </div>
        </TpPencilFrame>
        <div class="tp-ink p-4">
          <p class="tp-label">墨 · 已经做了</p>
          <p class="mt-1">令牌与四套方案、45 个组件、动效系统、规范文档；Vite+ 工程已能安装、检查、构建。</p>
        </div>
        <div class="tp-ghost p-4">
          <p class="tp-label">留白 · 需要你定</p>
          <p class="mt-1">上面四个问题。没确认之前，不会把任何一套方案当成既定事实往下做。</p>
        </div>
      </div>
    </LabSection>
  </article>
</template>
