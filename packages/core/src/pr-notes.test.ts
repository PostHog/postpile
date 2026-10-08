import { describe, expect, it } from 'vitest';
import { at, makeComment, makePr, makeReview, makeThread, makeTimelineItem } from './fixtures.ts';
import {
  anchorChanges,
  hasLiveNote,
  isNoteExpired,
  noteAnchor,
  noteStaleReasons,
  observationToken,
  planNoteClear,
  planNoteRenew,
  planNoteSet,
  prNotesView,
  PR_NOTES_PER_CLIENT,
  type NoteAnchor,
  type NoteSetWorld,
  type PrNote,
  type PrNoteRequest,
} from './pr-notes.ts';
import type { FullPr, PrKey } from './types.ts';

const KEY = 'acme/app#1';
const COVER = 'acme/app#2';

/** An open PR alice asked bob to review. */
function basePr(overrides: Partial<FullPr> = {}): FullPr {
  return makePr({
    number: 1,
    reviewerUsers: ['bob'],
    timeline: [makeTimelineItem({ id: 'rr-1', subject: 'bob', actor: 'alice', at: at(1) })],
    ...overrides,
  });
}

function changes(before: FullPr, after: FullPr): string[] {
  return anchorChanges(noteAnchor(before), noteAnchor(after));
}

function note(overrides: Partial<PrNote> = {}): PrNote {
  return {
    seq: 1,
    id: 'n1',
    prKey: KEY,
    slot: 'durable',
    kind: 'no_action',
    by: 'ph3 session',
    client: 'claude-code',
    note: 'nothing to do',
    coveredByPrKey: null,
    anchor: noteAnchor(basePr()),
    coverAnchor: null,
    createdAt: at(10),
    expiresAt: null,
    clearedAt: null,
    clearedBy: null,
    supersededBy: null,
    idempotencyKey: 'k1',
    ...overrides,
  };
}

function anchors(map: Record<PrKey, FullPr>): (key: PrKey) => NoteAnchor | null {
  return (key) => (map[key] ? noteAnchor(map[key]) : null);
}

describe('noteAnchor and anchorChanges', () => {
  it('stays the same when nothing relevant changed', () => {
    expect(changes(basePr(), basePr({ updatedAt: at(50), title: 'renamed' }))).toEqual([]);
  });

  it('goes stale on a review request an assigner bot adds after the note', () => {
    const after = basePr({
      reviewerUsers: ['bob', 'carol'],
      timeline: [...basePr().timeline, makeTimelineItem({ id: 'rr-2', subject: 'carol', actor: 'assigner[bot]', at: at(20) })],
    });
    expect(changes(basePr(), after)).toEqual(['review requested from carol by assigner[bot]']);
  });

  it('goes stale on a re-request of the same reviewer, and on a removed request', () => {
    const rerequested = basePr({ timeline: [...basePr().timeline, makeTimelineItem({ id: 'rr-3', subject: 'bob', actor: 'alice', at: at(30) })] });
    expect(changes(basePr(), rerequested)).toEqual(['review re-requested from bob by alice']);
    expect(changes(basePr(), basePr({ reviewerUsers: [] }))).toEqual(['review request for bob removed']);
  });

  it('ignores bot comments and edits', () => {
    const after = basePr({
      comments: [makeComment({ id: 'c-bot', author: 'coderabbitai[bot]', body: 'summary' })],
    });
    expect(changes(basePr(), after)).toEqual([]);
    const human = basePr({ comments: [makeComment({ id: 'c1', author: 'carol' })] });
    const edited = basePr({ comments: [makeComment({ id: 'c1', author: 'carol', body: 'edited', lastEditedAt: at(40), editor: 'carol' })] });
    expect(changes(human, edited)).toEqual([]);
  });

  it('names the author of a new comment in a review thread', () => {
    const reply = makeThread('t1', [makeComment({ id: 'rc-1', author: 'alice', body: '@viewer can you look again?', createdAt: at(30) })]);
    const after = basePr({ threads: [reply], comments: reply.comments });
    expect(changes(basePr(), after)).toEqual(['new comment by alice']);
  });

  it("goes stale on the user's own comment too", () => {
    expect(changes(basePr(), basePr({ comments: [makeComment({ id: 'c9', author: 'viewer' })] }))).toEqual(['new comment by viewer']);
  });

  it('says "head changed" for a new head, not a number of pushes', () => {
    expect(changes(basePr(), basePr({ headOid: 'other' }))).toEqual(['head changed']);
  });

  it('goes stale on a new review, any actor, and on a dismissed one', () => {
    const reviewed = basePr({ reviews: [makeReview({ id: 'r1', author: 'stamphog', state: 'APPROVED' })] });
    expect(changes(basePr(), reviewed)).toEqual(['new review from stamphog']);
    const dismissed = basePr({ reviews: [makeReview({ id: 'r1', author: 'stamphog', state: 'DISMISSED' })] });
    expect(changes(reviewed, dismissed)).toEqual(['review from stamphog dismissed']);
  });

  it('leaves the viewer\'s unsent review out', () => {
    expect(changes(basePr(), basePr({ reviews: [makeReview({ id: 'r9', author: 'viewer', state: 'PENDING' })] }))).toEqual([]);
  });

  it('names draft toggles and state changes', () => {
    expect(changes(basePr(), basePr({ isDraft: true }))).toEqual(['back to draft']);
    expect(changes(basePr({ isDraft: true }), basePr())).toEqual(['ready for review']);
    expect(changes(basePr(), basePr({ state: 'MERGED' }))).toEqual(['merged']);
    expect(changes(basePr(), basePr({ state: 'CLOSED' }))).toEqual(['closed']);
  });

  it('gives the same token for the same state and another one after a change', () => {
    expect(observationToken(noteAnchor(basePr()))).toBe(observationToken(noteAnchor(basePr())));
    expect(observationToken(noteAnchor(basePr({ headOid: 'x' })))).not.toBe(observationToken(noteAnchor(basePr())));
  });
});

describe('noteStaleReasons', () => {
  const cover = makePr({ number: 2 });
  const covered = note({ kind: 'covered', coveredByPrKey: COVER, coverAnchor: noteAnchor(cover) });

  it('holds while both PRs are as anchored', () => {
    expect(noteStaleReasons(covered, anchors({ [KEY]: basePr(), [COVER]: cover }))).toEqual([]);
  });

  it('goes stale when the covering PR changes, is missing, or closed without merging', () => {
    expect(noteStaleReasons(covered, anchors({ [KEY]: basePr(), [COVER]: { ...cover, headOid: 'new' } }))).toEqual([`${COVER}: head changed`]);
    expect(noteStaleReasons(covered, anchors({ [KEY]: basePr() }))).toEqual([`${COVER} is no longer stored`]);
    expect(noteStaleReasons(covered, anchors({ [KEY]: basePr(), [COVER]: { ...cover, state: 'CLOSED' } }))).toEqual([`${COVER} was closed without merging`]);
  });

  it('counts as live again when the PR returns to exactly the anchored state', () => {
    const moved = anchors({ [KEY]: basePr({ isDraft: true }) });
    expect(noteStaleReasons(note(), moved)).toEqual(['back to draft']);
    expect(noteStaleReasons(note(), anchors({ [KEY]: basePr() }))).toEqual([]);
  });
});

describe('prNotesView', () => {
  const read = (now: string) => ({ now, anchorOf: anchors({ [KEY]: basePr() }), fetchedAtOf: () => at(0) });

  it('ends a lease at expires_at exactly', () => {
    const lease = note({ id: 'l1', slot: 'lease', kind: 'in_progress', expiresAt: at(60) });
    expect(isNoteExpired(lease, at(59))).toBe(false);
    expect(isNoteExpired(lease, at(60))).toBe(true);
    expect(prNotesView(KEY, 't', [lease], read(at(60))).lease?.status).toBe('expired');
    expect(hasLiveNote(prNotesView(KEY, 't', [lease], read(at(59))))).toBe(true);
  });

  it('keeps a lease apart from the durable note and shows the newest replaced one', () => {
    const old = note({ seq: 1, id: 'n1', supersededBy: 'n2' });
    const current = note({ seq: 2, id: 'n2', note: 'still nothing' });
    const lease = note({ seq: 3, id: 'l1', slot: 'lease', kind: 'in_progress', expiresAt: at(120) });
    const view = prNotesView(KEY, 't', [lease, current, old], read(at(20)));
    expect(view.durable?.id).toBe('n2');
    expect(view.lease?.id).toBe('l1');
    expect(view.replaced?.id).toBe('n1');
  });

  it('shows a stale note with its reasons, and a cleared one not at all', () => {
    const stale = prNotesView(KEY, 't', [note()], { ...read(at(20)), anchorOf: anchors({ [KEY]: basePr({ headOid: 'x' }) }) });
    expect(stale.durable).toMatchObject({ status: 'stale', staleReasons: ['head changed'] });
    expect(hasLiveNote(stale)).toBe(false);
    expect(prNotesView(KEY, 't', [note({ clearedAt: at(15), clearedBy: 'user' })], read(at(20))).durable).toBeNull();
  });
});

describe('planNoteSet', () => {
  const token = observationToken(noteAnchor(basePr()));
  const request: Extract<PrNoteRequest, { action: 'set' }> = {
    action: 'set',
    prKey: KEY,
    kind: 'no_action',
    note: '  nothing to do\nhere ',
    by: 'ph3 session',
    token,
    coveredByPrKey: null,
    coverToken: null,
    leaseMinutes: null,
  };

  function world(overrides: Partial<NoteSetWorld> = {}): NoteSetWorld {
    return {
      now: at(20),
      client: 'claude-code',
      anchorOf: anchors({ [KEY]: basePr(), [COVER]: makePr({ number: 2 }), 'acme/other#3': makePr({ number: 3, repo: 'acme/other' }) }),
      currentIn: () => null,
      sameRequest: null,
      liveCount: { client: 0, total: 0 },
      newId: () => 'n-new',
      ...overrides,
    };
  }

  it('inserts an anchored note with folded whitespace', () => {
    const plan = planNoteSet(request, world());
    expect(plan.kind).toBe('insert');
    if (plan.kind === 'insert') {
      expect(plan.note).toMatchObject({ id: 'n-new', slot: 'durable', note: 'nothing to do here', expiresAt: null, anchor: noteAnchor(basePr()) });
    }
  });

  it('refuses a token from another state of the PR', () => {
    const plan = planNoteSet(request, world({ anchorOf: anchors({ [KEY]: basePr({ headOid: 'pushed' }) }) }));
    expect(plan).toEqual({ kind: 'refused', reason: expect.stringContaining('the PR changed since you read it') });
  });

  it('answers a retried request with the note it wrote', () => {
    const written = note({ idempotencyKey: 'same' });
    expect(planNoteSet(request, world({ sameRequest: written }))).toEqual({ kind: 'unchanged', note: written });
  });

  it('checks covered_by: required, not itself, same repo, stored, not closed, matching cover token', () => {
    const covered = { ...request, kind: 'covered' as const };
    expect(planNoteSet(covered, world())).toMatchObject({ kind: 'refused', reason: expect.stringContaining('needs covered_by') });
    expect(planNoteSet({ ...covered, coveredByPrKey: KEY }, world())).toMatchObject({ reason: 'a PR cannot cover itself' });
    expect(planNoteSet({ ...covered, coveredByPrKey: 'acme/other#3' }, world())).toMatchObject({ reason: expect.stringContaining('same repo') });
    expect(planNoteSet({ ...covered, coveredByPrKey: 'acme/app#9' }, world())).toMatchObject({ reason: expect.stringContaining('does not store') });
    const closed = world({ anchorOf: anchors({ [KEY]: basePr(), [COVER]: makePr({ number: 2, state: 'CLOSED' }) }) });
    expect(planNoteSet({ ...covered, coveredByPrKey: COVER }, closed)).toMatchObject({ reason: expect.stringContaining('closed without merging') });
    expect(planNoteSet({ ...covered, coveredByPrKey: COVER, coverToken: 'old' }, world())).toMatchObject({ reason: expect.stringContaining(`${COVER} changed`) });
    const ok = planNoteSet({ ...covered, coveredByPrKey: COVER }, world());
    expect(ok.kind === 'insert' && ok.note.coverAnchor).toEqual(noteAnchor(makePr({ number: 2 })));
    expect(planNoteSet({ ...request, coveredByPrKey: COVER }, world())).toMatchObject({ reason: 'covered_by only goes with kind covered' });
  });

  it('gives a lease its end and replaces the lease in the slot, not the durable note', () => {
    const lease = note({ id: 'l-old', slot: 'lease', kind: 'in_progress', expiresAt: at(80) });
    const plan = planNoteSet({ ...request, kind: 'in_progress', leaseMinutes: 30 }, world({ currentIn: (_key, slot) => (slot === 'lease' ? lease : note()) }));
    expect(plan.kind === 'insert' && plan.note.expiresAt).toBe(at(50));
    expect(plan.kind === 'insert' && plan.replaces?.id).toBe('l-old');
    expect(planNoteSet({ ...request, kind: 'in_progress', leaseMinutes: 2 }, world())).toMatchObject({ kind: 'refused' });
    expect(planNoteSet({ ...request, leaseMinutes: 30 }, world())).toMatchObject({ reason: 'lease_minutes only goes with kind in_progress' });
  });

  it('holds the per-client cap, except for a note replacing its own', () => {
    const full = world({ liveCount: { client: PR_NOTES_PER_CLIENT, total: PR_NOTES_PER_CLIENT } });
    expect(planNoteSet(request, full)).toMatchObject({ kind: 'refused', reason: expect.stringContaining('live notes') });
    expect(planNoteSet(request, { ...full, currentIn: () => note() }).kind).toBe('insert');
  });
});

describe('planNoteRenew and planNoteClear', () => {
  const lease = note({ slot: 'lease', kind: 'in_progress', expiresAt: at(60) });

  it('extends a live lease from now and never re-anchors', () => {
    expect(planNoteRenew(lease, 120, at(30))).toEqual({ kind: 'renew', expiresAt: at(150) });
    expect(planNoteRenew(lease, null, at(60))).toMatchObject({ kind: 'refused', reason: expect.stringContaining('ended') });
    expect(planNoteRenew(note(), 30, at(30))).toMatchObject({ kind: 'refused' });
    expect(planNoteRenew(null, 30, at(30))).toMatchObject({ reason: 'no note with that id' });
  });

  it('clears once, answers a second clear the same way, and never brings back a replaced note', () => {
    expect(planNoteClear(note())).toEqual({ kind: 'clear' });
    expect(planNoteClear(note({ clearedAt: at(30) }))).toEqual({ kind: 'already' });
    expect(planNoteClear(note({ supersededBy: 'n2' }))).toMatchObject({ kind: 'refused' });
  });
});
