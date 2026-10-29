import { z } from 'zod';
import { TOPIC_SECTION_ORDER } from './topic-sections.ts';

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

const setupStep = z.enum(['checks', 'sweep', 'review', 'day', 'accept']);
const interruptionsMode = z.enum(['never', 'batches', 'asap']);
const interruptionsFrom = z.enum(['setup', 'sidebar', 'prompt']);
const setupFitKind = z.enum(['no_effect', 'wrong_section', 'unclear']);
const setupFitFix = z.enum(['remove', 'move', 'rewrite']);
const toolName = z.enum(['gh', 'claude']);
const toolMissingReason = z.enum(['missing', 'logged_out', 'rejected', 'offline', 'limited']);

// -----------------------------------------------------------------------
// 3. Core actions
// -----------------------------------------------------------------------

const tileKind = z.enum(['single', 'stack', 'set']);
const forWhom = z.enum(['you', 'team', 'routing', 'your_pr', 'none']);
// The glance's own verdict (packages/core/src/types.ts Verdict), lowercased; null when the tile has no glance yet.
const verdict = z.enum(['looks_safe', 'look_closer', 'not_yours']).nullable();
// agent_tile / agent_topic: the ✨ Approve and ✨ Mark read backed by the agent's verdicts (DESIGN "Agent-assisted actions").
const approveFrom = z.enum(['detail', 'tile', 'agent_tile', 'agent_topic']);
// Where an approval's or comment review's note came from (core's ReviewNoteSource), none for an approval without one.
const reviewNote = z.enum(['none', 'agent', 'agent_edited', 'own']);
const markReadOrigin = z.enum(['tile', 'detail', 'debug', 'cleanup', 'agent_tile', 'agent_topic']);
// A snooze is either a time (bucketed) or a condition (someone replies, a
// push, a mute until someone asks you in person - see
// packages/core/src/snooze.ts SnoozeCondition; CI going green until 0.21.0,
// no longer sent): the same prop name the spec uses ("duration bucket"),
// widened to the condition-based snoozes the product actually has.
const snoozeDurationBucket = z.enum(['hours', 'a_day', 'days', 'a_week', 'someone_replies', 'new_push', 'muted']);
const queryLengthBucket = z.enum(['short', 'medium', 'long']);
const queueFilter = z.enum(['mine', 'team', 'reply', 'review', 'none']);
// The sidebar section the opened topic sits in, core's `TopicSection` as is.
const sidebarSection = z.enum(TOPIC_SECTION_ORDER);
const driverPickKind = z.enum(['you', 'teammate', 'team', 'outside', 'automatic']);

// -----------------------------------------------------------------------
// 4. Agent trust
// -----------------------------------------------------------------------

const recheckOutcome = z.enum(['keep', 'fix', 'drop']);
const proposalKind = z.enum(['topic_merge', 'rename', 'topic_split', 'topic_move', 'rule', 'instructions']);
// Who filed a topic proposal: the app's consolidation or an outside agent (MCP propose_topic_change).
const proposalSource = z.enum(['consolidation', 'agent', 'upgrade']);

// -----------------------------------------------------------------------
// 5. Health
// -----------------------------------------------------------------------

const syncTrigger = z.enum(['start', 'manual', 'auto']);
const syncErrorKind = z.enum(['gh_unavailable', 'agent_unavailable', 'rate_limited', 'other']);
const rateLimitSource = z.enum(['graphql', 'rest']);
// Where GitHub said "rate limited": a full sync's errors, or the live poll backing off.
const rateLimitWhere = z.enum(['sync', 'poll']);
// packages/core/src/github-quota.ts QuotaResource and the two levels below ok.
const quotaResource = z.enum(['core', 'graphql']);
const quotaLevel = z.enum(['low', 'critical']);
const percent = z.number().int().min(0).max(100);
// packages/engine/src/storage-jobs: every background storage job by name. Append only.
const storageJobName = z.enum(['bot_body_trim', 'checks_strip', 'discussion_rows', 'snapshot_strip', 'activity_rows', 'snapshot_strip_2', 'text_rows', 'snapshot_retire']);
// What started a self-update check (apps/desktop/src/main/self-update.ts): ~30s after launch, the hourly timer, a wake, or "Check for Updates…".
const updateCheckTrigger = z.enum(['launch', 'interval', 'wake', 'menu']);
const updateCheckResult = z.enum(['none', 'available', 'error']);
const updateFailStage = z.enum(['check', 'download']);
// A release version as latest-mac.yml names it, e.g. 0.21.0.
const releaseVersion = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/).max(40);
// electron-updater's error code, Chromium's net error, HTTP_<status> or the error class; never the message.
const updateErrorCode = z.string().regex(/^[A-Za-z0-9_]{1,40}$/);

// -----------------------------------------------------------------------
// 6. MCP server (postpile-mcp, a separate process that reads the database and asks the app for the rest)
// -----------------------------------------------------------------------

const mcpTool = z.enum(['pr_context', 'topic', 'search_prs', 'whats_on_me', 'refresh_from_github', 'propose_topic_change', 'note_pr', 'mark_read']);
const mcpConnectFrom = z.enum(['footer', 'setup']);
const replyTarget = z.enum(['thread', 'comment']);

// -----------------------------------------------------------------------
// 8. Scouts (DESIGN.md "Scouts"): never a scout's name, id, prompt, repo, path hint, PR number or title
// -----------------------------------------------------------------------

// How a scouted PR left the Scouted section; expired_* carry the expiry reason, reached_inbox: it got a notification thread or became tracked by itself.
const scoutClosedOutcome = z.enum(['followed', 'dismissed', 'expired_merged', 'expired_closed', 'expired_inactive', 'reached_inbox']);
// The intro card opened by itself (auto) or from the Scouted section's "Set up a scout" (manual).
const scoutIntroTrigger = z.enum(['auto', 'manual']);
// Which screen of the card was showing (the prompt, or the check's result) and how it closed. Turn on is scout_turned_on.
const scoutIntroStage = z.enum(['card', 'check']);
const scoutIntroAction = z.enum(['not_now', 'escape']);
// The check's fit verdict (core's ScoutFitVerdict).
const scoutFit = z.enum(['fits', 'partly', 'no']);
// Why a check ran no dry run: no scouts file to run it against, or no agent calls left today.
const scoutDryRunSkipped = z.enum(['no_scouts_file', 'no_calls_left']);
// Where a Follow failed: the PR's node id lookup, the subscription itself, or either one past its deadline.
const scoutFollowFailStage = z.enum(['lookup', 'subscribe', 'timeout']);
// A scouted PR read as seen: opened in the app, or mark_read from an outside agent.
const scoutSeenVia = z.enum(['open', 'mcp']);

/** No props: an empty object, so every event has a stable shape to validate against. */
const NO_PROPS = z.object({}).strict();

export const TELEMETRY_EVENTS = {
  // 1. Activation
  app_launched: z.object({ first_launch: z.boolean() }).strict(),
  setup_step_viewed: z.object({ step: setupStep }).strict(),
  setup_completed: NO_PROPS,
  setup_skipped: NO_PROPS,
  // The fit check on the Accept step: how many notes it had, and each fix the user took.
  setup_fit_checked: z.object({ notes: count, ok: z.boolean() }).strict(),
  setup_fit_fixed: z.object({ kind: setupFitKind, fix: setupFitFix }).strict(),
  first_sync_completed: z.object({ prs: count, topics: count, duration_ms: durationMs, agent_calls: count }).strict(),
  tool_missing: z.object({ tool: toolName, reason: toolMissingReason }).strict(),

  // 2. Retention
  app_active: NO_PROPS,
  window_focused: NO_PROPS,

  // 3. Core actions
  // scouted: a tile of a scout's pseudo-topic (DESIGN.md "Scouts"), counted apart from inbox tiles (0.29.0; absent before).
  tile_opened: z.object({ tile_kind: tileKind, for_whom: forWhom, has_glance: z.boolean(), verdict, scouted: z.boolean().optional() }).strict(),
  // with_note: the approval carried a note (only the detail pane's "+ note" has one). note: where it came from;
  // absent when the request did not say (2026-10-06; both absent before).
  pr_approved: z.object({ from: approveFrom, was_agent_approved: z.boolean(), with_note: z.boolean().optional(), note: reviewNote.optional() }).strict(),
  // "Comment review" in the detail pane: a review with a note, no approval. note: where the text came from, never the text.
  comment_review_sent: z.object({ note: reviewNote.exclude(['none']).optional() }).strict(),
  marked_read: z.object({ count, origin: markReadOrigin }).strict(),
  snoozed: z.object({ duration_bucket: snoozeDurationBucket }).strict(),
  opened_on_github: NO_PROPS,
  ask_sent: NO_PROPS,
  // A reply to one comment from the detail pane: in its review thread, or as a quoting PR comment.
  reply_sent: z.object({ target: replyTarget }).strict(),
  // A thumbs up on a comment or review from the detail pane.
  reaction_sent: NO_PROPS,
  // "Remove <team>" in the detail pane: a team review request removed. No PR, no team slug.
  team_request_removed: NO_PROPS,
  chat_message_sent: NO_PROPS,
  mac_ping_shown: z.object({ count }).strict(),
  mac_ping_clicked: NO_PROPS,
  // The user picked when PostPile may show Mac notifications: in the setup step, the sidebar menu, or the one-time prompt for installs that never chose.
  interruptions_changed: z.object({ mode: interruptionsMode, from: interruptionsFrom }).strict(),
  // At most hourly, only when a count is above 0: ping decisions since the last summary (pinged, or
  // withheld by the rules or the agent) and threads PostPile marked read itself ("Handled quietly").
  // pinged_glance: routed reviews whose glance said Look closer (their own source, not a poll decision).
  pings_summarized: z.object({ pinged: count, withheld_rules: count, withheld_agent: count, pinged_glance: count, handled_quietly: count }).strict(),
  search_used: z.object({ query_length_bucket: queryLengthBucket }).strict(),
  queue_filter_changed: z.object({ filter: queueFilter }).strict(),
  topic_opened: z.object({ section: sidebarSection }).strict(),
  // "Archive now" on a topic with nothing left, before it would go by itself.
  topic_archived: NO_PROPS,
  // The header's driver menu: which kind of driver the user picked, automatic for a reset. Never the login.
  driver_set: z.object({ kind: driverPickKind }).strict(),
  update_pill_clicked: NO_PROPS,
  update_later_clicked: NO_PROPS,
  // The bar under the title bar (24h or more behind): once per app run, when it first shows.
  // releases_behind is capped at 10 (the update check only sees the last 10); hours_behind is rounded.
  update_bar_shown: z.object({ releases_behind: count.max(10), hours_behind: count }).strict(),
  update_bar_later_clicked: NO_PROPS,
  // "Restart to update" in the pill's popover or the bar: the staged update is installed now.
  update_restart_clicked: NO_PROPS,
  glance_retry_clicked: NO_PROPS,

  // 4. Agent trust
  // from: only when the user picked a topic in "Move to topic…"; absent for a plain re-sort.
  wrong_topic_marked: z.object({ from: z.enum(['suggestion', 'search']).optional() }).strict(),
  not_related_marked: NO_PROPS,
  recheck_requested: NO_PROPS,
  // The agent's answer to a recheck, before the user decides.
  recheck_proposed: z.object({ outcome: recheckOutcome }).strict(),
  // The user's Accept on a recheck outcome (keep, fix or drop the line).
  recheck_resolved: z.object({ outcome: recheckOutcome }).strict(),
  memory_corrected: NO_PROPS,
  // source only for topic proposals (topic_merge, rename, topic_split, topic_move).
  proposal_resolved: z.object({ kind: proposalKind, accepted: z.boolean(), source: proposalSource.optional() }).strict(),
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
      // GitHub requests the sync made, and the lowest share of each hourly limit left while it ran (absent when no answer said).
      gh_requests: count,
      gh_core_remaining_pct: percent.optional(),
      gh_graphql_remaining_pct: percent.optional(),
      // GitHub writes on when the sync ended (2026-10-05; absent before).
      writes_on: z.boolean().optional(),
      // The V8 heap of the process that ran the sync (Electron main in the app), whole MB: used at the end, and the limit (absent before 0.18.0).
      heap_used_mb: count.optional(),
      heap_limit_mb: count.optional(),
    })
    .strict(),
  // At start: the last run ended without a clean quit (crash, out of memory, force quit). version_changed: that run was another version.
  app_crashed_last_run: z.object({ version_changed: z.boolean() }).strict(),
  sync_failed: z.object({ error_kind: syncErrorKind }).strict(),
  rate_limited: z.object({ source: rateLimitSource, where: rateLimitWhere }).strict(),
  // Once per drop into a worse level within one rate-limit window, not per request (DESIGN.md "GitHub quota").
  github_quota_low: z.object({ resource: quotaResource, level: quotaLevel }).strict(),
  // GitHub writes went on or off. With writes locked PostPile cannot mark anything read, so a heavy inbox only grows (2026-10-05).
  // from: footer = the user flipped the lock; default = an install that never chose got the default (on), sent once.
  github_writes_changed: z.object({ enabled: z.boolean(), from: z.enum(['footer', 'default']) }).strict(),
  consolidation_ran: z.object({ proposals_filed: count }).strict(),
  // The daily board snapshot, counts only: one per tile on the board. stacked_prs = members in a stack
  // (all of a stack tile, the stacks' members in a set, 0 for a single); pulled_in = layers fetched
  // only to complete a stack; topic_tiles = tile count of the topic the tile sits in.
  tile_shape: z.object({ kind: tileKind, prs: count, stacked_prs: count, pulled_in: count, topic_tiles: count }).strict(),
  // The same snapshot, one per active topic in the sidebar.
  topic_shape: z.object({ tiles: count, prs: count, single_tiles: count, stack_tiles: count, set_tiles: count }).strict(),
  // One glance catch-up run after the poll (packages/engine/src/catch-up). Always one topic per run.
  catch_up_ran: z.object({ topics: z.literal(1), agent_calls: count, duration_ms: durationMs, ok: z.boolean() }).strict(),
  // The board cap cut the hot set (the inbox is busy): PRs kept on the board and PRs left quiet. At most once an hour.
  board_trimmed: z.object({ kept: count, dropped: count }).strict(),
  // PRs with news that syncs and polls left alone in the last hour because they are outside the hot slice. At most once an hour.
  work_shed: z.object({ skipped_prs: count }).strict(),
  // A background storage job finished and its check passed. Numbers are this run's share (a job resumed after a quit
  // counts only what was left): units gone through, main-thread time in its slices, the longest slice, and the time
  // from its first slice to the end, pauses and waits included.
  storage_job_done: z.object({ name: storageJobName, units: count, work_ms: durationMs, longest_slice_ms: durationMs, wall_ms: durationMs }).strict(),
  // A background storage job ended its walk incomplete (its check failed twice, so it is not done and the jobs after it
  // wait), with how many units its check still finds undone; or a row backfill (discussion_rows, activity_rows,
  // text_rows) finished without the PRs whose json it could not split into rows, which the sync fetches again. At most
  // once per job per app run. Counts only, never keys.
  storage_job_blocked: z.object({ name: storageJobName, blocked_units: count }).strict(),
  // The packaged app's self-updater (main process). One per check it ran; a check skipped while one runs or an update is staged sends nothing.
  update_check_finished: z.object({ trigger: updateCheckTrigger, result: updateCheckResult, available_version: releaseVersion.optional() }).strict(),
  // Squirrel.Mac staged the update: a restart or quit installs it.
  update_downloaded: z.object({ version: releaseVersion }).strict(),
  // A check or download failed. Sent along with update_check_finished (result error) when the check itself failed.
  update_failed: z.object({ stage: updateFailStage, error_code: updateErrorCode }).strict(),

  // 6. MCP server: another agent asked PostPile something. found is false when the PR, topic or search found nothing;
  // response_chars is the answer's length (are brief answers brief), error whether it was a tool error.
  mcp_tool_called: z.object({ tool: mcpTool, found: z.boolean(), response_chars: count, error: z.boolean() }).strict(),
  // "Add to Claude Code" in the footer or the last setup step; ok is whether Claude Code has the server afterwards.
  mcp_connect_clicked: z.object({ from: mcpConnectFrom, ok: z.boolean() }).strict(),
  // "Not now" on the footer's offer.
  mcp_connect_dismissed: NO_PROPS,

  // 8. Scouts
  // One per full sync with at least one active scout. scouts: active scouts; listed: PRs the listings returned;
  // candidates: what passed the pre-filter; judged / pulled / pending / expired: as the sync log says;
  // judge_calls: scout_judge calls made. capped: judge calls ran out (per sync or the agent-call cap) with work left;
  // listing_capped: a repo's listing hit its page cap; rate_limited: GitHub rate-limited a scout read;
  // quota_low: the GitHub quota was low, so nothing ran.
  scout_run_completed: z
    .object({
      scouts: count,
      listed: count,
      candidates: count,
      judged: count,
      pulled: count,
      pending: count,
      expired: count,
      judge_calls: count,
      capped: z.boolean(),
      listing_capped: z.boolean(),
      rate_limited: z.boolean(),
      quota_low: z.boolean(),
      duration_ms: durationMs,
    })
    .strict(),
  // A scouted PR's first exit from the Scouted section, whatever the reason; best effort, at most once. was_opened: seen at least once (opened in
  // the app or mark_read over MCP); was_seen: seen through its latest activity; hours_in_section: pull to leaving, rounded.
  scout_pr_closed: z.object({ outcome: scoutClosedOutcome, was_seen: z.boolean(), was_opened: z.boolean(), hours_in_section: count }).strict(),
  scout_followed: z.object({ from: z.enum(['tile', 'detail']) }).strict(),
  scout_dismissed: z.object({ with_reason: z.boolean() }).strict(),
  // A Follow that did not reach GitHub, from the undo queue or the lock's queue.
  scout_follow_failed: z.object({ stage: scoutFollowFailStage }).strict(),
  // GitHub took a Follow after its deadline had already parked it as failed.
  scout_follow_late_success: NO_PROPS,
  // A scouted PR read as seen through newer activity than before (a repeat open of an unchanged PR sends nothing).
  scout_seen: z.object({ via: scoutSeenVia }).strict(),
  // The intro card funnel: shown, checked, then closed or turned on.
  scout_intro_shown: z.object({ trigger: scoutIntroTrigger }).strict(),
  scout_intro_closed: z.object({ stage: scoutIntroStage, action: scoutIntroAction }).strict(),
  // "Check scout" ran. dry_run_pulls and dry_run_complete when a dry run ran; dry_run_skipped_reason when none did.
  scout_checked: z
    .object({
      fit: scoutFit,
      cant_see: z.boolean(),
      dry_run_pulls: count.optional(),
      dry_run_complete: z.boolean().optional(),
      dry_run_skipped_reason: scoutDryRunSkipped.optional(),
    })
    .strict(),
  scout_turned_on: z.object({ repos: count, paths: count }).strict(),

  // Manual verification only (see NEXT.md "Verify once for real"). Never
  // sent from normal app code, not part of the analytics surface above.
  telemetry_test: NO_PROPS,
} as const;

export type TelemetryEventName = keyof typeof TELEMETRY_EVENTS;

export type TelemetryEventProps<K extends TelemetryEventName> = z.infer<(typeof TELEMETRY_EVENTS)[K]>;

/** How a scouted PR left the Scouted section, as scout_pr_closed reports it. */
export type ScoutClosedOutcome = z.infer<typeof scoutClosedOutcome>;

/** What started a self-update check, as update_check_finished reports it. */
export type UpdateCheckTrigger = z.infer<typeof updateCheckTrigger>;

/** The name of a background storage job (packages/engine/src/storage-jobs), as storage_job_done reports it. */
export type StorageJobName = z.infer<typeof storageJobName>;

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
  'setup_fit_fixed',
  'tile_opened',
  'search_used',
  'queue_filter_changed',
  'topic_opened',
  'update_pill_clicked',
  'update_later_clicked',
  'update_bar_shown',
  'update_bar_later_clicked',
  'update_restart_clicked',
  'glance_retry_clicked',
  'scout_intro_shown',
  'scout_intro_closed',
] as const satisfies readonly TelemetryEventName[];

export type RendererTelemetryEvent = (typeof RENDERER_TELEMETRY_EVENTS)[number];
