export const WORKSPACE_STORAGE_KEY = "thesispilot.workspace.v1";
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export function browserStorage(): StoragePort | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}
export function readWorkspaceStorage(storage: StoragePort | null): unknown {
  const raw = storage?.getItem(WORKSPACE_STORAGE_KEY);
  if (!raw) return null;
  if (raw.length > 48 * 1024 * 1024) throw new Error("本地项目数据超过读取上限，请先保留备份。");
  return JSON.parse(raw) as unknown;
}
export function writeWorkspaceStorage(storage: StoragePort | null, value: unknown) {
  if (!storage) {
    if (typeof window !== "undefined") throw new Error("浏览器未提供本地存储，请下载项目备份。");
    return;
  }
  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    throw new Error("本地保存失败，可能是存储空间不足或浏览器禁止写入。当前内容仍保留，可重试或下载备份。");
  }
}
