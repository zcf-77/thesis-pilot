import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";
import PageComponents from "./lab/pages/PageComponents.vue";
import PageDirections from "./lab/pages/PageDirections.vue";
import PageOverview from "./lab/pages/PageOverview.vue";
import PageSpec from "./lab/pages/PageSpec.vue";
import PageTokens from "./lab/pages/PageTokens.vue";
import PageDomain from "./lab/pages/PageDomain.vue";
import PageGrammar from "./lab/pages/PageGrammar.vue";
import PageLayouts from "./lab/pages/PageLayouts.vue";
import PageMotion from "./lab/pages/PageMotion.vue";

/**
 * 当前阶段只有“设计展台”。hash 路由保证单文件 HTML 直接双击可用。
 * 进入全量实现后，展台整体迁到 /lab 下，业务路由按 docs/design/DESIGN-SPEC.md 的信息架构建立。
 */
export interface LabNavItem {
  path: string;
  no: string;
  title: string;
  desc: string;
}

export const labNav: LabNavItem[] = [
  { path: "/", no: "00", title: "总览", desc: "一句话原则与待确认事项" },
  { path: "/directions", no: "01", title: "四个方案", desc: "朱墨 / 荧光笔记 / 夜航 / 晨雾" },
  { path: "/grammar", no: "02", title: "设计语法", desc: "材质、层级、状态词汇" },
  { path: "/tokens", no: "03", title: "色彩与令牌", desc: "语义色、对比度、形状、间距" },
  { path: "/components", no: "04", title: "基础组件", desc: "按钮、表单、浮层、状态" },
  { path: "/domain", no: "05", title: "业务组件", desc: "候选、任务、反馈、评审" },
  { path: "/motion", no: "06", title: "动效系统", desc: "时长、曲线、签名动效" },
  { path: "/layouts", no: "07", title: "布局与导航", desc: "信息架构与三种外壳" },
  { path: "/spec", no: "08", title: "规范文档", desc: "可逐条核对的正式文本" },
];

const routes: RouteRecordRaw[] = [
  { path: "/", component: PageOverview },
  { path: "/directions", component: PageDirections },
  { path: "/grammar", component: PageGrammar },
  { path: "/tokens", component: PageTokens },
  { path: "/components", component: PageComponents },
  { path: "/domain", component: PageDomain },
  { path: "/motion", component: PageMotion },
  { path: "/layouts", component: PageLayouts },
  { path: "/spec", component: PageSpec },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(to) {
    if (to.hash) return { el: to.hash, top: 96, behavior: "smooth" };
    return { top: 0 };
  },
});
