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
import { PaneDrafts, type ComposeTarget } from '../lib/pane-drafts.ts';

// A fresh store per test: drafts outlive the pane in the app.
let drafts = new PaneDrafts();
import { Toast } from './Toast.tsx';

// jsdom has no layout: the composer scrolls itself into view on open.
Element.prototype.scrollIntoView = () => {};

type Draft = (gist: string, quiet?: boolean) => Promise<string | null>;
type Send = (body: string, source: string) => Promise<boolean>;

interface PaneProps {
  draft: Draft;
  send?: Send;
  draftsOnOpen?: boolean;
  /** Approve with a note unless set. */
  target?: ComposeTarget;
  closesOnClick?: boolean;
}

/** An "Approve with a note" composer behind an open button, like the review row's "+ note". */
function Pane(props: PaneProps) {
  const compose = useComposeState('acme/app#1', drafts);
  return (
    <ComposeProvider value={compose}>
      <button type="button" aria-expanded={compose.open !== null} onClick={() => compose.openTarget(props.target ?? { kind: 'approve' })}>
        open
      </button>
      {compose.open !== null && (
        <Composer
          target={props.target ?? { kind: 'approve' }}
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
          closesOnClick={props.closesOnClick}
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
  drafts = new PaneDrafts();
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

describe('Composer keyboard, focus and agent draft line', () => {
  it('says the text is the agent draft until the user edits it', async () => {
    stubWrites(true);
    renderPane(<Pane draft={async () => 'Looks good.'} />);
    fireEvent.click(screen.getByText('open'));

    await waitFor(() => expect(screen.getByText('✨ Agent draft, edit before sending')).toBeTruthy());
    fireEvent.change(box(), { target: { value: 'Looks good, ship it.' } });
    expect(screen.queryByText('✨ Agent draft, edit before sending')).toBeNull();
  });

  it('sends a comment review on Meta+Enter and Ctrl+Enter, never Approve with a note', async () => {
    stubWrites(true);
    const send = vi.fn<Send>(async () => false);
    renderPane(<Pane draft={async () => 'Looks good.'} send={send} />);
    fireEvent.click(screen.getByText('open'));
    await waitFor(() => expect(box().value).toBe('Looks good.'));
    fireEvent.keyDown(box(), { key: 'Enter', metaKey: true });
    expect(send).not.toHaveBeenCalled();
    cleanup();

    renderPane(<Pane draft={async () => null} send={send} draftsOnOpen={false} target={{ kind: 'comment' }} />);
    fireEvent.click(screen.getByText('open'));
    const field = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Approve with a note' });
    // Nothing to send yet: the chord does nothing.
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    fireEvent.change(field, { target: { value: 'Why the retry?' } });
    await waitFor(() => expect(screen.getByText('Approve with note').closest('button')?.disabled).toBe(false));
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenCalledWith('Why the retry?', 'own');
  });

  it('gives focus back to the opener on Escape, and puts the caret after a kept draft', () => {
    stubWrites(true);
    renderPane(<Pane draft={async () => null} draftsOnOpen={false} target={{ kind: 'comment' }} />);
    const opener = screen.getByText('open');
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(box());
    fireEvent.change(box(), { target: { value: 'Half a thought' } });
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    expect(document.activeElement).toBe(box());
    expect(box().selectionStart).toBe('Half a thought'.length);
  });

  it('keeps focus in the field while the agent drafts on open', async () => {
    stubWrites(true);
    renderPane(<Pane draft={async () => 'Looks good.'} />);
    fireEvent.click(screen.getByText('open'));

    await waitFor(() => expect(box().value).toBe('Looks good.'));
    expect(document.activeElement).toBe(box());
  });

  it('brings a note that closed on click back when its send failed', async () => {
    stubWrites(true);
    let answer: (sent: boolean) => void = () => {};
    const send = vi.fn<Send>(() => new Promise<boolean>((resolve) => (answer = resolve)));
    renderPane(<Pane draft={async () => 'Looks good.'} send={send} closesOnClick />);
    fireEvent.click(screen.getByText('open'));
    await waitFor(() => expect(box().value).toBe('Looks good.'));

    fireEvent.click(screen.getByText('Approve with note'));
    expect(screen.queryByRole('textbox')).toBeNull();
    answer(false);

    await waitFor(() => expect(box().value).toBe('Looks good.'));
  });

  it('puts the agent pill before the box in the tab order', () => {
    stubWrites(true);
    renderPane(<Pane draft={async () => null} draftsOnOpen={false} />);
    fireEvent.click(screen.getByText('open'));
    const controls = screen.getByRole('group', { name: 'Approve with a note' }).querySelectorAll('button, textarea');
    expect(controls[0]?.textContent).toContain('Draft with agent');
    expect(controls[1]).toBe(box());
  });
});
