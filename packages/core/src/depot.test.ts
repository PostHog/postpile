// End-to-end rule checks on the "Move CI to Depot" examples from the design
// rounds: PR snapshot -> deriveEvents -> deriveTileState.

import { describe, expect, it } from 'vitest';
import { deriveEvents } from './events.ts';
import { at, makeComment, makeCommit, makePr, makeTimelineItem, makeUserState, singleTile, viewer } from './fixtures.ts';
import { deriveTileState } from './tiles.ts';
import type { Pr, UserPrState } from './types.ts';

function tileState(pr: Pr, userState: UserPrState | null) {
  const events = deriveEvents(pr, viewer, userState);
  const state = deriveTileState({
    tile: singleTile(pr),
    prs: new Map([[pr.key, pr]]),
    events: new Map([[pr.key, events]]),
    userStates: new Map(userState ? [[pr.key, userState]] : []),
    snooze: null,
    now: at(100),
    viewerLogin: viewer.login,
  });
  return { events, state };
}

const depotPr = makePr({
  number: 4242,
  title: 'chore(ci): move backend tests to depot runners',
  headOid: 'c1',
  commits: [makeCommit({ oid: 'c1', committedAt: at(1) })],
});
const approved = makeUserState({ prKey: depotPr.key, approvedAt: at(5), approvedCommitOid: 'c1' });

describe('Depot examples', () => {
  it('a bot deploy comment stays quiet on a done tile', () => {
    const pr: Pr = {
      ...depotPr,
      comments: [makeComment({ id: 'd1', author: 'vercel', body: 'Deployment preview ready', createdAt: at(10) })],
    };
    const { events, state } = tileState(pr, approved);
    expect(events.find((e) => e.sourceId === 'd1')).toMatchObject({ kind: 'deploy', ruleLoudness: 'quiet' });
    expect(state.kind).toBe('done');
  });

  it('a mention makes the done tile unread and says why', () => {
    const pr: Pr = {
      ...depotPr,
      comments: [makeComment({ id: 'm1', author: 'carol', body: '@viewer runner labels ok?', createdAt: at(10) })],
    };
    const { state } = tileState(pr, approved);
    expect(state.kind).toBe('unread');
    expect(state.unreadBecause).toEqual([
      {
        prKey: pr.key,
        eventId: `${pr.key}:question_to_user:m1`,
        kind: 'question_to_user',
        summary: 'carol asked you: @viewer runner labels ok?',
      },
    ]);
  });

  it('a push after approval is loud and the tile is no longer done', () => {
    const pr: Pr = {
      ...depotPr,
      headOid: 'c2',
      commits: [...depotPr.commits, makeCommit({ oid: 'c2', headline: 'bump runner size', committedAt: at(20) })],
    };
    const { state } = tileState(pr, approved);
    expect(state.kind).toBe('unread');
    expect(state.unreadBecause[0]).toMatchObject({ kind: 'commits_after_approval', summary: 'alice pushed: bump runner size' });
  });

  it('a bot rebase on a draft is muted and changes nothing', () => {
    const pr: Pr = {
      ...depotPr,
      isDraft: true,
      timeline: [
        makeTimelineItem({ id: 'fp1', kind: 'head_ref_force_pushed', actor: 'trunk-io', subject: null, at: at(30) }),
      ],
    };
    const { events, state } = tileState(pr, null);
    expect(events.find((e) => e.sourceId === 'fp1')).toMatchObject({ kind: 'force_pushed', ruleLoudness: 'muted' });
    expect(state.kind).toBe('open');
  });
});
