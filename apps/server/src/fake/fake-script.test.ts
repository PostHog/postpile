import { describe, expect, it } from 'vitest';
import { createApp, TOKEN_HEADER } from '../app.ts';
import { FakeEngine, type FakeEngineOptions } from './fake-engine.ts';
import { fakeDeliverFromEnv, FAKE_STEPS } from './fake-script.ts';

class Clock {
  private ms = new Date('2026-09-27T10:00:00Z').getTime();

  now = (): Date => new Date(this.ms);

  advance(ms: number): void {
    this.ms += ms;
  }
}

function engineWith(options: FakeEngineOptions = {}, clock = new Clock()): FakeEngine {
  return new FakeEngine({ now: clock.now, syncStepMs: 0, recheckDelayMs: 0, catchUpStepMs: 0, cleanupStepMs: 0, ...options });
}

async function sectionOf(engine: FakeEngine, topicId: string): Promise<string | null> {
  return (await engine.listTopics()).find((item) => item.topic.id === topicId)?.section ?? null;
}

async function threadOf(engine: FakeEngine, number: number) {
  return (await engine.debugNotifications(500)).find((row) => row.thread.number === number)?.thread;
}

describe('fakeDeliverFromEnv', () => {
  it('keeps known steps in order and returns unknown words apart', () => {
    expect(fakeDeliverFromEnv(' ask-you, push ,nope,')).toEqual({ steps: ['ask-you', 'push'], unknown: ['nope'] });
    expect(fakeDeliverFromEnv(undefined)).toEqual({ steps: [], unknown: [] });
  });
});

describe('FakeScript steps', () => {
  it('moves Egress allowlist to Needs reply when nell asks you, once', async () => {
    const engine = engineWith();
    expect(await sectionOf(engine, 'topic-egress-allowlist')).toBe('team_owns');

    expect(engine.script.run('ask-you')).toMatchObject({ ok: true, prsFetched: 1, newEvents: 1 });

    expect(await sectionOf(engine, 'topic-egress-allowlist')).toBe('needs_reply');
    expect((await threadOf(engine, 1982))?.unread).toBe(true);
    expect(engine.script.run('ask-you')).toMatchObject({ ok: true, message: 'ask-you ran already; nothing changed', prsFetched: 0 });
    expect(engine.script.steps().find((step) => step.name === 'ask-you')?.done).toBe(true);
  });

  it('moves the head on push, so an approve of the old head is refused', async () => {
    const engine = engineWith();
    const before = (await engine.getPr('acme/app#1870'))!.pr.headOid;
    engine.script.run('push');
    const after = (await engine.getPr('acme/app#1870'))!.pr.headOid;
    expect(after).not.toBe(before);
    expect((await engine.approve('acme/app#1870', before)).message).toMatch(/New commits since you looked/);
    expect((await engine.approve('acme/app#1870', after)).ok).toBe(true);
  });

  it('merges a set member without changing what the tile holds, and refuses to merge it twice', async () => {
    const engine = engineWith();
    const tileId = (await engine.getPr('acme/app#1904'))!.tileIds[0]!;
    const members = async () => (await engine.getTopic('topic-depot'))?.tiles.find((view) => view.tile.id === tileId)?.tile.members.map((member) => member.prKey);
    const held = await members();
    engine.script.run('approve-set-member');
    engine.script.run('merge-set-member');
    expect((await engine.getPr('acme/app#1904'))?.pr.state).toBe('MERGED');
    expect(await members()).toEqual(held);
    expect(engine.script.run('merge-open-pr').ok).toBe(true);
    expect(engine.script.run('push')).toMatchObject({ ok: false, message: 'push did not run: #1870 is not open in the sample' });
  });

  it('brings an archived topic back for a question, not for a bot while writes are on', async () => {
    const quiet = engineWith();
    quiet.script.run('bot-on-archived');
    expect(await sectionOf(quiet, 'topic-cache-warmer')).toBeNull();
    expect((await threadOf(quiet, 1840))?.unread).toBe(false);

    const asked = engineWith();
    asked.script.run('revive-archived');
    expect(await sectionOf(asked, 'topic-cache-warmer')).not.toBeNull();
  });

  it('marks a bot-only thread read quietly while writes are on, and leaves it unread while locked', async () => {
    const open = engineWith();
    open.script.run('bot-only-read');
    expect((await threadOf(open, 1985))?.unread).toBe(false);
    expect((await open.handledQuietly())[0]).toMatchObject({ number: 1985, reason: 'bots', bots: ['vercel[bot]'] });

    const locked = engineWith({ writesLocked: true });
    locked.script.run('bot-only-read');
    expect((await threadOf(locked, 1985))?.unread).toBe(true);
    expect((await locked.handledQuietly()).some((row) => row.number === 1985)).toBe(false);
  });

  it('keeps a thread with a mention next to the bot unread', async () => {
    const engine = engineWith();
    expect(engine.script.run('bot-and-mention')).toMatchObject({ prsFetched: 1, newEvents: 2 });
    expect((await threadOf(engine, 1987))?.unread).toBe(true);
    expect(await sectionOf(engine, 'topic-alert-presets')).toBe('needs_reply');
  });

  it('runs every step on the default sample', () => {
    const engine = engineWith();
    const results = FAKE_STEPS.filter((name) => name !== 'merge-open-pr').map((name) => engine.script.run(name));
    expect(results.every((result) => result.ok)).toBe(true);
  });
});

describe('POSTPILE_FAKE_DELIVER', () => {
  it('delivers the next step on each sync after the start sync, and reports the news', async () => {
    const engine = engineWith({ deliver: ['ask-you', 'bot-and-mention'], skipFirstSyncDelivery: true });
    const changes = async () => (await engine.livePollStatus()).changeCount;
    const before = await changes();

    expect(await engine.sync()).toMatchObject({ prsFetched: 0, newEvents: 0, notificationsNotModified: true });
    expect(engine.script.nextDelivery()).toBe('ask-you');
    expect(await engine.sync()).toMatchObject({ prsFetched: 1, newEvents: 1, notificationsNotModified: false });
    expect(await sectionOf(engine, 'topic-egress-allowlist')).toBe('needs_reply');
    expect(await changes()).toBe(before + 1);
    expect(await engine.sync()).toMatchObject({ prsFetched: 1, newEvents: 2 });
    expect(engine.script.nextDelivery()).toBeNull();
    expect(await engine.sync()).toMatchObject({ prsFetched: 0 });
  });

  it('skips a step that already ran through the route', async () => {
    const engine = engineWith({ deliver: ['ask-you', 'push'] });
    engine.script.run('ask-you');
    expect(engine.script.nextDelivery()).toBe('push');
  });
});

describe('/api/fake routes', () => {
  const TOKEN = 'test-token';
  const config = { fake: true, syncCallCap: 30, syncOnStart: true, profile: 'default' as const, databasePath: null, autoSyncMinutes: 60 };

  it('lists the steps and runs one, behind the token', async () => {
    const app = createApp(engineWith(), TOKEN, config);
    const headers = { [TOKEN_HEADER]: TOKEN, 'content-type': 'application/json' };

    expect((await app.request('/api/fake/steps')).status).toBe(401);
    const steps = (await (await app.request('/api/fake/steps', { headers })).json()) as { steps: { name: string; done: boolean }[]; nextDelivery: string | null };
    expect(steps.steps.map((step) => step.name)).toEqual([...FAKE_STEPS]);
    expect(steps.nextDelivery).toBeNull();

    const ran = await app.request('/api/fake/advance', { method: 'POST', headers, body: JSON.stringify({ step: 'ask-you' }) });
    expect(await ran.json()).toMatchObject({ ok: true, prsFetched: 1 });
    const unknown = await app.request('/api/fake/advance', { method: 'POST', headers, body: JSON.stringify({ step: 'nope' }) });
    expect(unknown.status).toBe(400);
  });
});
