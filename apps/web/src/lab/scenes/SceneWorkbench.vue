<script setup lang="ts">
import { PhCheck, PhLockSimple, PhPencilSimpleLine } from "@phosphor-icons/vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import AssistantMessage from "@/components/domain/AssistantMessage.vue";
import ContextScope, { type ScopeItem } from "@/components/domain/ContextScope.vue";
import DiffText from "@/components/domain/DiffText.vue";
import RevisionCard from "@/components/domain/RevisionCard.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import type { AgentKind, CandidateView, HunkDecision } from "@/domain/types";
import { agents } from "@/domain/vocab";
import { useAppearanceStore } from "@/stores/appearance";
import { candidatePending, project } from "../fixtures";
import SceneShell from "./SceneShell.vue";

/**
 * 场景 · 写作台：章节目录 + 稿纸 + 副驾坞。
 * 稿纸里的候选差异与右侧候选卡由同一份数据驱动：采纳时两处同时“落墨”。
 * autoplay 时循环演示「待审阅 → 采纳 → 复位」。
 */
const props = defineProps<{ autoplay?: boolean }>();
const appearance = useAppearanceStore();

function fresh(): CandidateView {
  const c = JSON.parse(JSON.stringify(candidatePending)) as CandidateView;
  c.hunks = c.hunks.slice(0, 2);
  c.goal = "润色这一段：更学术、更明确";
  c.scope = "选区 96 字";
  return c;
}
const candidate = ref(fresh());
const mode = ref<"general" | "expert">("expert");
const scope: ScopeItem[] = [
  { id: "v", kind: "version", label: "正文 v12", fixed: true },
  { id: "c", kind: "chapter", label: "3.2 节" },
  { id: "m", kind: "material", label: "撰写规范 v2" },
];
const tabs: AgentKind[] = ["content", "lit", "format", "progress", "review"];

function adopt() {
  candidate.value.status = "adopted";
  candidate.value.resultVersion = 13;
}
function reset() {
  candidate.value = fresh();
}
function decide(id: string, decision: HunkDecision) {
  const hunk = candidate.value.hunks.find((h) => h.id === id);
  if (hunk) hunk.decision = decision;
}
const effective = (d: HunkDecision): HunkDecision =>
  candidate.value.status === "adopted" ? (d === "accepted" ? "accepted" : "rejected") : d === "rejected" ? "rejected" : "pending";
const adopted = computed(() => candidate.value.status === "adopted");

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  if (!props.autoplay || appearance.motion === "reduced") return;
  let tick = 0;
  timer = setInterval(() => {
    tick = (tick + 1) % 4;
    if (tick === 2) adopt();
    else if (tick === 0) reset();
  }, 2200);
});
onBeforeUnmount(() => clearInterval(timer));

const chapters = [
  { no: "1", title: "绪论", state: "confirmed", words: "1,820" },
  { no: "2", title: "相关技术", state: "confirmed", words: "2,430" },
  { no: "3", title: "系统设计", state: "current", words: "3,210" },
  { no: "4", title: "系统实现", state: "todo", words: "1,000" },
  { no: "5", title: "测试与分析", state: "todo", words: "—" },
];
</script>

<template>
  <SceneShell active="write">
    <div class="sc-write">
      <!-- 章节目录 -->
      <aside class="tp-card sc-outline">
        <p class="tp-label px-1 pb-2">章节</p>
        <template v-for="ch in chapters" :key="ch.no">
          <div class="sc-ch" :data-state="ch.state">
            <span class="sc-ch__mark"><TpIcon v-if="ch.state === 'confirmed'" :icon="PhCheck" :size="9" weight="bold" /></span>
            <span class="truncate">{{ ch.no }}　{{ ch.title }}</span>
            <span class="tp-mono text-fg-faint">{{ ch.words }}</span>
          </div>
          <div v-if="ch.no === '3'" class="sc-sub">
            <span>3.1 总体架构</span>
            <span class="is-active">3.2 协同过滤召回</span>
            <span>3.3 排序模型</span>
          </div>
        </template>
        <div class="mt-auto border-t border-line px-1 pt-3">
          <p class="flex items-baseline justify-between text-[0.75rem] text-fg-muted">
            正文<b class="tp-num text-[1.125rem] text-fg">{{ adopted ? "8,460" : "8,431" }}</b>
          </p>
          <p class="tp-caption !text-[0.6875rem]">要求 ≥ 12,000 字 · 未达</p>
        </div>
      </aside>

      <!-- 稿纸 -->
      <section class="tp-paper sc-paper">
        <span class="tp-only-zhumo tp-vertical sc-paper__vert">第三章　系统设计</span>
        <div class="tp-only-yingguang tp-sticky tp-hand sc-paper__sticky">周四前<br />交初稿！</div>
        <p class="tp-only-yehang tp-mono sc-paper__hud">CH 03 · §3.2 · SEL 96</p>
        <p class="tp-label">第 3 章 · 系统设计</p>
        <div class="tp-prose mt-2">
          <h2 style="margin-top: 0">3.2 协同过滤召回</h2>
          <p>
            召回层的任务是从全部在售商品中快速筛出几百件候选。考虑到校园平台的商品更新快、单件库存少，本文没有采用需要长时间训练的向量召回，而是选择了实现简单、可解释的协同过滤。
          </p>
          <p class="relative sc-paper__selp">
            <span class="sc-paper__sel" :class="{ 'is-inked': adopted }">
              <DiffText v-for="h in candidate.hunks" :key="h.id" :segments="h.segments" :decision="effective(h.decision)" />
            </span>
            但是新商品效果不太好，因为没有交互数据。
            <span class="sc-bubble" :class="{ 'is-hidden': adopted }">
              <TpButton variant="pencil" size="sm"><TpIcon :icon="PhPencilSimpleLine" />让 AI 起草</TpButton>
              <TpButton variant="ghost" size="sm" icon-only label="锁定选区"><TpIcon :icon="PhLockSimple" /></TpButton>
            </span>
          </p>
          <h3>3.2.1 相似度计算</h3>
          <p>
            两件商品的相似度按式 <span class="tp-protect" data-kind="formula">(3-1)</span> 计算，并对活跃用户做对数惩罚<span
              class="tp-protect"
              data-kind="citation"
              >[5]</span
            >。<span class="tp-protect" data-kind="lock">本节实验数据均来自作者自建的校园交易数据集。</span>
          </p>
        </div>
        <p class="sc-note tp-hand" :class="{ 'is-hidden': adopted }">
          <svg width="34" height="22" viewBox="0 0 34 22" fill="none" aria-hidden="true">
            <path d="M33 3C22 2 10 6 4 17M4 17l1-7M4 17l7-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          2 处建议<br />等你决定
        </p>
      </section>

      <!-- 副驾坞 -->
      <aside class="tp-card tp-corners sc-dock">
        <header class="flex items-center justify-between gap-2">
          <p class="tp-label">副驾</p>
          <TpSegmented
            v-model="mode"
            label="AI 模式"
            :options="[
              { value: 'general', label: '综合' },
              { value: 'expert', label: '专业' },
            ]"
          />
        </header>
        <div class="sc-agents">
          <span v-for="(a, i) in tabs" :key="a" class="sc-agent" :class="{ 'is-active': i === 0 }">
            <span class="tp-avatar tp-avatar--sm" :data-agent="a">{{ agents[a].short }}</span>
            <span v-if="i === 0" class="text-[0.75rem] font-semibold">{{ agents[a].name }}</span>
          </span>
        </div>
        <ContextScope :items="scope" />
        <AssistantMessage role="user">读着有点口语，改学术些，数字别动。</AssistantMessage>
        <RevisionCard :candidate="candidate" @decide="decide" @adopt="adopt" @reject-all="candidate.status = 'rejected'" @undo="reset" @regenerate="reset" />
        <div class="tp-composer mt-auto !flex-row !items-center !py-2">
          <span class="flex-1 text-[0.8125rem] text-fg-faint">继续说明你想怎么改…</span>
          <span class="tp-caption !text-[0.6875rem]">{{ project.short }} · v{{ adopted ? 13 : 12 }}</span>
        </div>
      </aside>
    </div>
  </SceneShell>
</template>
