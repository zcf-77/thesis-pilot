import { defineStore } from "pinia";
import { nextTick, ref, watch } from "vue";
import { defaultTheme, themes, type ThemeId } from "@/design/tokens";

export type MotionPref = "full" | "reduced";

const STORAGE_KEY = import.meta.env.MODE === "workspace" ? "thesispilot.workspace.appearance.v1" : "thesispilot.appearance.v1";

interface Persisted {
  theme: ThemeId;
  motion: MotionPref;
}

function load(): Persisted {
  const systemReduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const base: Persisted = { theme: defaultTheme, motion: systemReduced ? "reduced" : "full" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      theme: parsed.theme && parsed.theme in themes ? parsed.theme : base.theme,
      motion: parsed.motion === "reduced" || parsed.motion === "full" ? parsed.motion : base.motion,
    };
  } catch {
    return base;
  }
}

/** 外观偏好：当前方案与动效强度。只保存展示偏好，不含业务数据。 */
export const useAppearanceStore = defineStore("appearance", () => {
  const initial = load();
  const theme = ref<ThemeId>(initial.theme);
  const motion = ref<MotionPref>(initial.motion);

  function apply() {
    const el = document.documentElement;
    el.dataset.theme = theme.value;
    el.dataset.motion = motion.value;
    el.style.colorScheme = themes[theme.value].mode;
  }

  watch(
    [theme, motion],
    () => {
      apply();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: theme.value, motion: motion.value }));
      } catch {
        /* 存储不可用时仅本次会话生效 */
      }
    },
    { immediate: true },
  );

  /** 切换方案；提供点击坐标时使用圆形揭示转场 */
  function setTheme(next: ThemeId, origin?: { x: number; y: number }) {
    if (next === theme.value) return;
    const canAnimate = typeof document.startViewTransition === "function" && motion.value === "full" && origin;
    if (!canAnimate) {
      theme.value = next;
      return;
    }
    const { x, y } = origin;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const transition = document.startViewTransition(async () => {
      theme.value = next;
      apply();
      await nextTick();
    });
    void transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: ["circle(0px at " + x + "px " + y + "px)", "circle(" + radius + "px at " + x + "px " + y + "px)"] },
        { duration: 720, easing: "cubic-bezier(0.3, 0, 0.1, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    });
  }

  function toggleMotion() {
    motion.value = motion.value === "full" ? "reduced" : "full";
  }

  return { theme, motion, setTheme, toggleMotion };
});
