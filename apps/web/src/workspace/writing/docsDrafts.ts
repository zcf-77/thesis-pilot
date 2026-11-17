import { parseDocsSnapshot, type DocsSnapshot } from "../editor/docsSnapshot.ts";

/**
 * 正文快照 v2 的本机草稿：IndexedDB，按服务实例、远端项目、本地工作区与正文隔离。
 * 与旧编辑器草稿分库保存（旧库只读，用于升级前下载保留），两种结构不会互相载入。
 */
export interface DocsDraftIdentity {
  sourceKey: string;
  projectId: string;
  localProjectId: string;
}
export interface DocsDraftScope extends DocsDraftIdentity {
  documentId: string;
}
export interface PendingDocsSave {
  expectedVersion: number;
  /** 提交快照（模型 + 保护）的 SHA-256，用于结果未知时核对最新版本。 */
  fingerprint: string;
}
export interface DocsDraft extends DocsDraftScope {
  id: string;
  revision: string;
  baseVersion: number;
  snapshot: DocsSnapshot;
  updatedAt: string;
  pendingSave?: PendingDocsSave;
}
export interface DocsDraftRepository {
  list(scope: DocsDraftScope): Promise<DocsDraft[]>;
  put(draft: DocsDraft): Promise<void>;
  removeIfUnchanged(draft: DocsDraft): Promise<void>;
}

const databaseName = "thesis-pilot-docs-drafts";
const storeName = "drafts";
const scopeIndex = "document";
const scopeFields = ["sourceKey", "projectId", "localProjectId", "documentId"] as const;

export function sameDocsDraftScope(a: DocsDraftScope, b: DocsDraftScope): boolean {
  return scopeFields.every((field) => a[field] === b[field]);
}

const transactionComplete = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("草稿事务已中止。"));
  });

/** 读出的草稿逐条校验；结构不合格的记录不载入编辑器。 */
export function validateDocsDraft(draft: DocsDraft, scope: DocsDraftScope): DocsDraft {
  if (
    !draft ||
    !sameDocsDraftScope(draft, scope) ||
    typeof draft.id !== "string" ||
    !draft.id ||
    typeof draft.revision !== "string" ||
    !draft.revision ||
    !Number.isSafeInteger(draft.baseVersion) ||
    draft.baseVersion < 1 ||
    typeof draft.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(draft.updatedAt)) ||
    (draft.pendingSave && (draft.pendingSave.expectedVersion !== draft.baseVersion || !/^[a-f0-9]{64}$/.test(draft.pendingSave.fingerprint)))
  )
    throw new Error("草稿记录无效。");
  return { ...draft, snapshot: parseDocsSnapshot(draft.snapshot) };
}

export function createDocsDraftRepository(factory?: IDBFactory): DocsDraftRepository {
  let database: Promise<IDBDatabase> | undefined;
  function connect(): Promise<IDBDatabase> {
    if (database) return database;
    const indexedDatabase = factory ?? globalThis.indexedDB;
    if (!indexedDatabase) return Promise.reject(new Error("当前环境无法使用浏览器草稿存储。"));
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDatabase.open(databaseName, 1);
      let blocked = false;
      request.onblocked = () => {
        blocked = true;
        reject(new Error("其他窗口正在使用旧草稿存储。"));
      };
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(storeName, { keyPath: "id" }).createIndex(scopeIndex, [...scopeFields]);
      };
      request.onsuccess = () => {
        const connection = request.result;
        if (blocked) {
          connection.close();
          return;
        }
        connection.onversionchange = () => {
          connection.close();
          database = undefined;
        };
        resolve(connection);
      };
    }).catch((error: unknown) => {
      database = undefined;
      throw error;
    });
    return database;
  }

  return {
    async list(scope) {
      const transaction = (await connect()).transaction(storeName, "readonly");
      const request = transaction
        .objectStore(storeName)
        .index(scopeIndex)
        .getAll(scopeFields.map((field) => scope[field]));
      await transactionComplete(transaction);
      const drafts: DocsDraft[] = request.result;
      // 单条损坏的记录跳过，不连累其他草稿。
      return drafts.flatMap((draft) => {
        try {
          return [validateDocsDraft(draft, scope)];
        } catch {
          return [];
        }
      });
    },
    async put(draft) {
      const transaction = (await connect()).transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(draft);
      await transactionComplete(transaction);
    },
    async removeIfUnchanged(draft) {
      const transaction = (await connect()).transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.get(draft.id);
      request.onsuccess = () => {
        const current: DocsDraft | undefined = request.result;
        if (current?.revision === draft.revision && sameDocsDraftScope(current, draft)) store.delete(draft.id);
      };
      await transactionComplete(transaction);
    },
  };
}

export const browserDocsDrafts = createDocsDraftRepository();
