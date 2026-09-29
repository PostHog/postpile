import { createHash } from 'node:crypto';
import type { Viewer } from './types.ts';

// The pseudonymous identity every telemetry event carries. Never the GitHub
// login, name or email: a one-way hash of the numeric GitHub user id, which
// nobody outside PostHog and the person themself can turn back into an
// account. Versioned so the scheme can change later without colliding with
// old ids.
const IDENTITY_PREFIX = 'postpile:v1:';

/** sha256("postpile:v1:" + <GitHub numeric user id>), hex. Stable across reinstalls and machines. */
export function hashedTelemetryId(githubDatabaseId: number): string {
  return createHash('sha256').update(`${IDENTITY_PREFIX}${githubDatabaseId}`).digest('hex');
}

/** True when any of the viewer's teams is in the PostHog org ("PostHog/..."). One of the person's $set properties. */
export function isPostHogMember(viewer: Pick<Viewer, 'teams'>): boolean {
  return viewer.teams.some((team) => team.split('/')[0]?.toLowerCase() === 'posthog');
}
