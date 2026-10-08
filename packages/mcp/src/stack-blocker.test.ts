// The MCP names what really holds a stack and what a bot's change request
// asks for (DESIGN.md "Stacks land together"). Seen 2026-10-08: an agent read
// "Merge, it is approved" on a stack whose upper layer still waited on a
// team's review, and "Address <bot>'s changes" on a PR whose fix was an
// org-admin grant, not code.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Viewer } from '@postpile/core';
import { makeComment, makePr, makeReview, makeThreadFor } from '@postpile/core/fixtures';
import { createEngine, type EngineService } from '@postpile/engine';
import { Store } from '@postpile/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prContext, whatsOnMe, type QueueOptions, type ReadContext } from './reads.ts';

const VIEWER: Viewer = { login: 'alice', teams: ['acme/team-platform'] };
const NOW = new Date('2026-09-01T10:00:00Z');
const LIST: QueueOptions = { limit: 25, offset: 0, state: 'open', repo: null, whoseMove: 'any', authorScope: 'any' };
const UPDATED = '2026-09-01T09:00:00Z';

describe('MCP: stack blockers and bot findings', () => {
  let dir: string;
  let app: Store;
  let reader: EngineService;
  let ctx: ReadContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'postpile-mcp-stack-'));
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

  it('names the upper layer that holds an approved stack, while the bottom layer alone may merge', async () => {
    const bottom = makePr({ number: 1, author: 'alice', reviewDecision: 'APPROVED', updatedAt: UPDATED });
    const top = makePr({ number: 2, author: 'alice', baseRef: bottom.headRef, reviewerTeams: ['acme/team-security'], updatedAt: UPDATED });
    for (const pr of [bottom, top]) {
      app.prs.upsert(pr, UPDATED);
      app.notifications.upsertMany([makeThreadFor(pr, { reason: 'author' })]);
    }
    const bottomText = (await prContext(ctx, 'acme/app#1', 'brief')).text;
    expect(bottomText).toContain('Your move: Merge, it is approved');
    expect(bottomText).toContain('Its tile: ');
    expect(bottomText).toContain('Blocked: acme/team-security to review #2');
    // The approved bottom layer can still go in on its own; said once, under the tile line.
    expect(bottomText).toContain('Blocked: acme/team-security to review #2\n  acme/app#1 can land alone (approved)');
    const json = (await prContext(ctx, 'acme/app#2', 'brief', 'json')).structured as { prs: { landableBelow: unknown }[] };
    expect(json.prs[0]?.landableBelow).toEqual(['acme/app#1']);
    // Not the user's move: the stack waits on the team, so it no longer reads as a merge waiting on them.
    expect((await whatsOnMe(ctx, LIST)).text).not.toContain('Merge, it is approved');
  });

  it("says what a bot's change request found, inside the data fence", async () => {
    const body = '## Security review\n\n**acme/team-platform** has no write access, so GitHub ignores its CODEOWNERS line. An org admin can grant it.';
    const pr = makePr({
      number: 3,
      author: 'alice',
      reviewDecision: 'CHANGES_REQUESTED',
      reviews: [makeReview({ author: 'reviewbot[bot]', state: 'CHANGES_REQUESTED', body, submittedAt: UPDATED })],
      updatedAt: UPDATED,
    });
    app.prs.upsert(pr, UPDATED);
    app.notifications.upsertMany([makeThreadFor(pr, { reason: 'author' })]);
    const text = (await prContext(ctx, 'acme/app#3', 'brief')).text;
    expect(text).toContain("Your move: Address reviewbot[bot]'s changes");
    const finding = 'reviewbot[bot] asks for changes: acme/team-platform has no write access, so GitHub ignores its CODEOWNERS line.';
    expect(text).toContain(finding);
    expect(text.indexOf(finding)).toBeGreaterThan(text.indexOf('<postpile-data'));
    // The JSON answer carries it too, under "untrusted": it is GitHub text.
    const json = (await prContext(ctx, 'acme/app#3', 'brief', 'json')).structured as { prs: { untrusted: { botFindings: unknown } }[] };
    expect(json.prs[0]?.untrusted.botFindings).toEqual([
      { by: 'reviewbot[bot]', summary: 'acme/team-platform has no write access, so GitHub ignores its CODEOWNERS line.' },
    ]);
  });

  it('reads the finding from the inline comment when the review text only points there, after a store round trip', async () => {
    // Seen in 0.27.0 on live data: "<bot> asks for changes: Agent-driven security review - findings inline."
    const bot = 'guardbot[bot]';
    const review = makeReview({ id: 'rev-4', author: bot, state: 'CHANGES_REQUESTED', body: 'Automated policy review - findings inline.', submittedAt: UPDATED });
    const comment = makeComment({
      id: 'c-4',
      author: bot,
      kind: 'review_comment',
      path: 'src/plugins.ts',
      threadId: 'th-4',
      reviewId: 'rev-4',
      createdAt: UPDATED,
      body: '**The plugin allowlist is never checked: team-plugins has no write grant.**\n\nSo GitHub ignores its CODEOWNERS line.',
    });
    const pr = makePr({
      number: 4,
      author: 'alice',
      reviewDecision: 'CHANGES_REQUESTED',
      reviews: [review],
      comments: [comment],
      threads: [{ id: 'th-4', path: 'src/plugins.ts', isResolved: false, comments: [comment] }],
      updatedAt: UPDATED,
    });
    app.prs.upsert(pr, UPDATED);
    app.notifications.upsertMany([makeThreadFor(pr, { reason: 'author' })]);
    const text = (await prContext(ctx, 'acme/app#4', 'brief')).text;
    expect(text).toContain('guardbot[bot] asks for changes: The plugin allowlist is never checked: team-plugins has no write grant.');
  });
});
