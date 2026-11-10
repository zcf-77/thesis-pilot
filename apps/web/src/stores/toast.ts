import { defineStore } from "pinia";
import { ref } from "vue";
import type { Tone } from "@/design/tone";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastItem {
  id: number;
  tone: Extract<Tone, "neutral" | "info" | "success" | "warning" | "danger" | "pencil" | "seal">;
  title: string;
  desc?: string;
  /** 毫秒；0 表示不自动消失（错误默认不自动消失） */
  duration: number;
  action?: ToastAction;
}

/** 轻提示队列。业务层只描述“发生了什么”，外观由 TpToastHost 决定。 */
export const useToastStore = defineStore("toast", () => {
  const items = ref<ToastItem[]>([]);
  let seq = 0;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  function dismiss(id: number) {
    items.value = items.value.filter((t) => t.id !== id);
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
  }

  function push(input: Omit<ToastItem, "id" | "duration"> & { duration?: number }) {
    const id = ++seq;
    const duration = input.duration ?? (input.tone === "danger" ? 0 : 4200);
    items.value = [...items.value, { ...input, id, duration }].slice(-4);
    if (duration > 0)
      timers.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
    return id;
  }

  return { items, push, dismiss };
});
