/** Only unconfirmed idempotency identifiers live here; no token, body or project data. */
const pending = new Map<string, string>();
const scope = (sourceKey: string, projectId: string) => JSON.stringify([sourceKey, projectId]);

export function pendingDiagnosticKey(sourceKey: string, projectId: string): string | undefined {
  return pending.get(scope(sourceKey, projectId));
}

export function beginDiagnosticRequest(sourceKey: string, projectId: string): string {
  const key = scope(sourceKey, projectId);
  const existing = pending.get(key);
  if (existing) return existing;
  const generated = crypto.randomUUID();
  pending.set(key, generated);
  return generated;
}

export function confirmDiagnosticRequest(sourceKey: string, projectId: string, requestKey: string): void {
  const key = scope(sourceKey, projectId);
  if (pending.get(key) === requestKey) pending.delete(key);
}
