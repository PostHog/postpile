// whats_on_me lists every unread PR and says what clears each row (DESIGN.md
// "MCP server" › whats_on_me). Seen 2026-11-02: an agent clearing the inbox
// made about 60 mark_read calls and the app's numbers barely moved, since
// whats_on_me only read topics the sidebar lights up, skipped snoozed tiles
// with an unread thread, and never said that marking read leaves a review
// request standing.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inboxTotals, type FullPr, type Viewer } from '@postpile/core';
import { makePr, makeThreadFor } from '@postpile/core/fixtures';
import { createEngine, type EngineService } from '@postpile/engine';
import { Store } from '@postpile/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { searchPrs, whatsOnMe, type QueueOptions, type ReadContext, type SearchOptions } from './reads.ts';

const VIEWER: Viewer = { login: 'alice', teams: ['acme/team-platform'] };
const NOW = new Date('2026-09-01T10:00:00Z');
const UPDATED = '2026-09-01T09:00:00Z';
const CREATED = '2026-09-01T06:00:00Z';
const MERGED_AT = '2026-09-01T08:00:00Z';
const LIST: QueueOptions = { limit: 25, offset: 0, state: 'any', repo: null, whoseMove: 'any', agentVerdict: 'any', authorScope: 'any', unreadOnly: false };
const SEARCH: SearchOptions = { limit: 25, offset: 0, state: 'any', repo: null, whoseMove: 'any', agentVerdict: 'any', unread: null };

interface CoverageJson {
  unreadTiles: number;
  unreadPrs: number;
  yourMoveTiles: number;
  listedTiles: number;
  leftOutByFilters: number;
  filters: string[];
}

interface PrMarksJson {
  unread: boolean;
  ownsMove: string | null;
  contextLayer: string | null;
}

interface QueueJson {
  coverage: CoverageJson;
  rows: { group: string; clears: string; tile: { group: string }; prs: { key: string; marks: PrMarksJson }[] }[];
}

const GROUP_ORDER = ['your_move', 'noted', 'unread', 'unread_nothing_to_do'];

describe('MCP: every unread PR in whats_on_me', () => {
  let dir: string;
  let app: Store;
  let reader: EngineService;
  let ctx: ReadContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'postpile-mcp-coverage-'));
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

  function store(pr: FullPr, unread: boolean, reason: 'review_requested' | 'subscribed' = 'subscribed'): void {
    app.prs.upsert(pr, UPDATED);
    app.notifications.upsertMany([makeThreadFor(pr, { reason, unread })]);
  }

  function merged(number: number, overrides: Partial<FullPr> = {}): FullPr {
    return makePr({ number, author: 'bob', state: 'MERGED', createdAt: CREATED, mergedAt: MERGED_AT, mergedBy: 'bob', updatedAt: UPDATED, ...overrides });
  }

  async function queueJson(options: QueueOptions = LIST): Promise<QueueJson> {
    return (await whatsOnMe(ctx, options, 'json')).structured as unknown as QueueJson;
  }

  /** A stack of three merged layers under an open top layer that asks team-platform for a review. */
  function storeStack(): void {
    store(merged(1, { headRef: 'stack-1' }), false);
    store(merged(2, { baseRef: 'stack-1', headRef: 'stack-2' }), false);
    store(merged(3, { baseRef: 'stack-2', headRef: 'stack-3' }), true);
    store(makePr({ number: 4, author: 'bob', baseRef: 'stack-3', headRef: 'stack-4', reviewerTeams: ['acme/team-platform'], createdAt: CREATED, updatedAt: UPDATED }), true, 'review_requested');
  }

  it('lists a topic whose only unread tiles are merged or closed, one line per topic with its PR keys', async () => {
    store(merged(10), true);
    store(makePr({ number: 11, author: 'bob', state: 'CLOSED', updatedAt: UPDATED }), true);

    const json = await queueJson();
    expect(json.rows.map((row) => row.group)).toEqual(['unread_nothing_to_do', 'unread_nothing_to_do']);

    const text = (await whatsOnMe(ctx, LIST)).text;
    expect(text).toContain('Unread, nothing to do (merged or closed, nothing asked) (2 tiles in total):');
    expect(text).toMatch(/- topic .*: 2 tiles · acme\/app#1[01] \(unread\), acme\/app#1[01] \(unread\) · clears: mark_read with the seen_through from pr_context/);
  });

  it('lists a snoozed tile with a thread unread on GitHub, as the app counts it', async () => {
    store(makePr({ number: 20, author: 'bob', updatedAt: UPDATED }), true);
    app.snoozes.put({ prKey: 'acme/app#20', condition: { kind: 'muted' }, since: UPDATED });

    const json = await queueJson();
    expect(json.coverage.unreadTiles).toBe(1);
    expect(json.rows).toHaveLength(1);
    expect(json.rows[0]?.tile.group).toBe('unread');

    const text = (await whatsOnMe(ctx, LIST)).text;
    expect(text).toContain('(acme/app#20)');
    expect(text).toContain('(snoozed)');
  });

  it("prints the app's own totals, each with its unit, and lists every unread tile they count", async () => {
    storeStack();
    store(merged(10), true);
    store(makePr({ number: 20, author: 'bob', updatedAt: UPDATED }), true);

    const totals = inboxTotals(await reader.listTopics({ allRepos: true }));
    const json = await queueJson();
    expect(json.coverage).toMatchObject({ ...totals, leftOutByFilters: 0, filters: [] });
    // Every tile the app counts as unread has a row, no filter set.
    expect(json.rows.filter((row) => row.tile.group === 'unread')).toHaveLength(totals.unreadTiles);

    const text = (await whatsOnMe(ctx, LIST)).text;
    expect(text).toContain(`Coverage, as the app counts in all repos: ${totals.unreadTiles} unread tiles, ${totals.unreadPrs} unread PRs, ${totals.yourMoveTiles} your-move tile`);
    expect(text).toContain('left out by filters: 0.');
    expect(text).toMatch(/Showing 1-3 of 3 tiles\./);

    const open = (await whatsOnMe(ctx, { ...LIST, state: 'open' })).text;
    expect(open).toContain('left out by filters: 1 (state open).');
  });

  it('keeps your-move rows first', async () => {
    store(merged(10), true);
    store(makePr({ number: 20, author: 'bob', updatedAt: UPDATED }), true);
    storeStack();

    const groups = (await queueJson()).rows.map((row) => row.group);
    expect(groups[0]).toBe('your_move');
    expect(groups).toEqual(groups.toSorted((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b)));
  });

  it('drops your-move tiles the user already read with unread_only', async () => {
    store(makePr({ number: 30, author: 'bob', reviewerUsers: ['alice'], updatedAt: UPDATED }), false, 'review_requested');
    store(makePr({ number: 20, author: 'bob', updatedAt: UPDATED }), true);

    expect((await queueJson()).rows.map((row) => row.group)).toEqual(['your_move', 'unread']);
    const unreadOnly = await queueJson({ ...LIST, unreadOnly: true });
    expect(unreadOnly.rows.map((row) => row.group)).toEqual(['unread']);
    expect(unreadOnly.coverage).toMatchObject({ listedTiles: 1, leftOutByFilters: 1, filters: ['unread only'] });
    expect((await whatsOnMe(ctx, { ...LIST, unreadOnly: true })).text).toContain('left out by filters: 1 (unread only).');
  });

  it('marks merged layers as context and names the PR that owns the move, and what clears it', async () => {
    storeStack();

    const text = (await whatsOnMe(ctx, LIST)).text;
    expect(text).toContain('Review for team-platform on #4 · clears: review, or remove the request on GitHub; mark_read does not');
    expect(text).toMatch(/ {2}acme\/app#1 by bob[^\n]* · context layer \(merged\) · reviews:/);
    expect(text).toMatch(/ {2}acme\/app#2 by bob[^\n]* · context layer \(merged\) · reviews:/);
    expect(text).toMatch(/ {2}acme\/app#3 by bob[^\n]* · context layer \(merged\), unread · reviews:/);
    expect(text).toMatch(/ {2}acme\/app#4 by bob[^\n]* · unread, owns the move: review · reviews:/);

    const row = (await queueJson()).rows[0];
    expect(row?.clears).toBe('review, or remove the request on GitHub; mark_read does not');
    expect(row?.prs.map((pr) => [pr.key, pr.marks])).toEqual([
      ['acme/app#1', { unread: false, ownsMove: null, contextLayer: 'merged' }],
      ['acme/app#2', { unread: false, ownsMove: null, contextLayer: 'merged' }],
      ['acme/app#3', { unread: true, ownsMove: null, contextLayer: 'merged' }],
      ['acme/app#4', { unread: true, ownsMove: 'review', contextLayer: null }],
    ]);
    // List rows never carry a mark_read token: pr_context does.
    expect(text).not.toContain('seen_through:');
  });

  it('lists unread PRs in search_prs without a query, and refuses a queryless search without a filter', async () => {
    store(merged(10), true);
    store(makePr({ number: 30, author: 'bob', updatedAt: UPDATED }), false);

    const unread = (await searchPrs(ctx, null, { ...SEARCH, unread: true })).text;
    expect(unread).toContain('acme/app#10');
    expect(unread).toContain('· unread');
    expect(unread).not.toContain('acme/app#30');
    expect(unread).toContain('Filters: unread.');

    const read = (await searchPrs(ctx, null, { ...SEARCH, unread: false })).text;
    expect(read).toContain('acme/app#30');
    expect(read).not.toContain('acme/app#10');

    const json = (await searchPrs(ctx, null, { ...SEARCH, unread: true }, 'json')).structured as { prs: { key: string; marks: PrMarksJson }[] };
    expect(json.prs.map((pr) => [pr.key, pr.marks.unread])).toEqual([['acme/app#10', true]]);

    const bare = await searchPrs(ctx, null, SEARCH);
    expect(bare.isError).toBe(true);
    expect(bare.text).toContain('search_prs(unread: true)');
  });

  it('carries the same facts in JSON as in text', async () => {
    storeStack();
    store(merged(10), true);

    const text = (await whatsOnMe(ctx, LIST)).text;
    const json = await queueJson();
    const { coverage } = json;
    expect(text).toContain(`${coverage.unreadTiles} unread tiles, ${coverage.unreadPrs} unread PRs`);
    expect(text).toContain(`Listed: ${coverage.listedTiles} tiles; left out by filters: ${coverage.leftOutByFilters}.`);
    expect(json.rows.map((row) => row.group)).toEqual(['your_move', 'unread_nothing_to_do']);
    for (const row of json.rows) {
      expect(text).toContain(`clears: ${row.clears}`);
    }
    // The JSON answer has the coverage line in its header too.
    expect((await whatsOnMe(ctx, LIST, 'json')).text).toContain('Coverage, as the app counts in all repos:');
  });
});
