import { z } from 'zod';
import { PR_NOTE_BY_MAX, PR_NOTE_KINDS, PR_NOTE_LEASE_MAX_MINUTES, PR_NOTE_MAX, type PrNoteRequest, type PrNoteResult } from './pr-notes.ts';
import { OUTSIDE_REASON_MAX, TOPIC_NAME_MAX, type TopicChangeRequest, type TopicChangeResult } from './topic-change-plan.ts';
import type { IsoTime, PrKey } from './types.ts';

// What outside agents may ask the running app to do through the MCP server
// (DESIGN.md "Agent requests"): re-read PRs from GitHub now
// (refresh_from_github), file a topic change for the user to decide
// (propose_topic_change), or leave, renew or clear a note on a PR (note_pr). The app does the work: only it holds the GitHub
// client, the quota readings and the database's write lock.

/** A PR fetched this recently is skipped as fresh. */
export const AGENT_REFRESH_FRESH_MS = 60_000;
/** Agent refreshes that read GitHub, per rolling hour, across every MCP client. */
export const AGENT_REFRESHES_PER_HOUR = 20;
/** A topic refresh reads at most this many of its open PRs. */
export const AGENT_REFRESH_TOPIC_MAX_PRS = 10;

/** Who asked for a refresh: an outside agent, by its MCP client name ("claude-code"). */
export interface AgentRefreshOptions {
  source: 'agent';
  client: string;
}

/** One PR, or one topic's open PRs (unread and your move first, then newest). */
export type AgentRefreshTarget = { kind: 'pr'; prKey: PrKey } | { kind: 'topic'; topicId: string };

export interface AgentRefreshResult {
  /** done: the app read GitHub (or found every PR fresh); blocked: nothing was read, see reason and retryAt. */
  status: 'done' | 'blocked';
  /** The PRs the refresh was about. */
  prKeys: PrKey[];
  /** PRs whose snapshot was written by this refresh. */
  fetched: PrKey[];
  /** Fetched PRs that came back with new events. */
  changed: PrKey[];
  /** PRs skipped because they were fetched less than AGENT_REFRESH_FRESH_MS ago. */
  fresh: { prKey: PrKey; fetchedAt: IsoTime }[];
  /** A full sync was running; the refresh waited for it instead of reading GitHub itself. */
  joinedSync: boolean;
  /** blocked: why, for the agent. */
  reason: string | null;
  /** blocked: when trying again makes sense; null when it does not help (e.g. unknown PR). */
  retryAt: IsoTime | null;
}

// ---------------------------------------------------------------------------
// The file outbox between the MCP process and the app (DESIGN.md "Agent
// requests"). No port and no token: the app's HTTP token can approve PRs,
// so it is never handed to other processes.
// ---------------------------------------------------------------------------

/** Next to the database: `<data folder>/agent-requests/<uuid>.json`, answered by `<uuid>.result.json`. */
export const AGENT_REQUESTS_FOLDER = 'agent-requests';
export const AGENT_REQUEST_VERSION = 1;
/** A bigger request file is refused. */
export const AGENT_REQUEST_MAX_BYTES = 16 * 1024;
/** A request the app has not taken by then is dropped: its intent went stale. */
export const AGENT_REQUEST_TTL_MS = 2 * 60_000;
/** How long the MCP process waits for the app's answer (Codex gives up at 60 s). */
export const AGENT_REQUEST_WAIT_MS = 20_000;
/** Results nobody collected are swept at app start once they are this old. */
export const AGENT_RESULT_MAX_AGE_MS = 3600_000;

/** `<uuid>.json`, the only names the app reads. */
export const AGENT_REQUEST_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;

export type AgentRequestKind = 'refresh' | 'propose_topic_change' | 'note_pr';

interface AgentRequestBase {
  v: typeof AGENT_REQUEST_VERSION;
  createdAt: IsoTime;
  expiresAt: IsoTime;
  /** The MCP client's name from its initialize handshake (clientInfo.name), e.g. "claude-code". */
  client: string;
}

export type AgentRequest =
  | (AgentRequestBase & { kind: 'refresh'; payload: AgentRefreshTarget })
  | (AgentRequestBase & { kind: 'propose_topic_change'; payload: TopicChangeRequest })
  | (AgentRequestBase & { kind: 'note_pr'; payload: PrNoteRequest });

export type AgentRequestResult =
  | { v: typeof AGENT_REQUEST_VERSION; ok: true; kind: 'refresh'; refresh: AgentRefreshResult }
  | { v: typeof AGENT_REQUEST_VERSION; ok: true; kind: 'propose_topic_change'; topicChange: TopicChangeResult }
  | { v: typeof AGENT_REQUEST_VERSION; ok: true; kind: 'note_pr'; prNote: PrNoteResult }
  | { v: typeof AGENT_REQUEST_VERSION; ok: false; error: string };

const prKeySchema = z.string().regex(/^[\w.-]+\/[\w.-]+#\d+$/);
const topicIdSchema = z.string().min(1).max(200);

const refreshTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pr'), prKey: prKeySchema }).strict(),
  z.object({ kind: z.literal('topic'), topicId: topicIdSchema }).strict(),
]);

const topicChangeSchema = z
  .object({
    topicId: topicIdSchema,
    kind: z.enum(['split', 'rename', 'merge']),
    prKeys: z.array(prKeySchema).max(50),
    name: z.string().max(TOPIC_NAME_MAX).nullable(),
    intoTopicId: topicIdSchema.nullable(),
    reason: z.string().max(OUTSIDE_REASON_MAX),
    dryRun: z.boolean(),
  })
  .strict();

const noteIdSchema = z.string().min(1).max(64);
const leaseMinutesSchema = z.number().int().min(1).max(PR_NOTE_LEASE_MAX_MINUTES).nullable();
const tokenSchema = z.string().min(1).max(64);

// Lengths are checked again after whitespace is folded (planNoteSet); these caps only keep the file small.
const prNoteSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('set'),
      prKey: prKeySchema,
      kind: z.enum(PR_NOTE_KINDS as [string, ...string[]]),
      note: z.string().max(PR_NOTE_MAX * 2),
      by: z.string().max(PR_NOTE_BY_MAX * 2),
      token: tokenSchema,
      coveredByPrKey: prKeySchema.nullable(),
      coverToken: tokenSchema.nullable(),
      leaseMinutes: leaseMinutesSchema,
    })
    .strict(),
  z.object({ action: z.literal('renew'), noteId: noteIdSchema, leaseMinutes: leaseMinutesSchema }).strict(),
  z.object({ action: z.literal('clear'), noteId: noteIdSchema }).strict(),
]);

/** The envelope, loose on v and kind so an unknown one can be answered with why. */
const envelopeSchema = z.object({
  v: z.number(),
  kind: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  client: z.string().max(100),
  payload: z.unknown(),
});

export type AgentRequestCheck = { ok: true; request: AgentRequest } | { ok: false; error: string };

/** A request file's text, checked: JSON, the envelope, a known version and kind, and that kind's payload. */
export function parseAgentRequest(text: string): AgentRequestCheck {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not JSON' };
  }
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) {
    return { ok: false, error: `bad request: ${envelope.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}` };
  }
  const { v, kind, createdAt, expiresAt, client, payload } = envelope.data;
  if (v !== AGENT_REQUEST_VERSION) {
    return { ok: false, error: `unknown request version ${v}; this PostPile understands version ${AGENT_REQUEST_VERSION}` };
  }
  const base = { v: AGENT_REQUEST_VERSION, createdAt, expiresAt, client } as const;
  if (kind === 'refresh') {
    const target = refreshTargetSchema.safeParse(payload);
    return target.success ? { ok: true, request: { ...base, kind, payload: target.data } } : { ok: false, error: 'bad refresh payload' };
  }
  if (kind === 'propose_topic_change') {
    const change = topicChangeSchema.safeParse(payload);
    return change.success ? { ok: true, request: { ...base, kind, payload: change.data } } : { ok: false, error: 'bad propose_topic_change payload' };
  }
  if (kind === 'note_pr') {
    const note = prNoteSchema.safeParse(payload);
    return note.success ? { ok: true, request: { ...base, kind, payload: note.data as PrNoteRequest } } : { ok: false, error: 'bad note_pr payload' };
  }
  return { ok: false, error: `unknown request kind ${kind}` };
}
