import type { MacNotification, PingFeedView, WebPing } from '@postpile/core';
import type { EngineService } from '@postpile/engine';
import type { Hono } from 'hono';

export const PING_FEED_SIZE = 50;

export class PingFeed {
  private pings: WebPing[] = [];
  private latestId = 0;

  push(notifications: MacNotification[]): void {
    for (const notification of notifications) {
      this.latestId += 1;
      this.pings.push({ id: this.latestId, notification });
    }
    this.pings = this.pings.slice(-PING_FEED_SIZE);
  }

  after(id: number | null): PingFeedView {
    if (id === null || id > this.latestId) {
      return { latestId: this.latestId, pings: [] };
    }
    return { latestId: this.latestId, pings: this.pings.filter((ping) => ping.id > id) };
  }

  get(id: number): WebPing | null {
    return this.pings.find((ping) => ping.id === id) ?? null;
  }
}

function idParam(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) {
    return null;
  }
  return Number(value);
}

export function servePingFeed(app: Hono, feed: PingFeed, engine: EngineService): void {
  app.get('/api/pings', (c) => c.json(feed.after(idParam(c.req.query('after')))));
  app.get('/api/pings/:id/target', async (c) => {
    const id = idParam(c.req.param('id'));
    const ping = id === null ? null : feed.get(id);
    return c.json({ target: ping ? await engine.pingClickTarget(ping.notification) : null });
  });
}
