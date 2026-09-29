import { z } from 'zod';

// The whole telemetry surface in one place: every event PostPile is allowed
// to send, and the shape of its properties. apps/server's /api/telemetry
// route (renderer-originated events) and the engine's Telemetry class
// (engine-originated events) both validate against this catalogue, so there
// is exactly one list to keep honest. Props are enums, counts, durations and
// booleans only: never PR titles, bodies, repo names, branch names, logins,
// prompts, agent text or topic names (DESIGN.md "Usage analytics").

const durationMs = z.number().int().min(0);
const count = z.number().int().min(0);

// -----------------------------------------------------------------------
// 1. Activation
// -----------------------------------------------------------------------

const setupStep = z.enum(['checks', 'sweep', 'review', 'accept']);
const toolName = z.enum(['gh', 'claude']);
const toolMissingReason = z.enum(['missing', 'logged_out', 'rejected', 'offline', 'limited']);

// -----------------------------------------------------------------------
// 3. Core actions
// -----------------------------------------------------------------------

const tileKind = z.enum(['single', 'stack', 'set']);
const forWhom = z.enum(['you', 'team', 'your_pr', 'none']);
// The glance's own verdict (packages/core/src/types.ts Verdict), lowercased; null when the tile has no glance yet.
const verdict = z.enum(['looks_safe', 'look_closer', 'not_yours']).nullable();
const approveFrom = z.enum(['detail', 'tile']);
const markReadOrigin = z.enum(['tile', 'debug', 'cleanup']);
// A snooze is either a time (bucketed) or a condition (someone replies, a
// push, CI going green - see packages/core/src/snooze.ts SnoozeCondition):
// the same prop name the spec uses ("duration bucket"), widened to the
// condition-based snoozes the product actually has.
const snoozeDurationBucket = z.enum(['hours', 'a_day', 'days', 'a_week', 'someone_replies', 'new_push', 'ci_green']);
const queryLengthBucket = z.enum(['short', 'medium', 'long']);
const queueFilter = z.enum(['mine', 'team', 'reply', 'review', 'none']);
const topicSection = z.enum(['needs_reply', 'my_prs', 'team_prs', 'to_review', 'team_mentioned', 'other']);

// -----------------------------------------------------------------------
// 4. Agent trust
// -----------------------------------------------------------------------

const recheckOutcome = z.enum(['keep', 'fix', 'drop']);
const proposalKind = z.enum(['topic_merge', 'rename', 'rule', 'instructions']);

// -----------------------------------------------------------------------
// 5. Health
// -----------------------------------------------------------------------

const syncTrigger = z.enum(['start', 'manual', 'auto']);
const syncErrorKind = z.enum(['gh_unavailable', 'agent_unavailable', 'rate_limited', 'other']);
const rateLimitSource = z.enum(['graphql', 'rest']);

/** No props: an empty object, so every event has a stable shape to validate against. */
const NO_PROPS = z.object({}).strict();

export const TELEMETRY_EVENTS = {
  // 1. Activation
  app_launched: z.object({ first_launch: z.boolean() }).strict(),
  setup_step_viewed: z.object({ step: setupStep }).strict(),
  setup_completed: NO_PROPS,
  setup_skipped: NO_PROPS,
  first_sync_completed: z.object({ prs: count, topics: count, duration_ms: durationMs, agent_calls: count }).strict(),
  tool_missing: z.object({ tool: toolName, reason: toolMissingReason }).strict(),

  // 2. Retention
  app_active: NO_PROPS,
  window_focused: NO_PROPS,

  // 3. Core actions
  tile_opened: z.object({ tile_kind: tileKind, for_whom: forWhom, has_glance: z.boolean(), verdict }).strict(),
  pr_approved: z.object({ from: approveFrom, was_agent_approved: z.boolean() }).strict(),
  marked_read: z.object({ count, origin: markReadOrigin }).strict(),
  snoozed: z.object({ duration_bucket: snoozeDurationBucket }).strict(),
  opened_on_github: NO_PROPS,
  ask_sent: NO_PROPS,
  chat_message_sent: NO_PROPS,
  mac_ping_shown: z.object({ count }).strict(),
  mac_ping_clicked: NO_PROPS,
  search_used: z.object({ query_length_bucket: queryLengthBucket }).strict(),
  queue_filter_changed: z.object({ filter: queueFilter }).strict(),
  topic_opened: z.object({ section: topicSection }).strict(),
  update_pill_clicked: NO_PROPS,
  update_later_clicked: NO_PROPS,
  glance_retry_clicked: NO_PROPS,

  // 4. Agent trust
  wrong_topic_marked: NO_PROPS,
  not_related_marked: NO_PROPS,
  recheck_requested: NO_PROPS,
  recheck_resolved: z.object({ outcome: recheckOutcome }).strict(),
  memory_corrected: NO_PROPS,
  proposal_resolved: z.object({ kind: proposalKind, accepted: z.boolean() }).strict(),
  instructions_edited: NO_PROPS,

  // 5. Health
  sync_completed: z
    .object({
      duration_ms: durationMs,
      prs_fetched: count,
      new_events: count,
      agent_calls: count,
      agent_failures: count,
      cost_usd: z.number().min(0),
      stopped_at_cap: z.boolean(),
      trigger: syncTrigger,
    })
    .strict(),
  sync_failed: z.object({ error_kind: syncErrorKind }).strict(),
  rate_limited: z.object({ source: rateLimitSource }).strict(),
  consolidation_ran: z.object({ proposals_filed: count }).strict(),
  // One glance catch-up run after the poll (packages/engine/src/catch-up). Always one topic per run.
  catch_up_ran: z.object({ topics: z.literal(1), agent_calls: count, duration_ms: durationMs, ok: z.boolean() }).strict(),

  // Manual verification only (see NEXT.md "Verify once for real"). Never
  // sent from normal app code, not part of the analytics surface above.
  telemetry_test: NO_PROPS,
} as const;

export type TelemetryEventName = keyof typeof TELEMETRY_EVENTS;

export type TelemetryEventProps<K extends TelemetryEventName> = z.infer<(typeof TELEMETRY_EVENTS)[K]>;

/** Every event name PostPile may send. The renderer route and the Telemetry class both check against it. */
export const TELEMETRY_EVENT_NAMES = Object.keys(TELEMETRY_EVENTS) as TelemetryEventName[];

export function isTelemetryEventName(name: string): name is TelemetryEventName {
  return Object.hasOwn(TELEMETRY_EVENTS, name);
}

/**
 * Events the renderer is allowed to report through POST /api/telemetry
 * (UI-only signals; the rest come from the engine itself). `as const` so
 * `RendererTelemetryEvent` below is the narrow literal union, not the whole catalogue.
 */
export const RENDERER_TELEMETRY_EVENTS = [
  'setup_step_viewed',
  'tile_opened',
  'search_used',
  'queue_filter_changed',
  'topic_opened',
  'update_pill_clicked',
  'update_later_clicked',
  'glance_retry_clicked',
] as const satisfies readonly TelemetryEventName[];

export type RendererTelemetryEvent = (typeof RENDERER_TELEMETRY_EVENTS)[number];
