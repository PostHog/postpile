// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ActionResult, GitHubWritesStatus } from '@postpile/core';
import { Toast } from '../components/Toast.tsx';
import { ActionsProvider, useActions } from './actions.tsx';

const RAW_502 = 'Approve failed: GitHub POST repos/acme/app/pulls/7/reviews failed with 502: Server Error';

function json(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body)));
}

/** Writes on; every approve waits for `answer` to be called. Everything else never answers. */
function stubApprove() {
  const answers: ((result: ActionResult) => void)[] = [];
  const status: GitHubWritesStatus = { enabled: true, forcedOffReason: null, pending: [] };
  vi.stubGlobal('fetch', (url: string) => {
    const path = String(url);
    if (path.endsWith('/api/github-writes')) {
      return json(status);
    }
    if (path.endsWith('/approve')) {
      return new Promise<Response>((resolve) => answers.push((result) => resolve(new Response(JSON.stringify(result)))));
    }
    return new Promise(() => {});
  });
  return answers;
}

function ApproveButton() {
  const actions = useActions();
  return (
    <button type="button" disabled={actions.blockedReason('approve') !== null} onClick={() => void actions.approve('acme/app#7', 'abc1234')}>
      approve
    </button>
  );
}

function renderApprove() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ActionsProvider>
        <ApproveButton />
        <Toast onShowActionLog={() => {}} />
      </ActionsProvider>
    </QueryClientProvider>,
  );
}

async function clickApprove() {
  const button = screen.getByText<HTMLButtonElement>('approve');
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('approve toast', () => {
  it('says "Approved" only once GitHub answered', async () => {
    const answers = stubApprove();
    renderApprove();
    await clickApprove();

    await waitFor(() => expect(answers).toHaveLength(1));
    expect(screen.queryByText('Approved')).toBeNull();
    answers[0]?.({ ok: true, message: 'Approved', undoToken: null });
    await waitFor(() => expect(screen.getByText('Approved')).toBeTruthy());
  });

  it('says a refused approve in plain words, with the raw line on hover and Try again', async () => {
    const answers = stubApprove();
    renderApprove();
    await clickApprove();
    await waitFor(() => expect(answers).toHaveLength(1));
    answers[0]?.({ ok: false, message: RAW_502, undoToken: null });

    const message = await screen.findByText("GitHub didn't take the approval (server error 502). Nothing was approved.");
    expect(message.getAttribute('title')).toBe(RAW_502);
    expect(screen.queryByText('Approved')).toBeNull();

    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(answers).toHaveLength(2));
  });
});
