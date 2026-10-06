// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GitHubWritesStatus } from '@postpile/core';
import { ActionsProvider, useActions } from '../api/actions.tsx';
import { request } from '../api/client.ts';
import { queryKeys } from '../api/keys.ts';
import { Composer, ComposeProvider, useComposeState } from './Composer.tsx';
import { Toast } from './Toast.tsx';

// jsdom has no layout: the composer scrolls itself into view on open.
Element.prototype.scrollIntoView = () => {};

type Draft = (gist: string, quiet?: boolean) => Promise<string | null>;
type Send = (body: string, source: string) => Promise<boolean>;

interface PaneProps {
  draft: Draft;
  send?: Send;
  draftsOnOpen?: boolean;
}

/** An "Approve with a note" composer behind an open button, like the review row's "+ note". */
function Pane(props: PaneProps) {
  const compose = useComposeState();
  return (
    <ComposeProvider value={compose}>
      <button type="button" onClick={() => compose.openTarget({ kind: 'approve' })}>
        open
      </button>
      {compose.open !== null && (
        <Composer
          target={{ kind: 'approve' }}
          title="Approve with a note"
          hint="on a1b2c3d, cannot be undone"
          submit="Approve with note"
          variant="safe"
          write="approve"
          submitTitle="Approves on GitHub with this note."
          sending={false}
          drafting={false}
          draft={props.draft}
          draftsOnOpen={props.draftsOnOpen ?? true}
          send={props.send ?? (async () => true)}
        />
      )}
    </ComposeProvider>
  );
}

/** The same composer wired to the real actions, so drafts go through the API and errors through the toast. */
function WiredPane() {
  const actions = useActions();
  return (
    <>
      <Pane draft={(gist, quiet) => actions.draftReviewNote('acme/app#1', 'approve', gist, quiet)} />
      <Toast onShowActionLog={() => {}} />
    </>
  );
}

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

/**
 * Answers the footer lock's state, and optionally the tools status and the
 * review note draft (a failing one by default); everything else never answers.
 */
function stubWrites(enabled: boolean, options: { agentOn?: boolean; draftCalls?: string[] } = {}) {
  const status: GitHubWritesStatus = { enabled, forcedOffReason: null, pending: [] };
  vi.stubGlobal('fetch', (url: string) => {
    const path = String(url);
    if (path.endsWith('/api/github-writes')) {
      return json(status);
    }
    if (path.endsWith('/api/tools') && options.agentOn !== undefined) {
      return json({ agentOn: options.agentOn, canSync: true, gh: { state: 'ok' }, claude: { state: options.agentOn ? 'ok' : 'missing' }, checkedAt: null, nextCheckAt: null });
    }
    if (path.endsWith('/draft-review-note') && options.draftCalls) {
      options.draftCalls.push(path);
      return json({ error: 'claude is not installed' }, 500);
    }
    return new Promise(() => {});
  });
}

function renderPane(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ActionsProvider>{node}</ActionsProvider>
    </QueryClientProvider>,
  );
}

function box(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: 'Approve with a note' });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Composer drafting on open', () => {
  it('asks the agent once when a review note opens empty, even under StrictMode, and fills the box', async () => {
    stubWrites(true);
    const draft = vi.fn<Draft>(async () => 'Looks good.');
    renderPane(
      <StrictMode>
        <Pane draft={draft} />
      </StrictMode>,
    );
    fireEvent.click(screen.getByText('open'));

    await waitFor(() => expect(box().value).toBe('Looks good.'));
    expect(draft).toHaveBeenCalledTimes(1);
    expect(draft).toHaveBeenCalledWith('', true);
  });

  it('never drafts over a kept draft', async () => {
    stubWrites(true);
    const draft = vi.fn<Draft>(async () => 'Looks good.');
    renderPane(<Pane draft={draft} />);
    fireEvent.click(screen.getByText('open'));
    await waitFor(() => expect(box().value).toBe('Looks good.'));
    fireEvent.change(box(), { target: { value: 'My own words' } });
    fireEvent.keyDown(box(), { key: 'Escape' });

    fireEvent.click(screen.getByText('open'));

    expect(box().value).toBe('My own words');
    expect(draft).toHaveBeenCalledTimes(1);
  });

  it('does not draft while the write is blocked', async () => {
    stubWrites(false);
    const draft = vi.fn<Draft>(async () => 'Looks good.');
    renderPane(<Pane draft={draft} />);
    fireEvent.click(screen.getByText('open'));

    await waitFor(() => expect(screen.getByText('Approve with note').closest('button')?.title).toContain('GitHub writes are off'));
    expect(draft).not.toHaveBeenCalled();
  });

  it('leaves a composer without draftsOnOpen empty', async () => {
    stubWrites(true);
    const draft = vi.fn<Draft>(async () => 'Looks good.');
    renderPane(<Pane draft={draft} draftsOnOpen={false} />);
    fireEvent.click(screen.getByText('open'));

    await waitFor(() => expect(screen.getByText('Approve with note').closest('button')?.title).toBe('Approves on GitHub with this note.'));
    expect(draft).not.toHaveBeenCalled();
    expect(box().value).toBe('');
  });

  it('tells the send whether the note is the agent draft or an edited one', async () => {
    stubWrites(true);
    const send = vi.fn<Send>(async () => true);
    renderPane(<Pane draft={async () => 'Looks good.'} send={send} />);
    fireEvent.click(screen.getByText('open'));
    await waitFor(() => expect(box().value).toBe('Looks good.'));

    fireEvent.click(screen.getByText('Approve with note'));
    await waitFor(() => expect(send).toHaveBeenCalledWith('Looks good.', 'agent'));

    // Sent: the next opening drafts again, and an edit counts as edited.
    fireEvent.click(screen.getByText('open'));
    await waitFor(() => expect(box().value).toBe('Looks good.'));
    fireEvent.change(box(), { target: { value: 'Looks good. Watch the cron.' } });
    fireEvent.click(screen.getByText('Approve with note'));
    await waitFor(() => expect(send).toHaveBeenLastCalledWith('Looks good. Watch the cron.', 'agent_edited'));
  });

  it('fails quietly on open, but shows the error when the user asked for the draft', async () => {
    const draftCalls: string[] = [];
    stubWrites(true, { draftCalls });
    renderPane(<WiredPane />);
    fireEvent.click(screen.getByText('open'));

    await waitFor(() => expect(draftCalls).toHaveLength(1));
    await waitFor(() => expect(box().placeholder).toBe('Or write it yourself (a gist is enough for a rewrite)'));
    expect(box().value).toBe('');
    expect(screen.queryByText(/Draft failed/)).toBeNull();

    fireEvent.click(screen.getByText('Draft with agent'));
    await waitFor(() => expect(screen.getByText(/Draft failed: claude is not installed/)).toBeTruthy());
    expect(draftCalls).toHaveLength(2);
  });

  it('does not draft on open while the agent is known to be off', async () => {
    const draftCalls: string[] = [];
    stubWrites(true, { agentOn: false, draftCalls });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // The tools status is in before the composer opens, as it is in the app.
    await client.fetchQuery({ queryKey: queryKeys.tools, queryFn: () => request('GET', '/api/tools') });
    render(
      <QueryClientProvider client={client}>
        <ActionsProvider>
          <WiredPane />
        </ActionsProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('open'));

    await waitFor(() => expect(screen.getByText('Approve with note').closest('button')?.title).toBe('Approves on GitHub with this note.'));
    expect(draftCalls).toEqual([]);
  });
});
