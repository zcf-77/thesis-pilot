<script setup lang="ts">
import { PhArrowCounterClockwise, PhSealCheck } from "@phosphor-icons/vue";
import { computed, onBeforeUnmount, reactive, ref } from "vue";
import AssistantComposer from "@/components/domain/AssistantComposer.vue";
import AssistantMessage from "@/components/domain/AssistantMessage.vue";
import ConfigChain from "@/components/domain/ConfigChain.vue";
import ContextScope, { type ScopeItem } from "@/components/domain/ContextScope.vue";
import EditorSpecimen from "@/components/domain/EditorSpecimen.vue";
import FeedbackCard from "@/components/domain/FeedbackCard.vue";
import IssueItem from "@/components/domain/IssueItem.vue";
import JobRow from "@/components/domain/JobRow.vue";
import LiteratureCard from "@/components/domain/LiteratureCard.vue";
import MaterialRow from "@/components/domain/MaterialRow.vue";
import PlanDiff from "@/components/domain/PlanDiff.vue";
import RequirementRow from "@/components/domain/RequirementRow.vue";
import ReviewSummary from "@/components/domain/ReviewSummary.vue";
import RevisionCard from "@/components/domain/RevisionCard.vue";
import RunSteps from "@/components/domain/RunSteps.vue";
import StageRoute from "@/components/domain/StageRoute.vue";
import SuggestionCard from "@/components/domain/SuggestionCard.vue";
import TaskCard from "@/components/domain/TaskCard.vue";
import VersionTimeline from "@/components/domain/VersionTimeline.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { listMotionHooks } from "@/design/motion";
import type { CandidateView, HunkDecision } from "@/domain/types";
import { useToastStore } from "@/stores/toast";
import * as fx from "../fixtures";
import LabPage from "../LabPage.vue";
import LabSection from "../LabSection.vue";
import LabSpecimen from "../LabSpecimen.vue";

const toast = useToastStore();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/* —— 任务：学生确认 —— */
const tasks = ref(clone(fx.tasks));
function confirmTask(id: string) {
  const task = tasks.value.find((t) => t.id === id);
  if (!task) return;
  task.status = "confirmed";
  task.confirmedAt = "11-11 14:40";
  toast.push({ tone: "seal", title: "已确认完成", desc: "派生进度已更新；依赖它的任务已解锁。" });
}
const confirmedCount = computed(() => tasks.value.filter((t) => t.status === "confirmed").length);

/* —— 修订候选：受控状态机（展台内的简化版，真实校验在修订服务） —— */
const pending = ref<CandidateView>(clone(fx.candidatePending));
const generating = ref<CandidateView>(clone(fx.candidateGenerating));
const adopting = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
function decide(hunkId: string, decision: HunkDecision) {
  const hunk = pending.value.hunks.find((h) => h.id === hunkId);
  if (hunk) hunk.decision = decision;
}
function adopt() {
  adopting.value = true;
  timer = setTimeout(() => {
    adopting.value = false;
    pending.value.status = "adopted";
    pending.value.resultVersion = 13;
    toast.push({ tone: "seal", title: "已采纳，正文 v12 → v13", desc: "校验通过：版本未变、保护项未改、改动在选区内。" });
  }, 700);
}
function resetCandidates() {
  pending.value = clone(fx.candidatePending);
  generating.value = clone(fx.candidateGenerating);
}
onBeforeUnmount(() => clearTimeout(timer));

/* —— 助手会话 —— */
const scope = ref<ScopeItem[]>([
  { id: "p", kind: "project", label: fx.project.short, fixed: true },
  { id: "v", kind: "version", label: "正文 v13", fixed: true },
  { id: "c", kind: "chapter", label: "3.2 协同过滤召回" },
  { id: "s", kind: "selection", label: "选区 96 字" },
  { id: "m", kind: "material", label: "撰写规范 v2" },
]);
const draft = ref("第 4 段的结论是不是太武断了？");
const sent = ref<string[]>([]);
const steps = ref(clone(fx.runSteps));

/* —— 主动建议 —— */
const suggestions = ref(clone(fx.suggestions));

/* —— 反馈 —— */
const feedback = ref(clone(fx.feedback));

/* —— 文献 —— */
const picked = ref<string[]>(["L-012"]);
const literature = ref(clone(fx.literature));

/* —— 评审 —— */
const currentVersion = ref<"13" | "14">("13");

/* —— 计划 —— */
const planState = ref<"candidate" | "adopted" | "kept">("candidate");

/* —— 版本 —— */
const versions = ref(clone(fx.versions));
function restore(v: number) {
  const from = versions.value.find((x) => x.v === v);
  if (!from) return;
  const next = Math.max(...versions.value.map((x) => x.v)) + 1;
  versions.value = [
    { v: next, at: "刚刚", cause: "restore", summary: "恢复自 v" + v + "（此前版本全部保留）", words: from.words, current: true },
    ...versions.value.map((x) => ({ ...x, current: false })),
  ];
}

/* —— 四库 —— */
const chain = ref<"ok" | "broken">("ok");
const jobs = reactive(clone(fx.jobs));
</script>

<template>
  <LabPage
    no="05"
    eyebrow="Domain components"
    title="业务组件"
    lead="把 F01—F20 里反复出现的对象做成可复用的展示组件。它们都是受控组件：只接收数据、只发出意图，状态由上层的 store 与服务决定 —— 所以展台里能点的地方，换成真实服务后界面不用重写。"
  >
    <LabSection id="route" title="流程航线" desc="阶段是途经点。走过的是实线，没走的是虚线 —— 和“墨 / 铅笔”是同一套语法。F03 · F07">
      <div class="lab-grid">
        <LabSpecimen name="StageRoute" note="完整版：用于“今日”与“计划”。进入时实线从起点画到当前阶段。">
          <StageRoute :stages="fx.stages" />
        </LabSpecimen>
        <LabSpecimen name="StageRoute · compact" note="紧凑版：常驻顶栏，随时知道自己在哪。">
          <div class="max-w-md"><StageRoute :stages="fx.stages" compact /></div>
        </LabSpecimen>
      </div>
    </LabSection>

    <LabSection
      id="task"
      title="任务与学生确认"
      desc="“待核验”只表示系统看到了产物；完成必须由学生点“确认完成”盖章。证据版本变化后，已确认的任务会提示复核而不是悄悄失效。F07"
    >
      <div class="mb-4 flex items-center gap-3">
        <TpStatus tone="seal" :label="'已确认 ' + confirmedCount + ' / ' + tasks.length" />
        <span class="tp-caption">点第一张卡片的「确认完成」试试。</span>
        <TpButton class="ml-auto" size="sm" variant="ghost" @click="tasks = clone(fx.tasks)"><TpIcon :icon="PhArrowCounterClockwise" />重置</TpButton>
      </div>
      <div class="grid gap-3">
        <TaskCard v-for="task in tasks" :key="task.id" :task="task" @confirm="confirmTask" />
      </div>
    </LabSection>

    <LabSection
      id="revision"
      title="修订候选"
      desc="整套设计语法的主场。候选是铅笔：虚线、手写理由、未生效。逐处接受或拒绝后点「采纳所选」，一笔实线沿边框描过，印章落下 —— 这时正文才改变。F05"
    >
      <div class="mb-4 flex items-center gap-3">
        <span class="tp-caption">左上：可操作的完整流程。其余三张是不可采纳的状态：生成中 / 校验失败 / 已过期。</span>
        <TpButton class="ml-auto" size="sm" variant="ghost" @click="resetCandidates"><TpIcon :icon="PhArrowCounterClockwise" />重置演示</TpButton>
      </div>
      <div class="lab-grid lab-grid--2 items-start">
        <RevisionCard
          :candidate="pending"
          :busy="adopting"
          @decide="decide"
          @adopt="adopt"
          @reject-all="pending.status = 'rejected'"
          @undo="pending = clone(fx.candidatePending)"
          @regenerate="pending = clone(fx.candidatePending)"
        />
        <div class="grid gap-6">
          <RevisionCard :candidate="generating" @cancel="generating.status = 'cancelled'" @regenerate="generating.status = 'generating'" />
          <RevisionCard :candidate="fx.candidateInvalid" />
          <RevisionCard :candidate="fx.candidateExpired" />
        </div>
      </div>
    </LabSection>

    <LabSection id="assistant" title="助手会话" desc="范围条永远写明“这次用了什么”；一次请求拆成多个子任务时，部分失败如实显示；输入草稿按助手保留。F06">
      <div class="lab-grid lab-grid--2 items-start">
        <LabSpecimen
          name="ContextScope · AssistantMessage · AssistantComposer"
          note="项目与正文版本是固定项；章节、选区、资料可移除。发送后的回复为展台演示文本。"
        >
          <div class="grid gap-4">
            <ContextScope :items="scope" @remove="(id) => (scope = scope.filter((s) => s.id !== id))" />
            <AssistantMessage role="user">这一段读起来有点口语，帮我改得学术一点，数字不要动。</AssistantMessage>
            <AssistantMessage role="assistant" agent="content" time="14:31">
              <p>
                我针对选区给了 3 处修改建议，已放进候选区，等你逐条决定。数字 <span class="tp-protect" data-kind="number">71.4%</span> 和引用
                <span class="tp-protect" data-kind="citation">[7]</span> 没有动。
              </p>
            </AssistantMessage>
            <AssistantMessage v-for="(text, i) in sent" :key="i" role="user">{{ text }}</AssistantMessage>
            <AssistantMessage v-if="sent.length" role="assistant" agent="content" time="14:33" streaming>（展台演示）这里会出现助手的流式回复</AssistantMessage>
            <AssistantComposer v-model="draft" @send="(text) => ((sent = [...sent, text]), (draft = ''))" />
          </div>
        </LabSpecimen>
        <LabSpecimen name="RunSteps" note="综合助手把请求拆给专业助手。失败的子任务可以单独重试，其他结果不受影响。">
          <div class="grid gap-4">
            <AssistantMessage role="assistant" agent="general" time="14:35"><p>我把“检查第 3 章并给出修改建议”拆成了 4 件事：</p></AssistantMessage>
            <RunSteps :steps="steps" @retry="(id) => (steps = steps.map((s) => (s.id === id ? { ...s, status: 'running', detail: undefined } : s)))" />
          </div>
        </LabSpecimen>
      </div>
    </LabSection>

    <LabSection
      id="suggestion"
      title="主动建议"
      desc="重要节点才介入。每条建议都写明触发事件、依据和不确定之处；“没观察到编辑”不等于“没在工作”，所以给学生留了补充线下进展的入口。F08"
    >
      <div class="lab-grid lab-grid--2 items-start tp-list-group">
        <TransitionGroup name="tp-list" v-bind="listMotionHooks">
          <SuggestionCard
            v-for="s in suggestions.filter((x) => x.state !== 'dismissed')"
            :key="s.id"
            :suggestion="s"
            @snooze="(id, until) => (suggestions = suggestions.map((x) => (x.id === id ? { ...x, state: 'snoozed', snoozedUntil: until } : x)))"
            @dismiss="(id) => (suggestions = suggestions.map((x) => (x.id === id ? { ...x, state: 'dismissed' } : x)))"
            @supply="toast.push({ tone: 'info', title: '已记录你的线下进展', desc: '同类提醒进入冷却，本周不再重复。' })"
          />
        </TransitionGroup>
      </div>
      <TpButton
        v-if="suggestions.some((s) => s.state !== 'unread' && s.state !== 'read')"
        class="mt-4"
        size="sm"
        variant="ghost"
        @click="suggestions = clone(fx.suggestions)"
        ><TpIcon :icon="PhArrowCounterClockwise" />恢复建议</TpButton
      >
    </LabSection>

    <LabSection
      id="feedback"
      title="导师反馈"
      desc="原话是墨（不改一个字），AI 的拆解是铅笔（学生可以纠正），学生处理后盖章。有歧义的意见用“留白”标出，不编造确定解释。F09"
    >
      <div class="max-w-3xl">
        <FeedbackCard
          :feedback="feedback"
          @handle="(id) => (feedback.items = feedback.items.map((i) => (i.id === id ? { ...i, handled: true } : i)))"
          @correct="toast.push({ tone: 'neutral', title: '打开纠正表单', desc: '正式实现中在抽屉里修改含义、定位与关联任务。' })"
        />
      </div>
    </LabSection>

    <LabSection
      id="library"
      title="资料、模板与要求"
      desc="上传即解析并留版本，没有“核对发布”这一步。识别了多少、没识别什么，都写在行里。硬规则由程序检查，语义要求由 AI 给带依据的判断，判断不了就留白。F10 · F11 · F12"
    >
      <div class="lab-grid lab-grid--2 items-start">
        <LabSpecimen name="MaterialRow" note="等待 / 解析中 / 成功 / 部分识别 / 失败 / 重复上传。" plain>
          <div class="tp-card overflow-hidden"><MaterialRow v-for="m in fx.materials" :key="m.id" :material="m" /></div>
        </LabSpecimen>
        <LabSpecimen name="RequirementRow" note="芯片图标 = 程序检查；星芒图标 = AI 判断。六种结论。" plain>
          <div class="tp-card overflow-hidden"><RequirementRow v-for="r in fx.requirements" :key="r.id" :requirement="r" /></div>
        </LabSpecimen>
      </div>
    </LabSection>

    <LabSection
      id="literature"
      title="文献"
      desc="“取得范围”三段条说明到底拿到了什么。只有题录的文献，助手不会装作读过全文；无法核实的来源不能用于提问或引用。全部为自制样例。F13"
    >
      <div class="lab-grid lab-grid--2">
        <LiteratureCard
          v-for="item in literature"
          :key="item.id"
          :item="item"
          :selected="picked.includes(item.id)"
          @toggle="(id) => (picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])"
          @save="(id) => (literature = literature.map((l) => (l.id === id ? { ...l, saved: true } : l)))"
        />
      </div>
    </LabSection>

    <LabSection
      id="review"
      title="评审报告"
      desc="参考分是模拟量表的结果，不是成绩；评不了的维度留白，不给 0 分。正文更新后，报告会明确标成“基于旧稿”。评审不改正文、不改计划。F14"
    >
      <div class="mb-4 flex items-center gap-3">
        <TpSegmented
          v-model="currentVersion"
          label="当前正文版本"
          :options="[
            { value: '13', label: '正文仍是 v13' },
            { value: '14', label: '正文已更新到 v14' },
          ]"
        />
        <span class="tp-caption">切换看看“旧稿报告”的样子。</span>
      </div>
      <div class="lab-grid lab-grid--2 items-start">
        <ReviewSummary :dims="fx.scoreDims" :doc-version="13" :current-version="Number(currentVersion)" :unchecked="fx.unchecked" />
        <div class="tp-card overflow-hidden"><IssueItem v-for="q in fx.issues" :key="q.id" :issue="q" /></div>
      </div>
    </LabSection>

    <LabSection
      id="plan"
      title="计划调整候选"
      desc="空心虚框是原计划，铅笔条是建议的新位置；红线是硬截止，候选不会偷偷移动它。采纳后铅笔条落墨，保留原计划则铅笔条消失。F07"
    >
      <LabSpecimen>
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <TpStatus v-if="planState === 'candidate'" tone="pencil" label="调整候选 · 正式计划未变" />
          <TpStatus v-else-if="planState === 'adopted'" tone="seal" label="已采纳 · 计划 v4 → v5" />
          <TpStatus v-else tone="neutral" label="已保留原计划" />
          <span class="tp-caption">触发原因：任务「补充对比实验」延期 2 天，影响 3 个后续任务。</span>
          <span class="ml-auto flex gap-2">
            <TpButton v-if="planState === 'candidate'" size="sm" variant="ghost" @click="planState = 'kept'">保留原计划</TpButton>
            <TpButton v-if="planState === 'candidate'" size="sm" variant="seal" @click="planState = 'adopted'"><TpIcon :icon="PhSealCheck" />采纳调整</TpButton>
            <TpButton v-if="planState !== 'candidate'" size="sm" variant="ghost" @click="planState = 'candidate'"
              ><TpIcon :icon="PhArrowCounterClockwise" />重置</TpButton
            >
          </span>
        </div>
        <PlanDiff :bars="fx.planBars" :days="28" :hard-at="26" hard-label="硬截止 12-06" :state="planState" :weeks="['11-10', '11-17', '11-24', '12-01']" />
      </LabSpecimen>
    </LabSection>

    <LabSection
      id="jobs"
      title="后台任务与四库关联"
      desc="任务行写明输入范围与配置快照；取消后迟到的结果被丢弃并留痕。四库任一环失效，下游连线变红虚线并说明原因，不会静默换用。F15—F19"
    >
      <div class="grid gap-6">
        <LabSpecimen name="JobRow" note="执行中 / 完成 / 部分完成 / 已取消 / 失败。" plain>
          <div class="tp-card overflow-hidden">
            <JobRow
              v-for="job in jobs"
              :key="job.id"
              :job="job"
              @cancel="
                (id) => {
                  const j = jobs.find((x) => x.id === id);
                  if (j) {
                    j.status = 'cancelled';
                    j.diagnosis = '已取消；迟到的结果不会恢复任务。';
                  }
                }
              "
              @retry="
                (id) => {
                  const j = jobs.find((x) => x.id === id);
                  if (j) {
                    j.status = 'queued';
                    j.attempt += 1;
                    j.diagnosis = undefined;
                  }
                }
              "
            />
          </div>
        </LabSpecimen>
        <LabSpecimen name="ConfigChain" note="接口 → 模型 → 提示词 → 智能体。运行记录固定到具体版本。">
          <div class="mb-4">
            <TpSegmented
              v-model="chain"
              label="关联状态"
              :options="[
                { value: 'ok', label: '关联正常' },
                { value: 'broken', label: '接口被停用' },
              ]"
            />
          </div>
          <ConfigChain :nodes="chain === 'ok' ? fx.chainOk : fx.chainBroken" />
        </LabSpecimen>
      </div>
    </LabSection>

    <LabSection id="versions" title="版本时间线" desc="保存、采纳、恢复、导入是四种不同的成因。恢复不会删历史：点「恢复」会长出一个新版本。F05 · F20">
      <div class="max-w-3xl">
        <LabSpecimen><VersionTimeline :versions="versions" @restore="restore" /></LabSpecimen>
      </div>
    </LabSection>

    <LabSection
      id="editor"
      title="编辑器样张"
      desc="真实的 Tiptap 3.33.1（StarterKit + TableKit）：可以输入、选择、设标题与列表、插入表格、撤销重做。数字与引用的保护下划线在这里是视觉示意；真正的保护校验在方案确认后的编辑器适配层实现。F04"
    >
      <EditorSpecimen />
    </LabSection>
  </LabPage>
</template>
