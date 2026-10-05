// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { activityList, ACTIVITY_LINE_CAP, type EventView } from '@postpile/core';
import { at, makeComment, makeEvent, makePr, viewer } from '@postpile/core/fixtures';
import { ActionsProvider } from '../api/actions.tsx';
import { ActivityTimeline } from './ActivityTimeline.tsx';
import { ComposeProvider, useCompose, useComposeState } from './Composer.tsx';

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
  const compose = useComposeState();
  return (
    <ComposeProvider value={compose}>
      <JumpButton />
      <ActivityTimeline activity={activity} pr={pr} viewerLogin={viewer.login} />
    </ComposeProvider>
  );
}

/** The oldest line, folded away until the list opens. The actor and the words sit in separate elements. */
function oldestShown(): boolean {
  return document.body.textContent?.includes('lyra said 0') ?? false;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
