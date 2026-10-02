import { describe, expect, it } from 'vitest';
import type { MacNotification } from '@postpile/core';
import { FakeEngine } from './fake/fake-engine.ts';
import { createApp, TOKEN_HEADER } from './app.ts';
import { PING_FEED_SIZE, PingFeed, servePingFeed } from './ping-feed.ts';

function ping(title: string, prKey = 'acme/app#1'): MacNotification {
  return { title, body: `${title} body`, target: { topicId: 'topic-x', tileId: 'tile-x', prKey }, prKeys: [prKey], count: 1, personal: true };
}

describe('PingFeed', () => {
  it('starts a reader at the newest ping, then hands it only what came after', () => {
    const feed = new PingFeed();
    feed.push([ping('old')]);
    const first = feed.after(null);
    expect(first).toEqual({ latestId: 1, pings: [] });
    feed.push([ping('a'), ping('b')]);
    expect(feed.after(first.latestId).pings.map((item) => [item.id, item.notification.title])).toEqual([
      [2, 'a'],
      [3, 'b'],
    ]);
    expect(feed.after(3).pings).toEqual([]);
  });

  it('treats a cursor from before a server restart as a fresh start, and keeps only the newest pings', () => {
    const feed = new PingFeed();
    feed.push([ping('a')]);
    expect(feed.after(99)).toEqual({ latestId: 1, pings: [] });
    feed.push(Array.from({ length: PING_FEED_SIZE + 5 }, (_, index) => ping(`p${index}`)));
    expect(feed.get(1)).toBeNull();
    expect(feed.after(0).pings).toHaveLength(PING_FEED_SIZE);
  });
});

describe('ping routes', () => {
  function served() {
    const engine = new FakeEngine();
    const app = createApp(engine, 'secret', { fake: true, syncCallCap: 30, syncOnStart: true, profile: 'default', databasePath: null, autoSyncMinutes: 60, install: 'source' });
    const feed = new PingFeed();
    servePingFeed(app, feed, engine);
    return { app, feed };
  }

  it('lists pings behind the token', async () => {
    const { app, feed } = served();
    feed.push([ping('hello')]);
    expect((await app.request('/api/pings')).status).toBe(401);
    const response = await app.request('/api/pings?after=0', { headers: { [TOKEN_HEADER]: 'secret' } });
    expect(await response.json()).toMatchObject({ latestId: 1, pings: [{ id: 1, notification: { title: 'hello' } }] });
  });

  it('answers no target for a ping the feed no longer has or a bad id', async () => {
    const { app } = served();
    const headers = { [TOKEN_HEADER]: 'secret' };
    expect(await (await app.request('/api/pings/7/target', { headers })).json()).toEqual({ target: null });
    expect(await (await app.request('/api/pings/abc/target', { headers })).json()).toEqual({ target: null });
  });
});
