// stamphog's verdict in MCP answers (DESIGN.md "An agent approver's
// decline" › In MCP answers). Seen 2026-10-30: an agent asked "what does my
// team need approved, starting with what stamphog denied" and could not
// tell a decline from no review, since stamphog posts a COMMENTED review.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FullPr, Viewer } from '@postpile/core';
import { makeComment, makePr, makeReview, makeThreadFor } from '@postpile/core/fixtures';
import { createEngine, type EngineService } from '@postpile/engine';
import { Store } from '@postpile/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prContext, searchPrs, whatsOnMe, type QueueOptions, type ReadContext } from './reads.ts';

const VIEWER: Viewer = { login: 'alice', teams: ['acme/team-platform'] };
const NOW = new Date('2026-09-01T10:00:00Z');
const LIST: QueueOptions = { limit: 25, offset: 0, state: 'open', repo: null, whoseMove: 'any', agentVerdict: 'any', authorScope: 'any' };
const UPDATED = '2026-09-01T09:00:00Z';
const BOT = 'stamphog[bot]';

const GATES_DECLINE = [
  '**Not approved yet — waiting on the conditions below.**',
  '',
  'Re-add the `stamphog` label to request another review once you have addressed this.',
  '',
  'Too large for an auto-approval.',
  '',
  '<details><summary>Gates</summary>',
  '',
  '| gate | result | detail |',
  '| --- | --- | --- |',
  '| prerequisites | ✓ | ok |',
  '| size | ✗ | too large |',
  '',
  '</details>',
].join('\n');

const APPROVED = '**Approved.**\n\nSmall and covered by tests.';

/** A PR with one stamphog verdict review on `commitOid`, stored like the reader does (review plus review comment). */
function withVerdict(number: number, body: string, overrides: Partial<FullPr> = {}, commitOid = 'head'): FullPr {
  const id = `r-${number}`;
  return makePr({
    number,
    author: 'bob',
    headOid: 'head',
    reviewDecision: 'REVIEW_REQUIRED',
    updatedAt: UPDATED,
    reviews: [makeReview({ id, author: BOT, state: body === APPROVED ? 'APPROVED' : 'COMMENTED', body, submittedAt: '2026-09-01T08:00:00Z', commitOid })],
    comments: [makeComment({ id, author: BOT, body, kind: 'review', createdAt: '2026-09-01T08:00:00Z' })],
    ...overrides,
  });
}

describe('MCP: agent approver verdicts', () => {
  let dir: string;
  let app: Store;
  let reader: EngineService;
  let ctx: ReadContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'postpile-mcp-verdict-'));
    const paths = { databaseFile: join(dir, 'db.sqlite'), instructionsFile: join(dir, 'instructions.md') };
    app = Store.open(paths.databaseFile);
    app.meta.set('viewer', JSON.stringify(VIEWER));
    reader = createEngine({ paths, withoutLock: true });
    ctx = { reader, now: () => NOW, appRunning: () => true };
  });

  afterEach(async () => {
    await reader.close();
    app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function store(pr: FullPr): void {
    app.prs.upsert(pr, UPDATED);
    app.notifications.upsertMany([makeThreadFor(pr, { reason: 'review_requested' })]);
  }

  it('says a decline, its failed gates, its reasons and that nobody is asked in pr_context', async () => {
    store(withVerdict(1, GATES_DECLINE));
    const text = (await prContext(ctx, 'acme/app#1', 'brief')).text;
    expect(text).toContain('Agent approver: stamphog declined: outside what it may auto-approve (failed: size) (2026-09-01)');
    expect(text).toContain('Its reasons: Too large for an auto-approval.');
    expect(text).toContain('ask a person to review');
    expect(text).toContain('Nobody is asked to review it');
    // GitHub text stays inside the fence.
    expect(text.indexOf('Its reasons')).toBeGreaterThan(text.indexOf('<postpile-data'));

    const json = (await prContext(ctx, 'acme/app#1', 'brief', 'json')).structured as { prs: { agentVerdict: unknown; untrusted: { agentVerdict: unknown } }[] };
    expect(json.prs[0]?.agentVerdict).toEqual({
      agent: 'stamphog',
      verdict: 'declined',
      declineKind: 'gates',
      at: '2026-09-01T08:00:00Z',
      olderHead: false,
      nobodyAsked: true,
      authorCan: 'ask_person',
    });
    expect(json.prs[0]?.untrusted.agentVerdict).toEqual({ failedGates: ['size'], reason: 'Too large for an auto-approval.' });
  });

  it('says re-adding the label re-runs a verdict made on an older head', async () => {
    store(withVerdict(2, GATES_DECLINE, { reviewerUsers: ['carol'] }, 'old'));
    const text = (await prContext(ctx, 'acme/app#2', 'full')).text;
    expect(text).toContain('stamphog declined: outside what it may auto-approve (failed: size), on an older head');
    expect(text).toContain('re-adding the `stamphog` label re-runs it');
    // carol is asked: not stuck.
    expect(text).not.toContain('Nobody is asked to review it');
  });

  it('filters whats_on_me and search_prs by the verdict and names it on the PR line', async () => {
    store(withVerdict(3, GATES_DECLINE, { reviewerUsers: ['alice'] }));
    store(withVerdict(4, APPROVED, { reviewerUsers: ['alice'] }));
    store(makePr({ number: 5, author: 'bob', reviewerUsers: ['alice'], updatedAt: UPDATED }));

    const all = (await whatsOnMe(ctx, LIST)).text;
    expect(all).toContain('acme/app#3 by bob');
    expect(all).toContain('stamphog declined: outside what it may auto-approve (failed: size)');
    expect(all).toContain('acme/app#5');

    const declined = (await whatsOnMe(ctx, { ...LIST, agentVerdict: 'declined' })).text;
    expect(declined).toContain('acme/app#3');
    expect(declined).not.toContain('acme/app#4');
    expect(declined).not.toContain('acme/app#5');
    expect(declined).toContain('agent verdict declined');

    const approved = (await whatsOnMe(ctx, { ...LIST, agentVerdict: 'approved' }, 'json')).structured as { rows: { prs: { key: string }[] }[] };
    expect(approved.rows.flatMap((row) => row.prs.map((pr) => pr.key))).toEqual(['acme/app#4']);

    const search = (await searchPrs(ctx, 'bob', { ...LIST, agentVerdict: 'declined' })).text;
    expect(search).toContain('acme/app#3');
    expect(search).toContain('· stamphog declined');
    expect(search).not.toContain('acme/app#4');
  });
});
