// End-to-end rule checks on the "Move CI to Depot" examples from the design
// rounds: PR snapshot -> deriveEvents -> deriveTileState.

import { describe, expect, it } from 'vitest';
import { deriveEvents } from './events.ts';
import { at, makeComment, makeCommit, makePr, makeThreadFor, makeTimelineItem, makeUserState, singleTile, viewer } from './fixtures.ts';
import { deriveTileState } from './tiles.ts';
import type { FullPr as Pr, UserPrState } from './types.ts';

/** `unreadOnGitHub`: the PR's thread is unread on GitHub; read otherwise (GitHub or PostPile's quiet reads cleared it). */
function tileState(pr: Pr, userState: UserPrState | null, unreadOnGitHub = false) {
  const events = deriveEvents(pr, viewer, userState);
  const state = deriveTileState({
    tile: singleTile(pr),
    prs: new Map([[pr.key, pr]]),
    events: new Map([[pr.key, events]]),
    threads: new Map([[pr.key, makeThreadFor(pr, { unread: unreadOnGitHub, lastReadAt: at(5) })]]),
    userStates: new Map(userState ? [[pr.key, userState]] : []),
    snoozes: new Map(),
    now: at(100),
    viewer,
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
    // Until the bot-only quiet read clears the thread on GitHub, it shows unread without loud news.
    expect(tileState(pr, approved, true).state).toMatchObject({ kind: 'unread', loud: false });
  });

  it('a mention makes the done tile unread and says why', () => {
    const pr: Pr = {
      ...depotPr,
      comments: [makeComment({ id: 'm1', author: 'carol', body: '@viewer runner labels ok?', createdAt: at(10) })],
    };
    const { state } = tileState(pr, approved, true);
    expect(state.kind).toBe('unread');
    expect(state.unreadBecause).toEqual([
      {
        prKey: pr.key,
        eventId: `${pr.key}:question_to_user:m1`,
        kind: 'question_to_user',
        actor: 'carol',
        summary: 'carol asked you: @viewer runner labels ok?',
        at: at(10),
        automation: false,
        loud: true,
        importance: 0,
      },
    ]);
  });

  it('a push after approval is quiet and the tile stays done', () => {
    const pr: Pr = {
      ...depotPr,
      headOid: 'c2',
      commits: [...depotPr.commits, makeCommit({ oid: 'c2', headline: 'bump runner size', committedAt: at(20) })],
    };
    const { events, state } = tileState(pr, approved);
    expect(events.find((e) => e.sourceId === 'c2')).toMatchObject({ kind: 'commits_after_approval', ruleLoudness: 'quiet' });
    expect(state.kind).toBe('done');
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
