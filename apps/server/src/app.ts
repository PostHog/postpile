import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import {
  ACTION_LOG_DEFAULT_LIMIT,
  ACTION_LOG_MAX_LIMIT,
  DEBUG_NOTIFICATIONS_DEFAULT_LIMIT,
  DEBUG_NOTIFICATIONS_MAX_LIMIT,
  prKey,
  RENDERER_TELEMETRY_EVENTS,
  TELEMETRY_EVENTS,
  type AppConfig,
  type TelemetryEventName,
} from '@postpile/core';
import { NoopTelemetry, type EngineService, type Telemetry } from '@postpile/engine';
import { UpdatesOff, type UpdateSource } from './update-check.ts';

/** Every /api request must carry the server's token in this header. */
export const TOKEN_HEADER = 'x-postpile-token';

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

const memoryCorrectionBody = z.object({
  kind: z.enum(['wrong', 'forget', 'confirm', 'fix']),
  factId: z.string().nullable().default(null),
  topicId: z.string().nullable().default(null),
  text: z.string().default(''),
  relation: z.enum(['team', 'routed', 'fyi']).optional(),
  fixedText: z.string().optional(),
  fromRecheck: z.boolean().optional(),
});

/** Same target shape as the "Why?" query, as JSON. */
const memoryTargetBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fact'), factId: z.string().min(1) }),
  z.object({ kind: z.literal('dossier_line'), topicId: z.string().min(1), version: z.number().int().positive(), path: z.string().min(1) }),
]);

const memoryRecheckBody = z.object({
  factId: z.string().nullable().default(null),
  topicId: z.string().nullable().default(null),
  text: z.string().min(1),
  target: memoryTargetBody.nullable().default(null),
  prKey: z.string().nullable().default(null),
});

/** "acme/app". */
const repoName = z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'repo must look like owner/name');

const debugLimit = z.coerce.number().int().positive().max(DEBUG_NOTIFICATIONS_MAX_LIMIT).default(DEBUG_NOTIFICATIONS_DEFAULT_LIMIT);
const actionLogLimit = z.coerce.number().int().positive().max(ACTION_LOG_MAX_LIMIT).default(ACTION_LOG_DEFAULT_LIMIT);

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

/** "person:alice" or "path:acme/app:.github/workflows/". Only the first ":" separates kind and key. */
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

/** "Why?" target: a fact id, or one line of a stored dossier version. */
const memoryTargetQuery = z.union([
  z.object({ fact: z.string().min(1) }).transform((query) => ({ kind: 'fact' as const, factId: query.fact })),
  z
    .object({ topic: z.string().min(1), version: z.coerce.number().int().positive(), path: z.string().min(1) })
    .transform((query) => ({ kind: 'dossier_line' as const, topicId: query.topic, version: query.version, path: query.path })),
]);

const instructionsProposal = z.object({
  baseVersion: z.number().int().positive().nullable(),
  baseText: z.string(),
  text: z.string(),
  summary: z.string(),
  sourceChatMessageId: z.number().int().positive(),
  dossiersToRefresh: z.number().int().min(0),
});

const instructionsDecision = z.object({ proposal: instructionsProposal, text: z.string() });

const proposeInstructionsBody = z.object({
  sourceChatMessageId: z.number().int().positive(),
});

const setupSection = z.object({ heading: z.string().max(200), body: z.string().max(20_000) });

const setupRefineBody = z.object({
  sections: z.array(setupSection).max(20),
  message: z.string().min(1).max(4000),
});

const setupFitBody = z.object({
  sections: z.array(setupSection).max(20),
});

const setupAcceptBody = z.object({
  sections: z.array(setupSection).max(20),
  quietRepos: z.array(repoName).max(50).default([]),
  mainRepo: repoName.nullable().default(null),
  baseVersion: z.number().int().positive().nullable(),
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

const telemetryBody = z.object({ event: z.string(), props: z.record(z.string(), z.unknown()).default({}) });

/** Only the renderer-allowed subset (packages/core/src/telemetry-events.ts), never the whole catalogue: the engine sends its own events directly. */
function isRendererTelemetryEvent(name: string): name is TelemetryEventName {
  return (RENDERER_TELEMETRY_EVENTS as readonly string[]).includes(name);
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
export function createApp(
  engine: EngineService,
  token: string,
  config: AppConfig,
  updates: UpdateSource = new UpdatesOff(''),
  telemetry: Telemetry = new NoopTelemetry(),
): Hono {
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
  // The title bar's update reminder: the last check's answer, never a live request to GitHub.
  app.get('/api/update', (c) => c.json(updates.status()));
  // The renderer's only way to PostHog: an allow-listed event name plus props validated
  // against the same catalogue the engine's own Telemetry class uses. Unknown events and
  // disallowed props are refused with 400, never silently dropped or forwarded as is.
  app.post('/api/telemetry', async (c) => {
    const body = telemetryBody.parse(await c.req.json());
    if (!isRendererTelemetryEvent(body.event)) {
      return c.json({ error: `telemetry event not allowed from the renderer: ${body.event}` }, 400);
    }
    const props = TELEMETRY_EVENTS[body.event].safeParse(body.props);
    if (!props.success) {
      return c.json({ error: `bad props for ${body.event}: ${props.error.message}` }, 400);
    }
    telemetry.capture(body.event, props.data);
    return c.json({ ok: true });
  });
  // The bodies are optional. A sync without maxAgentCalls gets the app's cap, so
  // opening the app never starts an uncapped (and costly) first sync.
  app.get('/api/sync/last', async (c) => c.json(await engine.lastSyncReport()));
  // The sync in flight, for the title bar ("syncing · agent 34/82 · 2m"); null between syncs.
  app.get('/api/sync/progress', async (c) => c.json(await engine.syncProgress()));
  app.post('/api/sync', async (c) => {
    const options = syncBody.parse(await optionalJson(c));
    return c.json(await engine.sync({ ...options, maxAgentCalls: options.maxAgentCalls ?? config.syncCallCap }));
  });
  // The fast notification poll, for the status footer. "off" unless the host started it (the desktop app).
  app.get('/api/live', async (c) => c.json(await engine.livePollStatus()));
  // Consolidation runs agent calls too: same cap when the request names none.
  app.post('/api/consolidate', async (c) => {
    const options = consolidateBody.parse(await optionalJson(c));
    return c.json(await engine.consolidate({ ...options, maxAgentCalls: options.maxAgentCalls ?? config.syncCallCap }));
  });

  app.get('/api/topics', async (c) => c.json(await engine.listTopics()));
  // The sidebar's Finished drawer. Before /api/topics/:id, which would take "finished" as an id.
  app.get('/api/topics/finished', async (c) => c.json(await engine.listFinishedTopics()));
  app.get('/api/viewer', async (c) => c.json(await engine.getViewer()));
  // The title bar's repo menu. Scope and quiet repos are kept in meta; local, never GitHub writes.
  app.get('/api/repos', async (c) => c.json(await engine.listRepos()));
  app.post('/api/repos/scope', async (c) => {
    const body = z.object({ repo: repoName.nullable() }).parse(await c.req.json());
    return c.json(await engine.setRepoScope(body.repo));
  });
  app.post('/api/repos/quiet', async (c) => {
    const body = z.object({ repo: repoName, quiet: z.boolean() }).parse(await c.req.json());
    return c.json(await engine.setRepoQuiet(body.repo, body.quiet));
  });
  // Search bar filter: ?q= is matched term by term (AND); a missing or empty q matches nothing.
  app.get('/api/search', async (c) => c.json(await engine.search(c.req.query('q') ?? '')));
  // Debug view of the stored notification threads. Read only: nothing is marked read.
  app.get('/api/debug/notifications', async (c) => c.json(await engine.debugNotifications(debugLimit.parse(c.req.query('limit')))));
  app.get('/api/debug/actions', async (c) => c.json(await engine.actionLog(actionLogLimit.parse(c.req.query('limit')))));
  // "Handled quietly": threads PostPile marked read on GitHub by itself in the last 7 days (bot-only activity).
  app.get('/api/handled-quietly', async (c) => c.json(await engine.handledQuietly()));
  // Debug view action. Mark read goes through the same queue, lock and log as a tile.
  app.post('/api/notifications/:threadId/mark-read', async (c) => c.json(await engine.markThreadRead(c.req.param('threadId'))));
  // The footer lock. Turning writes on answers ok: false while POSTPILE_READ_ONLY=1 forces read-only.
  app.get('/api/github-writes', async (c) => c.json(await engine.githubWrites()));
  app.post('/api/github-writes', async (c) => {
    const body = z.object({ enabled: z.boolean() }).parse(await c.req.json());
    return c.json(await engine.setGitHubWrites(body.enabled));
  });
  // Inbox cleanup: old unread threads, "mark everything older than N days read" (a GitHub
  // write through the lock, pending while locked), "start fresh" (local) and "Not now".
  app.get('/api/inbox-cleanup', async (c) => c.json(await engine.inboxCleanup()));
  app.post('/api/inbox-cleanup/mark-read', async (c) => {
    const body = z.object({ olderThanDays: z.union([z.literal(14), z.literal(30)]) }).parse(await c.req.json());
    return c.json(await engine.cleanUpInbox(body.olderThanDays));
  });
  app.post('/api/inbox-cleanup/start-fresh', async (c) => c.json(await engine.startFresh()));
  app.delete('/api/inbox-cleanup/start-fresh', async (c) => c.json(await engine.clearStartFresh()));
  app.post('/api/inbox-cleanup/not-now', async (c) => c.json(await engine.hideInboxCleanup()));
  // PostPile's MCP server in Claude Code: the cached `claude mcp get`, "Add to Claude Code"
  // (runs `claude mcp add` in the installed app only; local, never GitHub) and the footer's "Not now".
  app.get('/api/mcp-connection', async (c) => c.json(await engine.mcpConnection()));
  app.post('/api/mcp-connection', async (c) => {
    const body = z.object({ from: z.enum(['footer', 'setup']) }).parse(await c.req.json());
    return c.json(await engine.connectMcp(body.from));
  });
  app.post('/api/mcp-connection/not-now', async (c) => c.json(await engine.hideMcpConnect()));
  // Mark-reads made while locked. Send is refused (ok: false) while writes are off; discard changes nothing in the app.
  app.post('/api/github-writes/pending/send', async (c) => c.json(await engine.sendPendingWrites()));
  app.post('/api/github-writes/pending/discard', async (c) => c.json(await engine.discardPendingWrites()));
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
  app.post('/api/memory/corrections', async (c) => c.json(await engine.correctMemory(memoryCorrectionBody.parse(await c.req.json()))));
  // Runs one agent call (seconds); the answer is only shown, correctMemory applies it.
  app.post('/api/memory/recheck', async (c) => c.json(await engine.recheckMemory(memoryRecheckBody.parse(await c.req.json()))));
  app.get('/api/memory/sources', async (c) => {
    const sources = await engine.getMemorySources(memoryTargetQuery.parse(c.req.query()));
    return sources ? c.json(sources) : c.json({ error: 'not found' }, 404);
  });

  // Instructions writes are local (instructions.md and SQLite), never GitHub writes.
  app.get('/api/instructions', async (c) => c.json(await engine.getInstructions()));
  app.post('/api/instructions', async (c) => c.json(await engine.saveInstructions(instructionsDecision.parse(await c.req.json()))));
  app.get('/api/instructions/chat', async (c) => c.json(await engine.getInstructionsChat()));
  app.post('/api/instructions/chat', async (c) => {
    const body = z.object({ message: z.string().min(1) }).parse(await c.req.json());
    return c.json(await engine.instructionsChat(body.message));
  });
  app.post('/api/instructions/proposals', async (c) => {
    const body = proposeInstructionsBody.parse(await c.req.json());
    return c.json(await engine.proposeInstructions(body.sourceChatMessageId));
  });

  // "What you're working on": agent-written from local Claude Code notes, local only.
  app.get('/api/work-context', async (c) => c.json(await engine.getWorkContext()));
  // One agent call (a minute or more); the answer comes back when it is stored.
  app.post('/api/work-context/sweep', async (c) => c.json(await engine.sweepWorkContext()));
  app.post('/api/work-context/forget', async (c) => {
    const body = z.object({ version: z.number().int().positive(), index: z.number().int().min(0) }).parse(await c.req.json());
    return c.json(await engine.forgetWorkThread(body));
  });
  // The sweep's skip list, saved to the user's config.json.
  app.put('/api/work-context/skip-list', async (c) => {
    const body = z.object({ patterns: z.array(z.string().max(200)).max(100) }).parse(await c.req.json());
    return c.json(await engine.setSweepSkip(body.patterns));
  });

  // Setup flow. Checks and the sweep only read GitHub; refine and fit are one agent call each and
  // write nothing; accept writes instructions.md (a new version), quiet repos, scope and the done flag.
  // gh and claude status with the fix commands; the check is local and reads nothing from GitHub.
  app.get('/api/tools', async (c) => c.json(await engine.tools()));
  app.post('/api/tools/check', async (c) => c.json(await engine.checkTools()));
  app.get('/api/setup', async (c) => c.json(await engine.setupStatus()));
  app.get('/api/setup/checks', async (c) => c.json(await engine.setupChecks()));
  // The sweep can take tens of seconds: POST starts it and answers at once, GET is polled.
  app.post('/api/setup/sweep', async (c) => c.json(await engine.startSetupSweep()));
  app.get('/api/setup/sweep', async (c) => c.json(await engine.setupSweep()));
  app.post('/api/setup/refine', async (c) => c.json(await engine.refineSetup(setupRefineBody.parse(await c.req.json()))));
  app.post('/api/setup/fit', async (c) => c.json(await engine.checkSetupFit(setupFitBody.parse(await c.req.json()))));
  app.post('/api/setup/accept', async (c) => c.json(await engine.acceptSetup(setupAcceptBody.parse(await c.req.json()))));
  app.post('/api/setup/skip', async (c) => c.json(await engine.skipSetup()));

  app.get('/api/facts', async (c) => {
    const { since, ...query } = factQuery.parse(c.req.query());
    return c.json(await engine.listFacts({ ...query, changedSince: since }));
  });

  app.get('/api/prs/:owner/:repo/:number', async (c) => {
    const pr = await engine.getPr(prKeyFromParams(c.req.param()));
    return pr ? c.json(pr) : c.json({ error: 'not found' }, 404);
  });
  // Retry on a failed glance: a catch-up run for the PR's topic. Agent calls only, never a GitHub write.
  app.post('/api/prs/:owner/:repo/:number/glance/retry', async (c) => {
    return c.json(await engine.retryGlance(prKeyFromParams(c.req.param())));
  });
  // headOid: the head commit the renderer showed; the approval is pinned to it or refused.
  app.post('/api/prs/:owner/:repo/:number/approve', async (c) => {
    const body = z.object({ headOid: z.string().min(1).max(100) }).parse(await c.req.json());
    return c.json(await engine.approve(prKeyFromParams(c.req.param()), body.headOid));
  });
  // "Remove <team>": removes a team review request and unsubscribes. Final; refused while writes are locked.
  app.post('/api/prs/:owner/:repo/:number/remove-team-request', async (c) => {
    const body = z.object({ team: z.string().min(1).max(200) }).parse(await c.req.json());
    return c.json(await engine.removeTeamRequest(prKeyFromParams(c.req.param()), body.team));
  });
  // Opened in the detail pane: marks the GitHub thread read only when nothing is asked of the user and writes are unlocked.
  app.post('/api/prs/:owner/:repo/:number/opened', async (c) => {
    return c.json(await engine.markOpenedRead(prKeyFromParams(c.req.param())));
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
  // The detail pane's Mark read / Mark done: one PR of the tile, same queue, lock and undo.
  app.post('/api/tiles/:tileId/prs/:owner/:repo/:number/mark-read', async (c) => {
    return c.json(await engine.markPrRead(c.req.param('tileId'), prKeyFromParams(c.req.param())));
  });
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
