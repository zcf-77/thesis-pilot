/// <reference types="vite/client" />

// 给不认识 .vue 的工具（Oxlint 的类型感知规则）一个兜底声明；真实的组件类型由 vue-tsc 提供。
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

declare module "*.md?raw" {
  const content: string;
  export default content;
}
