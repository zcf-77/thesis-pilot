/** Type boundary for the dependency-free Node generator used by contract tests. */
export function generateContract(document: unknown): string;

export function synchronizeContract(options: { input: string; output: string; check?: boolean }): string;
