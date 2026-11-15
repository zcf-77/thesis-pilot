<script setup lang="ts">
import { PhArrowRight, PhBell, PhPencilSimpleLine, PhSealCheck, PhWarning, PhX } from "@phosphor-icons/vue";
import { computed, ref } from "vue";
import RevisionCard from "@/components/domain/RevisionCard.vue";
import ThemeScope from "@/components/ui/ThemeScope.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpPencilFrame from "@/components/ui/TpPencilFrame.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { layers, themeList, typeScale } from "@/design/tokens";
import type { CandidateStatus, CandidateView } from "@/domain/types";
import { candidateStatus, jobStatus, parseStatus, taskStatus, verdict, type StatusWord } from "@/domain/vocab";
import * as fx from "../fixtures";
import LabPage from "../LabPage.vue";
import LabSection from "../LabSection.vue";

/* —— 材质 —— */
const materials = [
  { id: "ink", name: "墨", en: "Ink", means: "已成事实", use: "学生写下的正文、确认过的任务、已采纳的修改、导师原话", never: "AI 的任何未采纳产出" },
  {
    id: "pencil",
    name: "铅笔",
    en: "Pencil",
    means: "AI 的提议",
    use: "修订候选、计划调整候选、反馈拆解、语义建议、引用候选",
    never: "已经生效的内容；系统错误",
  },
  {
    id: "seal",
    name: "印章",
    en: "Seal",
    means: "学生的决定",
    use: "采纳、确认完成、标记已处理，以及这些决定的记录",
    never: "AI 判断、系统成功提示、导师认可（本轮没有）",
  },
  { id: "ghost", name: "留白", en: "Ghost", means: "未知", use: "不能判定、未检查项、来源缺失、未识别内容、已取消", never: "用来表示“没问题”" },
  { id: "stale", name: "旧稿", en: "Stale", means: "已过期", use: "基于旧正文的候选与评审报告、被替换的证据", never: "仍然有效的历史版本（那是墨）" },
] as const;

/* —— 候选的一生 —— */
const state = ref<CandidateStatus>("pending");
const order: CandidateStatus[] = ["generating", "pending", "adopted", "undone", "rejected", "cancelled", "invalid", "expired"];
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const live = ref<CandidateView>(clone(fx.candidatePending));
const shown = computed<CandidateView>(() => {
  switch (state.value) {
    case "generating":
      return fx.candidateGenerating;
    case "invalid":
      return fx.candidateInvalid;
    case "expired":
      return fx.candidateExpired;
    case "cancelled":
      return { ...fx.candidateGenerating, status: "cancelled", hunks: [], checks: [] };
    default:
      return { ...live.value, status: state.value, resultVersion: state.value === "adopted" ? 13 : undefined };
  }
});
const transitions: Record<CandidateStatus, string> = {
  generating: "学生发起请求 → 固定正文版本、范围、保护项",
  pending: "生成完成并通过结构校验",
  adopted: "学生点「采纳所选」→ 再次校验 → 写入正文、新版本、决定记录",
  undone: "学生撤销采纳 → 校验当前版本 → 追加撤销版本，保留采纳记录",
  rejected: "学生拒绝",
  cancelled: "学生取消生成；迟到结果被丢弃",
  invalid: "程序发现保护项被改 / 越界 / 结构无效",
  expired: "正文在生成之后发生了变化",
};

/* —— 介入阶梯 —— */
const ladder = [
  { lv: "L0", name: "静默", how: "只记录，不出现", when: "日常输入、自动保存、进度派生计算", h: 24 },
  { lv: "L1", name: "角标", how: "导航上的小圆点或计数", when: "有新的候选、后台任务完成", h: 40 },
  { lv: "L2", name: "收件箱", how: "建议卡进入收件箱，不弹出", when: "完成重要章节、持续没有可观察进展", h: 58 },
  { lv: "L3", name: "页内横幅", how: "当前页顶部一条可延后、可忽略的横幅", when: "明显延期、阶段完成、硬截止临近", h: 78 },
  { lv: "L4", name: "模态", how: "必须作出选择才能继续", when: "版本冲突、会话失效、保存失败可能丢稿", h: 100 },
];

/* —— 状态词汇表 —— */
const vocab: { name: string; f: string; words: Record<string, StatusWord> }[] = [
  { name: "修订候选", f: "F05", words: candidateStatus },
  { name: "任务", f: "F07", words: taskStatus },
  { name: "资料解析", f: "F10 · F11", words: parseStatus },
  { name: "要求结论", f: "F12", words: verdict },
  { name: "后台任务", f: "F19", words: jobStatus },
];

const samples: Record<string, string> = {
  "display-xl": "铅笔提议，墨水落定",
  display: "论文撰写 · 第 12 天",
  title: "第 3 章 系统设计",
  heading: "修订候选 · 3 处待你决定",
  subheading: "补充协同过滤对比实验",
  body: "系统只按已知截止时间提醒，不推测你的效率。",
  prose: "本文采用基于物品的协同过滤算法完成候选商品的召回。",
  caption: "正文 v13 · 8,460 字 · 上次编辑 14:32",
  label: "等你决定 PENDING",
  mono: "v13 ← v12 · C-204 · 11-11 14:32",
  hand: "这一处改动较大，你看看是否符合原意。",
};
const cls: Record<string, string> = {
  "display-xl": "tp-display-xl",
  display: "tp-display",
  title: "tp-title",
  heading: "tp-heading",
  subheading: "tp-subheading",
  body: "tp-body",
  prose: "tp-prose",
  caption: "tp-caption",
  label: "tp-label",
  mono: "tp-mono",
  hand: "tp-hand",
};
</script>

<template>
  <LabPage
    no="02"
    eyebrow="Design grammar"
    title="设计语法"
    lead="颜色会随方案改变，但这套语法不变：用“笔迹”表达一件事有多确定、是谁说的。它把“AI 提议、学生决定”从一句原则变成每个界面都看得见的规则。"
  >
    <LabSection id="materials" title="五种材质" desc="每种材质都由“线型 + 底纹 + 形态”共同表达，不单靠颜色 —— 色觉差异或灰度打印下依然分得清。">
      <div class="lab-mats">
        <article v-for="(mat, i) in materials" :key="mat.id" class="lab-mat lab-reveal is-in" :style="{ '--i': i }">
          <div class="lab-mat__stage">
            <div v-if="mat.id === 'ink'" class="tp-ink w-full px-4 py-3"><p class="font-prose">学生写下的句子。</p></div>
            <TpPencilFrame v-else-if="mat.id === 'pencil'" class="w-full">
              <div class="px-4 py-3"><p class="tp-hand text-pencil-content">建议改成这样写……</p></div>
            </TpPencilFrame>
            <div v-else-if="mat.id === 'seal'" class="flex items-center gap-4"><TpSeal text="已采纳" size="lg" /><TpSeal text="已确认" solid /></div>
            <div v-else-if="mat.id === 'ghost'" class="tp-ghost w-full px-4 py-3 text-center font-semibold">不能判定</div>
            <div v-else class="tp-stale w-full px-4 py-3">基于 v11 的候选</div>
          </div>
          <p class="tp-label mt-4">{{ mat.en }}</p>
          <h3 class="tp-title !text-[1.5rem]">
            {{ mat.name }}<span class="ml-2 text-[0.875rem] font-normal text-fg-muted" style="font-family: var(--tp-font-body)">{{ mat.means }}</span>
          </h3>
          <dl class="mt-2 grid gap-1.5 text-[0.8125rem] leading-snug">
            <div>
              <dt class="tp-label inline">用在　</dt>
              <dd class="inline text-fg-muted">{{ mat.use }}</dd>
            </div>
            <div>
              <dt class="tp-label inline !text-bad-content">不用在　</dt>
              <dd class="inline text-fg-muted">{{ mat.never }}</dd>
            </div>
          </dl>
        </article>
      </div>
    </LabSection>

    <LabSection
      id="matrix"
      title="同一套语法，四种笔迹"
      desc="五种材质在四套方案里的样子。颜色、字体、圆角都变了，但虚线还是提议、印章还是决定、斜纹还是未知 —— 换方案不需要重新学一遍界面。"
    >
      <div class="lab-matrix">
        <ThemeScope v-for="th in themeList" :key="th.id" :theme="th.id" canvas class="lab-matrix__row">
          <p class="lab-matrix__name"><span class="tp-title !text-[1.25rem]">{{ th.name }}</span><span class="tp-label">{{ th.en }}</span></p>
          <div class="tp-ink px-3.5 py-2.5"><p class="font-prose">学生写下的句子。</p></div>
          <TpPencilFrame
            ><div class="px-3.5 py-2.5"><p class="tp-hand text-pencil-content">建议改成这样写……</p></div></TpPencilFrame
          >
          <div class="flex items-center justify-center gap-3"><TpSeal text="已采纳" :animate="false" /><TpSeal text="已确认" solid :animate="false" /></div>
          <div class="tp-ghost px-3.5 py-2.5 text-center font-semibold">不能判定</div>
          <div class="tp-stale px-3.5 py-2.5">基于 v11 的候选</div>
        </ThemeScope>
      </div>
    </LabSection>

    <LabSection id="lifecycle" title="一条候选的一生" desc="建议状态至少区分七种。点左边的状态，右边的卡片会换成对应的材质；只有“已采纳”会改变正文版本。">
      <div class="lab-grid lab-grid--2 items-start">
        <div class="tp-card p-5">
          <ol class="lab-life">
            <li v-for="s in order" :key="s">
              <button type="button" class="lab-life__btn" :aria-pressed="state === s" @click="state = s">
                <TpStatus :tone="candidateStatus[s].tone" :label="candidateStatus[s].label" :live="candidateStatus[s].live" />
                <span class="min-w-0 flex-1 text-left">
                  <span class="block text-[0.8125rem] leading-snug">{{ candidateStatus[s].means }}</span>
                  <span class="tp-caption block !text-[0.6875rem]">进入条件：{{ transitions[s] }}</span>
                </span>
                <TpIcon :icon="PhArrowRight" :size="14" class="text-fg-faint" />
              </button>
            </li>
          </ol>
          <p class="mt-4 flex items-center gap-2 border-t border-line pt-4 text-[0.8125rem]">
            正文版本
            <b class="tp-mono !text-[0.875rem]">v12</b>
            <Transition name="tp-swap" mode="out-in">
              <span v-if="state === 'adopted'" key="a" class="inline-flex items-center gap-2"
                ><TpIcon :icon="PhArrowRight" :size="12" /><b class="tp-mono !text-[0.875rem] text-seal">v13</b
                ><span class="text-fg-muted">正文已改变</span></span
              >
              <span v-else key="b" class="text-fg-muted">保持不变</span>
            </Transition>
          </p>
        </div>
        <Transition name="tp-swap" mode="out-in">
          <RevisionCard
            :key="state"
            :candidate="shown"
            @decide="
              (id, d) => {
                const h = live.hunks.find((x) => x.id === id);
                if (h) h.decision = d;
              }
            "
            @adopt="state = 'adopted'"
            @reject-all="state = 'rejected'"
            @cancel="state = 'cancelled'"
            @undo="state = 'pending'"
            @regenerate="state = 'generating'"
          />
        </Transition>
      </div>
    </LabSection>

    <LabSection id="layers" title="层级一：空间" desc="六层，自下而上。投影不是装饰，是层级的读数：层越高，投影越深、越少出现。把鼠标移到图上，各层会分开。">
      <div class="lab-grid lab-grid--2 items-center">
        <div class="lab-iso" aria-hidden="true">
          <div class="lab-iso__stack">
            <div class="lab-iso__plane tp-canvas" style="--i: 0"><span>L0</span></div>
            <div class="lab-iso__plane" style="--i: 1; background: var(--tp-surface); box-shadow: var(--tp-shadow-1)">
              <span>L1</span><i class="a" /><i class="b" /><i class="c" />
            </div>
            <div class="lab-iso__plane lab-iso__plane--part" style="--i: 2; --w: 46%; --h: 34%; --x: 8%; --y: 12%; box-shadow: var(--tp-shadow-2)">
              <span>L2</span>
            </div>
            <div class="lab-iso__plane lab-iso__plane--part" style="--i: 3; --w: 30%; --h: 70%; --x: 66%; --y: 14%; box-shadow: var(--tp-shadow-3)">
              <span>L3</span>
            </div>
            <div class="lab-iso__plane lab-iso__plane--scrim" style="--i: 4">
              <div class="lab-iso__dialog" style="box-shadow: var(--tp-shadow-4)"><span>L4</span></div>
            </div>
            <div class="lab-iso__plane lab-iso__plane--part" style="--i: 5; --w: 44%; --h: 16%; --x: 28%; --y: 6%; box-shadow: var(--tp-shadow-4)">
              <span>L5</span>
            </div>
          </div>
        </div>
        <table class="tp-table">
          <thead>
            <tr>
              <th>层</th>
              <th>放什么</th>
              <th>投影</th>
              <th>z</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in [...layers].reverse()" :key="l.id">
              <td class="whitespace-nowrap font-semibold">{{ l.label }}</td>
              <td>{{ l.what }}</td>
              <td class="tp-mono">{{ l.shadow }}</td>
              <td class="tp-mono">{{ l.z }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </LabSection>

    <LabSection
      id="emphasis"
      title="层级二：强调"
      desc="一个区域只有一个主角。强调只按下面的顺序递增，不跳级：先用字重与字号，再用颜色，然后是填充，最后才是投影与动效。"
    >
      <div class="tp-card grid gap-5 p-5 lg:grid-cols-5">
        <div>
          <TpButton variant="seal"><TpIcon :icon="PhSealCheck" />采纳修改</TpButton>
          <p class="tp-label mt-3">1 · 决定</p>
          <p class="tp-caption">改变正式论文或计划。印章色 + 签名动效。</p>
        </div>
        <div>
          <TpButton variant="primary">保存并继续</TpButton>
          <p class="tp-label mt-3">2 · 主行动</p>
          <p class="tp-caption">区域内最重要的普通操作。实心。</p>
        </div>
        <div>
          <TpButton variant="pencil"><TpIcon :icon="PhPencilSimpleLine" />让 AI 起草</TpButton>
          <p class="tp-label mt-3">3 · 请 AI 提议</p>
          <p class="tp-caption">只产生候选。虚线。</p>
        </div>
        <div>
          <TpButton variant="outline">查看依据</TpButton>
          <p class="tp-label mt-3">4 · 次要</p>
          <p class="tp-caption">描边或浅底。</p>
        </div>
        <div>
          <TpButton variant="ghost">取消</TpButton>
          <p class="tp-label mt-3">5 · 可忽略</p>
          <p class="tp-caption">只有文字。</p>
        </div>
      </div>
    </LabSection>

    <LabSection
      id="ladder"
      title="层级三：介入"
      desc="“主动辅助”不等于“一直打扰”。AI 的每次出现都要先选定一级台阶；台阶越高，要求的依据越硬，出现得越少。同类事件会去重、合并并进入冷却。"
    >
      <div class="lab-ladder">
        <div v-for="(step, i) in ladder" :key="step.lv" class="lab-ladder__step lab-reveal is-in" :style="{ '--i': i, '--hpx': step.h * 1.7 }">
          <div class="lab-ladder__demo">
            <span v-if="i === 0" class="tp-caption">（无界面）</span>
            <span v-else-if="i === 1" class="relative grid size-9 place-items-center rounded-sm bg-sunken"
              ><TpIcon :icon="PhBell" :size="18" /><i class="sc-rail__dot !right-0.5 !top-0.5"
            /></span>
            <div v-else-if="i === 2" class="tp-card w-full px-2.5 py-2 text-left">
              <p class="text-[0.6875rem] font-semibold leading-tight">第 2 章已确认，要评审吗？</p>
              <p class="tp-caption !text-[0.625rem]">收件箱 · 未读</p>
            </div>
            <div v-else-if="i === 3" class="flex w-full items-center gap-1.5 rounded-sm bg-warn-soft px-2.5 py-2 text-left text-warn-content">
              <TpIcon :icon="PhWarning" :size="14" /><span class="flex-1 text-[0.6875rem] font-semibold leading-tight">第 3 章比计划晚 5 天</span
              ><TpIcon :icon="PhX" :size="11" />
            </div>
            <div v-else class="w-full rounded-md border border-edge bg-raised px-2.5 py-2 text-left shadow-4">
              <p class="text-[0.6875rem] font-semibold leading-tight">正文已更新，候选不能直接覆盖</p>
              <div class="mt-1.5 flex gap-1"><span class="h-3.5 flex-1 rounded-xs bg-sunken" /><span class="h-3.5 flex-1 rounded-xs bg-action" /></div>
            </div>
          </div>
          <div class="lab-ladder__bar"><b class="tp-num">{{ step.lv }}</b></div>
          <p class="tp-subheading mt-3">{{ step.name }}</p>
          <p class="text-[0.8125rem] text-fg-muted">{{ step.how }}</p>
          <p class="tp-caption mt-1.5"><span class="tp-label">何时　</span>{{ step.when }}</p>
        </div>
      </div>
    </LabSection>

    <LabSection id="type" title="层级四：文字" desc="十一级字阶，六种字体角色。展示字体只做标题与数字；手写字体只给铅笔批注（不超过二十个字）。">
      <div class="tp-card divide-y divide-line">
        <div v-for="step in typeScale" :key="step.id" class="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-baseline gap-4 px-5 py-3.5">
          <div>
            <p class="font-semibold">{{ step.label }}</p>
            <p class="tp-mono text-fg-faint">.{{ cls[step.id] }}</p>
          </div>
          <p :class="cls[step.id]" class="truncate" :style="step.id === 'display-xl' ? { fontSize: '3rem' } : undefined">{{ samples[step.id] }}</p>
          <p class="tp-caption w-56 text-right">{{ step.size }}px / {{ step.line }} · {{ step.use }}</p>
        </div>
      </div>
    </LabSection>

    <LabSection
      id="vocab"
      title="状态词汇表"
      desc="同一个状态在所有模块里叫同一个名字、用同一种语气。这张表直接来自 src/domain/vocab.ts，组件与文案都从那里取值。"
    >
      <div class="grid gap-6">
        <div v-for="group in vocab" :key="group.name" class="tp-card overflow-hidden">
          <p class="flex items-baseline gap-2 border-b border-line-strong px-4 py-2.5">
            <b class="tp-subheading">{{ group.name }}</b><span class="tp-mono text-fg-faint">{{ group.f }}</span>
          </p>
          <div class="grid sm:grid-cols-2">
            <div v-for="(word, key) in group.words" :key="key" class="flex items-center gap-3 border-b border-line px-4 py-2.5">
              <span class="w-32 shrink-0"><TpStatus :tone="word.tone" :label="word.label" :live="word.live" /></span>
              <span class="text-[0.8125rem] leading-snug text-fg-muted">{{ word.means }}</span>
            </div>
          </div>
        </div>
      </div>
    </LabSection>
  </LabPage>
</template>
