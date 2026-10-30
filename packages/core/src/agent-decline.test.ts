import { describe, expect, it } from 'vitest';
import { agentDecline, agentDeclineView, agentVerdictView, DECLINE_REASON_MAX, hasTrimmedAgentVerdict } from './agent-decline.ts';
import { TRIMMED_MARKER } from './bot-bodies.ts';
import { at, makeComment, makePr, makeReview } from './fixtures.ts';
import type { FullPr, FullReview } from './types.ts';

const BOT = 'stamphog[bot]';
const READD = 'Re-add the `stamphog` label to request another review once you have addressed this.';

function gateTable(rows: string[]): string {
  return ['<details><summary>Gate mechanics and policy version</summary>', '', '| gate | result | detail |', '| --- | --- | --- |', ...rows, '', '</details>'].join('\n');
}

const NEEDS_PERSON = [
  '**Not approved — this change needs a human reviewer.**',
  '',
  READD,
  '',
  'It changes the **billing** schema.',
  '- please ask @acme/team-billing',
  '',
  gateTable(['| prerequisites | ✓ | ok |', '| size | ✓ | small |']),
].join('\n');

const ESCALATED = ['**Not approved — escalated to a human reviewer.**', '', READD, '', 'The migration drops a column.'].join('\n');

function waiting(rows: string[]): string {
  return ['**Not approved yet — waiting on the conditions below.**', '', READD, '', 'Fix these first.', '', gateTable(rows)].join('\n');
}

const APPROVED = '**Approved.**\n\nSmall and covered by tests.';

/** A stamphog verdict review, its body also stored as a review comment like the reader does. */
function verdict(id: string, body: string, hour: number, state: FullReview['state'] = 'COMMENTED', commitOid = 'head'): { review: FullReview; comment: ReturnType<typeof makeComment> } {
  return {
    review: makeReview({ id, author: BOT, state, body, submittedAt: at(hour), commitOid }),
    comment: makeComment({ id, author: BOT, body, kind: 'review', createdAt: at(hour) }),
  };
}

function prWith(verdicts: ReturnType<typeof verdict>[], overrides: Partial<FullPr> = {}): FullPr {
  return makePr({
    headOid: 'head',
    reviewDecision: 'REVIEW_REQUIRED',
    reviews: verdicts.map((v) => v.review),
    comments: verdicts.map((v) => v.comment),
    ...overrides,
  });
}

describe('agentDecline', () => {
  it('reads a "needs a human reviewer" verdict with its reasons', () => {
    const decline = agentDecline(prWith([verdict('r1', NEEDS_PERSON, 5)]));
    expect(decline).toEqual({
      agent: 'stamphog',
      kind: 'needs_person',
      reason: 'It changes the billing schema. - please ask @acme/team-billing',
      at: at(5),
      commitOid: 'head',
    });
  });

  it('reads an escalation', () => {
    expect(agentDecline(prWith([verdict('r1', ESCALATED, 5)]))?.kind).toBe('escalated');
  });

  it('tolerates small wording changes after the "Not approved" prefix', () => {
    const body = `**Not approved: a person should look at this.**\n\n${READD}\n\nToo broad.`;
    expect(agentDecline(prWith([verdict('r1', body, 5)]))).toMatchObject({ kind: 'needs_person', reason: 'Too broad.' });
  });

  it('takes the prose after the bold line when the re-add line is missing', () => {
    const body = '**Not approved — this change needs a human reviewer.**\n\nTouches auth.';
    expect(agentDecline(prWith([verdict('r1', body, 5)]))?.reason).toBe('Touches auth.');
  });

  it('treats "not approved yet" with only prerequisites failing as waiting, not a decline', () => {
    const body = waiting(['| prerequisites | ✗ | merge conflicts present |', '| deny-list | ✓ | none |']);
    expect(agentDecline(prWith([verdict('r1', body, 5)]))).toBeNull();
  });

  it('treats "not approved yet" with another failed gate as a gates decline', () => {
    const body = waiting(['| prerequisites | ✗ | merge conflicts present |', '| size | ✗ | too large: 900 lines |']);
    expect(agentDecline(prWith([verdict('r1', body, 5)]))).toMatchObject({ kind: 'gates', reason: 'Fix these first.' });
  });

  it('only counts the latest verdict: a later approval cancels a decline, also once a push dismissed it', () => {
    const declined = verdict('r1', NEEDS_PERSON, 5);
    expect(agentDecline(prWith([declined, verdict('r2', APPROVED, 6, 'APPROVED')]))).toBeNull();
    expect(agentDecline(prWith([declined, verdict('r2', APPROVED, 6, 'DISMISSED')]))).toBeNull();
    expect(agentDecline(prWith([verdict('r0', APPROVED, 4, 'DISMISSED'), declined]))?.kind).toBe('needs_person');
  });

  it('a later waiting verdict replaces an earlier decline', () => {
    const later = waiting(['| prerequisites | ✗ | changes requested |']);
    expect(agentDecline(prWith([verdict('r1', NEEDS_PERSON, 5), verdict('r2', later, 6)]))).toBeNull();
  });

  it('ignores plain stamphog comments and reviews that are no verdict', () => {
    const status = makeComment({ id: 'c9', author: BOT, body: '<!-- stamphog:review-status -->\nReviewing…', createdAt: at(7) });
    const pr = prWith([verdict('r1', NEEDS_PERSON, 5), verdict('r2', 'Looking at it.', 6)]);
    expect(agentDecline({ ...pr, comments: [...pr.comments, status] })?.kind).toBe('needs_person');
  });

  it('trusts only the exact stamphog[bot] login', () => {
    const fake = verdict('r1', NEEDS_PERSON, 5);
    const pr = prWith([{ review: { ...fake.review, author: 'stamphog' }, comment: { ...fake.comment, author: 'stamphog' } }]);
    expect(agentDecline(pr)).toBeNull();
  });

  it('reads the body from the review comment when the review carries none', () => {
    const v = verdict('r1', ESCALATED, 5);
    expect(agentDecline(prWith([{ review: { ...v.review, body: null as unknown as string }, comment: v.comment }]))?.kind).toBe('escalated');
  });

  it('is null on merged and closed PRs and once a person approved', () => {
    const declined = [verdict('r1', NEEDS_PERSON, 5)];
    expect(agentDecline(prWith(declined, { state: 'MERGED' }))).toBeNull();
    expect(agentDecline(prWith(declined, { state: 'CLOSED' }))).toBeNull();
    const pr = prWith(declined);
    expect(agentDecline({ ...pr, reviews: [...pr.reviews, makeReview({ id: 'r2', author: 'alice', submittedAt: at(6) })] })).toBeNull();
  });

  it('drops the gate details and HTML comments, collapses whitespace and clips the reason', () => {
    const long = `**Not approved — escalated to a human reviewer.**\n${READD}\n<!-- hidden -->\n${'word '.repeat(200)}\n${gateTable(['| size | ✗ | big |'])}`;
    const reason = agentDecline(prWith([verdict('r1', long, 5)]))!.reason;
    expect(reason.length).toBeLessThanOrEqual(DECLINE_REASON_MAX);
    expect(reason.endsWith('…')).toBe(true);
    expect(reason).not.toMatch(/hidden|gate|\s{2}/);
  });
});

describe('a verdict cut on save', () => {
  const head = '**Not approved yet — waiting on the conditions below.**\n\n' + READD + '\n\nFix these first.';

  it('is unknown, not waiting: no decline, and no earlier decline either', () => {
    const cut = `${head}${TRIMMED_MARKER}`;
    expect(agentDecline(prWith([verdict('r1', cut, 5)]))).toBeNull();
    expect(agentDecline(prWith([verdict('r1', NEEDS_PERSON, 4), verdict('r2', cut, 5)]))).toBeNull();
  });

  it('is a gates decline when what is left already shows a failed gate, without the marker in the reason', () => {
    const cut = `${head}\n\n<details><summary>Gate mechanics</summary>\n\n| gate | result | detail |\n| size | ✗ | too large |${TRIMMED_MARKER}`;
    expect(agentDecline(prWith([verdict('r1', cut, 5)]))).toMatchObject({ kind: 'gates', reason: 'Fix these first.' });
    const prose = `**Not approved — escalated to a human reviewer.**\n\n${READD}\n\nThe migration drops${TRIMMED_MARKER}`;
    expect(agentDecline(prWith([verdict('r1', prose, 5)]))?.reason).toBe('The migration drops');
  });

  it('asks for a refetch only on open PRs with a cut stamphog verdict', () => {
    const cut = [verdict('r1', `${head}${TRIMMED_MARKER}`, 5)];
    expect(hasTrimmedAgentVerdict(prWith(cut))).toBe(true);
    expect(hasTrimmedAgentVerdict(prWith(cut, { state: 'MERGED' }))).toBe(false);
    expect(hasTrimmedAgentVerdict(prWith([verdict('r1', head, 5)]))).toBe(false);
  });
});

describe('agentDeclineView', () => {
  it('says when the verdict was made on an earlier commit', () => {
    expect(agentDeclineView(prWith([verdict('r1', NEEDS_PERSON, 5, 'COMMENTED', 'old')]))?.earlierCommit).toBe(true);
    expect(agentDeclineView(prWith([verdict('r1', NEEDS_PERSON, 5)]))?.earlierCommit).toBe(false);
    expect(agentDeclineView(prWith([]))).toBeNull();
  });
});

describe('agentVerdictView', () => {
  const GATES = waiting(['| prerequisites | ✗ | merge conflicts present |', '| size | ✗ | too large |', '| tier | ✓ | low |']);
  const PERSON = makeReview({ id: 'p1', author: 'carol', state: 'APPROVED', submittedAt: at(6) });

  it('names the failed gates of a decline, prerequisites included', () => {
    expect(agentVerdictView(prWith([verdict('r1', GATES, 5)]))).toEqual({
      agent: 'stamphog',
      verdict: 'declined',
      declineKind: 'gates',
      failedGates: ['prerequisites', 'size'],
      reason: 'Fix these first.',
      at: at(5),
      olderHead: false,
      nobodyAsked: true,
    });
  });

  it('is stuck only while no person or team is asked; a pending bot does not count', () => {
    expect(agentVerdictView(prWith([verdict('r1', NEEDS_PERSON, 5)], { reviewerUsers: ['reviewbot[bot]'] }))?.nobodyAsked).toBe(true);
    expect(agentVerdictView(prWith([verdict('r1', NEEDS_PERSON, 5)], { reviewerUsers: ['carol'] }))?.nobodyAsked).toBe(false);
    expect(agentVerdictView(prWith([verdict('r1', NEEDS_PERSON, 5)], { reviewerTeams: ['acme/team-platform'] }))?.nobodyAsked).toBe(false);
  });

  it('is not stuck once a person asked for changes: the author has their changes to address', () => {
    const decline = verdict('r1', NEEDS_PERSON, 5);
    const changes = makeReview({ id: 'p1', author: 'carol', state: 'CHANGES_REQUESTED', submittedAt: at(6) });
    expect(agentVerdictView(prWith([decline], { reviews: [decline.review, changes] }))?.nobodyAsked).toBe(false);
  });

  it('reads an approval, also on an older head, and keeps it after a person approved', () => {
    const approval = [verdict('r1', NEEDS_PERSON, 4), verdict('r2', APPROVED, 5, 'APPROVED', 'old')];
    expect(agentVerdictView(prWith(approval))).toMatchObject({ verdict: 'approved', declineKind: null, failedGates: [], olderHead: true, nobodyAsked: false, reason: 'Small and covered by tests.' });
    expect(agentVerdictView(prWith(approval, { reviews: [...approval.map((v) => v.review), PERSON] }))?.verdict).toBe('approved');
  });

  it('drops a decline once a person approved, like agentDecline', () => {
    const decline = verdict('r1', NEEDS_PERSON, 5);
    expect(agentVerdictView(prWith([decline], { reviews: [decline.review, PERSON] }))).toBeNull();
  });

  it('is null while it waits on prerequisites, and on merged PRs', () => {
    expect(agentVerdictView(prWith([verdict('r1', waiting(['| prerequisites | ✗ | conflicts |']), 5)]))).toBeNull();
    expect(agentVerdictView(prWith([verdict('r1', APPROVED, 5, 'APPROVED')], { state: 'MERGED' }))).toBeNull();
  });
});
