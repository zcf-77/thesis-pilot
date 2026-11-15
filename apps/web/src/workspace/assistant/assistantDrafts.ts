export interface AssistantDraftScope {
  sourceKey: string;
  workspaceId: string;
  projectId: string;
  sessionId: string;
}
export interface AssistantDraft {
  schemaVersion: 1;
  text: string;
  updatedAt: string;
}
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export function assistantDraftKey(scope: AssistantDraftScope): string {
  return "thesispilot.assistant-draft.v1:" + JSON.stringify([scope.sourceKey, scope.workspaceId, scope.projectId, scope.sessionId]);
}
export function readAssistantDraft(storage: DraftStorage, scope: AssistantDraftScope): AssistantDraft | undefined {
  const raw = storage.getItem(assistantDraftKey(scope));
  if (raw === null) return;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("本机会话草稿无法读取；不会把它当作已发送消息。");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("本机会话草稿无效。");
  const draft = value as Partial<AssistantDraft>;
  if (
    draft.schemaVersion !== 1 ||
    typeof draft.text !== "string" ||
    draft.text.length > 20000 ||
    typeof draft.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(draft.updatedAt))
  )
    throw new Error("本机会话草稿无效。");
  return { schemaVersion: 1, text: draft.text, updatedAt: draft.updatedAt };
}
export function writeAssistantDraft(storage: DraftStorage, scope: AssistantDraftScope, text: string): void {
  if (text.length > 20000) throw new Error("本机草稿最多保留 20000 个字符，请缩短输入。");
  storage.setItem(assistantDraftKey(scope), JSON.stringify({ schemaVersion: 1, text, updatedAt: new Date().toISOString() }));
}
export function clearAssistantDraftIfUnchanged(storage: DraftStorage, scope: AssistantDraftScope, sent: string): boolean {
  const current = readAssistantDraft(storage, scope);
  if (current && current.text !== sent) return false;
  storage.removeItem(assistantDraftKey(scope));
  return true;
}

export interface CapturedAssistantSelection {
  document_id: string;
  document_version: number;
  selection: { textblock_path: number[]; from: number; to: number; text: string };
}
export function selectionStillCurrent(
  captured: CapturedAssistantSelection,
  current: { documentId: string; version: number; dirty: boolean; selection?: CapturedAssistantSelection["selection"] },
): boolean {
  return (
    !current.dirty &&
    captured.document_id === current.documentId &&
    captured.document_version === current.version &&
    !!captured.selection.text.trim() &&
    !!current.selection &&
    JSON.stringify(captured.selection) === JSON.stringify(current.selection)
  );
}
export function runUpdateAllowed(
  current: { id: string; status: string; updated_at: string } | undefined,
  next: { id: string; status: string; updated_at: string },
): boolean {
  if (!current || current.id !== next.id) return true;
  const active = (status: string) => ["queued", "running"].includes(status);
  return Date.parse(next.updated_at) >= Date.parse(current.updated_at) && (active(current.status) || !active(next.status));
}
