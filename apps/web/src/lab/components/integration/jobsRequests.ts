/** Keep only unconfirmed idempotency identifiers across reloads of the same tab. */
const pending = new Map<string, string>();
const diagnosticScope = (sourceKey: string, projectId: string) => "thesispilot.pending-diagnostic:" + JSON.stringify([sourceKey, projectId]);
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

function tabStorage() {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function pendingKey(key: string): string | undefined {
  const current = pending.get(key);
  if (current) return current;
  try {
    const stored = tabStorage()?.getItem(key);
    if (stored && uuid.test(stored)) {
      pending.set(key, stored);
      return stored;
    }
  } catch {
    // Tab storage can be disabled independently of the workspace.
  }
  return undefined;
}

export function beginJobRequest(key: string): string {
  const existing = pendingKey(key);
  if (existing) return existing;
  const generated = crypto.randomUUID();
  pending.set(key, generated);
  try {
    tabStorage()?.setItem(key, generated);
  } catch {
    // The live tab can still reconcile the request with the in-memory key.
  }
  return generated;
}

export function confirmJobRequest(key: string, requestKey: string): void {
  if (pendingKey(key) !== requestKey) return;
  pending.delete(key);
  try {
    tabStorage()?.removeItem(key);
  } catch {
    // A stale key can only replay an already-confirmed request.
  }
}

export const pendingDiagnosticKey = (sourceKey: string, projectId: string) => pendingKey(diagnosticScope(sourceKey, projectId));
export const beginDiagnosticRequest = (sourceKey: string, projectId: string) => beginJobRequest(diagnosticScope(sourceKey, projectId));
export const confirmDiagnosticRequest = (sourceKey: string, projectId: string, requestKey: string) =>
  confirmJobRequest(diagnosticScope(sourceKey, projectId), requestKey);
