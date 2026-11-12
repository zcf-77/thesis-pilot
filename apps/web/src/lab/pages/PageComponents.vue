<script setup lang="ts">
import { listMotionHooks } from "@/design/motion";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import {
  PhArchive,
  PhArrowRight,
  PhBell,
  PhCheck,
  PhCopy,
  PhDotsThree,
  PhDownloadSimple,
  PhGearSix,
  PhMagnifyingGlass,
  PhPencilSimpleLine,
  PhPlus,
  PhSealCheck,
  PhTrash,
} from "@phosphor-icons/vue";
import { computed, reactive, ref } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpChip from "@/components/ui/TpChip.vue";
import TpCommandPalette from "@/components/ui/TpCommandPalette.vue";
import TpCountUp from "@/components/ui/TpCountUp.vue";
import TpDialog from "@/components/ui/TpDialog.vue";
import TpDrawer from "@/components/ui/TpDrawer.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpMenu from "@/components/ui/TpMenu.vue";
import TpProgress from "@/components/ui/TpProgress.vue";
import TpRing from "@/components/ui/TpRing.vue";
import TpSaveIndicator from "@/components/ui/TpSaveIndicator.vue";
import TpScribble from "@/components/ui/TpScribble.vue";
import TpSegmented from "@/components/ui/TpSegmented.vue";
import TpState from "@/components/ui/TpState.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpTabs from "@/components/ui/TpTabs.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import type { Tone } from "@/design/tone";
import { useToastStore } from "@/stores/toast";
import LabPage from "../LabPage.vue";
import LabSection from "../LabSection.vue";
import LabSpecimen from "../LabSpecimen.vue";

const toast = useToastStore();

/* —— 按钮 —— */
const loading = ref(false);
function fakeLoad() {
  loading.value = true;
  setTimeout(() => (loading.value = false), 1600);
}

/* —— 表单：新建论文项目（真实校验） —— */
const form = reactive({ title: "", deadline: "", flow: "flow-v3", plan: "", notify: true });
const touched = reactive({ title: false, deadline: false });
const today = "2026-11-11";
const errors = computed(() => ({
  title: !form.title.trim() ? "请填写论文题目" : form.title.trim().length < 6 ? "题目至少 6 个字，便于后续检索与区分" : "",
  deadline: !form.deadline ? "请选择论文提交截止日期" : form.deadline <= today ? "截止日期需要晚于今天（" + today + "）" : "",
}));
const submitted = ref(false);
function submit() {
  touched.title = touched.deadline = true;
  if (errors.value.title || errors.value.deadline) return;
  submitted.value = true;
  toast.push({ tone: "success", title: "表单校验通过", desc: "展台不创建真实项目；这里只演示校验与反馈。" });
}

/* —— 选择 —— */
const mode = ref<"general" | "expert">("general");
const tab = ref<"all" | "pending" | "adopted" | "expired">("pending");
const chips = ref(["第 3 章 系统设计", "选区 · 128 字", "资料 · 2 篇"]);

/* —— 状态 —— */
const tones: { tone: Tone; label: string; live?: boolean; meaning: string }[] = [
  { tone: "neutral", label: "待开始", meaning: "尚未发生，不带评价" },
  { tone: "info", label: "进行中", live: true, meaning: "正在发生的客观过程" },
  { tone: "success", label: "解析成功", meaning: "系统过程顺利完成" },
  { tone: "warning", label: "待核验", meaning: "需要学生看一眼" },
  { tone: "danger", label: "校验失败", meaning: "被程序拦下，未生效" },
  { tone: "pencil", label: "待审阅", meaning: "AI 提议，采纳前不生效" },
  { tone: "seal", label: "学生已确认", meaning: "学生本人作出的决定" },
  { tone: "ghost", label: "不能判定", meaning: "未知 / 未检查，明确留空" },
  { tone: "stale", label: "已过期", meaning: "基于旧版本，不再适用" },
];

/* —— 反馈 —— */
const dialogOpen = ref(false);
const drawerOpen = ref(false);
const cmdOpen = ref(false);
const progress = ref(36);
const skeleton = ref(true);
const save = ref<"saved" | "saving" | "dirty" | "failed">("saved");
function cycleSave() {
  const order = ["saved", "dirty", "saving", "failed"] as const;
  save.value = order[(order.indexOf(save.value) + 1) % order.length];
}
</script>

<template>
  <LabPage
    no="04"
    eyebrow="Components"
    title="基础组件"
    lead="与业务无关的通用零件。它们只消费语义令牌，所以切换下方的方案坞，整页会一起换装 —— 结构、尺寸与交互保持不变。"
  >
    <LabSection
      id="buttons"
      title="按钮与强调阶梯"
      desc="一个区域内最多一个最高级按钮。印章色只给“会改变正式论文或正式计划”的决定；铅笔样式只给“发起 AI 请求”。"
    >
      <div class="lab-grid lab-grid--2">
        <LabSpecimen name="强调阶梯" note="从左到右，分量递减。">
          <div class="flex flex-wrap items-center gap-3">
            <TpButton variant="seal"><TpIcon :icon="PhSealCheck" />采纳修改</TpButton>
            <TpButton variant="primary">保存并继续<TpIcon :icon="PhArrowRight" /></TpButton>
            <TpButton variant="pencil"><TpIcon :icon="PhPencilSimpleLine" />让 AI 起草</TpButton>
            <TpButton variant="tonal">稍后处理</TpButton>
            <TpButton variant="outline">查看依据</TpButton>
            <TpButton variant="ghost">取消</TpButton>
            <TpButton variant="danger"><TpIcon :icon="PhTrash" />移除资料</TpButton>
          </div>
        </LabSpecimen>
        <LabSpecimen name="尺寸与状态" note="加载中保持宽度不跳动；禁用降低不透明度并禁用指针。">
          <div class="flex flex-wrap items-center gap-3">
            <TpButton variant="primary" size="lg">开始写作</TpButton>
            <TpButton variant="primary">默认</TpButton>
            <TpButton variant="primary" size="sm">紧凑</TpButton>
            <TpButton variant="primary" :loading="loading" @click="fakeLoad">点我加载</TpButton>
            <TpButton variant="outline" disabled>不可用</TpButton>
            <TpButton variant="outline" icon-only label="新建"><TpIcon :icon="PhPlus" /></TpButton>
            <TpButton variant="ghost" icon-only label="通知" class="tp-tip" data-tip="通知 · 3 条未读"><TpIcon :icon="PhBell" /></TpButton>
          </div>
        </LabSpecimen>
      </div>
    </LabSection>

    <LabSection
      id="forms"
      title="表单与校验"
      desc="失焦后校验、错误就地说明“怎么改”；选填项明说可以稍后填写。开关 / 复选 / 单选 / 滑杆直接使用 daisyUI 基元，颜色来自同一套令牌。"
    >
      <div class="lab-grid lab-grid--2">
        <LabSpecimen name="新建论文项目" note="真实校验：题目不少于 6 个字；截止日期晚于今天。提交空表单试试。">
          <form class="grid gap-4" novalidate @submit.prevent="submit">
            <TpField
              v-slot="{ id, invalid, describedby }"
              label="论文题目"
              required
              :error="touched.title ? errors.title : ''"
              hint="可随时修改，不影响已有版本"
            >
              <input
                :id="id"
                v-model="form.title"
                class="tp-input"
                placeholder="例如：校园二手交易平台的推荐算法设计与实现"
                :aria-invalid="invalid"
                :aria-describedby="describedby"
                @blur="touched.title = true"
              />
            </TpField>
            <div class="grid grid-cols-2 gap-4">
              <TpField v-slot="{ id, invalid, describedby }" label="论文提交截止" required :error="touched.deadline ? errors.deadline : ''">
                <TpDatePicker
                  :id="id"
                  v-model="form.deadline"
                  type="date"
                  :aria-invalid="invalid"
                  :aria-describedby="describedby"
                  @blur="touched.deadline = true"
                />
              </TpField>
              <TpField v-slot="{ id }" label="流程版本" hint="项目绑定具体版本">
                <TpSelect
                  :id="id"
                  v-model="form.flow"
                  :options="[
                    { value: 'flow-v3', label: '示例流程 · v3（当前）' },
                    { value: 'flow-v2', label: '示例流程 · v2' },
                    { value: 'flow-v1', label: '示例流程 · v1（已停用）', disabled: true },
                  ]"
                />
              </TpField>
            </div>
            <TpField v-slot="{ id }" label="个人规划" optional hint="不填也能开始：系统只按已知截止时间提醒，不推测你的效率">
              <textarea :id="id" v-model="form.plan" class="tp-input" placeholder="例如：每周二、四晚上各写 2 小时；十二月前完成第三章" />
            </TpField>
            <div class="flex items-center justify-between gap-3">
              <label class="flex items-center gap-2.5 text-[0.8125rem]">
                <input v-model="form.notify" type="checkbox" class="toggle toggle-primary toggle-sm" />接受主动建议
              </label>
              <TpButton variant="primary" type="submit">创建项目</TpButton>
            </div>
          </form>
        </LabSpecimen>
        <div class="grid gap-6">
          <LabSpecimen name="控件状态" note="默认 / 悬停 / 聚焦 / 错误 / 禁用。">
            <div class="grid grid-cols-2 gap-3">
              <input class="tp-input" placeholder="默认" aria-label="默认输入框" />
              <input class="tp-input" value="已填写内容" aria-label="已填写输入框" />
              <input class="tp-input" value="格式不正确" aria-invalid="true" aria-label="错误输入框" />
              <input class="tp-input" value="不可编辑" disabled aria-label="禁用输入框" />
            </div>
          </LabSpecimen>
          <LabSpecimen name="daisyUI 基元" note="行为与无障碍由 daisyUI 提供，外观由令牌驱动。">
            <div class="flex flex-wrap items-center gap-x-6 gap-y-4 text-[0.8125rem]">
              <label class="flex items-center gap-2"><input type="checkbox" class="checkbox checkbox-primary checkbox-sm" checked />数字保护</label>
              <label class="flex items-center gap-2"><input type="checkbox" class="checkbox checkbox-primary checkbox-sm" />公式保护</label>
              <label class="flex items-center gap-2"><input type="radio" name="scope" class="radio radio-primary radio-sm" checked />整篇</label>
              <label class="flex items-center gap-2"><input type="radio" name="scope" class="radio radio-primary radio-sm" />指定章节</label>
              <label class="flex items-center gap-2"><input type="checkbox" class="toggle toggle-primary toggle-sm" checked />静默时段</label>
              <label class="flex min-w-48 flex-1 items-center gap-3"
                >冷却<input type="range" min="0" max="100" value="40" class="range range-primary range-xs" aria-label="提醒冷却时长"
              /></label>
            </div>
          </LabSpecimen>
        </div>
      </div>
    </LabSection>

    <LabSection id="selection" title="选择、导航与标记" desc="滑块与下划线用弹簧曲线跟随选中项；标签表达上下文范围；版本标记表达“这是哪一版、基于哪一版”。">
      <div class="lab-grid lab-grid--2">
        <LabSpecimen name="分段选择 TpSegmented" note="互斥切换（方向键可操作）。">
          <div class="flex flex-wrap items-center gap-4">
            <TpSegmented
              v-model="mode"
              label="AI 模式"
              :options="[
                { value: 'general', label: '综合助手' },
                { value: 'expert', label: '专业助手' },
              ]"
            />
            <span class="tp-caption">当前：{{ mode === "general" ? "由综合助手协调专业任务" : "多个专业助手各自对话" }}</span>
          </div>
        </LabSpecimen>
        <LabSpecimen name="标签页 TpTabs" note="带计数；指示器滑动。">
          <TpTabs
            v-model="tab"
            label="候选筛选"
            :tabs="[
              { value: 'all', label: '全部', count: 14 },
              { value: 'pending', label: '待审阅', count: 3 },
              { value: 'adopted', label: '已采纳', count: 9 },
              { value: 'expired', label: '已过期', count: 2 },
            ]"
          />
        </LabSpecimen>
        <LabSpecimen name="上下文标签 TpChip" note="可移除；移除后助手不再使用该范围。">
          <div class="flex flex-wrap items-center gap-2">
            <TransitionGroup name="tp-list" tag="div" class="tp-list-group flex flex-wrap gap-2" v-bind="listMotionHooks">
              <TpChip v-for="c in chips" :key="c" removable :remove-label="'移除 ' + c" @remove="chips = chips.filter((x) => x !== c)">{{ c }}</TpChip>
            </TransitionGroup>
            <TpChip active>项目 · 推荐算法毕设</TpChip>
            <Transition name="tp-swap">
              <TpButton v-if="chips.length < 3" size="sm" variant="ghost" @click="chips = ['第 3 章 系统设计', '选区 · 128 字', '资料 · 2 篇']">恢复</TpButton>
            </Transition>
          </div>
        </LabSpecimen>
        <LabSpecimen name="版本标记 / 键帽 / 菜单" note="版本号用等宽字体；过期基线加删除线。">
          <div class="flex flex-wrap items-center gap-3">
            <TpVersion :v="12" prefix="正文 " />
            <TpVersion :v="13" :base="12" />
            <TpVersion :v="9" :base="7" stale />
            <span class="inline-flex items-center gap-1"><kbd class="tp-kbd">⌘</kbd><kbd class="tp-kbd">K</kbd></span>
            <TpMenu>
              <template #trigger="{ toggle, open }">
                <TpButton variant="outline" size="sm" :aria-expanded="open" @click="toggle"><TpIcon :icon="PhDotsThree" weight="bold" />更多</TpButton>
              </template>
              <button class="tp-menu__item" role="menuitem"><TpIcon :icon="PhCopy" />复制为新版本<span class="tp-kbd tp-menu__kbd">D</span></button>
              <button class="tp-menu__item" role="menuitem"><TpIcon :icon="PhDownloadSimple" />导出 JSON</button>
              <button class="tp-menu__item" role="menuitem"><TpIcon :icon="PhArchive" />归档项目</button>
              <div class="tp-menu__sep" />
              <button class="tp-menu__item tp-menu__item--danger" role="menuitem"><TpIcon :icon="PhTrash" />解除关联</button>
            </TpMenu>
          </div>
        </LabSpecimen>
      </div>
    </LabSection>

    <LabSection
      id="status"
      title="状态胶囊：九种语气"
      desc="颜色只表达语气，文字才是状态。“铅笔 / 印章 / 留白 / 旧稿”四种是本产品特有的语气，对应设计语法里的四种材质。"
    >
      <LabSpecimen>
        <div class="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="t in tones" :key="t.tone" class="flex items-center gap-3">
            <span class="w-28 shrink-0"><TpStatus :tone="t.tone" :label="t.label" :live="t.live" /></span>
            <span class="tp-caption"><span class="tp-mono mr-1.5 text-fg-faint">{{ t.tone }}</span>{{ t.meaning }}</span>
          </div>
        </div>
      </LabSpecimen>
    </LabSection>

    <LabSection id="feedback" title="反馈与浮层" desc="越重要的反馈层级越高：就地变化 → 轻提示 → 抽屉 → 对话框。对话框只留给需要中断的决定。">
      <div class="lab-grid lab-grid--3">
        <LabSpecimen name="轻提示 Toast" note="成功 4 秒后消失，悬停暂停；失败不自动消失并带下一步。">
          <div class="flex flex-wrap gap-2">
            <TpButton
              size="sm"
              @click="
                toast.push({
                  tone: 'seal',
                  title: '已采纳 2 处修改',
                  desc: '正文 v12 → v13，可在版本历史中撤销。',
                  action: { label: '撤销', run: () => toast.push({ tone: 'neutral', title: '已撤销，正文回到 v12' }) },
                })
              "
              >采纳</TpButton
            >
            <TpButton size="sm" @click="toast.push({ tone: 'pencil', title: '候选已生成', desc: '3 处建议等待你审阅，正文未改动。' })">候选</TpButton>
            <TpButton size="sm" @click="toast.push({ tone: 'warning', title: '基础版本已变化', desc: '该候选基于 v11，当前为 v13，需要重新审阅。' })"
              >过期</TpButton
            >
            <TpButton
              size="sm"
              @click="
                toast.push({
                  tone: 'danger',
                  title: '导出失败',
                  desc: '模拟：转换服务超时。原数据未受影响。',
                  action: { label: '重试', run: () => toast.push({ tone: 'info', title: '已重新排队' }) },
                })
              "
              >失败</TpButton
            >
          </div>
        </LabSpecimen>
        <LabSpecimen name="对话框 / 抽屉 / 指令面板" note="Esc 关闭，焦点回到触发按钮；对话框内 Tab 循环。">
          <div class="flex flex-wrap gap-2">
            <TpButton size="sm" @click="dialogOpen = true">对话框</TpButton>
            <TpButton size="sm" @click="drawerOpen = true">抽屉</TpButton>
            <TpButton size="sm" @click="cmdOpen = true"><TpIcon :icon="PhMagnifyingGlass" />指令面板</TpButton>
          </div>
        </LabSpecimen>
        <LabSpecimen name="保存状态 TpSaveIndicator" note="点击循环：已保存 → 未保存 → 保存中 → 失败。">
          <div class="flex items-center justify-between gap-3">
            <TpSaveIndicator :state="save" at="14:32" @retry="save = 'saving'" />
            <TpButton size="sm" variant="tonal" @click="cycleSave">切换</TpButton>
          </div>
        </LabSpecimen>
        <LabSpecimen name="进度 TpProgress / TpRing" note="进度只表示“完成了多少”，不表示质量。">
          <div class="flex items-center gap-5">
            <TpRing :value="progress" label="任务完成比例"
              ><span class="tp-num text-[1.125rem] leading-none"><TpCountUp :value="progress" /><span class="text-[0.625rem]">%</span></span></TpRing
            >
            <div class="grid flex-1 gap-3">
              <TpProgress :value="progress" label="任务完成比例" />
              <TpProgress label="解析中" tone="pencil" />
              <div class="flex gap-2">
                <TpButton size="sm" variant="tonal" @click="progress = Math.max(0, progress - 16)">−</TpButton>
                <TpButton size="sm" variant="tonal" @click="progress = Math.min(100, progress + 16)">＋</TpButton>
              </div>
            </div>
          </div>
        </LabSpecimen>
        <LabSpecimen name="骨架 → 内容" note="加载态保留版面骨架；内容到达后交叉替换，不跳动。">
          <div class="grid gap-3">
            <Transition name="tp-swap" mode="out-in">
              <div v-if="skeleton" key="s" class="grid gap-2.5">
                <span class="tp-skel h-4 w-2/5" /><span class="tp-skel h-3 w-full" /><span class="tp-skel h-3 w-4/5" />
              </div>
              <div v-else key="c" class="grid gap-1">
                <p class="tp-subheading">3.2 协同过滤召回</p>
                <p class="tp-caption">本节共 1,284 字 · 2 处保护对象 · 上次编辑 14:32</p>
              </div>
            </Transition>
            <div class="flex items-center gap-3">
              <TpButton size="sm" variant="tonal" @click="skeleton = !skeleton">{{ skeleton ? "内容到达" : "重新加载" }}</TpButton>
              <TpScribble :size="18" /><span class="tp-caption">AI 起草中用“涂写”，系统忙用转圈</span>
            </div>
          </div>
        </LabSpecimen>
        <LabSpecimen name="提示气泡 / 头像" note="助手头像用分类色，不表达好坏。">
          <div class="flex flex-wrap items-center gap-2.5">
            <span
              v-for="a in [
                ['general', '综'],
                ['lit', '献'],
                ['content', '文'],
                ['format', '格'],
                ['progress', '程'],
                ['review', '评'],
              ]"
              :key="a[0]"
              class="tp-avatar tp-tip"
              :data-agent="a[0]"
              :data-tip="a[0]"
              tabindex="0"
              >{{ a[1] }}</span
            >
            <span class="tp-avatar tp-avatar--round" style="--av: var(--tp-accent)">林</span>
          </div>
        </LabSpecimen>
      </div>
      <div class="lab-grid lab-grid--3 mt-6">
        <LabSpecimen name="空状态 empty" note="说明这里将出现什么 + 第一步。">
          <TpState kind="empty" title="还没有导师反馈" desc="把导师的原话贴进来或导入文件，原文会被完整保留，再由你决定如何拆成任务。">
            <TpButton size="sm" variant="primary"><TpIcon :icon="PhPlus" />录入反馈</TpButton>
          </TpState>
        </LabSpecimen>
        <LabSpecimen name="无结果 noresult" note="说明查了什么范围 + 如何放宽。">
          <TpState kind="noresult" title="样例文献库中没有匹配项" desc="已在 36 篇自制样例题录中检索“图神经网络 冷启动”。可以减少关键词或取消年份筛选。">
            <TpButton size="sm" variant="outline">清除筛选</TpButton>
          </TpState>
        </LabSpecimen>
        <LabSpecimen name="错误 error" note="先说数据是否安全，再给继续的路径。">
          <TpState
            kind="error"
            title="评审没有完成"
            desc="模拟：评审服务在第 4 章超时。已生成的前 3 章结果已保留，正文与计划未被改动。"
            retryable
            @retry="toast.push({ tone: 'info', title: '已从第 4 章继续' })"
          />
        </LabSpecimen>
      </div>
    </LabSection>

    <LabSection id="table" title="数据表" desc="表头用眉题字体；行内状态用胶囊；停用行降低对比但保留可读。">
      <LabSpecimen>
        <table class="tp-table">
          <thead>
            <tr>
              <th>模型</th>
              <th>所属接口</th>
              <th>上下文</th>
              <th>版本</th>
              <th>状态</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="font-semibold">示例模型 · 通用</td>
              <td>示例接口 A</td>
              <td class="tp-mono">128k（示例值）</td>
              <td><TpVersion :v="4" /></td>
              <td><TpStatus tone="success" label="启用" size="sm" /></td>
              <td class="text-right">
                <TpButton size="sm" variant="ghost" icon-only label="配置"><TpIcon :icon="PhGearSix" /></TpButton>
              </td>
            </tr>
            <tr>
              <td class="font-semibold">示例模型 · 长文</td>
              <td>示例接口 B</td>
              <td class="tp-mono">未知</td>
              <td><TpVersion :v="2" /></td>
              <td><TpStatus tone="danger" label="关联无效 · 接口已停用" size="sm" /></td>
              <td class="text-right">
                <TpButton size="sm" variant="ghost" icon-only label="配置"><TpIcon :icon="PhGearSix" /></TpButton>
              </td>
            </tr>
            <tr class="is-disabled">
              <td class="font-semibold">示例模型 · 旧版</td>
              <td>示例接口 A</td>
              <td class="tp-mono">32k（示例值）</td>
              <td><TpVersion :v="1" /></td>
              <td><TpStatus tone="neutral" label="停用" size="sm" /></td>
              <td class="text-right">
                <TpButton size="sm" variant="ghost" icon-only label="配置"><TpIcon :icon="PhGearSix" /></TpButton>
              </td>
            </tr>
          </tbody>
        </table>
      </LabSpecimen>
    </LabSection>

    <TpDialog v-model:open="dialogOpen" title="正文已经更新" description="这条候选基于 v11 生成，而当前正文是 v13。">
      <p class="text-fg-muted">直接采纳可能覆盖你之后的修改，所以系统拦下了这次操作。你可以基于当前正文重新生成，或对照新旧版本重新审阅。</p>
      <template #actions>
        <TpButton variant="ghost" @click="dialogOpen = false">先不处理</TpButton>
        <TpButton variant="outline" @click="dialogOpen = false">对照审阅</TpButton>
        <TpButton variant="pencil" data-autofocus @click="dialogOpen = false"><TpIcon :icon="PhPencilSimpleLine" />基于 v13 重新生成</TpButton>
      </template>
    </TpDialog>
    <TpDrawer v-model:open="drawerOpen" eyebrow="来源定位" title="《示例学院本科毕业论文撰写规范》">
      <p class="tp-label mb-2">原文 · 第 4.2 条</p>
      <blockquote class="tp-card tp-card--sunken p-4 font-prose leading-loose">
        正文中引用的参考文献应在文末列出，<mark class="tp-flash" style="animation-iteration-count: infinite; animation-duration: 2.4s"
          >近五年文献占比不宜低于三分之一</mark
        >。
      </blockquote>
      <p class="tp-caption mt-3">自制样例文档 · 版本 v2 · 解析于 11-09 20:14</p>
      <template #actions>
        <TpButton variant="outline" @click="drawerOpen = false">关闭</TpButton>
        <TpButton variant="primary" @click="drawerOpen = false"><TpIcon :icon="PhCheck" />知道了</TpButton>
      </template>
    </TpDrawer>
    <TpCommandPalette v-model:open="cmdOpen" />
  </LabPage>
</template>
