// How many boards each property checks. POSTPILE_PROPERTY_RUNS=10000 cranks
// it up for a deep run; the default keeps `pnpm test` quick.

/** Boards per property when POSTPILE_PROPERTY_RUNS is not set. */
export const DEFAULT_PROPERTY_RUNS = 2000;

/** Per-property test timeout: generous, since POSTPILE_PROPERTY_RUNS can ask for many boards. */
export const PROPERTY_TIMEOUT_MS = 10 * 60_000;

/** Node's environment, read through globalThis so the renderer's typecheck (no Node types) accepts this file. */
function envVar(name: string): string | undefined {
  const host = globalThis as { process?: { env: Record<string, string | undefined> } };
  return host.process?.env[name];
}

export function propertyRuns(): number {
  const runs = Number(envVar('POSTPILE_PROPERTY_RUNS'));
  return Number.isInteger(runs) && runs > 0 ? runs : DEFAULT_PROPERTY_RUNS;
}
