<script setup lang="ts">
import { PhArrowsClockwise, PhLightning, PhLightningSlash, PhPlay, PhPlus, PhSealCheck, PhShuffle, PhTrash } from "@phosphor-icons/vue";
import { computed, ref } from "vue";
import StageRoute from "@/components/domain/StageRoute.vue";
import ThemeScope from "@/components/ui/ThemeScope.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpCountUp from "@/components/ui/TpCountUp.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpPencilFrame from "@/components/ui/TpPencilFrame.vue";
import TpScribble from "@/components/ui/TpScribble.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { useThemeScope } from "@/design/theme";
import { durations, springToLinear, themeList } from "@/design/tokens";
import type { StageView } from "@/domain/types";
import { useAppearanceStore } from "@/stores/appearance";
import { useToastStore } from "@/stores/toast";
import EaseCurve from "../EaseCurve.vue";
import * as fx from "../fixtures";
import LabPage from "../LabPage.vue";
import LabSection from "../LabSection.vue";
import LabSpecimen from "../LabSpecimen.vue";

const scope = useThemeScope();
const appearance = useAppearanceStore();
const toast = useToastStore();
const t = computed(() => scope.def.value);
const spring = computed(() => springToLinear(t.value.spring));
const ms = (base: number) => Math.round(base * t.value.durScale);

const principles = [
  { n: "01", t: "动效是状态的旁白", d: "每段动效都在回答“刚才发生了什么”：候选变成了正文、任务被确认、报告过期了。说不出它在解释什么，就删掉。" },
  { n: "02", t: "签名动效只给决定", d: "落墨与钤印只在学生作出决定时出现，所以它们有分量。普通操作用最短的标准过渡。" },
  { n: "03", t: "进场从容，离场干脆", d: "进入用减速曲线，离开用加速曲线并缩短到约七成时长 —— 新内容被看见，旧内容不挡路。" },
  { n: "04", t: "一次只有一个主角", d: "同一时刻只让一个元素做大幅运动；列表交错不超过八项，其余同时到位。" },
  { n: "05", t: "可以全部关掉", d: "减弱动效时，位移与弹跳变成百毫秒内的淡入淡出，环境动画停止，信息一条不少。" },
];

/* —— 时长赛跑 —— */
const race = ref(false);
/* —— 曲线重播 —— */
const play = ref(0);
/* —— 四种性格 —— */
const persona = ref(0);

/* —— 签名动效 —— */
const inked = ref(false);
const stamp = ref(0);
const erased = ref(false);
const stale = ref(false);
const flash = ref(0);
const mark = ref(0);
const stageAt = ref(2);
const routeStages = computed<StageView[]>(() =>
  fx.stages.map((s, i) => ({ ...s, state: i < stageAt.value ? "done" : i === stageAt.value ? "current" : "upcoming" })),
);

/* —— 通用编排 —— */
let seq = 5;
const list = ref([1, 2, 3, 4]);
const shuffle = () => (list.value = [...list.value].sort(() => Math.random() - 0.5));
const panel = ref(0);
const open = ref(true);
const shake = ref(0);
const count = ref(8460);
</script>

<template>
  <LabPage
    no="06"
    eyebrow="Motion"
    title="动效系统"
    lead="动效和颜色一样由令牌驱动：六档时长、四条曲线、四个“性格”参数。同一个进入动画，在朱墨里是干脆的一推，在荧光笔记里是带回弹的一蹦。本页所有演示都可以重播；右下角的闪电可以一键切到减弱动效。"
  >
    <LabSection id="principles" title="五条原则">
      <div class="lab-grid lab-grid--3">
        <div v-for="p in principles" :key="p.n" class="tp-card p-5">
          <p class="tp-num text-[1.75rem] leading-none text-brand">{{ p.n }}</p>
          <p class="tp-subheading mt-3">{{ p.t }}</p>
          <p class="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">{{ p.d }}</p>
        </div>
        <div class="tp-ghost grid place-items-center p-5 text-center">
          <div>
            <p class="font-semibold text-fg">不做的事</p>
            <p class="mt-1 text-[0.8125rem]">循环闪烁的提醒、阻塞操作的长动画、<br />只为好看而没有对应状态变化的装饰。</p>
          </div>
        </div>
      </div>
    </LabSection>

    <LabSection id="duration" title="时长阶梯" desc="六档基准时长，每套方案用一个系数整体缩放：夜航更利落，晨雾更舒缓。">
      <div class="tp-card p-5">
        <div class="mb-4 flex items-center gap-3">
          <TpButton variant="primary" size="sm" @click="race = !race"><TpIcon :icon="PhPlay" weight="fill" />{{ race ? "跑回去" : "一起出发" }}</TpButton>
          <span class="tp-caption">当前方案「{{ t.name }}」的时长系数 ×{{ t.durScale }}。六个圆点用各自的时长跑完同一段距离。</span>
        </div>
        <div class="grid gap-2.5">
          <div v-for="d in durations" :key="d.id" class="lab-race">
            <span class="font-semibold">{{ d.id }}</span>
            <span class="tp-mono text-fg-muted">{{ ms(d.ms) }}ms</span>
            <span class="lab-race__track"><i :class="{ 'is-end': race }" :style="{ transitionDuration: ms(d.ms) + 'ms' }" /></span>
            <span class="tp-caption">{{ d.use }}</span>
          </div>
        </div>
      </div>
    </LabSection>

    <LabSection id="easing" title="四条曲线" desc="曲线来自当前方案的令牌；弹簧曲线由脚本求解阻尼弹簧方程后采样成 CSS linear()，不依赖任何动画库。">
      <div class="mb-4">
        <TpButton size="sm" variant="outline" @click="play++"><TpIcon :icon="PhArrowsClockwise" />重播曲线</TpButton>
      </div>
      <div class="lab-grid lab-grid--4">
        <EaseCurve name="standard 标准" note="状态内变化：颜色、尺寸、位置" :easing="t.vars['ease-standard']" :duration="ms(520)" :play="play" />
        <EaseCurve name="enter 进入" note="元素进入画面，先快后慢" :easing="t.vars['ease-enter']" :duration="ms(520)" :play="play" />
        <EaseCurve name="exit 离开" note="元素离开画面，先慢后快" :easing="t.vars['ease-exit']" :duration="ms(360)" :play="play" />
        <EaseCurve
          name="spring 弹簧"
          :note="'滑块、浮层、印章 · 阻尼比 ζ=' + spring.zeta"
          :easing="spring.easing"
          :duration="Math.round(spring.ms * t.durScale)"
          :play="play"
        />
      </div>
    </LabSection>

    <LabSection id="persona" title="同一个动作，四种性格" desc="四个盒子里是同一段代码：卡片进入、按钮按压、印章落下。差别全部来自令牌。">
      <div class="mb-4">
        <TpButton size="sm" variant="primary" @click="persona++"><TpIcon :icon="PhArrowsClockwise" />四个一起重播</TpButton>
      </div>
      <div class="lab-grid lab-grid--4">
        <ThemeScope v-for="th in themeList" :key="th.id" :theme="th.id" canvas class="lab-persona">
          <p class="tp-label">{{ th.name }} · {{ th.motionCharacter.split(" —— ")[0] }}</p>
          <div :key="persona" class="mt-3 grid gap-3">
            <div class="tp-card tp-enter p-3" style="--delay: 100ms">
              <p class="tp-subheading !text-[0.875rem]">第 3 章初稿</p>
              <p class="tp-caption">待核验 · 11-14</p>
            </div>
            <div class="tp-enter flex items-center justify-between" style="--delay: 260ms">
              <TpButton variant="primary" size="sm">按我试试</TpButton>
              <TpSeal text="已确认" :stamp="persona" style="animation-delay: 700ms" />
            </div>
          </div>
          <p class="tp-caption mt-3 !text-[0.6875rem]">ζ={{ springToLinear(th.spring).zeta }} · ×{{ th.durScale }} · {{ th.vars["enter-transform"] }}</p>
        </ThemeScope>
      </div>
    </LabSection>

    <LabSection id="signature" title="签名动效" desc="只属于这个产品的八段动效，每一段都对应一种业务状态变化。">
      <div class="lab-grid lab-grid--2">
        <LabSpecimen name="落墨 · 采纳" note="一笔实线沿边框描过，底色由铅笔浅底变为纸面，新增文字变成正文色。deliberate / standard。">
          <TpPencilFrame :state="inked ? 'inked' : 'pencil'">
            <div class="flex items-center gap-3 p-4">
              <p class="flex-1 font-prose">较基线方法有<ins class="tp-cand-ins" :class="{ 'is-inked': inked }">明显提升</ins>。</p>
              <TpButton v-if="!inked" variant="seal" size="sm" @click="((inked = true), stamp++)"><TpIcon :icon="PhSealCheck" />采纳</TpButton>
              <template v-else>
                <TpSeal text="已采纳" :stamp="stamp" />
                <TpButton variant="ghost" size="sm" @click="inked = false">复位</TpButton>
              </template>
            </div>
          </TpPencilFrame>
        </LabSpecimen>
        <LabSpecimen name="钤印 · 确认" note="印章从大到小落下，轻微回弹，外圈扩散一道印泥。只用于学生的决定。">
          <div class="flex items-center gap-5">
            <TpSeal text="已确认" size="lg" :stamp="stamp" />
            <TpSeal text="已处理" :stamp="stamp" />
            <TpSeal text="已采纳" solid :stamp="stamp" />
            <TpButton class="ml-auto" size="sm" variant="outline" @click="stamp++"><TpIcon :icon="PhArrowsClockwise" />再盖一次</TpButton>
          </div>
        </LabSpecimen>
        <LabSpecimen name="起草 · 生成中" note="虚线边框缓慢流动 + 铅笔涂写。它在说“AI 在写草稿”，而不是“系统卡住了”。">
          <TpPencilFrame state="generating">
            <div class="flex items-center gap-3 p-4 text-pencil-content"><TpScribble :size="20" /><span class="tp-hand">正在起草，正文不会被改动…</span></div>
          </TpPencilFrame>
        </LabSpecimen>
        <LabSpecimen name="擦除 · 拒绝 / 取消" note="铅笔线褪成留白色，底色消失；不闪红、不抖动 —— 拒绝是正常选择，不是错误。">
          <TpPencilFrame :state="erased ? 'erased' : 'pencil'">
            <div class="flex items-center gap-3 p-4">
              <p class="flex-1 font-prose transition-opacity duration-300" :class="{ 'opacity-50': erased }">
                较基线方法有<del v-if="!erased" class="tp-cand-del">很大</del><ins v-if="!erased" class="tp-cand-ins">明显</ins><span v-else>很大</span>提升。
              </p>
              <TpButton variant="ghost" size="sm" @click="erased = !erased">{{ erased ? "复位" : "拒绝" }}</TpButton>
            </div>
          </TpPencilFrame>
        </LabSpecimen>
        <LabSpecimen name="褪色 · 过期" note="对象失去饱和度，右上角折角。它还在，但已经不能直接使用。">
          <div class="flex items-center gap-3 p-4 transition-all duration-500" :class="stale ? 'tp-stale' : 'tp-pencil'">
            <span class="tp-avatar tp-avatar--sm" data-agent="content">文</span>
            <span class="flex-1 font-medium">候选 C-198 · 基于正文 v11</span>
            <TpStatus :tone="stale ? 'stale' : 'pencil'" :label="stale ? '已过期' : '待审阅'" size="sm" />
            <TpButton variant="ghost" size="sm" class="!relative z-10" @click="stale = !stale">{{ stale ? "复位" : "正文更新了" }}</TpButton>
          </div>
        </LabSpecimen>
        <LabSpecimen name="航线推进 · 阶段完成" note="实线向下一个途经点延伸，当前点的涟漪随之移动。">
          <StageRoute :stages="routeStages" compact />
          <div class="mt-3 flex gap-2">
            <TpButton size="sm" variant="outline" :disabled="stageAt >= 5" @click="stageAt++">完成当前阶段</TpButton>
            <TpButton size="sm" variant="ghost" @click="stageAt = 2">复位</TpButton>
          </div>
        </LabSpecimen>
        <LabSpecimen name="定位闪烁" note="从评审问题、来源定位跳到正文时，目标片段亮一下再褪去。">
          <p class="font-prose leading-loose">
            正文中引用的参考文献应在文末列出，<span :key="flash" :class="{ 'tp-flash': flash > 0 }">近五年文献占比不宜低于三分之一</span>。
          </p>
          <TpButton class="mt-2" size="sm" variant="outline" @click="flash++">定位到这里</TpButton>
        </LabSpecimen>
        <LabSpecimen name="荧光笔" note="页面里最要紧的一句话，被荧光笔从左到右划过。一页最多一次。">
          <p class="text-[1.0625rem]">今天只有一件要紧事：<span :key="mark" class="tp-mark font-semibold" style="--delay: 100ms">确认第 3 章初稿</span>。</p>
          <TpButton class="mt-2" size="sm" variant="outline" @click="mark++"><TpIcon :icon="PhArrowsClockwise" />再划一次</TpButton>
        </LabSpecimen>
      </div>
    </LabSection>

    <LabSection
      id="patterns"
      title="通用编排"
      desc="列表、页面、浮层、反馈的标准过渡。对应 motion.css 里的 Vue Transition 命名：tp-page / tp-pop / tp-swap / tp-list / tp-modal / tp-drawer / tp-toast。"
    >
      <div class="lab-grid lab-grid--3">
        <LabSpecimen name="tp-list 列表" note="进入、离开、重排（FLIP）。">
          <div class="mb-3 flex gap-1.5">
            <TpButton size="sm" variant="tonal" icon-only label="添加一项" @click="list.splice(1, 0, seq++)"><TpIcon :icon="PhPlus" /></TpButton>
            <TpButton size="sm" variant="tonal" icon-only label="移除一项" :disabled="list.length < 2" @click="list.splice(1, 1)"
              ><TpIcon :icon="PhTrash"
            /></TpButton>
            <TpButton size="sm" variant="tonal" icon-only label="打乱顺序" @click="shuffle"><TpIcon :icon="PhShuffle" /></TpButton>
          </div>
          <TransitionGroup tag="div" name="tp-list" class="relative grid gap-1.5">
            <div v-for="item in list" :key="item" class="tp-card tp-card--flat px-3 py-1.5 text-[0.8125rem] font-medium">任务 {{ item }}</div>
          </TransitionGroup>
        </LabSpecimen>
        <LabSpecimen name="tp-page 页面" note="舞台内容切换：旧页上移淡出，新页按方案的进入方式出现。">
          <TpButton size="sm" variant="tonal" class="mb-3" @click="panel = (panel + 1) % 3">切到下一页</TpButton>
          <div class="h-24 overflow-hidden">
            <Transition name="tp-page" mode="out-in">
              <div :key="panel" class="tp-card tp-card--sunken h-24 p-3">
                <p class="tp-title !text-[1.25rem]">{{ ["写作", "计划", "资料"][panel] }}</p>
                <p class="tp-caption">{{ ["稿纸与候选", "任务与航线", "模板、规范、文献"][panel] }}</p>
              </div>
            </Transition>
          </div>
        </LabSpecimen>
        <LabSpecimen name="tp-collapse 折叠" note="用 grid 行高做高度动画，不测量 DOM。">
          <TpButton size="sm" variant="tonal" class="mb-3" @click="open = !open">{{ open ? "收起依据" : "展开依据" }}</TpButton>
          <div class="tp-collapse" :class="{ 'is-open': open }">
            <div>
              <p class="tp-card tp-card--sunken p-3 text-[0.8125rem] text-fg-muted">
                撰写规范 §2.3：结论应有数据或文献支撑。<br />你在本次会话中的要求：“不要改数字”。
              </p>
            </div>
          </div>
        </LabSpecimen>
        <LabSpecimen name="tp-shake 校验失败" note="只抖一次，随后保持错误态；不循环。">
          <p :key="shake" class="tp-field__error" :class="{ 'tp-shake': shake > 0 }">候选改动了受保护的数字 71.4%</p>
          <TpButton class="mt-3" size="sm" variant="tonal" @click="shake++">再触发一次</TpButton>
        </LabSpecimen>
        <LabSpecimen name="TpCountUp 数字跳表" note="数值变化时滚动到新值；首屏从 0 进入。">
          <p class="tp-num text-[2.5rem] leading-none"><TpCountUp :value="count" /></p>
          <div class="mt-3 flex gap-1.5">
            <TpButton size="sm" variant="tonal" @click="count += 287">写了 287 字</TpButton>
            <TpButton size="sm" variant="ghost" @click="count = 8460">复位</TpButton>
          </div>
        </LabSpecimen>
        <LabSpecimen name="tp-toast 轻提示" note="自下弹入、向右滑出；多条时其余让位（FLIP）。">
          <div class="flex flex-wrap gap-1.5">
            <TpButton size="sm" variant="tonal" @click="toast.push({ tone: 'seal', title: '已确认完成', desc: '派生进度已更新。' })">成功</TpButton>
            <TpButton
              size="sm"
              variant="tonal"
              @click="toast.push({ tone: 'danger', title: '保存失败', desc: '文稿仍在本页。', action: { label: '重试', run: () => {} } })"
              >失败</TpButton
            >
          </div>
          <p class="tp-caption mt-3">对话框、抽屉、指令面板的进出场见「基础组件 → 反馈与浮层」。</p>
        </LabSpecimen>
      </div>
    </LabSection>

    <LabSection id="reduced" title="减弱动效" desc="跟随系统的“减少动态效果”偏好，也可以在偏好设置里手动切换。减弱不是关掉反馈，而是换成不位移的反馈。">
      <div class="lab-grid lab-grid--2 items-start">
        <div class="tp-card p-5">
          <p class="flex items-center gap-3">
            <TpStatus
              :tone="appearance.motion === 'full' ? 'success' : 'neutral'"
              :label="appearance.motion === 'full' ? '当前：完整动效' : '当前：减弱动效'"
            />
            <TpButton size="sm" variant="primary" @click="appearance.toggleMotion()"
              ><TpIcon :icon="appearance.motion === 'full' ? PhLightningSlash : PhLightning" />{{
                appearance.motion === "full" ? "切到减弱" : "切回完整"
              }}</TpButton
            >
          </p>
          <p class="mt-3 text-fg-muted">
            切换后回到上面任何一个演示再点一次：位移、缩放、弹跳都变成了不超过 120ms
            的淡入淡出；流动光斑、扫描光束、荧光笔划过停止；涟漪与进度条保留，因为它们承载“正在进行”的信息。
          </p>
        </div>
        <div class="tp-card overflow-hidden">
          <table class="tp-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>完整</th>
                <th>减弱</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="font-semibold">进入 / 离开</td>
                <td>位移 + 淡入，按方案性格</td>
                <td>≤ 100ms 淡入淡出</td>
              </tr>
              <tr>
                <td class="font-semibold">弹簧（滑块、浮层）</td>
                <td>方案弹簧曲线</td>
                <td>100ms 线性</td>
              </tr>
              <tr>
                <td class="font-semibold">落墨 / 钤印</td>
                <td>描边 + 盖章</td>
                <td>直接切到终态，保留印章</td>
              </tr>
              <tr>
                <td class="font-semibold">环境动画</td>
                <td>光斑漂移、扫描光束</td>
                <td>停止</td>
              </tr>
              <tr>
                <td class="font-semibold">进行中指示</td>
                <td>涟漪、流动虚线、进度条</td>
                <td>保留</td>
              </tr>
              <tr>
                <td class="font-semibold">主题切换</td>
                <td>圆形揭示</td>
                <td>直接切换</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </LabSection>
  </LabPage>
</template>
