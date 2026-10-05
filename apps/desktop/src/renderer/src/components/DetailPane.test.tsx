// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { activityList, eventView, prPaneView, prStatus, type ActivityList, type Pr, type PrDetail, type PrSummary, type TileView } from '@postpile/core';
import { at, makeComment, makeCommit, makeEvent, makePr, makeReview, NO_OPENED_READ, NO_PR_FACTS, viewer, withOffers } from '@postpile/core/fixtures';
import { ActionsProvider } from '../api/actions.tsx';
import { queryKeys } from '../api/keys.ts';
import { DetailPane } from './DetailPane.tsx';

const NO_TURN = { kind: 'none', who: null, what: '', prKey: null } as const;

const layers = [
  makePr({ number: 11, title: 'Add the cache key' }),
  makePr({ number: 12, title: 'Read the cache' }),
  makePr({ number: 13, title: 'Drop the old cache' }),
];

function summaryOf(pr: Pr): PrSummary {
  return {
    key: pr.key,
    title: pr.title,
    url: pr.url,
    author: pr.author,
    assignees: [],
    state: 'OPEN',
    primaryAction: 'approve',
    isDraft: false,
    provenance: { kind: 'pinged', reason: 'review_requested' },
    why: 'RV',
    forWhom: { kind: 'you' },
    tier: 'to_review',
    authorRelation: 'team',
    status: prStatus(pr),
    openThreads: 0,
    verdict: null,
    glanceStale: false,
    forYou: null,
    glanceGap: null,
    glanceRefreshBlock: null,
    glanceState: 'none',
    unseenLoudEvents: 0,
    unreadOnGitHub: false,
    done: false,
    ownTeamRequests: [],
    pendingWrite: null,
    turn: NO_TURN,
    facts: NO_PR_FACTS,
    afterRead: { done: false, turn: NO_TURN },
    openedRead: NO_OPENED_READ,
    whatsNew: null,
    updatedAt: at(pr.ref.number),
    quietRepo: false,
    repoLabel: null,
  };
}

/** What the server sends for `pr`: the slim view, the activity built from the stored PR before it. */
function detailOf(pr: Pr, activity: ActivityList = activityList([], null)): PrDetail {
  return {
    pr: prPaneView(pr),
    status: prStatus(pr),
    fetchedAt: null,
    activity,
    whatsNew: null,
    glance: null,
    glanceStale: false,
    glanceBehindDossier: false,
    glanceGap: null,
    glanceState: 'none',
    glanceRefreshBlock: null,
    memoryUpdating: false,
    userState: null,
    viewerApproval: null,
    viewerReview: null,
    agentApprovers: [],
    topicId: 'topic-1',
    tileIds: ['stack:acme/app#11'],
    facts: [],
  };
}

const stackView: TileView = withOffers({
  tile: {
    id: 'stack:acme/app#11',
    topicId: 'topic-1',
    kind: 'stack',
    title: 'Cache stack',
    members: layers.map((pr) => ({ prKey: pr.key, provenance: { kind: 'pinged', reason: 'review_requested' } })),
    stacks: [{ id: 'stack:acme/app#11', prKeys: layers.map((pr) => pr.key) }],
  },
  state: { kind: 'open', unreadBecause: [], unreadOnGitHub: false, loud: false },
  prs: layers.map(summaryOf),
  why: 'RV',
  forWhom: { kind: 'you' },
  tier: 'to_review',
  people: [],
  turn: NO_TURN,
  afterRead: { done: false, turn: NO_TURN },
  pendingWrite: null,
  quietRepo: false,
  repoLabel: null,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The pane for one PR with its detail cached; every other read never answers. */
function renderCached(prKey: string, detail: PrDetail) {
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  // jsdom has no ResizeObserver; the description box measures itself with one.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(queryKeys.pr(prKey), detail);
  return render(
    <QueryClientProvider client={client}>
      <ActionsProvider>
        <DetailPane view={stackView} prKey={prKey} onSelectPr={() => {}} noSelectionText="" />
      </ActionsProvider>
    </QueryClientProvider>,
  );
}

describe('DetailPane', () => {
  it('shows one state line after clicking through the layers of a stack', () => {
    // Every PR's detail is cached, as after a first visit; other reads never answer.
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    for (const pr of layers) {
      client.setQueryData(queryKeys.pr(pr.key), detailOf(pr));
    }
    const wrap = (prKey: string) => (
      <QueryClientProvider client={client}>
        <ActionsProvider>
          <DetailPane view={stackView} prKey={prKey} onSelectPr={() => {}} noSelectionText="" />
        </ActionsProvider>
      </QueryClientProvider>
    );

    const { rerender } = render(wrap('acme/app#11'));
    rerender(wrap('acme/app#12'));
    rerender(wrap('acme/app#13'));
    rerender(wrap('acme/app#11'));

    expect(screen.getAllByRole('link', { name: /Open on GitHub/ })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Add the cache key');
  });

  it('shows facts, reviews and replies from the slim view', () => {
    const stored = makePr({
      number: 11,
      title: 'Add the cache key',
      body: 'One key for every job.',
      commits: [makeCommit({ committedAt: at(30) })],
      reviews: [makeReview({ id: 'r1', author: 'lyra', state: 'APPROVED', body: 'Ship it.' })],
      comments: [makeComment({ id: 'c1', author: 'bob', body: 'Why one key for all jobs?', url: 'https://github.com/acme/app/pull/11#issuecomment-1' })],
      checks: {
        rollup: 'FAILURE',
        contexts: [
          { name: 'lint', conclusion: 'SUCCESS', completedAt: at(40) },
          { name: 'test', conclusion: 'FAILURE', completedAt: at(45) },
          { name: 'e2e', conclusion: null, completedAt: null },
        ],
      },
    });
    const comment = eventView(makeEvent({ id: 'acme/app#11:comment:c1', prKey: stored.key, actor: 'bob', sourceId: 'c1', summary: 'bob commented' }));
    const ci = eventView(
      makeEvent({ id: 'acme/app#11:ci:head:FAILURE', prKey: stored.key, kind: 'ci', actor: '', isBot: true, summary: 'CI failed: test', ruleReason: 'bot activity', seenAt: at(50), at: at(45) }),
    );
    const detail = detailOf(stored, activityList([comment, ci], viewer, null, stored));
    expect(detail.pr).not.toHaveProperty('comments');

    renderCached(stored.key, detail);

    expect(screen.getByText('3 checks · 2 not passing')).toBeTruthy();
    expect(screen.getByText(/^pushed /)).toBeTruthy();
    expect(screen.getByText('One key for every job.')).toBeTruthy();
    expect(screen.getByText('lyra').parentElement?.textContent).toContain('approved');
    // The reply target comes with the activity line, built from the stored PR on the server.
    expect(screen.getByText('Why one key for all jobs?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Reply$/ })).toBeTruthy();
    // The folded bot/CI rows draw from the slim items too: summary, and the reason in the hover title.
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 bot/CI event' }));
    expect(screen.getByText('CI failed: test').closest('[title]')?.getAttribute('title')).toBe('seen: bot activity');
  });
});
