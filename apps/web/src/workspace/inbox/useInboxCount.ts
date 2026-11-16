import { onScopeDispose, ref, watch, type Ref } from "vue";
import type { NotificationService } from "../../services/index.ts";

/**
 * 顶栏未读角标（L1）。按项目隔离：切换项目立即清零并放弃旧请求；
 * 每次请求带序号，只接受最新一次且仍属当前项目的结果，迟到响应不覆盖。
 * 窗口重新获得焦点时静默刷新；失败保留上一次的同项目计数，不打断操作。
 */
export function useInboxCount(service: NotificationService, projectId: Ref<string | undefined>, target: Window | undefined = globalThis.window) {
  const count = ref(0);
  let sequence = 0;
  let controller: AbortController | undefined;

  async function refresh() {
    const id = projectId.value;
    controller?.abort();
    const ticket = ++sequence;
    if (!id) return;
    const current = new AbortController();
    controller = current;
    try {
      const result = await service.refresh(id, current.signal);
      if (ticket === sequence && projectId.value === id && result.project_id.toLowerCase() === id.toLowerCase()) count.value = result.unread_count;
    } catch {
      // 角标只是提示；失败时保持同项目上一次的计数，下次聚焦再试。
    }
  }

  /** 页面拿到的更新结果优先：让进行中的旧请求失效。 */
  function accept(id: string, value: number) {
    if (projectId.value !== id) return;
    controller?.abort();
    sequence += 1;
    count.value = value;
  }

  watch(
    projectId,
    () => {
      count.value = 0;
      void refresh();
    },
    { immediate: true },
  );
  const onFocus = () => void refresh();
  target?.addEventListener("focus", onFocus);
  onScopeDispose(() => {
    target?.removeEventListener("focus", onFocus);
    controller?.abort();
    sequence += 1;
  });
  return { count, refresh, accept };
}
