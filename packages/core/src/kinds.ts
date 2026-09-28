import type { EventKind } from './types.ts';

// Event kind groups used by more than one rule. Defined once so the rules
// cannot drift apart.

/** A human talking to the viewer directly. */
export const ADDRESSED_KINDS: readonly EventKind[] = ['mention', 'team_mention', 'reply_to_user', 'question_to_user'];

/** New code on the PR. A push after the viewer approved is still a push. */
export const PUSH_KINDS: readonly EventKind[] = ['commits_pushed', 'commits_after_approval', 'force_pushed'];

/**
 * A human talking to the viewer personally (a team mention is not). The only
 * asks a draft turns into a move or a ping for.
 */
export const PERSONAL_ASK_KINDS: readonly EventKind[] = ['mention', 'reply_to_user', 'question_to_user'];
