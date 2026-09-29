import { describe, expect, it } from 'vitest';
import { at, makeEvent, makeUserState } from './fixtures.ts';
import { planRead, prReadScope, type ReadCause } from './read-plan.ts';

const key = 'acme/app#1';
const early = makeEvent({ id: 'early', at: at(10) });
const late = makeEvent({ id: 'late', at: at(30) });
const events = new Map([[key, [early, late]]]);

function plan(cause: ReadCause, handles = true) {
  return planRead({ scope: prReadScope(key, handles), cause, events, userStates: new Map(), at: at(50) });
}

describe('planRead', () => {
  it('a button sees everything now and handles tracked PRs only', () => {
    expect(plan({ kind: 'button' })).toEqual({ seenAt: at(50), handledAt: at(50), handleKeys: [key], change: { eventIds: ['early', 'late'], handledKeys: [key] } });
    expect(plan({ kind: 'button' }, false).change.handledKeys).toEqual([]);
  });

  it("approve's follow-up and quiet reads never handle", () => {
    expect(plan({ kind: 'approved' }).handleKeys).toEqual([]);
    expect(plan({ kind: 'quiet', readAt: at(20) }).handleKeys).toEqual([]);
  });

  it('a pending completion sees only what was there at the click, stamped now', () => {
    const result = plan({ kind: 'pending_completion', clickedAt: at(20) });
    expect(result.change).toEqual({ eventIds: ['early'], handledKeys: [key] });
    expect(result.seenAt).toBe(at(50));
  });

  it("a read on GitHub is stamped with GitHub's read time", () => {
    const result = plan({ kind: 'read_on_github', readAt: at(20) });
    expect(result.change.eventIds).toEqual(['early']);
    expect(result.seenAt).toBe(at(20));
  });

  it('keeps an earlier handled time, so undo does not clear it', () => {
    const userStates = new Map([[key, makeUserState({ prKey: key, handledAt: at(1) })]]);
    const result = planRead({ scope: prReadScope(key, true), cause: { kind: 'button' }, events, userStates, at: at(50) });
    expect(result.handleKeys).toEqual([key]);
    expect(result.change.handledKeys).toEqual([]);
  });
});
