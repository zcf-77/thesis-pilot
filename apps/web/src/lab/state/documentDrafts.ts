import { prepareEditorSnapshot, type EditorSnapshot } from "./editorAdapter.ts";

export interface RemoteDocumentIdentity {
  localProjectId: string;
  projectId: string;
  sourceKey: string;
}

export interface DocumentDraftScope extends RemoteDocumentIdentity {
  documentId: string;
}

export interface PendingDocumentSave {
  expectedVersion: number;
  fingerprint: string;
}

export interface DocumentDraft extends DocumentDraftScope {
  id: string;
  revision: string;
  baseVersion: number;
  snapshot: EditorSnapshot;
  updatedAt: string;
  pendingSave?: PendingDocumentSave;
}

export interface DocumentDraftRepository {
  list(scope: DocumentDraftScope): Promise<DocumentDraft[]>;
  put(draft: DocumentDraft): Promise<void>;
  removeIfUnchanged(draft: DocumentDraft): Promise<void>;
}

const databaseName = "thesis-pilot-document-drafts";
const storeName = "drafts";
const scopeIndex = "document";
const scopeFields = ["sourceKey", "projectId", "localProjectId", "documentId"] as const;

export function sameDocumentDraftScope(a: DocumentDraftScope, b: DocumentDraftScope): boolean {
  return scopeFields.every((field) => a[field] === b[field]);
}

const transactionComplete = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("草稿事务已中止。"));
  });

function validateDraft(draft: DocumentDraft, scope: DocumentDraftScope): DocumentDraft {
  if (
    !draft ||
    !sameDocumentDraftScope(draft, scope) ||
    typeof draft.id !== "string" ||
    !draft.id ||
    typeof draft.revision !== "string" ||
    !draft.revision ||
    !Number.isSafeInteger(draft.baseVersion) ||
    draft.baseVersion < 1 ||
    typeof draft.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(draft.updatedAt)) ||
    (draft.pendingSave && (draft.pendingSave.expectedVersion !== draft.baseVersion || !/^[a-f0-9]{64}$/.test(draft.pendingSave.fingerprint)))
  ) {
    throw new Error("草稿记录无效。");
  }
  return { ...draft, snapshot: prepareEditorSnapshot(draft.snapshot) };
}

export function createDocumentDraftRepository(factory?: IDBFactory): DocumentDraftRepository {
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
      const drafts: DocumentDraft[] = request.result;
      return drafts.map((draft) => validateDraft(draft, scope));
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
        const current: DocumentDraft | undefined = request.result;
        if (current?.revision === draft.revision && sameDocumentDraftScope(current, draft)) store.delete(draft.id);
      };
      await transactionComplete(transaction);
    },
  };
}

export const browserDocumentDrafts = createDocumentDraftRepository();
