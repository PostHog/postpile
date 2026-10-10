// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { activityList, ACTIVITY_LINE_CAP, deriveEvents, eventView, type EventView } from '@postpile/core';
import { at, makeComment, makeEvent, makePr, makeReview, makeThread, makeTimelineItem, viewer } from '@postpile/core/fixtures';
import { ActionsProvider } from '../api/actions.tsx';
import { ActivityTimeline } from './ActivityTimeline.tsx';
import { ComposeProvider, useCompose, useComposeState } from './Composer.tsx';
import { PaneDrafts } from '../lib/pane-drafts.ts';

// A fresh store per test: drafts outlive the pane in the app.
let drafts = new PaneDrafts();

// One more comment than the list shows before "Show all"; the oldest one is folded away.
const COUNT = ACTIVITY_LINE_CAP + 1;
const comments = Array.from({ length: COUNT }, (_, index) => makeComment({ id: `c${index}`, author: 'lyra', body: `point ${index}`, createdAt: at(index) }));
const pr = makePr({ comments });
const views: EventView[] = comments.map((comment, index) => ({
  event: makeEvent({ id: `e${index}`, kind: 'comment', actor: 'lyra', sourceId: comment.id, summary: `lyra said ${index}`, at: at(index), seenAt: at(0) }),
  display: 'seen',
  unseen: false,
}));
const activity = activityList(views, viewer, null, pr);

function JumpButton() {
  const compose = useCompose();
  return (
    <button type="button" onClick={() => compose.jumpToReply('c0')}>
      jump
    </button>
  );
}

function Pane() {
  const compose = useComposeState('acme/app#1', drafts);
  return (
    <ComposeProvider value={compose}>
      <JumpButton />
      <ActivityTimeline activity={activity} prKey={pr.key} />
    </ComposeProvider>
  );
}

/** The oldest line, folded away until the list opens. The actor and the words sit in separate elements. */
function oldestShown(): boolean {
  return document.body.textContent?.includes('lyra said 0') ?? false;
}

afterEach(() => {
  drafts = new PaneDrafts();
  cleanup();
  vi.unstubAllGlobals();
});

function renderPane(node: React.ReactNode) {
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ActionsProvider>{node}</ActionsProvider>
    </QueryClientProvider>,
  );
}

/** greptile opened a thread on vite.config.ts and alice answered it twice; each answer came with GitHub's empty review. */
function botThreadActivity() {
  const bot = 'greptile-apps[bot]';
  const thread = makeThread('t1', [
    makeComment({ id: 'g1', author: bot, body: 'Possible null dereference', createdAt: at(1) }),
    makeComment({ id: 'a1', author: 'alice', body: 'Fixed, it checks first now.', createdAt: at(2) }),
    makeComment({ id: 'a2', author: 'alice', body: 'Also added a test.', createdAt: at(3) }),
  ]);
  const withPath = { ...thread, path: 'vite.config.ts', comments: thread.comments.map((comment) => ({ ...comment, path: 'vite.config.ts' })) };
  const reviews = [2, 3].map((minute) => makeReview({ id: `r${minute}`, author: 'alice', state: 'COMMENTED', body: '', submittedAt: at(minute) }));
  const botPr = makePr({ threads: [withPath], comments: withPath.comments, reviews });
  return { pr: botPr, activity: activityList(deriveEvents(botPr, viewer, null).map(eventView), viewer, null, botPr) };
}

function BotThreadPane() {
  const compose = useComposeState('acme/app#1', drafts);
  const { pr: botPr, activity: botActivity } = botThreadActivity();
  return (
    <ComposeProvider value={compose}>
      <ActivityTimeline activity={botActivity} prKey={botPr.key} />
    </ComposeProvider>
  );
}

describe('ActivityTimeline bot threads', () => {
  it('shows a quiet line per bot thread that opens to the replies, without Reply or an unread dot', () => {
    renderPane(<BotThreadPane />);
    const line = screen.getByRole('button', { name: /replied to greptile/ });
    expect(line.textContent).toBe('alice replied to greptile-apps[bot] · 2 replies on vite.config.ts');
    expect(screen.queryByText('Fixed, it checks first now.')).toBeNull();
    expect(screen.queryByText('Reply in thread')).toBeNull();
    expect(screen.queryByLabelText('Unseen')).toBeNull();
    expect(document.body.textContent).not.toContain('alice reviewed');

    fireEvent.click(line);
    expect(line.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Fixed, it checks first now.')).toBeTruthy();
    expect(screen.getByText('Also added a test.')).toBeTruthy();
  });
});

/** greptile reviewed with three inline comments, each opening a thread. */
function botReviewActivity() {
  const bot = 'greptile-apps[bot]';
  const files = ['vite.config.ts', 'src/test/setup.ts', 'e2e/config.ts'];
  const bodies = ['**logic:** `build.target` drops es2019.\n\nOlder Safari fails to load the bundle.', 'Fake timers are never reset.', 'The port is hardcoded.'];
  const threads = files.map((path, index) => {
    const comment = makeComment({ id: `g${index}`, author: bot, body: bodies[index]!, createdAt: at(1), kind: 'review_comment', path, threadId: `t${index}`, reviewId: 'rg' });
    return { id: `t${index}`, path, isResolved: false, comments: [comment] };
  });
  const comments = threads.flatMap((thread) => thread.comments);
  const botPr = makePr({ threads, comments, reviews: [makeReview({ id: 'rg', author: bot, state: 'COMMENTED', body: '', submittedAt: at(1) })] });
  return { pr: botPr, activity: activityList(deriveEvents(botPr, viewer, null).map(eventView), viewer, null, botPr) };
}

function BotReviewPane() {
  const compose = useComposeState('acme/app#1', drafts);
  const { pr: botPr, activity: botActivity } = botReviewActivity();
  return (
    <ComposeProvider value={compose}>
      <ActivityTimeline activity={botActivity} prKey={botPr.key} />
    </ComposeProvider>
  );
}

describe('ActivityTimeline bot reviews', () => {
  it("shows one quiet line for a bot's review that opens to each comment's file and first line", () => {
    renderPane(<BotReviewPane />);
    const line = screen.getByRole('button', { name: /greptile-apps\[bot\] reviewed/ });
    expect(line.textContent).toBe('greptile-apps[bot] reviewed · 3 inline comments');
    expect(screen.queryByText('vite.config.ts')).toBeNull();
    expect(screen.queryByLabelText('Unseen')).toBeNull();
    expect(screen.queryByText(/bot event/)).toBeNull();

    fireEvent.click(line);
    expect(line.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('vite.config.ts')).toBeTruthy();
    expect(screen.getByText('e2e/config.ts')).toBeTruthy();
    expect(screen.getByText('Fake timers are never reset.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Older Safari');
  });
});

/** bob asks the viewer something (unseen), then alice closes the PR: a comment with a permalink and a timeline item without one. */
function linkActivity() {
  const comment = makeComment({ id: 'c1', author: 'bob', body: '@viewer does the retry cap hold?', createdAt: at(1), url: 'https://github.com/acme/app/pull/1#issuecomment-1' });
  const linkPr = makePr({ comments: [comment], timeline: [makeTimelineItem({ id: 't1', kind: 'closed', actor: 'alice', at: at(2) })] });
  return { pr: linkPr, activity: activityList(deriveEvents(linkPr, viewer, null).map(eventView), viewer, null, linkPr) };
}

function LinkPane() {
  const compose = useComposeState('acme/app#1', drafts);
  const { pr: linkPr, activity: linkList } = linkActivity();
  return (
    <ComposeProvider value={compose}>
      <ActivityTimeline activity={linkList} prKey={linkPr.key} />
    </ComposeProvider>
  );
}

describe('ActivityTimeline permalinks', () => {
  it("links a row's age to the event on GitHub, the unread dot outside the link, and leaves a row without a url plain", () => {
    renderPane(<LinkPane />);
    const links = screen.getAllByRole('link', { name: /^(now|\d+[mhdw])$/ });
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(link.getAttribute('href')).toBe('https://github.com/acme/app/pull/1#issuecomment-1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('title')).toMatch(/^Open on GitHub · \w{3} \d{1,2} \w{3}( \d{4})?, \d{2}:\d{2}$/);
    expect(link.parentElement?.querySelector('[aria-label="Unseen"]')).toBeTruthy();
    expect(link.querySelector('[aria-label="Unseen"]')).toBeNull();
    expect(document.body.textContent).toContain('alice closed');
  });
});

describe('ActivityTimeline', () => {
  it('opens the folded list for a jump once, and Show fewer folds it again', () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    Element.prototype.scrollIntoView = () => {};
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ActionsProvider>
          <Pane />
        </ActionsProvider>
      </QueryClientProvider>,
    );
    expect(activity.earlier).toHaveLength(COUNT);
    expect(oldestShown()).toBe(false);

    fireEvent.click(screen.getByText('jump'));
    expect(oldestShown()).toBe(true);

    fireEvent.click(screen.getByText('Show fewer'));
    expect(oldestShown()).toBe(false);
    expect(screen.getByText(`Show all ${COUNT}`)).toBeTruthy();
  });
});
