// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { activityList, prStatus, type Pr, type PrDetail, type PrSummary, type TileView } from '@postpile/core';
import { at, makePr, NO_OPENED_READ, NO_PR_FACTS, withOffers } from '@postpile/core/fixtures';
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

function detailOf(pr: Pr): PrDetail {
  return {
    pr,
    status: prStatus(pr),
    fetchedAt: null,
    events: [],
    activity: activityList([], null),
    whatsNew: null,
    glance: null,
    glanceStale: false,
    glanceGap: null,
    glanceState: 'none',
    glanceRefreshBlock: null,
    memoryUpdating: false,
    userState: null,
    viewerApproval: null,
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

describe('DetailPane', () => {
  it('shows one action bar after clicking through the layers of a stack', () => {
    // Every PR's detail is cached, as after a first visit; other reads never answer.
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    for (const pr of layers) {
      client.setQueryData(queryKeys.pr(pr.key), detailOf(pr));
    }
    const wrap = (prKey: string) => (
      <QueryClientProvider client={client}>
        <ActionsProvider>
          <DetailPane view={stackView} prKey={prKey} onSelectPr={() => {}} chatRequest={null} noSelectionText="" />
        </ActionsProvider>
      </QueryClientProvider>
    );

    const { rerender } = render(wrap('acme/app#11'));
    rerender(wrap('acme/app#12'));
    rerender(wrap('acme/app#13'));
    rerender(wrap('acme/app#11'));

    expect(screen.getAllByRole('button', { name: 'Chat about this tile' })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Add the cache key');
  });
});
