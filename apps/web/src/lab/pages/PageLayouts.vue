<script setup lang="ts">
import { PhCheck, PhMinus } from "@phosphor-icons/vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSeal from "@/components/ui/TpSeal.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { breakpoints } from "@/design/tokens";
import LabPage from "../LabPage.vue";
import LabSection from "../LabSection.vue";
import ScaledFrame from "../scenes/ScaledFrame.vue";
import SceneWorkbench from "../scenes/SceneWorkbench.vue";

const spaces = [
  { name: "今日", role: "一句话告诉我今天最要紧的事", f: ["F02", "F03", "F07", "F08"], has: "阶段航线、下一步、等你决定、进度、主动建议横幅" },
  { name: "写作", role: "唯一的正文实例 + 修订审阅 + 版本", f: ["F04", "F05", "F13"], has: "章节目录、稿纸、选区气泡、候选审阅、版本时间线与对比" },
  { name: "计划", role: "阶段、任务、依赖与计划版本", f: ["F03", "F07"], has: "航线详情、任务清单 / 依赖视图、学生确认、调整候选对比" },
  { name: "资料", role: "原件、解析结果与知识来源", f: ["F10", "F11", "F12", "F13"], has: "资料库、模板版本、要求清单与来源定位、文献查询" },
  { name: "反馈", role: "导师原话到任务的可追溯链", f: ["F09"], has: "原文、拆解与纠正、处理证据、歧义标记" },
  { name: "评审", role: "只评审、不修改", f: ["F14"], has: "发起评审（整篇 / 章节）、报告、问题定位、历史报告" },
  {
    name: "配置台",
    role: "管理配置与诊断（与学生流程分开）",
    f: ["F01", "F03", "F15", "F16", "F17", "F18", "F19"],
    has: "流程配置、四库与关联图、字典、后台任务、演示用户与会话、场景实验室",
  },
];
const globals = [
  { name: "副驾坞", f: ["F06"], has: "综合 / 专业模式、多助手会话、上下文范围、运行状态" },
  { name: "收件箱", f: ["F08"], has: "主动建议与通知：未读 / 延后 / 忽略 / 处理记录" },
  { name: "指令面板 ⌘K", f: ["全局"], has: "跳转、搜索章节、发起 AI 请求" },
  { name: "任务托盘", f: ["F19"], has: "正在进行的解析 / 生成 / 评审 / 导出，可取消与重试" },
  { name: "项目切换器", f: ["F02"], has: "新建、切换、归档与恢复；首次设置向导" },
  { name: "导出与备份", f: ["F20"], has: "论文 / 报告 / 修改说明导出，项目备份与恢复" },
  { name: "账户与偏好", f: ["F01"], has: "演示用户、通知偏好、静默时段、外观与动效、会话失效处理" },
];

const shells = [
  {
    id: "desk",
    letter: "甲",
    name: "书桌",
    line: "左边是抽屉，中间是稿纸，右边坐着副驾。",
    pros: ["模块多也不乱：七个空间常驻左轨", "稿纸与副驾并排，候选与正文同屏对照", "管理配置可以用同一外壳、换一套密度"],
    cons: ["三栏对窄屏不友好，需要收起规则", "最常规，记忆点靠语法与细节而不是结构"],
    fit: 5,
  },
  {
    id: "scroll",
    letter: "乙",
    name: "卷轴",
    line: "只有一张纸，其余都是需要时才展开的边注。",
    pros: ["写作沉浸感最强，第一眼最“清爽”", "底部“副驾栏”很有辨识度"],
    cons: ["候选审阅要么遮住正文，要么挤压正文", "配置台的十几个表格页需要另一套外壳", "多助手并行难以呈现"],
    fit: 3,
  },
  {
    id: "map",
    letter: "丙",
    name: "航图",
    line: "首页就是航线，阶段是站点，点进去才是工作台。",
    pros: ["把“智途”讲到极致，演示效果最好", "阶段、任务、截止的空间关系一目了然"],
    cons: ["日常高频操作多一层进入", "空间隐喻对表格类模块没有帮助", "实现与可访问性成本最高"],
    fit: 2,
  },
];

const callouts = [
  { n: 1, x: 5.9, y: 10.5, name: "航线轨", desc: "七个空间的常驻入口。窄屏收成图标，不消失。" },
  { n: 2, x: 61, y: 3.6, name: "航线条", desc: "项目切换、阶段位置、截止倒计时、保存状态、正文版本、收件箱、⌘K。任何页面都知道“我在哪、是哪一版”。" },
  { n: 3, x: 22.6, y: 9.2, name: "章节目录", desc: "稳定的章节标识，不依赖屏幕坐标；确认过的章节带印章点。" },
  { n: 4, x: 68.3, y: 9.2, name: "稿纸", desc: "全应用唯一的 Tiptap 实例。切换模块、切换助手、打开抽屉都不会销毁它。" },
  { n: 5, x: 98.6, y: 9.2, name: "副驾坞", desc: "综合 / 专业模式与多助手标签；每个助手保留自己的会话与草稿。可收起、可调宽。" },
  { n: 6, x: 42.6, y: 38.6, name: "选区气泡", desc: "选中文字后的就地入口：请 AI 起草（只产生候选）、锁定。" },
];
const rules = [
  { need: "模式切换、打开模块不丢稿（M04 · F04）", how: "编辑器实例挂在外壳层并保持存活；“写作”以外的空间只是把稿纸收起，不卸载。" },
  { need: "候选与正文同屏对照（F05）", how: "候选卡固定在副驾坞，稿纸内同步显示铅笔差异；两处由同一份候选数据驱动。" },
  { need: "多助手同时打开（F06）", how: "副驾坞用标签承载多个助手；宽屏（≥ 1440）可并排两个，各自保留草稿。" },
  { need: "主动辅助不打断写作（F08）", how: "稿纸之上最多出现 L1 角标。L3 横幅只出现在“今日 / 计划”，L4 模态只留给冲突与丢稿风险。" },
  { need: "仅评审不改正文（F14）", how: "评审空间里的稿纸是只读定位视图；想改，必须显式“请求修订候选”回到写作。" },
  { need: "管理配置不混进学生流程", how: "配置台是独立空间：同一外壳、更高密度、不显示副驾坞。场景实验室放在这里。" },
  { need: "后台任务可见、可取消（F19）", how: "左下角任务托盘常驻；展开即任务列表，失败项就地重试。" },
];
const screens = [
  ["今日", "F02 F03 F07 F08", "有规划 / 无规划 / 空项目 / 有延期 / 阶段完成"],
  ["写作 · 编辑", "F04", "空文档 / 已导入 / 保存失败 / 不支持对象锁定"],
  ["写作 · 候选审阅", "F05", "候选状态 / 部分采纳 / 重叠补丁 / 撤销"],
  ["写作 · 版本", "F05 F20", "时间线 / 两版对比 / 恢复确认"],
  ["计划", "F03 F07", "清单 / 依赖 / 调整候选 / 循环依赖 / 无可行解"],
  ["资料库", "F10", "上传处理中 / 部分识别 / 失败 / 重复 / 新版本"],
  ["模板与要求", "F11 F12", "解析项纠正 / 来源定位 / 冲突 / 不能判定"],
  ["文献", "F13", "有结果 / 无结果 / 仅题录 / 仅摘要 / 无法核实"],
  ["反馈", "F09", "明确 / 歧义 / 无法定位 / 学生纠正 / 证据变化"],
  ["评审", "F14", "发起 / 进行中 / 报告 / 旧稿报告 / 导出失败"],
  ["配置台 · 四库", "F15—F18", "新增 / 编辑 / 停用 / 版本对比 / 无效关联 / 模拟连通"],
  ["配置台 · 流程与系统", "F03 F19 F01", "阶段配置 / 字典 / 任务诊断 / 用户与会话"],
  ["导出与备份", "F20", "真实格式下载 / 模拟转换失败 / 备份恢复 / 损坏备份拒绝"],
  ["首次设置向导", "F02", "选流程与模板版本 / 填或跳过规划 / 导入或空白开始"],
];
</script>

<template>
  <LabPage
    no="07"
    eyebrow="Layout & navigation"
    title="布局与导航"
    lead="F01—F20 不是二十个页面。按“学生此刻在做什么”收成七个空间，再加几件随处可用的工具。下面先给信息架构，再给三种外壳方案，请你选一种。"
  >
    <LabSection id="ia" title="信息架构" desc="七个空间是“去哪里”，七件全局工具是“随身带着”。每个功能模块至少有一个可操作入口，不存在只有占位的入口。">
      <p class="tp-label mb-3">七个空间</p>
      <div class="lab-grid lab-grid--4">
        <div v-for="(s, i) in spaces" :key="s.name" class="tp-card p-4" :class="{ 'lg:col-span-2': i === 6 }">
          <p class="flex items-baseline justify-between gap-2">
            <b class="tp-title !text-[1.375rem]">{{ s.name }}</b>
            <span class="flex flex-wrap justify-end gap-1"><span v-for="f in s.f" :key="f" class="tp-ver">{{ f }}</span></span>
          </p>
          <p class="mt-1 font-medium">{{ s.role }}</p>
          <p class="tp-caption mt-1.5">{{ s.has }}</p>
        </div>
      </div>
      <p class="tp-label mt-8 mb-3">七件全局工具</p>
      <div class="tp-card grid sm:grid-cols-2">
        <div v-for="g in globals" :key="g.name" class="flex items-baseline gap-3 border-b border-line px-4 py-2.5">
          <b class="w-28 shrink-0">{{ g.name }}</b>
          <span class="tp-ver shrink-0">{{ g.f[0] }}</span>
          <span class="tp-caption">{{ g.has }}</span>
        </div>
      </div>
    </LabSection>

    <LabSection id="shells" title="三种外壳" desc="同样的信息架构，三种组织方式。线框图里实线块是常驻区域，铅笔虚线块是 AI 相关区域。">
      <div class="lab-grid lab-grid--3 items-start">
        <article v-for="shell in shells" :key="shell.id" class="tp-card relative p-4">
          <TpSeal v-if="shell.id === 'desk'" class="!absolute right-4 top-4 z-10" text="推荐" :animate="false" />
          <div class="wf" :data-shell="shell.id" aria-hidden="true">
            <template v-if="shell.id === 'desk'">
              <i class="wf-b" style="inset: 0 auto 0 0; width: 9%"><span>轨</span></i>
              <i class="wf-b" style="inset: 0 0 auto 11%; height: 11%"><span>航线条</span></i>
              <i class="wf-b" style="inset: 14% auto 0 11%; width: 15%"><span>目录</span></i>
              <i class="wf-b wf-b--paper" style="inset: 14% 31% 0 28%"><span>稿纸</span></i>
              <i class="wf-b wf-b--ai" style="inset: 14% 0 0 71%"><span>副驾坞</span></i>
            </template>
            <template v-else-if="shell.id === 'scroll'">
              <i class="wf-b" style="inset: 0 0 auto 0; height: 11%"><span>航线条 + 横向导航</span></i>
              <i class="wf-b wf-b--paper" style="inset: 14% 22% 0 22%"><span>稿纸</span></i>
              <i class="wf-b wf-b--ghost" style="inset: 20% 80% 30% 2%"><span>目录（按需）</span></i>
              <i class="wf-b wf-b--ai wf-b--float" style="inset: 22% 2% 26% 72%"><span>候选（覆盖）</span></i>
              <i class="wf-b wf-b--ai wf-b--float" style="inset: 82% 26% 5% 26%"><span>副驾栏</span></i>
            </template>
            <template v-else>
              <svg class="absolute inset-0 size-full" viewBox="0 0 100 62" preserveAspectRatio="none">
                <path d="M6 50 C 22 50, 20 16, 38 18 S 52 44, 66 40" fill="none" stroke="var(--tp-ink)" stroke-width="0.9" />
                <path d="M66 40 C 78 37, 80 14, 94 12" fill="none" stroke="var(--tp-ghost-line)" stroke-width="0.9" stroke-dasharray="2 2" />
              </svg>
              <i class="wf-dot" style="left: 6%; top: 80%" /><i class="wf-dot" style="left: 38%; top: 29%" /><i
                class="wf-dot wf-dot--now"
                style="left: 66%; top: 64%"
              /><i class="wf-dot wf-dot--next" style="left: 94%; top: 19%" />
              <i class="wf-b wf-b--paper wf-b--float" style="inset: 8% 40% 44% 44%"><span>当前阶段工作台</span></i>
              <i class="wf-b wf-b--ai wf-b--float" style="inset: 62% 4% 6% 72%"><span>副驾</span></i>
              <i class="wf-b" style="inset: 86% 34% 4% 4%"><span>工具坞</span></i>
            </template>
          </div>
          <p class="tp-label mt-4">布局 {{ shell.letter }}</p>
          <h3 class="tp-title !text-[1.5rem]">{{ shell.name }}</h3>
          <p class="mt-1 text-fg-muted">{{ shell.line }}</p>
          <ul class="mt-3 grid gap-1.5 text-[0.8125rem]">
            <li v-for="p in shell.pros" :key="p" class="flex gap-2">
              <TpIcon :icon="PhCheck" :size="14" weight="bold" class="mt-0.5 text-ok-content" />{{ p }}
            </li>
            <li v-for="c in shell.cons" :key="c" class="flex gap-2 text-fg-muted"><TpIcon :icon="PhMinus" :size="14" weight="bold" class="mt-0.5" />{{ c }}</li>
          </ul>
          <p class="tp-caption mt-3 border-t border-line pt-3">
            对 F01—F20 的适配度　<span class="text-fg">{{ "●".repeat(shell.fit) }}</span><span class="text-fg-faint">{{ "○".repeat(5 - shell.fit) }}</span>
          </p>
        </article>
      </div>
      <div class="tp-pencil mt-6 p-4">
        <p class="tp-label !text-pencil-content">我的建议</p>
        <p class="mt-1">
          用 <b>甲 · 书桌</b> 做骨架，再从另外两种各拿一件：从 <b>乙</b> 拿“写作专注模式”（一键收起左轨与副驾坞，只剩稿纸）；从
          <b>丙</b> 拿“航线”作为今日页与顶栏的主视觉。这样结构稳，记忆点也不丢。
        </p>
      </div>
    </LabSection>

    <LabSection id="anatomy" title="推荐外壳的结构" desc="用真实组件拼出的写作台，标注了六个常驻区域。收件箱、任务托盘、指令面板是按需出现的浮层，不在图中。">
      <div class="lab-frame relative">
        <ScaledFrame inert><SceneWorkbench /></ScaledFrame>
        <span v-for="c in callouts" :key="c.n" class="lab-pin" :style="{ left: c.x + '%', top: c.y + '%' }">{{ c.n }}</span>
      </div>
      <ol class="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="c in callouts" :key="c.n" class="flex gap-3">
          <span class="lab-pin lab-pin--inline">{{ c.n }}</span>
          <span><b class="block">{{ c.name }}</b><span class="tp-caption">{{ c.desc }}</span></span>
        </li>
      </ol>
    </LabSection>

    <LabSection id="rules" title="需求如何落到布局上" desc="布局不是品味问题，下面每一条都对应一项功能要求或验收项。">
      <div class="tp-card divide-y divide-line">
        <div v-for="r in rules" :key="r.need" class="grid gap-x-6 gap-y-1 px-5 py-3.5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <p class="font-semibold">{{ r.need }}</p>
          <p class="text-fg-muted">{{ r.how }}</p>
        </div>
      </div>
    </LabSection>

    <LabSection id="responsive" title="窗口宽度" desc="M18 只要求“实际可用”。这里约定三档行为，保证任何宽度下没有被遮住或够不到的操作。">
      <div class="lab-grid lab-grid--3">
        <div v-for="(b, i) in breakpoints" :key="b.id" class="tp-card p-4">
          <div class="wf wf--mini" aria-hidden="true">
            <template v-if="i === 0">
              <i class="wf-b" style="inset: 0 auto 0 0; width: 12%" /><i class="wf-b" style="inset: 0 0 auto 15%; height: 14%" /><i
                class="wf-b wf-b--paper"
                style="inset: 18% 0 0 15%"
              />
              <i class="wf-b wf-b--ai wf-b--float" style="inset: 10% 3% 6% 52%"><span>抽屉</span></i>
            </template>
            <template v-else-if="i === 1">
              <i class="wf-b" style="inset: 0 auto 0 0; width: 8%" /><i class="wf-b" style="inset: 0 0 auto 10%; height: 14%" /><i
                class="wf-b wf-b--paper"
                style="inset: 18% 34% 0 10%"
              /><i class="wf-b wf-b--ai" style="inset: 18% 0 0 68%" />
            </template>
            <template v-else>
              <i class="wf-b" style="inset: 0 auto 0 0; width: 6%" /><i class="wf-b" style="inset: 0 0 auto 8%; height: 14%" /><i
                class="wf-b"
                style="inset: 18% auto 0 8%; width: 12%"
              /><i class="wf-b wf-b--paper" style="inset: 18% 44% 0 22%" />
              <i class="wf-b wf-b--ai" style="inset: 18% 22% 0 58%" /><i class="wf-b wf-b--ai" style="inset: 18% 0 0 80%" />
            </template>
          </div>
          <p class="mt-3 flex items-center gap-2">
            <b class="tp-subheading">{{ ["紧凑", "常规", "宽屏"][i] }}</b
            ><TpStatus tone="neutral" :label="i === 0 ? '< 960' : i === 1 ? '960 – 1439' : '≥ 1440'" size="sm" />
          </p>
          <p class="tp-caption mt-1">{{ b.note.split("：")[1] }}</p>
        </div>
      </div>
    </LabSection>

    <LabSection id="screens" title="界面清单" desc="确认方案后要实现的界面与各自必须覆盖的状态（对应《交付与验收要求》§5 的场景组）。">
      <div class="tp-card overflow-x-auto">
        <table class="tp-table">
          <thead>
            <tr>
              <th>界面</th>
              <th>覆盖</th>
              <th>必须设计的状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in screens" :key="row[0]">
              <td class="whitespace-nowrap font-semibold">{{ row[0] }}</td>
              <td class="tp-mono whitespace-nowrap text-fg-muted">{{ row[1] }}</td>
              <td>{{ row[2] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </LabSection>
  </LabPage>
</template>
