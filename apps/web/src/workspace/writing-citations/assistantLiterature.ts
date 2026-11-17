import { computed, reactive } from "vue";
import type { LiteratureEntryRead } from "../../services/contracts/api.generated.ts";

/** 一条交给内容助手的项目文献：固定条目版本，运行时由服务端再核对。 */
export interface PinnedLiterature {
  entryId: string;
  version: number;
  title: string;
}

/**
 * 资料页“加入助手上下文”与写作页内容助手之间的本次会话交接（只在内存中，按服务实例与项目隔离）。
 * 这里只是待选清单：真正进入运行上下文仍须学生在助手中确认并发起。
 */
const pinned = reactive(new Map<string, PinnedLiterature[]>());
export const MAX_ASSISTANT_LITERATURE = 10;

export function assistantLiteratureScope(sourceKey: string, projectId: string) {
  return `${sourceKey}:${projectId.toLowerCase()}`;
}

export function useAssistantLiterature(scope: () => string) {
  const items = computed(() => pinned.get(scope()) ?? []);
  const has = (entryId: string) => items.value.some((item) => item.entryId === entryId);
  function add(entry: Pick<LiteratureEntryRead, "id" | "version" | "record">): boolean {
    if (has(entry.id)) return true;
    if (items.value.length >= MAX_ASSISTANT_LITERATURE) return false;
    pinned.set(scope(), [...items.value, { entryId: entry.id, version: entry.version, title: entry.record.title }]);
    return true;
  }
  function remove(entryId: string) {
    pinned.set(
      scope(),
      items.value.filter((item) => item.entryId !== entryId),
    );
  }
  /** 条目版本变化（如重新核验）后更新待选版本；移出项目文献的条目自动去掉。 */
  function sync(entries: readonly Pick<LiteratureEntryRead, "id" | "version" | "removed">[]) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const next = items.value
      .filter((item) => byId.has(item.entryId) && !byId.get(item.entryId)!.removed)
      .map((item) => ({ ...item, version: byId.get(item.entryId)!.version }));
    pinned.set(scope(), next);
  }
  return { items, has, add, remove, sync };
}
