import type { DocsDraftScope } from "./docsDrafts.ts";

/**
 * 旧编辑器（正文结构 v1）留在本机的未保存草稿：新编辑器不能载入它们，升级前提供下载保留。
 * 只读打开旧草稿库；库不存在时中止升级事务，绝不创建空库（以免旧库的结构初始化被跳过）。
 */
export interface LegacyDraft {
  id: string;
  baseVersion: number;
  updatedAt: string;
  json: unknown;
}

const databaseName = "thesis-pilot-document-drafts";
const storeName = "drafts";
const scopeFields = ["sourceKey", "projectId", "localProjectId", "documentId"] as const;

export async function readLegacyDrafts(scope: DocsDraftScope, factory: IDBFactory | undefined = globalThis.indexedDB): Promise<LegacyDraft[]> {
  if (!factory) return [];
  const database = await new Promise<IDBDatabase | undefined>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(databaseName);
    } catch {
      resolve(undefined);
      return;
    }
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onerror = () => resolve(undefined);
    request.onblocked = () => resolve(undefined);
    request.onsuccess = () => resolve(request.result);
  });
  if (!database) return [];
  try {
    if (!database.objectStoreNames.contains(storeName)) return [];
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    const rows = await new Promise<unknown[]>((resolve) => {
      transaction.oncomplete = () => resolve(Array.isArray(request.result) ? request.result : []);
      transaction.onabort = () => resolve([]);
      transaction.onerror = () => resolve([]);
    });
    return rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const draft = row as Record<string, unknown>;
      if (!scopeFields.every((field) => draft[field] === scope[field])) return [];
      const snapshot = draft.snapshot as Record<string, unknown> | undefined;
      if (typeof draft.id !== "string" || typeof draft.updatedAt !== "string" || !Number.isSafeInteger(draft.baseVersion) || !snapshot?.json) return [];
      return [{ id: draft.id, baseVersion: draft.baseVersion as number, updatedAt: draft.updatedAt, json: snapshot.json }];
    });
  } catch {
    return [];
  } finally {
    database.close();
  }
}

/** 下载内容：旧版结构的正文 JSON，可交维护者或在旧版本中对照。 */
export function legacyDraftFile(scope: DocsDraftScope, drafts: readonly LegacyDraft[]) {
  return {
    filename: "thesispilot-legacy-drafts.json",
    mime: "application/json;charset=utf-8",
    content: JSON.stringify({
      ...scope,
      drafts: drafts.map((draft) => ({ baseVersion: draft.baseVersion, updatedAt: draft.updatedAt, content: { schema_version: 1, json: draft.json } })),
    }),
  };
}
