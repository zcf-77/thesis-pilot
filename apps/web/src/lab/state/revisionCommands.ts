import type {
  RevisionApply,
  RevisionCancel,
  RevisionCreate,
  RevisionDecide,
  RevisionProposal,
  RevisionRevert,
  RevisionUndo,
} from "../../services/contracts/api.generated.ts";
import { isUuid } from "../../services/validation.ts";
import { sameDocumentDraftScope, type DocumentDraftScope } from "./documentDrafts.ts";

export type RevisionCommandRequest =
  | { operation: "create"; input: RevisionCreate }
  | { operation: "proposal"; candidateId: string; input: RevisionProposal }
  | { operation: "decide"; candidateId: string; input: RevisionDecide }
  | { operation: "apply"; candidateId: string; input: RevisionApply }
  | { operation: "cancel"; candidateId: string; input: RevisionCancel }
  | { operation: "undo"; candidateId: string; applicationCommandId: string; input: RevisionUndo }
  | { operation: "revert"; input: RevisionRevert };

export interface StoredRevisionCommand extends DocumentDraftScope {
  id: string;
  request: RevisionCommandRequest;
  fingerprint: string;
  createdAt: string;
}

export interface RevisionCommandRepository {
  list(scope: DocumentDraftScope): Promise<StoredRevisionCommand[]>;
  add(command: StoredRevisionCommand): Promise<void>;
  remove(command: StoredRevisionCommand): Promise<void>;
}

const databaseName = "thesis-pilot-revision-commands";
const storeName = "commands";
const scopeIndex = "document";
const scopeFields = ["sourceKey", "projectId", "localProjectId", "documentId"] as const;

export function stableRevisionJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableRevisionJson).join(",") + "]";
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const sorted = Object.entries(value).sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1));
  return "{" + sorted.map(([key, child]) => JSON.stringify(key) + ":" + stableRevisionJson(child)).join(",") + "}";
}

async function fingerprint(scope: DocumentDraftScope, request: RevisionCommandRequest): Promise<string> {
  const data = new TextEncoder().encode(stableRevisionJson([scopeFields.map((field) => scope[field]), request]));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function prepareRevisionCommand(scope: DocumentDraftScope, request: RevisionCommandRequest): Promise<StoredRevisionCommand> {
  const fixed = structuredClone(request);
  return {
    ...scope,
    id: fixed.input.command_id,
    request: fixed,
    fingerprint: await fingerprint(scope, fixed),
    createdAt: new Date().toISOString(),
  };
}

export async function validateStoredRevisionCommand(scope: DocumentDraftScope, record: StoredRevisionCommand): Promise<void> {
  const request = record?.request;
  if (
    !request ||
    !sameDocumentDraftScope(scope, record) ||
    !isUuid(record.id) ||
    record.id !== request.input?.command_id ||
    !["create", "proposal", "decide", "apply", "cancel", "undo", "revert"].includes(request.operation) ||
    ("candidateId" in request && !isUuid(request.candidateId)) ||
    ("applicationCommandId" in request && !isUuid(request.applicationCommandId)) ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    record.fingerprint !== (await fingerprint(scope, request))
  ) {
    throw new Error("待确认修订命令的本机记录无效。");
  }
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("修订命令存储事务已中止。"));
  });
}

export function createRevisionCommandRepository(factory?: IDBFactory): RevisionCommandRepository {
  let database: Promise<IDBDatabase> | undefined;

  function connect(): Promise<IDBDatabase> {
    if (database) return database;
    const indexedDatabase = factory ?? globalThis.indexedDB;
    if (!indexedDatabase) return Promise.reject(new Error("当前环境无法使用修订命令存储。"));
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDatabase.open(databaseName, 1);
      let blocked = false;
      request.onblocked = () => {
        blocked = true;
        reject(new Error("其他窗口正在使用旧修订命令存储。"));
      };
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(storeName, { keyPath: [...scopeFields, "id"] });
        store.createIndex(scopeIndex, [...scopeFields]);
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
      const commands: StoredRevisionCommand[] = request.result;
      return commands;
    },
    async add(command) {
      const transaction = (await connect()).transaction(storeName, "readwrite");
      transaction.objectStore(storeName).add(command);
      await transactionComplete(transaction);
    },
    async remove(command) {
      const transaction = (await connect()).transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete([...scopeFields.map((field) => command[field]), command.id]);
      await transactionComplete(transaction);
    },
  };
}

export const browserRevisionCommands = createRevisionCommandRepository();
