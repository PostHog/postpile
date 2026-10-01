import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeThreadFor } from '@postpile/core/fixtures';
import { Store } from '@postpile/store';
import { contextHashKey } from '../digest/dossiers.ts';
import { REJUDGE_ASKS_KEY } from '../digest/event-batches.ts';
import { glanceGapKey } from '../digest/glance-batches.ts';
import { LAST_SYNC_REPORT_KEY } from '../last-sync-report.ts';
import { lookCloserMetaKey } from '../live/glance-pings.ts';
import { relationOverrideKey } from '../memory/placement.ts';
import { makeHarness, type Harness } from '../testing/fakes.ts';
import { reviewRequestedPr } from '../testing/prs.ts';
import { makeTopic, topicWithPrs } from '../testing/topics.ts';
import { ArmDatabase } from './arm-database.ts';
import { AGENT_META_PREFIXES, KEPT_TABLES, startFresh, WIPED_TABLES } from './fresh-start.ts';
import { readArmSnapshot } from './snapshot.ts';

const PR1 = reviewRequestedPr(1);
const PR2 = reviewRequestedPr(2);
const PR3 = reviewRequestedPr(3);

function count(store: Store, table: string): number {
  return (store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'postpile-simulate-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A synced database on disk: topic "ci" with two PRs, one PR in Unsorted, dossier and glances from the fake agent. */
async function syncedHarness(): Promise<Harness> {
  const h = makeHarness({ store: Store.open(join(dir, 'source.sqlite')) });
  topicWithPrs(h, 'ci', [PR1, PR2]);
  h.reader.addPr(PR3, makeThreadFor(PR3));
  await h.engine.sync({ agentJobs: ['dossiers', 'glances', 'events'] });
  return h;
}

describe('startFresh', () => {
  it('keeps GitHub data and user state, removes what the agent wrote', async () => {
    const h = await syncedHarness();
    const store = h.store;
    const userEvent = store.events.listForPr(PR1.key)[0];
    const agentEvent = store.events.listForPr(PR2.key)[0];
    store.events.setOverride(userEvent!.id, { loudness: 'loud', reason: 'always tell me', by: 'user' });
    store.events.setOverride(agentEvent!.id, { loudness: 'quiet', reason: 'bot noise', by: 'agent' });
    store.feedback.add({ kind: 'not_mine', topicId: 'ci', tileId: `pr:${PR1.key}`, prKey: PR1.key, setId: null, eventId: null, note: '', createdAt: '2026-09-02T12:00:00Z' });
    store.feedback.add({ kind: 'not_mine', topicId: null, tileId: null, prKey: PR3.key, setId: null, eventId: null, note: '', createdAt: '2026-09-02T12:00:00Z' });
    store.meta.set(glanceGapKey(PR3.key), '{}');
    store.db.prepare("INSERT INTO pr_snooze (pr_key, condition_json, since) VALUES (?, '{}', '2026-09-02T12:00:00Z')").run(PR1.key);
    const events = count(store, 'pr_event');
    const logged = count(store, 'event_log');
    expect(count(store, 'pr_glance')).toBeGreaterThan(0);
    expect(count(store, 'topic_dossier')).toBeGreaterThan(0);
    expect(count(store, 'agent_call')).toBeGreaterThan(0);

    startFresh(store);

    for (const table of ['topic', 'topic_membership', 'pr_glance', 'topic_dossier', 'cursor', 'agent_call', 'pr_snooze', 'pr_set']) {
      expect(count(store, table), table).toBe(0);
    }
    expect(count(store, 'pr')).toBe(3);
    expect(count(store, 'notification_thread')).toBe(3);
    expect(count(store, 'pr_event')).toBe(events);
    expect(count(store, 'event_log')).toBe(logged);
    expect(store.events.listForPr(PR1.key)[0]?.override).toMatchObject({ by: 'user', loudness: 'loud' });
    expect(store.events.listForPr(PR2.key)[0]?.override).toBeNull();
    expect(count(store, 'feedback')).toBe(1);
    expect(store.meta.get(glanceGapKey(PR3.key))).toBeNull();
    expect(store.meta.get('viewer')).not.toBeNull();
    expect(store.meta.get('github_writes')).toBe('off');
    store.close();
  });

  it('names every table of the schema as kept or wiped', () => {
    const store = Store.open(':memory:');
    const tables = (store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'sqlite_sequence'").all() as { name: string }[]).map((row) => row.name);
    const unnamed = tables.filter((table) => !(table in KEPT_TABLES) && !(table in WIPED_TABLES));
    expect(unnamed).toEqual([]);
    store.close();
  });

  it('lists a prefix for every agent meta key', () => {
    const keys = [contextHashKey('ci'), glanceGapKey(PR1.key), relationOverrideKey('ci'), lookCloserMetaKey(PR1.key), REJUDGE_ASKS_KEY, `${REJUDGE_ASKS_KEY}:ci`, LAST_SYNC_REPORT_KEY];
    const prefixes = Object.keys(AGENT_META_PREFIXES);
    expect(keys.filter((key) => !prefixes.some((prefix) => key.startsWith(prefix)))).toEqual([]);
  });
});

describe('ArmDatabase', () => {
  async function freshBase(): Promise<string> {
    const h = await syncedHarness();
    startFresh(h.store);
    h.store.close();
    return join(dir, 'source.sqlite');
  }

  it('hides PRs and reveals a round with event log seqs after every cursor', async () => {
    const base = await freshBase();
    const baseStore = Store.open(base);
    const baseMaxSeq = baseStore.eventLog.maxSeq();
    baseStore.close();
    copyFileSync(base, join(dir, 'arm.sqlite'));
    const arm = ArmDatabase.open(join(dir, 'arm.sqlite'));
    arm.hidePrs();
    expect(count(arm.store, 'pr')).toBe(0);
    expect(count(arm.store, 'event_log')).toBe(0);
    expect(count(arm.store, 'notification_thread')).toBe(3);

    arm.reveal(base, { pinged: [PR1.key], found: [], pulledIn: [] });

    expect(arm.store.prs.listAll().map((pr) => pr.key)).toEqual([PR1.key]);
    const revealed = arm.store.eventLog.listSince([PR1.key], 0);
    expect(revealed.length).toBe(arm.store.events.listForPr(PR1.key).length);
    expect(revealed.length).toBeGreaterThan(0);
    expect(Math.min(...revealed.map((entry) => entry.seq))).toBeGreaterThan(baseMaxSeq);
    arm.close();
  });

  it('takes the leader topics without overwriting its own topic rows', async () => {
    const base = await freshBase();
    copyFileSync(base, join(dir, 'leader.sqlite'));
    copyFileSync(base, join(dir, 'follower.sqlite'));
    const leader = Store.open(join(dir, 'leader.sqlite'));
    leader.topics.create(makeTopic('ci', { summary: 'leader summary' }));
    leader.topics.create(makeTopic('docs', { summary: 'leader dossier summary', area: 'Docs', driver: 'alice', userRole: 'reviewer' }));
    leader.memberships.assign({ prKey: PR1.key, topicId: 'ci', assignedBy: 'agent', reason: 'CI work', createdAt: '2026-09-02T12:00:00Z' });
    leader.memberships.assign({ prKey: PR3.key, topicId: 'docs', assignedBy: 'agent', reason: 'docs', createdAt: '2026-09-02T12:00:00Z' });
    leader.close();
    const follower = ArmDatabase.open(join(dir, 'follower.sqlite'));
    follower.store.topics.create(makeTopic('ci', { summary: 'own summary', status: 'retired', retiredAt: '2026-09-01T00:00:00Z' }));

    follower.copyTopicsFrom(join(dir, 'leader.sqlite'));

    expect(follower.store.topics.get('ci')).toMatchObject({ summary: 'own summary', status: 'active', retiredAt: null });
    expect(follower.store.topics.get('docs')).toMatchObject({ name: 'docs', summary: '', area: null, driver: null, userRole: 'watcher', status: 'active' });
    expect(follower.store.memberships.listAll().map((m) => [m.prKey, m.topicId])).toEqual([
      [PR1.key, 'ci'],
      [PR3.key, 'docs'],
    ]);
    follower.close();
  });
});

describe('digestStored', () => {
  it('digests stored PRs and never asks GitHub', async () => {
    const h = makeHarness({ store: Store.open(join(dir, 'source.sqlite')) });
    topicWithPrs(h, 'ci', [PR1, PR2]);
    await h.engine.sync({ maxAgentCalls: 0 });
    const fetches = h.reader.fetchedRefs.length;
    const inboxReads = h.reader.notificationCalls;
    expect(count(h.store, 'pr_glance')).toBe(0);

    const report = await h.engine.digestStored({ prKeys: [PR1.key, PR2.key], agentJobs: ['dossiers', 'glances'] });

    expect(report.agentCalls).toBeGreaterThan(0);
    expect(count(h.store, 'pr_glance')).toBe(2);
    expect(h.store.dossiers.latest('ci')).not.toBeNull();
    expect(h.reader.fetchedRefs.length).toBe(fetches);
    expect(h.reader.notificationCalls).toBe(inboxReads);
    const snapshot = readArmSnapshot(h.store, '2026-09-02T12:00:00Z', '2000-01-01T00:00:00Z');
    expect(snapshot.topics.map((topic) => topic.id)).toEqual(['ci']);
    expect(snapshot.topics[0]!.tiles.map((tile) => tile.members)).toEqual(expect.arrayContaining([[PR1.key], [PR2.key]]));
    expect(Object.keys(snapshot.glances).sort()).toEqual([PR1.key, PR2.key].sort());
    expect(snapshot.setChanges).toBeNull();
    h.store.close();
  });
});
