// The rules on one PR against the spec (testing/invariants-rules.ts): the
// answer is worked out from the raw snapshot, never by the rule under test.
// POSTPILE_PROPERTY_RUNS=10000 pnpm test runs more boards per invariant.
import { describe, expect, it } from 'vitest';
import { buildBoard, checkBoards, PROPERTY_TIMEOUT_MS, QUIET_PR, RULE_INVARIANTS, tileViewsOf, UNSORTED_TOPIC, type BoardSpec } from '../testing/index.ts';

describe('rule invariants', () => {
  for (const invariant of RULE_INVARIANTS) {
    it(invariant.name, () => checkBoards(invariant), PROPERTY_TIMEOUT_MS);
  }
});

describe('for whom, scenarios the properties found', () => {
  /** A bot's PR: you asked for changes, then the bot commented "@codex review". */
  const botCommandBoard: BoardSpec = {
    groups: [
      {
        kind: 'single',
        prs: [
          {
            ...QUIET_PR,
            author: 'app',
            steps: [
              { kind: 'review', by: 'viewer', state: 'CHANGES_REQUESTED', body: null },
              { kind: 'comment', by: 'app', text: 'bot_command', thread: null, review: null },
            ],
            tracking: { kind: 'thread', reason: 'comment', readAfter: 0 },
          },
        ],
        snooze: null,
      },
    ],
    writesLocked: false,
    teams: 'one_home',
    teamMembersUnknown: false,
    nowGap: 60,
    topic: UNSORTED_TOPIC,
  };

  // Found 2026-10-07 by "the for-whom chip of each PR and tile is the spec
  // chip": the spec read the bot's body as a bot command (no answer), the
  // board leaves bot bodies out and core counted it as the owner's reply.
  // Decided: a bot's own comment is never talk to a bot, so it answers.
  it('a bot owner’s comment after your changes request is its answer, for you', () => {
    const board = buildBoard(botCommandBoard);
    const views = tileViewsOf(board);
    const invariant = RULE_INVARIANTS.find((item) => item.name.startsWith('the for-whom chip'))!;
    invariant.check(board, views);
    expect(views[0]!.prs[0]!.forWhom).toEqual({ kind: 'you' });
  });
});
