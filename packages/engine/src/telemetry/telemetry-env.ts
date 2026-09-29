// Whether telemetry is allowed to leave the process at all. Kept pure (env
// in, boolean out) so the off-switches are cheap to test without touching
// posthog-node, a file or the network.

/**
 * On by default (DESIGN.md "Usage analytics"). Off for: vitest (always, no
 * override), an explicit POSTPILE_TELEMETRY=0, DO_NOT_TRACK=1, fake mode and
 * the dev profile. POSTPILE_TELEMETRY=1 forces it on even in dev or fake
 * mode, for checking the pipeline by hand; it can never turn it on in tests.
 */
export function telemetryEnabled(env: NodeJS.ProcessEnv): boolean {
  if (env.VITEST !== undefined) {
    return false;
  }
  if (env.POSTPILE_TELEMETRY === '1') {
    return true;
  }
  if (env.POSTPILE_TELEMETRY === '0') {
    return false;
  }
  if (env.DO_NOT_TRACK === '1') {
    return false;
  }
  if (env.POSTPILE_FAKE === '1') {
    return false;
  }
  if (env.POSTPILE_PROFILE === 'dev') {
    return false;
  }
  return true;
}
