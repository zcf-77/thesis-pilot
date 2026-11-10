<script setup lang="ts">
import { PhArrowRight, PhCheck, PhThumbsUp, PhWarning } from "@phosphor-icons/vue";
import { ref } from "vue";
import ThemeScope from "@/components/ui/ThemeScope.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { springToLinear, themeList, type ColorToken } from "@/design/tokens";
import { useAppearanceStore } from "@/stores/appearance";
import LabPage from "../LabPage.vue";
import LabSection from "../LabSection.vue";
import ScaledFrame from "../scenes/ScaledFrame.vue";
import SceneToday from "../scenes/SceneToday.vue";
import SceneWorkbench from "../scenes/SceneWorkbench.vue";

const appearance = useAppearanceStore();
const scene = ref<"write" | "today">("write");
const letters = ["A", "B", "C", "D"];
const swatches: { key: ColorToken; name: string }[] = [
  { key: "canvas", name: "画布" },
  { key: "surface", name: "纸面" },
  { key: "ink", name: "墨" },
  { key: "action", name: "主行动" },
  { key: "pencil", name: "铅笔" },
  { key: "seal", name: "印章" },
  { key: "success", name: "成功" },
  { key: "warning", name: "注意" },
  { key: "danger", name: "危险" },
  { key: "info", name: "信息" },
];
const compare = [
  { k: "第一眼", v: ["像一本学术刊物", "像一本手帐", "像驾驶舱", "像清晨的窗边"] },
  { k: "主行动色", v: ["墨黑", "荧光黄", "青柠", "晴空蓝"] },
  { k: "铅笔（AI）", v: ["石青蓝", "紫色荧光", "雷达青", "朝霞粉"] },
  { k: "印章（决定）", v: ["朱砂方印", "粉色贴纸", "橙色仪表标", "蓝黑墨水章"] },
  { k: "形状", v: ["方正 · 发丝线", "大圆角 · 黑描边 · 硬投影", "中圆角 · 细线 · 辉光", "大圆角 · 毛玻璃 · 柔投影"] },
  { k: "展示字体", v: ["思源宋体 Black", "得意黑", "Chakra Petch + 黑体", "Outfit + 黑体"] },
  { k: "动效性格", v: themeList.map((t) => t.motionCharacter.split(" —— ")[0]) },
  { k: "密集页面适应", v: ["★★★★★", "★★★☆☆", "★★★★☆", "★★★★☆"] },
  { k: "辨识度", v: ["★★★★☆", "★★★★★", "★★★★☆", "★★★☆☆"] },
  { k: "长时间写作", v: ["★★★★★", "★★★☆☆", "★★★★☆（夜间）", "★★★★☆"] },
];
</script>

<template>
  <LabPage
    no="01"
    eyebrow="Directions"
    title="四个方案"
    lead="同一张设计稿、同一批组件、同一份数据，换四套令牌。它们不是四种皮肤，而是四种对“毕业设计这件事”的态度：把它当学问、当手帐、当航程，还是当一个安静的早晨。"
  >
    <template #head>
      <div class="flex flex-wrap items-center gap-3">
        <TpSegmented
          v-model="scene"
          label="对比场景"
          :options="[
            { value: 'write', label: '看写作台' },
            { value: 'today', label: '看今日页' },
          ]"
        />
        <span class="tp-caption">每个方案下方的场景都可以直接操作。</span>
      </div>
    </template>

    <section v-for="(t, i) in themeList" :id="t.id" :key="t.id" class="lab-dir">
      <ThemeScope :theme="t.id" canvas class="lab-dir__scope">
        <header class="lab-dir__head">
          <span class="lab-dir__glyph">{{ t.glyph }}</span>
          <div class="min-w-0 flex-1">
            <p class="tp-label">方案 {{ letters[i] }} · {{ t.en }} · {{ t.mode === "dark" ? "深色" : "浅色" }}</p>
            <h2 class="tp-display mt-1">{{ t.name }}</h2>
            <p class="mt-1 text-[1.0625rem] text-fg-muted">{{ t.tagline }}</p>
          </div>
          <div class="flex flex-col items-end gap-2">
            <TpSeal v-if="t.id === 'zhumo'" text="设计师推荐" :animate="false" />
            <TpButton v-if="appearance.theme !== t.id" variant="primary" @click="appearance.setTheme(t.id, { x: $event.clientX, y: $event.clientY })"
              >全站换成它<TpIcon :icon="PhArrowRight"
            /></TpButton>
            <TpButton v-else variant="tonal" disabled><TpIcon :icon="PhCheck" weight="bold" />当前方案</TpButton>
          </div>
        </header>

        <div class="lab-frame mx-6">
          <ScaledFrame>
            <Transition name="tp-swap" mode="out-in">
              <SceneWorkbench v-if="scene === 'write'" key="w" />
              <SceneToday v-else key="t" />
            </Transition>
          </ScaledFrame>
        </div>

        <div class="lab-dir__info">
          <div>
            <p class="tp-label mb-2">设计叙事</p>
            <p class="leading-relaxed">{{ t.story }}</p>
            <div class="mt-3 flex flex-wrap gap-1.5"><TpStatus v-for="m in t.mood" :key="m" tone="neutral" :label="m" size="sm" /></div>
          </div>
          <div class="grid content-start gap-3">
            <p class="flex gap-2">
              <TpIcon :icon="PhThumbsUp" :size="16" class="mt-0.5 text-ok-content" /><span><b>适合</b>　{{ t.bestFor }}</span>
            </p>
            <p class="flex gap-2">
              <TpIcon :icon="PhWarning" :size="16" class="mt-0.5 text-warn-content" /><span><b>留意</b>　{{ t.watchOut }}</span>
            </p>
            <p class="tp-caption">动效：{{ t.motionCharacter }} · 弹簧阻尼比 ζ={{ springToLinear(t.spring).zeta }} · 时长 ×{{ t.durScale }}</p>
          </div>
          <div>
            <p class="tp-label mb-2">关键色</p>
            <div class="lab-swatches">
              <span v-for="s in swatches" :key="s.key" class="lab-swatch">
                <i :style="{ background: t.color[s.key] }" />
                <span>{{ s.name }}</span>
              </span>
            </div>
            <p class="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 whitespace-nowrap">
              <span class="tp-display !text-[1.625rem]">毕设智途</span>
              <span class="tp-num text-[1.25rem]">Aa 0123</span>
              <span class="tp-hand text-pencil-content">铅笔批注</span>
            </p>
          </div>
        </div>
      </ThemeScope>
    </section>

    <LabSection id="compare" title="并排比较" desc="星级是设计判断，不是测量结果；对比度等可计算的指标见「令牌」页的实测表。">
      <div class="tp-card overflow-x-auto">
        <table class="tp-table">
          <thead>
            <tr>
              <th />
              <th v-for="(t, i) in themeList" :key="t.id">{{ letters[i] }} · {{ t.name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in compare" :key="row.k">
              <td class="whitespace-nowrap font-semibold">{{ row.k }}</td>
              <td v-for="(v, i) in row.v" :key="i">{{ v }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </LabSection>

    <LabSection id="recommend" title="我的建议" desc="最终由你决定；这里只说明我会怎么选、为什么。">
      <div class="lab-grid lab-grid--3">
        <div class="tp-ink p-5">
          <p class="tp-label">首选</p>
          <p class="tp-heading mt-1">A 朱墨 为主</p>
          <p class="mt-2 text-fg-muted">
            “铅笔 → 墨水 → 印章”就出自朱批传统，A 是这套语法的原生语境；宋体与发丝线让十几个密集模块依然安静，朱砂只在“学生作出决定”时出现，层级最清楚。
          </p>
        </div>
        <div class="tp-pencil p-5">
          <p class="tp-label !text-pencil-content">可选加料</p>
          <p class="tp-heading mt-1">A + C 昼夜成对</p>
          <p class="mt-2 text-fg-muted">
            白天用朱墨，夜间切夜航。两者共用令牌契约，成本是多维护一套取值；需要为 C 把印章形态再向 A 靠拢一步，保证昼夜是“同一个产品”。
          </p>
        </div>
        <div class="tp-pencil p-5">
          <p class="tp-label !text-pencil-content">如果想更年轻</p>
          <p class="tp-heading mt-1">B 荧光笔记 为主</p>
          <p class="mt-2 text-fg-muted">
            记忆点最强，任务与计划会很出彩。代价是四库管理、运行诊断这类表格页需要一套“降噪”规则（细描边、收起硬投影），我会在全量实现时一并给出。
          </p>
        </div>
      </div>
    </LabSection>
  </LabPage>
</template>
