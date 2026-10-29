// Scouted PRs in the MCP answers (DESIGN.md "Scouts"): pr_context says who
// scouted it and why, whats_on_me lists them in a group of their own after
// everything that waits on the user, search_prs marks them.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScoutedPr, Viewer } from '@postpile/core';
import { makePr } from '@postpile/core/fixtures';
import { createEngine, type EngineService } from '@postpile/engine';
import { Store } from '@postpile/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prContext, searchPrs, whatsOnMe, type QueueOptions, type ReadContext } from './reads.ts';

const VIEWER: Viewer = { login: 'alice', teams: ['acme/team-platform'] };
const NOW = new Date('2026-09-01T10:00:00Z');
const UPDATED = '2026-09-01T09:00:00Z';
const LIST: QueueOptions = { limit: 25, offset: 0, state: 'open', repo: null, whoseMove: 'any', authorScope: 'any' };

function scouted(prKey: string): ScoutedPr {
  return {
    prKey,
    scoutId: 'lookout',
    scoutName: 'Lookout',
    configVersion: 1,
    reason: 'adds a new top-level folder billing/',
    pulledAt: UPDATED,
    seenUpdatedAt: null,
    followedAt: null,
    dismissedAt: null,
    dismissReason: null,
    expiredAt: null,
    expiryReason: null,
  };
}

describe('MCP: scouted PRs', () => {
  let dir: string;
  let app: Store;
  let reader: EngineService;
  let ctx: ReadContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'postpile-mcp-scouted-'));
    const paths = { databaseFile: join(dir, 'db.sqlite'), instructionsFile: join(dir, 'instructions.md') };
    app = Store.open(paths.databaseFile);
    app.meta.set('viewer', JSON.stringify(VIEWER));
    const pr = makePr({ number: 40, author: 'carol', title: 'Billing service skeleton', updatedAt: UPDATED });
    app.prs.upsert(pr, UPDATED);
    app.scoutedPrs.insert(scouted(pr.key));
    reader = createEngine({ paths, withoutLock: true });
    ctx = { reader, now: () => NOW, appRunning: () => true };
  });

  afterEach(async () => {
    await reader.close();
    app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('says in pr_context who scouted the PR and why, inside the fence, and answers it on its own', async () => {
    const text = (await prContext(ctx, 'acme/app#40', 'brief')).text;
    const line = "Scouted by Lookout: adds a new top-level folder billing/. Not in the user's GitHub inbox.";
    expect(text).toContain(line);
    expect(text.indexOf(line)).toBeGreaterThan(text.indexOf('<postpile-data'));
    expect(text).not.toContain('Topic: Lookout');
    const json = (await prContext(ctx, 'acme/app#40', 'brief', 'json')).structured as { prs: { scouted: unknown; untrusted: { scouted: unknown } }[] };
    expect(json.prs[0]?.scouted).toEqual({ scoutId: 'lookout', inInbox: false, tracked: false, onScoutedSection: true, followed: false });
    expect(json.prs[0]?.untrusted.scouted).toEqual({ scoutName: 'Lookout', reason: 'adds a new top-level folder billing/' });
  });

  it('lists scouted tiles in whats_on_me in their own group, never as a move', async () => {
    const answer = await whatsOnMe(ctx, LIST);
    expect(answer.text).toContain('Nothing waits on the user right now');
    expect(answer.text).toContain("Scouted (not in the user's GitHub inbox; nothing is asked of them) (1 in total):");
    expect(answer.text).toContain('(acme/app#40) · scouted by Lookout · unseen');
    expect(answer.text).toContain('why: adds a new top-level folder billing/');
    expect((await whatsOnMe(ctx, { ...LIST, whoseMove: 'you' })).text).not.toContain('Scouted');
    const json = (await whatsOnMe(ctx, LIST, 'json')).structured as { rows: unknown[]; scouted: { prs: string[]; unseen: boolean }[]; scoutedPage: { total: number } };
    expect(json.rows).toEqual([]);
    expect(json.scouted).toMatchObject([{ prs: ['acme/app#40'], unseen: true }]);
    expect(json.scoutedPage).toMatchObject({ total: 1 });
    // Paged like the list above: offset 1 is past the one scouted tile.
    expect(((await whatsOnMe(ctx, { ...LIST, offset: 1 }, 'json')).structured as { scouted: unknown[] }).scouted).toEqual([]);
  });

  it('finds scouted PRs in search_prs, marked as such', async () => {
    const text = (await searchPrs(ctx, 'billing', { limit: 25, offset: 0, state: 'any', repo: null, whoseMove: 'any' })).text;
    expect(text).toContain("acme/app#40");
    expect(text).toContain("scouted by Lookout, not in the user's inbox");
    // No scout:<id> as a topic reference: the topic tool cannot open one, and pr_context leaves it out too.
    const json = (await searchPrs(ctx, 'billing', { limit: 25, offset: 0, state: 'any', repo: null, whoseMove: 'any' }, 'json')).structured as { prs: { key: string; topic: unknown }[] };
    expect(json.prs.find((pr) => pr.key === 'acme/app#40')?.topic).toBeNull();
  });

  it('tells PostPile tracking it apart from the GitHub inbox once followed', async () => {
    app.scoutedPrs.markFollowed('acme/app#40', UPDATED);
    app.foundPrs.put({ prKey: 'acme/app#40', via: 'followed', reason: 'followed from scout "Lookout"', foundAt: UPDATED });
    const json = (await prContext(ctx, 'acme/app#40', 'brief', 'json')).structured as { prs: { scouted: unknown }[] };
    expect(json.prs[0]?.scouted).toEqual({ scoutId: 'lookout', inInbox: false, tracked: true, onScoutedSection: false, followed: true });
  });
});

