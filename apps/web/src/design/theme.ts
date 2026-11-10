import { computed, inject, provide, type ComputedRef, type InjectionKey, type Ref } from "vue";
import { defaultTheme, themes, type ThemeDef, type ThemeId } from "./tokens";

/**
 * 主题作用域：根应用与任意嵌套预览都通过它得到“当前方案”。
 * 组件不直接读全局 store，嵌套主题（方案对比）才能成立。
 */
export interface ThemeScope {
  id: ComputedRef<ThemeId>;
  def: ComputedRef<ThemeDef>;
}

const key: InjectionKey<ThemeScope> = Symbol("tp-theme-scope");

export function provideThemeScope(id: Ref<ThemeId> | (() => ThemeId)): ThemeScope {
  const resolved = computed(() => (typeof id === "function" ? id() : id.value));
  const scope: ThemeScope = { id: resolved, def: computed(() => themes[resolved.value]) };
  provide(key, scope);
  return scope;
}

const fallback: ThemeScope = {
  id: computed(() => defaultTheme),
  def: computed(() => themes[defaultTheme]),
};

export function useThemeScope(): ThemeScope {
  return inject(key, fallback);
}
