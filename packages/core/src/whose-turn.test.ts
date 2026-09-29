import { describe, expect, it } from 'vitest';
import { at, makeComment, makeCommit, makeEvent, makePr, makeReview, makeThread, makeTimelineItem, makeUserState, singleTile, viewer } from './fixtures.ts';
import type { Pr, PrEvent, Tile, UserPrState, Viewer } from './types.ts';
import { isMergeApprovedMove, whoseTurn, type WhoseTurn } from './whose-turn.ts';

const me = viewer.login;

function turnOf(tile: Tile, prs: Pr[], events: PrEvent[] = [], userStates: UserPrState[] = [], who: Viewer = viewer): WhoseTurn {
  const eventMap = new Map<string, PrEvent[]>();
  for (const event of events) {
    eventMap.set(event.prKey, [...(eventMap.get(event.prKey) ?? []), event]);
  }
  return whoseTurn({
    tile,
    prs: new Map(prs.map((pr) => [pr.key, pr])),
    events: eventMap,
    userStates: new Map(userStates.map((state) => [state.prKey, state])),
    viewer: who,
  });
}

function single(pr: Pr, events: PrEvent[] = [], userStates: UserPrState[] = []): WhoseTurn {
  return turnOf(singleTile(pr), [pr], events, userStates);
}

describe('whoseTurn: your move', () => {
  it('asks for a review requested of you, naming who asked', () => {
    const pr = makePr({ author: 'rowan', reviewerUsers: [me], timeline: [makeTimelineItem({ actor: 'rowan', subject: me })] });
    expect(single(pr)).toEqual({ kind: 'you', move: 'review', who: null, what: 'Review, rowan asked', prKey: pr.key });
    expect(single({ ...pr, timeline: [] }).what).toBe('Review');
  });

  it('names who asked you, not whoever requested someone else later', () => {
    const timeline = [
      makeTimelineItem({ id: 't1', actor: 'rowan', subject: me, at: at(1) }),
      makeTimelineItem({ id: 't2', actor: 'ada', subject: 'sol', at: at(2) }),
    ];
    const pr = makePr({ author: 'rowan', reviewerUsers: [me, 'sol'], timeline });
    expect(single(pr).what).toBe('Review, rowan asked');
  });

  it("waits on the author while an outsider's change request stands on a routed team request", () => {
    const withTeam: Viewer = { ...viewer, teamMembers: ['lyra'] };
    const pr = makePr({ author: 'rowan', reviewerTeams: ['acme/team-platform'], reviews: [makeReview({ author: 'ada', state: 'CHANGES_REQUESTED' })] });
    expect(turnOf(singleTile(pr), [pr], [], [], withTeam)).toMatchObject({ kind: 'them', who: 'rowan', what: "to address ada's changes" });
    // Asked personally, the review is still yours.
    const personal = { ...pr, reviewerUsers: [me] };
    expect(turnOf(singleTile(personal), [personal], [], [], withTeam)).toMatchObject({ kind: 'you' });
  });

  it('gives no move on a routed team request when the glance says not yours', () => {
    const withTeam: Viewer = { ...viewer, teamMembers: ['lyra'] };
    const turn = (pr: Pr) =>
      whoseTurn({ tile: singleTile(pr), prs: new Map([[pr.key, pr]]), events: new Map(), userStates: new Map(), viewer: withTeam, notYours: new Set([pr.key]) });
    expect(turn(makePr({ author: 'rowan', reviewerTeams: ['acme/team-platform'] })).kind).toBe('none');
    // A teammate's PR and a personal request stay yours, whatever the glance says.
    expect(turn(makePr({ author: 'lyra', reviewerTeams: ['acme/team-platform'] })).kind).toBe('you');
    expect(turn(makePr({ author: 'rowan', reviewerUsers: [me] })).kind).toBe('you');
  });

  it('asks for a team review only while no one else reviewed', () => {
    const pr = makePr({ author: 'rowan', reviewerTeams: ['acme/team-platform'] });
    expect(single(pr)).toMatchObject({ kind: 'you', what: 'Review for team-platform' });
    const taken = { ...pr, reviews: [makeReview({ author: 'lyra', state: 'COMMENTED' })] };
    expect(single(taken)).toMatchObject({ kind: 'them', who: 'lyra', what: 'is reviewing' });
    const approved = { ...taken, reviewDecision: 'APPROVED' as const };
    expect(single(approved)).toMatchObject({ kind: 'them', who: 'rowan', what: 'to merge' });
  });

  it('counts only teammates as picking up a team review once team members are known', () => {
    const withTeam: Viewer = { ...viewer, teams: ['acme/team-platform'], teamMembers: ['lyra'] };
    const pr = makePr({ author: 'rowan', reviewerTeams: ['acme/team-platform'] });
    const outsider = { ...pr, reviews: [makeReview({ author: 'mira', state: 'COMMENTED' })] };
    expect(turnOf(singleTile(outsider), [outsider], [], [], withTeam)).toMatchObject({ kind: 'you', what: 'Review for team-platform' });
    const teammate = { ...pr, reviews: [makeReview({ author: 'mira', state: 'COMMENTED' }), makeReview({ author: 'lyra', state: 'COMMENTED' })] };
    expect(turnOf(singleTile(teammate), [teammate], [], [], withTeam)).toMatchObject({ kind: 'them', who: 'lyra', what: 'is reviewing' });
  });

  it('asks for a team review on a teammate\'s PR like a personal one, naming the author', () => {
    const withTeam: Viewer = { ...viewer, teamMembers: ['lyra', 'rowan'] };
    const pr = makePr({ author: 'lyra', reviewerTeams: ['acme/team-platform'] });
    const turn = (p: Pr) => turnOf(singleTile(p), [p], [], [], withTeam);
    expect(turn(pr)).toMatchObject({ kind: 'you', what: "Review for team-platform: lyra's PR" });
    // A teammate's comment alone does not cover it.
    const commented = { ...pr, reviews: [makeReview({ author: 'rowan', state: 'COMMENTED' })] };
    expect(turn(commented)).toMatchObject({ kind: 'you', what: "Review for team-platform: lyra's PR" });
    const changes = { ...pr, reviews: [makeReview({ author: 'rowan', state: 'CHANGES_REQUESTED' })] };
    expect(turn(changes)).toMatchObject({ kind: 'them', who: 'rowan', what: 'is reviewing' });
    const approved = { ...pr, reviewDecision: 'APPROVED' as const, reviews: [makeReview({ author: 'rowan', state: 'APPROVED' })] };
    expect(turn(approved)).toMatchObject({ kind: 'them', who: 'lyra', what: 'to merge' });
  });

  it('keeps the routed team request wording on a PR from outside the team', () => {
    const withTeam: Viewer = { ...viewer, teamMembers: ['lyra', 'rowan'] };
    const pr = makePr({ author: 'ada', reviewerTeams: ['acme/team-platform'] });
    expect(turnOf(singleTile(pr), [pr], [], [], withTeam)).toMatchObject({ kind: 'you', what: 'Review for team-platform' });
    const commented = { ...pr, reviews: [makeReview({ author: 'rowan', state: 'COMMENTED' })] };
    expect(turnOf(singleTile(commented), [commented], [], [], withTeam)).toMatchObject({ kind: 'them', who: 'rowan', what: 'is reviewing' });
  });

  it('adds the review to an ask on a teammate\'s PR with a team request', () => {
    const withTeam: Viewer = { ...viewer, teamMembers: ['lyra'] };
    const pr = makePr({ author: 'lyra', reviewerTeams: ['acme/team-platform'] });
    const mention = makeEvent({ kind: 'mention', ruleLoudness: 'loud', actor: 'lyra', at: at(30) });
    expect(turnOf(singleTile(pr), [pr], [mention], [], withTeam)).toMatchObject({ kind: 'you', what: 'Review, lyra mentioned you' });
  });

  it('never asks to re-check commits that landed after your approval', () => {
    const pr = makePr({
      author: 'rowan',
      reviewerUsers: [me],
      headOid: 'c3',
      commits: [makeCommit({ oid: 'c1' }), makeCommit({ oid: 'c2' }), makeCommit({ oid: 'c3' })],
    });
    const approved = makeUserState({ prKey: pr.key, approvedAt: at(1), approvedCommitOid: 'c1' });
    expect(single(pr, [], [approved])).toMatchObject({ kind: 'them', who: 'rowan', what: 'to merge' });
  });

  it('counts a github.com approval of an older head as standing', () => {
    const pr = makePr({ author: 'rowan', headOid: 'c2', commits: [makeCommit({ oid: 'c1' }), makeCommit({ oid: 'c2' })] });
    const withReview = { ...pr, reviews: [makeReview({ author: me, commitOid: 'c1' })] };
    expect(single(withReview)).toMatchObject({ kind: 'them', who: 'rowan', what: 'to merge' });
  });

  it('asks you to answer a mention or question you have not replied to', () => {
    const pr = makePr({ author: 'rowan' });
    const question = makeEvent({ kind: 'question_to_user', ruleLoudness: 'loud', actor: 'lyra', at: at(10) });
    expect(single(pr, [question])).toMatchObject({ kind: 'you', what: "Answer lyra's question" });
    const answered = { ...pr, comments: [makeComment({ author: me, createdAt: at(11) })] };
    expect(single(answered, [question]).kind).toBe('none');
  });

  it('folds a mention into the review ask', () => {
    const pr = makePr({ author: 'rowan', reviewerUsers: [me] });
    const mention = makeEvent({ kind: 'mention', ruleLoudness: 'loud', actor: 'lyra' });
    expect(single(pr, [mention]).what).toBe('Review, lyra mentioned you');
  });

  it('ignores mentions by bots and by yourself', () => {
    const pr = makePr({ author: 'rowan' });
    const bot = makeEvent({ kind: 'mention', ruleLoudness: 'loud', actor: 'github-actions', isBot: true });
    const self = makeEvent({ kind: 'mention', ruleLoudness: 'loud', actor: me });
    expect(single(pr, [bot, self]).kind).toBe('none');
  });

  it('asks nothing for a reply the events agent lowered, like a plain thanks', () => {
    const pr = makePr({ author: 'rowan' });
    const thanks = makeEvent({ kind: 'reply_to_user', ruleLoudness: 'loud', actor: 'rowan', summary: "rowan replied to you: thanks, that's fine" });
    expect(single(pr, [thanks])).toMatchObject({ kind: 'you', move: 'reply', what: 'Reply to rowan' });
    const lowered: PrEvent = { ...thanks, override: { loudness: 'quiet', reason: 'Only says thanks.', by: 'agent' } };
    expect(single(pr, [lowered])).toEqual({ kind: 'none', who: null, what: '', prKey: null });
    const muted: PrEvent = { ...thanks, override: { loudness: 'muted', reason: 'Noise.', by: 'agent' } };
    expect(single(pr, [muted]).kind).toBe('none');
  });

  it('falls through to the rest of the rules once the agent lowered the ask', () => {
    // You reviewed with a comment, the author said thanks: waiting on the author, not on you.
    const pr = makePr({ author: 'rowan', reviews: [makeReview({ author: me, state: 'COMMENTED', submittedAt: at(5) })] });
    const thanks = makeEvent({ kind: 'reply_to_user', ruleLoudness: 'loud', actor: 'rowan', at: at(10) });
    expect(single(pr, [thanks]).kind).toBe('you');
    const lowered: PrEvent = { ...thanks, override: { loudness: 'quiet', reason: 'Only says thanks.', by: 'agent' } };
    expect(single(pr, [lowered])).toMatchObject({ kind: 'them', who: 'rowan', what: 'to reply' });
    // On a draft the lowered reply is not a move either.
    expect(single({ ...pr, isDraft: true }, [lowered]).kind).toBe('none');
  });
});

describe('whoseTurn: on your own PR', () => {
  const own = makePr({ author: me });

  it('asks you to answer threads from others', () => {
    const threads = [
      makeThread('t1', [makeComment({ author: 'mira' })]),
      makeThread('t2', [makeComment({ author: me }), makeComment({ id: 'c2', author: 'mira' })]),
      makeThread('t3', [makeComment({ author: 'mira' }), makeComment({ id: 'c3', author: me })]),
    ];
    expect(single({ ...own, threads })).toMatchObject({ kind: 'you', what: 'Answer 2 threads from mira' });
  });

  it('asks you to address requested changes, then to fix CI', () => {
    const changes = { ...own, reviews: [makeReview({ author: 'ada', state: 'CHANGES_REQUESTED' })] };
    expect(single(changes).what).toBe("Address ada's changes");
    const cleared = { ...changes, reviews: [...changes.reviews, makeReview({ id: 'r2', author: 'ada', submittedAt: at(30) })] };
    expect(single(cleared).what).not.toBe("Address ada's changes");
    const failing = { ...own, checks: { rollup: 'FAILURE' as const, contexts: [] } };
    expect(single(failing).what).toBe('Fix failing CI');
  });

  it('says it waits on the first requested reviewer', () => {
    expect(single({ ...own, reviewerUsers: ['sol', 'lyra'] })).toEqual({ kind: 'them', who: 'sol', what: 'and 1 more', prKey: own.key, lead: 'Waiting on' });
    expect(single({ ...own, reviewerTeams: ['acme/team-platform'] })).toEqual({ kind: 'them', who: 'acme/team-platform', what: '', prKey: own.key, lead: 'Waiting on' });
    expect(single({ ...own, reviewerUsers: ['sol'], reviewerTeams: ['acme/team-platform'] })).toMatchObject({ who: 'sol', what: 'and 1 more' });
  });

  it('names the PR on a multi-PR tile while waiting', () => {
    const second = makePr({ number: 2, author: me, reviewerUsers: ['sol'] });
    const tile: Tile = {
      id: 'set:x',
      topicId: 'topic-1',
      kind: 'set',
      title: 'set',
      members: [{ prKey: second.key, provenance: { kind: 'pinged', reason: 'author' } }, { prKey: 'acme/app#9', provenance: { kind: 'pinged', reason: 'author' } }],
      stacks: [],
    };
    expect(turnOf(tile, [second])).toMatchObject({ kind: 'them', who: 'sol', what: 'on #2', lead: 'Waiting on' });
  });

  it('never asks you to review your own PR, even when your team is requested', () => {
    const teamAsked = { ...own, reviewerTeams: ['acme/team-platform'] };
    const requested = makeEvent({ prKey: own.key, kind: 'review_requested', actor: 'github-actions', isBot: true, ruleLoudness: 'loud' });
    const turn = single(teamAsked, [requested]);
    expect(turn.kind).toBe('them');
    expect(turn.what).not.toContain('Review');
  });

  it('asks nothing of you after a bot comment or a finished review', () => {
    const botComment = makeEvent({ prKey: own.key, kind: 'bot_comment', actor: 'greptile-apps[bot]', isBot: true, ruleLoudness: 'loud' });
    const reviewed = { ...own, reviews: [makeReview({ author: 'lyra', state: 'COMMENTED' })] };
    const review = makeEvent({ prKey: own.key, kind: 'review_commented', actor: 'lyra', ruleLoudness: 'loud' });
    expect(single(own, [botComment]).kind).toBe('none');
    expect(single(reviewed, [review]).kind).toBe('none');
  });

  it('asks you to merge once it is approved', () => {
    expect(single({ ...own, reviewDecision: 'APPROVED' }).what).toBe('Merge, it is approved');
    expect(isMergeApprovedMove(single({ ...own, reviewDecision: 'APPROVED' }))).toBe(true);
    expect(isMergeApprovedMove(single({ ...own, checks: { ...own.checks, rollup: 'FAILURE' }, reviewDecision: 'APPROVED' }))).toBe(false);
    expect(single({ ...own, reviewDecision: 'APPROVED', isDraft: true }).kind).toBe('none');
  });
});

describe('whoseTurn: waiting on them', () => {
  it('waits on the author to merge after you approved the head', () => {
    const pr = makePr({ author: 'sol', reviews: [makeReview({ author: me, commitOid: 'head' })] });
    expect(single(pr)).toEqual({ kind: 'them', who: 'sol', what: 'to merge', prKey: pr.key });
  });

  it('waits on the author to address your threads or changes', () => {
    const reviewed = makePr({ author: 'rowan', reviews: [makeReview({ author: me, state: 'COMMENTED' })] });
    expect(single(reviewed).what).toBe('to reply');
    const threads = [makeThread('t1', [makeComment({ author: me })]), makeThread('t2', [makeComment({ author: me })])];
    expect(single({ ...reviewed, threads }).what).toBe('to address 2 threads');
    const changes = makePr({ author: 'rowan', reviews: [makeReview({ author: me, state: 'CHANGES_REQUESTED' })] });
    expect(single(changes).what).toBe('to address your changes');
  });
});

describe('whoseTurn: nobody', () => {
  it('has no turn on merged or closed PRs, or when you only follow', () => {
    expect(single(makePr({ state: 'MERGED', reviewerUsers: [me] })).kind).toBe('none');
    expect(single(makePr({ state: 'CLOSED' })).kind).toBe('none');
    expect(single(makePr({ author: 'mae' }))).toEqual({ kind: 'none', who: null, what: '', prKey: null });
  });

  it('has no turn without a viewer', () => {
    const pr = makePr({ reviewerUsers: [me] });
    const turn = whoseTurn({ tile: singleTile(pr), prs: new Map([[pr.key, pr]]), events: new Map(), userStates: new Map(), viewer: null });
    expect(turn.kind).toBe('none');
  });
});

describe('whoseTurn: multi-PR tiles', () => {
  it('picks the most urgent pinged member and names the PR', () => {
    const approved = makePr({ number: 1, author: 'rowan', reviews: [makeReview({ author: me })] });
    const asked = makePr({ number: 2, author: 'rowan', reviewerUsers: [me] });
    const pulled = makePr({ number: 3, author: me, checks: { rollup: 'FAILURE', contexts: [] } });
    const tile: Tile = {
      id: 'stack:x',
      topicId: 'topic-1',
      kind: 'stack',
      title: 'stack',
      members: [
        { prKey: approved.key, provenance: { kind: 'pinged', reason: 'review_requested' } },
        { prKey: asked.key, provenance: { kind: 'pinged', reason: 'review_requested' } },
        { prKey: pulled.key, provenance: { kind: 'pulled_in', reason: 'stack layer above #2' } },
      ],
      stacks: [{ id: 'stack:x', prKeys: [approved.key, asked.key, pulled.key] }],
    };
    expect(turnOf(tile, [approved, asked, pulled])).toEqual({ kind: 'you', move: 'review', who: null, what: 'Review on #2', prKey: asked.key });
    const pushedOnFirst = { ...approved, headOid: 'c2', commits: [makeCommit({ oid: 'head' }), makeCommit({ oid: 'c2' })] };
    const news = makeEvent({ prKey: approved.key, kind: 'commits_after_approval', ruleLoudness: 'loud', at: at(50) });
    // A push after the approval (even one the agent raised) is not a re-check move; the review on #2 is.
    expect(turnOf(tile, [pushedOnFirst, asked, pulled], [news])).toMatchObject({ what: 'Review on #2' });
    expect(turnOf(tile, [approved, { ...asked, state: 'MERGED' }, pulled])).toEqual({
      kind: 'them',
      who: 'rowan',
      what: 'to merge on #1',
      prKey: approved.key,
    });
  });
});

describe('whoseTurn: drafts', () => {
  const draft = makePr({ author: 'rowan', isDraft: true, reviewerUsers: [me] });

  it('never asks for a review, a re-check or a merge on a draft', () => {
    const requested = makeEvent({ kind: 'review_requested', actor: 'rowan' });
    expect(single(draft, [requested]).kind).toBe('none');
    const approvedOld = { ...draft, headOid: 'c2', reviews: [makeReview({ author: me, commitOid: 'head' })], commits: [makeCommit({ oid: 'head' }), makeCommit({ oid: 'c2' })] };
    expect(single(approvedOld).kind).toBe('none');
    const ownApproved = makePr({ author: me, isDraft: true, reviewDecision: 'APPROVED' });
    expect(single(ownApproved).kind).toBe('none');
  });

  it('is your move only for a personal question or mention', () => {
    const question = makeEvent({ kind: 'question_to_user', ruleLoudness: 'loud', actor: 'ada', at: at(30) });
    const team = makeEvent({ kind: 'team_mention', ruleLoudness: 'loud', actor: 'ada', at: at(30) });
    expect(single(draft, [question])).toMatchObject({ kind: 'you', what: 'Reply to ada on draft' });
    expect(single(draft, [team]).kind).toBe('none');
  });

  it('asks you to address comments on your own draft', () => {
    const own = makePr({ author: me, isDraft: true, threads: [makeThread('t1', [makeComment({ author: 'mira' })]), makeThread('t2', [makeComment({ author: 'mira' })])] });
    expect(single(own)).toMatchObject({ kind: 'you', what: 'Address 2 comments on your draft' });
    expect(single({ ...own, threads: [], checks: { rollup: 'FAILURE' as const, contexts: [] } }).kind).toBe('none');
  });

  it('turns back to a review once the draft is ready', () => {
    const timeline = [makeTimelineItem({ actor: 'rowan', subject: me })];
    expect(single({ ...draft, isDraft: false, timeline })).toMatchObject({ kind: 'you', what: 'Review, rowan asked' });
  });
});

describe('whoseTurn: the kind of move', () => {
  const own = makePr({ author: me });
  const move = (turn: WhoseTurn) => (turn.kind === 'you' ? turn.move : null);

  it('calls every ask a reply, a team mention and one folded into a review included', () => {
    const others = makePr({ author: 'rowan' });
    expect(move(single(others, [makeEvent({ kind: 'question_to_user', ruleLoudness: 'loud', actor: 'lyra' })]))).toBe('reply');
    expect(move(single(others, [makeEvent({ kind: 'team_mention', ruleLoudness: 'loud', actor: 'lyra' })]))).toBe('reply');
    expect(move(single({ ...others, reviewerUsers: [me] }, [makeEvent({ kind: 'mention', ruleLoudness: 'loud', actor: 'lyra' })]))).toBe('reply');
  });

  it('calls a review request, personal or for the team, a review', () => {
    expect(move(single(makePr({ author: 'rowan', reviewerUsers: [me] })))).toBe('review');
    expect(move(single(makePr({ author: 'rowan', reviewerTeams: ['acme/team-platform'] })))).toBe('review');
  });

  it('calls an answered change request a re-review', () => {
    const changes = makeReview({ author: me, state: 'CHANGES_REQUESTED', submittedAt: at(20), commitOid: 'c0' });
    const pr = makePr({ author: 'rowan', headOid: 'c1', reviews: [changes], commits: [makeCommit({ oid: 'c1', author: 'rowan', committedAt: at(30) })] });
    expect(move(single(pr))).toBe('re_review');
  });

  it('calls threads and change requests on your own PR or draft addressing changes', () => {
    const threads = [makeThread('t1', [makeComment({ author: 'mira' })])];
    const changes = [makeReview({ author: 'ada', state: 'CHANGES_REQUESTED' })];
    expect(move(single({ ...own, threads }))).toBe('address_changes');
    expect(move(single({ ...own, reviews: changes }))).toBe('address_changes');
    expect(move(single({ ...own, isDraft: true, threads }))).toBe('address_changes');
    expect(move(single({ ...own, isDraft: true, reviews: changes }))).toBe('address_changes');
  });

  it('calls failing CI fix_ci and an approved PR merge', () => {
    expect(move(single({ ...own, checks: { rollup: 'FAILURE', contexts: [] } }))).toBe('fix_ci');
    expect(move(single({ ...own, reviewDecision: 'APPROVED' }))).toBe('merge');
  });

  it('calls a personal ask on a draft a reply', () => {
    const draft = makePr({ author: 'rowan', isDraft: true });
    expect(move(single(draft, [makeEvent({ kind: 'question_to_user', ruleLoudness: 'loud', actor: 'ada' })]))).toBe('reply');
  });
});
