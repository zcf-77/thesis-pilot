<script setup lang="ts">
import {
  PhArrowsClockwise,
  PhCheck,
  PhCheckCircle,
  PhClockCounterClockwise,
  PhMinusCircle,
  PhPencilSimpleLine,
  PhSealCheck,
  PhWarningCircle,
  PhX,
  PhXCircle,
} from "@phosphor-icons/vue";
import { computed } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpPencilFrame from "@/components/ui/TpPencilFrame.vue";
import TpScribble from "@/components/ui/TpScribble.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import type { CandidateView, HunkDecision } from "@/domain/types";
import { agents, candidateStatus } from "@/domain/vocab";
import DiffText from "./DiffText.vue";

/**
 * 修订候选卡 —— “铅笔 → 墨水”语法的主场。
 * 受控组件：自身不保存决定，只把意图 emit 出去；是否能采纳由上层（修订服务）校验后改变 candidate.status。
 *   decide      逐片段选择 接受 / 拒绝 / 待定
 *   adopt       采纳当前选择（上层须重新校验版本、保护项与组合结果）
 *   rejectAll   全部拒绝
 *   cancel      取消生成
 *   regenerate  基于当前正文重新生成（过期 / 失败后）
 *   undo        撤销采纳
 */
const props = defineProps<{ candidate: CandidateView; busy?: boolean }>();
defineEmits<{
  decide: [hunkId: string, decision: HunkDecision];
  adopt: [];
  rejectAll: [];
  cancel: [];
  regenerate: [];
  undo: [];
}>();

const word = computed(() => candidateStatus[props.candidate.status]);
const frame = computed(() => {
  switch (props.candidate.status) {
    case "generating":
      return "generating";
    case "adopted":
      return "inked";
    case "rejected":
    case "cancelled":
    case "expired":
      return "erased";
    default:
      return "pencil";
  }
});
const settled = computed(() => ["adopted", "rejected", "cancelled", "expired"].includes(props.candidate.status));
const accepted = computed(() => props.candidate.hunks.filter((h) => h.decision === "accepted").length);
const failed = computed(() => props.candidate.checks.filter((c) => c.result === "fail"));
function effective(decision: HunkDecision): HunkDecision {
  if (props.candidate.status === "adopted") return decision === "accepted" ? "accepted" : "rejected";
  if (props.candidate.status === "rejected") return "rejected";
  // 采纳之前，“已勾选接受”的片段仍然是铅笔：勾选不等于生效
  return decision === "rejected" ? "rejected" : "pending";
}
</script>

<template>
  <TpPencilFrame :state="frame" :class="{ 'tp-stale': candidate.status === 'expired' }">
    <article class="tp-rev" :class="{ 'is-settled': settled }" :aria-label="'修订候选：' + candidate.goal">
      <span v-if="candidate.status === 'adopted'" class="tp-rev__seal"><TpSeal text="已采纳" /></span>
      <header class="tp-rev__head">
        <span class="tp-avatar tp-avatar--sm" :data-agent="candidate.agent">{{ agents[candidate.agent].short }}</span>
        <div class="min-w-0 flex-1" :class="{ 'pr-20': candidate.status === 'adopted' }">
          <h3 class="tp-rev__goal">{{ candidate.goal }}</h3>
          <p class="tp-rev__sub">
            <TpStatus v-if="candidate.status !== 'adopted'" :tone="word.tone" :label="word.label" :live="word.live" size="sm" />
            <span>{{ candidate.scope }}</span>
            <TpVersion :v="candidate.baseVersion" prefix="基于正文 " :stale="candidate.status === 'expired'" />
            <TpVersion v-if="candidate.status === 'expired'" :v="candidate.currentVersion" prefix="当前 " />
            <TpVersion v-if="candidate.resultVersion" :v="candidate.resultVersion" prefix="形成 " />
          </p>
        </div>
      </header>

      <!-- 生成中 -->
      <div v-if="candidate.status === 'generating'" class="mt-3 grid gap-2.5 pb-1">
        <div class="flex items-center gap-2.5 text-pencil-content"><TpScribble :size="18" /><span class="tp-hand">正在起草，正文不会被改动…</span></div>
        <span class="tp-skel h-3 w-full" /><span class="tp-skel h-3 w-4/5" />
        <div>
          <TpButton size="sm" variant="outline" @click="$emit('cancel')"><TpIcon :icon="PhX" />取消生成</TpButton>
        </div>
      </div>

      <template v-else>
        <div class="mt-3">
          <div v-for="(hunk, i) in candidate.hunks" :key="hunk.id" class="tp-hunk" :data-decision="effective(hunk.decision)">
            <span class="tp-hunk__no">{{ String(i + 1).padStart(2, "0") }}</span>
            <div class="min-w-0">
              <p class="tp-hunk__text"><DiffText :segments="hunk.segments" :decision="effective(hunk.decision)" /></p>
              <p class="tp-hunk__reason">{{ hunk.reason }}</p>
              <p v-if="hunk.blocked" class="tp-hunk__blocked"><TpIcon :icon="PhWarningCircle" :size="14" weight="fill" />{{ hunk.blocked }}</p>
            </div>
            <div v-if="candidate.status === 'pending' || candidate.status === 'invalid'" class="tp-hunk__act">
              <button
                type="button"
                class="tp-pick tp-tip"
                data-kind="accept"
                data-tip="接受这一处"
                :aria-label="'接受第 ' + (i + 1) + ' 处修改'"
                :aria-pressed="hunk.decision === 'accepted'"
                :disabled="!!hunk.blocked || busy"
                @click="$emit('decide', hunk.id, hunk.decision === 'accepted' ? 'pending' : 'accepted')"
              >
                <TpIcon :icon="PhCheck" :size="15" weight="bold" />
              </button>
              <button
                type="button"
                class="tp-pick tp-tip"
                data-kind="reject"
                data-tip="拒绝这一处"
                :aria-label="'拒绝第 ' + (i + 1) + ' 处修改'"
                :aria-pressed="hunk.decision === 'rejected'"
                :disabled="busy"
                @click="$emit('decide', hunk.id, hunk.decision === 'rejected' ? 'pending' : 'rejected')"
              >
                <TpIcon :icon="PhX" :size="15" weight="bold" />
              </button>
            </div>
          </div>
        </div>

        <ul class="tp-checks" aria-label="程序校验结果">
          <li class="font-semibold text-fg">程序校验</li>
          <li
            v-for="c in candidate.checks"
            :key="c.id"
            class="tp-checks__item tp-tip"
            :data-result="c.result"
            :data-tip="c.detail ?? (c.result === 'pass' ? '已检查，未发现改动' : c.result === 'unsupported' ? '该对象暂不支持自动校验，已锁定' : '未通过')"
            tabindex="0"
          >
            <TpIcon
              :icon="c.result === 'pass' ? PhCheckCircle : c.result === 'fail' ? PhXCircle : PhMinusCircle"
              :size="13"
              :weight="c.result === 'unsupported' ? 'regular' : 'fill'"
            />{{ c.label }}
          </li>
        </ul>

        <footer class="tp-rev__foot">
          <template v-if="candidate.status === 'pending'">
            <TpButton variant="seal" size="sm" :disabled="accepted === 0" :loading="busy" @click="$emit('adopt')">
              <TpIcon :icon="PhSealCheck" />采纳所选（{{ accepted }}）
            </TpButton>
            <TpButton variant="ghost" size="sm" :disabled="busy" @click="$emit('rejectAll')">全部拒绝</TpButton>
            <span class="tp-caption ml-auto">采纳前，正文保持 v{{ candidate.baseVersion }} 不变</span>
          </template>
          <template v-else-if="candidate.status === 'invalid'">
            <span class="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-bad-content">
              <TpIcon :icon="PhWarningCircle" :size="15" weight="fill" />{{ failed.map((f) => f.label).join("、") }}校验未通过，整条候选不可采纳
            </span>
            <TpButton class="ml-auto" variant="pencil" size="sm" @click="$emit('regenerate')"><TpIcon :icon="PhPencilSimpleLine" />重新生成</TpButton>
          </template>
          <template v-else-if="candidate.status === 'adopted'">
            <span class="tp-caption">已写入正文并保存决定记录 · {{ accepted }} 处接受，{{ candidate.hunks.length - accepted }} 处未采用</span>
            <TpButton class="ml-auto" variant="ghost" size="sm" @click="$emit('undo')"><TpIcon :icon="PhClockCounterClockwise" />撤销采纳</TpButton>
          </template>
          <template v-else-if="candidate.status === 'expired'">
            <span class="text-[0.8125rem]">正文已更新到 v{{ candidate.currentVersion }}，这条候选不能直接覆盖新稿。</span>
            <TpButton class="ml-auto" variant="pencil" size="sm" @click="$emit('regenerate')"
              ><TpIcon :icon="PhArrowsClockwise" />基于 v{{ candidate.currentVersion }} 重新生成</TpButton
            >
          </template>
          <template v-else>
            <span class="tp-caption">{{ word.means }}</span>
            <TpButton class="ml-auto" variant="ghost" size="sm" @click="$emit('regenerate')"><TpIcon :icon="PhArrowsClockwise" />重新生成</TpButton>
          </template>
        </footer>
      </template>
    </article>
  </TpPencilFrame>
</template>
