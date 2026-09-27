import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { prKey } from '@code-manager/core';
import type { EngineService } from '@code-manager/engine';

/** Clients send this header when the server was started with a token. */
export const TOKEN_HEADER = 'x-code-manager-token';

const snoozeCondition = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('someone_replies') }),
  z.object({ kind: z.literal('new_push') }),
  z.object({ kind: z.literal('ci_green') }),
  z.object({ kind: z.literal('until_time'), until: z.string() }),
]);

const feedbackBody = z.object({
  kind: z.enum(['not_mine', 'not_related', 'wrong_topic']),
  tileId: z.string(),
  prKey: z.string().nullable().default(null),
  targetTopicId: z.string().nullable().default(null),
  note: z.string().default(''),
});

function prKeyFromParams(params: { owner: string; repo: string; number: string }): string {
  return prKey({ repo: `${params.owner}/${params.repo}`, number: Number(params.number) });
}

/**
 * JSON API over EngineService. Tile and event ids contain "/", "#" and ":",
 * so clients must encodeURIComponent them in paths.
 */
export function createApp(engine: EngineService, token: string | null): Hono {
  const app = new Hono();

  app.use('/api/*', cors({ origin: '*', allowHeaders: ['content-type', TOKEN_HEADER] }));
  app.use('/api/*', async (c, next) => {
    if (token && c.req.method !== 'OPTIONS' && c.req.header(TOKEN_HEADER) !== token) {
      return c.json({ error: 'bad token' }, 401);
    }
    await next();
  });

  app.onError((error, c) => c.json({ error: error.message }, 500));

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.post('/api/sync', async (c) => c.json(await engine.sync()));

  app.get('/api/topics', async (c) => c.json(await engine.listTopics()));
  app.get('/api/topics/:id', async (c) => {
    const topic = await engine.getTopic(c.req.param('id'));
    return topic ? c.json(topic) : c.json({ error: 'not found' }, 404);
  });
  app.post('/api/topics/:id/tailoring', async (c) => {
    const body = z.object({ text: z.string(), keep: z.boolean() }).parse(await c.req.json());
    return c.json(await engine.decideTailoring(c.req.param('id'), body.text, body.keep));
  });
  app.post('/api/proposals/:id', async (c) => {
    const body = z.object({ accept: z.boolean() }).parse(await c.req.json());
    return c.json(await engine.decideTopicProposal(c.req.param('id'), body.accept));
  });

  app.get('/api/prs/:owner/:repo/:number', async (c) => {
    const pr = await engine.getPr(prKeyFromParams(c.req.param()));
    return pr ? c.json(pr) : c.json({ error: 'not found' }, 404);
  });
  app.post('/api/prs/:owner/:repo/:number/approve', async (c) => {
    return c.json(await engine.approve(prKeyFromParams(c.req.param())));
  });
  app.post('/api/prs/:owner/:repo/:number/draft-ask', async (c) => {
    const body = z.object({ person: z.string(), intent: z.string().default('') }).parse(await c.req.json());
    return c.json(await engine.draftAsk(prKeyFromParams(c.req.param()), body.person, body.intent));
  });
  app.post('/api/prs/:owner/:repo/:number/comment', async (c) => {
    const body = z.object({ body: z.string().min(1) }).parse(await c.req.json());
    return c.json(await engine.sendComment(prKeyFromParams(c.req.param()), body.body));
  });

  app.post('/api/tiles/:tileId/mark-read', async (c) => c.json(await engine.markRead(c.req.param('tileId'))));
  app.post('/api/tiles/:tileId/snooze', async (c) => {
    const body = z.object({ condition: snoozeCondition }).parse(await c.req.json());
    return c.json(await engine.snooze(c.req.param('tileId'), body.condition));
  });
  app.delete('/api/tiles/:tileId/snooze', async (c) => c.json(await engine.unsnooze(c.req.param('tileId'))));
  app.get('/api/tiles/:tileId/chat', async (c) => c.json(await engine.getChat(c.req.param('tileId'))));
  app.post('/api/tiles/:tileId/chat', async (c) => {
    const body = z.object({ message: z.string().min(1) }).parse(await c.req.json());
    return c.json(await engine.chat(c.req.param('tileId'), body.message));
  });

  app.post('/api/undo', async (c) => {
    const body = z.object({ undoToken: z.string().nullable().default(null) }).parse(await c.req.json());
    return c.json(await engine.undo(body.undoToken));
  });
  app.post('/api/feedback', async (c) => c.json(await engine.giveFeedback(feedbackBody.parse(await c.req.json()))));
  app.post('/api/events/:id/unmute', async (c) => c.json(await engine.unmuteEvent(c.req.param('id'))));

  return app;
}
