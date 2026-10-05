import { describe, expect, it } from 'vitest';
import { BOT_BODY_MAX, TRIMMED_MARKER, trimBotBodies, trimBotBody } from './bot-bodies.ts';
import { isMachineComment } from './bots.ts';
import { deriveEvents, editMentionOf, machineCommentTwinId } from './events.ts';
import { at, makeComment, makePr, makeReview, makeThread, viewer } from './fixtures.ts';
import { mergeQueueState } from './merge-queue.ts';
import type { Comment, Pr } from './types.ts';

const BOT = 'coderabbitai[bot]';

/** A body of `length` code units: a first line, then filler lines. */
function longBody(length: number, firstLine = 'Walkthrough of the change'): string {
  const filler = '\n- one more line of review notes';
  return `${firstLine}${filler.repeat(Math.ceil(length / filler.length))}`.slice(0, length);
}

function cut(body: string, author = BOT, editor: string | null = null): string {
  return trimBotBody({ author, body, editor });
}

describe('trimBotBody', () => {
  it('keeps the first 3,000 code units the reply draft reads, and stays within the limit with the marker', () => {
    const body = longBody(BOT_BODY_MAX * 4);
    const trimmed = cut(body);
    expect(trimmed.length).toBeLessThanOrEqual(BOT_BODY_MAX);
    expect(trimmed.endsWith(TRIMMED_MARKER)).toBe(true);
    const kept = trimmed.slice(0, -TRIMMED_MARKER.length);
    expect(kept.length).toBeGreaterThanOrEqual(3000);
    expect(body.startsWith(kept)).toBe(true);
  });

  it('leaves a bot body that fits alone', () => {
    const body = longBody(BOT_BODY_MAX);
    expect(cut(body)).toBe(body);
  });

  it('cuts any bot account: app accounts and automation on user accounts', () => {
    const body = longBody(BOT_BODY_MAX + 1);
    for (const author of ['github-actions[bot]', 'github-actions', 'posthog', 'stamphog', 'acme-bot']) {
      expect(cut(body, author).endsWith(TRIMMED_MARKER)).toBe(true);
    }
  });

  it('keeps a person’s body whole, however long, with its bot marker at the end', () => {
    const body = `${longBody(BOT_BODY_MAX * 2)}\n\nThis is an automated message`;
    expect(cut(body, 'alice')).toBe(body);
    expect(isMachineComment({ author: 'alice', body: cut(body, 'alice') })).toBe(true);
  });

  it('keeps a deleted author’s body whole: they may have been a person', () => {
    const body = longBody(BOT_BODY_MAX * 2);
    expect(cut(body, '')).toBe(body);
  });

  it('keeps a merge queue bot’s body whole: the queue state reads markers anywhere in it', () => {
    const body = longBody(BOT_BODY_MAX * 2);
    expect(cut(body, 'trunk-io[bot]')).toBe(body);
    expect(cut(body, 'mergify[bot]')).toBe(body);
  });

  it('keeps a bot body a person edited last whole, and cuts one the bot itself or another bot edited', () => {
    const body = longBody(BOT_BODY_MAX * 2);
    expect(cut(body, BOT, 'alice')).toBe(body);
    expect(cut(body, BOT, BOT)).not.toBe(body);
    expect(cut(body, BOT, 'github-actions[bot]')).not.toBe(body);
  });

  it('changes nothing when cut twice', () => {
    const once = cut(longBody(BOT_BODY_MAX * 3));
    expect(cut(once)).toBe(once);
  });

  it('cuts before an HTML comment the limit would leave open', () => {
    const head = '<!-- summary start -->\nWalkthrough\n';
    const body = `${head}<!-- internal state start\n${'x'.repeat(BOT_BODY_MAX * 2)}\ninternal state end -->\nmore`;
    expect(cut(body)).toBe(`${head}${TRIMMED_MARKER}`);
  });

  it('keeps HTML comments that close before the limit', () => {
    const body = `<!-- a -->\nWalkthrough\n<!-- b -->\n${'y'.repeat(BOT_BODY_MAX * 2)}`;
    const trimmed = cut(body);
    expect(trimmed.startsWith('<!-- a -->\nWalkthrough\n<!-- b -->\nyyy')).toBe(true);
    expect(trimmed.length).toBe(BOT_BODY_MAX);
  });

  it('reads an opener inside a comment as comment text, like the rules do', () => {
    // The first <!-- is the one that stays open: an inner one changes nothing.
    const body = `Walkthrough\n<!-- outer <!-- inner\n${'z'.repeat(BOT_BODY_MAX * 2)} -->`;
    expect(cut(body)).toBe(`Walkthrough\n${TRIMMED_MARKER}`);
  });

  it('never splits a character in two', () => {
    const end = BOT_BODY_MAX - TRIMMED_MARKER.length;
    // The emoji's first half sits right before the cut.
    const body = `${'a'.repeat(end - 1)}😀${'b'.repeat(BOT_BODY_MAX)}`;
    const trimmed = cut(body);
    expect(trimmed).toBe(`${'a'.repeat(end - 1)}${TRIMMED_MARKER}`);
    expect(trimmed.isWellFormed()).toBe(true);
  });
});

describe('trimBotBodies', () => {
  const long = longBody(BOT_BODY_MAX * 2);

  it('cuts every stored copy of a bot body: comments, review thread comments and reviews', () => {
    const inline = makeComment({ id: 'rc1', author: BOT, body: long });
    const pr = makePr({
      body: long,
      comments: [
        makeComment({ id: 'c1', author: BOT, body: long }),
        makeComment({ id: 'c2', author: 'alice', body: long }),
        makeComment({ id: 'r1', kind: 'review', author: BOT, body: long }),
        { ...inline, kind: 'review_comment', threadId: 't1', path: 'a.ts' },
      ],
      threads: [makeThread('t1', [inline])],
      reviews: [makeReview({ id: 'r1', author: BOT, state: 'COMMENTED', body: long }), makeReview({ id: 'r2', author: 'alice', state: 'COMMENTED', body: long })],
    });
    const trimmed = trimBotBodies(pr);
    const short = cut(long);
    expect(trimmed.comments.map((comment) => comment.body)).toEqual([short, long, short, short]);
    expect(trimmed.threads[0]!.comments[0]!.body).toBe(short);
    expect(trimmed.reviews.map((review) => review.body)).toEqual([short, long]);
    expect(trimmed.body).toBe(long);
    // The rest of the snapshot stays as it was.
    expect({ ...trimmed, comments: [], threads: [], reviews: [] }).toEqual({ ...pr, comments: [], threads: [], reviews: [] });
  });

  it('keeps both copies of a bot review a person edited last whole: the review takes the editor of its comment copy', () => {
    const pr = makePr({
      comments: [makeComment({ id: 'r1', kind: 'review', author: BOT, body: long, editor: 'alice', lastEditedAt: at(30) })],
      reviews: [makeReview({ id: 'r1', author: BOT, state: 'COMMENTED', body: long })],
    });
    expect(trimBotBodies(pr)).toBe(pr);
  });

  it('returns the same snapshot when nothing is cut', () => {
    const pr = makePr({ comments: [makeComment({ author: BOT, body: 'short' }), makeComment({ id: 'c2', author: 'alice', body: long })] });
    expect(trimBotBodies(pr)).toBe(pr);
  });
});

/**
 * What the rules make of a PR, without the first-line summaries. Not the
 * team chip: a team named only past the cut of a bot comment no longer
 * picks which of the viewer's teams it names (DESIGN.md "Bot bodies are cut when saved").
 */
function ruleOutput(pr: Pr) {
  return {
    events: deriveEvents(pr, viewer, null).map((event) => [event.id, event.kind, event.ruleLoudness, event.ruleReason, event.isBot]),
    edits: pr.comments.map((comment) => editMentionOf({ kind: 'comment_edited', sourceId: comment.id }, pr, viewer)),
    queue: mergeQueueState(pr),
  };
}

describe('the rules read a cut snapshot like the stored one', () => {
  const filler = longBody(BOT_BODY_MAX * 2);
  const comments: Comment[] = [
    // "deploy" only past the cut, and before it.
    makeComment({ id: 'late-deploy', author: 'github-actions[bot]', body: `${filler}\nPreview deployed`, createdAt: at(1) }),
    makeComment({ id: 'early-deploy', author: 'vercel[bot]', body: `Preview deployed\n${filler}`, createdAt: at(2) }),
    // A person edited a bot's comment and mentions the viewer past the cut; another bot's edit does not count.
    makeComment({ id: 'human-edit', author: BOT, editor: 'alice', body: `${filler}\ncc @viewer`, createdAt: at(3), lastEditedAt: at(40) }),
    makeComment({ id: 'bot-edit', author: BOT, editor: 'github-actions[bot]', body: `${filler}\ncc @viewer`, createdAt: at(4), lastEditedAt: at(41) }),
    // Trunk's test report: its marker past the cut would make it a status comment.
    makeComment({ id: 'trunk-report', author: 'trunk-io[bot]', body: `${filler}\n<!-- Trunk Test Analytics -->`, createdAt: at(6), lastEditedAt: at(50) }),
    makeComment({ id: 'trunk-status', author: 'trunk-io[bot]', body: '<!-- Trunk Merge -->\n🧪 Running tests on this pull request - [details](https://trunk.example/q/4).', createdAt: at(7) }),
    // A long leading HTML block pushes the first visible line past the cut.
    makeComment({ id: 'hidden-first-line', author: BOT, body: `<!-- state\n${filler}\n-->\nThe summary line`, createdAt: at(8) }),
  ];
  const pr = makePr({ author: 'viewer', comments, reviews: [makeReview({ id: 'rv', author: BOT, state: 'COMMENTED', body: `${filler}\n@viewer`, submittedAt: at(9) })] });

  it('derives the same events (ids, kinds, loudness, reasons), edit mentions and merge queue state', () => {
    const trimmed = trimBotBodies(pr);
    expect(trimmed).not.toBe(pr);
    expect(ruleOutput(trimmed)).toEqual(ruleOutput(pr));
  });

  it('changes only first-line summaries, and only where an HTML block hides the first line past the cut', () => {
    const before = new Map(deriveEvents(pr, viewer, null).map((event) => [event.id, event.summary]));
    const changed = deriveEvents(trimBotBodies(pr), viewer, null).filter((event) => before.get(event.id) !== event.summary);
    expect(changed.map((event) => event.sourceId)).toEqual(['hidden-first-line']);
  });

  it('gives the marker nothing to match: no deploy, no mention, no question', () => {
    const kindOf = (body: string, author: string) => deriveEvents(makePr({ comments: [makeComment({ id: 'm', author, body })] }), viewer, null)[0]?.kind;
    expect(kindOf(TRIMMED_MARKER, BOT)).toBe('bot_comment');
    expect(isMachineComment({ author: 'alice', body: TRIMMED_MARKER })).toBe(false);
    expect(kindOf(`hello${TRIMMED_MARKER}`, 'alice')).toBe('comment');
  });
});

describe('machineCommentTwinId', () => {
  it('gives a machine comment event id under its other kind, and nothing for other events', () => {
    expect(machineCommentTwinId('acme/app#1:deploy:IC_1')).toBe('acme/app#1:bot_comment:IC_1');
    expect(machineCommentTwinId('acme/app#1:bot_comment:IC_1')).toBe('acme/app#1:deploy:IC_1');
    expect(machineCommentTwinId('acme/app#1:comment:IC_1')).toBeNull();
    expect(machineCommentTwinId('acme/app#1:comment_edited:IC_1@2026-09-01T10:00:00.000Z')).toBeNull();
    expect(machineCommentTwinId('not-an-event-id')).toBeNull();
  });
});
