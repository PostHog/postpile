import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { prKey, type AppConfig } from '@code-manager/core';
import type { EngineService } from '@code-manager/engine';

/** Every /api request must carry the server's token in this header. */
export const TOKEN_HEADER = 'x-code-manager-token';

const snoozeCondition = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('someone_replies') }),
  z.object({ kind: z.literal('new_push') }),
  z.object({ kind: z.literal('ci_green') }),
  // Snoozes compare ISO strings, so any offset is normalised to UTC "Z" form here.
  z.object({
    kind: z.literal('until_time'),
    until: z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString()),
  }),
]);

const feedbackBody = z.object({
  kind: z.enum(['not_mine', 'not_related', 'wrong_topic']),
  tileId: z.string(),
  prKey: z.string().nullable().default(null),
  targetTopicId: z.string().nullable().default(null),
  note: z.string().default(''),
});

const syncBody = z
  .object({
    maxPrs: z.number().int().positive().optional(),
    maxAgentCalls: z.number().int().min(0).optional(),
    agentJobs: z.array(z.enum(['topics', 'dossiers', 'sets', 'glances', 'events'])).optional(),
  })
  .default({});

const consolidateBody = z
  .object({
    onlyIfDue: z.boolean().optional(),
    maxAgentCalls: z.number().int().min(0).optional(),
  })
  .default({});

/** "person:alice" or "path:PostHog/posthog:.github/workflows/". Only the first ":" separates kind and key. */
const entityParam = z
  .string()
  .regex(/^(person|path|initiative|pr):.+/, 'entity must look like kind:key')
  .transform((value) => {
    const split = value.indexOf(':');
    return { kind: value.slice(0, split) as 'person' | 'path' | 'initiative' | 'pr', key: value.slice(split + 1) };
  });

const factQuery = z.object({
  entity: entityParam.optional(),
  predicate: z
    .enum(['drives', 'works_on', 'reviews', 'owns', 'part_of', 'depends_on', 'blocked_by', 'decided', 'status', 'user_cares', 'note'])
    .optional(),
  topicId: z.string().optional(),
  since: z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString()).optional(),
  includeClosed: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

/** Parses a JSON body that may be missing entirely. */
async function optionalJson(c: { req: { text(): Promise<string> } }): Promise<unknown> {
  const text = await c.req.text();
  return text.trim() === '' ? undefined : JSON.parse(text);
}

/** Thrown for input the client got wrong; answered with 400 instead of 500. */
class BadRequestError extends Error {}

function prKeyFromParams(params: { owner: string; repo: string; number: string }): string {
  const number = Number(params.number);
  if (!Number.isInteger(number) || number <= 0) {
    throw new BadRequestError(`invalid PR number: ${params.number}`);
  }
  return prKey({ repo: `${params.owner}/${params.repo}`, number });
}

function isClientError(error: Error): boolean {
  // SyntaxError comes from c.req.json() on a malformed body.
  return error instanceof BadRequestError || error instanceof z.ZodError || error instanceof SyntaxError;
}

/**
 * JSON API over EngineService. Tile and event ids contain "/", "#" and ":",
 * so clients must encodeURIComponent them in paths.
 *
 * The token is required, not optional: some routes (approve, mark-read) take
 * no body, so without it any web page could send them as simple cross-origin
 * POSTs. CORS can stay open because the token travels in a custom header, which
 * a page can only send after a preflight and only if it knows the token.
 */
export function createApp(engine: EngineService, token: string, config: AppConfig): Hono {
  if (token === '') {
    throw new Error('createApp needs a non-empty token');
  }
  const app = new Hono();

  app.use('/api/*', cors({ origin: '*', allowHeaders: ['content-type', TOKEN_HEADER] }));
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'OPTIONS' && c.req.header(TOKEN_HEADER) !== token) {
      return c.json({ error: 'bad token' }, 401);
    }
    await next();
  });

  app.onError((error, c) => c.json({ error: error.message }, isClientError(error) ? 400 : 500));

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/api/config', (c) => c.json(config));
  // The bodies are optional: a bare POST syncs or consolidates with no limits.
  app.post('/api/sync', async (c) => c.json(await engine.sync(syncBody.parse(await optionalJson(c)))));
  app.post('/api/consolidate', async (c) => c.json(await engine.consolidate(consolidateBody.parse(await optionalJson(c)))));

  app.get('/api/topics', async (c) => c.json(await engine.listTopics()));
  app.get('/api/topics/:id', async (c) => {
    const topic = await engine.getTopic(c.req.param('id'));
    return topic ? c.json(topic) : c.json({ error: 'not found' }, 404);
  });
  app.post('/api/topics/:id/tailoring', async (c) => {
    const body = z.object({ text: z.string(), keep: z.boolean() }).parse(await c.req.json());
    return c.json(await engine.decideTailoring(c.req.param('id'), body.text, body.keep));
  });
  app.post('/api/topics/:id/seen', async (c) => c.json(await engine.markTopicSeen(c.req.param('id'))));
  app.get('/api/proposals', async (c) => c.json(await engine.listProposals()));
  app.post('/api/proposals/:id', async (c) => {
    const body = z.object({ accept: z.boolean() }).parse(await c.req.json());
    return c.json(await engine.decideTopicProposal(c.req.param('id'), body.accept));
  });

  app.post('/api/rule-proposals/:id', async (c) => {
    const body = z.object({ accept: z.boolean() }).parse(await c.req.json());
    return c.json(await engine.decideRuleProposal(c.req.param('id'), body.accept));
  });
  app.get('/api/facts', async (c) => {
    const { since, ...query } = factQuery.parse(c.req.query());
    return c.json(await engine.listFacts({ ...query, changedSince: since }));
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
