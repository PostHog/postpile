// whats_on_me and pr_context read the app's database from another process
// (the MCP server's read-only engine). When the app fetches a PR again or
// writes its glance, both must name the move of what is stored now, and
// whats_on_me says when each PR was fetched. Reported 2026-10-08: during a
// sync whats_on_me said "Your move: Review for team-devex" and pr_context,
// seconds later and on a PR fetched 7 s before, "Nobody's move".
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FullPr, Glance, RecordedSyncProgress, SyncReport, Viewer } from '@postpile/core';
import { makePr, makeThreadFor } from '@postpile/core/fixtures';
import { createEngine, type EngineService } from '@postpile/engine';
import { Store } from '@postpile/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prContext, whatsOnMe, type QueueOptions, type ReadContext } from './reads.ts';

const VIEWER: Viewer = { login: 'alice', teams: ['acme/team-platform'] };
const NOW = new Date('2026-09-01T10:00:00Z');
const LIST: QueueOptions = { limit: 25, offset: 0, state: 'open', repo: null, whoseMove: 'any', authorScope: 'any' };
const TEAM_REVIEW = 'Review for team-platform';

function teamRequested(overrides: Partial<FullPr> = {}): FullPr {
  return makePr({ number: 7, author: 'bob', reviewerTeams: ['acme/team-platform'], updatedAt: '2026-09-01T09:00:00Z', ...overrides });
}

function notYoursGlance(prKey: string): Glance {
  return {
    prKey,
    verdict: 'NOT_YOURS',
    forYou: 'Routed to the team; nothing in it touches your area.',
    does: 'Renames a flag.',
    risk: 'low',
    othersSaid: '',
    keyFiles: [],
    pullInReason: null,
    dossierVersion: null,
    inputHash: 'hash',
    model: 'test',
    createdAt: '2026-09-01T09:59:00Z',
  };
}

describe('MCP reads next to the running app', () => {
  let dir: string;
  let app: Store;
  let reader: EngineService;
  let ctx: ReadContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'postpile-mcp-fresh-'));
    const paths = { databaseFile: join(dir, 'db.sqlite'), instructionsFile: join(dir, 'instructions.md') };
    // The app's connection writes; the MCP server reads through its own, read-only.
    app = Store.open(paths.databaseFile);
    app.meta.set('viewer', JSON.stringify(VIEWER));
    const pr = teamRequested();
    app.prs.upsert(pr, '2026-09-01T09:50:00Z');
    app.notifications.upsertMany([makeThreadFor(pr)]);
    reader = createEngine({ paths, withoutLock: true });
    ctx = { reader, now: () => NOW, appRunning: () => true };
  });

  afterEach(async () => {
    await reader.close();
    app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('whats_on_me says when each PR was fetched', async () => {
    const list = await whatsOnMe(ctx, LIST);
    expect(list.text).toContain(TEAM_REVIEW);
    expect(list.text).toContain('acme/app#7) · topic Unsorted (unsorted) · fetched 10 min ago');
  });

  it('lists no siblings for a PR in Unsorted: its PRs have nothing to do with each other', async () => {
    const other = makePr({ number: 8, author: 'bob', title: 'Unrelated' });
    app.prs.upsert(other, '2026-09-01T09:50:00Z');
    app.notifications.upsertMany([makeThreadFor(other)]);
    const detail = (await prContext(ctx, 'acme/app#7', 'brief')).text;
    expect(detail).toContain('In Unsorted (not a real topic; each sync places these PRs in one): no siblings listed.');
    expect(detail).not.toContain('Other PRs in this topic');
    expect(detail).not.toContain('acme/app#8');
  });

  it('agree on the move after the app fetched the PR again', async () => {
    expect((await whatsOnMe(ctx, LIST)).text).toContain(TEAM_REVIEW);
    expect((await prContext(ctx, 'acme/app#7', 'brief')).text).toContain(`Your move: ${TEAM_REVIEW}`);

    // The live poll fetches it again: the team's request is gone.
    app.prs.upsert(teamRequested({ reviewerTeams: [], updatedAt: '2026-09-01T09:59:00Z' }), '2026-09-01T09:59:53Z');

    expect((await whatsOnMe(ctx, LIST)).text).not.toContain(TEAM_REVIEW);
    const detail = (await prContext(ctx, 'acme/app#7', 'brief')).text;
    expect(detail).toContain("Nobody's move");
    expect(detail).toContain('fetched this PR from GitHub 7 s ago');
  });

  it('agree on the move after the app wrote a NOT_YOURS glance', async () => {
    expect((await whatsOnMe(ctx, LIST)).text).toContain(TEAM_REVIEW);

    // The sync's glance step: the team's request is not for the viewer.
    app.glances.put(notYoursGlance('acme/app#7'));

    expect((await whatsOnMe(ctx, LIST)).text).not.toContain(TEAM_REVIEW);
    expect((await prContext(ctx, 'acme/app#7', 'brief')).text).toContain("Nobody's move");
  });

  it('show a running full sync in the header, and the finished one after it', async () => {
    const progress: RecordedSyncProgress = {
      startedAt: '2026-09-01T09:58:00Z',
      running: ['dossiers', 'glances'],
      agentCallsDone: 3,
      agentCallsPlanned: 9,
      fromGitHub: { prsFetched: 40, newEvents: 12 },
      savedAt: '2026-09-01T09:59:58Z',
    };
    app.meta.set('sync_progress', JSON.stringify(progress));
    const running = (await whatsOnMe(ctx, LIST)).text;
    expect(running).toContain('Full sync running since 2026-09-01 09:58 UTC: step dossiers, glances; 40 PRs read from GitHub; 3 of 9 agent calls done so far.');
    expect(running.indexOf('Full sync running')).toBeLessThan(running.indexOf('<postpile-data'));

    // Closed app, or one that stopped writing it: a leftover, not shown.
    expect((await whatsOnMe({ ...ctx, appRunning: () => false }, LIST)).text).not.toContain('Full sync running');
    expect((await whatsOnMe({ ...ctx, now: () => new Date('2026-09-01T10:05:00Z') }, LIST)).text).not.toContain('Full sync running');

    // The sync ends: the app stores its report and removes the progress.
    const report: Partial<SyncReport> = { startedAt: progress.startedAt, finishedAt: '2026-09-01T10:00:30Z', errors: [] };
    app.meta.set('last_sync_report', JSON.stringify(report));
    app.meta.delete('sync_progress');
    const done = (await whatsOnMe({ ...ctx, now: () => new Date('2026-09-01T10:01:00Z') }, LIST)).text;
    expect(done).not.toContain('Full sync running');
    expect(done).toContain('Its last full sync finished at 2026-09-01 10:00 UTC');
  });
});
