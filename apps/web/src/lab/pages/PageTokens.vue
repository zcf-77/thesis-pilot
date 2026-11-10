<script setup lang="ts">
import { PhCheck, PhX } from "@phosphor-icons/vue";
import { computed } from "vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { useThemeScope } from "@/design/theme";
import { colorTokens, contrast, contrastPairs, spacing, themeList, varTokens, type ColorToken, type VarToken } from "@/design/tokens";
import { useToastStore } from "@/stores/toast";
import LabPage from "../LabPage.vue";
import LabSection from "../LabSection.vue";

const scope = useThemeScope();
const toast = useToastStore();
const t = computed(() => scope.def.value);

const colorGroups = computed(() => {
  const map = new Map<string, ColorToken[]>();
  for (const key of Object.keys(colorTokens) as ColorToken[]) {
    const group = colorTokens[key].group;
    map.set(group, [...(map.get(group) ?? []), key]);
  }
  return [...map.entries()];
});
const varGroups = computed(() => {
  const map = new Map<string, VarToken[]>();
  for (const key of Object.keys(varTokens) as VarToken[]) {
    const group = varTokens[key].group;
    map.set(group, [...(map.get(group) ?? []), key]);
  }
  return [...map.entries()];
});

const solid = (key: ColorToken) => t.value.contrastAs?.[key] ?? t.value.color[key];
const pairs = computed(() =>
  contrastPairs.map(([fg, bg, min, note]) => {
    const ratio = contrast(solid(fg), solid(bg), solid("canvas"));
    return { fg, bg, min, note, ratio, ok: ratio >= min };
  }),
);
const passCount = computed(() => pairs.value.filter((p) => p.ok).length);

async function copy(name: string) {
  const text = "var(--tp-" + name + ")";
  try {
    await navigator.clipboard.writeText(text);
    toast.push({ tone: "neutral", title: "已复制 " + text, duration: 1800 });
  } catch {
    toast.push({ tone: "warning", title: "无法访问剪贴板", desc: text });
  }
}

const daisyMap = [
  ["base-100", "surface", "纸面"],
  ["base-200", "canvas", "画布"],
  ["base-300", "surface-sunken", "凹面"],
  ["base-content", "text", "正文"],
  ["primary", "action", "主行动"],
  ["secondary", "pencil", "铅笔"],
  ["accent", "accent", "品牌强调"],
  ["neutral", "surface-inverse", "反相面"],
  ["info / success / warning / error", "info / success / warning / danger", "状态"],
  ["--radius-field / --radius-box", "radius-s / radius-m", "圆角"],
  ["--border", "border-w", "描边"],
];
const files = [
  { path: "src/design/tokens/themes.ts", what: "单一事实来源：四套方案的全部取值（TypeScript，类型约束每套方案键完全一致）" },
  { path: "tokens/tokens.css", what: "独立 CSS 变量表，不依赖 Tailwind / daisyUI，可直接给任何页面使用" },
  { path: "tokens/thesispilot.tokens.json", what: "W3C Design Tokens 风格 JSON，可导入设计工具或给其他端使用" },
  { path: "docs/design/contrast-report.md", what: "四套方案 × 30 组对比度的实测结果" },
];
</script>

<template>
  <LabPage
    no="03"
    eyebrow="Tokens"
    title="色彩与设计令牌"
    lead="组件里没有一个十六进制色值。所有颜色、字体、圆角、投影与动效都来自下面这些语义令牌；四套方案只是同一份契约的四组取值。当前显示的是你在方案坞里选中的那一套 —— 切换试试。"
  >
    <template #head>
      <div class="flex flex-wrap items-center gap-3">
        <TpStatus tone="neutral" :label="'当前：' + t.name + ' · ' + t.en" />
        <TpStatus :tone="passCount === pairs.length ? 'success' : 'danger'" :label="'对比度契约 ' + passCount + ' / ' + pairs.length + ' 通过'" />
        <span class="tp-caption">点任意令牌复制它的 CSS 变量。</span>
      </div>
    </template>

    <LabSection
      v-for="[group, keys] in colorGroups"
      :id="'c-' + group"
      :key="group"
      :title="group"
      :desc="
        {
          表面: '从底到顶的四层底色，外加反相面与遮罩。纸面可以是半透明的（晨雾）。',
          线条: '分隔线最轻，结构线最重；组件描边单独成令牌，因为荧光笔记需要纯黑描边。',
          文字: '三级文字 + 反相。弱文字只用于占位与装饰，不承载关键信息。',
          行动: '主行动与品牌强调分开：朱墨的主按钮是墨黑，朱砂只做强调与印章。',
          材质: '设计语法的五种材质。铅笔、印章、留白、旧稿各有成组令牌。',
          状态: '五种状态 × 三个角色：实色（圆点与填充）、浅底、浅底上的文字。',
          差异: '只用于两个已存在版本之间的对比；候选差异用铅笔令牌。',
          保护对象: 'AI 修订时不可改动的四类对象，各有下划线颜色。',
          助手: '分类色：区分是谁在说话，不表达好坏。',
        }[group]
      "
    >
      <div class="lab-tokens">
        <button v-for="key in keys" :key="key" type="button" class="lab-token" :aria-label="'复制 --tp-' + key" @click="copy(key)">
          <span class="lab-token__chip"><i :style="{ background: t.color[key] }" /></span>
          <span class="min-w-0">
            <span class="lab-token__name block truncate">{{ colorTokens[key].label }}</span>
            <span class="lab-token__var">--tp-{{ key }}</span>
            <span class="lab-token__val">{{ t.color[key] }}</span>
          </span>
        </button>
      </div>
    </LabSection>

    <LabSection
      id="contrast"
      title="对比度契约"
      desc="不是事后检查，而是令牌的一部分：生成脚本与单元测试都会按 WCAG 2.x 公式计算下面每一组，不达标就失败。数值为当前方案的实时计算结果。"
    >
      <div class="tp-card overflow-hidden">
        <div class="grid sm:grid-cols-2">
          <div v-for="p in pairs" :key="p.note" class="flex items-center gap-3 border-b border-line px-4 py-2">
            <span
              class="grid h-8 w-14 shrink-0 place-items-center rounded-xs border border-line text-[0.8125rem] font-bold"
              :style="{ background: t.color[p.bg], color: t.color[p.fg] }"
              >文Aa</span
            >
            <span class="min-w-0 flex-1 truncate text-[0.8125rem]">{{ p.note }}</span>
            <span class="tp-mono" :class="p.ok ? 'text-fg' : 'text-bad-content'">{{ p.ratio.toFixed(2) }}</span>
            <span class="tp-mono w-10 text-fg-faint">≥ {{ p.min }}</span>
            <TpIcon :icon="p.ok ? PhCheck : PhX" :size="14" weight="bold" :class="p.ok ? 'text-ok-content' : 'text-bad-content'" />
          </div>
        </div>
      </div>
    </LabSection>

    <LabSection id="all" title="四套并排" desc="同一个令牌在四套方案里的取值。横向看是一个语义，纵向看是一种气质。">
      <div class="tp-card overflow-x-auto">
        <table class="tp-table">
          <thead>
            <tr>
              <th>令牌</th>
              <th v-for="th in themeList" :key="th.id">{{ th.name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="key in [
                'canvas',
                'surface',
                'text',
                'action',
                'accent',
                'pencil',
                'seal',
                'highlight',
                'success',
                'warning',
                'danger',
                'info',
              ] as ColorToken[]"
              :key="key"
            >
              <td><b>{{ colorTokens[key].label }}</b> <span class="tp-mono ml-1 text-fg-faint">{{ key }}</span></td>
              <td v-for="th in themeList" :key="th.id">
                <span class="inline-flex items-center gap-2">
                  <i class="inline-block size-5 rounded-xs border border-line" :style="{ background: th.color[key] }" />
                  <span class="tp-mono text-fg-muted">{{ th.color[key].length > 9 ? "半透明" : th.color[key] }}</span>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </LabSection>

    <LabSection id="shape" title="形状与投影" desc="圆角五档、描边一档、投影四档。方案的“骨相”主要由这三组决定。">
      <div class="lab-grid lab-grid--2">
        <div>
          <p class="tp-label mb-3">圆角 · 描边 {{ t.vars["border-w"] }}</p>
          <div class="grid grid-cols-5 gap-3">
            <div v-for="r in ['radius-xs', 'radius-s', 'radius-m', 'radius-l', 'radius-xl'] as VarToken[]" :key="r" class="text-center">
              <div class="lab-shape" :style="{ borderRadius: t.vars[r] }"><span class="tp-mono">{{ t.vars[r] }}</span></div>
              <p class="tp-caption mt-1.5">{{ varTokens[r].label.replace("圆角 ", "") }}</p>
            </div>
          </div>
        </div>
        <div>
          <p class="tp-label mb-3">投影 = 层级读数</p>
          <div class="grid grid-cols-4 gap-5">
            <div v-for="(s, i) in ['shadow-1', 'shadow-2', 'shadow-3', 'shadow-4'] as VarToken[]" :key="s" class="text-center">
              <div class="lab-shape" :style="{ borderRadius: t.vars['radius-m'], boxShadow: t.vars[s] }">
                <span class="tp-mono">L{{ i + 1 }}{{ i === 3 ? "+" : "" }}</span>
              </div>
              <p class="tp-caption mt-2.5">{{ varTokens[s].use }}</p>
            </div>
          </div>
        </div>
      </div>
    </LabSection>

    <LabSection id="space" title="间距" desc="4px 网格。组件内部用小档，区块之间用大档；同一层级的间距保持一致。">
      <div class="tp-card grid gap-2.5 p-5">
        <div v-for="s in spacing" :key="s.id" class="lab-space">
          <span class="tp-mono">{{ s.id }}</span>
          <span class="tp-mono text-fg-muted">{{ s.px }}px</span>
          <span class="flex items-center gap-3"><i :style="{ width: s.px * 2 + 'px' }" /><span class="tp-caption">{{ s.use }}</span></span>
        </div>
      </div>
    </LabSection>

    <LabSection id="vars" title="字体、质感与动效性格" desc="非颜色令牌。动效曲线的可视化见「动效」页。">
      <div class="grid gap-6">
        <div v-for="[group, keys] in varGroups.filter(([g]) => g !== '形状' && g !== '层级')" :key="group" class="tp-card overflow-hidden">
          <p class="border-b border-line-strong px-4 py-2.5"><b class="tp-subheading">{{ group }}</b></p>
          <button
            v-for="key in keys"
            :key="key"
            type="button"
            class="grid w-full grid-cols-[9rem_11rem_minmax(0,1fr)] items-baseline gap-4 border-b border-line px-4 py-2 text-left hover:bg-sunken"
            @click="copy(key)"
          >
            <span class="font-semibold">{{ varTokens[key].label }}</span>
            <span class="tp-mono text-fg-muted">--tp-{{ key }}</span>
            <span class="tp-mono truncate text-fg-faint" :title="t.vars[key]">{{ t.vars[key] }}</span>
          </button>
        </div>
      </div>
    </LabSection>

    <LabSection
      id="daisy"
      title="与 daisyUI / Tailwind 的关系"
      desc="daisyUI 负责表单基元的行为与无障碍默认；它的主题变量由同一份令牌生成，所以 toggle、checkbox 这些原生控件与自绘组件永远同色。Tailwind 工具类通过 @theme inline 直接引用 --tp-*。"
    >
      <div class="lab-grid lab-grid--2 items-start">
        <div class="tp-card overflow-hidden">
          <table class="tp-table">
            <thead>
              <tr>
                <th>daisyUI 变量</th>
                <th>取自令牌</th>
                <th>语义</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in daisyMap" :key="row[0]">
                <td class="tp-mono">{{ row[0] }}</td>
                <td class="tp-mono text-fg-muted">{{ row[1] }}</td>
                <td>{{ row[2] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="tp-card divide-y divide-line">
          <div v-for="f in files" :key="f.path" class="px-4 py-3">
            <p class="tp-mono !text-[0.8125rem] font-semibold">{{ f.path }}</p>
            <p class="tp-caption mt-0.5">{{ f.what }}</p>
          </div>
          <div class="px-4 py-3">
            <p class="tp-mono !text-[0.8125rem] font-semibold">node scripts/build-tokens.ts</p>
            <p class="tp-caption mt-0.5">改完 themes.ts 后运行：重新生成上面三个文件与应用内的 daisyUI 主题块。</p>
          </div>
        </div>
      </div>
    </LabSection>
  </LabPage>
</template>
